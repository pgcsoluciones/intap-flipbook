import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import { sanitizeSvg, svgHash, slugify } from '../lib/svg'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

// ════════════════════════════════════════════════════════════════════════════
// Biblioteca central de SVG — rutas de administración (/admin/svg).
// Solo accesibles para is_admin (el RBAC granular es Fase 6).
// ════════════════════════════════════════════════════════════════════════════

const svg = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

svg.use('*', jwtMiddleware)
svg.use('*', async (c, next) => {
  const userId = c.get('user').sub
  const user = await c.env.DB.prepare('SELECT is_admin FROM users WHERE id = ?')
    .bind(userId).first<{ is_admin: number }>()
  if (!user?.is_admin) return c.json({ success: false, error: 'Acceso denegado' }, 403)
  return next()
})

// Sube el SVG sanitizado a R2 y devuelve su URL pública.
async function putSvgToR2(env: Env, slug: string, content: string): Promise<string> {
  const key = `svg-library/${slug}-${crypto.randomUUID()}.svg`
  await env.MEDIA.put(key, content, { httpMetadata: { contentType: 'image/svg+xml' } })
  return `${env.R2_PUBLIC_BASE_URL}/${key}`
}

// Asegura un slug único agregando sufijo si ya existe.
async function uniqueSlug(env: Env, base: string): Promise<string> {
  let slug = base
  let n = 1
  while (await env.DB.prepare('SELECT id FROM svg_resources WHERE slug = ?').bind(slug).first()) {
    slug = `${base}-${n++}`
  }
  return slug
}

const J = (v: any) => JSON.stringify(v ?? [])

// Devuelve un family_id válido (número) o null. Evita el error
// SQLITE_CONSTRAINT_FOREIGNKEY si llega un id inexistente o no numérico.
async function resolveFamilyId(env: Env, raw: any): Promise<number | null> {
  if (raw === null || raw === undefined || raw === '') return null
  const id = Number(raw)
  if (!Number.isInteger(id)) return null
  const exists = await env.DB.prepare('SELECT id FROM svg_families WHERE id = ?').bind(id).first()
  return exists ? id : null
}

// ─── FAMILIAS ───────────────────────────────────────────────────────────────

svg.get('/families', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT f.*, COUNT(r.id) as resource_count
     FROM svg_families f
     LEFT JOIN svg_resources r ON r.family_id = f.id
     GROUP BY f.id ORDER BY f.sort_order ASC, f.name ASC`
  ).all()
  return c.json({ success: true, data: results })
})

svg.post('/families', async (c) => {
  const b = await c.req.json<{ name: string; category?: string; sort_order?: number }>().catch(() => ({} as any))
  if (!b.name?.trim()) return c.json({ success: false, error: 'El nombre es requerido' }, 400)
  const slug = await (async () => {
    let s = slugify(b.name), n = 1
    while (await c.env.DB.prepare('SELECT id FROM svg_families WHERE slug = ?').bind(s).first()) s = `${slugify(b.name)}-${n++}`
    return s
  })()
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO svg_families (name, slug, category, sort_order) VALUES (?,?,?,?)'
  ).bind(b.name.trim(), slug, b.category ?? null, b.sort_order ?? 0).run()
  return c.json({ success: true, data: { id: meta.last_row_id, slug } }, 201)
})

svg.put('/families/:id', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json<{ name?: string; category?: string; sort_order?: number }>().catch(() => ({} as any))
  await c.env.DB.prepare(
    'UPDATE svg_families SET name = COALESCE(?, name), category = COALESCE(?, category), sort_order = COALESCE(?, sort_order) WHERE id = ?'
  ).bind(b.name ?? null, b.category ?? null, b.sort_order ?? null, id).run()
  return c.json({ success: true })
})

svg.delete('/families/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE svg_resources SET family_id = NULL WHERE family_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM svg_families WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ─── RECURSOS SVG ─────────────────────────────────────────────────────────────

// Lista con filtros opcionales: ?family=&status=&q=
svg.get('/', async (c) => {
  const family = c.req.query('family')
  const status = c.req.query('status')
  const q = c.req.query('q')
  const where: string[] = []
  const binds: any[] = []
  if (family) { where.push('r.family_id = ?'); binds.push(family) }
  if (status) { where.push('r.status = ?'); binds.push(status) }
  if (q) { where.push('(r.name LIKE ? OR r.tags LIKE ?)'); binds.push(`%${q}%`, `%${q}%`) }
  const sql = `SELECT r.*, f.name as family_name FROM svg_resources r
     LEFT JOIN svg_families f ON f.id = r.family_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY r.created_at DESC`
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all()
  return c.json({ success: true, data: results })
})

// Sube un SVG individual. Body JSON: { name, svg_content, family_id?, category?,
// tags?, available_modules?, plans?, visible_to_lower_plans?, upgrade_message?,
// editable_*?, scope?, tenant_id? }
svg.post('/', async (c) => {
  const userId = c.get('user').sub
  const b = await c.req.json<any>().catch(() => ({}))
  if (!b.name?.trim()) return c.json({ success: false, error: 'El nombre es requerido' }, 400)
  if (!b.svg_content) return c.json({ success: false, error: 'El contenido SVG es requerido' }, 400)

  try {
    const clean = await sanitizeSvg(b.svg_content)
    if (!clean.ok) return c.json({ success: false, error: clean.error }, 400)

    // family_id solo es válido si referencia una familia existente (D1 tiene FK ON)
    const familyId = await resolveFamilyId(c.env, b.family_id)

    const slug = await uniqueSlug(c.env, slugify(b.slug || b.name))
    const url = await putSvgToR2(c.env, slug, clean.svg)
    const hash = await svgHash(clean.svg)

    const { meta } = await c.env.DB.prepare(
      `INSERT INTO svg_resources
         (name, slug, family_id, category, tags, available_modules, plans,
          visible_to_lower_plans, upgrade_message, editable_colors, editable_stroke,
          editable_layers, editable_gradients, editable_geometry, scope, tenant_id,
          svg_url, hash, version, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`
    ).bind(
      b.name.trim(), slug, familyId, b.category ?? null, J(b.tags),
      J(b.available_modules ?? ['canvas_insert_svg']), J(b.plans ?? ['free']),
      b.visible_to_lower_plans === false ? 0 : 1, b.upgrade_message ?? null,
      b.editable_colors === false ? 0 : 1, b.editable_stroke === false ? 0 : 1,
      b.editable_layers === false ? 0 : 1, b.editable_gradients ? 1 : 0,
      b.editable_geometry === false ? 0 : 1, b.scope ?? 'global', b.tenant_id ?? null,
      url, hash, b.status ?? 'active', userId
    ).run()

    return c.json({ success: true, data: { id: meta.last_row_id, slug, svg_url: url } }, 201)
  } catch (e: any) {
    return c.json({ success: false, error: `Error al subir SVG: ${e?.message ?? e}` }, 500)
  }
})

// Sube varios SVG en lote. Body: { items: [{ name, svg_content }], family_id?,
// available_modules?, plans?, editable_*?, status? } — la config se aplica a todos.
svg.post('/batch', async (c) => {
  const userId = c.get('user').sub
  const b = await c.req.json<any>().catch(() => ({}))
  const items: any[] = Array.isArray(b.items) ? b.items : []
  if (!items.length) return c.json({ success: false, error: 'No hay items' }, 400)

  // Resolvemos la familia una sola vez (la config es compartida para el lote).
  const familyId = await resolveFamilyId(c.env, b.family_id)

  const created: any[] = []
  const errors: any[] = []
  for (const it of items) {
    if (!it.name?.trim() || !it.svg_content) { errors.push({ name: it.name, error: 'name/svg_content requerido' }); continue }
    try {
      const clean = await sanitizeSvg(it.svg_content)
      if (!clean.ok) { errors.push({ name: it.name, error: clean.error }); continue }
      const slug = await uniqueSlug(c.env, slugify(it.name))
      const url = await putSvgToR2(c.env, slug, clean.svg)
      const hash = await svgHash(clean.svg)
      const { meta } = await c.env.DB.prepare(
        `INSERT INTO svg_resources
           (name, slug, family_id, category, tags, available_modules, plans,
            visible_to_lower_plans, upgrade_message, editable_colors, editable_stroke,
            editable_layers, editable_gradients, editable_geometry, scope, tenant_id,
            svg_url, hash, version, status, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`
      ).bind(
        it.name.trim(), slug, familyId, b.category ?? null, J(it.tags),
        J(b.available_modules ?? ['canvas_insert_svg']), J(b.plans ?? ['free']),
        b.visible_to_lower_plans === false ? 0 : 1, b.upgrade_message ?? null,
        b.editable_colors === false ? 0 : 1, b.editable_stroke === false ? 0 : 1,
        b.editable_layers === false ? 0 : 1, b.editable_gradients ? 1 : 0,
        b.editable_geometry === false ? 0 : 1, b.scope ?? 'global', b.tenant_id ?? null,
        url, hash, b.status ?? 'active', userId
      ).run()
      created.push({ id: meta.last_row_id, name: it.name, slug })
    } catch (e: any) {
      errors.push({ name: it.name, error: e?.message ?? String(e) })
    }
  }
  return c.json({ success: true, data: { created, errors } }, 201)
})

// Edita metadata (no el archivo fuente). Para reemplazar el SVG → POST /:id/version.
svg.put('/:id', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json<any>().catch(() => ({}))
  await c.env.DB.prepare(
    `UPDATE svg_resources SET
       name = COALESCE(?, name), family_id = ?, category = COALESCE(?, category),
       tags = COALESCE(?, tags), available_modules = COALESCE(?, available_modules),
       plans = COALESCE(?, plans), visible_to_lower_plans = COALESCE(?, visible_to_lower_plans),
       upgrade_message = COALESCE(?, upgrade_message),
       editable_colors = COALESCE(?, editable_colors), editable_stroke = COALESCE(?, editable_stroke),
       editable_layers = COALESCE(?, editable_layers), editable_gradients = COALESCE(?, editable_gradients),
       editable_geometry = COALESCE(?, editable_geometry), status = COALESCE(?, status),
       updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    b.name ?? null, b.family_id ?? null, b.category ?? null,
    b.tags !== undefined ? J(b.tags) : null,
    b.available_modules !== undefined ? J(b.available_modules) : null,
    b.plans !== undefined ? J(b.plans) : null,
    b.visible_to_lower_plans !== undefined ? (b.visible_to_lower_plans ? 1 : 0) : null,
    b.upgrade_message ?? null,
    b.editable_colors !== undefined ? (b.editable_colors ? 1 : 0) : null,
    b.editable_stroke !== undefined ? (b.editable_stroke ? 1 : 0) : null,
    b.editable_layers !== undefined ? (b.editable_layers ? 1 : 0) : null,
    b.editable_gradients !== undefined ? (b.editable_gradients ? 1 : 0) : null,
    b.editable_geometry !== undefined ? (b.editable_geometry ? 1 : 0) : null,
    b.status ?? null, id
  ).run()
  return c.json({ success: true })
})

// Elimina definitivamente un recurso: borra de D1 y de R2.
// Los canvas ya creados no se rompen porque Fabric.js incrusta el SVG en el
// canvas_json al insertar (no referencia la URL en tiempo de visualización).
svg.delete('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const row = await c.env.DB.prepare('SELECT svg_url FROM svg_resources WHERE id = ?')
      .bind(id).first<{ svg_url: string }>()
    if (!row) return c.json({ success: false, error: 'Recurso no encontrado' }, 404)

    // Borrar el archivo de R2
    const base = c.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')
    const key = row.svg_url.replace(`${base}/`, '')
    await c.env.MEDIA.delete(key)

    // Borrar versiones anteriores de R2
    const { results: versions } = await c.env.DB.prepare(
      'SELECT svg_url FROM svg_resource_versions WHERE resource_id = ?'
    ).bind(id).all<{ svg_url: string }>()
    for (const v of versions) {
      const vkey = v.svg_url.replace(`${base}/`, '')
      await c.env.MEDIA.delete(vkey)
    }

    // Borrar de D1 (versiones primero por FK, luego el recurso)
    await c.env.DB.prepare('DELETE FROM svg_resource_versions WHERE resource_id = ?').bind(id).run()
    await c.env.DB.prepare('DELETE FROM svg_resources WHERE id = ?').bind(id).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ success: false, error: `Error al eliminar: ${e?.message ?? e}` }, 500)
  }
})

// Archiva un recurso: no disponible para nuevas inserciones, pero no rompe
// documentos existentes (siguen apuntando al svg_url, que permanece en R2).
svg.patch('/:id/archive', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(
    `UPDATE svg_resources SET status = 'archived', updated_at = datetime('now') WHERE id = ?`
  ).bind(id).run()
  return c.json({ success: true })
})

// Reemplaza el SVG fuente creando una nueva versión. Guarda la anterior en
// svg_resource_versions para poder restaurarla. NO altera documentos ya creados.
svg.post('/:id/version', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json<{ svg_content?: string }>().catch(() => ({}))
  if (!b.svg_content) return c.json({ success: false, error: 'svg_content requerido' }, 400)

  const current = await c.env.DB.prepare('SELECT slug, svg_url, hash, version FROM svg_resources WHERE id = ?')
    .bind(id).first<{ slug: string; svg_url: string; hash: string; version: number }>()
  if (!current) return c.json({ success: false, error: 'Recurso no encontrado' }, 404)

  const clean = await sanitizeSvg(b.svg_content)
  if (!clean.ok) return c.json({ success: false, error: clean.error }, 400)

  // Guardar la versión actual en el historial
  await c.env.DB.prepare(
    'INSERT INTO svg_resource_versions (resource_id, version, svg_url, hash) VALUES (?,?,?,?)'
  ).bind(id, current.version, current.svg_url, current.hash).run()

  const newVersion = current.version + 1
  const url = await putSvgToR2(c.env, current.slug, clean.svg)
  const hash = await svgHash(clean.svg)
  await c.env.DB.prepare(
    `UPDATE svg_resources SET svg_url = ?, hash = ?, version = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(url, hash, newVersion, id).run()

  return c.json({ success: true, data: { version: newVersion, svg_url: url } })
})

// Historial de versiones
svg.get('/:id/versions', async (c) => {
  const id = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM svg_resource_versions WHERE resource_id = ? ORDER BY version DESC'
  ).bind(id).all()
  return c.json({ success: true, data: results })
})

export default svg

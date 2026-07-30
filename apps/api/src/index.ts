import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth'
import publicationRoutes from './routes/publications'
import pageRoutes from './routes/pages'
import uploadRoutes from './routes/upload'
import adminRoutes from './routes/admin'
import proposalRoutes from './routes/proposals'
import unitRoutes from './routes/units'
import svgRoutes from './routes/svg'
import dynamicMarkerRoutes from './routes/dynamicMarkers'
import productDetailRoutes from './routes/productDetails'
import publicDynamicMarkerRoutes, { publicMarkersForPublication } from './routes/publicDynamicMarkers'
import appointmentRoutes from './routes/appointmentCalendars'
import leadIntakeRoutes from './routes/leadIntakes'
import leadIntakeCustomerMessageRoutes from './routes/leadIntakeCustomerMessages'
import { jwtMiddleware } from './middleware/jwt'
import { verifyJwt } from './lib/jwt'
import { getUserPlan, getPlanUsage } from './lib/plans'
import { getGlobalWatermarkConfig } from './lib/watermarkConfig'
import {
  canvasUsesOpenProductDetail,
  cleanProductDetailId,
  parseCanvasJson,
} from './lib/productDetailsCanvas'
import type { AuthVariables } from './middleware/jwt'

export type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  MEDIA: R2Bucket
  PRIVATE_MEDIA: R2Bucket
  JWT_SECRET: string
  CORS_ORIGIN: string
  APP_ENV?: string
  ALLOWED_WRITE_ORIGINS?: string
  JWT_EXPIRY_DAYS: string
  R2_PUBLIC_BASE_URL: string
}

const app = new Hono<{ Bindings: Env }>()

async function tokenHash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('')
}

function contentDispositionFileName(name: string) {
  const fallback = name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'cotizacion'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function parseOrigins(value?: string): string[] {
  return (value ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
}

function isMutation(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
}

function isPagesDevOrigin(origin: string): boolean {
  try {
    return new URL(origin).hostname.endsWith('.pages.dev')
  } catch {
    return false
  }
}

function isDashboardPreviewOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:') return false
    const host = url.hostname
    return host === 'intap-flipbook-dashboard.pages.dev'
      || host.endsWith('.intap-flipbook-dashboard.pages.dev')
  } catch {
    return false
  }
}

function isViewerPreviewOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:') return false
    const host = url.hostname
    return host === 'intap-flipbook-viewer.pages.dev'
      || host.endsWith('.intap-flipbook-viewer.pages.dev')
  } catch {
    return false
  }
}

function isAllowedOrigin(origin: string, env: Env, value?: string): boolean {
  if (parseOrigins(value).includes(origin)) return true
  return env.APP_ENV === 'preview' && (isDashboardPreviewOrigin(origin) || isViewerPreviewOrigin(origin))
}

function isViewerWritePath(path: string): boolean {
  return /^\/view\/[^/]+\/(track|event|response)$/.test(path) || /^\/view\/[^/]+\/markers\/[^/]+\/booking$/.test(path)
}

function isViewerOrigin(origin: string, env: Env): boolean {
  return origin === 'https://flip.intaprd.com' || (env.APP_ENV === 'preview' && isViewerPreviewOrigin(origin))
}

app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: (origin) => (isAllowedOrigin(origin, c.env, c.env.CORS_ORIGIN) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    // navigator.sendBeacon() (analítica del viewer) siempre envía la petición en modo
    // credentials:'include'. El navegador entonces exige Access-Control-Allow-Credentials:true
    // en la respuesta del preflight, o bloquea la petición. Esta opción agrega ese header.
    credentials: true,
    maxAge: 86400,
  })
  return corsMiddleware(c, next)
})

app.use('*', async (c, next) => {
  if (!isMutation(c.req.method)) return next()

  const origin = c.req.header('Origin') ?? ''
  const appEnv = c.env.APP_ENV ?? 'production'
  const isProduction = appEnv === 'production'

  if (!origin) {
    return c.json({ success: false, error: 'Origen requerido para operaciones de escritura' }, 403)
  }

  if (isProduction && isPagesDevOrigin(origin)) {
    return c.json({ success: false, error: 'Origen preview no autorizado en producción' }, 403)
  }

  if (!isAllowedOrigin(origin, c.env, c.env.ALLOWED_WRITE_ORIGINS)) {
    return c.json({ success: false, error: 'Origen no autorizado para operaciones de escritura' }, 403)
  }

  if (isViewerOrigin(origin, c.env) && !isViewerWritePath(c.req.path)) {
    return c.json({ success: false, error: 'Origen viewer no autorizado para esta operación' }, 403)
  }

  return next()
})

app.get('/', (c) => c.json({ service: 'intap-flipbook-api', status: 'ok' }))

app.get('/public/customer-files/:token', async (c) => {
  const token = c.req.param('token')
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    return c.json({ success: false, error: 'Enlace de descarga inválido' }, 404)
  }

  const hash = await tokenHash(token)
  const attachment = await c.env.DB.prepare(
    `SELECT storage_key, original_name, mime_type
     FROM lead_intake_customer_message_attachments
     WHERE download_token_hash = ?
       AND download_expires_at IS NOT NULL
       AND download_expires_at > datetime('now')`,
  ).bind(hash).first<{
    storage_key: string
    original_name: string
    mime_type: string
  }>()

  if (!attachment) {
    return c.json({ success: false, error: 'Este enlace venció o ya no está disponible' }, 410)
  }

  const object = await c.env.PRIVATE_MEDIA.get(attachment.storage_key)
  if (!object) {
    return c.json({ success: false, error: 'Archivo no encontrado' }, 404)
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Content-Type', attachment.mime_type || 'application/octet-stream')
  headers.set('Content-Disposition', contentDispositionFileName(attachment.original_name))
  headers.set('Cache-Control', 'private, no-store, max-age=0')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('etag', object.httpEtag)

  void c.env.DB.prepare(
    `UPDATE lead_intake_customer_message_attachments
     SET downloaded_at = COALESCE(downloaded_at, datetime('now')),
         updated_at = datetime('now')
     WHERE storage_key = ?`,
  ).bind(attachment.storage_key).run()

  return new Response(object.body, { status: 200, headers })
})

// Auth (public)
app.route('/auth', authRoutes)

// Protected API
app.route('/api/publications', publicationRoutes)
// PROTECTED: Upload routes must be mounted before the general /api routes.
// Otherwise the public read-only upload asset route can be intercepted.
app.route('/api/upload', uploadRoutes)
app.route('/api/dynamic-markers', dynamicMarkerRoutes)
app.route('/api/product-details', productDetailRoutes)
app.route('/', appointmentRoutes)
app.route('/', leadIntakeRoutes)
app.route('/', leadIntakeCustomerMessageRoutes)
app.route('/api', pageRoutes)
app.route('/admin', adminRoutes)
app.route('/admin/svg', svgRoutes)
app.route('/', proposalRoutes)
app.route('/api/units', unitRoutes)

// Plan usage — protected
app.get('/api/me/usage', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { plan } = await getUserPlan(c.env.DB, userId)
  const usage = await getPlanUsage(c.env.DB, userId, plan)
  return c.json({ success: true, data: usage })
})

// Biblioteca SVG disponible para el tenant — filtrada por su plan.
// Los recursos de plan superior se devuelven con locked=true (incentivo de upgrade),
// salvo que el recurso tenga visible_to_lower_plans=0 (entonces se ocultan).
// Parámetro opcional ?module= para filtrar por módulo (canvas_insert_svg, button_icon_picker...).
app.get('/api/svg', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { planId: plan } = await getUserPlan(c.env.DB, userId)
  const moduleFilter = c.req.query('module')

  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.name, r.slug, r.family_id, r.category, r.tags,
            r.available_modules, r.plans, r.visible_to_lower_plans, r.upgrade_message,
            r.editable_colors, r.editable_stroke, r.editable_layers,
            r.editable_gradients, r.editable_geometry, r.svg_url, r.preview_url, r.version,
            f.name as family_name
     FROM svg_resources r
     LEFT JOIN svg_families f ON f.id = r.family_id
     WHERE r.status = 'active'
       AND (r.scope = 'global' OR (r.scope = 'tenant' AND r.tenant_id = ?))
     ORDER BY r.name ASC`
  ).bind(userId).all<any>()

  // Orden de planes para decidir si un recurso está "por encima" del plan del tenant.
  const RANK: Record<string, number> = { free: 0, basic: 1, pro: 2 }
  const myRank = RANK[plan] ?? 0

  const data = (results ?? []).flatMap((r: any) => {
    const plans: string[] = safeParse(r.plans, [])
    const modules: string[] = safeParse(r.available_modules, [])
    if (moduleFilter && modules.length && !modules.includes(moduleFilter)) return []

    // ¿El plan del tenant está permitido? Si no, está bloqueado.
    const allowed = plans.length === 0 || plans.includes(plan)
    // Plan mínimo requerido (el de menor rank entre los permitidos)
    const minRank = plans.length ? Math.min(...plans.map((p) => RANK[p] ?? 99)) : 0
    const locked = !allowed && minRank > myRank
    // Si está bloqueado y NO es visible a planes inferiores, se oculta por completo.
    if (locked && !r.visible_to_lower_plans) return []

    return [{
      id: r.id, name: r.name, slug: r.slug, family_id: r.family_id,
      family_name: r.family_name, category: r.category,
      tags: safeParse(r.tags, []), modules,
      svg_url: locked ? null : r.svg_url, // no exponemos la fuente de recursos bloqueados
      preview_url: r.preview_url, version: r.version,
      editable: {
        colors: !!r.editable_colors, stroke: !!r.editable_stroke,
        layers: !!r.editable_layers, gradients: !!r.editable_gradients,
        geometry: !!r.editable_geometry,
      },
      locked,
      required_plan: locked ? (Object.keys(RANK).find((k) => RANK[k] === minRank) ?? null) : null,
      upgrade_message: locked ? r.upgrade_message : null,
    }]
  })

  return c.json({ success: true, data })
})

// Devuelve el contenido SVG (texto) de un recurso de la biblioteca, validando
// que el plan del tenant tenga acceso. Se sirve a través de la API (no de R2
// directo) para evitar CORS y para poder validar el acceso en el servidor.
// El editor usa esto para insertar el SVG como VECTOR editable (loadSVGFromString).
app.get('/api/svg/:id/raw', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { planId: plan } = await getUserPlan(c.env.DB, userId)
  const id = c.req.param('id')

  const r = await c.env.DB.prepare(
    `SELECT plans, available_modules, visible_to_lower_plans, scope, tenant_id, svg_url, status
     FROM svg_resources WHERE id = ?`
  ).bind(id).first<any>()

  if (!r || r.status !== 'active') return c.json({ success: false, error: 'Recurso no encontrado' }, 404)
  if (r.scope === 'tenant' && r.tenant_id !== userId) {
    return c.json({ success: false, error: 'Sin acceso' }, 403)
  }

  // Mismo cálculo de bloqueo por plan que en GET /api/svg
  const RANK: Record<string, number> = { free: 0, basic: 1, pro: 2 }
  const myRank = RANK[plan] ?? 0
  const plans: string[] = safeParse(r.plans, [])
  const allowed = plans.length === 0 || plans.includes(plan)
  const minRank = plans.length ? Math.min(...plans.map((p) => RANK[p] ?? 99)) : 0
  if (!allowed && minRank > myRank) {
    return c.json({ success: false, error: 'Este recurso requiere un plan superior' }, 403)
  }

  // Leer el SVG desde R2 (vía binding, sin CORS) y devolverlo como texto.
  const base = c.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')
  const key = (r.svg_url as string).replace(`${base}/`, '')
  const obj = await c.env.MEDIA.get(key)
  if (!obj) return c.json({ success: false, error: 'Archivo no encontrado en R2' }, 404)

  const text = await obj.text()
  return c.body(text, 200, { 'Content-Type': 'image/svg+xml; charset=utf-8' })
})

// Módulos activos para este tenant
app.get('/api/me/modules', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT m.key, m.name, m.description,
            COALESCE(tm.enabled, m.active_globally) as enabled
     FROM modules m
     LEFT JOIN tenant_modules tm ON tm.module_key = m.key AND tm.user_id = ?
     WHERE m.active_globally = 1 OR tm.enabled = 1
     ORDER BY m.key ASC`
  ).bind(userId).all()
  return c.json({ success: true, data: results })
})

// ── Carpetas ──────────────────────────────────────────────────────────────────
app.get('/api/folders', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.name, f.created_at, COUNT(p.id) as pub_count
     FROM folders f
     LEFT JOIN publications p ON p.folder_id = f.id
     WHERE f.user_id = ?
     GROUP BY f.id ORDER BY f.name ASC`
  ).bind(userId).all()
  return c.json({ success: true, data: results })
})

app.post('/api/folders', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const body = await c.req.json<{ name: string }>()
  if (!body.name?.trim()) return c.json({ success: false, error: 'El nombre es requerido' }, 400)
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO folders (id, user_id, name) VALUES (?,?,?)').bind(id, userId, body.name.trim()).run()
  return c.json({ success: true, data: { id, name: body.name.trim(), pub_count: 0 } }, 201)
})

app.put('/api/folders/:id', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const fid = c.req.param('id')
  const body = await c.req.json<{ name: string }>()
  if (!body.name?.trim()) return c.json({ success: false, error: 'El nombre es requerido' }, 400)
  await c.env.DB.prepare('UPDATE folders SET name = ? WHERE id = ? AND user_id = ?').bind(body.name.trim(), fid, userId).run()
  return c.json({ success: true })
})

app.delete('/api/folders/:id', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const fid = c.req.param('id')
  await c.env.DB.prepare('UPDATE publications SET folder_id = NULL WHERE folder_id = ? AND user_id = ?').bind(fid, userId).run()
  await c.env.DB.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').bind(fid, userId).run()
  return c.json({ success: true })
})

app.patch('/api/publications/:id/folder', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const pubId = c.req.param('id')
  const body = await c.req.json<{ folder_id: string | null }>()
  await c.env.DB.prepare('UPDATE publications SET folder_id = ? WHERE id = ? AND user_id = ?')
    .bind(body.folder_id ?? null, pubId, userId).run()
  return c.json({ success: true })
})

// Public feed — publicaciones publicadas de un tenant por slug — sin auth
app.get('/public/:tenantSlug', async (c) => {
  const tenantSlug = c.req.param('tenantSlug')
  const tenant = await c.env.DB.prepare(
    `SELECT id FROM users WHERE slug = ?`
  ).bind(tenantSlug).first<{ id: string }>()

  if (!tenant) return c.json({ success: true, data: [] })

  const { results } = await c.env.DB.prepare(
    `SELECT id, title, description, category, cover_image_url, public_slug, views_count, updated_at
     FROM publications
     WHERE user_id = ? AND status = 'published' AND deleted_at IS NULL
     ORDER BY updated_at DESC`
  ).bind(tenant.id).all()

  return c.json({ success: true, data: results ?? [] })
})

// Endpoint público de unidades para el viewer (sin auth)
app.get('/view/units', async (c) => {
  const pubId = c.req.query('publication_id')
  if (!pubId) return c.json({ success: false, error: 'publication_id requerido' }, 400)
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM units WHERE publication_id = ? ORDER BY floor ASC, unit_number ASC, name ASC`
  ).bind(pubId).all()
  return c.json({ success: true, data: results })
})

// Social preview metadata — public, lightweight, no pages/canvas/widgets.
app.get('/view/meta/:tenantSlug/:publicationSlug', async (c) => {
  const tenantSlug = c.req.param('tenantSlug')
  const publicationSlug = c.req.param('publicationSlug')

  const pub = await c.env.DB.prepare(
    `SELECT p.title, p.description, p.cover_image_url, p.public_slug, p.updated_at,
            p.social_title, p.social_description, p.social_image_url, p.social_updated_at,
            u.slug as tenant_slug
     FROM publications p
     JOIN users u ON u.id = p.user_id
     WHERE u.slug = ?
       AND p.public_slug = ?
       AND p.status = 'published'
       AND p.deleted_at IS NULL`,
  )
    .bind(tenantSlug, publicationSlug)
    .first<{
      title: string
      description: string | null
      cover_image_url: string | null
      public_slug: string
      updated_at: string | null
      social_title: string | null
      social_description: string | null
      social_image_url: string | null
      social_updated_at: string | null
      tenant_slug: string
    }>()

  if (!pub) return c.json({ success: false, error: 'Publication not found' }, 404)

  const firstPage = await c.env.DB.prepare(
    `SELECT pg.image_url
     FROM pages pg
     JOIN publications p ON p.id = pg.publication_id
     JOIN users u ON u.id = p.user_id
     WHERE u.slug = ? AND p.public_slug = ? AND p.status = 'published' AND p.deleted_at IS NULL
       AND pg.image_url IS NOT NULL
     ORDER BY pg.page_number ASC
     LIMIT 1`,
  )
    .bind(tenantSlug, publicationSlug)
    .first<{ image_url: string | null }>()

  return c.json({
    success: true,
    data: {
      title: pub.social_title || pub.title,
      description: pub.social_description || pub.description || 'Mirá este catálogo interactivo en Intap Flipbook',
      image_url: pub.social_image_url || pub.cover_image_url || firstPage?.image_url || null,
      image_version: pub.social_updated_at || pub.updated_at,
      tenant_slug: pub.tenant_slug,
      public_slug: pub.public_slug,
      canonical_url: `https://flip.intaprd.com/${pub.tenant_slug}/${pub.public_slug}`,
    },
  })
})

// Public viewer endpoint — no auth required
app.route('/view/:slug/dynamic-markers', publicDynamicMarkerRoutes)

type ViewerPublicationRow = {
  id: string
  title: string
  description: string | null
  cover_image_url: string | null
  sound_enabled: number
  project_phone: string | null
  project_whatsapp: string | null
  project_location: string | null
  project_address: string | null
  project_developer: string | null
  project_website: string | null
  plan_id: string
  watermark_override: string
  watermark_tenant: string | null
}

async function viewerPayload(db: D1Database, pub: ViewerPublicationRow) {
  const [{ results: pages }, dynamicMarkers, wmConfig] = await Promise.all([
    db.prepare(
      `SELECT pg.id, pg.page_number, pg.image_url, ma.optimized_url, ma.optimized_width, ma.optimized_height,
              pg.title, pg.description, pg.price, pg.canvas_json, pg.cover_json
       FROM pages pg
       LEFT JOIN media_assets ma
         ON ma.publication_id = pg.publication_id
        AND ma.public_url = pg.image_url
        AND ma.deleted_at IS NULL
       WHERE pg.publication_id = ?
       ORDER BY pg.page_number ASC`,
    ).bind(pub.id).all(),
    publicMarkersForPublication(db, pub.id),
    getGlobalWatermarkConfig(db),
  ])

  // Prioridad: 1) free siempre activa, 2) elección del tenant, 3) override del admin, 4) default por plan
  const planIsFree = pub.plan_id === 'free'
  const tenantChoice = pub.watermark_tenant   // 'show' | 'hide' | null
  const adminOverride = pub.watermark_override ?? 'plan'  // 'force_show' | 'force_hide' | 'plan'
  const planDefault = pub.plan_id === 'basic'  // basic=true(activa), pro=false(oculta)
  const watermarkEnabled =
    planIsFree ? true :
    tenantChoice === 'show' ? true :
    tenantChoice === 'hide' ? false :
    adminOverride === 'force_show' ? true :
    adminOverride === 'force_hide' ? false :
    planDefault

  return {
    success: true,
    data: {
      id: pub.id,
      title: pub.title,
      description: pub.description,
      cover_image_url: pub.cover_image_url,
      sound_enabled: pub.sound_enabled === 1,
      project_phone: pub.project_phone,
      project_whatsapp: pub.project_whatsapp,
      project_location: pub.project_location,
      project_address: pub.project_address,
      project_developer: pub.project_developer,
      project_website: pub.project_website,
      watermark_enabled: watermarkEnabled,
      watermark: wmConfig,
      pages,
      dynamic_markers: dynamicMarkers,
    },
  }
}

app.get('/view/preview/:token', async (c) => {
  if ((c.env.APP_ENV ?? 'production') !== 'preview') {
    return c.json({ success: false, error: 'Preview not found' }, 404)
  }

  let payload: any
  try {
    payload = await verifyJwt(c.req.param('token'), c.env.JWT_SECRET)
  } catch {
    return c.json({ success: false, error: 'Invalid or expired preview token' }, 401)
  }

  if (payload.kind !== 'publication_preview' || !payload.publication_id || !payload.sub) {
    return c.json({ success: false, error: 'Invalid preview token' }, 401)
  }

  const pub = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.description, p.cover_image_url, p.sound_enabled,
            p.project_phone, p.project_whatsapp, p.project_location,
            p.project_address, p.project_developer, p.project_website,
            u.plan_id, u.watermark_override, u.watermark_tenant
     FROM publications p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = ? AND p.user_id = ? AND p.deleted_at IS NULL`,
  )
    .bind(payload.publication_id, payload.sub)
    .first<ViewerPublicationRow>()

  if (!pub) return c.json({ success: false, error: 'Publication not found' }, 404)
  return c.json(await viewerPayload(c.env.DB, pub))
})

type PublicProductDetailRow = {
  id: number
  title: string
  description: string | null
  price: string | null
  image_url: string | null
  accent_color: string | null
  cta_type: string | null
  cta_label: string | null
  cta_target: string | null
}

function cleanPublicProductDetailId(value: unknown): number | null {
  return cleanProductDetailId(value)
}

function publicProductDetailPayload(detail: PublicProductDetailRow) {
  return {
    id: detail.id,
    title: detail.title,
    description: detail.description,
    price: detail.price,
    image_url: detail.image_url,
    accent_color: detail.accent_color || '#4F46E5',
    cta_type: detail.cta_type,
    cta_label: detail.cta_label,
    cta_target: detail.cta_target,
  }
}

async function publicationUsesProductDetail(
  db: D1Database,
  publicationId: string,
  detailId: number,
): Promise<boolean> {
  const { results } = await db.prepare(
    `SELECT canvas_json
     FROM pages
     WHERE publication_id = ?
       AND canvas_json LIKE '%open_product_detail%'`,
  ).bind(publicationId).all<{ canvas_json: string | null }>()

  return (results ?? []).some((row) =>
    canvasUsesOpenProductDetail(
      parseCanvasJson(row.canvas_json),
      detailId,
    )
  )
}


app.get('/view/preview/:token/product-details/:detailId', async (c) => {
  if ((c.env.APP_ENV ?? 'production') !== 'preview') {
    return c.json({ success: false, error: 'Detalle no disponible' }, 404)
  }

  const detailId = cleanPublicProductDetailId(c.req.param('detailId'))
  if (!detailId) {
    return c.json({ success: false, error: 'Detalle no disponible' }, 404)
  }

  let payload: any
  try {
    payload = await verifyJwt(c.req.param('token'), c.env.JWT_SECRET)
  } catch {
    return c.json({ success: false, error: 'Detalle no disponible' }, 404)
  }

  if (
    payload.kind !== 'publication_preview' ||
    !payload.publication_id ||
    !payload.sub
  ) {
    return c.json({ success: false, error: 'Detalle no disponible' }, 404)
  }

  const publication = await c.env.DB.prepare(
    `SELECT id, user_id
     FROM publications
     WHERE id = ?
       AND user_id = ?
       AND deleted_at IS NULL
     LIMIT 1`,
  ).bind(
    payload.publication_id,
    payload.sub,
  ).first<{ id: string; user_id: string }>()

  if (!publication) {
    return c.json({ success: false, error: 'Detalle no disponible' }, 404)
  }

  const isLinked = await publicationUsesProductDetail(
    c.env.DB,
    publication.id,
    detailId,
  )

  if (!isLinked) {
    return c.json({ success: false, error: 'Detalle no disponible' }, 404)
  }

  const detail = await c.env.DB.prepare(
    `SELECT
       id,
       title,
       description,
       price,
       image_url,
       accent_color,
       cta_type,
       cta_label,
       cta_target
     FROM product_details
     WHERE id = ?
       AND tenant_id = ?
       AND status = 'active'
     LIMIT 1`,
  ).bind(
    detailId,
    publication.user_id,
  ).first<PublicProductDetailRow>()

  if (!detail) {
    return c.json({ success: false, error: 'Detalle no disponible' }, 404)
  }

  return c.json({
    success: true,
    data: publicProductDetailPayload(detail),
  })
})

app.get('/view/:slug/product-details/:detailId', async (c) => {
  const slug = c.req.param('slug')
  const detailId = cleanPublicProductDetailId(c.req.param('detailId'))

  if (!detailId) {
    return c.json(
      { success: false, error: 'Detalle no disponible' },
      404,
    )
  }

  const publication = await c.env.DB.prepare(
    `SELECT id, user_id
     FROM publications
     WHERE public_slug = ?
       AND status = 'published'
       AND deleted_at IS NULL
     LIMIT 1`,
  ).bind(slug).first<{ id: string; user_id: string }>()

  if (!publication) {
    return c.json(
      { success: false, error: 'Detalle no disponible' },
      404,
    )
  }

  const isLinked = await publicationUsesProductDetail(
    c.env.DB,
    publication.id,
    detailId,
  )

  if (!isLinked) {
    return c.json(
      { success: false, error: 'Detalle no disponible' },
      404,
    )
  }

  const detail = await c.env.DB.prepare(
    `SELECT
       id,
       title,
       description,
       price,
       image_url,
       accent_color,
       cta_type,
       cta_label,
       cta_target
     FROM product_details
     WHERE id = ?
       AND tenant_id = ?
       AND status = 'active'
     LIMIT 1`,
  ).bind(
    detailId,
    publication.user_id,
  ).first<PublicProductDetailRow>()

  if (!detail) {
    return c.json(
      { success: false, error: 'Detalle no disponible' },
      404,
    )
  }

  return c.json({
    success: true,
    data: publicProductDetailPayload(detail),
  })
})

app.get('/view/:slug', async (c) => {
  const slug = c.req.param('slug')
  const pub = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.description, p.cover_image_url, p.sound_enabled,
            p.project_phone, p.project_whatsapp, p.project_location,
            p.project_address, p.project_developer, p.project_website,
            u.plan_id, u.watermark_override, u.watermark_tenant
     FROM publications p
     JOIN users u ON u.id = p.user_id
     WHERE p.public_slug = ? AND p.status = 'published'`,
  )
    .bind(slug)
    .first<ViewerPublicationRow>()

  if (!pub) return c.json({ success: false, error: 'Publication not found' }, 404)
  return c.json(await viewerPayload(c.env.DB, pub))
})

// Tenant: listar sus notificaciones (con auth)
app.get('/api/notifications', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, message, read, created_at
     FROM notifications
     WHERE user_id = ? OR user_id IS NULL
     ORDER BY created_at DESC LIMIT 30`
  ).bind(userId).all()
  return c.json({ success: true, data: results })
})

// Tenant: marcar notificación como leída
app.patch('/api/notifications/:id/read', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const id = c.req.param('id')
  await c.env.DB.prepare(
    `UPDATE notifications SET read = 1 WHERE id = ? AND (user_id = ? OR user_id IS NULL)`
  ).bind(id, userId).run()
  return c.json({ success: true })
})

// Tenant: solicitar cambio de plan
app.post('/api/plan-requests', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const body = await c.req.json<{ requested_plan: string; notes?: string }>().catch(() => ({}))
  if (!body.requested_plan) return c.json({ success: false, error: 'requested_plan es requerido' }, 400)

  const plan = await c.env.DB.prepare('SELECT id FROM plans WHERE id = ? AND status = ?')
    .bind(body.requested_plan, 'active').first()
  if (!plan) return c.json({ success: false, error: 'Plan no encontrado' }, 404)

  const currentUser = await c.env.DB.prepare('SELECT plan_id FROM users WHERE id = ?').bind(userId).first<{ plan_id: string }>()
  const RANK: Record<string, number> = { free: 0, basic: 1, pro: 2 }
  const currentRank = RANK[currentUser?.plan_id ?? 'free'] ?? 0
  const requestedRank = RANK[body.requested_plan] ?? 0
  const direction = requestedRank >= currentRank ? 'upgrade' : 'downgrade'

  // Cancelar solicitudes pendientes anteriores del mismo usuario
  await c.env.DB.prepare(
    `UPDATE plan_requests SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'`
  ).bind(userId).run()

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO plan_requests (user_id, requested_plan, direction, status, notes) VALUES (?, ?, ?, 'pending', ?)`
  ).bind(userId, body.requested_plan, direction, body.notes ?? null).run()

  return c.json({ success: true, data: { id: meta.last_row_id } }, 201)
})

// Tenant: ver sus solicitudes de plan
app.get('/api/plan-requests', jwtMiddleware, async (c) => {
  const userId = (c as any).get('user').sub
  const { results } = await c.env.DB.prepare(
    `SELECT pr.*, p.name as plan_name FROM plan_requests pr
     LEFT JOIN plans p ON p.id = pr.requested_plan
     WHERE pr.user_id = ? ORDER BY pr.created_at DESC LIMIT 10`
  ).bind(userId).all()
  return c.json({ success: true, data: results })
})

// Parsea JSON de forma segura, devolviendo un fallback si falla.
function safeParse<T>(raw: any, fallback: T): T {
  if (raw == null) return fallback
  if (typeof raw !== 'string') return raw as T
  try { return JSON.parse(raw) as T } catch { return fallback }
}

// Detecta el tipo de dispositivo desde el User-Agent HTTP
function detectDevice(ua: string | undefined): string {
  if (!ua) return 'desktop'
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return 'tablet'
  if (/Mobi|Android.*Mobile|iPhone/i.test(ua)) return 'mobile'
  return 'desktop'
}

// Registra una vista de publicación — público (sin auth), fire-and-forget
app.post('/view/:slug/track', async (c) => {
  const slug = c.req.param('slug')
  const pub = await c.env.DB.prepare(
    `SELECT id FROM publications WHERE public_slug = ? AND status = 'published'`
  ).bind(slug).first<{ id: string }>()
  if (!pub) return c.json({ success: false }, 404)

  const device = detectDevice(c.req.header('user-agent'))
  const cf = (c.req.raw as any).cf ?? {}
  const country = cf.country ?? null
  const city = cf.city ?? null
  const referrer = c.req.header('referer') ?? c.req.header('referrer') ?? null

  try {
    await Promise.all([
      c.env.DB.prepare(
        `INSERT INTO publication_views (publication_id, device, country, city, referrer) VALUES (?, ?, ?, ?, ?)`
      ).bind(pub.id, device, country, city, referrer).run(),
      c.env.DB.prepare(
        `UPDATE publications SET views_count = views_count + 1 WHERE id = ?`
      ).bind(pub.id).run(),
    ])
  } catch (_) {}

  return c.json({ success: true }, 201)
})

// Registra un evento de analítica (tiempo en página o clic en botón) — público, fire-and-forget
app.post('/view/:slug/event', async (c) => {
  const slug = c.req.param('slug')
  const pub = await c.env.DB.prepare(
    `SELECT id FROM publications WHERE public_slug = ? AND status = 'published'`
  ).bind(slug).first<{ id: string }>()
  if (!pub) return c.json({ success: false }, 404)

  let body: any = {}
  try { body = await c.req.json() } catch (_) {}

  const validTypes = ['click', 'page_time', 'page_view']
  const type = validTypes.includes(body.type) ? body.type : 'page_time'
  const pageNumber = Number.isFinite(Number(body.page_number)) ? Number(body.page_number) : null
  const label = typeof body.label === 'string' ? body.label.slice(0, 120) : null
  const actionType = typeof body.action_type === 'string' ? body.action_type.slice(0, 40) : null
  const durationMs = Number.isFinite(Number(body.duration_ms)) ? Math.max(0, Math.round(Number(body.duration_ms))) : null
  const device = detectDevice(c.req.header('user-agent'))
  const cf = (c.req.raw as any).cf ?? {}
  const country = cf.country ?? null
  const city = cf.city ?? null
  const referrer = c.req.header('referer') ?? c.req.header('referrer') ?? null
  const urlDestination = typeof body.url_destination === 'string' ? body.url_destination.slice(0, 500) : null

  try {
    await c.env.DB.prepare(
      `INSERT INTO page_events (publication_id, type, page_number, label, action_type, duration_ms, device, country, city, referrer, url_destination)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(pub.id, type, pageNumber, label, actionType, durationMs, device, country, city, referrer, urlDestination).run()
  } catch (e) {
    console.error('[page_events] INSERT error:', e)
    return c.json({ success: false, error: 'DB error' }, 500)
  }

  return c.json({ success: true }, 201)
})

// Recibe respuestas de formularios / cuestionarios desde el viewer — público (sin auth)
app.post('/view/:slug/response', async (c) => {
  const slug = c.req.param('slug')
  const pub = await c.env.DB.prepare(
    `SELECT id, user_id FROM publications WHERE public_slug = ? AND status = 'published'`,
  )
    .bind(slug)
    .first<{ id: string; user_id: string }>()
  if (!pub) return c.json({ success: false, error: 'Publication not found' }, 404)

  const body = await c.req.json<{ kind?: string; widget_key?: string; payload?: any }>().catch(() => ({}))
  const kind = body.kind === 'quiz' ? 'quiz' : 'contact'
  const payload = typeof body.payload === 'string' ? body.payload : JSON.stringify(body.payload ?? {})

  try {
    await c.env.DB.prepare(
      `INSERT INTO form_responses (publication_id, owner_id, kind, widget_key, payload)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(pub.id, pub.user_id, kind, body.widget_key ?? null, payload)
      .run()
  } catch (e) {
    // Si la tabla aún no existe, no romper el viewer
    return c.json({ success: false, error: 'No se pudo guardar la respuesta' }, 500)
  }

  return c.json({ success: true }, 201)
})

// Cron: degradar planes expirados a free (corre 1x/día vía [triggers].crons en wrangler.toml)
async function degradeExpiredTenants(db: D1Database) {
  // 1) Avisar a quienes vencen pronto (dentro de los próximos 5 días), una sola vez por ciclo.
  //    Evitamos duplicar el aviso buscando una notificación de tipo 'plan_expiry' creada hoy.
  const { results: expiringSoon } = await db.prepare(
    `SELECT id, plan_id, plan_expires_at
     FROM users
     WHERE plan_id != 'free'
       AND plan_expires_at IS NOT NULL
       AND plan_expires_at > datetime('now')
       AND plan_expires_at <= datetime('now', '+5 days')`
  ).all<{ id: string; plan_id: string; plan_expires_at: string }>()

  for (const u of expiringSoon) {
    const already = await db.prepare(
      `SELECT 1 FROM notifications
       WHERE user_id = ? AND title LIKE 'Tu plan vence%'
         AND date(created_at) = date('now') LIMIT 1`
    ).bind(u.id).first()
    if (already) continue
    await db.prepare(
      `INSERT INTO notifications (user_id, title, message, read) VALUES (?, ?, ?, 0)`
    ).bind(
      u.id,
      `Tu plan ${String(u.plan_id).toUpperCase()} vence pronto`,
      `Tu plan vence el ${u.plan_expires_at.slice(0, 10)}. Renová tu pago para no perder el acceso a las funciones de tu plan.`
    ).run()
  }

  // 2) Degradar a free los planes ya vencidos.
  await db.prepare(
    `UPDATE users
     SET plan_id = 'free', plan_expires_at = NULL
     WHERE plan_id != 'free'
       AND plan_expires_at IS NOT NULL
       AND plan_expires_at < datetime('now')`
  ).run()
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await degradeExpiredTenants(env.DB)
  },
}

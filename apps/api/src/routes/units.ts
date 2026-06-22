import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

type Variables = AuthVariables

const units = new Hono<{ Bindings: Env; Variables: Variables }>()

units.use('*', jwtMiddleware)

// Verifica que la publicación pertenezca al usuario autenticado
async function ownedPublication(db: D1Database, publicationId: string, userId: string) {
  return db
    .prepare(`SELECT id FROM publications WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(publicationId, userId)
    .first<{ id: string }>()
}

// Verifica que la unidad pertenezca al usuario (via publications)
async function ownedUnit(db: D1Database, unitId: string, userId: string) {
  return db
    .prepare(
      `SELECT u.id, u.publication_id FROM units u
       JOIN publications p ON p.id = u.publication_id
       WHERE u.id = ? AND p.user_id = ?`
    )
    .bind(unitId, userId)
    .first<{ id: string; publication_id: string }>()
}

// GET /api/units?publication_id=xxx
units.get('/', async (c) => {
  const userId = c.get('user').sub
  const publicationId = c.req.query('publication_id')
  if (!publicationId) return c.json({ success: false, error: 'publication_id es requerido' }, 400)

  const pub = await ownedPublication(c.env.DB, publicationId, userId)
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM units WHERE publication_id = ? ORDER BY floor ASC, unit_number ASC, name ASC`
  )
    .bind(publicationId)
    .all()

  return c.json({ success: true, data: results })
})

// POST /api/units
units.post('/', async (c) => {
  const userId = c.get('user').sub
  const body = await c.req.json<{
    publication_id: string
    name: string
    status?: 'available' | 'reserved' | 'sold'
    price?: number
    area_m2?: number
    bedrooms?: number
    bathrooms?: number
    description?: string
    floor?: number
    unit_number?: string
    page_id?: string
  }>()

  if (!body.publication_id) return c.json({ success: false, error: 'publication_id es requerido' }, 400)
  if (!body.name?.trim()) return c.json({ success: false, error: 'name es requerido' }, 400)

  const pub = await ownedPublication(c.env.DB, body.publication_id, userId)
  if (!pub) return c.json({ success: false, error: 'Publicación no encontrada' }, 404)

  const validStatuses = ['available', 'reserved', 'sold']
  const status = validStatuses.includes(body.status ?? '') ? body.status : 'available'

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO units (id, publication_id, page_id, name, status, price, area_m2, bedrooms, bathrooms, description, floor, unit_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.publication_id,
      body.page_id ?? null,
      body.name.trim(),
      status,
      body.price ?? null,
      body.area_m2 ?? null,
      body.bedrooms ?? null,
      body.bathrooms ?? null,
      body.description ?? null,
      body.floor ?? null,
      body.unit_number ?? null,
    )
    .run()

  const unit = await c.env.DB.prepare(`SELECT * FROM units WHERE id = ?`).bind(id).first()
  return c.json({ success: true, data: unit }, 201)
})

// PUT /api/units/:id
units.put('/:id', async (c) => {
  const userId = c.get('user').sub
  const unitId = c.req.param('id')

  const existing = await ownedUnit(c.env.DB, unitId, userId)
  if (!existing) return c.json({ success: false, error: 'Unidad no encontrada' }, 404)

  const body = await c.req.json<{
    name?: string
    status?: string
    price?: number | null
    area_m2?: number | null
    bedrooms?: number | null
    bathrooms?: number | null
    description?: string | null
    floor?: number | null
    unit_number?: string | null
    page_id?: string | null
  }>()

  const validStatuses = ['available', 'reserved', 'sold']
  const status = body.status && validStatuses.includes(body.status) ? body.status : undefined

  await c.env.DB.prepare(
    `UPDATE units SET
       name = COALESCE(?, name),
       status = COALESCE(?, status),
       price = ?,
       area_m2 = ?,
       bedrooms = ?,
       bathrooms = ?,
       description = ?,
       floor = ?,
       unit_number = ?,
       page_id = ?,
       updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(
      body.name?.trim() ?? null,
      status ?? null,
      body.price !== undefined ? body.price : null,
      body.area_m2 !== undefined ? body.area_m2 : null,
      body.bedrooms !== undefined ? body.bedrooms : null,
      body.bathrooms !== undefined ? body.bathrooms : null,
      body.description !== undefined ? body.description : null,
      body.floor !== undefined ? body.floor : null,
      body.unit_number !== undefined ? body.unit_number : null,
      body.page_id !== undefined ? body.page_id : null,
      unitId,
    )
    .run()

  const unit = await c.env.DB.prepare(`SELECT * FROM units WHERE id = ?`).bind(unitId).first()
  return c.json({ success: true, data: unit })
})

// PATCH /api/units/:id/status
units.patch('/:id/status', async (c) => {
  const userId = c.get('user').sub
  const unitId = c.req.param('id')

  const existing = await ownedUnit(c.env.DB, unitId, userId)
  if (!existing) return c.json({ success: false, error: 'Unidad no encontrada' }, 404)

  const body = await c.req.json<{ status: string }>()
  const validStatuses = ['available', 'reserved', 'sold']
  if (!validStatuses.includes(body.status)) {
    return c.json({ success: false, error: 'status debe ser available, reserved o sold' }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE units SET status = ?, updated_at = datetime('now') WHERE id = ?`
  )
    .bind(body.status, unitId)
    .run()

  return c.json({ success: true, data: { id: unitId, status: body.status } })
})

// DELETE /api/units/:id
units.delete('/:id', async (c) => {
  const userId = c.get('user').sub
  const unitId = c.req.param('id')

  const existing = await ownedUnit(c.env.DB, unitId, userId)
  if (!existing) return c.json({ success: false, error: 'Unidad no encontrada' }, 404)

  await c.env.DB.prepare(`DELETE FROM units WHERE id = ?`).bind(unitId).run()
  return c.json({ success: true })
})

export default units

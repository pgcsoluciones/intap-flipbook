import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const SECRET = 'test-secret'

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function signJwt(payload = { sub: 'user-1' }) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify({ ...payload, iat: now, exp: now + 86400 }))
  const input = `${header}.${claims}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign({ name: 'HMAC', hash: 'SHA-256' }, key, new TextEncoder().encode(input))
  return `${input}.${base64url(Buffer.from(sig))}`
}

async function loadDynamicMarkersRoute() {
  const dir = await mkdtemp(join(tmpdir(), 'dynamic-marker-clone-test-'))
  const outfile = join(dir, 'dynamic-markers.mjs')
  await build({
    entryPoints: ['apps/api/src/routes/dynamicMarkers.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return {
    router: mod.default,
    buildCloneDynamicMarkerPayload: mod.buildCloneDynamicMarkerPayload,
    clonedDynamicMarkerName: mod.clonedDynamicMarkerName,
    dynamicMarkerCanvasHasElementId: mod.dynamicMarkerCanvasHasElementId,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

const route = await loadDynamicMarkersRoute()
after(() => route.cleanup())

function marker(overrides = {}) {
  return {
    id: 'source-1',
    user_id: 'user-1',
    publication_id: 'pub-1',
    page_id: 'page-1',
    target_object_id: 'source-object',
    target_kind: 'rect',
    status: 'active',
    name: 'Ficha fuente',
    reference: 'REF-1',
    category: 'Categoria',
    description: 'Descripcion',
    price_minor: 1200,
    previous_price_minor: 1500,
    currency: 'DOP',
    availability: 'Disponible',
    promotion_text: 'Oferta',
    accent_color: '#4F46E5',
    badge_text: 'Nuevo',
    promotion_ends_at: '2026-08-10T12:00:00.000Z',
    post_promotion_price_minor: 1300,
    colors_json: JSON.stringify([{ id: 'color-old', name: 'Azul', hex: '#0000FF', available: true }]),
    materials_json: JSON.stringify([{ id: 'mat-old', name: 'Metal', available: true }]),
    sizes_json: JSON.stringify([{ id: 'size-old', label: 'M', value: 'Mediano', available: true }]),
    measurements_json: JSON.stringify([{ id: 'measure-old', label: 'Alto', value: '10', unit: 'cm' }]),
    media_json: JSON.stringify([{ id: 'media-old', type: 'image', url: 'https://cdn.example.test/a.jpg', visibility: 'public' }]),
    actions_json: JSON.stringify({
      contact_whatsapp: { enabled: true, phone: '18095550000', label: 'Comprar', message_template: 'Hola' },
      external_link: { enabled: true, label: 'Ver', url: 'https://example.test' },
      share: { enabled: true, whatsapp: true, facebook: false, x: false, copy_link: true, native: true },
      booking: { enabled: true, label: 'Agendar', appointment_types: ['Visita'], require_date: true, require_time: true },
      offer_cta: { target: 'booking', preset: 'agenda', custom_label: 'Agenda' },
    }),
    custom_fields_json: JSON.stringify([{ id: 'field-old', label: 'SKU', value: 'A1', type: 'text', visibility: 'public' }]),
    booking_calendar_id: 'calendar-1',
    cloned_from_marker_id: null,
    created_at: '2026-08-01 00:00:00',
    updated_at: '2026-08-01 00:00:00',
    ...overrides,
  }
}

function seed(overrides = {}) {
  return {
    publications: [
      { id: 'pub-1', user_id: 'user-1', deleted_at: null },
      { id: 'pub-2', user_id: 'user-2', deleted_at: null },
    ],
    pages: [
      { id: 'page-1', publication_id: 'pub-1', canvas_json: JSON.stringify({ objects: [{ type: 'rect', data: { elementId: 'source-object' } }] }) },
      { id: 'page-2', publication_id: 'pub-1', canvas_json: JSON.stringify({ objects: [{ type: 'group', objects: [{ type: 'rect', data: { elementId: 'target-object' } }] }] }) },
      { id: 'page-foreign', publication_id: 'pub-2', canvas_json: JSON.stringify({ objects: [{ type: 'rect', data: { elementId: 'target-object' } }] }) },
      { id: 'page-malformed', publication_id: 'pub-1', canvas_json: '{"objects": [' },
    ],
    dynamicMarkers: [marker()],
    bookings: [{ id: 'booking-1', marker_id: 'source-1' }],
    leadIntakes: [{ id: 'lead-1', marker_id: 'source-1' }],
    ...overrides,
  }
}

class FakeD1 {
  constructor(data = seed()) {
    this.publications = structuredClone(data.publications)
    this.pages = structuredClone(data.pages)
    this.dynamicMarkers = structuredClone(data.dynamicMarkers)
    this.bookings = structuredClone(data.bookings)
    this.leadIntakes = structuredClone(data.leadIntakes)
    this.writes = []
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = sql.replace(/\s+/g, ' ').trim()
    this.params = []
  }

  bind(...params) {
    this.params = params
    return this
  }

  async first() {
    const sql = this.sql
    if (sql.includes('FROM dynamic_markers dm JOIN publications p')) {
      const [markerId, userId] = this.params
      const row = this.db.dynamicMarkers.find((item) => item.id === markerId)
      const pub = row && this.db.publications.find((item) => item.id === row.publication_id && item.user_id === userId && item.deleted_at == null)
      return row && pub ? structuredClone(row) : null
    }
    if (sql.includes('FROM publications WHERE id = ? AND user_id = ?')) {
      const [publicationId, userId] = this.params
      const pub = this.db.publications.find((item) => item.id === publicationId && item.user_id === userId && item.deleted_at == null)
      return pub ? { id: pub.id } : null
    }
    if (sql.includes('SELECT id, canvas_json FROM pages WHERE id = ? AND publication_id = ?')) {
      const [pageId, publicationId] = this.params
      const page = this.db.pages.find((item) => item.id === pageId && item.publication_id === publicationId)
      return page ? { id: page.id, canvas_json: page.canvas_json } : null
    }
    if (sql.includes('SELECT id FROM dynamic_markers WHERE publication_id = ? AND page_id = ? AND target_object_id = ?')) {
      const [publicationId, pageId, targetObjectId] = this.params
      const row = this.db.dynamicMarkers.find((item) => item.publication_id === publicationId && item.page_id === pageId && item.target_object_id === targetObjectId)
      return row ? { id: row.id } : null
    }
    if (sql.includes('FROM dynamic_markers WHERE id = ? AND user_id = ?')) {
      const [markerId, userId] = this.params
      const row = this.db.dynamicMarkers.find((item) => item.id === markerId && item.user_id === userId)
      return row ? structuredClone(row) : null
    }
    throw new Error(`Unhandled first SQL: ${this.sql}`)
  }

  async run() {
    const sql = this.sql
    if (sql.startsWith('INSERT INTO dynamic_markers')) {
      const [
        id,
        user_id,
        publication_id,
        page_id,
        target_object_id,
        target_kind,
        status,
        name,
        reference,
        category,
        description,
        price_minor,
        previous_price_minor,
        currency,
        availability,
        promotion_text,
        accent_color,
        badge_text,
        promotion_ends_at,
        post_promotion_price_minor,
        colors_json,
        materials_json,
        sizes_json,
        measurements_json,
        media_json,
        actions_json,
        custom_fields_json,
        cloned_from_marker_id,
      ] = this.params
      if (this.db.dynamicMarkers.some((item) => item.publication_id === publication_id && item.page_id === page_id && item.target_object_id === target_object_id)) {
        throw new Error('UNIQUE constraint failed')
      }
      this.db.dynamicMarkers.push({
        id,
        user_id,
        publication_id,
        page_id,
        target_object_id,
        target_kind,
        status,
        name,
        reference,
        category,
        description,
        price_minor,
        previous_price_minor,
        currency,
        availability,
        promotion_text,
        accent_color,
        badge_text,
        promotion_ends_at,
        post_promotion_price_minor,
        colors_json,
        materials_json,
        sizes_json,
        measurements_json,
        media_json,
        actions_json,
        custom_fields_json,
        booking_calendar_id: null,
        cloned_from_marker_id,
        created_at: 'now',
        updated_at: 'now',
      })
      this.db.writes.push('insert-marker')
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('UPDATE dynamic_markers SET name = ?')) {
      const [
        name,
        reference,
        category,
        description,
        price_minor,
        previous_price_minor,
        currency,
        availability,
        promotion_text,
        badge_text,
        promotion_ends_at,
        post_promotion_price_minor,
        accent_color,
        colors_json,
        materials_json,
        sizes_json,
        measurements_json,
        media_json,
        custom_fields_json,
        actions_json,
        cloned_from_marker_id,
        targetId,
        userId,
      ] = this.params
      const target = this.db.dynamicMarkers.find((item) => item.id === targetId && item.user_id === userId && item.status === 'draft')
      if (!target) return { meta: { changes: 0 } }
      Object.assign(target, {
        name,
        reference,
        category,
        description,
        price_minor,
        previous_price_minor,
        currency,
        availability,
        promotion_text,
        badge_text,
        promotion_ends_at,
        post_promotion_price_minor,
        accent_color,
        colors_json,
        materials_json,
        sizes_json,
        measurements_json,
        media_json,
        custom_fields_json,
        actions_json,
        cloned_from_marker_id,
        updated_at: 'now',
      })
      this.db.writes.push('reuse-update')
      return { meta: { changes: 1 } }
    }
    throw new Error(`Unhandled run SQL: ${this.sql}`)
  }
}

async function request(db, path, body, user = { sub: 'user-1' }) {
  const token = await signJwt(user)
  const res = await route.router.request(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { DB: db, JWT_SECRET: SECRET })
  return { status: res.status, body: await res.json() }
}

function cloneBody(overrides = {}) {
  return {
    publication_id: 'pub-1',
    page_id: 'page-2',
    target_object_id: 'target-object',
    target_kind: 'button',
    ...overrides,
  }
}

test('fuente inexistente o ajena devuelve 404', async () => {
  const missing = await request(new FakeD1(), '/missing/clone', cloneBody())
  assert.equal(missing.status, 404)

  const foreign = await request(new FakeD1(), '/source-1/clone', cloneBody(), { sub: 'user-2' })
  assert.equal(foreign.status, 404)
})

test('publicacion ajena devuelve 404', async () => {
  const result = await request(new FakeD1(), '/source-1/clone', cloneBody({ publication_id: 'pub-2', page_id: 'page-foreign' }))
  assert.equal(result.status, 404)
})

test('pagina ajena o que no pertenece a publicacion devuelve 404', async () => {
  const result = await request(new FakeD1(), '/source-1/clone', cloneBody({ page_id: 'page-foreign' }))
  assert.equal(result.status, 404)
})

test('pagina inexistente devuelve 404 y no crea ficha', async () => {
  const db = new FakeD1()
  const result = await request(db, '/source-1/clone', cloneBody({ page_id: 'missing-page' }))
  assert.equal(result.status, 404)
  assert.equal(db.dynamicMarkers.length, 1)
})

test('target_object_id vacio devuelve 400', async () => {
  const result = await request(new FakeD1(), '/source-1/clone', cloneBody({ target_object_id: '  ' }))
  assert.equal(result.status, 400)
})

test('target_object_id inexistente en canvas_json devuelve 400', async () => {
  const result = await request(new FakeD1(), '/source-1/clone', cloneBody({ target_object_id: 'missing-object' }))
  assert.equal(result.status, 400)
})

test('destino que ya tiene ficha directa devuelve 409', async () => {
  const db = new FakeD1(seed({ dynamicMarkers: [marker(), marker({ id: 'existing', page_id: 'page-2', target_object_id: 'target-object' })] }))
  const result = await request(db, '/source-1/clone', cloneBody())
  assert.equal(result.status, 409)
})

test('clonacion crea id nuevo y asigna identidad destino', async () => {
  const db = new FakeD1()
  const result = await request(db, '/source-1/clone', cloneBody())
  assert.equal(result.status, 201)
  assert.notEqual(result.body.data.id, 'source-1')
  assert.equal(result.body.data.publication_id, 'pub-1')
  assert.equal(result.body.data.page_id, 'page-2')
  assert.equal(result.body.data.target_object_id, 'target-object')
  assert.equal(result.body.data.target_kind, 'button')
})

test('clonacion conserva target_kind recibido sin introducir enum nuevo', async () => {
  const result = await request(new FakeD1(), '/source-1/clone', cloneBody({ target_kind: 'group' }))
  assert.equal(result.status, 201)
  assert.equal(result.body.data.target_kind, 'group')
})

test('clonacion asigna cloned_from_marker_id fuente y usa user_id autenticado', async () => {
  const db = new FakeD1()
  const result = await request(db, '/source-1/clone', { ...cloneBody(), user_id: 'attacker' })
  assert.equal(result.status, 201)
  assert.equal(result.body.data.cloned_from_marker_id, 'source-1')
  assert.equal(result.body.data.user_id, 'user-1')
})

test('clonacion no modifica fuente', async () => {
  const db = new FakeD1()
  const before = structuredClone(db.dynamicMarkers.find((item) => item.id === 'source-1'))
  await request(db, '/source-1/clone', cloneBody())
  assert.deepEqual(db.dynamicMarkers.find((item) => item.id === 'source-1'), before)
})

test('clonacion copia datos comerciales y conserva reference repetible', async () => {
  const result = await request(new FakeD1(), '/source-1/clone', cloneBody())
  const data = result.body.data
  assert.equal(data.name, 'Ficha fuente (copia)')
  assert.equal(data.reference, 'REF-1')
  assert.equal(data.category, 'Categoria')
  assert.equal(data.description, 'Descripcion')
  assert.equal(data.price_minor, 1200)
  assert.equal(data.post_promotion_price_minor, 1300)
  assert.equal(data.badge_text, 'Nuevo')
})

test('clonacion regenera IDs internos de media y campos personalizados', async () => {
  const result = await request(new FakeD1(), '/source-1/clone', cloneBody())
  const media = JSON.parse(result.body.data.media_json)
  const fields = JSON.parse(result.body.data.custom_fields_json)
  assert.equal(media.length, 1)
  assert.equal(fields.length, 1)
  assert.notEqual(media[0].id, 'media-old')
  assert.notEqual(fields[0].id, 'field-old')
})

test('clonacion no copia booking_calendar_id y desactiva accion booking dependiente de agenda', async () => {
  const result = await request(new FakeD1(), '/source-1/clone', cloneBody())
  const actions = JSON.parse(result.body.data.actions_json)
  assert.equal(result.body.data.booking_calendar_id, null)
  assert.equal(actions.booking.enabled, false)
  assert.equal(actions.offer_cta.target, '')
})

test('clonacion no copia metricas, solicitudes ni reservas operativas', async () => {
  const db = new FakeD1()
  await request(db, '/source-1/clone', cloneBody())
  assert.deepEqual(db.bookings, [{ id: 'booking-1', marker_id: 'source-1' }])
  assert.deepEqual(db.leadIntakes, [{ id: 'lead-1', marker_id: 'source-1' }])
  assert.equal(db.writes.filter((item) => item !== 'insert-marker').length, 0)
})

test('estado de copia respeta estado real de la fuente', () => {
  for (const status of ['active', 'draft', 'inactive']) {
    const payload = route.buildCloneDynamicMarkerPayload(marker({ status }), {
      id: `clone-${status}`,
      user_id: 'user-1',
      publication_id: 'pub-1',
      page_id: 'page-2',
      target_object_id: 'target-object',
      target_kind: 'button',
    })
    assert.equal(payload.status, status)
  }
})

test('canvas_json malformado no crea la ficha', async () => {
  const db = new FakeD1()
  const result = await request(db, '/source-1/clone', cloneBody({ page_id: 'page-malformed' }))
  assert.equal(result.status, 400)
  assert.equal(db.dynamicMarkers.length, 1)
})

test('helper encuentra data.elementId anidado y rechaza targets vacios', () => {
  assert.equal(route.dynamicMarkerCanvasHasElementId({ objects: [{ type: 'group', objects: [{ data: { elementId: 'x' } }] }] }, 'x'), true)
  assert.equal(route.dynamicMarkerCanvasHasElementId({ objects: [{ data: { elementId: 'x' } }] }, ''), false)
})

test('nombre clonado conserva sufijo dentro del limite', () => {
  const name = route.clonedDynamicMarkerName('A'.repeat(200))
  assert.equal(name.length, 160)
  assert.equal(name.endsWith(' (copia)'), true)
})

test('endpoint reuse conserva comportamiento: actualiza destino draft existente sin crear ficha nueva', async () => {
  const target = marker({
    id: 'target-draft',
    page_id: 'page-2',
    target_object_id: 'target-object',
    status: 'draft',
    name: 'Destino',
    reference: 'OLD',
    booking_calendar_id: null,
    actions_json: '{}',
  })
  const db = new FakeD1(seed({ dynamicMarkers: [marker(), target] }))
  const result = await request(db, '/source-1/reuse', {
    target_marker_id: 'target-draft',
    name: 'Destino reutilizado',
    reference: 'NEW',
  })
  assert.equal(result.status, 200)
  assert.equal(db.dynamicMarkers.length, 2)
  assert.equal(result.body.data.id, 'target-draft')
  assert.equal(result.body.data.page_id, 'page-2')
  assert.equal(result.body.data.target_object_id, 'target-object')
  assert.equal(result.body.data.status, 'draft')
  assert.equal(result.body.data.cloned_from_marker_id, 'source-1')
})

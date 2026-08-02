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
  const dir = await mkdtemp(join(tmpdir(), 'dynamic-marker-independent-test-'))
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
    buildIndependentDynamicMarkerPayload: mod.buildIndependentDynamicMarkerPayload,
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
    target_object_id: 'object-1',
    target_kind: 'button',
    status: 'draft',
    name: 'Fuente',
    reference: 'REF-1',
    category: null,
    description: null,
    price_minor: null,
    previous_price_minor: null,
    currency: null,
    availability: null,
    promotion_text: null,
    accent_color: '#F59E0B',
    badge_text: null,
    promotion_ends_at: null,
    post_promotion_price_minor: null,
    colors_json: '[]',
    materials_json: '[]',
    sizes_json: '[]',
    measurements_json: '[]',
    media_json: '[]',
    actions_json: '{}',
    custom_fields_json: '[]',
    booking_calendar_id: null,
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
      { id: 'page-1', publication_id: 'pub-1', canvas_json: JSON.stringify({ objects: [{ type: 'rect', data: { elementId: 'object-1' } }] }) },
      { id: 'page-2', publication_id: 'pub-1', canvas_json: JSON.stringify({ objects: [{ type: 'rect', data: { elementId: 'object-2' } }] }) },
    ],
    dynamicMarkers: [marker()],
    ...overrides,
  }
}

class FakeD1 {
  constructor(data = seed()) {
    this.publications = structuredClone(data.publications)
    this.pages = structuredClone(data.pages)
    this.dynamicMarkers = structuredClone(data.dynamicMarkers)
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
    if (sql.includes('SELECT id FROM pages WHERE id = ? AND publication_id = ?')) {
      const [pageId, publicationId] = this.params
      const page = this.db.pages.find((item) => item.id === pageId && item.publication_id === publicationId)
      return page ? { id: page.id } : null
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
    if (sql.includes('SELECT * FROM dynamic_markers WHERE id = ?')) {
      const [markerId] = this.params
      const row = this.db.dynamicMarkers.find((item) => item.id === markerId)
      return row ? structuredClone(row) : null
    }
    throw new Error(`Unhandled first SQL: ${this.sql}`)
  }

  async all() {
    const sql = this.sql
    if (sql.includes('FROM pages pg JOIN publications p')) {
      const [userId] = this.params
      return {
        results: this.db.pages
          .filter((page) => this.db.publications.some((pub) => pub.id === page.publication_id && pub.user_id === userId && pub.deleted_at == null))
          .map((page) => {
            const pub = this.db.publications.find((item) => item.id === page.publication_id)
            return {
              publication_id: page.publication_id,
              publication_name: pub?.title ?? null,
              public_slug: pub?.public_slug ?? null,
              page_id: page.id,
              page_number: page.page_number ?? null,
              canvas_json: page.canvas_json,
            }
          }),
      }
    }
    throw new Error(`Unhandled all SQL: ${this.sql}`)
  }

  async run() {
    const sql = this.sql
    if (sql.startsWith('INSERT INTO dynamic_markers') && sql.includes('NULL, NULL, NULL')) {
      const [
        id,
        user_id,
        publication_id,
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
      ] = this.params
      this.db.dynamicMarkers.push({
        id,
        user_id,
        publication_id,
        page_id: null,
        target_object_id: null,
        target_kind: null,
        status: 'draft',
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
        cloned_from_marker_id: null,
        created_at: 'now',
        updated_at: 'now',
      })
      this.db.writes.push('insert-independent')
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('INSERT INTO dynamic_markers')) {
      const [id, user_id, publication_id, page_id, target_object_id, target_kind] = this.params
      if (this.db.dynamicMarkers.some((item) => item.publication_id === publication_id && item.page_id === page_id && item.target_object_id === target_object_id)) {
        throw new Error('UNIQUE constraint failed')
      }
      this.db.dynamicMarkers.push(marker({
        id,
        user_id,
        publication_id,
        page_id,
        target_object_id,
        target_kind,
        status: 'draft',
        name: null,
      }))
      this.db.writes.push('insert-linked')
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('UPDATE dynamic_markers SET')) {
      const markerId = this.params[this.params.length - 1]
      const row = this.db.dynamicMarkers.find((item) => item.id === markerId)
      if (!row) return { meta: { changes: 0 } }
      if (sql.includes('name = ?')) row.name = this.params[0]
      row.updated_at = 'now'
      this.db.writes.push('update-marker')
      return { meta: { changes: 1 } }
    }
    throw new Error(`Unhandled run SQL: ${this.sql}`)
  }
}

async function request(db, path, { method = 'POST', body = independentBody(), user = { sub: 'user-1' }, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth) headers.Authorization = `Bearer ${await signJwt(user)}`
  const init = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await route.router.request(path, init, { DB: db, JWT_SECRET: SECRET })
  return { status: res.status, body: await res.json() }
}

function independentBody(overrides = {}) {
  return {
    publication_id: 'pub-1',
    name: '  Ficha independiente  ',
    reference: 'REF-1',
    category: 'Categoria',
    description: 'Descripcion',
    price_minor: 1200,
    previous_price_minor: 1500,
    post_promotion_price_minor: 1100,
    currency: 'dop',
    availability: 'Disponible',
    promotion_text: 'Oferta',
    badge_text: 'Nuevo',
    promotion_ends_at: '2026-08-10T12:00:00.000Z',
    accent_color: '#4f46e5',
    colors_json: [{ id: 'color-1', name: 'Azul', hex: '#0000FF', available: true }],
    materials_json: [{ id: 'material-1', name: 'Metal' }],
    sizes_json: [{ id: 'size-1', label: 'M', value: 'Mediano' }],
    measurements_json: [{ id: 'measure-1', label: 'Alto', value: '10', unit: 'cm' }],
    media_json: [{ id: 'media-1', type: 'image', url: 'https://cdn.example.test/a.jpg', visibility: 'public' }],
    custom_fields_json: [{ id: 'field-1', label: 'SKU', value: 'A1', type: 'text', visibility: 'public' }],
    actions_json: {
      booking: { enabled: true, label: 'Agendar', appointment_types: ['Visita'], require_date: true, require_time: true },
      offer_cta: { target: 'booking', preset: 'agenda', custom_label: 'Agenda' },
      share: { enabled: true, whatsapp: true, facebook: false, x: false, copy_link: true, native: true },
    },
    ...overrides,
  }
}

test('creacion independiente exige autenticacion', async () => {
  const result = await request(new FakeD1(), '/independent', { auth: false })
  assert.equal(result.status, 401)
})

test('publication_id ausente devuelve 400', async () => {
  const result = await request(new FakeD1(), '/independent', { body: independentBody({ publication_id: ' ' }) })
  assert.equal(result.status, 400)
})

test('publicacion inexistente o ajena devuelve 404', async () => {
  const missing = await request(new FakeD1(), '/independent', { body: independentBody({ publication_id: 'missing' }) })
  assert.equal(missing.status, 404)

  const foreign = await request(new FakeD1(), '/independent', { body: independentBody({ publication_id: 'pub-2' }) })
  assert.equal(foreign.status, 404)
})

test('name vacio devuelve 400', async () => {
  const result = await request(new FakeD1(), '/independent', { body: independentBody({ name: '  ' }) })
  assert.equal(result.status, 400)
})

test('crea ficha independiente draft con identidad controlada por servidor', async () => {
  const db = new FakeD1()
  const result = await request(db, '/independent', {
    body: independentBody({
      user_id: 'attacker',
      status: 'active',
      page_id: 'page-1',
      target_object_id: 'object-1',
      target_kind: 'button',
      booking_calendar_id: 'calendar-1',
      cloned_from_marker_id: 'source-1',
      usage_count: 99,
      created_at: '2000-01-01',
    }),
  })
  assert.equal(result.status, 201)
  assert.notEqual(result.body.data.id, 'source-1')
  assert.equal(result.body.data.user_id, 'user-1')
  assert.equal(result.body.data.publication_id, 'pub-1')
  assert.equal(result.body.data.page_id, null)
  assert.equal(result.body.data.target_object_id, null)
  assert.equal(result.body.data.target_kind, null)
  assert.equal(result.body.data.status, 'draft')
  assert.equal(result.body.data.booking_calendar_id, null)
  assert.equal(result.body.data.cloned_from_marker_id, null)
  assert.equal(result.body.data.usage_count, 0)
  assert.equal(result.body.data.is_in_use, false)
})

test('normaliza campos comerciales permitidos y referencias repetidas', async () => {
  const db = new FakeD1()
  const first = await request(db, '/independent')
  const second = await request(db, '/independent', { body: independentBody({ name: 'Segunda ficha' }) })
  assert.equal(first.status, 201)
  assert.equal(second.status, 201)
  const data = first.body.data
  assert.equal(data.name, 'Ficha independiente')
  assert.equal(data.reference, 'REF-1')
  assert.equal(data.category, 'Categoria')
  assert.equal(data.description, 'Descripcion')
  assert.equal(data.price_minor, 1200)
  assert.equal(data.previous_price_minor, 1500)
  assert.equal(data.post_promotion_price_minor, 1100)
  assert.equal(data.currency, 'DOP')
  assert.equal(data.accent_color, '#4F46E5')
  assert.equal(JSON.parse(data.colors_json)[0].id, 'color-1')
  assert.equal(JSON.parse(data.media_json)[0].id, 'media-1')
  assert.equal(JSON.parse(data.custom_fields_json)[0].id, 'field-1')
  assert.equal(second.body.data.reference, 'REF-1')
})

test('sanea accion booking cuando no hay Agenda vinculada', async () => {
  const result = await request(new FakeD1(), '/independent')
  const actions = JSON.parse(result.body.data.actions_json)
  assert.equal(actions.booking.enabled, false)
  assert.equal(actions.offer_cta.target, '')
  assert.equal(result.body.data.booking_calendar_id, null)
})

test('helper de payload independiente fuerza estado y vinculos seguros', () => {
  const payload = route.buildIndependentDynamicMarkerPayload(
    independentBody({ status: 'active', page_id: 'page-1', target_object_id: 'object-1' }),
    { id: 'new-id', user_id: 'user-1', publication_id: 'pub-1' },
  )
  assert.equal(payload.id, 'new-id')
  assert.equal(payload.status, 'draft')
  assert.equal(payload.page_id, null)
  assert.equal(payload.target_object_id, null)
  assert.equal(payload.booking_calendar_id, null)
  assert.equal(payload.cloned_from_marker_id, null)
})

test('creacion vinculada existente conserva page_id y target_object_id requeridos', async () => {
  const db = new FakeD1()
  const missingTarget = await request(db, '/', {
    body: { publication_id: 'pub-1', page_id: 'page-1', target_object_id: ' ' },
  })
  assert.equal(missingTarget.status, 400)

  const created = await request(db, '/', {
    body: { publication_id: 'pub-1', page_id: 'page-2', target_object_id: 'object-2', target_kind: 'button' },
  })
  assert.equal(created.status, 201)
  assert.equal(created.body.data.page_id, 'page-2')
  assert.equal(created.body.data.target_object_id, 'object-2')
})

test('update puede editar una ficha independiente', async () => {
  const db = new FakeD1()
  const created = await request(db, '/independent')
  const updated = await request(db, `/${created.body.data.id}`, {
    method: 'PUT',
    body: { name: 'Nombre editado' },
  })
  assert.equal(updated.status, 200)
  assert.equal(updated.body.data.name, 'Nombre editado')
  assert.equal(updated.body.data.page_id, null)
  assert.equal(updated.body.data.target_object_id, null)
})

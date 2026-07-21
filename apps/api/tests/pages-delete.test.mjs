import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
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

async function signJwt(payload) {
  const now = Math.floor(Date.now() / 1000)
  const body = { ...payload, iat: now, exp: now + 86400 }
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify(body))
  const input = `${header}.${claims}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    { name: 'HMAC', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(input),
  )
  return `${input}.${base64url(Buffer.from(sig))}`
}

async function loadPagesRouter() {
  const dir = await mkdtemp(join(tmpdir(), 'pages-route-test-'))
  const outfile = join(dir, 'pages.mjs')
  await build({
    entryPoints: ['apps/api/src/routes/pages.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return {
    pages: mod.default,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

function makeRow(overrides) {
  return {
    id: '',
    publication_id: 'pub-1',
    page_id: null,
    page_number: null,
    user_id: 'user-1',
    created_at: '2026-01-01 00:00:00',
    ...overrides,
  }
}

class FakeD1 {
  constructor(seed = {}) {
    this.publications = seed.publications ?? [makeRow({ id: 'pub-1' })]
    this.pages = seed.pages ?? []
    this.dynamicMarkers = seed.dynamicMarkers ?? []
    this.bookings = seed.bookings ?? []
    this.leadIntakes = seed.leadIntakes ?? []
    this.units = seed.units ?? []
    this.availableTables = new Set(seed.availableTables ?? [
      'units',
      'appointment_calendar_bookings',
      'lead_intakes',
    ])
    this.failBatch = seed.failBatch ?? null
    this.batchCount = 0
    this.runCount = 0
    this.writes = []
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  async batch(statements) {
    this.batchCount += 1
    if (this.failBatch) throw this.failBatch
    const snapshot = {
      publications: structuredClone(this.publications),
      pages: structuredClone(this.pages),
      dynamicMarkers: structuredClone(this.dynamicMarkers),
      bookings: structuredClone(this.bookings),
      leadIntakes: structuredClone(this.leadIntakes),
      units: structuredClone(this.units),
      writes: structuredClone(this.writes),
    }
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    } catch (error) {
      Object.assign(this, snapshot)
      throw error
    }
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
    if (sql.includes('FROM pages pg JOIN publications pub')) {
      const [pageId, userId] = this.params
      const page = this.db.pages.find((item) => item.id === pageId)
      const pub = page && this.db.publications.find((item) => item.id === page.publication_id && item.user_id === userId)
      return page && pub ? { id: page.id, publication_id: page.publication_id } : null
    }
    if (sql.includes('FROM sqlite_master')) {
      const [tableName] = this.params
      return this.db.availableTables.has(tableName) ? { found: 1 } : null
    }
    if (sql.includes('COUNT(DISTINCT history.id) AS count')) {
      const [pageId] = this.params
      const markerIds = new Set(this.db.dynamicMarkers.filter((item) => item.page_id === pageId).map((item) => item.id))
      if (sql.includes('appointment_calendar_bookings history')) {
        return { count: this.db.bookings.filter((item) => markerIds.has(item.marker_id)).length }
      }
      if (sql.includes('lead_intakes history')) {
        return { count: this.db.leadIntakes.filter((item) => markerIds.has(item.marker_id)).length }
      }
    }
    throw new Error(`Unhandled first SQL: ${this.sql}`)
  }

  async all() {
    if (this.sql.includes('FROM pages') && this.sql.includes('AND id <> ?')) {
      const [publicationId, pageId] = this.params
      const results = this.db.pages
        .filter((item) => item.publication_id === publicationId && item.id !== pageId)
        .sort((a, b) =>
          (a.page_number - b.page_number)
          || String(a.created_at).localeCompare(String(b.created_at))
          || String(a.id).localeCompare(String(b.id)),
        )
        .map((item) => ({ id: item.id }))
      return { results }
    }
    throw new Error(`Unhandled all SQL: ${this.sql}`)
  }

  async run() {
    this.db.runCount += 1
    const sql = this.sql
    if (sql.startsWith('UPDATE units SET page_id = NULL')) {
      if (!this.db.availableTables.has('units')) throw new Error('no such table: units')
      const [pageId] = this.params
      this.db.units = this.db.units.map((item) => item.page_id === pageId ? { ...item, page_id: null } : item)
      this.db.writes.push('units')
      return { success: true }
    }
    if (sql.startsWith('UPDATE dynamic_markers SET cloned_from_marker_id = NULL')) {
      const [pageId] = this.params
      const deletedMarkerIds = new Set(this.db.dynamicMarkers.filter((item) => item.page_id === pageId).map((item) => item.id))
      this.db.dynamicMarkers = this.db.dynamicMarkers.map((item) =>
        deletedMarkerIds.has(item.cloned_from_marker_id) ? { ...item, cloned_from_marker_id: null } : item,
      )
      this.db.writes.push('clones')
      return { success: true }
    }
    if (sql.startsWith('DELETE FROM dynamic_markers WHERE page_id = ?')) {
      const [pageId] = this.params
      this.db.dynamicMarkers = this.db.dynamicMarkers.filter((item) => item.page_id !== pageId)
      this.db.writes.push('markers')
      return { success: true }
    }
    if (sql.startsWith('DELETE FROM pages WHERE id = ?')) {
      const [pageId] = this.params
      if (this.db.dynamicMarkers.some((item) => item.page_id === pageId)) throw new Error('FOREIGN KEY constraint failed')
      this.db.pages = this.db.pages.filter((item) => item.id !== pageId)
      this.db.writes.push('pages')
      return { success: true }
    }
    if (sql.startsWith('UPDATE pages SET page_number = ? WHERE id = ?')) {
      const [pageNumber, pageId] = this.params
      this.db.pages = this.db.pages.map((item) => item.id === pageId ? { ...item, page_number: pageNumber } : item)
      this.db.writes.push(`page:${pageId}:${pageNumber}`)
      return { success: true }
    }
    if (sql.startsWith('UPDATE publications SET updated_at = datetime')) {
      const [publicationId] = this.params
      this.db.publications = this.db.publications.map((item) => item.id === publicationId ? { ...item, updated_at: 'now' } : item)
      this.db.writes.push('publications')
      return { success: true }
    }
    throw new Error(`Unhandled run SQL: ${this.sql}`)
  }
}

async function deletePage(db, pageId = 'page-2') {
  const { pages, cleanup } = await loadPagesRouter()
  try {
    const token = await signJwt({ sub: 'user-1', email: 'user@example.test' })
    const response = await pages.request(`/pages/${pageId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }, {
      DB: db,
      JWT_SECRET: SECRET,
    })
    return {
      status: response.status,
      body: await response.json(),
    }
  } finally {
    await cleanup()
  }
}

function baseSeed() {
  return {
    publications: [makeRow({ id: 'pub-1', user_id: 'user-1', updated_at: null })],
    pages: [
      makeRow({ id: 'page-1', page_number: 1 }),
      makeRow({ id: 'page-2', page_number: 2 }),
      makeRow({ id: 'page-3', page_number: 3 }),
      makeRow({ id: 'page-4', page_number: 4 }),
    ],
  }
}

test('DELETE page without markers removes page and resequences remaining pages', async () => {
  const db = new FakeD1(baseSeed())
  const result = await deletePage(db)

  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { success: true, data: { deleted: true } })
  assert.deepEqual(db.pages.map((page) => [page.id, page.page_number]), [
    ['page-1', 1],
    ['page-3', 2],
    ['page-4', 3],
  ])
  assert.equal(db.batchCount, 1)
})

test('DELETE page with markers but no history removes markers and page', async () => {
  const db = new FakeD1({
    ...baseSeed(),
    dynamicMarkers: [makeRow({ id: 'marker-1', page_id: 'page-2' })],
  })
  const result = await deletePage(db)

  assert.equal(result.status, 200)
  assert.equal(db.dynamicMarkers.some((marker) => marker.id === 'marker-1'), false)
  assert.equal(db.pages.some((page) => page.id === 'page-2'), false)
})

test('DELETE page with unit keeps unit and clears page_id', async () => {
  const db = new FakeD1({
    ...baseSeed(),
    units: [makeRow({ id: 'unit-1', page_id: 'page-2' })],
  })
  const result = await deletePage(db)

  assert.equal(result.status, 200)
  assert.deepEqual(db.units, [makeRow({ id: 'unit-1', page_id: null })])
})

test('DELETE page clears cloned_from_marker_id references to deleted markers', async () => {
  const db = new FakeD1({
    ...baseSeed(),
    dynamicMarkers: [
      makeRow({ id: 'marker-1', page_id: 'page-2' }),
      makeRow({ id: 'marker-2', page_id: 'page-3', cloned_from_marker_id: 'marker-1' }),
    ],
  })
  const result = await deletePage(db)

  assert.equal(result.status, 200)
  assert.equal(db.dynamicMarkers.find((marker) => marker.id === 'marker-2').cloned_from_marker_id, null)
})

test('DELETE page with appointment bookings returns 409 and preserves records', async () => {
  const seed = {
    ...baseSeed(),
    dynamicMarkers: [makeRow({ id: 'marker-1', page_id: 'page-2' })],
    bookings: [makeRow({ id: 'booking-1', marker_id: 'marker-1' })],
  }
  const db = new FakeD1(seed)
  const result = await deletePage(db)

  assert.equal(result.status, 409)
  assert.deepEqual(result.body, {
    success: false,
    code: 'PAGE_HAS_HISTORY',
    error: 'Esta página tiene solicitudes o reservas vinculadas y no puede eliminarse.',
  })
  assert.equal(db.pages.length, 4)
  assert.equal(db.dynamicMarkers.length, 1)
  assert.equal(db.batchCount, 0)
})

test('DELETE page with lead intakes returns 409 and preserves records', async () => {
  const seed = {
    ...baseSeed(),
    dynamicMarkers: [makeRow({ id: 'marker-1', page_id: 'page-2' })],
    leadIntakes: [makeRow({ id: 'lead-1', marker_id: 'marker-1' })],
  }
  const db = new FakeD1(seed)
  const result = await deletePage(db)

  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'PAGE_HAS_HISTORY')
  assert.equal(db.pages.length, 4)
  assert.equal(db.dynamicMarkers.length, 1)
  assert.equal(db.batchCount, 0)
})

test('DELETE succeeds when optional units, bookings and leads tables are not installed', async () => {
  const db = new FakeD1({
    ...baseSeed(),
    dynamicMarkers: [makeRow({ id: 'marker-1', page_id: 'page-2' })],
    availableTables: [],
  })
  const result = await deletePage(db)

  assert.equal(result.status, 200)
  assert.equal(db.pages.some((page) => page.id === 'page-2'), false)
  assert.equal(db.dynamicMarkers.some((marker) => marker.id === 'marker-1'), false)
  assert.equal(db.writes.includes('units'), false)
})

test('DELETE still blocks lead history when bookings table is not installed', async () => {
  const db = new FakeD1({
    ...baseSeed(),
    dynamicMarkers: [makeRow({ id: 'marker-1', page_id: 'page-2' })],
    leadIntakes: [makeRow({ id: 'lead-1', marker_id: 'marker-1' })],
    availableTables: ['lead_intakes'],
  })
  const result = await deletePage(db)

  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'PAGE_HAS_HISTORY')
  assert.equal(db.pages.some((page) => page.id === 'page-2'), true)
})

test('DELETE unexpected SQL failure returns generic 500 without exposing SQL', async () => {
  const db = new FakeD1({
    ...baseSeed(),
    failBatch: new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed'),
  })
  const result = await deletePage(db)

  assert.equal(result.status, 500)
  assert.deepEqual(result.body, {
    success: false,
    code: 'PAGE_DELETE_FAILED',
    error: 'No se pudo eliminar la página.',
  })
  assert.equal(JSON.stringify(result.body).includes('SQLITE_CONSTRAINT'), false)
  assert.equal(JSON.stringify(result.body).includes('FOREIGN KEY'), false)
})

test('DELETE race with new history returns 409 after failed batch', async () => {
  const db = new FakeD1({
    ...baseSeed(),
    dynamicMarkers: [makeRow({ id: 'marker-1', page_id: 'page-2' })],
    failBatch: new Error('FOREIGN KEY constraint failed'),
  })
  const originalBatch = db.batch.bind(db)
  db.batch = async (statements) => {
    db.bookings.push(makeRow({ id: 'booking-1', marker_id: 'marker-1' }))
    return originalBatch(statements)
  }

  const result = await deletePage(db)

  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'PAGE_HAS_HISTORY')
  assert.equal(db.pages.length, 4)
  assert.equal(db.dynamicMarkers.length, 1)
})


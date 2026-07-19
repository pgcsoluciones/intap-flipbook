import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const SECRET = 'test-secret'

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signJwt(payload) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify({ ...payload, iat: now, exp: now + 86400 }))
  const input = `${header}.${claims}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'HMAC', hash: 'SHA-256' }, key, new TextEncoder().encode(input))
  return `${input}.${base64url(Buffer.from(sig))}`
}

async function loadPagesRouter() {
  const dir = await mkdtemp(join(tmpdir(), 'pages-batch-test-'))
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

class FakeD1 {
  constructor(seed = {}) {
    this.users = seed.users ?? [{ id: 'user-1', plan_id: 'free', custom_max_pages: null }]
    this.plans = seed.plans ?? [{ id: 'free', name: 'Free', max_pages_per_pub: 20 }]
    this.publications = seed.publications ?? [
      { id: 'pub-1', user_id: 'user-1' },
      { id: 'other-pub', user_id: 'user-2' },
    ]
    this.pages = seed.pages ?? []
    this.failImageUrl = seed.failImageUrl ?? ''
    this.putUpdates = 0
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  async batch(statements) {
    const snapshot = structuredClone(this.pages)
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    } catch (error) {
      this.pages = snapshot
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
    if (this.sql.startsWith('SELECT id FROM publications')) {
      const [publicationId, userId] = this.params
      return this.db.publications.find((pub) => pub.id === publicationId && pub.user_id === userId) ?? null
    }
    if (this.sql.startsWith('SELECT id, plan_id')) {
      const [userId] = this.params
      return this.db.users.find((user) => user.id === userId) ?? null
    }
    if (this.sql.startsWith('SELECT * FROM plans')) {
      const [planId] = this.params
      return this.db.plans.find((plan) => plan.id === planId) ?? null
    }
    if (this.sql.startsWith('SELECT COUNT(*) as count FROM pages')) {
      const [publicationId] = this.params
      return { count: this.db.pages.filter((page) => page.publication_id === publicationId).length }
    }
    throw new Error(`Unhandled first SQL: ${this.sql}`)
  }

  async all() {
    if (this.sql.startsWith('SELECT * FROM pages WHERE publication_id = ? AND id IN')) {
      const [publicationId, ...ids] = this.params
      const idSet = new Set(ids)
      const results = this.db.pages
        .filter((page) => page.publication_id === publicationId && idSet.has(page.id))
        .sort((a, b) => a.page_number - b.page_number)
      return { results }
    }
    throw new Error(`Unhandled all SQL: ${this.sql}`)
  }

  async run() {
    if (this.sql.startsWith('INSERT INTO pages')) {
      const [id, publication_id, page_number, image_url, size_bytes, title, description, price, canvas_json] = this.params
      if (image_url === this.db.failImageUrl) throw new Error('simulated insert failure')
      this.db.pages.push({
        id,
        publication_id,
        page_number,
        image_url,
        size_bytes,
        title,
        description,
        price,
        canvas_json,
        created_at: '2026-07-19 00:00:00',
      })
      return { success: true }
    }
    if (this.sql.startsWith('UPDATE publications SET updated_at')) return { success: true }
    if (this.sql.startsWith('UPDATE pages')) {
      this.db.putUpdates += 1
      return { success: true }
    }
    throw new Error(`Unhandled run SQL: ${this.sql}`)
  }
}

async function batchCreate(db, publicationId, pagesPayload) {
  const { pages, cleanup } = await loadPagesRouter()
  try {
    const token = await signJwt({ sub: 'user-1', email: 'user@example.test' })
    const response = await pages.request(`/publications/${publicationId}/pages/batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pages: pagesPayload }),
    }, {
      DB: db,
      JWT_SECRET: SECRET,
    })
    return { status: response.status, body: await response.json() }
  } finally {
    await cleanup()
  }
}

test('crear 2 paginas completas devuelve 2 IDs distintos con image_url y canvas_json', async () => {
  const db = new FakeD1()
  const response = await batchCreate(db, 'pub-1', [
    { image_url: 'a.jpg', canvas_json: { version: '5.3.0', objects: [] } },
    { image_url: 'b.jpg', canvas_json: { version: '5.3.0', objects: [] } },
  ])

  assert.equal(response.status, 201)
  assert.equal(response.body.success, true)
  assert.equal(response.body.pages.length, 2)
  assert.notEqual(response.body.pages[0].id, response.body.pages[1].id)
  assert.deepEqual(response.body.pages.map((page) => page.image_url), ['a.jpg', 'b.jpg'])
  assert.deepEqual(response.body.pages.map((page) => JSON.parse(page.canvas_json).objects), [[], []])
  assert.deepEqual(response.body.pages.map((page) => page.page_number), [1, 2])
})

test('publicacion ajena es rechazada', async () => {
  const db = new FakeD1()
  const response = await batchCreate(db, 'other-pub', [
    { image_url: 'a.jpg', canvas_json: { version: '5.3.0', objects: [] } },
  ])

  assert.equal(response.status, 404)
  assert.equal(db.pages.length, 0)
})

test('error en el lote no deja paginas vacias', async () => {
  const db = new FakeD1({ failImageUrl: 'fail.jpg' })
  const response = await batchCreate(db, 'pub-1', [
    { image_url: 'ok.jpg', canvas_json: { version: '5.3.0', objects: [] } },
    { image_url: 'fail.jpg', canvas_json: { version: '5.3.0', objects: [] } },
  ])

  assert.equal(response.status, 500)
  assert.equal(db.pages.length, 0)
})

test('no se necesita PUT posterior', async () => {
  const db = new FakeD1()
  await batchCreate(db, 'pub-1', [
    { image_url: 'a.jpg', canvas_json: { version: '5.3.0', objects: [] } },
  ])

  assert.equal(db.putUpdates, 0)
  assert.equal(db.pages.length, 1)
  assert.ok(db.pages[0].canvas_json)
})

test('repetir la misma imagen puede crear otra pagina', async () => {
  const db = new FakeD1()
  const response = await batchCreate(db, 'pub-1', [
    { image_url: 'same.jpg', canvas_json: { version: '5.3.0', objects: [] } },
    { image_url: 'same.jpg', canvas_json: { version: '5.3.0', objects: [] } },
  ])

  assert.equal(response.status, 201)
  assert.equal(response.body.pages.length, 2)
  assert.notEqual(response.body.pages[0].id, response.body.pages[1].id)
  assert.deepEqual(response.body.pages.map((page) => page.image_url), ['same.jpg', 'same.jpg'])
})

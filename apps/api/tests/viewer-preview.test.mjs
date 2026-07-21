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

async function loadWorker() {
  const dir = await mkdtemp(join(tmpdir(), 'viewer-preview-test-'))
  const outfile = join(dir, 'worker.mjs')
  await build({
    entryPoints: ['apps/api/src/index.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { worker: mod.default, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

function env(overrides = {}) {
  return {
    APP_ENV: 'preview',
    CORS_ORIGIN: 'https://studio.flip.intaprd.com,https://flip.intaprd.com',
    ALLOWED_WRITE_ORIGINS: 'https://studio.flip.intaprd.com,https://flip.intaprd.com',
    JWT_EXPIRY_DAYS: '7',
    JWT_SECRET: SECRET,
    R2_PUBLIC_BASE_URL: 'https://media.example.test',
    ...overrides,
  }
}

class FakeD1 {
  constructor() {
    this.publications = [{
      id: 'pub-1',
      user_id: 'user-1',
      public_slug: 'catalogo-demo',
      status: 'draft',
      deleted_at: null,
      title: 'Catalogo demo',
      description: null,
      cover_image_url: null,
      sound_enabled: 1,
      project_phone: null,
      project_whatsapp: null,
      project_location: null,
      project_address: null,
      project_developer: null,
      project_website: null,
      plan_id: 'pro',
      watermark_override: 'force_hide',
      watermark_tenant: null,
    }]
    this.pages = [
      { id: 'page-1', publication_id: 'pub-1', page_number: 1, image_url: 'https://media.example.test/original-1.jpg', title: null, description: null, price: null, canvas_json: '{}', cover_json: null },
      { id: 'page-2', publication_id: 'pub-1', page_number: 2, image_url: 'https://media.example.test/original-2.jpg', title: null, description: null, price: null, canvas_json: '{}', cover_json: null },
    ]
    this.assets = [
      { publication_id: 'pub-1', public_url: 'https://media.example.test/original-1.jpg', optimized_url: 'https://media.example.test/display-1.webp', optimized_width: 1200, optimized_height: 1697, deleted_at: null },
    ]
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
    if (this.sql.startsWith('SELECT id, user_id, public_slug FROM publications')) {
      const [id, userId] = this.params
      return this.db.publications.find((pub) => pub.id === id && pub.user_id === userId && pub.deleted_at == null) ?? null
    }
    if (this.sql.startsWith('SELECT COUNT(*) as count FROM pages')) {
      const [publicationId] = this.params
      return { count: this.db.pages.filter((page) => page.publication_id === publicationId).length }
    }
    if (this.sql.startsWith('SELECT p.id, p.title, p.description')) {
      const [id, userId] = this.params
      return this.db.publications.find((pub) => pub.id === id && pub.user_id === userId && pub.deleted_at == null) ?? null
    }
    if (this.sql.startsWith('SELECT text, link_url, position, opacity FROM watermark_config')) {
      return null
    }
    throw new Error(`Unhandled first SQL: ${this.sql}`)
  }

  async all() {
    if (this.sql.startsWith('SELECT pg.id, pg.page_number, pg.image_url')) {
      const [publicationId] = this.params
      return {
        results: this.db.pages
          .filter((page) => page.publication_id === publicationId)
          .sort((a, b) => a.page_number - b.page_number)
          .map((page) => {
            const asset = this.db.assets.find((item) => item.publication_id === page.publication_id && item.public_url === page.image_url && item.deleted_at == null)
            return { ...page, optimized_url: asset?.optimized_url ?? null, optimized_width: asset?.optimized_width ?? null, optimized_height: asset?.optimized_height ?? null }
          }),
      }
    }
    if (this.sql.startsWith('SELECT dm.*, pg.page_number')) {
      return { results: [] }
    }
    throw new Error(`Unhandled all SQL: ${this.sql}`)
  }
}

test('emite token preview solo en APP_ENV preview y no publica', async () => {
  const { worker, cleanup } = await loadWorker()
  try {
    const token = await signJwt({ sub: 'user-1', email: 'user@example.test' })
    const response = await worker.fetch(new Request('https://api.example.test/api/publications/pub-1/preview-access', {
      headers: { Authorization: `Bearer ${token}` },
    }), { ...env(), DB: new FakeD1() }, {})
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.success, true)
    assert.equal(body.data.public_slug, 'catalogo-demo')
    assert.equal(body.data.expires_in_seconds, 3600)

    const production = await worker.fetch(new Request('https://api.example.test/api/publications/pub-1/preview-access', {
      headers: { Authorization: `Bearer ${token}` },
    }), { ...env({ APP_ENV: 'production' }), DB: new FakeD1() }, {})
    assert.equal(production.status, 404)
  } finally {
    await cleanup()
  }
})

test('view preview token abre borrador y devuelve optimized_url sin exigir published', async () => {
  const { worker, cleanup } = await loadWorker()
  try {
    const authToken = await signJwt({ sub: 'user-1', email: 'user@example.test' })
    const access = await worker.fetch(new Request('https://api.example.test/api/publications/pub-1/preview-access', {
      headers: { Authorization: `Bearer ${authToken}` },
    }), { ...env(), DB: new FakeD1() }, {})
    const accessBody = await access.json()

    const response = await worker.fetch(new Request(`https://api.example.test/view/preview/${accessBody.data.token}`), {
      ...env(),
      DB: new FakeD1(),
    }, {})
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.success, true)
    assert.equal(body.data.id, 'pub-1')
    assert.equal(body.data.pages[0].image_url, 'https://media.example.test/original-1.jpg')
    assert.equal(body.data.pages[0].optimized_url, 'https://media.example.test/display-1.webp')
    assert.equal(body.data.pages[1].optimized_url, null)
  } finally {
    await cleanup()
  }
})

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadWorker() {
  const dir = await mkdtemp(join(tmpdir(), 'cors-preview-test-'))
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
  return {
    worker: mod.default,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

function env(overrides = {}) {
  return {
    APP_ENV: 'preview',
    CORS_ORIGIN: 'https://studio.flip.intaprd.com,https://flip.intaprd.com',
    ALLOWED_WRITE_ORIGINS: 'https://studio.flip.intaprd.com,https://flip.intaprd.com',
    JWT_EXPIRY_DAYS: '7',
    JWT_SECRET: 'test',
    R2_PUBLIC_BASE_URL: 'https://media.example.test',
    ...overrides,
  }
}

async function options(origin, path = '/auth/login', envOverrides = {}) {
  const { worker, cleanup } = await loadWorker()
  try {
    return worker.fetch(new Request(`https://api.example.test${path}`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    }), env(envOverrides), {})
  } finally {
    await cleanup()
  }
}

test('preview allows dashboard branch alias origin', async () => {
  const origin = 'https://media-library-dedup-phase1.intap-flipbook-dashboard.pages.dev'
  const response = await options(origin)

  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), origin)
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
})

test('preview allows unique deployment origin', async () => {
  const origin = 'https://d7e3a306.intap-flipbook-dashboard.pages.dev'
  const response = await options(origin, '/api/upload/media-assets')

  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), origin)
  assert.match(response.headers.get('access-control-allow-methods') ?? '', /POST/)
  assert.match(response.headers.get('access-control-allow-headers') ?? '', /Authorization/)
})

test('preview rejects other pages.dev project origin', async () => {
  const response = await options('https://d7e3a306.other-dashboard.pages.dev')

  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
})

test('production allowed origin continues using exact configured list', async () => {
  const origin = 'https://studio.flip.intaprd.com'
  const response = await options(origin, '/auth/login', {
    APP_ENV: 'production',
    CORS_ORIGIN: 'https://studio.flip.intaprd.com,https://flip.intaprd.com',
    ALLOWED_WRITE_ORIGINS: 'https://studio.flip.intaprd.com,https://flip.intaprd.com',
  })

  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), origin)
})

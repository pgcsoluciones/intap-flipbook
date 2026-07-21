import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadPreviewUrl() {
  const dir = await mkdtemp(join(tmpdir(), 'preview-url-test-'))
  const outfile = join(dir, 'previewUrl.mjs')
  await build({
    entryPoints: ['apps/dashboard/src/lib/previewUrl.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { ...mod, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

test('construye URL de Vista previa con Viewer Preview y API Preview', async () => {
  const preview = await loadPreviewUrl()
  try {
    const url = preview.buildPublicationViewerUrl({
      viewerBase: 'https://media-optimization-phase1b.intap-flipbook-viewer.pages.dev',
      tenantSlug: 'tenant-demo',
      publicationSlug: 'catalogo-demo',
      apiBase: 'https://intap-flipbook-api-preview.fliaprince.workers.dev',
      previewToken: 'token-preview',
      previewMode: true,
    })

    assert.equal(url.startsWith('https://media-optimization-phase1b.intap-flipbook-viewer.pages.dev/tenant-demo/catalogo-demo?'), true)
    assert.match(url, /preview=1/)
    assert.match(url, /publication=catalogo-demo/)
    assert.match(url, /api_base=https%3A%2F%2Fintap-flipbook-api-preview\.fliaprince\.workers\.dev/)
    assert.match(url, /preview_token=token-preview/)
    assert.doesNotMatch(url, /intap-flipbook-api\.fliaprince\.workers\.dev/)
    assert.doesNotMatch(url, /localhost|127\.0\.0\.1/)
  } finally {
    await preview.cleanup()
  }
})

test('mantiene compatibilidad con Viewer productivo sin parametros preview', async () => {
  const preview = await loadPreviewUrl()
  try {
    const url = preview.buildPublicationViewerUrl({
      viewerBase: 'https://flip.intaprd.com',
      tenantSlug: 'tenant-demo',
      publicationSlug: 'catalogo-demo',
      previewMode: false,
    })

    assert.equal(url, 'https://flip.intaprd.com/tenant-demo/catalogo-demo')
    assert.doesNotMatch(url, /preview_token|api_base|preview=1/)
  } finally {
    await preview.cleanup()
  }
})

test('habilita boton solo con slug y paginas', async () => {
  const preview = await loadPreviewUrl()
  try {
    assert.equal(preview.canOpenPublicationPreview({ public_slug: 'catalogo', pages: [{}] }), true)
    assert.equal(preview.canOpenPublicationPreview({ public_slug: 'catalogo', pages: [] }), false)
    assert.equal(preview.canOpenPublicationPreview({ public_slug: null, pages: [{}] }), false)
  } finally {
    await preview.cleanup()
  }
})

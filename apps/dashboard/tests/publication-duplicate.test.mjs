import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadHelpers() {
  const dir = await mkdtemp(join(tmpdir(), 'publication-duplicate-ui-'))
  const outfile = join(dir, 'publication-duplicate.mjs')
  await build({
    entryPoints: ['apps/dashboard/src/lib/publicationDuplicate.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { ...mod, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const helpers = await loadHelpers()
after(() => helpers.cleanup())

test('genera nombre de copia sin alterar el título fuente', () => {
  const original = 'Catálogo Padres 2026'
  assert.equal(helpers.duplicatePublicationTitle(original), 'Catálogo Padres 2026 (copia)')
  assert.equal(original, 'Catálogo Padres 2026')
})

test('slug de copia es URL-safe, sin acentos y determinista', () => {
  assert.equal(
    helpers.duplicatePublicationSlug('Catálogo Padres 2026'),
    'catalogo-padres-2026-copia',
  )
  assert.equal(helpers.publicationSlugDraft('  Hombres Ñandú 2026!! '), 'hombres-nandu-2026')
})

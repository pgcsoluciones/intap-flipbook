import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadHelpers() {
  const dir = await mkdtemp(join(tmpdir(), 'publication-clone-helpers-'))
  const outfile = join(dir, 'publication-clone.mjs')
  await build({
    entryPoints: ['apps/api/src/lib/publicationClone.ts'],
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

test('remapea marker_id anidados sin cambiar elementId ni texto casual', () => {
  const source = JSON.stringify({
    objects: [
      {
        type: 'group',
        data: {
          elementId: 'el_keep',
          action: { type: 'open_dynamic_marker', marker_id: 'marker-old' },
        },
        objects: [
          { type: 'text', text: 'marker-old', data: { markerId: 'marker-old' } },
        ],
      },
    ],
  })
  const result = JSON.parse(helpers.remapPublicationCanvasJson(
    source,
    new Map([['marker-old', 'marker-new']]),
  ))

  assert.equal(result.objects[0].data.elementId, 'el_keep')
  assert.equal(result.objects[0].data.action.marker_id, 'marker-new')
  assert.equal(result.objects[0].objects[0].data.markerId, 'marker-new')
  assert.equal(result.objects[0].objects[0].text, 'marker-old')
})

test('preserva canvas_json malformado exactamente como llegó', () => {
  const source = '{"objects": ['
  assert.equal(
    helpers.remapPublicationCanvasJson(source, new Map([['old', 'new']])),
    source,
  )
})

test('mapped insert usa json_each para evitar límites de parámetros por catálogo grande', () => {
  const rows = Array.from({ length: 200 }, (_, index) => ({
    old_id: `old-${index}`,
    new_id: `new-${index}`,
  }))
  const statement = helpers.buildMappedCloneInsertStatement({
    table: 'pages',
    columns: ['id', 'publication_id', 'page_number', 'canvas_json'],
    mapRows: rows,
    mapFields: ['old_id', 'new_id'],
    overrides: {
      id: { sql: 'map.new_id' },
      publication_id: { sql: '?', bindings: ['pub-new'] },
    },
  })

  assert.ok(statement)
  assert.match(statement.sql, /FROM json_each\(\?\)/)
  assert.match(statement.sql, /JOIN clone_map AS map/)
  assert.equal(statement.bindings.length, 2)
  assert.equal(JSON.parse(statement.bindings[0]).length, 200)
  assert.equal(statement.bindings[1], 'pub-new')
})

test('storage references se duplican hacia ids nuevos sin duplicar objetos físicos', () => {
  const statement = helpers.buildMappedStorageReferenceStatement(
    [{ old_id: 'asset-old', new_id: 'asset-new' }],
    'pub-new',
    'pub-old',
  )
  assert.ok(statement)
  assert.match(statement.sql, /INSERT OR IGNORE INTO storage_object_references/)
  assert.match(statement.sql, /refs\.storage_object_id/)
  assert.match(statement.sql, /map\.new_id/)
  assert.deepEqual(statement.bindings.slice(1), ['pub-new', 'pub-old'])
})

test('identificadores SQL no confiables son rechazados', () => {
  assert.throws(() => helpers.quoteCloneIdentifier('pages; DROP TABLE pages'), /no permitido/)
})

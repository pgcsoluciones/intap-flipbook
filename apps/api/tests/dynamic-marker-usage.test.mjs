import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadUsageHelper() {
  const dir = await mkdtemp(join(tmpdir(), 'dynamic-marker-usage-test-'))
  const outfile = join(dir, 'dynamic-marker-usage.mjs')
  await build({
    entryPoints: ['apps/api/src/lib/dynamicMarkerUsage.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return {
    collectDynamicMarkerUsages: mod.collectDynamicMarkerUsages,
    countDynamicMarkerUsages: mod.countDynamicMarkerUsages,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

const helper = await loadUsageHelper()
after(() => helper.cleanup())

function page(overrides = {}) {
  return {
    publication_id: 'pub-1',
    publication_name: 'Catalogo A',
    public_slug: 'catalogo-a',
    page_id: 'page-1',
    page_number: 1,
    canvas_json: { version: '5.3.0', objects: [] },
    ...overrides,
  }
}

function target(overrides = {}) {
  return {
    marker_id: 'marker-1',
    publication_id: 'pub-1',
    page_id: 'page-1',
    target_object_id: 'el-1',
    ...overrides,
  }
}

function collect(pages, targets = [target()]) {
  return helper.collectDynamicMarkerUsages(pages, targets)
}

test('cuenta uso directo valido cuando target_object_id existe en canvas_json', () => {
  const usages = collect([
    page({ canvas_json: { objects: [{ type: 'rect', data: { elementId: 'el-1', name: 'Area' } }] } }),
  ])

  assert.equal(usages.length, 1)
  assert.equal(usages[0].marker_id, 'marker-1')
  assert.deepEqual(usages[0].sources, ['direct'])
})

test('no cuenta target_object_id inexistente', () => {
  const usages = collect([
    page({ canvas_json: { objects: [{ type: 'rect', data: { elementId: 'other' } }] } }),
  ])

  assert.equal(usages.length, 0)
})

test('cuenta accion moderna en data.action', () => {
  const usages = collect([
    page({
      canvas_json: {
        objects: [{ type: 'group', data: { elementId: 'btn-1', action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } } }],
      },
    }),
  ], [target({ target_object_id: 'other' })])

  assert.equal(usages.length, 1)
  assert.equal(usages[0].element_id, 'btn-1')
  assert.deepEqual(usages[0].sources, ['action'])
})

test('cuenta accion heredada en obj.action', () => {
  const usages = collect([
    page({
      canvas_json: {
        objects: [{ type: 'ellipse', data: { elementId: 'el-action' }, action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } }],
      },
    }),
  ], [target({ target_object_id: 'other' })])

  assert.equal(usages.length, 1)
  assert.equal(usages[0].element_id, 'el-action')
  assert.deepEqual(usages[0].sources, ['action'])
})

test('deduplica data.action y obj.action iguales en el mismo objeto', () => {
  const action = { type: 'open_dynamic_marker', marker_id: 'marker-1' }
  const usages = collect([
    page({
      canvas_json: {
        objects: [{ type: 'rect', data: { elementId: 'el-1', action }, action }],
      },
    }),
  ], [target({ target_object_id: 'other' })])

  assert.equal(usages.length, 1)
  assert.deepEqual(usages[0].sources, ['action'])
})

test('deduplica uso directo y accion sobre el mismo objeto', () => {
  const usages = collect([
    page({
      canvas_json: {
        objects: [{
          type: 'rect',
          data: { elementId: 'el-1', action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } },
        }],
      },
    }),
  ])

  assert.equal(usages.length, 1)
  assert.deepEqual(usages[0].sources, ['direct', 'action'])
})

test('dos objetos diferentes hacia la misma ficha cuentan como dos usos', () => {
  const usages = collect([
    page({
      canvas_json: {
        objects: [
          { type: 'rect', data: { elementId: 'el-a', action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } } },
          { type: 'circle', data: { elementId: 'el-b', action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } } },
        ],
      },
    }),
  ], [target({ target_object_id: 'other' })])

  assert.equal(usages.length, 2)
})

test('encuentra acciones dentro de grupos y objetos anidados', () => {
  const usages = collect([
    page({
      canvas_json: {
        objects: [{
          type: 'group',
          data: { elementId: 'group-1' },
          objects: [{ type: 'textbox', text: 'Ver ficha', data: { elementId: 'child-1', action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } } }],
        }],
      },
    }),
  ], [target({ target_object_id: 'other' })])

  assert.equal(usages.length, 1)
  assert.equal(usages[0].element_id, 'child-1')
  assert.equal(usages[0].object_label, 'Ver ficha')
})

test('no mezcla fichas diferentes', () => {
  const usages = collect([
    page({
      canvas_json: {
        objects: [
          { type: 'rect', data: { elementId: 'el-1', action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } } },
          { type: 'rect', data: { elementId: 'el-2', action: { type: 'open_dynamic_marker', marker_id: 'marker-2' } } },
        ],
      },
    }),
  ], [target({ marker_id: 'marker-1', target_object_id: 'missing' })])

  assert.equal(usages.length, 1)
  assert.equal(usages[0].marker_id, 'marker-1')
})

test('paginas diferentes cuentan de manera independiente', () => {
  const usages = collect([
    page({ page_id: 'page-1', page_number: 1, canvas_json: { objects: [{ type: 'rect', data: { elementId: 'el-1' } }] } }),
    page({ page_id: 'page-2', page_number: 2, canvas_json: { objects: [{ type: 'rect', data: { elementId: 'el-1' } }] } }),
  ], [
    target({ page_id: 'page-1', target_object_id: 'el-1' }),
    target({ page_id: 'page-2', target_object_id: 'el-1' }),
  ])

  assert.equal(usages.length, 2)
  assert.deepEqual(usages.map((usage) => usage.page_id), ['page-1', 'page-2'])
})

test('canvas_json nulo o vacio no lanza ni cuenta', () => {
  assert.equal(collect([page({ canvas_json: null }), page({ canvas_json: '' })]).length, 0)
})

test('canvas_json malformado no lanza ni bloquea otras paginas validas', () => {
  const usages = collect([
    page({ canvas_json: '{"objects": [' }),
    page({ page_id: 'page-2', page_number: 2, canvas_json: { objects: [{ type: 'rect', data: { elementId: 'el-2', action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } } }] } }),
  ], [target({ page_id: 'page-2', target_object_id: 'missing' })])

  assert.equal(usages.length, 1)
  assert.equal(usages[0].page_id, 'page-2')
})

test('objeto sin elementId con accion valida usa identidad determinista de ruta', () => {
  const usages = collect([
    page({
      canvas_json: {
        objects: [{ type: 'rect', left: 20, top: 30, data: { action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } } }],
      },
    }),
  ], [target({ target_object_id: 'other' })])

  assert.equal(usages.length, 1)
  assert.equal(usages[0].element_id, null)
  assert.equal(usages[0].object_type, 'rect')
})

test('resultado tiene orden determinista por publicacion, pagina y etiqueta', () => {
  const usages = collect([
    page({ publication_id: 'pub-b', publication_name: 'B', page_id: 'page-b', page_number: 2, canvas_json: { objects: [{ type: 'rect', text: 'Z', data: { elementId: 'el-z', action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } } }] } }),
    page({ publication_id: 'pub-a', publication_name: 'A', page_id: 'page-a2', page_number: 2, canvas_json: { objects: [{ type: 'rect', text: 'B', data: { elementId: 'el-b', action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } } }] } }),
    page({ publication_id: 'pub-a', publication_name: 'A', page_id: 'page-a1', page_number: 1, canvas_json: { objects: [{ type: 'rect', text: 'A', data: { elementId: 'el-a', action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } } }] } }),
  ], [target({ publication_id: 'pub-a', page_id: 'page-a1', target_object_id: 'missing' })])

  assert.deepEqual(usages.map((usage) => `${usage.publication_name}:${usage.page_number}:${usage.object_label}`), [
    'A:1:A',
    'A:2:B',
    'B:2:Z',
  ])
})

test('countDynamicMarkerUsages agrupa por marker_id', () => {
  const usages = collect([
    page({
      canvas_json: {
        objects: [
          { type: 'rect', data: { elementId: 'el-1', action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } } },
          { type: 'rect', data: { elementId: 'el-2', action: { type: 'open_dynamic_marker', marker_id: 'marker-2' } } },
          { type: 'rect', data: { elementId: 'el-3', action: { type: 'open_dynamic_marker', marker_id: 'marker-1' } } },
        ],
      },
    }),
  ], [
    target({ marker_id: 'marker-1', target_object_id: 'missing' }),
    target({ marker_id: 'marker-2', target_object_id: 'missing' }),
  ])
  const counts = helper.countDynamicMarkerUsages(usages)

  assert.equal(counts.get('marker-1'), 2)
  assert.equal(counts.get('marker-2'), 1)
})

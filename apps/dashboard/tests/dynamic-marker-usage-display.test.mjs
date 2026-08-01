import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadDisplayHelpers() {
  const dir = await mkdtemp(join(tmpdir(), 'dynamic-marker-usage-display-test-'))
  const outfile = join(dir, 'dynamic-marker-usage-display.mjs')
  await build({
    entryPoints: ['apps/dashboard/src/lib/dynamicMarkerUsageDisplay.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return {
    dynamicMarkerUsageBadgeLabel: mod.dynamicMarkerUsageBadgeLabel,
    canOpenDynamicMarkerUsage: mod.canOpenDynamicMarkerUsage,
    dynamicMarkerUsageObjectLabel: mod.dynamicMarkerUsageObjectLabel,
    dynamicMarkerUsageSourceLabel: mod.dynamicMarkerUsageSourceLabel,
    dynamicMarkerUsageSummary: mod.dynamicMarkerUsageSummary,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

const helper = await loadDisplayHelpers()
after(() => helper.cleanup())

test('ficha con usage_count 0 presenta Sin uso y no En uso', () => {
  assert.equal(helper.dynamicMarkerUsageBadgeLabel(0), 'Sin uso')
  assert.equal(helper.canOpenDynamicMarkerUsage(0), false)
})

test('ficha con usage_count 1 muestra En uso y singular correcto', () => {
  assert.equal(helper.dynamicMarkerUsageBadgeLabel(1), 'En uso · 1')
  assert.equal(helper.dynamicMarkerUsageSummary(1), '1 uso')
  assert.equal(helper.canOpenDynamicMarkerUsage(1), true)
})

test('ficha con usage_count mayor muestra conteo plural', () => {
  assert.equal(helper.dynamicMarkerUsageBadgeLabel(12), 'En uso · 12')
  assert.equal(helper.dynamicMarkerUsageSummary(12), '12 usos')
})

test('sources direct se muestra como ficha directa', () => {
  assert.equal(helper.dynamicMarkerUsageSourceLabel(['direct']), 'Ficha directa')
})

test('sources action se muestra como boton o accion', () => {
  assert.equal(helper.dynamicMarkerUsageSourceLabel(['action']), 'Botón o acción')
})

test('direct y action se presenta sin duplicar la ubicacion', () => {
  assert.equal(helper.dynamicMarkerUsageSourceLabel(['direct', 'action']), 'Ficha directa y acción')
  assert.equal(helper.dynamicMarkerUsageSourceLabel(['action', 'direct', 'action']), 'Ficha directa y acción')
})

test('dialogo puede mostrar publicacion, pagina y etiqueta de objeto', () => {
  const usage = {
    publication_name: 'Catalogo de prueba',
    page_number: 3,
    object_label: 'Ver detalles',
    object_type: 'group',
  }
  assert.equal(usage.publication_name, 'Catalogo de prueba')
  assert.equal(`Página ${usage.page_number}`, 'Página 3')
  assert.equal(helper.dynamicMarkerUsageObjectLabel(usage), 'Ver detalles')
})

test('object_label tiene fallback amigable por object_type', () => {
  assert.equal(helper.dynamicMarkerUsageObjectLabel({ object_label: null, object_type: 'ellipse' }), 'Óvalo')
  assert.equal(helper.dynamicMarkerUsageObjectLabel({ object_label: null, object_type: 'group' }), 'Grupo')
})

test('estado vacio usa mensaje humano esperado', () => {
  assert.equal('Esta ficha todavía no está vinculada a ningún elemento.', 'Esta ficha todavía no está vinculada a ningún elemento.')
})

test('estado de error y reintento usan mensaje humano esperado', () => {
  assert.equal('No pudimos consultar los usos de esta ficha.', 'No pudimos consultar los usos de esta ficha.')
  assert.equal('Reintentar', 'Reintentar')
})

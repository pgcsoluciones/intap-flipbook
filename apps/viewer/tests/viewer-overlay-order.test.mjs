import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(
  new URL('../src/flipbook.js', import.meta.url),
  'utf8',
)

test('buildOverlay conserva el índice Fabric al construir hitboxes', () => {
  assert.match(
    source,
    /const overlayObjects = fcanvas\.getObjects\(\)\.slice\(\)/,
  )

  assert.match(
    source,
    /overlayObjects\.forEach\(\(obj,\s*objectIndex\)\s*=>/,
  )

  assert.match(
    source,
    /interactiveOverlayZIndex\(objectIndex\)/,
  )
})

test('hotspot widget accion y ficha usan el mismo interactiveZ', () => {
  const matches = source.match(/z-index:\$\{interactiveZ\}/g) ?? []

  assert.equal(
    matches.length,
    4,
    'los cuatro tipos de overlay deben usar el mismo orden Fabric',
  )
})

test('buildOverlay no conserva prioridades fijas 7 6 5 por tipo', () => {
  const start = source.indexOf('function buildOverlay(')
  const end = source.indexOf(
    '// Visibilidad inicial: cualquier elemento',
    start,
  )

  assert.ok(start >= 0 && end > start)

  const overlaySource = source.slice(start, end)

  assert.doesNotMatch(overlaySource, /z-index:7;pointer-events:auto/)
  assert.doesNotMatch(overlaySource, /z-index:6;pointer-events:auto/)
  assert.doesNotMatch(overlaySource, /z-index:5;pointer-events:auto/)
})

test('buildOverlay usa el runtime compatible y no depende del global directamente', () => {
  assert.match(
    source,
    /viewerRuntime\.interactiveOverlayZIndex\(objectIndex\)/,
  )

  assert.doesNotMatch(
    source,
    /IntapViewerRuntime\.interactiveOverlayZIndex\(objectIndex\)/,
  )

  assert.match(
    source,
    /interactiveOverlayZIndex:\s*\(objectIndex\)\s*=>/,
  )
})

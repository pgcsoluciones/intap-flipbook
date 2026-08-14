import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canvasObjectsOverlap,
  findInteractiveOverlaps,
  getInteractiveObjectLabel,
  isInteractiveCanvasObject,
} from '../src/lib/interactiveOverlaps.ts'

function object({
  kind,
  action,
  directAction,
  visible = true,
  evented = true,
  opacity = 1,
  label,
  elementId,
  intersects = false,
  contained = false,
} = {}) {
  return {
    type: kind === 'hotspot' || kind === 'dynamic_marker_button'
      ? 'group'
      : 'rect',
    visible,
    evented,
    opacity,
    data: {
      ...(kind ? { kind } : {}),
      ...(action ? { action } : {}),
      ...(label ? { label } : {}),
      ...(elementId ? { elementId } : {}),
    },
    ...(directAction ? { action: directAction } : {}),
    intersectsWithObject() {
      return intersects
    },
    isContainedWithinObject() {
      return contained
    },
  }
}

test('dynamic marker button is interactive without linked marker yet', () => {
  assert.equal(
    isInteractiveCanvasObject(object({
      kind: 'dynamic_marker_button',
    })),
    true,
  )
})

test('hotspot and linkzone are interactive', () => {
  assert.equal(
    isInteractiveCanvasObject(object({ kind: 'hotspot' })),
    true,
  )
  assert.equal(
    isInteractiveCanvasObject(object({ kind: 'linkzone' })),
    true,
  )
})

test('generic object with public action is interactive', () => {
  assert.equal(
    isInteractiveCanvasObject(object({
      kind: 'image',
      action: { type: 'whatsapp' },
    })),
    true,
  )
})

test('legacy direct open_product_detail remains interactive', () => {
  assert.equal(
    isInteractiveCanvasObject(object({
      kind: 'image',
      directAction: { type: 'open_product_detail' },
    })),
    true,
  )
})

test('ordinary visual object without public action is not interactive', () => {
  assert.equal(
    isInteractiveCanvasObject(object({ kind: 'shape' })),
    false,
  )
})

test('hidden, event-disabled or zero-opacity objects are ignored', () => {
  assert.equal(
    isInteractiveCanvasObject(object({
      kind: 'hotspot',
      visible: false,
    })),
    false,
  )

  assert.equal(
    isInteractiveCanvasObject(object({
      kind: 'hotspot',
      evented: false,
    })),
    false,
  )

  assert.equal(
    isInteractiveCanvasObject(object({
      kind: 'hotspot',
      opacity: 0,
    })),
    false,
  )
})

test('same object never overlaps itself', () => {
  const a = object({
    kind: 'hotspot',
    intersects: true,
  })

  assert.equal(canvasObjectsOverlap(a, a), false)
})

test('intersection reports overlap', () => {
  const a = object({
    kind: 'hotspot',
    intersects: true,
  })

  const b = object({
    kind: 'linkzone',
  })

  assert.equal(canvasObjectsOverlap(a, b), true)
})

test('full containment reports overlap even without edge intersection', () => {
  const a = object({
    kind: 'hotspot',
    contained: true,
  })

  const b = object({
    kind: 'linkzone',
  })

  assert.equal(canvasObjectsOverlap(a, b), true)
})

test('findInteractiveOverlaps distinguishes below and above by Fabric order', () => {
  const below = object({
    kind: 'linkzone',
    label: 'Zona inferior',
    intersects: true,
  })

  const active = object({
    kind: 'hotspot',
    label: 'Punto activo',
    intersects: true,
  })

  const above = object({
    kind: 'dynamic_marker_button',
    label: 'Ver ficha',
  })

  // El mock de active devuelve true para ambos.
  const conflicts = findInteractiveOverlaps(
    active,
    [below, active, above],
  )

  assert.equal(conflicts.length, 2)

  assert.equal(conflicts[0].object, below)
  assert.equal(conflicts[0].position, 'below')

  assert.equal(conflicts[1].object, above)
  assert.equal(conflicts[1].position, 'above')
})

test('non-interactive overlapping visuals are ignored', () => {
  const active = object({
    kind: 'hotspot',
    intersects: true,
  })

  const visualShape = object({
    kind: 'shape',
  })

  assert.deepEqual(
    findInteractiveOverlaps(active, [active, visualShape]),
    [],
  )
})

test('labels use explicit label before kind fallback', () => {
  assert.equal(
    getInteractiveObjectLabel(object({
      kind: 'button',
      label: 'Comprar',
    })),
    'Comprar',
  )

  assert.equal(
    getInteractiveObjectLabel(object({
      kind: 'hotspot',
    })),
    'Punto activo',
  )
})

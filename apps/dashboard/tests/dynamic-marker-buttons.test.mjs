import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const canvasEl = { getAttribute() { return 'ltr' }, style: {} }
const mockCtx = {
  canvas: canvasEl,
  measureText: (text) => ({ width: String(text || '').length * 8 }),
  save() {}, restore() {}, scale() {}, rotate() {}, translate() {}, transform() {}, setTransform() {}, clearRect() {}, fillRect() {}, strokeRect() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {}, arc() {}, ellipse() {}, fill() {}, stroke() {}, clip() {},
  drawImage() {}, fillText() {}, strokeText() {}, createLinearGradient() { return { addColorStop() {} } }, createPattern() { return null },
  createRadialGradient() { return { addColorStop() {} } }, setLineDash() {}, getLineDash() { return [] }, rect() {},
  putImageData() {}, getImageData() { return { data: new Uint8ClampedArray(4) } },
}
canvasEl.getContext = () => mockCtx
if (globalThis.HTMLCanvasElement) globalThis.HTMLCanvasElement.prototype.getContext = () => mockCtx

const require = createRequire(import.meta.url)
const { fabric } = require('fabric')
if (fabric.document?.createElement) {
  const originalCreateElement = fabric.document.createElement.bind(fabric.document)
  fabric.document.createElement = (tag) => {
    const element = originalCreateElement(tag)
    if (tag === 'canvas') element.getContext = () => mockCtx
    return element
  }
}

const dir = await mkdtemp(join(tmpdir(), 'dynamic-marker-buttons-test-'))
const entry = join(dir, 'entry.ts')
const outfile = join(dir, 'bundle.mjs')

await writeFile(entry, `
  export * from '${process.cwd()}/apps/dashboard/src/lib/dynamicMarkerButtons.ts'
  export * from '${process.cwd()}/apps/dashboard/src/lib/editorClipboard.ts'
`)

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
})

try {
  const mod = await import(pathToFileURL(outfile).href)
  const {
    DYNAMIC_MARKER_BUTTON_KIND,
    DYNAMIC_MARKER_BUTTON_PRESETS,
    createDynamicMarkerButtonStyle,
    createDynamicMarkerButtonData,
    getDynamicMarkerButtonCornerRadius,
    getDynamicMarkerButtonStatusColor,
    isDynamicMarkerButtonLinked,
    setDynamicMarkerButtonMarker,
    updateDynamicMarkerButtonStyle,
    prepareDuplicatedFabricObjectForEditor,
  } = mod

  function createCanonicalGroup(style, markerId) {
    const radius = getDynamicMarkerButtonCornerRadius(style)
    const background = style.shape === 'circle'
      ? new fabric.Circle({
          radius: Math.min(style.width, style.height) / 2,
          fill: style.backgroundColor,
          stroke: style.borderColor,
          strokeWidth: style.borderWidth,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
          data: { role: 'dynamic_marker_button_bg' },
        })
      : new fabric.Rect({
          width: style.width,
          height: style.height,
          fill: style.backgroundColor,
          stroke: style.borderColor,
          strokeWidth: style.borderWidth,
          rx: radius,
          ry: radius,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
          data: { role: 'dynamic_marker_button_bg' },
        })
    const text = new fabric.Text(style.label, {
      fill: style.textColor,
      fontSize: style.textSize,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      textAlign: style.textAlign,
      originX: 'center',
      originY: 'center',
      left: 0,
      top: 0,
      selectable: false,
      evented: false,
      data: { role: 'dynamic_marker_button_text' },
    })
    return new fabric.Group([background, text], {
      left: 120,
      top: 80,
      scaleX: 1.2,
      scaleY: 0.9,
      angle: 8,
      data: createDynamicMarkerButtonData(style, markerId),
    })
  }

  async function roundTripGroup(group) {
    const canvas = new fabric.StaticCanvas(null, { width: 500, height: 500 })
    canvas.add(group)
    const firstJson = canvas.toJSON(['data'])
    const canvas2 = new fabric.StaticCanvas(null, { width: 500, height: 500 })
    await new Promise((resolve) => canvas2.loadFromJSON(firstJson, resolve))
    const loaded = canvas2.getObjects()[0]
    rebuildLoadedGroup(loaded)
    const secondJson = canvas2.toJSON(['data'])
    const canvas3 = new fabric.StaticCanvas(null, { width: 500, height: 500 })
    await new Promise((resolve) => canvas3.loadFromJSON(secondJson, resolve))
    const loadedAgain = canvas3.getObjects()[0]
    rebuildLoadedGroup(loadedAgain)
    return loadedAgain
  }

  function rebuildLoadedGroup(group) {
    const transform = {
      left: group.left,
      top: group.top,
      scaleX: group.scaleX,
      scaleY: group.scaleY,
      angle: group.angle,
    }
    const rebuilt = createCanonicalGroup(group.data.dynamicMarkerButton, group.data.action?.marker_id)
    group._objects = rebuilt.getObjects()
    group._objects.forEach((child) => {
      child.group = group
      child.canvas = group.canvas
      child.selectable = false
      child.evented = false
    })
    group.set({
      ...transform,
      width: rebuilt.width,
      height: rebuilt.height,
      data: group.data,
    })
    group.addWithUpdate()
    group.set(transform)
    group.setCoords()
  }

  function assertCanonicalRoundTrip(group, style) {
    const children = group.getObjects()
    assert.equal(children.length, 2)
    const background = children.find((item) => item.data?.role === 'dynamic_marker_button_bg')
    const text = children.find((item) => item.data?.role === 'dynamic_marker_button_text')
    assert.ok(background)
    assert.ok(text)
    assert.ok(Math.abs(background.left) < 0.0001)
    assert.ok(Math.abs(background.top) < 0.0001)
    assert.ok(Math.abs(text.left) < 0.0001)
    assert.ok(Math.abs(text.top) < 0.0001)
    assert.equal(background.originX, 'center')
    assert.equal(background.originY, 'center')
    assert.equal(text.originX, 'center')
    assert.equal(text.originY, 'center')
    assert.equal(background.selectable, false)
    assert.equal(text.selectable, false)
    assert.equal(background.evented, false)
    assert.equal(text.evented, false)
    if (style.shape === 'circle') {
      assert.equal(background.radius, Math.min(style.width, style.height) / 2)
    } else {
      assert.equal(background.width, style.width)
      assert.equal(background.height, style.height)
      assert.equal(background.rx, getDynamicMarkerButtonCornerRadius(style))
      assert.ok((text.width ?? text.getScaledWidth?.() ?? 0) <= style.width)
    }
  }

  assert.equal(DYNAMIC_MARKER_BUTTON_PRESETS.length, 8)
  assert.deepEqual(DYNAMIC_MARKER_BUTTON_PRESETS.map((preset) => preset.name), [
    'Rectangular sólido',
    'Rectangular redondeado',
    'Tipo píldora',
    'Contorno',
    'Cuadrado',
    'Circular',
    'Tipo etiqueta o badge',
    'Solo texto',
  ])

  const style = createDynamicMarkerButtonStyle('solid-rect')
  assert.equal(style.label, 'Ver ficha')
  assert.equal(style.backgroundColor, '#2563eb')

  const data = createDynamicMarkerButtonData(style)
  assert.equal(data.kind, DYNAMIC_MARKER_BUTTON_KIND)
  assert.equal(data.dynamicMarkerButton.textColor, '#ffffff')
  assert.equal(data.action, undefined)
  assert.equal(isDynamicMarkerButtonLinked(data), false)
  assert.equal(getDynamicMarkerButtonStatusColor(data), '#94a3b8')

  const styled = updateDynamicMarkerButtonStyle(data, {
    label: 'Ficha premium',
    backgroundColor: '#111827',
    textColor: '#f8fafc',
    textSize: 24,
    borderColor: '#f8fafc',
    borderWidth: 2,
    borderRadius: 12,
    opacity: 0.7,
  })
  assert.equal(styled.label, 'Ficha premium')
  assert.equal(styled.dynamicMarkerButton.backgroundColor, '#111827')
  assert.equal(styled.dynamicMarkerButton.textColor, '#f8fafc')
  assert.equal(styled.dynamicMarkerButton.textSize, 24)
  assert.equal(styled.dynamicMarkerButton.borderWidth, 2)
  assert.equal(styled.dynamicMarkerButton.opacity, 0.7)

  const linked = setDynamicMarkerButtonMarker(styled, 'marker_123')
  assert.deepEqual(linked.action, { type: 'open_dynamic_marker', marker_id: 'marker_123' })
  assert.equal(isDynamicMarkerButtonLinked(linked), true)
  assert.equal(getDynamicMarkerButtonStatusColor(linked), '#22c55e')

  const serializedLinked = JSON.parse(JSON.stringify(linked))
  assert.equal(isDynamicMarkerButtonLinked(serializedLinked), true)
  assert.equal(getDynamicMarkerButtonStatusColor(serializedLinked), '#22c55e')

  const unlinked = setDynamicMarkerButtonMarker(linked)
  assert.equal(unlinked.action, undefined)
  assert.equal(unlinked.marker_id, undefined)
  assert.equal(getDynamicMarkerButtonStatusColor(unlinked), '#94a3b8')

  const pillStyle = createDynamicMarkerButtonStyle('pill')
  assert.equal(getDynamicMarkerButtonCornerRadius(pillStyle), Math.min(pillStyle.width, pillStyle.height) / 2)
  const resizedPill = updateDynamicMarkerButtonStyle(
    createDynamicMarkerButtonData(pillStyle),
    { width: 260, height: 70 },
  ).dynamicMarkerButton
  assert.equal(getDynamicMarkerButtonCornerRadius(resizedPill), 35)

  for (const presetId of ['solid-rect', 'pill', 'circle', 'text-only']) {
    const roundTripStyle = createDynamicMarkerButtonStyle(presetId)
    const roundTripped = await roundTripGroup(createCanonicalGroup(roundTripStyle, presetId === 'pill' ? 'marker_pill' : undefined))
    assert.equal(roundTripped.data.dynamicMarkerButton.presetId, presetId)
    assert.equal(isDynamicMarkerButtonLinked(roundTripped.data), presetId === 'pill')
    assertCanonicalRoundTrip(roundTripped, roundTripStyle)
  }

  const original = {
    type: 'group',
    left: 120,
    top: 80,
    scaleX: 1.25,
    scaleY: 1.1,
    data: {
      ...linked,
      elementId: 'el_original',
    },
    objects: [
      { type: 'rect', width: 180, height: 56, fill: '#111827', stroke: '#f8fafc', strokeWidth: 2, data: { role: 'dynamic_marker_button_bg' } },
      { type: 'textbox', text: 'Ficha premium', fill: '#f8fafc', fontSize: 24, fontFamily: 'Inter, sans-serif', data: { role: 'dynamic_marker_button_text' } },
    ],
  }

  const duplicate = JSON.parse(JSON.stringify(original))
  prepareDuplicatedFabricObjectForEditor(duplicate, new Set(['el_original']))

  assert.deepEqual(original.data.action, { type: 'open_dynamic_marker', marker_id: 'marker_123' })
  assert.equal(original.data.elementId, 'el_original')
  assert.equal(duplicate.type, 'group')
  assert.equal(duplicate.left, 120)
  assert.equal(duplicate.top, 80)
  assert.equal(duplicate.scaleX, 1.25)
  assert.equal(duplicate.scaleY, 1.1)
  assert.equal(duplicate.data.kind, DYNAMIC_MARKER_BUTTON_KIND)
  assert.equal(duplicate.data.action, undefined)
  assert.equal(duplicate.data.marker_id, undefined)
  assert.notEqual(duplicate.data.elementId, 'el_original')
  assert.equal(duplicate.objects[0].fill, '#111827')
  assert.equal(duplicate.objects[0].stroke, '#f8fafc')
  assert.equal(duplicate.objects[1].text, 'Ficha premium')
  assert.equal(duplicate.objects[1].fontSize, 24)

  const linkedPill = setDynamicMarkerButtonMarker(createDynamicMarkerButtonData(pillStyle), 'marker_pill')
  const pillOriginal = {
    type: 'group',
    data: {
      ...linkedPill,
      elementId: 'el_pill_original',
    },
    objects: [
      { type: 'rect', rx: getDynamicMarkerButtonCornerRadius(pillStyle), ry: getDynamicMarkerButtonCornerRadius(pillStyle), data: { role: 'dynamic_marker_button_bg' } },
      { type: 'textbox', text: pillStyle.label, data: { role: 'dynamic_marker_button_text' } },
    ],
  }
  const pillDuplicate = JSON.parse(JSON.stringify(pillOriginal))
  prepareDuplicatedFabricObjectForEditor(pillDuplicate, new Set(['el_pill_original']))
  assert.equal(pillOriginal.data.action.marker_id, 'marker_pill')
  assert.equal(pillDuplicate.data.action, undefined)
  assert.equal(pillDuplicate.data.marker_id, undefined)
  assert.notEqual(pillDuplicate.data.elementId, 'el_pill_original')
  assert.equal(pillDuplicate.data.dynamicMarkerButton.presetId, 'pill')
  assert.equal(getDynamicMarkerButtonCornerRadius(pillDuplicate.data.dynamicMarkerButton), Math.min(pillStyle.width, pillStyle.height) / 2)
  assert.equal(pillDuplicate.objects[0].rx, Math.min(pillStyle.width, pillStyle.height) / 2)

  const linkAction = { data: { action: { type: 'link', url: 'https://example.com' }, elementId: 'el_link' } }
  prepareDuplicatedFabricObjectForEditor(linkAction, new Set(['el_link']))
  assert.deepEqual(linkAction.data.action, { type: 'link', url: 'https://example.com' })

  console.log('dynamic-marker-buttons.test.mjs ok')
} finally {
  await rm(dir, { recursive: true, force: true })
}

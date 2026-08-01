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
    getDynamicMarkerButtonIcon,
    getDynamicMarkerButtonCornerRadius,
    getDynamicMarkerButtonLayout,
    getDynamicMarkerButtonCacheSignature,
    getDynamicMarkerButtonScaledStyle,
    getDynamicMarkerButtonShadow,
    getDynamicMarkerButtonStatusColor,
    isDynamicMarkerButtonLinked,
    normalizeDynamicMarkerButtonStyle,
    setDynamicMarkerButtonMarker,
    updateDynamicMarkerButtonStyle,
    prepareDuplicatedFabricObjectForEditor,
  } = mod

  function createCanonicalGroup(style, markerId) {
    style = normalizeDynamicMarkerButtonStyle(style)
    const radius = getDynamicMarkerButtonCornerRadius(style)
    const layout = getDynamicMarkerButtonLayout(style)
    const background = style.shape === 'circle'
      ? new fabric.Circle({
          radius: Math.min(style.width, style.height) / 2,
          fill: style.backgroundColor,
          stroke: style.borderColor,
          strokeWidth: style.borderWidth,
          shadow: getDynamicMarkerButtonShadow(style),
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
          shadow: getDynamicMarkerButtonShadow(style),
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
          data: { role: 'dynamic_marker_button_bg' },
        })
    const text = new fabric.Textbox(style.label, {
      width: layout.textWidth,
      fill: style.textColor,
      fontSize: style.textSize,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      textAlign: style.textAlign,
      originX: 'center',
      originY: 'center',
      left: layout.textX,
      top: layout.textY,
      visible: layout.showText,
      selectable: false,
      evented: false,
      data: { role: 'dynamic_marker_button_text' },
    })
    const objects = [background]
    if (layout.showIcon && layout.icon) {
      objects.push(new fabric.Path(layout.icon.path, {
        stroke: style.iconColor,
        fill: '',
        strokeWidth: 1.8,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        originX: 'center',
        originY: 'center',
        left: layout.iconX,
        top: layout.iconY,
        scaleX: style.iconSize / 24,
        scaleY: style.iconSize / 24,
        selectable: false,
        evented: false,
        data: { role: 'dynamic_marker_button_icon', iconId: layout.icon.id },
      }))
    }
    objects.push(text)
    return new fabric.Group(objects, {
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
    const background = children.find((item) => item.data?.role === 'dynamic_marker_button_bg')
    const text = children.find((item) => item.data?.role === 'dynamic_marker_button_text')
    const icon = children.find((item) => item.data?.role === 'dynamic_marker_button_icon')
    const layout = getDynamicMarkerButtonLayout(style)
    assert.ok(background)
    assert.ok(text)
    assert.ok(Math.abs(background.left) < 0.0001)
    assert.ok(Math.abs(background.top) < 0.0001)
    assert.ok(Math.abs(text.left) <= style.width / 2)
    assert.ok(Math.abs(text.top) <= style.height / 2)
    assert.equal(background.originX, 'center')
    assert.equal(background.originY, 'center')
    assert.equal(text.originX, 'center')
    assert.equal(text.originY, 'center')
    assert.equal(background.selectable, false)
    assert.equal(text.selectable, false)
    assert.equal(background.evented, false)
    assert.equal(text.evented, false)
    assert.equal(!!icon, layout.showIcon)
    if (icon) {
      assert.ok(Math.abs(icon.left) <= style.width / 2)
      assert.ok(Math.abs(icon.top) <= style.height / 2)
      if (style.iconPosition === 'left') assert.ok(icon.left < text.left)
      if (style.iconPosition === 'right') assert.ok(icon.left > text.left)
      if (style.iconPosition === 'top') assert.ok(icon.top < text.top)
      assert.equal(icon.stroke, style.iconColor)
      assert.equal(icon.selectable, false)
      assert.equal(icon.evented, false)
    }
    if (style.shape === 'circle') {
      assert.equal(background.radius, Math.min(style.width, style.height) / 2)
    } else {
      assert.equal(background.width, style.width)
      assert.equal(background.height, style.height)
      assert.equal(background.rx, getDynamicMarkerButtonCornerRadius(style))
      assert.ok((text.width ?? text.getScaledWidth?.() ?? 0) <= style.width)
    }
    if (style.shadow.enabled) {
      assert.equal(background.shadow?.blur, style.shadow.blur)
      assert.equal(background.shadow?.offsetX, style.shadow.offsetX)
      assert.equal(background.shadow?.offsetY, style.shadow.offsetY)
    } else {
      assert.equal(background.shadow, null)
    }
  }

  assert.equal(DYNAMIC_MARKER_BUTTON_PRESETS.length, 12)
  assert.deepEqual(DYNAMIC_MARKER_BUTTON_PRESETS.slice(0, 8).map((preset) => preset.name), [
    'Rectangular sólido',
    'Rectangular redondeado',
    'Tipo píldora',
    'Contorno',
    'Cuadrado',
    'Circular',
    'Tipo etiqueta o badge',
    'Solo texto',
  ])
  assert.deepEqual(DYNAMIC_MARKER_BUTTON_PRESETS.slice(8).map((preset) => preset.name), [
    'Texto con flecha',
    'Información circular',
    'Producto destacado',
    'Botón con sombra',
  ])
  assert.ok(getDynamicMarkerButtonIcon('info'))
  assert.ok(getDynamicMarkerButtonIcon('whatsapp'))

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
    iconId: 'info',
    iconPosition: 'left',
    iconColor: '#f8fafc',
    iconSize: 22,
    iconGap: 10,
    shadow: { enabled: true, blur: 16, offsetX: 2, offsetY: 5, color: '#111827' },
  })
  assert.equal(styled.label, 'Ficha premium')
  assert.equal(styled.dynamicMarkerButton.backgroundColor, '#111827')
  assert.equal(styled.dynamicMarkerButton.textColor, '#f8fafc')
  assert.equal(styled.dynamicMarkerButton.textSize, 24)
  assert.equal(styled.dynamicMarkerButton.borderWidth, 2)
  assert.equal(styled.dynamicMarkerButton.opacity, 0.7)
  assert.equal(styled.dynamicMarkerButton.iconId, 'info')
  assert.equal(styled.dynamicMarkerButton.iconColor, '#f8fafc')
  assert.equal(styled.dynamicMarkerButton.iconSize, 22)
  assert.equal(styled.dynamicMarkerButton.iconGap, 10)
  assert.deepEqual(getDynamicMarkerButtonShadow(styled.dynamicMarkerButton), { color: '#111827', blur: 16, offsetX: 2, offsetY: 5 })

  const textOnlyChange = updateDynamicMarkerButtonStyle(styled, { textSize: 30 }).dynamicMarkerButton
  assert.equal(textOnlyChange.textSize, 30)
  assert.equal(textOnlyChange.iconSize, 22)
  assert.equal(textOnlyChange.iconGap, 10)
  const iconOnlyChange = updateDynamicMarkerButtonStyle(styled, { iconSize: 34 }).dynamicMarkerButton
  assert.equal(iconOnlyChange.textSize, 24)
  assert.equal(iconOnlyChange.iconSize, 34)
  assert.equal(iconOnlyChange.iconGap, 10)
  const gapOnlyChange = updateDynamicMarkerButtonStyle(styled, { iconGap: 18 }).dynamicMarkerButton
  assert.equal(gapOnlyChange.textSize, 24)
  assert.equal(gapOnlyChange.iconSize, 22)
  assert.equal(gapOnlyChange.iconGap, 18)
  assert.notEqual(getDynamicMarkerButtonCacheSignature(styled.dynamicMarkerButton), getDynamicMarkerButtonCacheSignature(textOnlyChange))
  assert.notEqual(getDynamicMarkerButtonCacheSignature(styled.dynamicMarkerButton), getDynamicMarkerButtonCacheSignature(iconOnlyChange))
  assert.notEqual(getDynamicMarkerButtonCacheSignature(styled.dynamicMarkerButton), getDynamicMarkerButtonCacheSignature(gapOnlyChange))

  const serializedStyled = JSON.parse(JSON.stringify(styled))
  assert.equal(serializedStyled.dynamicMarkerButton.textSize, 24)
  assert.equal(serializedStyled.dynamicMarkerButton.iconSize, 22)
  assert.equal(serializedStyled.dynamicMarkerButton.iconGap, 10)

  const scaledStyle = getDynamicMarkerButtonScaledStyle(styled.dynamicMarkerButton, 1.5, 0.75)
  assert.equal(scaledStyle.width, Math.round(styled.dynamicMarkerButton.width * 1.5))
  assert.equal(scaledStyle.height, Math.round(styled.dynamicMarkerButton.height * 0.75))
  assert.equal(scaledStyle.textSize, styled.dynamicMarkerButton.textSize)
  assert.equal(scaledStyle.iconSize, styled.dynamicMarkerButton.iconSize)

  const noIconLayout = getDynamicMarkerButtonLayout(createDynamicMarkerButtonStyle('solid-rect'))
  assert.equal(noIconLayout.showIcon, false)
  assert.equal(noIconLayout.showText, true)
  const leftIconLayout = getDynamicMarkerButtonLayout(styled.dynamicMarkerButton)
  assert.equal(leftIconLayout.showIcon, true)
  assert.ok(leftIconLayout.iconX < leftIconLayout.textX)
  const rightIconStyle = updateDynamicMarkerButtonStyle(styled, { iconPosition: 'right' }).dynamicMarkerButton
  const rightIconLayout = getDynamicMarkerButtonLayout(rightIconStyle)
  assert.ok(rightIconLayout.iconX > rightIconLayout.textX)
  const topIconStyle = updateDynamicMarkerButtonStyle(styled, { iconPosition: 'top' }).dynamicMarkerButton
  const topIconLayout = getDynamicMarkerButtonLayout(topIconStyle)
  assert.ok(topIconLayout.iconY < topIconLayout.textY)
  const onlyIconStyle = updateDynamicMarkerButtonStyle(styled, { iconPosition: 'only' }).dynamicMarkerButton
  const onlyIconLayout = getDynamicMarkerButtonLayout(onlyIconStyle)
  assert.equal(onlyIconLayout.showText, false)
  assert.equal(onlyIconLayout.showIcon, true)

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

  for (const presetId of ['solid-rect', 'pill', 'circle', 'text-only', 'text-arrow', 'shadow-button']) {
    const roundTripStyle = createDynamicMarkerButtonStyle(presetId)
    const roundTripped = await roundTripGroup(createCanonicalGroup(roundTripStyle, presetId === 'pill' ? 'marker_pill' : undefined))
    assert.equal(roundTripped.data.dynamicMarkerButton.presetId, presetId)
    assert.equal(isDynamicMarkerButtonLinked(roundTripped.data), presetId === 'pill')
    assert.equal(roundTripped.scaleX, 1.2)
    assert.equal(roundTripped.scaleY, 0.9)
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
  assert.equal(duplicate.objects.at(-1).text, 'Ficha premium')
  assert.equal(duplicate.objects.at(-1).fontSize, 24)
  assert.equal(duplicate.data.dynamicMarkerButton.iconId, 'info')
  assert.equal(duplicate.data.dynamicMarkerButton.shadow.enabled, true)

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

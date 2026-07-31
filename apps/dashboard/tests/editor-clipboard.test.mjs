import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadClipboard() {
  const dir = await mkdtemp(join(tmpdir(), 'editor-clipboard-test-'))
  const outfile = join(dir, 'editorClipboard.mjs')
  await build({
    entryPoints: ['apps/dashboard/src/lib/editorClipboard.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return {
    ...mod,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

function fabricLikeObject(type, data, extra = {}) {
  return {
    type,
    data,
    left: extra.left ?? 10,
    top: extra.top ?? 20,
    scaleX: extra.scaleX ?? 1,
    scaleY: extra.scaleY ?? 1,
    angle: extra.angle ?? 0,
    opacity: extra.opacity ?? 1,
    widgetConfig: extra.widgetConfig,
    toObject() {
      return {
        type: this.type,
        data: this.data,
        left: this.left,
        top: this.top,
        scaleX: this.scaleX,
        scaleY: this.scaleY,
        angle: this.angle,
        opacity: this.opacity,
        widgetConfig: this.widgetConfig,
        objects: extra.objects,
      }
    },
  }
}

test('copiar un objeto serializa sin eliminar ni mutar el original', async () => {
  const clipboard = await loadClipboard()
  try {
    const obj = fabricLikeObject('textbox', { elementId: 'el_a', kind: 'text' }, { left: 42 })
    const serialized = clipboard.serializeFabricSelectionForClipboard(obj, [obj])
    assert.equal(serialized.length, 1)
    assert.equal(serialized[0].left, 42)
    assert.equal(obj.data.elementId, 'el_a')
  } finally {
    await clipboard.cleanup()
  }
})

test('ActiveSelection serializa objetos individuales en orden relativo del canvas', async () => {
  const clipboard = await loadClipboard()
  try {
    const first = fabricLikeObject('rect', { elementId: 'el_1' }, { left: 5 })
    const second = fabricLikeObject('image', { elementId: 'el_2' }, { left: 50 })
    const activeSelection = {
      type: 'activeSelection',
      getObjects: () => [second, first],
    }
    const serialized = clipboard.serializeFabricSelectionForClipboard(activeSelection, [first, second])
    assert.deepEqual(serialized.map((obj) => obj.data.elementId), ['el_1', 'el_2'])
    assert.deepEqual(serialized.map((obj) => obj.left), [5, 50])
  } finally {
    await clipboard.cleanup()
  }
})

test('cortar puede guardar contenido y resolver objetos individuales a retirar', async () => {
  const clipboard = await loadClipboard()
  try {
    const a = fabricLikeObject('circle', { elementId: 'el_a' })
    const b = fabricLikeObject('triangle', { elementId: 'el_b' })
    const activeSelection = { type: 'activeSelection', getObjects: () => [b, a] }
    const selectedObjects = clipboard.getFabricSelectionObjects(activeSelection, [a, b])
    const serialized = clipboard.serializeFabricSelectionForClipboard(activeSelection, [a, b])
    assert.deepEqual(selectedObjects, [a, b])
    assert.deepEqual(serialized.map((obj) => obj.type), ['circle', 'triangle'])
  } finally {
    await clipboard.cleanup()
  }
})

test('pegar crea nuevos elementId para objetos superiores y anidados', async () => {
  const clipboard = await loadClipboard()
  try {
    const source = [{
      type: 'group',
      data: { elementId: 'el_group', kind: 'widget' },
      objects: [
        { type: 'rect', data: { elementId: 'el_child_a' } },
        { type: 'textbox', data: { elementId: 'el_child_b' } },
      ],
    }]
    const prepared = clipboard.prepareClipboardObjectsForPaste(source, [{ data: { elementId: 'el_existing' } }])
    const ids = new Set()
    clipboard.collectFabricElementIds(prepared, ids)
    assert.equal(ids.size, 3)
    assert.equal(ids.has('el_group'), false)
    assert.equal(ids.has('el_child_a'), false)
    assert.equal(ids.has('el_child_b'), false)
    assert.equal(ids.has('el_existing'), false)
  } finally {
    await clipboard.cleanup()
  }
})

test('asociaciones dinamicas se eliminan en todos los niveles', async () => {
  const clipboard = await loadClipboard()
  try {
    const prepared = clipboard.prepareClipboardObjectsForPaste([{
      type: 'group',
      markerId: 'marker-top',
      data: {
        elementId: 'el_a',
        dynamicMarkerId: 'dm-1',
        target_object_id: 'target-1',
        widget: { config: { marker: 'nested-marker', label: 'Normal' } },
      },
      objects: [{
        type: 'rect',
        syncGroupId: 'sync-1',
        data: { elementId: 'el_b', booking_calendar_id: 'cal-1' },
      }],
    }])
    const [root] = prepared
    assert.equal(root.markerId, undefined)
    assert.equal(root.data.dynamicMarkerId, undefined)
    assert.equal(root.data.target_object_id, undefined)
    assert.equal(root.data.widget.config.marker, undefined)
    assert.equal(root.data.widget.config.label, 'Normal')
    assert.equal(root.objects[0].syncGroupId, undefined)
    assert.equal(root.objects[0].data.booking_calendar_id, undefined)
  } finally {
    await clipboard.cleanup()
  }
})

test('propiedades visuales y configuracion normal se conservan', async () => {
  const clipboard = await loadClipboard()
  try {
    const source = [{
      type: 'image',
      left: 75,
      top: 80,
      width: 120,
      height: 90,
      scaleX: 1.4,
      scaleY: 0.8,
      angle: 17,
      opacity: 0.65,
      src: 'https://media.example.test/a.jpg',
      data: { elementId: 'el_img', widget: { type: 'gallery', config: { columns: 3 } } },
    }]
    const [prepared] = clipboard.prepareClipboardObjectsForPaste(source)
    assert.equal(prepared.left, 75)
    assert.equal(prepared.scaleX, 1.4)
    assert.equal(prepared.angle, 17)
    assert.equal(prepared.opacity, 0.65)
    assert.equal(prepared.src, source[0].src)
    assert.deepEqual(prepared.data.widget, source[0].data.widget)
  } finally {
    await clipboard.cleanup()
  }
})

test('objeto con ficha dinamica oculta se pega visible, seleccionable y sin asociacion', async () => {
  const clipboard = await loadClipboard()
  try {
    const [prepared] = clipboard.prepareClipboardObjectsForPaste([{
      type: 'rect',
      opacity: 0.07,
      selectable: false,
      evented: false,
      data: {
        elementId: 'el_hidden',
        hiddenInEditor: true,
        originalOpacity: 0.82,
        marker_id: 'marker-1',
      },
    }])
    assert.equal(prepared.opacity, 0.82)
    assert.equal(prepared.selectable, true)
    assert.equal(prepared.evented, true)
    assert.equal(prepared.data.hiddenInEditor, undefined)
    assert.equal(prepared.data.originalOpacity, undefined)
    assert.equal(prepared.data.marker_id, undefined)
  } finally {
    await clipboard.cleanup()
  }
})

test('portapapeles preparado puede reutilizarse para multiples pegados con IDs nuevos', async () => {
  const clipboard = await loadClipboard()
  try {
    const payload = [{ type: 'rect', data: { elementId: 'el_source' } }]
    const first = clipboard.prepareClipboardObjectsForPaste(payload)
    const second = clipboard.prepareClipboardObjectsForPaste(payload, first)
    assert.notEqual(first[0].data.elementId, 'el_source')
    assert.notEqual(second[0].data.elementId, 'el_source')
    assert.notEqual(first[0].data.elementId, second[0].data.elementId)
  } finally {
    await clipboard.cleanup()
  }
})

test('copiar en pagina 1 y pegar en pagina 2 mantiene payload serializable independiente', async () => {
  const clipboard = await loadClipboard()
  try {
    const original = fabricLikeObject('textbox', { elementId: 'el_page_1' }, { left: 12, top: 34 })
    const payload = clipboard.serializeFabricSelectionForClipboard(original, [original])
    const page2Prepared = clipboard.prepareClipboardObjectsForPaste(payload, [])
    assert.equal(payload[0].left, 12)
    assert.equal(page2Prepared[0].top, 34)
    assert.notEqual(page2Prepared[0].data.elementId, payload[0].data.elementId)
  } finally {
    await clipboard.cleanup()
  }
})

test('pegar varios objetos mantiene posiciones relativas originales', async () => {
  const clipboard = await loadClipboard()
  try {
    const payload = [
      { type: 'rect', left: 10, top: 20, data: { elementId: 'el_a' } },
      { type: 'rect', left: 80, top: 120, data: { elementId: 'el_b' } },
    ]
    const prepared = clipboard.prepareClipboardObjectsForPaste(payload)
    assert.equal(prepared[1].left - prepared[0].left, 70)
    assert.equal(prepared[1].top - prepared[0].top, 100)
  } finally {
    await clipboard.cleanup()
  }
})

test('atajos funcionan fuera de campos de texto y no con Alt o repeat', async () => {
  const clipboard = await loadClipboard()
  try {
    assert.equal(clipboard.shouldIgnoreEditorClipboardShortcut({ target: null }, false), false)
    assert.equal(clipboard.shouldIgnoreEditorClipboardShortcut({ target: null, altKey: true }, false), true)
    assert.equal(clipboard.shouldIgnoreEditorClipboardShortcut({ target: null, repeat: true }, false), true)
  } finally {
    await clipboard.cleanup()
  }
})

test('atajos no actuan dentro de input textarea select o contenteditable', async () => {
  const clipboard = await loadClipboard()
  try {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      assert.equal(clipboard.shouldIgnoreEditorClipboardShortcut({ target: { tagName } }, false), true)
    }
    assert.equal(clipboard.shouldIgnoreEditorClipboardShortcut({ target: { tagName: 'DIV', isContentEditable: true } }, false), true)
    assert.equal(clipboard.shouldIgnoreEditorClipboardShortcut({
      target: { tagName: 'SPAN', isContentEditable: false, closest: () => ({}) },
    }, false), true)
  } finally {
    await clipboard.cleanup()
  }
})

test('atajos no actuan mientras Fabric esta editando texto', async () => {
  const clipboard = await loadClipboard()
  try {
    assert.equal(clipboard.shouldIgnoreEditorClipboardShortcut({ target: null }, true), true)
  } finally {
    await clipboard.cleanup()
  }
})

test('seleccion vacia no produce objetos para copiar o cortar', async () => {
  const clipboard = await loadClipboard()
  try {
    assert.deepEqual(clipboard.getFabricSelectionObjects(null, []), [])
    assert.deepEqual(clipboard.serializeFabricSelectionForClipboard(null, []), [])
  } finally {
    await clipboard.cleanup()
  }
})

test('etiquetas del portapapeles usan singular y plural reales', async () => {
  const clipboard = await loadClipboard()
  try {
    assert.equal(clipboard.editorClipboardCountLabel(1, 'copiado'), '1 elemento copiado')
    assert.equal(clipboard.editorClipboardCountLabel(3, 'pegado'), '3 elementos pegados')
  } finally {
    await clipboard.cleanup()
  }
})

test('preparar pegado no muta el payload serializado original', async () => {
  const clipboard = await loadClipboard()
  try {
    const payload = [{
      type: 'group',
      data: { elementId: 'el_source', markerId: 'marker-1' },
      objects: [{ type: 'rect', data: { elementId: 'el_child', dynamicMarkerId: 'dm-1' } }],
    }]
    const before = JSON.stringify(payload)
    clipboard.prepareClipboardObjectsForPaste(payload)
    assert.equal(JSON.stringify(payload), before)
  } finally {
    await clipboard.cleanup()
  }
})

test('resetDuplicateTree mantiene visual oculto previo salvo cuando pegado pide restaurarlo', async () => {
  const clipboard = await loadClipboard()
  try {
    const duplicate = {
      type: 'rect',
      opacity: 0.07,
      selectable: false,
      evented: false,
      data: { elementId: 'el_hidden', hiddenInEditor: true, originalOpacity: 0.9 },
    }
    clipboard.resetDuplicateTree(duplicate, new Set())
    assert.equal(duplicate.opacity, 0.07)
    assert.equal(duplicate.selectable, false)
    assert.equal(duplicate.evented, false)
    assert.equal(duplicate.data.hiddenInEditor, undefined)
    assert.equal(duplicate.data.originalOpacity, undefined)

    const [pasted] = clipboard.prepareClipboardObjectsForPaste([{
      type: 'rect',
      opacity: 0.07,
      selectable: false,
      evented: false,
      data: { elementId: 'el_hidden', hiddenInEditor: true, originalOpacity: 0.9 },
    }])
    assert.equal(pasted.opacity, 0.9)
    assert.equal(pasted.selectable, true)
    assert.equal(pasted.evented, true)
  } finally {
    await clipboard.cleanup()
  }
})

test('duplicacion existente usa la misma regeneracion y limpieza del portapapeles', async () => {
  const clipboard = await loadClipboard()
  try {
    const existing = new Set(['el_existing'])
    const duplicate = {
      type: 'group',
      data: { elementId: 'el_old', markerId: 'marker-1' },
      objects: [{ type: 'rect', data: { elementId: 'el_child', dynamicMarkerId: 'dm-1' } }],
    }
    clipboard.resetDuplicateTree(duplicate, existing)
    assert.notEqual(duplicate.data.elementId, 'el_old')
    assert.equal(duplicate.data.markerId, undefined)
    assert.notEqual(duplicate.objects[0].data.elementId, 'el_child')
    assert.equal(duplicate.objects[0].data.dynamicMarkerId, undefined)
  } finally {
    await clipboard.cleanup()
  }
})

test('duplicacion de interfaz limpia solo open_dynamic_marker y conserva otras acciones', async () => {
  const clipboard = await loadClipboard()
  try {
    const existing = new Set(['el_original'])
    const duplicate = {
      type: 'group',
      action: { type: 'open_dynamic_marker', marker_id: 'marker-top' },
      data: {
        elementId: 'el_original',
        kind: 'button',
        label: 'Abrir ficha',
        bg: '#4F46E5',
        textColor: '#fff',
        variant: 'solid',
        target_object_id: 'el_original',
        action: { type: 'open_dynamic_marker', marker_id: 'marker-data' },
      },
      objects: [{
        type: 'rect',
        data: {
          elementId: 'el_child',
          dynamicMarkerId: 'direct-marker',
          action: { type: 'whatsapp', phone: '+18095550123' },
        },
      }],
    }

    clipboard.prepareDuplicatedFabricObjectForEditor(duplicate, existing)

    assert.notEqual(duplicate.data.elementId, 'el_original')
    assert.equal(duplicate.action, undefined)
    assert.equal(duplicate.data.action, undefined)
    assert.equal(duplicate.data.marker_id, undefined)
    assert.equal(duplicate.data.target_object_id, undefined)
    assert.equal(duplicate.objects[0].data.dynamicMarkerId, undefined)
    assert.equal(duplicate.objects[0].data.action.type, 'whatsapp')
    assert.equal(duplicate.objects[0].data.action.phone, '+18095550123')
    assert.equal(duplicate.data.bg, '#4F46E5')
    assert.equal(duplicate.data.variant, 'solid')
  } finally {
    await clipboard.cleanup()
  }
})

test('duplicacion de ellipse con open_product_detail limpia solo el vinculo de ficha', async () => {
  const clipboard = await loadClipboard()
  try {
    const original = {
      type: 'ellipse',
      left: 373,
      top: 684.56,
      width: 180,
      height: 110,
      rx: 90,
      ry: 55,
      fill: 'rgba(79,70,229,0.85)',
      stroke: '#111827',
      strokeWidth: 2,
      data: {
        kind: 'shape',
        elementId: 'el_original',
        action: { type: 'open_product_detail', detail_id: 99 },
        detail_id: 99,
      },
    }
    const duplicate = clipboard.clonePlainValue(original)

    clipboard.prepareDuplicatedFabricObjectForEditor(duplicate, new Set(['el_original']))

    assert.equal(original.data.action.type, 'open_product_detail')
    assert.equal(original.data.action.detail_id, 99)
    assert.equal(original.data.detail_id, 99)
    assert.notEqual(duplicate.data.elementId, 'el_original')
    assert.equal(duplicate.data.action, undefined)
    assert.equal(duplicate.data.detail_id, undefined)
    assert.equal(duplicate.type, 'ellipse')
    assert.equal(duplicate.left, 373)
    assert.equal(duplicate.top, 684.56)
    assert.equal(duplicate.width, 180)
    assert.equal(duplicate.height, 110)
    assert.equal(duplicate.rx, 90)
    assert.equal(duplicate.ry, 55)
    assert.equal(duplicate.fill, 'rgba(79,70,229,0.85)')
    assert.equal(duplicate.stroke, '#111827')
    assert.equal(duplicate.strokeWidth, 2)
  } finally {
    await clipboard.cleanup()
  }
})

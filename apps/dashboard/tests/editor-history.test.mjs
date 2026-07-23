import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

async function loadHistory() {
  const dir = await mkdtemp(join(tmpdir(), 'editor-history-test-'))
  const outfile = join(dir, 'editorHistory.mjs')
  const source = await readFile('apps/dashboard/src/lib/editorHistory.ts', 'utf8')
  const runnable = source
    .replace(/export type EditorHistory = \{[\s\S]*?\}\n\n/, '')
    .replace(/^export type .*$/gm, '')
    .replace(/\(entry\): entry is string =>/g, '(entry) =>')
    .replace(/ as Partial<EditorHistory>/g, '')
    .replace(/ as number/g, '')
    .replace(/: typeof EDITOR_HISTORY_VERSION/g, '')
    .replace(/: EditorHistoryStorage \| null \| undefined/g, '')
    .replace(/: EditorHistory \| null \| undefined/g, '')
    .replace(/: string \| null/g, '')
    .replace(/: string\[\]/g, '')
    .replace(/: EditorHistory/g, '')
    .replace(/\) \| null/g, ')')
    .replace(/: unknown/g, '')
    .replace(/: string/g, '')
    .replace(/: number/g, '')
  await writeFile(outfile, runnable)
  const mod = await import(pathToFileURL(outfile).href)
  return {
    ...mod,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

function snap(n) {
  return JSON.stringify({ objects: [{ id: n }] })
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    has: (key) => values.has(key),
  }
}

test('historial nuevo contiene el estado inicial', async () => {
  const h = await loadHistory()
  try {
    const history = h.createEditorHistory('pub1', 'page1', snap(0))
    assert.deepEqual(history.entries, [snap(0)])
    assert.equal(history.index, 0)
  } finally {
    await h.cleanup()
  }
})

test('guarda maximo 21 snapshots', async () => {
  const h = await loadHistory()
  try {
    let history = h.createEditorHistory('pub1', 'page1', snap(0))
    for (let i = 1; i <= 25; i++) history = h.appendEditorHistorySnapshot(history, snap(i))
    assert.equal(history.entries.length, 21)
    assert.equal(history.entries[0], snap(5))
    assert.equal(history.index, 20)
  } finally {
    await h.cleanup()
  }
})

test('permite 20 pasos de Deshacer y Rehacer', async () => {
  const h = await loadHistory()
  try {
    let history = h.createEditorHistory('pub1', 'page1', snap(0))
    for (let i = 1; i <= 25; i++) history = h.appendEditorHistorySnapshot(history, snap(i))
    assert.equal(history.entries.length, 21)
    assert.equal(history.index, 20)

    for (let i = 0; i < 20; i++) history = h.moveEditorHistoryIndex(history, -1)
    assert.equal(history.index, 0)
    assert.equal(h.getEditorHistoryCurrentSnapshot(history), snap(5))

    const afterExtraUndo = h.moveEditorHistoryIndex(history, -1)
    assert.equal(afterExtraUndo.index, 0)
    assert.equal(h.getEditorHistoryCurrentSnapshot(afterExtraUndo), snap(5))

    for (let i = 0; i < 20; i++) history = h.moveEditorHistoryIndex(history, 1)
    assert.equal(history.index, 20)
    assert.equal(h.getEditorHistoryCurrentSnapshot(history), snap(25))
  } finally {
    await h.cleanup()
  }
})

test('no agrega snapshots consecutivos identicos', async () => {
  const h = await loadHistory()
  try {
    let history = h.createEditorHistory('pub1', 'page1', snap(1))
    history = h.appendEditorHistorySnapshot(history, snap(1))
    assert.equal(history.entries.length, 1)
  } finally {
    await h.cleanup()
  }
})

test('agregar despues de Deshacer elimina la rama de Rehacer', async () => {
  const h = await loadHistory()
  try {
    let history = h.createEditorHistory('pub1', 'page1', snap(0))
    history = h.appendEditorHistorySnapshot(history, snap(1))
    history = h.appendEditorHistorySnapshot(history, snap(2))
    history = h.moveEditorHistoryIndex(history, -1)
    history = h.appendEditorHistorySnapshot(history, snap(3))
    assert.deepEqual(history.entries, [snap(0), snap(1), snap(3)])
    assert.equal(history.index, 2)
  } finally {
    await h.cleanup()
  }
})

test('Deshacer mueve correctamente el indice', async () => {
  const h = await loadHistory()
  try {
    let history = h.createEditorHistory('pub1', 'page1', snap(0))
    history = h.appendEditorHistorySnapshot(history, snap(1))
    history = h.moveEditorHistoryIndex(history, -1)
    assert.equal(history.index, 0)
  } finally {
    await h.cleanup()
  }
})

test('Rehacer mueve correctamente el indice', async () => {
  const h = await loadHistory()
  try {
    let history = h.createEditorHistory('pub1', 'page1', snap(0))
    history = h.appendEditorHistorySnapshot(history, snap(1))
    history = h.moveEditorHistoryIndex(history, -1)
    history = h.moveEditorHistoryIndex(history, 1)
    assert.equal(history.index, 1)
  } finally {
    await h.cleanup()
  }
})

test('no permite indices fuera de rango', async () => {
  const h = await loadHistory()
  try {
    let history = h.createEditorHistory('pub1', 'page1', snap(0))
    history = h.moveEditorHistoryIndex(history, -99)
    assert.equal(history.index, 0)
    history = h.moveEditorHistoryIndex(history, 99)
    assert.equal(history.index, 0)
  } finally {
    await h.cleanup()
  }
})

test('dos paginas tienen historiales independientes', async () => {
  const h = await loadHistory()
  try {
    const page1 = h.appendEditorHistorySnapshot(h.createEditorHistory('pub1', 'page1', snap(0)), snap(1))
    const page2 = h.createEditorHistory('pub1', 'page2', snap(20))
    assert.notEqual(h.editorHistoryStorageKey(page1.publicationId, page1.pageId), h.editorHistoryStorageKey(page2.publicationId, page2.pageId))
    assert.equal(h.getEditorHistoryCurrentSnapshot(page1), snap(1))
    assert.equal(h.getEditorHistoryCurrentSnapshot(page2), snap(20))
  } finally {
    await h.cleanup()
  }
})

test('dos publicaciones tienen claves independientes', async () => {
  const h = await loadHistory()
  try {
    assert.notEqual(h.editorHistoryStorageKey('pub1', 'page1'), h.editorHistoryStorageKey('pub2', 'page1'))
  } finally {
    await h.cleanup()
  }
})

test('normalizacion rechaza datos corruptos', async () => {
  const h = await loadHistory()
  try {
    assert.equal(h.normalizeEditorHistory({ version: h.EDITOR_HISTORY_VERSION, publicationId: 'pub1', pageId: 'page1', entries: ['not-json'], index: 0 }, 'pub1', 'page1'), null)
    assert.equal(h.parseEditorHistory('{bad json', 'pub1', 'page1'), null)
  } finally {
    await h.cleanup()
  }
})

test('normalizacion corrige indices invalidos', async () => {
  const h = await loadHistory()
  try {
    const history = h.normalizeEditorHistory({ version: h.EDITOR_HISTORY_VERSION, publicationId: 'pub1', pageId: 'page1', entries: [snap(0), snap(1)], index: 99 }, 'pub1', 'page1')
    assert.equal(history.index, 1)
  } finally {
    await h.cleanup()
  }
})

test('snapshot actual es entries[index]', async () => {
  const h = await loadHistory()
  try {
    const history = { version: h.EDITOR_HISTORY_VERSION, publicationId: 'pub1', pageId: 'page1', entries: [snap(0), snap(1)], index: 1 }
    assert.equal(h.getEditorHistoryCurrentSnapshot(history), snap(1))
  } finally {
    await h.cleanup()
  }
})

test('persistir y restaurar conserva entries e index', async () => {
  const h = await loadHistory()
  try {
    const storage = memoryStorage()
    let history = h.createEditorHistory('pub1', 'page1', snap(0))
    history = h.appendEditorHistorySnapshot(history, snap(1))
    history = h.moveEditorHistoryIndex(history, -1)
    assert.equal(h.saveEditorHistoryToSession(storage, history), true)
    const restored = h.loadEditorHistoryFromSession(storage, 'pub1', 'page1')
    assert.deepEqual(restored.entries, history.entries)
    assert.equal(restored.index, 0)
  } finally {
    await h.cleanup()
  }
})

test('recargar con historial valido mantiene canUndo', async () => {
  const h = await loadHistory()
  try {
    const storage = memoryStorage()
    const history = h.appendEditorHistorySnapshot(h.createEditorHistory('pub1', 'page1', snap(0)), snap(1))
    h.saveEditorHistoryToSession(storage, history)
    const reloaded = h.loadEditorHistoryFromSession(storage, 'pub1', 'page1')
    assert.equal(reloaded.index > 0, true)
  } finally {
    await h.cleanup()
  }
})

test('cambiar de pagina y regresar conserva el historial', async () => {
  const h = await loadHistory()
  try {
    const byKey = new Map()
    const page1 = h.appendEditorHistorySnapshot(h.createEditorHistory('pub1', 'page1', snap(0)), snap(1))
    const page2 = h.appendEditorHistorySnapshot(h.createEditorHistory('pub1', 'page2', snap(20)), snap(21))
    byKey.set(h.editorHistoryStorageKey('pub1', 'page1'), page1)
    byKey.set(h.editorHistoryStorageKey('pub1', 'page2'), page2)
    assert.equal(h.getEditorHistoryCurrentSnapshot(byKey.get(h.editorHistoryStorageKey('pub1', 'page1'))), snap(1))
    assert.equal(h.getEditorHistoryCurrentSnapshot(byKey.get(h.editorHistoryStorageKey('pub1', 'page2'))), snap(21))
  } finally {
    await h.cleanup()
  }
})

test('reconstruir el mismo canvas no borra ni duplica el historial', async () => {
  const h = await loadHistory()
  try {
    let history = h.appendEditorHistorySnapshot(h.createEditorHistory('pub1', 'page1', snap(0)), snap(1))
    const before = history
    history = h.normalizeEditorHistory(JSON.parse(JSON.stringify(history)), 'pub1', 'page1')
    history = h.appendEditorHistorySnapshot(history, h.getEditorHistoryCurrentSnapshot(history))
    assert.deepEqual(history.entries, before.entries)
    assert.equal(history.index, before.index)
  } finally {
    await h.cleanup()
  }
})

test('eliminar pagina permite eliminar solo su almacenamiento', async () => {
  const h = await loadHistory()
  try {
    const storage = memoryStorage()
    const page1 = h.createEditorHistory('pub1', 'page1', snap(0))
    const page2 = h.createEditorHistory('pub1', 'page2', snap(2))
    h.saveEditorHistoryToSession(storage, page1)
    h.saveEditorHistoryToSession(storage, page2)
    h.removeEditorHistoryFromSession(storage, 'pub1', 'page1')
    assert.equal(storage.has(h.editorHistoryStorageKey('pub1', 'page1')), false)
    assert.equal(storage.has(h.editorHistoryStorageKey('pub1', 'page2')), true)
  } finally {
    await h.cleanup()
  }
})

test('duplicar pagina comienza con historial nuevo', async () => {
  const h = await loadHistory()
  try {
    const original = h.appendEditorHistorySnapshot(h.createEditorHistory('pub1', 'page1', snap(0)), snap(1))
    const duplicate = h.createEditorHistory('pub1', 'page-copy', h.getEditorHistoryCurrentSnapshot(original))
    assert.equal(duplicate.entries.length, 1)
    assert.equal(duplicate.index, 0)
    assert.notEqual(duplicate.pageId, original.pageId)
  } finally {
    await h.cleanup()
  }
})

test('fallo de sessionStorage conserva historial en memoria', async () => {
  const h = await loadHistory()
  try {
    const brokenStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('blocked') },
    }
    const history = h.appendEditorHistorySnapshot(h.createEditorHistory('pub1', 'page1', snap(0)), snap(1))
    assert.equal(h.saveEditorHistoryToSession(brokenStorage, history), false)
    assert.equal(h.getEditorHistoryCurrentSnapshot(history), snap(1))
    assert.equal(history.index > 0, true)
  } finally {
    await h.cleanup()
  }
})

test('aplicar Undo no agrega automaticamente otro snapshot', async () => {
  const h = await loadHistory()
  try {
    let history = h.createEditorHistory('pub1', 'page1', snap(0))
    history = h.appendEditorHistorySnapshot(history, snap(1))
    history = h.moveEditorHistoryIndex(history, -1)
    assert.equal(history.entries.length, 2)
    assert.equal(history.index, 0)
  } finally {
    await h.cleanup()
  }
})

test('editar despues de Undo invalida Redo', async () => {
  const h = await loadHistory()
  try {
    let history = h.createEditorHistory('pub1', 'page1', snap(0))
    history = h.appendEditorHistorySnapshot(history, snap(1))
    history = h.appendEditorHistorySnapshot(history, snap(2))
    history = h.moveEditorHistoryIndex(history, -1)
    history = h.appendEditorHistorySnapshot(history, snap(99))
    assert.equal(history.entries.includes(snap(2)), false)
    assert.equal(history.index, history.entries.length - 1)
  } finally {
    await h.cleanup()
  }
})


test('historial v1 anterior no puede sustituir el canvas actual del servidor', async () => {
  const h = await loadHistory()
  try {
    const legacy = {
      version: 1,
      publicationId: 'pub1',
      pageId: 'page1',
      entries: [snap(0)],
      index: 0,
    }

    assert.equal(
      h.normalizeEditorHistory(legacy, 'pub1', 'page1'),
      null,
    )

    assert.equal(
      h.editorHistoryStorageKey('pub1', 'page1').includes('_v2:'),
      true,
    )
  } finally {
    await h.cleanup()
  }
})

test('persistCanvas sincroniza el snapshot antes de encolar el guardado', async () => {
  const source = await readFile(
    'apps/dashboard/src/pages/EditPublication.tsx',
    'utf8',
  )

  const start = source.indexOf(
    'const persistCanvas = useCallback',
  )
  const end = source.indexOf(
    '// Programa un guardado diferido',
    start,
  )

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)

  const block = source.slice(start, end)
  const syncIndex = block.indexOf(
    'persistEditorHistorySnapshot(pageId, json)',
  )
  const queueIndex = block.indexOf(
    'const run = async () =>',
  )

  assert.notEqual(syncIndex, -1)
  assert.notEqual(queueIndex, -1)
  assert.equal(syncIndex < queueIndex, true)
})

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadMediaPickerIntent() {
  const dir = await mkdtemp(join(tmpdir(), 'media-picker-intent-test-'))
  const outfile = join(dir, 'mediaPickerIntent.mjs')
  await build({
    entryPoints: ['apps/dashboard/src/lib/mediaPickerIntent.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { ...mod, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  }
}

test('seleccion simple devuelve la URL inmediatamente', async () => {
  const h = await loadMediaPickerIntent()
  try {
    assert.equal(h.selectFirstMediaPickerUrl({ urls: ['https://cdn.test/a.jpg'] }), 'https://cdn.test/a.jpg')
  } finally {
    await h.cleanup()
  }
})

test('seleccion multiple conserva imagenes anteriores y orden', async () => {
  const h = await loadMediaPickerIntent()
  try {
    const next = h.appendMediaPickerUrls(['old-1', 'old-2'], { urls: ['new-1', 'new-2'] }, 5)
    assert.deepEqual(next, ['old-1', 'old-2', 'new-1', 'new-2'])
  } finally {
    await h.cleanup()
  }
})

test('seleccion multiple respeta limite maximo', async () => {
  const h = await loadMediaPickerIntent()
  try {
    const next = h.appendMediaPickerUrls(['old-1', 'old-2'], { urls: ['new-1', 'new-2'] }, 3)
    assert.deepEqual(next, ['old-1', 'old-2', 'new-1'])
  } finally {
    await h.cleanup()
  }
})

test('memoria de carpeta queda aislada por publicationId', async () => {
  const h = await loadMediaPickerIntent()
  const storage = memoryStorage()
  try {
    h.writeMediaPickerFolder(storage, 'pub-a', 'folder-a')
    h.writeMediaPickerFolder(storage, 'pub-b', 'folder-b')
    assert.equal(h.readMediaPickerFolder(storage, 'pub-a'), 'folder-a')
    assert.equal(h.readMediaPickerFolder(storage, 'pub-b'), 'folder-b')
    assert.notEqual(h.mediaPickerFolderStorageKey('pub-a'), h.mediaPickerFolderStorageKey('pub-b'))
  } finally {
    await h.cleanup()
  }
})

test('null representa Banco general y undefined ausencia de preferencia', async () => {
  const h = await loadMediaPickerIntent()
  const storage = memoryStorage()
  try {
    assert.equal(h.readMediaPickerFolder(storage, 'pub-a'), undefined)
    h.writeMediaPickerFolder(storage, 'pub-a', null)
    assert.equal(h.readMediaPickerFolder(storage, 'pub-a'), null)
  } finally {
    await h.cleanup()
  }
})

test('carpeta inexistente normaliza a null', async () => {
  const h = await loadMediaPickerIntent()
  try {
    assert.equal(h.normalizeMediaPickerFolderId('deleted-folder', [{ id: 'folder-1' }]), null)
    assert.equal(h.normalizeMediaPickerFolderId('folder-1', [{ id: 'folder-1' }]), 'folder-1')
  } finally {
    await h.cleanup()
  }
})

test('fallo de sessionStorage no rompe los helpers del selector', async () => {
  const h = await loadMediaPickerIntent()
  const failingStorage = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('quota') },
  }
  try {
    assert.equal(h.readMediaPickerFolder(failingStorage, 'pub-a'), undefined)
    assert.equal(h.writeMediaPickerFolder(failingStorage, 'pub-a', 'folder-a'), false)
    assert.deepEqual(h.appendMediaPickerUrls(['old'], { urls: ['new'] }, 2), ['old', 'new'])
  } finally {
    await h.cleanup()
  }
})

test('rectangulos y poligonos shape abren reemplazo de imagen', async () => {
  const h = await loadMediaPickerIntent()
  try {
    assert.equal(h.shouldOpenImageReplacementForObject({ kind: 'shape', type: 'rect' }), true)
    assert.equal(h.shouldOpenImageReplacementForObject({ kind: 'shape', type: 'polygon' }), true)
    assert.equal(h.shouldOpenImageReplacementForObject({ kind: 'shape', type: 'circle' }), false)
    assert.equal(h.shouldOpenImageReplacementForObject({ kind: 'image', type: 'image' }), true)
  } finally {
    await h.cleanup()
  }
})

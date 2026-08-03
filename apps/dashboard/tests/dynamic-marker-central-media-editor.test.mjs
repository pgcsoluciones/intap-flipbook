import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadMediaHelpers() {
  const dir = await mkdtemp(join(tmpdir(), 'dynamic-marker-central-media-test-'))
  const outfile = join(dir, 'dynamic-marker-media.mjs')
  await build({
    entryPoints: ['apps/dashboard/src/lib/dynamicMarkerMedia.ts'],
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

const helper = await loadMediaHelpers()
after(() => helper.cleanup())

function asset(overrides = {}) {
  return {
    id: 'asset-1',
    publication_id: 'pub-1',
    folder_id: null,
    storage_bucket: 'MEDIA',
    storage_key: 'uploads/a.png',
    public_url: 'https://cdn.test/a.png',
    display_url: 'https://cdn.test/a-display.png',
    optimized_url: null,
    original_url: 'https://cdn.test/a-original.png',
    original_name: 'a.png',
    mime_type: 'image/png',
    size_bytes: 1000,
    sha256: 'sha',
    width: 100,
    height: 100,
    thumbnail_url: 'https://cdn.test/a-thumb.png',
    created_at: '2026-08-02 10:00:00',
    updated_at: '2026-08-02 10:00:00',
    ...overrides,
  }
}

test('editor central muestra seccion Multimedia y usa el Banco real', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerMediaEditor.tsx', 'utf8')
  assert.match(source, /Multimedia · \{draft\.length\}/)
  assert.match(source, /Seleccionar del banco/)
  assert.match(source, /<MediaPicker/)
  assert.match(source, /mode="media"/)
  assert.match(source, /multiple/)
})

test('TenantDynamicMarkers integra multimedia con dirty y flush combinados', async () => {
  const source = await readFile('apps/dashboard/src/pages/TenantDynamicMarkers.tsx', 'utf8')
  assert.match(source, /DynamicMarkerMediaEditor/)
  assert.match(source, /commercialDirty \|\| mediaDirty/)
  assert.match(source, /mediaFlushRef/)
})

test('page_id y target_object_id null no se requieren para editar multimedia', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerMediaEditor.tsx', 'utf8')
  assert.doesNotMatch(source, /page_id/)
  assert.doesNotMatch(source, /target_object_id/)
  assert.match(source, /marker\.publication_id/)
})

test('recurso existente se mapea a media_json sin volver a subir', () => {
  const item = helper.dynamicMarkerMediaItemFromAsset(asset())
  assert.equal(item.id, 'asset-1')
  assert.equal(item.type, 'image')
  assert.equal(item.url, 'https://cdn.test/a-display.png')
  assert.equal(item.thumbnail_url, 'https://cdn.test/a-thumb.png')
})

test('audio y video del banco se mapean al tipo correcto', () => {
  assert.equal(helper.dynamicMarkerMediaItemFromAsset(asset({ mime_type: 'audio/mpeg', public_url: 'https://cdn.test/a.mp3', display_url: '' })).type, 'audio')
  assert.equal(helper.dynamicMarkerMediaItemFromAsset(asset({ mime_type: 'video/mp4', public_url: 'https://cdn.test/a.mp4', display_url: '' })).type, 'video')
})

test('recursos repetidos no se duplican y sort_order se recalcula', () => {
  const current = [{ id: 'asset-1', type: 'image', url: 'https://cdn.test/a.png' }]
  const incoming = [
    { id: 'asset-1', type: 'image', url: 'https://cdn.test/a.png' },
    { id: 'asset-2', type: 'image', url: 'https://cdn.test/b.png' },
  ]
  const merged = helper.mergeDynamicMarkerMediaItems(current, incoming)
  assert.deepEqual(merged.map((item) => item.id), ['asset-1', 'asset-2'])
  assert.deepEqual(merged.map((item) => item.sort_order), [0, 1])
})

test('Quitar de esta ficha excluye recurso sin borrar del Banco', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerMediaEditor.tsx', 'utf8')
  const items = [
    { id: 'asset-1', type: 'image', url: 'https://cdn.test/a.png' },
    { id: 'asset-2', type: 'image', url: 'https://cdn.test/b.png' },
  ]
  assert.deepEqual(helper.removeDynamicMarkerMediaItem(items, 'asset-1').map((item) => item.id), ['asset-2'])
  assert.match(source, /Quitar de esta ficha/)
  assert.doesNotMatch(source, /deleteMediaAsset/)
})

test('reordenar actualiza sort_order y portada usa primera imagen publica', () => {
  const items = [
    { id: 'asset-1', type: 'image', url: 'https://cdn.test/a.png' },
    { id: 'asset-2', type: 'image', url: 'https://cdn.test/b.png' },
  ]
  const moved = helper.moveDynamicMarkerMediaItem(items, 'asset-2', -1)
  assert.deepEqual(moved.map((item) => item.id), ['asset-2', 'asset-1'])
  assert.deepEqual(moved.map((item) => item.sort_order), [0, 1])
  assert.equal(helper.getDynamicMarkerThumbnail(moved), 'https://cdn.test/b.png')
})

test('audio no es portada y video no desplaza imagen disponible', () => {
  const items = [
    { id: 'audio', type: 'audio', url: 'https://cdn.test/a.mp3', sort_order: 0, visibility: 'public' },
    { id: 'video', type: 'video', url: 'https://cdn.test/a.mp4', poster_url: 'https://cdn.test/poster.png', sort_order: 1, visibility: 'public' },
    { id: 'image', type: 'image', url: 'https://cdn.test/a.png', sort_order: 2, visibility: 'public' },
  ]
  assert.equal(helper.getDynamicMarkerThumbnail(items), 'https://cdn.test/a.png')
})

test('autosave guarda media_json y error humano conserva lista anterior', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerMediaEditor.tsx', 'utf8')
  assert.match(source, /window\.setTimeout/)
  assert.match(source, /api\.dynamicMarkers\.update\(marker\.id, \{ media_json: payload \}\)/)
  assert.match(source, /No pudimos guardar los cambios de multimedia/)
})

test('Banco en modo media lista y sube recursos multimedia sin crear endpoint paralelo', async () => {
  const picker = await readFile('apps/dashboard/src/components/MediaPicker.tsx', 'utf8')
  const api = await readFile('apps/dashboard/src/lib/api.ts', 'utf8')
  const upload = await readFile('apps/api/src/routes/upload.ts', 'utf8')
  assert.match(picker, /type MediaPickerMode = 'image' \| 'media' \| 'pages' \| 'svg'/)
  assert.match(picker, /kind: mode === 'media' \? 'media' : 'image'/)
  assert.match(api, /kind\?: 'image' \| 'media'/)
  assert.match(upload, /kind debe ser image o media/)
  assert.equal(upload.includes('video/mp4'), true)
  assert.equal(upload.includes('audio/mpeg'), true)
})

test('DynamicMarkerPanel conserva rehidratacion por action.marker_id', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerPanel.tsx', 'utf8')
  assert.match(source, /getDynamicMarkerActionMarkerId/)
  assert.match(source, /api\.dynamicMarkers\.get\(linkedSelection\.markerId\)/)
})

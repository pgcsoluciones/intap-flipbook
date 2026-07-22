import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadDashboardModule(entry, name) {
  const dir = await mkdtemp(join(tmpdir(), `${name}-test-`))
  const outfile = join(dir, `${name}.mjs`)
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: ['canvas'],
    define: {
      'import.meta.env.VITE_API_BASE_URL': '"http://api.test"',
    },
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { ...mod, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

function installFetchRecorder(response = { success: true, data: [] }) {
  const calls = []
  globalThis.localStorage = { getItem: () => 'token-test' }
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return calls
}

test('mediaFolders contract uses upload folder endpoints', async () => {
  const mod = await loadDashboardModule('apps/dashboard/src/lib/api.ts', 'dashboard-api-folders')
  const calls = installFetchRecorder({ success: true, data: [{ id: 'folder-1', name: 'Folder', asset_count: 0 }] })
  try {
    await mod.api.mediaFolders.list('pub-1')
    await mod.api.mediaFolders.create({ publication_id: 'pub-1', name: 'Folder' })
    await mod.api.mediaFolders.rename('folder-1', 'Renamed')
    await mod.api.mediaFolders.remove('folder-1')

    assert.equal(calls[0].url, 'http://api.test/api/upload/media-folders?publication_id=pub-1')
    assert.equal(calls[1].url, 'http://api.test/api/upload/media-folders')
    assert.equal(calls[1].init.method, 'POST')
    assert.equal(JSON.parse(calls[1].init.body).name, 'Folder')
    assert.equal(calls[2].url, 'http://api.test/api/upload/media-folders/folder-1')
    assert.equal(calls[2].init.method, 'PATCH')
    assert.equal(calls[3].url, 'http://api.test/api/upload/media-folders/folder-1')
    assert.equal(calls[3].init.method, 'DELETE')
  } finally {
    await mod.cleanup()
  }
})

test('mediaAssets list, move and upload preserve folder_id contract', async () => {
  const mod = await loadDashboardModule('apps/dashboard/src/lib/api.ts', 'dashboard-api-assets')
  const calls = installFetchRecorder({ success: true, data: { moved_count: 2, folder_id: null } })
  try {
    await mod.api.mediaAssets.list({ publication_id: 'pub-1', folder_id: null, q: 'hero', page: 2, limit: 12 })
    await mod.api.mediaAssets.list({ publication_id: 'pub-1', folder_id: 'folder-1' })
    await mod.api.mediaAssets.move({ publication_id: 'pub-1', asset_ids: ['a1', 'a2'], folder_id: null })
    await mod.api.mediaAssets.upload({
      publication_id: 'pub-1',
      folder_id: 'folder-1',
      file: new File(['x'], 'hero.png', { type: 'image/png' }),
    })

    assert.match(calls[0].url, /folder_id=unfiled/)
    assert.match(calls[0].url, /q=hero/)
    assert.match(calls[1].url, /folder_id=folder-1/)
    assert.equal(calls[2].url, 'http://api.test/api/upload/media-assets/move')
    assert.deepEqual(JSON.parse(calls[2].init.body), { publication_id: 'pub-1', asset_ids: ['a1', 'a2'], folder_id: null })
    assert.equal(calls[3].url, 'http://api.test/api/upload/media-assets')
    assert.equal(calls[3].init.body.get('publication_id'), 'pub-1')
    assert.equal(calls[3].init.body.get('folder_id'), 'folder-1')
  } finally {
    await mod.cleanup()
  }
})

test('MediaPicker folder helpers keep legacy out of folders and block mixed moves', async () => {
  const mod = await loadDashboardModule('apps/dashboard/src/components/MediaPicker.tsx', 'media-picker-folders')
  try {
    assert.equal(mod.shouldShowLegacyForFolder(undefined), true)
    assert.equal(mod.shouldShowLegacyForFolder(null), true)
    assert.equal(mod.shouldShowLegacyForFolder('folder-1'), false)
    assert.equal(mod.canMoveMediaPickerSelection([{ asset: { id: 'a1' } }]), true)
    assert.equal(mod.canMoveMediaPickerSelection([{ asset: { id: 'a1' } }, {}]), false)
    assert.equal(mod.canMoveMediaPickerSelection([]), false)
  } finally {
    await mod.cleanup()
  }
})

test('MediaPicker move requires explicit valid destination before executing', async () => {
  const mod = await loadDashboardModule('apps/dashboard/src/components/MediaPicker.tsx', 'media-picker-move-target')
  try {
    const items = [{ key: 'asset:a1', asset: { id: 'a1', folder_id: 'folder-1' } }]
    assert.equal(mod.canExecuteMediaMove(items, undefined), false)
    assert.equal(mod.canExecuteMediaMove(items, 'folder-1'), false)
    assert.equal(mod.canExecuteMediaMove(items, null), true)
    assert.equal(mod.canExecuteMediaMove(items, null, true), false)
  } finally {
    await mod.cleanup()
  }
})

test('moving selected assets calls move endpoint once with selected ids', async () => {
  const mod = await loadDashboardModule('apps/dashboard/src/lib/api.ts', 'dashboard-api-move-selected')
  const calls = installFetchRecorder({ success: true, data: { moved_count: 2, folder_id: 'folder-2' } })
  try {
    await mod.api.mediaAssets.move({ publication_id: 'pub-1', asset_ids: ['a1', 'a2'], folder_id: 'folder-2' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'http://api.test/api/upload/media-assets/move')
    assert.deepEqual(JSON.parse(calls[0].init.body), { publication_id: 'pub-1', asset_ids: ['a1', 'a2'], folder_id: 'folder-2' })
  } finally {
    await mod.cleanup()
  }
})

test('dragging an unselected image moves only that image', async () => {
  const mod = await loadDashboardModule('apps/dashboard/src/components/MediaPicker.tsx', 'media-picker-drag-single')
  try {
    const dragged = { key: 'asset:a3', asset: { id: 'a3' } }
    const selected = [
      { key: 'asset:a1', asset: { id: 'a1' } },
      { key: 'asset:a2', asset: { id: 'a2' } },
    ]
    assert.deepEqual(mod.selectedMediaAssetIdsForMove(dragged, selected), ['a3'])
  } finally {
    await mod.cleanup()
  }
})

test('dragging a selected image moves the selected asset set', async () => {
  const mod = await loadDashboardModule('apps/dashboard/src/components/MediaPicker.tsx', 'media-picker-drag-set')
  try {
    const dragged = { key: 'asset:a2', asset: { id: 'a2' } }
    const selected = [
      { key: 'asset:a1', asset: { id: 'a1' } },
      { key: 'asset:a2', asset: { id: 'a2' } },
    ]
    assert.deepEqual(mod.selectedMediaAssetIdsForMove(dragged, selected), ['a1', 'a2'])
  } finally {
    await mod.cleanup()
  }
})

test('legacy assets cannot be moved by drag or selection', async () => {
  const mod = await loadDashboardModule('apps/dashboard/src/components/MediaPicker.tsx', 'media-picker-legacy-move')
  try {
    assert.deepEqual(mod.selectedMediaAssetIdsForMove({ key: 'legacy:u' }, []), [])
    assert.deepEqual(mod.selectedMediaAssetIdsForMove(
      { key: 'asset:a1', asset: { id: 'a1' } },
      [{ key: 'asset:a1', asset: { id: 'a1' } }, { key: 'legacy:u' }],
    ), [])
  } finally {
    await mod.cleanup()
  }
})

test('folder badge labels Banco general and named folders', async () => {
  const mod = await loadDashboardModule('apps/dashboard/src/components/MediaPicker.tsx', 'media-picker-folder-badges')
  try {
    assert.equal(mod.mediaFolderLabel(null, [{ id: 'folder-1', name: 'Campaña' }]), 'Banco general')
    assert.equal(mod.mediaFolderLabel(undefined, [{ id: 'folder-1', name: 'Campaña' }]), 'Banco general')
    assert.equal(mod.mediaFolderLabel('folder-1', [{ id: 'folder-1', name: 'Campaña' }]), 'Campaña')
  } finally {
    await mod.cleanup()
  }
})

test('deleted active quick-bank folder falls back to Banco general before listing assets', async () => {
  const mod = await loadDashboardModule('apps/dashboard/src/components/MediaPicker.tsx', 'media-picker-deleted-folder-fallback')
  const apiMod = await loadDashboardModule('apps/dashboard/src/lib/api.ts', 'media-picker-deleted-folder-api')
  const calls = installFetchRecorder({ success: true, data: [], page: { limit: 12, page: 1, total: 2, total_pages: 1, has_more: false, next_cursor: null } })
  try {
    const fallbackFolder = mod.resolveExistingMediaFolderFilter('folder-deleted', [{ id: 'folder-live' }])
    assert.equal(fallbackFolder, null)
    assert.equal(mod.resolveExistingMediaFolderFilter('folder-live', [{ id: 'folder-live' }]), 'folder-live')
    assert.equal(mod.resolveExistingMediaFolderFilter(null, [{ id: 'folder-live' }]), null)
    assert.equal(mod.resolveExistingMediaFolderFilter(undefined, [{ id: 'folder-live' }]), undefined)
    await apiMod.api.mediaAssets.list({ publication_id: 'pub-1', limit: 12, page: 1, folder_id: fallbackFolder })
    assert.match(calls[0].url, /limit=12/)
    assert.match(calls[0].url, /page=1/)
    assert.match(calls[0].url, /folder_id=unfiled/)
  } finally {
    await mod.cleanup()
    await apiMod.cleanup()
  }
})

test('drop asset ids prefer immediate ref and fall back to dataTransfer', async () => {
  const mod = await loadDashboardModule('apps/dashboard/src/components/MediaPicker.tsx', 'media-picker-drop-ids')
  try {
    assert.deepEqual(mod.resolveDropMediaAssetIds(['a1', 'a2'], 'a3'), ['a1', 'a2'])
    assert.deepEqual(mod.resolveDropMediaAssetIds([], 'a3,a4'), ['a3', 'a4'])
    assert.deepEqual(mod.resolveDropMediaAssetIds([], '  a5, ,a6 '), ['a5', 'a6'])
    assert.deepEqual(mod.resolveDropMediaAssetIds([], ''), [])
  } finally {
    await mod.cleanup()
  }
})

test('editor quick media bank can request paginated folder-filtered assets', async () => {
  const mod = await loadDashboardModule('apps/dashboard/src/lib/api.ts', 'editor-quick-bank-api')
  const calls = installFetchRecorder({ success: true, data: [], page: { limit: 12, page: 1, total: 0, total_pages: 1, has_more: false, next_cursor: null } })
  try {
    await mod.api.mediaAssets.list({ publication_id: 'pub-1', limit: 12, page: 1, folder_id: 'folder-1' })
    assert.match(calls[0].url, /limit=12/)
    assert.match(calls[0].url, /page=1/)
    assert.match(calls[0].url, /folder_id=folder-1/)
  } finally {
    await mod.cleanup()
  }
})

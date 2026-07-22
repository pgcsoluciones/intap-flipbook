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

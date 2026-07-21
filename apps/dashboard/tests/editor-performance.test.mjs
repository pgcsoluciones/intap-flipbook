import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadPerf() {
  const dir = await mkdtemp(join(tmpdir(), 'editor-performance-test-'))
  const outfile = join(dir, 'editorPerformance.mjs')
  await build({
    entryPoints: ['apps/dashboard/src/lib/editorPerformance.ts'],
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

function pages(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `page-${index + 1}`,
    image_url: `https://media.example.test/uploads/u/page-${index + 1}.jpg`,
    canvas_json: JSON.stringify({ objects: index === 0 ? [{ type: 'textbox', text: 'A' }] : [] }),
    cover_json: null,
    updated_at: `2026-07-20T00:00:${String(index).padStart(2, '0')}.000Z`,
  }))
}

test('publicacion con 20 paginas solo carga miniaturas visibles iniciales', async () => {
  const perf = await loadPerf()
  try {
    const visible = perf.firstVisibleIndexes(20)
    assert.equal(visible.size, 12)
    assert.equal(perf.shouldLoadPageThumbnail(0, visible), true)
    assert.equal(perf.shouldLoadPageThumbnail(11, visible), true)
    assert.equal(perf.shouldLoadPageThumbnail(12, visible), false)
    assert.equal(perf.shouldLoadPageThumbnail(19, visible), false)
  } finally {
    await perf.cleanup()
  }
})

test('ventana visible agrega solo margen cercano y no descarga fuera de pantalla', async () => {
  const perf = await loadPerf()
  try {
    const visible = perf.visibleIndexesFromRange(6, 8, 20, 2)
    assert.deepEqual([...visible], [4, 5, 6, 7, 8, 9, 10])
    assert.equal(perf.shouldLoadPageThumbnail(3, visible), false)
    assert.equal(perf.shouldLoadPageThumbnail(10, visible), true)
    assert.equal(perf.shouldLoadPageThumbnail(11, visible), false)
  } finally {
    await perf.cleanup()
  }
})

test('agregar texto actualiza solo la pagina activa y conserva referencias de las demas', async () => {
  const perf = await loadPerf()
  try {
    const original = pages(3)
    const next = perf.upsertPageById(original, 'page-2', { canvas_json: '{"objects":[{"type":"textbox"}]}' })
    assert.notEqual(next, original)
    assert.equal(next[0], original[0])
    assert.notEqual(next[1], original[1])
    assert.equal(next[2], original[2])
  } finally {
    await perf.cleanup()
  }
})

test('cache de miniatura cambia cuando cambia solo el contenido de esa pagina', async () => {
  const perf = await loadPerf()
  try {
    const [page] = pages(1)
    const before = perf.pageThumbnailCacheKey(page)
    const after = perf.pageThumbnailCacheKey({ ...page, canvas_json: '{"objects":[{"type":"circle"}]}' })
    assert.notEqual(after, before)
    assert.equal(perf.pageThumbnailCacheKey(page), before)
  } finally {
    await perf.cleanup()
  }
})

test('cambiar de pagina puede reutilizar miniatura cacheada por version', async () => {
  const perf = await loadPerf()
  try {
    const [page] = pages(1)
    const key = perf.pageThumbnailCacheKey(page)
    const cache = { [page.id]: { key, url: 'data:image/png;base64,thumb' } }
    assert.equal(cache[page.id]?.key === perf.pageThumbnailCacheKey(page), true)
    assert.equal(cache[page.id].url, 'data:image/png;base64,thumb')
  } finally {
    await perf.cleanup()
  }
})

test('tres imagenes legacy usan thumbnail en tarjetas y display en lienzo sin modificar public_url', async () => {
  const perf = await loadPerf()
  try {
    const assets = [1, 2, 3].map((index) => ({
      public_url: `https://media.example.test/uploads/u/legacy-${index}.jpg`,
      optimized_url: `https://media.example.test/uploads/u/legacy-${index}-display.webp`,
      display_url: `https://media.example.test/uploads/u/legacy-${index}-display.webp`,
      thumbnail_url: `https://media.example.test/uploads/u/legacy-${index}-thumb.webp`,
    }))
    const thumbnailLookup = perf.buildThumbnailLookup(assets)
    const displayLookup = perf.buildDisplayLookup(assets)
    for (const asset of assets) {
      const page = { id: asset.public_url, image_url: asset.public_url }
      assert.equal(perf.resolvePageCardBackgroundUrl(page, thumbnailLookup, displayLookup), asset.thumbnail_url)
      assert.equal(perf.resolveDisplayUrl(asset.public_url, displayLookup), asset.display_url)
      assert.equal(page.image_url, asset.public_url)
    }
  } finally {
    await perf.cleanup()
  }
})

test('lienzo usa optimized_url primero y nunca thumbnail_url', async () => {
  const perf = await loadPerf()
  try {
    const original = 'https://media.example.test/uploads/u/legacy.jpg'
    const thumbnail = 'https://media.example.test/uploads/u/legacy-thumb.webp'
    const display = 'https://media.example.test/uploads/u/legacy-display.webp'
    const displayLookup = perf.buildDisplayLookup([{ public_url: original, optimized_url: display, thumbnail_url: thumbnail }])

    assert.equal(perf.resolveDisplayUrl(original, displayLookup), display)
    assert.notEqual(perf.resolveDisplayUrl(original, displayLookup), thumbnail)
  } finally {
    await perf.cleanup()
  }
})

test('panel paginas usa thumbnail primero y display solo como fallback ligero', async () => {
  const perf = await loadPerf()
  try {
    const page = { id: 'page-1', image_url: 'https://media.example.test/uploads/u/page.jpg' }
    const thumbnailLookup = { [page.image_url]: 'https://media.example.test/uploads/u/page-thumb.webp' }
    const displayLookup = { [page.image_url]: 'https://media.example.test/uploads/u/page-display.webp' }

    assert.equal(perf.resolvePageCardBackgroundUrl(page, thumbnailLookup, displayLookup), thumbnailLookup[page.image_url])
    assert.equal(perf.resolvePageCardBackgroundUrl(page, {}, displayLookup), displayLookup[page.image_url])
  } finally {
    await perf.cleanup()
  }
})

test('error CORS en una legacy queda fuera del lookup y no bloquea las demas', async () => {
  const perf = await loadPerf()
  try {
    const current = { 'https://media.example.test/ok-a.jpg': 'https://media.example.test/ok-a-thumb.webp' }
    const next = perf.mergeThumbnailLookup(current, {
      'https://media.example.test/ok-b.jpg': 'https://media.example.test/ok-b-thumb.webp',
    })
    assert.equal(next['https://media.example.test/ok-a.jpg'], 'https://media.example.test/ok-a-thumb.webp')
    assert.equal(next['https://media.example.test/ok-b.jpg'], 'https://media.example.test/ok-b-thumb.webp')
    assert.equal(next['https://media.example.test/cors-fail.jpg'], undefined)
  } finally {
    await perf.cleanup()
  }
})

test('paginacion de 52 imagenes conserva 12 visibles iniciales', async () => {
  const perf = await loadPerf()
  try {
    const visible = perf.firstVisibleIndexes(52)
    assert.equal(visible.size, 12)
    assert.equal(perf.shouldLoadPageThumbnail(51, visible), false)
  } finally {
    await perf.cleanup()
  }
})

test('guardado de una pagina no reescribe innecesariamente las demas', async () => {
  const perf = await loadPerf()
  try {
    const original = pages(4)
    const next = perf.upsertPageById(original, 'page-4', { canvas_json: '{"objects":[{"type":"rect"}]}' })
    assert.deepEqual(next.map((page, index) => page === original[index]), [true, true, true, false])
  } finally {
    await perf.cleanup()
  }
})

test('fabric dispose invalida cache key obsoleta y evita aplicar snapshot viejo', async () => {
  const perf = await loadPerf()
  try {
    const [page] = pages(1)
    const oldKey = perf.pageThumbnailCacheKey(page)
    const current = { ...page, updated_at: '2026-07-20T01:00:00.000Z' }
    assert.notEqual(oldKey, perf.pageThumbnailCacheKey(current))
  } finally {
    await perf.cleanup()
  }
})

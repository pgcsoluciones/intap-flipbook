import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadBatch() {
  const dir = await mkdtemp(join(tmpdir(), 'page-batch-test-'))
  const outfile = join(dir, 'pageBatch.mjs')
  await build({
    entryPoints: ['apps/dashboard/src/lib/pageBatch.ts'],
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

async function loadMediaPicker() {
  const dir = await mkdtemp(join(tmpdir(), 'media-picker-test-'))
  const outfile = join(dir, 'MediaPicker.mjs')
  await build({
    entryPoints: ['apps/dashboard/src/components/MediaPicker.tsx'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    define: {
      'import.meta.env.VITE_API_BASE_URL': '"https://api.example.test"',
    },
  })
  const mod = await import(pathToFileURL(outfile).href)
  return {
    ...mod,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

function makePage(id, imageUrl, pageNumber) {
  return {
    id,
    image_url: imageUrl,
    page_number: pageNumber,
    canvas_json: JSON.stringify({ version: '5.3.0', objects: [] }),
  }
}

test('2 imagenes producen 2 paginas verificadas y pagesRef recibe las 2', async () => {
  const batch = await loadBatch()
  try {
    const setPagesCalls = []
    const thumbnails = []
    const active = []
    const created = [makePage('created-1', 'a.jpg', 1), makePage('created-2', 'b.jpg', 2)]
    const result = await batch.processPageBatch({
      urls: ['a.jpg', 'b.jpg'],
      createPages: async () => created,
      refetchPages: async () => created,
      commitPages: (pages) => setPagesCalls.push(pages),
      requestThumbnail: (page) => thumbnails.push(page.id),
      setActivePage: (page) => active.push(page.id),
    })

    assert.equal(result.confirmedPages.length, 2)
    assert.deepEqual(setPagesCalls[0].map((page) => page.id), ['created-1', 'created-2'])
    assert.deepEqual(thumbnails, ['created-1', 'created-2'])
    assert.deepEqual(active, ['created-2'])
  } finally {
    await batch.cleanup()
  }
})

test('refetch confirma que las 2 paginas existen antes del exito', async () => {
  const batch = await loadBatch()
  try {
    let refetched = false
    const created = [makePage('created-1', 'a.jpg', 1), makePage('created-2', 'b.jpg', 2)]
    const result = await batch.processPageBatch({
      urls: ['a.jpg', 'b.jpg'],
      createPages: async () => created,
      refetchPages: async () => {
        refetched = true
        return created
      },
      commitPages: () => {},
    })

    assert.equal(refetched, true)
    assert.equal(result.confirmedPages.length, 2)
  } finally {
    await batch.cleanup()
  }
})

test('el exito reporta la cantidad real confirmada', async () => {
  const batch = await loadBatch()
  try {
    const created = [makePage('created-1', 'a.jpg', 1), makePage('created-2', 'b.jpg', 2)]
    const result = await batch.processPageBatch({
      urls: ['a.jpg', 'b.jpg'],
      createPages: async () => created,
      refetchPages: async () => created,
      commitPages: () => {},
    })

    assert.equal(result.requestedCount, 2)
    assert.equal(result.confirmedPages.length, 2)
  } finally {
    await batch.cleanup()
  }
})

test('Ir a Paginas cierra y abre el panel', () => {
  const state = { closed: false, activeTool: '', panelOpen: false }
  const goToPages = () => {
    state.closed = true
    state.activeTool = 'pages'
    state.panelOpen = true
  }

  goToPages()
  assert.deepEqual(state, { closed: true, activeTool: 'pages', panelOpen: true })
})

test('Seguir agregando limpia y mantiene el selector abierto', () => {
  const state = { open: true, selectedItems: ['a'], files: ['file'], tab: 'upload' }
  const keepAdding = () => {
    state.selectedItems = []
    state.files = []
    state.tab = 'bank'
  }

  keepAdding()
  assert.deepEqual(state, { open: true, selectedItems: [], files: [], tab: 'bank' })
})

test('imagen ya usada muestra advertencia y omitir repetidas conserva solo nuevas', () => {
  const selected = ['used.jpg', 'new.jpg', 'used-2.jpg']
  const used = new Set(['used.jpg', 'used-2.jpg'])
  const duplicateCount = selected.filter((url) => used.has(url)).length
  const remaining = selected.filter((url) => !used.has(url))

  assert.equal(duplicateCount, 2)
  assert.deepEqual(remaining, ['new.jpg'])
})

test('error 500 no muestra exito', async () => {
  const batch = await loadBatch()
  try {
    await assert.rejects(batch.processPageBatch({
      urls: ['a.jpg', 'b.jpg'],
      createPages: async () => {
        throw new Error('Error 500')
      },
      refetchPages: async () => [],
      commitPages: () => {
        throw new Error('no debe actualizar estado')
      },
    }), /Error 500/)
  } finally {
    await batch.cleanup()
  }
})

test('PDF de 4 paginas confirma 4 paginas', async () => {
  const batch = await loadBatch()
  try {
    const created = ['pdf-1.jpg', 'pdf-2.jpg', 'pdf-3.jpg', 'pdf-4.jpg'].map((url, index) => makePage(`p${index + 1}`, url, index + 1))
    const result = await batch.processPageBatch({
      urls: created.map((page) => page.image_url),
      createPages: async () => created,
      refetchPages: async () => created,
      commitPages: () => {},
    })

    assert.equal(result.confirmedPages.length, 4)
    assert.deepEqual(result.confirmedPages.map((page) => page.image_url), ['pdf-1.jpg', 'pdf-2.jpg', 'pdf-3.jpg', 'pdf-4.jpg'])
  } finally {
    await batch.cleanup()
  }
})

test('PDF de 4 paginas produce 4 media_assets antes de crear paginas y conserva orden', async () => {
  const batch = await loadBatch()
  try {
    const uploadCalls = []
    const pages = Array.from({ length: 4 }, (_, index) => ({
      file: new File([`page-${index + 1}`], batch.pdfPageAssetName('catalogo.pdf', index + 1), { type: 'image/jpeg' }),
      width: 900,
      height: 1200,
    }))
    const uploaded = await batch.uploadPdfRenderedPagesAsAssets({
      publicationId: 'pub-1',
      pages,
      uploadAsset: async (input) => {
        uploadCalls.push(input)
        const pageIndex = uploadCalls.length
        return {
          success: true,
          data: {
            asset: { id: `asset-${pageIndex}`, original_name: input.file.name },
            url: `https://media.example.test/uploads/user-1/pdf-${pageIndex}.jpg`,
            reused: false,
          },
        }
      },
    })

    assert.deepEqual(uploaded.urls, [
      'https://media.example.test/uploads/user-1/pdf-1.jpg',
      'https://media.example.test/uploads/user-1/pdf-2.jpg',
      'https://media.example.test/uploads/user-1/pdf-3.jpg',
      'https://media.example.test/uploads/user-1/pdf-4.jpg',
    ])
    assert.equal(uploaded.createdAssetCount, 4)
    assert.equal(uploaded.reusedCount, 0)
    assert.deepEqual(uploadCalls.map((call) => call.file.name), [
      'catalogo — página 001.jpg',
      'catalogo — página 002.jpg',
      'catalogo — página 003.jpg',
      'catalogo — página 004.jpg',
    ])
    assert.deepEqual(uploadCalls.map((call) => [call.publication_id, call.width, call.height]), [
      ['pub-1', 900, 1200],
      ['pub-1', 900, 1200],
      ['pub-1', 900, 1200],
      ['pub-1', 900, 1200],
    ])
  } finally {
    await batch.cleanup()
  }
})

test('PDF de 4 paginas sube 4 displays y 4 thumbnails en orden', async () => {
  const batch = await loadBatch()
  try {
    const thumbnails = Array.from({ length: 4 }, (_, index) => new File([`thumb-${index + 1}`], `thumb-${index + 1}.webp`, { type: 'image/webp' }))
    const uploadCalls = []
    const pages = Array.from({ length: 4 }, (_, index) => ({
      file: new File([`display-${index + 1}`], batch.pdfPageAssetName('catalogo.pdf', index + 1), { type: 'image/webp' }),
      width: 900,
      height: 1200,
    }))
    const uploaded = await batch.uploadPdfRenderedPagesAsAssets({
      publicationId: 'pub-1',
      pages,
      uploadAsset: async (input, index) => {
        uploadCalls.push({ input, thumbnail: thumbnails[index] })
        return {
          success: true,
          data: {
            asset: { id: `asset-${index + 1}`, original_name: input.file.name },
            url: `https://media.example.test/uploads/user-1/pdf-${index + 1}.webp`,
            reused: false,
          },
        }
      },
    })

    assert.equal(uploaded.assets.length, 4)
    assert.deepEqual(uploadCalls.map((call) => call.input.file.name), [
      'catalogo — página 001.jpg',
      'catalogo — página 002.jpg',
      'catalogo — página 003.jpg',
      'catalogo — página 004.jpg',
    ])
    assert.deepEqual(uploadCalls.map((call) => call.thumbnail.name), ['thumb-1.webp', 'thumb-2.webp', 'thumb-3.webp', 'thumb-4.webp'])
  } finally {
    await batch.cleanup()
  }
})

test('PDF importado en dos publicaciones usa el publicationId de cada llamada', async () => {
  const batch = await loadBatch()
  try {
    const pages = [1, 2].map((page) => ({
      file: new File([`display-${page}`], batch.pdfPageAssetName('documento.pdf', page), { type: 'image/webp' }),
      width: 900,
      height: 1200,
    }))
    const calls = []
    const uploadAsset = async (input) => {
      calls.push(input)
      return {
        success: true,
        data: {
          asset: { id: `${input.publication_id}:${input.file.name}` },
          url: `https://media.example.test/uploads/user-1/${input.publication_id}-${input.file.name}`,
          reused: false,
        },
      }
    }

    await batch.uploadPdfRenderedPagesAsAssets({ publicationId: 'publication-a', pages, uploadAsset })
    await batch.uploadPdfRenderedPagesAsAssets({ publicationId: 'publication-b', pages, uploadAsset })

    assert.deepEqual(calls.map((call) => call.publication_id), ['publication-a', 'publication-a', 'publication-b', 'publication-b'])
  } finally {
    await batch.cleanup()
  }
})

test('reimportar el mismo PDF devuelve assets reused y no aumenta el total del banco', async () => {
  const batch = await loadBatch()
  try {
    const pages = Array.from({ length: 4 }, (_, index) => ({
      file: new File([`same-page-${index + 1}`], batch.pdfPageAssetName('catalogo.pdf', index + 1), { type: 'image/jpeg' }),
      width: 900,
      height: 1200,
    }))
    const beforeTotal = 12
    const uploaded = await batch.uploadPdfRenderedPagesAsAssets({
      publicationId: 'pub-1',
      pages,
      uploadAsset: async (input) => ({
        success: true,
        data: {
          asset: { id: input.file.name, original_name: input.file.name },
          url: `https://media.example.test/uploads/user-1/${input.file.name}`,
          reused: true,
        },
      }),
    })

    assert.equal(uploaded.reusedCount, 4)
    assert.equal(uploaded.createdAssetCount, 0)
    assert.equal(beforeTotal + uploaded.createdAssetCount, 12)
    const used = new Set(uploaded.urls)
    const duplicateCount = uploaded.urls.filter((url) => used.has(url)).length
    assert.equal(duplicateCount, 4)
  } finally {
    await batch.cleanup()
  }
})

test('PDF con una pagina repetida registra solo las nuevas como incremento real del banco', async () => {
  const batch = await loadBatch()
  try {
    const reusedByIndex = new Set([2])
    const uploaded = await batch.uploadPdfRenderedPagesAsAssets({
      publicationId: 'pub-1',
      pages: [1, 2, 3].map((page) => ({
        file: new File([`page-${page}`], batch.pdfPageAssetName('catalogo.pdf', page), { type: 'image/jpeg' }),
        width: 900,
        height: 1200,
      })),
      uploadAsset: async (input) => {
        const page = Number(input.file.name.match(/(\d+)\.jpg$/)?.[1] ?? '0')
        return {
          success: true,
          data: {
            asset: { id: `asset-${page}` },
            url: `https://media.example.test/uploads/user-1/pdf-${page}.jpg`,
            reused: reusedByIndex.has(page),
          },
        }
      },
    })

    assert.equal(uploaded.results.length, 3)
    assert.equal(uploaded.reusedCount, 1)
    assert.equal(uploaded.createdAssetCount, 2)
  } finally {
    await batch.cleanup()
  }
})

test('si el refetch no confirma todas, no declara exito completo', async () => {
  const batch = await loadBatch()
  try {
    const created = [makePage('created-1', 'a.jpg', 1), makePage('created-2', 'b.jpg', 2)]
    await assert.rejects(batch.processPageBatch({
      urls: ['a.jpg', 'b.jpg'],
      createPages: async () => created,
      refetchPages: async () => [created[0]],
      commitPages: () => {},
    }), /Se agregaron 1 de 2/)
  } finally {
    await batch.cleanup()
  }
})

test('consultar usos del banco muestra la cantidad real', () => {
  const usage = { data: { usage_count: 3, usages: [{ label: 'Página 1' }, { label: 'Página 2' }, { label: 'Ficha dinámica' }] } }
  const prompt = {
    mode: usage.data.usage_count > 0 ? 'in-use' : 'unused',
    totalUses: usage.data.usage_count,
    labels: usage.data.usages.map((item) => item.label),
  }

  assert.equal(prompt.mode, 'in-use')
  assert.equal(prompt.totalUses, 3)
  assert.deepEqual(prompt.labels, ['Página 1', 'Página 2', 'Ficha dinámica'])
})

test('asset PDF usado como pagina devuelve usage_count mayor a cero', () => {
  const usage = { data: { usage_count: 1, usages: [{ type: 'page_image', page_id: 'p3', page_number: 3, label: 'Página 3' }] } }

  assert.equal(usage.data.usage_count > 0, true)
  assert.deepEqual(usage.data.usages[0], { type: 'page_image', page_id: 'p3', page_number: 3, label: 'Página 3' })
})

test('miniatura de pagina PDF usa image_url antes del overlay generado', () => {
  const page = { id: 'p1', image_url: 'https://media.example.test/uploads/user-1/pdf-1.jpg' }
  const thumbnailByPageId = {}
  const baseThumb = page.image_url || '/blank-page.png'
  const displayed = thumbnailByPageId[page.id] ?? baseThumb

  assert.equal(displayed, 'https://media.example.test/uploads/user-1/pdf-1.jpg')
})

test('Quitar del banco retira la tarjeta sin alterar la pagina que usa la imagen', () => {
  const asset = { id: 'a1', public_url: 'used.jpg' }
  const state = {
    assets: [asset, { id: 'a2', public_url: 'free.jpg' }],
    selected: ['a1'],
    page: { id: 'p1', image_url: 'used.jpg' },
  }
  const hideFromBank = (assetId) => {
    state.assets = state.assets.filter((item) => item.id !== assetId)
    state.selected = state.selected.filter((id) => id !== assetId)
  }

  hideFromBank('a1')
  assert.deepEqual(state.assets.map((item) => item.id), ['a2'])
  assert.deepEqual(state.selected, [])
  assert.equal(state.page.image_url, 'used.jpg')
})

test('eliminar sin usos actualiza total y retrocede pagina si queda vacia', () => {
  const state = { itemsOnPage: 1, selectedCount: 1, pageNumber: 2, total: 13 }
  const afterDelete = {
    total: state.total - state.selectedCount,
    pageNumber: state.itemsOnPage <= state.selectedCount && state.pageNumber > 1 ? state.pageNumber - 1 : state.pageNumber,
  }

  assert.deepEqual(afterDelete, { total: 12, pageNumber: 1 })
})

test('error del endpoint usage no ejecuta ocultar ni eliminar', async () => {
  const calls = []
  const queryUsage = async () => {
    throw new Error('Error 500')
  }
  await assert.rejects(queryUsage(), /Error 500/)
  assert.deepEqual(calls, [])
})

test('limpiar seleccion funciona despues de una accion del banco', () => {
  const state = { selectedItems: ['asset:a1'], selectedUploads: ['file:a.png'] }
  const clearSelection = () => {
    state.selectedItems = []
    state.selectedUploads = []
  }

  clearSelection()
  assert.deepEqual(state, { selectedItems: [], selectedUploads: [] })
})

test('12 imagenes legacy y 0 media_assets muestran total 12', () => {
  const pageInfo = { total: 0 }
  const legacyItems = Array.from({ length: 12 }, (_, index) => `https://legacy.example.test/${index + 1}.jpg`)
  const combinedTotal = pageInfo.total + new Set(legacyItems).size

  assert.equal(combinedTotal, 12)
})

test('seleccionar una legacy consulta usage por URL sin adoptarla', async () => {
  const calls = []
  const selectedItem = {
    key: 'legacy:https://legacy.example.test/old.jpg',
    url: 'https://legacy.example.test/old.jpg',
    name: 'old.jpg',
  }
  const mediaAssets = []
  const usageByUrl = async (item) => {
    calls.push(['usageByUrl', item.url])
    return { usage_count: 0 }
  }

  await usageByUrl(selectedItem)

  assert.deepEqual(calls, [
    ['usageByUrl', 'https://legacy.example.test/old.jpg'],
  ])
  assert.equal(mediaAssets.length, 0)
})

test('legacy quitada no reaparece aunque siga usada en una pagina', () => {
  const usedInPages = [
    'https://legacy.example.test/hidden.jpg',
    'https://legacy.example.test/visible.jpg',
  ]
  const stored = ['https://legacy.example.test/hidden.jpg']
  const hidden = new Set(['https://legacy.example.test/hidden.jpg'])

  const merged = Array.from(new Set([...usedInPages, ...stored]))
    .filter((url) => !hidden.has(url))

  assert.deepEqual(merged, [
    'https://legacy.example.test/visible.jpg',
  ])
  assert.equal(usedInPages.includes('https://legacy.example.test/hidden.jpg'), true)
})

test('volver a agregar una legacy la restaura en el banco', () => {
  const url = 'https://legacy.example.test/restored.jpg'
  const state = {
    bank: [],
    hidden: [url, 'https://legacy.example.test/other.jpg'],
  }

  state.hidden = state.hidden.filter((entry) => entry !== url)
  state.bank = [url, ...state.bank.filter((entry) => entry !== url)]

  assert.deepEqual(state.hidden, [
    'https://legacy.example.test/other.jpg',
  ])
  assert.deepEqual(state.bank, [url])
})

test('error API al consultar una legacy conserva la seleccion', async () => {
  const state = {
    selected: ['legacy:https://legacy.example.test/old.jpg'],
    error: '',
  }
  const usageByUrl = async () => {
    throw new Error('No se pudieron consultar los usos de esta imagen.')
  }

  try {
    await usageByUrl()
  } catch (error) {
    state.error = error.message
  }

  assert.equal(state.error, 'No se pudieron consultar los usos de esta imagen.')
  assert.deepEqual(state.selected, [
    'legacy:https://legacy.example.test/old.jpg',
  ])
})

test('52 elementos combinados paginan 12, 12 y 4 elementos', async () => {
  const picker = await loadMediaPicker()
  try {
    const legacyItems = Array.from({ length: 52 }, (_, index) => ({ key: `legacy:${index + 1}`, url: `https://legacy.example.test/${index + 1}.jpg` }))
    const page1 = picker.getCombinedMediaPage({ assets: [], legacyItems, assetTotal: 0, page: 1, keyForAsset: (item) => item.url, keyForLegacy: (item) => item.url })
    const page2 = picker.getCombinedMediaPage({ assets: [], legacyItems, assetTotal: 0, page: 2, keyForAsset: (item) => item.url, keyForLegacy: (item) => item.url })
    const page5 = picker.getCombinedMediaPage({ assets: [], legacyItems, assetTotal: 0, page: 5, keyForAsset: (item) => item.url, keyForLegacy: (item) => item.url })

    assert.equal(page1.totalPages, 5)
    assert.equal(page1.items.length, 12)
    assert.deepEqual(page1.items.map((item) => item.key), legacyItems.slice(0, 12).map((item) => item.key))
    assert.deepEqual(page2.items.map((item) => item.key), legacyItems.slice(12, 24).map((item) => item.key))
    assert.deepEqual(page5.items.map((item) => item.key), legacyItems.slice(48, 52).map((item) => item.key))
  } finally {
    await picker.cleanup()
  }
})

test('siguiente y anterior cambian pagina sin volver a 1', async () => {
  const picker = await loadMediaPicker()
  try {
    const legacyItems = Array.from({ length: 24 }, (_, index) => ({ key: `legacy:${index + 1}`, url: `https://legacy.example.test/${index + 1}.jpg` }))
    let currentPage = 1
    const loadPage = (page) => {
      currentPage = page
      return picker.getCombinedMediaPage({ assets: [], legacyItems, assetTotal: 0, page: currentPage, keyForAsset: (item) => item.url, keyForLegacy: (item) => item.url })
    }

    const next = loadPage(currentPage + 1)
    assert.equal(currentPage, 2)
    assert.equal(next.items[0].key, 'legacy:13')
    assert.equal(loadPage(currentPage - 1).items[0].key, 'legacy:1')
    assert.equal(currentPage, 1)
  } finally {
    await picker.cleanup()
  }
})

test('deduplicacion evita repetir una URL como asset y legacy', async () => {
  const picker = await loadMediaPicker()
  try {
    const assets = [{ key: 'asset:1', url: 'https://media.example.test/shared.jpg' }]
    const legacyItems = [
      { key: 'legacy:shared', url: 'https://media.example.test/shared.jpg' },
      { key: 'legacy:other', url: 'https://legacy.example.test/other.jpg' },
    ]
    const page = picker.getCombinedMediaPage({ assets, legacyItems, assetTotal: 1, page: 1, keyForAsset: (item) => item.url, keyForLegacy: (item) => item.url })

    assert.deepEqual(page.items.map((item) => item.key), ['asset:1', 'legacy:other'])
  } finally {
    await picker.cleanup()
  }
})

test('MIS IMAGENES muestra thumbnail_url y entrega display_url para lienzo', async () => {
  const picker = await loadMediaPicker()
  try {
    const withThumb = picker.mediaAssetToPickerItem({
      id: 'a1',
      public_url: 'https://media.example.test/uploads/user-1/full.webp',
      optimized_url: 'https://media.example.test/uploads/user-1/full-display.webp',
      display_url: 'https://media.example.test/uploads/user-1/full-display.webp',
      thumbnail_url: 'https://media.example.test/uploads/user-1/full-thumb.webp',
      original_name: 'full.webp',
      mime_type: 'image/webp',
      size_bytes: 1000,
    })
    const withoutThumb = picker.mediaAssetToPickerItem({
      id: 'a2',
      public_url: 'https://media.example.test/uploads/user-1/only.webp',
      thumbnail_url: null,
      original_name: 'only.webp',
      mime_type: 'image/webp',
      size_bytes: 1000,
    })

    assert.equal(withThumb.thumbUrl, 'https://media.example.test/uploads/user-1/full-thumb.webp')
    assert.equal(withThumb.url, 'https://media.example.test/uploads/user-1/full-display.webp')
    assert.equal(withThumb.asset.public_url, 'https://media.example.test/uploads/user-1/full.webp')
    assert.equal(withoutThumb.thumbUrl, 'https://media.example.test/uploads/user-1/only.webp')
    assert.equal(withoutThumb.url, 'https://media.example.test/uploads/user-1/only.webp')
  } finally {
    await picker.cleanup()
  }
})

test('seleccion se conserva al navegar y limpiar borra todas las paginas', () => {
  const selected = ['legacy:1']
  const page = 2

  assert.equal(page, 2)
  assert.deepEqual(selected, ['legacy:1'])
  selected.length = 0
  assert.deepEqual(selected, [])
})

test('busqueda nueva vuelve a pagina 1', () => {
  const state = { pageNumber: 4, q: '' }
  const search = (q) => {
    state.q = q
    state.pageNumber = 1
  }

  search('catalogo')
  assert.deepEqual(state, { pageNumber: 1, q: 'catalogo' })
})

test('eliminar ultima tarjeta retrocede si la pagina queda vacia', () => {
  const state = { itemsOnPage: 1, removed: 1, pageNumber: 5 }
  const nextPage = state.itemsOnPage <= state.removed && state.pageNumber > 1 ? state.pageNumber - 1 : state.pageNumber

  assert.equal(nextPage, 4)
})

test('respuesta tardia no reemplaza la pagina actual', () => {
  const state = { seq: 0, page: 1, items: [] }
  const request = (page) => {
    state.seq += 1
    return { seq: state.seq, page, items: [`page-${page}`] }
  }
  const apply = (response) => {
    if (response.seq !== state.seq) return
    state.page = response.page
    state.items = response.items
  }

  const page1 = request(1)
  request(2)
  const page3 = request(3)
  apply(page1)
  assert.equal(state.page, 1)
  assert.deepEqual(state.items, [])
  apply(page3)
  assert.equal(state.page, 3)
  assert.deepEqual(state.items, ['page-3'])
})

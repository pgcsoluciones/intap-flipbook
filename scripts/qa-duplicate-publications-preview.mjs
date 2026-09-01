import assert from 'node:assert/strict'

const API_BASE = (process.env.QA_API_BASE || 'https://intap-flipbook-api-preview.fliaprince.workers.dev').replace(/\/+$/, '')
const ORIGIN = process.env.QA_ORIGIN || 'https://intap-flipbook-dashboard.pages.dev'
const mode = process.argv[2] || '--run'

function randomSuffix() {
  return `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
}

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`${method} ${path} devolvió HTTP ${response.status} con cuerpo no JSON: ${text.slice(0, 240)}`)
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} devolvió HTTP ${response.status}: ${data?.error || text}`)
  }
  return data
}

function findAction(value, type) {
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = findAction(child, type)
      if (match) return match
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  if (value.type === type) return value
  for (const child of Object.values(value)) {
    const match = findAction(child, type)
    if (match) return match
  }
  return null
}

function findUnrelatedDetailId(value) {
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = findUnrelatedDetailId(child)
      if (match !== null) return match
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  if (value.data && typeof value.data === 'object' && value.data.label === 'dato-no-enlazado') {
    return value.data.detail_id ?? null
  }
  for (const child of Object.values(value)) {
    const match = findUnrelatedDetailId(child)
    if (match !== null) return match
  }
  return null
}

async function register() {
  const suffix = randomSuffix()
  const email = `qa-duplicate-${suffix}@example.invalid`
  const password = `Qa-${crypto.randomUUID()}!`
  const registered = await request('/auth/register', {
    method: 'POST',
    body: {
      email,
      password,
      name: `QA Duplicate ${suffix}`,
      slug: `qa-duplicate-${suffix}`,
    },
  })
  const token = registered?.data?.token
  assert.ok(token, 'registro Preview no devolvió token')
  const me = await request('/auth/me', { token })
  assert.ok(me?.data?.id, 'auth/me no devolvió user_id')
  process.stdout.write(JSON.stringify({
    api_base: API_BASE,
    origin: ORIGIN,
    token,
    user_id: me.data.id,
    email,
  }))
}

async function run() {
  const token = process.env.QA_TOKEN
  assert.ok(token, 'QA_TOKEN es requerido para --run')

  const meBefore = await request('/auth/me', { token })
  assert.equal(meBefore?.data?.plan_id, 'basic', 'el usuario QA debe estar elevado temporalmente a plan basic en Preview')

  const suffix = randomSuffix()
  const sourceTitle = `QA Fuente Duplicación ${suffix}`
  const sourceSlugBase = `qa-fuente-duplicacion-${suffix}`
  const productTitle = `Producto fuente QA ${suffix}`
  const markerName = `Ficha fuente QA ${suffix}`

  const sourcePubResponse = await request('/api/publications', {
    method: 'POST',
    token,
    body: { title: sourceTitle, description: 'QA automática de duplicación', category: 'catalogo' },
  })
  const sourcePub = sourcePubResponse.data
  assert.ok(sourcePub?.id, 'no se creó publicación fuente')

  const sourceProductResponse = await request('/api/product-details', {
    method: 'POST',
    token,
    body: {
      internal_name: `qa-product-${suffix}`,
      title: productTitle,
      description: 'Detalle legado usado para comprobar independencia',
      price: '199.00',
      image_url: 'https://example.com/intap-duplicate-product.png',
      accent_color: '#4F46E5',
      cta_type: 'link',
      cta_label: 'Ver producto',
      cta_target: 'https://example.com/producto',
      status: 'active',
    },
  })
  const sourceProduct = sourceProductResponse.data
  const sourceProductId = Number(sourceProduct?.id)
  assert.ok(Number.isInteger(sourceProductId) && sourceProductId > 0, 'no se creó detalle de producto fuente')

  const sourceMarkerResponse = await request('/api/dynamic-markers/independent', {
    method: 'POST',
    token,
    body: {
      publication_id: sourcePub.id,
      name: markerName,
      reference: `REF-${suffix}`,
      category: 'qa',
      description: 'Ficha dinámica para validar remapeo interno',
      price_minor: 12500,
      currency: 'DOP',
      availability: 'Disponible',
      accent_color: '#F59E0B',
      colors_json: [],
      materials_json: [],
      sizes_json: [],
      measurements_json: [],
      media_json: [{
        id: crypto.randomUUID(),
        type: 'image',
        url: 'https://example.com/intap-duplicate-marker.png',
        visibility: 'public',
        sort_order: 0,
      }],
      actions_json: {
        external_link: {
          enabled: true,
          label: 'Abrir',
          url: 'https://example.com',
        },
      },
      custom_fields_json: [{
        id: crypto.randomUUID(),
        label: 'SKU',
        value: `QA-${suffix}`,
        type: 'text',
        visibility: 'public',
        searchable: true,
        filterable: false,
        sort_order: 0,
      }],
    },
  })
  const sourceMarker = sourceMarkerResponse.data
  assert.ok(sourceMarker?.id, 'no se creó ficha dinámica fuente')

  const sourceCanvas = {
    version: '5.3.0',
    objects: [
      {
        type: 'rect',
        data: {
          elementId: 'qa-marker-object',
          action: { type: 'open_dynamic_marker', marker_id: sourceMarker.id },
        },
      },
      {
        type: 'rect',
        data: {
          elementId: 'qa-product-object',
          action: { type: 'open_product_detail', detail_id: sourceProductId },
        },
      },
      {
        type: 'rect',
        data: {
          label: 'dato-no-enlazado',
          detail_id: sourceProductId,
        },
      },
    ],
  }

  const pageBatchResponse = await request(`/api/publications/${sourcePub.id}/pages/batch`, {
    method: 'POST',
    token,
    body: {
      pages: [{
        image_url: 'https://example.com/intap-duplicate-page.png',
        canvas_json: sourceCanvas,
        title: 'Página fuente QA',
        description: 'Página de control',
        size_bytes: 0,
      }],
    },
  })
  const sourcePage = pageBatchResponse?.data?.pages?.[0] || pageBatchResponse?.pages?.[0]
  assert.ok(sourcePage?.id, 'no se creó página fuente')

  const sourceBefore = await request(`/api/publications/${sourcePub.id}`, { token })
  const sourceSlug = sourceBefore.data.public_slug
  assert.equal(sourceBefore.data.status, 'draft')
  assert.equal(sourceBefore.data.pages.length, 1)
  assert.equal(Number(sourceBefore.data.views_count ?? 0), 0)

  const duplicateResponse = await request(`/api/publications/${sourcePub.id}/duplicate`, {
    method: 'POST',
    token,
    body: {
      title: `Copia QA ${suffix}`,
      public_slug: `qa-copia-${suffix}`,
    },
  })
  const cloneSummary = duplicateResponse.clone_summary || {}
  const copy = duplicateResponse.data
  assert.ok(copy?.id && copy.id !== sourcePub.id, 'la copia debe tener publication_id nuevo')
  assert.equal(copy.status, 'draft')
  assert.equal(Number(copy.views_count ?? 0), 0)
  assert.equal(Number(copy.page_count ?? 0), 1)
  assert.equal(Number(cloneSummary.pages), 1)
  assert.equal(Number(cloneSummary.dynamic_markers), 1)
  assert.equal(Number(cloneSummary.product_details), 1)
  assert.equal(cloneSummary.copied_history, false)
  assert.equal(cloneSummary.reused_physical_media, true)
  assert.equal(cloneSummary.legacy_product_details_reused, false)

  const copyFull = await request(`/api/publications/${copy.id}`, { token })
  assert.equal(copyFull.data.pages.length, 1)
  const copyPage = copyFull.data.pages[0]
  assert.notEqual(copyPage.id, sourcePage.id, 'la página copiada debe tener id nuevo')

  const copiedCanvas = JSON.parse(copyPage.canvas_json)
  const copiedMarkerAction = findAction(copiedCanvas, 'open_dynamic_marker')
  const copiedProductAction = findAction(copiedCanvas, 'open_product_detail')
  assert.ok(copiedMarkerAction?.marker_id, 'canvas copiado perdió vínculo a ficha dinámica')
  const copiedProductId = Number(copiedProductAction?.detail_id)
  assert.ok(Number.isInteger(copiedProductId) && copiedProductId > 0, 'canvas copiado perdió detalle de producto')
  assert.notEqual(copiedProductId, sourceProductId, 'detalle de producto debe ser independiente')
  assert.equal(Number(findUnrelatedDetailId(copiedCanvas)), sourceProductId, 'un detail_id casual no debe remapearse')

  const copyMarkersResponse = await request(`/api/dynamic-markers?publication_id=${encodeURIComponent(copy.id)}`, { token })
  const copyMarkers = copyMarkersResponse.data || []
  assert.equal(copyMarkers.length, 1, 'la copia debe tener una ficha dinámica')
  const copyMarker = copyMarkers[0]
  assert.notEqual(copyMarker.id, sourceMarker.id, 'la ficha dinámica copiada debe tener id nuevo')
  assert.equal(copyMarker.cloned_from_marker_id, sourceMarker.id)
  assert.equal(copiedMarkerAction.marker_id, copyMarker.id, 'canvas debe apuntar a la ficha clonada')

  const copiedProductResponse = await request(`/api/product-details/${copiedProductId}`, { token })
  assert.equal(copiedProductResponse.data.title, productTitle)

  await request(`/api/product-details/${copiedProductId}`, {
    method: 'PUT',
    token,
    body: { title: `Producto copia editado ${suffix}` },
  })
  const originalProductAfter = await request(`/api/product-details/${sourceProductId}`, { token })
  assert.equal(originalProductAfter.data.title, productTitle, 'editar producto de la copia alteró el producto del original')

  await request(`/api/dynamic-markers/${copyMarker.id}`, {
    method: 'PUT',
    token,
    body: { name: `Ficha copia editada ${suffix}` },
  })
  const originalMarkerAfter = await request(`/api/dynamic-markers/${sourceMarker.id}`, { token })
  assert.equal(originalMarkerAfter.data.name, markerName, 'editar ficha dinámica de la copia alteró la original')

  await request(`/api/pages/${copyPage.id}`, {
    method: 'PUT',
    token,
    body: { title: 'Página copia editada QA' },
  })
  const originalAfterPageEdit = await request(`/api/publications/${sourcePub.id}`, { token })
  assert.equal(originalAfterPageEdit.data.pages[0].title, 'Página fuente QA', 'editar página de la copia alteró la original')

  const renamedCopy = await request(`/api/publications/${copy.id}`, {
    method: 'PUT',
    token,
    body: {
      title: `Copia QA renombrada ${suffix}`,
      public_slug: `qa-copia-renombrada-${suffix}`,
    },
  })
  assert.equal(renamedCopy.data.title, `Copia QA renombrada ${suffix}`)
  assert.match(String(renamedCopy.data.public_slug), /^qa-copia-renombrada-/)

  const sourceAfter = await request(`/api/publications/${sourcePub.id}`, { token })
  assert.equal(sourceAfter.data.title, sourceTitle, 'renombrar la copia alteró título fuente')
  assert.equal(sourceAfter.data.public_slug, sourceSlug, 'cambiar slug de copia alteró slug fuente')
  assert.equal(Number(sourceAfter.data.views_count ?? 0), 0, 'la duplicación alteró vistas fuente')

  process.stdout.write(JSON.stringify({
    success: true,
    api_base: API_BASE,
    user_id: meBefore.data.id,
    source_publication_id: sourcePub.id,
    copy_publication_id: copy.id,
    source_page_id: sourcePage.id,
    copy_page_id: copyPage.id,
    source_marker_id: sourceMarker.id,
    copy_marker_id: copyMarker.id,
    source_product_detail_id: sourceProductId,
    copy_product_detail_id: copiedProductId,
    source_slug: sourceSlug,
    copy_slug: renamedCopy.data.public_slug,
    clone_summary: cloneSummary,
    assertions: {
      fresh_publication_identity: true,
      fresh_page_identity: true,
      remapped_dynamic_marker: true,
      independent_legacy_product_detail: true,
      unrelated_detail_id_preserved: true,
      source_unchanged_after_copy_edits: true,
      history_not_copied: true,
    },
  }))
}

if (mode === '--register') {
  await register()
} else if (mode === '--run') {
  await run()
} else {
  throw new Error(`Modo no soportado: ${mode}`)
}

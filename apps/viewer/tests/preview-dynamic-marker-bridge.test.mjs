import assert from 'node:assert/strict'
import test from 'node:test'

async function loadBridge({ payload, search }) {
  const calls = []
  const originalWindow = globalThis.window

  const fakeWindow = {
    location: {
      href: `https://viewer.example.test/catalog${search}`,
      search,
    },
    fetch: async (input) => {
      const url = typeof input === 'string' ? input : input?.url
      calls.push(url)
      return new Response(JSON.stringify({ success: true, data: payload }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  }

  globalThis.window = fakeWindow
  await import(`../src/previewDynamicMarkerFetchBridge.js?test=${Math.random()}`)

  return {
    window: fakeWindow,
    calls,
    restore() {
      if (originalWindow === undefined) delete globalThis.window
      else globalThis.window = originalWindow
    },
  }
}

const search = '?preview=1&preview_token=test-token&api_base=https%3A%2F%2Fapi-preview.example.test'
const payload = {
  cover_image_url: 'https://media.example.test/cover.jpg',
  pages: [{ image_url: 'https://media.example.test/page-1.jpg' }],
  dynamic_markers: [
    {
      id: 'marker-1',
      name: 'Zapato azul',
      reference: 'SKU-001',
      category: 'Calzado',
      description: 'Modelo de prueba',
      price_minor: 250000,
      currency: 'DOP',
      availability: 'Disponible',
      accent_color: '#123456',
      badge_text: 'Nuevo',
      media: [{ type: 'image', url: 'https://media.example.test/marker-1.jpg' }],
      updated_at: '2026-09-04 08:00:00',
    },
    {
      id: 'marker-2',
      name: 'Correa negra',
      reference: 'SKU-002',
      category: 'Accesorios',
      description: 'Cuero',
      price_minor: 150000,
      currency: 'DOP',
      availability: 'Por encargo',
      media: [],
      updated_at: '2026-09-04 07:00:00',
    },
  ],
}

test('Preview intercepta catalogo dinamico por slug y usa el payload autenticado', async () => {
  const ctx = await loadBridge({ payload, search })
  try {
    const response = await ctx.window.fetch('https://api-preview.example.test/view/copia/dynamic-markers/catalog?limit=12&q=zapato')
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.success, true)
    assert.equal(body.data.length, 1)
    assert.equal(body.data[0].id, 'marker-1')
    assert.equal(body.data[0].cover_url, 'https://media.example.test/marker-1.jpg')
    assert.deepEqual(body.meta.filters.categories, ['Accesorios', 'Calzado'])
    assert.equal(ctx.calls.length, 1)
    assert.match(ctx.calls[0], /\/view\/preview\/test-token$/)
  } finally {
    ctx.restore()
  }
})

test('Preview intercepta detalle dinamico sin consultar endpoint publico', async () => {
  const ctx = await loadBridge({ payload, search })
  try {
    const response = await ctx.window.fetch('https://api-preview.example.test/view/copia/dynamic-markers/marker-2')
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.data.id, 'marker-2')
    assert.equal(body.data.name, 'Correa negra')
    assert.equal(ctx.calls.length, 1)
    assert.match(ctx.calls[0], /\/view\/preview\/test-token$/)
  } finally {
    ctx.restore()
  }
})

test('fuera de Preview no se instala el bridge', async () => {
  const originalWindow = globalThis.window
  const calls = []
  const passthrough = async (input) => {
    calls.push(input)
    return new Response('{}', { status: 200 })
  }
  const fakeWindow = {
    location: { href: 'https://flip.intaprd.com/tenant/publicacion', search: '' },
    fetch: passthrough,
  }
  globalThis.window = fakeWindow
  try {
    await import(`../src/previewDynamicMarkerFetchBridge.js?production=${Math.random()}`)
    assert.equal(fakeWindow.fetch, passthrough)
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})

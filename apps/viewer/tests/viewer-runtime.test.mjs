import assert from 'node:assert/strict'
import { test } from 'node:test'

const runtime = await import('../src/viewerRuntime.js')

test('usa optimized_url como imagen principal y nunca thumbnail_url', () => {
  const page = {
    image_url: 'https://media.example.test/original.jpg',
    optimized_url: 'https://media.example.test/display.webp',
    thumbnail_url: 'https://media.example.test/thumb.webp',
  }

  assert.equal(runtime.default?.selectPageImageUrl ? runtime.default.selectPageImageUrl(page) : runtime.selectPageImageUrl(page), page.optimized_url)
})

test('fallback de lectura es optimized_url hacia public_url original', () => {
  const selectPageImageUrl = runtime.default?.selectPageImageUrl ?? runtime.selectPageImageUrl
  assert.equal(selectPageImageUrl({ image_url: 'https://media.example.test/original.jpg' }), 'https://media.example.test/original.jpg')
  assert.equal(selectPageImageUrl({ optimized_url: '', display_url: 'https://media.example.test/display.webp', image_url: 'https://media.example.test/original.jpg' }), 'https://media.example.test/display.webp')
})

test('apertura prioriza portada y primer pliego', () => {
  const startupRealPageNumbers = runtime.default?.startupRealPageNumbers ?? runtime.startupRealPageNumbers

  assert.deepEqual(startupRealPageNumbers(33, false), [1, 2, 3])
  assert.deepEqual(startupRealPageNumbers(33, true), [1, 2])
  assert.deepEqual(startupRealPageNumbers(2, false), [1, 2])
})

test('salto directo prepara destino y paginas cercanas', () => {
  const targetRealPageNumbers = runtime.default?.targetRealPageNumbers ?? runtime.targetRealPageNumbers

  assert.deepEqual(targetRealPageNumbers(14, 33), [14, 15])
  assert.deepEqual(targetRealPageNumbers(1, 33), [1, 2])
  assert.deepEqual(targetRealPageNumbers(33, 33), [33])
})

test('precarga paginas de dos spreads, espera decode y no repite descargas', async () => {
  const nearbyRealPageNumbers = runtime.default?.nearbyRealPageNumbers ?? runtime.nearbyRealPageNumbers
  const createImagePreloader = runtime.default?.createImagePreloader ?? runtime.createImagePreloader
  const created = []
  const decoded = []

  class FakeImage {
    set src(value) {
      this._src = value
      created.push(value)
      queueMicrotask(() => this.onload?.())
    }

    get src() {
      return this._src
    }

    decode() {
      decoded.push(this._src)
      return Promise.resolve()
    }
  }

  assert.deepEqual(nearbyRealPageNumbers(2, 5), [1, 2, 3, 4, 5])
  assert.deepEqual(nearbyRealPageNumbers(1, 5), [1, 2, 3, 4])
  assert.deepEqual(nearbyRealPageNumbers(5, 5), [3, 4, 5])

  const preloader = createImagePreloader(FakeImage)
  const first = preloader.preload('https://media.example.test/page-2.webp')
  const repeated = preloader.preload('https://media.example.test/page-2.webp')
  const third = preloader.preload('https://media.example.test/page-3.webp')

  assert.equal(first, repeated)
  await Promise.all([first, third])

  assert.equal(preloader.size(), 2)
  assert.deepEqual(created, [
    'https://media.example.test/page-2.webp',
    'https://media.example.test/page-3.webp',
  ])
  assert.deepEqual(decoded, created)
})

test('z-index interactivo conserva el orden Fabric', () => {
  const interactiveOverlayZIndex =
    runtime.default?.interactiveOverlayZIndex
    ?? runtime.interactiveOverlayZIndex

  assert.equal(interactiveOverlayZIndex(0), 20)
  assert.equal(interactiveOverlayZIndex(1), 21)
  assert.equal(interactiveOverlayZIndex(7), 27)

  assert.ok(
    interactiveOverlayZIndex(5) > interactiveOverlayZIndex(4),
    'un objeto Fabric posterior debe quedar encima del anterior',
  )
})

test('z-index interactivo normaliza indices invalidos sin romper el overlay', () => {
  const interactiveOverlayZIndex =
    runtime.default?.interactiveOverlayZIndex
    ?? runtime.interactiveOverlayZIndex

  assert.equal(interactiveOverlayZIndex(-1), 20)
  assert.equal(interactiveOverlayZIndex('abc'), 20)
  assert.equal(interactiveOverlayZIndex(2.9), 22)
})

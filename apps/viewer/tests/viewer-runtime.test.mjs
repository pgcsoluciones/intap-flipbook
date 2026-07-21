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

test('precarga pagina siguiente y anterior sin repetir descargas', () => {
  const nearbyRealPageNumbers = runtime.default?.nearbyRealPageNumbers ?? runtime.nearbyRealPageNumbers
  const createImagePreloader = runtime.default?.createImagePreloader ?? runtime.createImagePreloader
  const created = []
  class FakeImage {
    set src(value) { this._src = value; created.push(value) }
    get src() { return this._src }
  }

  assert.deepEqual(nearbyRealPageNumbers(2, 5), [1, 2, 3])
  assert.deepEqual(nearbyRealPageNumbers(1, 5), [1, 2])
  assert.deepEqual(nearbyRealPageNumbers(5, 5), [4, 5])

  const preloader = createImagePreloader(FakeImage)
  preloader.preload('https://media.example.test/page-2.webp')
  preloader.preload('https://media.example.test/page-2.webp')
  preloader.preload('https://media.example.test/page-3.webp')

  assert.equal(preloader.size(), 2)
  assert.deepEqual(created, [
    'https://media.example.test/page-2.webp',
    'https://media.example.test/page-3.webp',
  ])
})

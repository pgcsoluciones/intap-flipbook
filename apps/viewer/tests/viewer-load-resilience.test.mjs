import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import '../src/viewerRuntime.js'

const runtime = globalThis.IntapViewerRuntime

class ControlledImage {
  static instances = []
  constructor() {
    this.complete = false
    this.onload = null
    this.onerror = null
    ControlledImage.instances.push(this)
  }
  set src(value) { this._src = value }
  get src() { return this._src }
  decode() { return Promise.resolve() }
}

test('failed preloads are evicted so the same URL can retry', async () => {
  ControlledImage.instances.length = 0
  const preloader = runtime.createImagePreloader(ControlledImage)
  const url = 'https://example.com/retry.webp'

  const first = preloader.preload(url)
  assert.equal(ControlledImage.instances.length, 1)
  ControlledImage.instances[0].onerror?.()
  assert.equal(await first, null)
  assert.equal(preloader.has(url), false)

  const second = preloader.preload(url)
  assert.equal(ControlledImage.instances.length, 2)
  ControlledImage.instances[1].complete = true
  ControlledImage.instances[1].onload?.()
  assert.equal(await second, ControlledImage.instances[1])
  assert.equal(preloader.has(url), true)
})

test('deferred queue preloads backgrounds without eagerly building all Fabric overlays', () => {
  const source = fs.readFileSync(new URL('../src/flipbook.js', import.meta.url), 'utf8')
  assert.match(source, /ensureRealPageBackgrounds\(\[pageNumber\]\)/)
  assert.doesNotMatch(source, /ensureRealPagesReady\(\[pageNumber\]\)/)
})

test('viewer virtualizes far overlays and bounds navigation readiness', () => {
  const source = fs.readFileSync(new URL('../src/flipbook.js', import.meta.url), 'utf8')
  assert.match(source, /function disposeFarPageOverlays\(pageIndex\)/)
  assert.match(source, /scheduleFarOverlayCleanup\(idx\)/)
  assert.match(source, /delayViewer\(8000\)\.then\(\(\) => false\)/)
  assert.match(source, /No pudimos preparar esas páginas\. Inténtalo otra vez\./)
})

test('failed background and overlay work cannot be marked ready', () => {
  const source = fs.readFileSync(new URL('../src/flipbook.js', import.meta.url), 'utf8')
  assert.match(source, /if \(!image\) throw new Error\('La imagen no terminó de cargar o decodificar\.'\)/)
  assert.match(source, /div\.__pageBackgroundLoaded = false/)
  assert.match(source, /div\.__overlayBuilt = false/)
})

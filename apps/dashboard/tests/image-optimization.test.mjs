import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadOptimization() {
  const dir = await mkdtemp(join(tmpdir(), 'image-optimization-test-'))
  const outfile = join(dir, 'imageOptimization.mjs')
  await build({
    entryPoints: ['apps/dashboard/src/lib/imageOptimization.ts'],
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

function sizedFile(name, type, size, width, height, opts = {}) {
  const file = new File([new Uint8Array(size)], name, { type })
  Object.defineProperties(file, {
    __width: { value: width },
    __height: { value: height },
    __alpha: { value: !!opts.alpha },
    __decodeError: { value: !!opts.decodeError },
  })
  return file
}

function installCanvasFakes({ blobSizes = [], delayMs = 0 } = {}) {
  const calls = []
  const state = { active: 0, maxActive: 0 }
  globalThis.createImageBitmap = async (file) => {
    if (file.__decodeError) throw new Error('decode failed')
    return {
      width: file.__width,
      height: file.__height,
      hasAlpha: file.__alpha,
      closeCalled: false,
      close() { this.closeCalled = true },
    }
  }
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas')
      const canvas = {
        width: 0,
        height: 0,
        image: null,
        getContext(kind) {
          assert.equal(kind, '2d')
          return {
            clearRect() {},
            drawImage(image) { canvas.image = image },
          }
        },
        toBlob(callback, type, quality) {
          state.active += 1
          state.maxActive = Math.max(state.maxActive, state.active)
          calls.push({ width: canvas.width, height: canvas.height, type, quality, hasAlpha: !!canvas.image?.hasAlpha })
          const size = blobSizes.length ? blobSizes.shift() : 100
          setTimeout(() => {
            state.active -= 1
            callback(new Blob([new Uint8Array(size)], { type }))
          }, delayMs)
        },
      }
      return canvas
    },
  }
  return { calls, state }
}

test('imagen 4000x3000 limita display a 2400 y conserva proporcion', async () => {
  const mod = await loadOptimization()
  const env = installCanvasFakes({ blobSizes: [500, 50] })
  try {
    const result = await mod.optimizeImageFile(sizedFile('large.jpg', 'image/jpeg', 1000, 4000, 3000))

    assert.deepEqual(env.calls.map((call) => [call.width, call.height]), [[2400, 1800], [360, 270]])
    assert.equal(result.metadata.optimized_width, 2400)
    assert.equal(result.metadata.optimized_height, 1800)
    assert.equal(result.metadata.thumbnail_width, 360)
    assert.equal(result.metadata.thumbnail_height, 270)
  } finally {
    await mod.cleanup()
  }
})

test('imagen pequena no se amplia', async () => {
  const mod = await loadOptimization()
  const env = installCanvasFakes({ blobSizes: [400, 40] })
  try {
    const result = await mod.optimizeImageFile(sizedFile('small.jpg', 'image/jpeg', 1000, 800, 600))

    assert.deepEqual(env.calls.map((call) => [call.width, call.height]), [[800, 600], [360, 270]])
    assert.equal(result.metadata.optimized_width, 800)
    assert.equal(result.metadata.optimized_height, 600)
  } finally {
    await mod.cleanup()
  }
})

test('WebP mas pesado conserva original como display', async () => {
  const mod = await loadOptimization()
  installCanvasFakes({ blobSizes: [1200, 50] })
  try {
    const original = sizedFile('already-small.png', 'image/png', 1000, 1200, 900)
    const result = await mod.optimizeImageFile(original)

    assert.equal(result.displayFile, original)
    assert.equal(result.metadata.optimization_status, 'kept_original')
    assert.equal(result.metadata.compression_saved_bytes, 0)
  } finally {
    await mod.cleanup()
  }
})

test('PNG con transparencia se renderiza hacia WebP con alfa disponible', async () => {
  const mod = await loadOptimization()
  const env = installCanvasFakes({ blobSizes: [500, 50] })
  try {
    await mod.optimizeImageFile(sizedFile('alpha.png', 'image/png', 1000, 1000, 1000, { alpha: true }))

    assert.equal(env.calls[0].type, 'image/webp')
    assert.equal(env.calls[0].hasAlpha, true)
    assert.equal(env.calls[1].hasAlpha, true)
  } finally {
    await mod.cleanup()
  }
})

test('GIF conserva display original y marca skipped_animation', async () => {
  const mod = await loadOptimization()
  installCanvasFakes({ blobSizes: [40] })
  try {
    const gif = sizedFile('anim.gif', 'image/gif', 1000, 640, 480)
    const result = await mod.optimizeImageFile(gif)

    assert.equal(result.displayFile, gif)
    assert.equal(result.metadata.optimization_status, 'skipped_animation')
    assert.equal(result.thumbnailFile.type, 'image/webp')
  } finally {
    await mod.cleanup()
  }
})

test('SVG seguro conserva original y usa fallback valido si no se puede decodificar', async () => {
  const mod = await loadOptimization()
  installCanvasFakes()
  try {
    const svg = sizedFile('safe.svg', 'image/svg+xml', 1000, 0, 0, { decodeError: true })
    const result = await mod.optimizeImageFile(svg)

    assert.equal(result.displayFile, svg)
    assert.equal(result.thumbnailFile, svg)
    assert.equal(result.metadata.optimization_status, 'skipped_svg')
  } finally {
    await mod.cleanup()
  }
})

test('lote de 5 conserva orden y limita concurrencia', async () => {
  const mod = await loadOptimization()
  const env = installCanvasFakes({ blobSizes: Array(10).fill(50), delayMs: 10 })
  try {
    const files = Array.from({ length: 5 }, (_, index) => sizedFile(`img-${index}.jpg`, 'image/jpeg', 1000, 1000, 800))
    const results = await mod.optimizeImagesBatch(files, { concurrency: 2 })

    assert.deepEqual(results.map((item) => item.file.name), files.map((file) => file.name))
    assert.equal(results.every((item) => item.result && !item.error), true)
    assert.equal(env.state.maxActive <= 2, true)
  } finally {
    await mod.cleanup()
  }
})

test('fallo parcial conserva resultados correctos y fallidos para reintento', async () => {
  const mod = await loadOptimization()
  installCanvasFakes({ blobSizes: Array(6).fill(50) })
  try {
    const files = [
      sizedFile('ok-1.jpg', 'image/jpeg', 1000, 1000, 800),
      sizedFile('bad.jpg', 'image/jpeg', 1000, 0, 0, { decodeError: true }),
      sizedFile('ok-2.jpg', 'image/jpeg', 1000, 1000, 800),
    ]
    const results = await mod.optimizeImagesBatch(files, { concurrency: 2 })

    assert.equal(results[0].result.originalFile.name, 'ok-1.jpg')
    assert.equal(results[1].file.name, 'bad.jpg')
    assert.match(results[1].error, /decode failed|No se pudo optimizar/)
    assert.equal(results[2].result.originalFile.name, 'ok-2.jpg')
  } finally {
    await mod.cleanup()
  }
})

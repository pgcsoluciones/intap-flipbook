import fs from 'node:fs/promises'

const FLIPBOOK = 'apps/viewer/src/flipbook.js'
const RUNTIME = 'apps/viewer/src/viewerRuntime.js'

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from)
  if (first < 0) throw new Error(`No se encontró bloque esperado: ${label}`)
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Bloque ambiguo (más de una coincidencia): ${label}`)
  return source.slice(0, first) + to + source.slice(first + from.length)
}

let runtime = await fs.readFile(RUNTIME, 'utf8')
runtime = replaceOnce(
  runtime,
`          var finish = function (value) {
            if (settled) return
            settled = true
            if (timeout) clearTimeout(timeout)
            resolve(value)
          }`,
`          var finish = function (value) {
            if (settled) return
            settled = true
            if (timeout) clearTimeout(timeout)
            // Un error/timeout no puede quedar cacheado para siempre: la siguiente
            // navegación debe poder reintentar la misma URL.
            if (!value) cache.delete(src)
            resolve(value)
          }`,
  'evict failed image preload cache',
)

let flipbook = await fs.readFile(FLIPBOOK, 'utf8')

flipbook = replaceOnce(
  flipbook,
`    const task = Promise.resolve(imagePreloader.preload(pageImageUrl))
      .catch((error) => {
        console.warn('[viewer] page background preload failed', pageImageUrl, error)
        return null
      })
      .then((image) => {
        div.__pageBackgroundLoaded = true
        div.__pageBackgroundLoading = null
        return image
      })

    div.__pageBackgroundLoading = task
    return task`,
`    const task = Promise.resolve(imagePreloader.preload(pageImageUrl))
      .then((image) => {
        if (!image) throw new Error('La imagen no terminó de cargar o decodificar.')
        div.__pageBackgroundLoaded = true
        return image
      })
      .catch((error) => {
        // PROTECTED: un fallo no equivale a página lista. Mantener false permite
        // reintentar cuando el usuario vuelva a necesitar esta página.
        div.__pageBackgroundLoaded = false
        console.warn('[viewer] page background preload failed', pageImageUrl, error)
        throw error
      })
      .finally(() => {
        div.__pageBackgroundLoading = null
      })

    div.__pageBackgroundLoading = task
    return task`,
  'strict page background readiness',
)

flipbook = replaceOnce(
  flipbook,
`      const div = pageDivs[pageNumber - 1]
      if (!div) return
      if (isRealPageReady(pageNumber)) return
      if (deferredBackgroundQueued.has(pageNumber)) return`,
`      const div = pageDivs[pageNumber - 1]
      if (!div) return
      // La cola diferida solo precarga fondos. Nunca debe construir Fabric de
      // todas las páginas fuera de pantalla.
      if (div.__pageBackgroundLoaded || div.__pageBackgroundLoading) return
      if (deferredBackgroundQueued.has(pageNumber)) return`,
  'deferred queue candidate check',
)

flipbook = replaceOnce(
  flipbook,
`      Promise.resolve(
        ensureRealPagesReady([pageNumber]),
      ).finally(() => {
        deferredBackgroundActive -= 1
        scheduleDeferredBackgroundPump()
      })`,
`      Promise.resolve(
        // Solo fondo en segundo plano. El overlay Fabric se construye bajo
        // demanda para el pliego activo/destino.
        ensureRealPageBackgrounds([pageNumber]),
      ).finally(() => {
        deferredBackgroundActive -= 1
        scheduleDeferredBackgroundPump()
      })`,
  'background-only deferred pump',
)

flipbook = replaceOnce(
  flipbook,
`    if (animEntries.length && !animRunning) { animRunning = true; requestAnimationFrame(animTick) }
  }

  function animTick(now) {`,
`    if (animEntries.length && !animRunning) { animRunning = true; requestAnimationFrame(animTick) }
  }

  function unregisterAnimations(fcanvas) {
    for (let index = animEntries.length - 1; index >= 0; index -= 1) {
      if (animEntries[index].fcanvas === fcanvas) animEntries.splice(index, 1)
    }
    if (!animEntries.length) animRunning = false
  }

  function animTick(now) {`,
  'animation unregister helper',
)

flipbook = replaceOnce(
  flipbook,
`    dirty.forEach((fc) => fc.requestRenderAll ? fc.requestRenderAll() : fc.renderAll())
    requestAnimationFrame(animTick)
  }`,
`    dirty.forEach((fc) => fc.requestRenderAll ? fc.requestRenderAll() : fc.renderAll())
    if (!animEntries.length) {
      animRunning = false
      return
    }
    requestAnimationFrame(animTick)
  }`,
  'stop animation RAF when unused',
)

flipbook = replaceOnce(
  flipbook,
`    const fcanvas = new fabric.StaticCanvas(cv, { width: DESIGN_W, height: DESIGN_H, enableRetinaScaling: true })
    // Mapa elementId → holderDiv para widgets DOM (show_hide puede afectarlos igual que objetos Fabric)`,
`    const fcanvas = new fabric.StaticCanvas(cv, { width: DESIGN_W, height: DESIGN_H, enableRetinaScaling: true })
    // Guardar las referencias para poder liberar canvases de páginas lejanas.
    div.__overlayWrap = wrap
    div.__overlayCanvas = fcanvas
    // Mapa elementId → holderDiv para widgets DOM (show_hide puede afectarlos igual que objetos Fabric)`,
  'store overlay references',
)

flipbook = replaceOnce(
  flipbook,
`    const task = Promise.resolve(
      buildOverlay(
        div,
        data.pages[realIdx] && data.pages[realIdx].canvas_json,
        lead + realIdx,
      ),
    )
      .catch((error) => {
        console.warn(
          '[viewer] overlay build failed',
          data.pages[realIdx]?.id,
          error,
        )
        return null
      })
      .then(() => {
        div.__overlayBuilt = true
        return div
      })
      .finally(() => {
        div.__overlayBuilding = null
      })`,
`    const task = Promise.resolve(
      buildOverlay(
        div,
        data.pages[realIdx] && data.pages[realIdx].canvas_json,
        lead + realIdx,
      ),
    )
      .then(() => {
        div.__overlayBuilt = true
        return div
      })
      .catch((error) => {
        // PROTECTED: un overlay que falló no puede anunciarse como construido.
        div.__overlayBuilt = false
        const failedCanvas = div.__overlayCanvas
        if (failedCanvas) {
          unregisterAnimations(failedCanvas)
          try { failedCanvas.dispose?.() } catch (_) {}
        }
        div.__overlayWrap?.remove?.()
        div.__overlayCanvas = null
        div.__overlayWrap = null
        console.warn(
          '[viewer] overlay build failed',
          data.pages[realIdx]?.id,
          error,
        )
        throw error
      })
      .finally(() => {
        div.__overlayBuilding = null
      })`,
  'strict overlay readiness',
)

flipbook = replaceOnce(
  flipbook,
`  function ensureRealPagesReady(pageNumbers) {
    return Promise.all([
      ensureRealPageBackgrounds(pageNumbers),
      ensureRealPageOverlays(pageNumbers),
    ])
  }

  function isRealPageReady(pageNumber) {`,
`  async function ensureRealPagesReady(pageNumbers) {
    await Promise.all([
      ensureRealPageBackgrounds(pageNumbers),
      ensureRealPageOverlays(pageNumbers),
    ])
    return areRealPagesReady(pageNumbers)
  }

  function isRealPageReady(pageNumber) {`,
  'ready function returns truth',
)

flipbook = replaceOnce(
  flipbook,
`  function scheduleNearbyOverlays(pageIndex) {
    const work = () => ensureNearbyOverlays(pageIndex)
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(work, { timeout: 700 })
    } else {
      window.setTimeout(work, 0)
    }
  }

  const initialPageIndex = pageFlip.getCurrentPageIndex()`,
`  function scheduleNearbyOverlays(pageIndex) {
    const work = () => ensureNearbyOverlays(pageIndex)
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(work, { timeout: 700 })
    } else {
      window.setTimeout(work, 0)
    }
  }

  // PROTECTED: virtualizar overlays Fabric. Mantener solo el pliego actual y un
  // pequeño margen evita acumular decenas de StaticCanvas e imágenes decodificadas.
  function disposePageOverlay(pageNumber) {
    if (pageNumber < 1 || pageNumber > realCount) return
    const div = pageDivs[pageNumber - 1]
    if (!div || div.__overlayBuilding) return

    const fcanvas = div.__overlayCanvas
    if (fcanvas) {
      unregisterAnimations(fcanvas)
      try { fcanvas.dispose?.() } catch (_) {}
    }
    div.__overlayWrap?.remove?.()
    div.__overlayCanvas = null
    div.__overlayWrap = null
    div.__overlayBuilt = false

    const flipbookIndex = lead + pageNumber - 1
    delete pageEntrancePlayers[flipbookIndex]
    // Si la página vuelve a entrar en memoria, su animación de entrada debe
    // partir de un estado coherente en el overlay recién construido.
    playedEntrances.delete(flipbookIndex)
  }

  function disposeFarPageOverlays(pageIndex) {
    const currentRealPage = pageNumOf(pageIndex)
    const keep = new Set([
      currentRealPage - 1,
      currentRealPage,
      currentRealPage + 1,
      currentRealPage + 2,
    ].filter((pageNumber) => pageNumber >= 1 && pageNumber <= realCount))

    for (let pageNumber = 1; pageNumber <= realCount; pageNumber += 1) {
      if (!keep.has(pageNumber)) disposePageOverlay(pageNumber)
    }
  }

  function scheduleFarOverlayCleanup(pageIndex) {
    const work = () => disposeFarPageOverlays(pageIndex)
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(work, { timeout: 900 })
    } else {
      window.setTimeout(work, 120)
    }
  }

  const initialPageIndex = pageFlip.getCurrentPageIndex()`,
  'overlay lifecycle LRU',
)

flipbook = replaceOnce(
  flipbook,
`  scheduleNearbyOverlays(initialPageIndex)

  if (loadingScreen) {`,
`  scheduleNearbyOverlays(initialPageIndex)
  scheduleFarOverlayCleanup(initialPageIndex)

  if (loadingScreen) {`,
  'initial overlay cleanup schedule',
)

flipbook = replaceOnce(
  flipbook,
`    queueDeferredBackgrounds(nearbyRealPages, { front: true })
    scheduleNearbyOverlays(idx)
    startPageTimer(pageNumOf(idx))`,
`    queueDeferredBackgrounds(nearbyRealPages, { front: true })
    scheduleNearbyOverlays(idx)
    scheduleFarOverlayCleanup(idx)
    startPageTimer(pageNumOf(idx))`,
  'cleanup after flip',
)

flipbook = replaceOnce(
  flipbook,
`      queueDeferredBackgrounds(targetRealPages, { front: true })
      await ensureRealPagesReady(targetRealPages)
      await waitUntilPageFlipRead()

      executeFlip()`,
`      queueDeferredBackgrounds(targetRealPages, { front: true })
      let targetReady = await Promise.race([
        ensureRealPagesReady(targetRealPages),
        delayViewer(8000).then(() => false),
      ])

      // Un segundo intento corto cubre fallos transitorios de red/decodificación
      // sin dejar navigationPending bloqueado indefinidamente.
      if (!targetReady) {
        await delayViewer(250)
        targetReady = await Promise.race([
          ensureRealPagesReady(targetRealPages),
          delayViewer(5000).then(() => false),
        ])
      }

      if (!targetReady) {
        showPreparingHint('No pudimos preparar esas páginas. Inténtalo otra vez.')
        return
      }

      await waitUntilPageFlipRead()

      executeFlip()`,
  'bounded navigation readiness',
)

flipbook = replaceOnce(
  flipbook,
`          if (timer) clearInterval(timer)
          if (cfg.autoplay !== false && imgs.length > 1) timer = setInterval(() => go(cur + 1), Math.max(1, cfg.interval || 4) * 1000)`,
`          if (timer) clearInterval(timer)
          if (cfg.autoplay !== false && imgs.length > 1) timer = setInterval(() => {
            if (!box.isConnected) {
              clearInterval(timer)
              timer = null
              return
            }
            go(cur + 1)
          }, Math.max(1, cfg.interval || 4) * 1000)`,
  'gallery timer cleanup',
)

await fs.writeFile(RUNTIME, runtime)
await fs.writeFile(FLIPBOOK, flipbook)
console.log('Viewer resilience patch applied successfully.')

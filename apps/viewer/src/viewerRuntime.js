(function (root) {
  function cleanHttpsLike(value) {
    if (!value || typeof value !== 'string') return ''
    try {
      var url = new URL(value)
      return (url.protocol === 'http:' || url.protocol === 'https:') ? url.toString() : ''
    } catch (e) {
      return ''
    }
  }

  function selectPageImageUrl(page) {
    if (!page) return ''
    return cleanHttpsLike(page.optimized_url) || cleanHttpsLike(page.display_url) || cleanHttpsLike(page.image_url)
  }

  function nearbyRealPageNumbers(currentRealPage, totalPages) {
    var out = []
    ;[-2, -1, 0, 1, 2, 3].forEach(function (offset) {
      var pageNumber = currentRealPage + offset
      if (pageNumber >= 1 && pageNumber <= totalPages && out.indexOf(pageNumber) === -1) out.push(pageNumber)
    })
    return out
  }

  function startupRealPageNumbers(totalPages, portrait) {
    var limit = portrait ? 2 : 3
    var out = []

    for (var pageNumber = 1; pageNumber <= Math.min(totalPages, limit); pageNumber += 1) {
      out.push(pageNumber)
    }

    return out
  }

  function targetRealPageNumbers(targetRealPage, totalPages) {
    var out = []

    ;[
      targetRealPage,
      targetRealPage + 1,
    ].forEach(function (pageNumber) {
      if (
        pageNumber >= 1
        && pageNumber <= totalPages
        && out.indexOf(pageNumber) === -1
      ) {
        out.push(pageNumber)
      }
    })

    return out
  }

  function interactiveOverlayZIndex(objectIndex) {
    var index = Number(objectIndex)
    if (!Number.isFinite(index) || index < 0) index = 0
    return 20 + Math.floor(index)
  }

  function createImagePreloader(ImageCtor) {
    var cache = new Map()
    return {
      preload: function (url) {
        var src = cleanHttpsLike(url)
        if (!src) return Promise.resolve(null)
        if (cache.has(src)) return cache.get(src).promise

        var img = new ImageCtor()
        img.decoding = 'async'
        img.loading = 'eager'

        var entry = { image: img, promise: null }
        entry.promise = new Promise(function (resolve) {
          var settled = false
          var timeout = null

          var finish = function (value) {
            if (settled) return
            settled = true
            if (timeout) clearTimeout(timeout)
            // Un error/timeout no puede quedar cacheado para siempre: la siguiente
            // navegación debe poder reintentar la misma URL.
            if (!value) cache.delete(src)
            resolve(value)
          }

          img.onload = function () {
            if (typeof img.decode === 'function') {
              Promise.resolve()
                .then(function () { return img.decode() })
                .catch(function () {})
                .then(function () { finish(img) })
            } else {
              finish(img)
            }
          }

          img.onerror = function () {
            finish(null)
          }

          timeout = setTimeout(function () {
            finish(img.complete ? img : null)
          }, 6000)
        })

        cache.set(src, entry)
        img.src = src
        return entry.promise
      },
      has: function (url) {
        return cache.has(cleanHttpsLike(url))
      },
      size: function () {
        return cache.size
      },
    }
  }

  var api = {
    selectPageImageUrl: selectPageImageUrl,
    nearbyRealPageNumbers: nearbyRealPageNumbers,
    startupRealPageNumbers: startupRealPageNumbers,
    targetRealPageNumbers: targetRealPageNumbers,
    interactiveOverlayZIndex: interactiveOverlayZIndex,
    createImagePreloader: createImagePreloader,
  }
  root.IntapViewerRuntime = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)

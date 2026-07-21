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
    ;[currentRealPage - 1, currentRealPage, currentRealPage + 1].forEach(function (pageNumber) {
      if (pageNumber >= 1 && pageNumber <= totalPages && out.indexOf(pageNumber) === -1) out.push(pageNumber)
    })
    return out
  }

  function createImagePreloader(ImageCtor) {
    var cache = new Map()
    return {
      preload: function (url) {
        var src = cleanHttpsLike(url)
        if (!src) return null
        if (cache.has(src)) return cache.get(src)
        var img = new ImageCtor()
        img.decoding = 'async'
        img.loading = 'eager'
        img.src = src
        cache.set(src, img)
        return img
      },
      has: function (url) {
        return cache.has(cleanHttpsLike(url))
      },
      size: function () {
        return cache.size
      },
    }
  }

  var api = { selectPageImageUrl: selectPageImageUrl, nearbyRealPageNumbers: nearbyRealPageNumbers, createImagePreloader: createImagePreloader }
  root.IntapViewerRuntime = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)

(function (root) {
  const params = new URLSearchParams(root.location?.search || '')
  const isPreview = params.get('preview') === '1'
  const previewToken = params.get('preview_token')?.trim() || ''
  const apiBaseRaw = params.get('api_base')?.trim() || ''

  if (!isPreview || !previewToken || !apiBaseRaw || typeof root.fetch !== 'function') return

  let apiBase = ''
  try {
    const url = new URL(apiBaseRaw)
    if (!['http:', 'https:'].includes(url.protocol)) return
    apiBase = url.toString().replace(/\/+$/, '')
  } catch (_) {
    return
  }

  const nativeFetch = root.fetch.bind(root)
  let previewPayloadPromise = null

  function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }

  function cleanLimit(value) {
    const parsed = Number(value)
    if (!Number.isInteger(parsed)) return 12
    return Math.min(Math.max(parsed, 1), 50)
  }

  function moneyMinor(value) {
    if (value == null || value === '') return null
    const amount = Number(value)
    if (!Number.isFinite(amount) || amount < 0) return null
    return Math.round(amount * 100)
  }

  function previewPayload() {
    if (!previewPayloadPromise) {
      previewPayloadPromise = nativeFetch(`${apiBase}/view/preview/${encodeURIComponent(previewToken)}`)
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}))
          if (!response.ok || !payload?.success || !payload?.data) {
            throw new Error(payload?.error || 'No se pudo cargar el catálogo Preview')
          }
          return payload.data
        })
        .catch((error) => {
          previewPayloadPromise = null
          throw error
        })
    }
    return previewPayloadPromise
  }

  function markerImage(marker, data) {
    const media = Array.isArray(marker?.media) ? marker.media : []
    const image = media.find((item) => item?.type === 'image' && item?.url)
    return image?.url || data?.cover_image_url || data?.pages?.[0]?.image_url || null
  }

  function catalogFrom(data, requestUrl) {
    const all = Array.isArray(data?.dynamic_markers) ? data.dynamic_markers.slice() : []
    const q = (requestUrl.searchParams.get('q') || '').trim().toLowerCase()
    const category = (requestUrl.searchParams.get('category') || '').trim()
    const availability = (requestUrl.searchParams.get('availability') || '').trim()
    const minPrice = moneyMinor(requestUrl.searchParams.get('price_min'))
    const maxPrice = moneyMinor(requestUrl.searchParams.get('price_max'))
    const limit = cleanLimit(requestUrl.searchParams.get('limit'))
    const cursor = (requestUrl.searchParams.get('cursor') || '').trim()

    const filteredForMeta = all.filter((marker) => marker?.id)
    let filtered = filteredForMeta.filter((marker) => {
      if (q) {
        const haystack = [marker.name, marker.reference, marker.category, marker.description]
          .map((value) => String(value || '').toLowerCase())
          .join(' ')
        if (!haystack.includes(q)) return false
      }
      if (category && marker.category !== category) return false
      if (availability && marker.availability !== availability) return false
      if (minPrice != null && Number(marker.price_minor) < minPrice) return false
      if (maxPrice != null && Number(marker.price_minor) > maxPrice) return false
      return true
    })

    filtered.sort((a, b) => {
      const aTime = String(a.updated_at || '')
      const bTime = String(b.updated_at || '')
      if (aTime !== bTime) return bTime.localeCompare(aTime)
      return String(b.id || '').localeCompare(String(a.id || ''))
    })

    if (cursor) {
      const separator = cursor.lastIndexOf('|')
      if (separator > 0) {
        const updatedAt = cursor.slice(0, separator)
        const id = cursor.slice(separator + 1)
        filtered = filtered.filter((marker) => {
          const markerTime = String(marker.updated_at || '')
          return markerTime < updatedAt || (markerTime === updatedAt && String(marker.id || '') < id)
        })
      }
    }

    const pageRows = filtered.slice(0, limit)
    const last = pageRows[pageRows.length - 1]
    const prices = filteredForMeta
      .map((marker) => marker.price_minor)
      .filter((value) => typeof value === 'number' && Number.isFinite(value))
    const currency = filteredForMeta.find((marker) => marker.currency)?.currency || 'DOP'

    return {
      success: true,
      data: pageRows.map((marker) => ({
        id: marker.id,
        name: marker.name,
        reference: marker.reference,
        category: marker.category,
        price_minor: marker.price_minor,
        currency: marker.currency,
        availability: marker.availability,
        badge_text: marker.badge_text,
        accent_color: marker.accent_color || '#F59E0B',
        cover_url: markerImage(marker, data),
        page_id: marker.page_id,
        page_number: marker.page_number,
        target_object_id: marker.target_object_id,
        target_kind: marker.target_kind,
        updated_at: marker.updated_at,
      })),
      page: {
        limit,
        has_more: filtered.length > limit,
        next_cursor: filtered.length > limit && last ? `${last.updated_at || ''}|${last.id}` : null,
      },
      meta: {
        filters: {
          categories: Array.from(new Set(filteredForMeta.map((marker) => marker.category).filter(Boolean))).sort(),
          availabilities: Array.from(new Set(filteredForMeta.map((marker) => marker.availability).filter(Boolean))).sort(),
          price_range: {
            min_minor: prices.length ? Math.min(...prices) : null,
            max_minor: prices.length ? Math.max(...prices) : null,
            currency,
          },
        },
      },
    }
  }

  function isDynamicMarkerRequest(url) {
    if (url.origin !== new URL(apiBase).origin) return null
    const match = url.pathname.match(/^\/view\/[^/]+\/dynamic-markers(?:\/(catalog|[^/]+))?$/)
    if (!match) return null
    return match[1] || ''
  }

  root.fetch = async function previewAwareFetch(input, init) {
    let requestUrl
    try {
      requestUrl = new URL(typeof input === 'string' ? input : input?.url, root.location?.href)
    } catch (_) {
      return nativeFetch(input, init)
    }

    const dynamicPart = isDynamicMarkerRequest(requestUrl)
    if (dynamicPart === null) return nativeFetch(input, init)

    try {
      const data = await previewPayload()
      if (dynamicPart === 'catalog') {
        return jsonResponse(catalogFrom(data, requestUrl))
      }

      if (dynamicPart) {
        const markerId = decodeURIComponent(dynamicPart)
        const marker = (Array.isArray(data?.dynamic_markers) ? data.dynamic_markers : [])
          .find((item) => String(item?.id) === markerId)
        return marker
          ? jsonResponse({ success: true, data: marker })
          : jsonResponse({ success: false, error: 'Ficha no disponible' }, 404)
      }
    } catch (error) {
      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : 'No se pudo preparar la vista Preview',
      }, 502)
    }

    return nativeFetch(input, init)
  }
})(typeof window !== 'undefined' ? window : globalThis)

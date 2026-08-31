import fs from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

const API_URL = process.env.INTAP_AUDIT_API_URL || 'https://intap-flipbook-api.fliaprince.workers.dev/view/catalogo-padres-2026'
const OUTPUT = process.env.INTAP_AUDIT_OUTPUT || 'audit-output.json'
const FETCH_TIMEOUT_MS = Number(process.env.INTAP_AUDIT_TIMEOUT_MS || 20000)
const RESOURCE_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.INTAP_AUDIT_CONCURRENCY || 3)))

function timeoutSignal(ms = FETCH_TIMEOUT_MS) {
  return AbortSignal.timeout(ms)
}

function cleanUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const u = new URL(value)
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : ''
  } catch {
    return ''
  }
}

function selectedPageUrl(page) {
  return cleanUrl(page?.optimized_url) || cleanUrl(page?.display_url) || cleanUrl(page?.image_url)
}

function parseCanvasJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return null
  try { return JSON.parse(value) } catch { return null }
}

function extractUrls(value, out = new Set()) {
  if (typeof value === 'string') {
    const direct = cleanUrl(value)
    if (direct) out.add(direct)
    const matches = value.match(/https?:\/\/[^\s"'<>\\)]+/g) || []
    for (const raw of matches) {
      const url = cleanUrl(raw)
      if (url) out.add(url)
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) extractUrls(item, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) extractUrls(item, out)
  }
  return out
}

function isLegacyUrl(url) {
  return /\.r2\.dev\//i.test(url) || /\/api\/upload\/uploads\/.*\.(?:png|jpe?g)(?:[?#]|$)/i.test(url)
}

async function fetchJson(url) {
  const started = performance.now()
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    signal: timeoutSignal(),
  })
  const text = await response.text()
  const elapsed_ms = Math.round((performance.now() - started) * 10) / 10
  let json = null
  try { json = JSON.parse(text) } catch {}
  if (!response.ok || !json) {
    throw new Error(`API ${response.status} en ${elapsed_ms} ms: ${text.slice(0, 240)}`)
  }
  return { json, elapsed_ms, headers: Object.fromEntries(response.headers.entries()) }
}

async function probe(url, { readBody = false } = {}) {
  const result = {
    url,
    method: readBody ? 'GET' : 'HEAD',
    ok: false,
    status: null,
    elapsed_ms: null,
    ttfb_ms: null,
    bytes_read: null,
    content_length: null,
    content_type: null,
    cache_control: null,
    access_control_allow_origin: null,
    cross_origin_resource_policy: null,
    timing_allow_origin: null,
    error: null,
  }
  if (!url) {
    result.error = 'sin URL'
    return result
  }
  const started = performance.now()
  try {
    const response = await fetch(url, {
      method: readBody ? 'GET' : 'HEAD',
      headers: { origin: 'https://flip.intaprd.com', 'cache-control': 'no-cache' },
      signal: timeoutSignal(),
    })
    result.ttfb_ms = Math.round((performance.now() - started) * 10) / 10
    result.status = response.status
    result.ok = response.ok
    result.content_length = response.headers.get('content-length')
    result.content_type = response.headers.get('content-type')
    result.cache_control = response.headers.get('cache-control')
    result.access_control_allow_origin = response.headers.get('access-control-allow-origin')
    result.cross_origin_resource_policy = response.headers.get('cross-origin-resource-policy')
    result.timing_allow_origin = response.headers.get('timing-allow-origin')
    if (readBody) {
      const bytes = await response.arrayBuffer()
      result.bytes_read = bytes.byteLength
    } else {
      try { await response.body?.cancel() } catch {}
    }
  } catch (error) {
    result.error = error?.name === 'TimeoutError' ? `timeout>${FETCH_TIMEOUT_MS}ms` : String(error?.message || error)
  }
  result.elapsed_ms = Math.round((performance.now() - started) * 10) / 10
  return result
}

async function mapLimit(items, concurrency, fn) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker))
  return results
}

const api = await fetchJson(API_URL)
const data = api.json?.data ?? api.json
const pages = Array.isArray(data?.pages) ? data.pages : []
if (!pages.length) throw new Error('El payload público no contiene páginas.')

const pageRows = pages.map((page, index) => {
  const canvas = parseCanvasJson(page.canvas_json)
  const canvasUrls = [...extractUrls(canvas)]
  const chosen = selectedPageUrl(page)
  return {
    page_number: Number(page.page_number || index + 1),
    id: page.id ?? null,
    image_url: cleanUrl(page.image_url),
    display_url: cleanUrl(page.display_url),
    optimized_url: cleanUrl(page.optimized_url),
    thumbnail_url: cleanUrl(page.thumbnail_url),
    chosen_url: chosen,
    chosen_variant: cleanUrl(page.optimized_url) ? 'optimized' : cleanUrl(page.display_url) ? 'display' : cleanUrl(page.image_url) ? 'original' : 'none',
    canvas_object_count: Array.isArray(canvas?.objects) ? canvas.objects.length : 0,
    canvas_url_count: canvasUrls.length,
    canvas_urls: canvasUrls,
    legacy_url_count: [chosen, ...canvasUrls].filter(Boolean).filter(isLegacyUrl).length,
  }
}).sort((a, b) => a.page_number - b.page_number)

console.log(`API: ${API_URL}`)
console.log(`API GET: ${api.elapsed_ms} ms`)
console.log(`Páginas: ${pageRows.length}`)
console.log('')
console.log('Probando fondos de página con GET secuencial/concurrencia baja...')

const pageProbes = await mapLimit(pageRows, RESOURCE_CONCURRENCY, async (row) => ({
  page_number: row.page_number,
  ...(await probe(row.chosen_url, { readBody: true })),
}))

const allUrls = [...new Set(pageRows.flatMap((row) => [row.chosen_url, ...row.canvas_urls]).filter(Boolean))]
console.log(`Recursos HTTP únicos detectados: ${allUrls.length}`)
console.log('Probando encabezados de todos los recursos con HEAD...')
const resourceProbes = await mapLimit(allUrls, RESOURCE_CONCURRENCY, (url) => probe(url, { readBody: false }))

const probeByUrl = new Map(resourceProbes.map((item) => [item.url, item]))
const enrichedPages = pageRows.map((row) => {
  const pageProbe = pageProbes.find((item) => item.page_number === row.page_number)
  const canvasFailures = row.canvas_urls
    .map((url) => probeByUrl.get(url))
    .filter((item) => item && !item.ok)
    .map((item) => ({ url: item.url, status: item.status, error: item.error }))
  return { ...row, background_probe: pageProbe, canvas_failures: canvasFailures }
})

const failures = resourceProbes.filter((item) => !item.ok)
const slowBackgrounds = pageProbes
  .filter((item) => item.elapsed_ms != null)
  .sort((a, b) => b.elapsed_ms - a.elapsed_ms)
  .slice(0, 10)
const noOptimized = pageRows.filter((row) => row.chosen_variant !== 'optimized')
const legacyPages = pageRows.filter((row) => row.legacy_url_count > 0)
const totalBackgroundBytes = pageProbes.reduce((sum, item) => sum + (Number(item.bytes_read) || 0), 0)

const report = {
  generated_at: new Date().toISOString(),
  api: { url: API_URL, elapsed_ms: api.elapsed_ms, headers: api.headers },
  summary: {
    page_count: pageRows.length,
    unique_http_resources: allUrls.length,
    failed_resource_count: failures.length,
    pages_without_optimized_background: noOptimized.map((row) => row.page_number),
    pages_with_legacy_urls: legacyPages.map((row) => row.page_number),
    total_background_bytes_read: totalBackgroundBytes,
    total_background_mib_read: Math.round((totalBackgroundBytes / 1024 / 1024) * 100) / 100,
  },
  slowest_backgrounds: slowBackgrounds,
  failed_resources: failures,
  pages: enrichedPages,
  resources: resourceProbes,
}

await fs.writeFile(OUTPUT, JSON.stringify(report, null, 2))

console.log('')
console.log('=== RESUMEN ===')
console.log(JSON.stringify(report.summary, null, 2))
console.log('')
console.log('=== 10 FONDOS MÁS LENTOS ===')
for (const item of slowBackgrounds) {
  console.log(`p${item.page_number}: ${item.status ?? 'ERR'} | ${item.elapsed_ms ?? '-'} ms | ${(Number(item.bytes_read || 0) / 1024).toFixed(1)} KiB | ${item.url}`)
}
if (failures.length) {
  console.log('')
  console.log('=== RECURSOS FALLIDOS ===')
  for (const item of failures.slice(0, 50)) {
    console.log(`${item.status ?? 'ERR'} | ${item.error || ''} | ${item.url}`)
  }
}
console.log('')
console.log(`Reporte JSON: ${OUTPUT}`)

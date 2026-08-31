// Read-only media load probe for the public Idegalo catalog.
import fs from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

const API_URL = process.env.INTAP_AUDIT_API_URL || 'https://intap-flipbook-api.fliaprince.workers.dev/view/catalogo-padres-2026'
const OUTPUT = process.env.INTAP_MEDIA_AUDIT_OUTPUT || 'audit-media-load.json'
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.INTAP_AUDIT_CONCURRENCY || 3)))
const TIMEOUT_MS = Number(process.env.INTAP_AUDIT_TIMEOUT_MS || 20000)

function cleanUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const u = new URL(value)
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : ''
  } catch { return '' }
}

function extractUrls(value, out = new Set()) {
  if (typeof value === 'string') {
    const direct = cleanUrl(value)
    if (direct) out.add(direct)
    for (const raw of value.match(/https?:\/\/[^\s"'<>\\)]+/g) || []) {
      const url = cleanUrl(raw)
      if (url) out.add(url)
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) extractUrls(item, out)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) extractUrls(item, out)
  }
  return out
}

function parseCanvas(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return null }
}

function isIntapImage(url) {
  try {
    const u = new URL(url)
    return u.hostname === 'intap-flipbook-api.fliaprince.workers.dev'
      && u.pathname.includes('/api/upload/uploads/')
      && /\.(?:webp|png|jpe?g|gif|svg)$/i.test(u.pathname)
  } catch { return false }
}

async function mapLimit(items, concurrency, fn) {
  const out = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker))
  return out
}

async function getBytes(url) {
  const started = performance.now()
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { origin: 'https://flip.intaprd.com', 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const ttfb_ms = Math.round((performance.now() - started) * 10) / 10
    const body = await response.arrayBuffer()
    return {
      url,
      ok: response.ok,
      status: response.status,
      bytes: body.byteLength,
      ttfb_ms,
      elapsed_ms: Math.round((performance.now() - started) * 10) / 10,
      content_type: response.headers.get('content-type'),
      cache_control: response.headers.get('cache-control'),
      access_control_allow_origin: response.headers.get('access-control-allow-origin'),
      error: null,
    }
  } catch (error) {
    return {
      url,
      ok: false,
      status: null,
      bytes: 0,
      ttfb_ms: null,
      elapsed_ms: Math.round((performance.now() - started) * 10) / 10,
      content_type: null,
      cache_control: null,
      access_control_allow_origin: null,
      error: error?.name === 'TimeoutError' ? `timeout>${TIMEOUT_MS}ms` : String(error?.message || error),
    }
  }
}

const apiResponse = await fetch(API_URL, { headers: { accept: 'application/json', 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
if (!apiResponse.ok) throw new Error(`API HTTP ${apiResponse.status}`)
const payload = await apiResponse.json()
const data = payload?.data ?? payload
const pages = Array.isArray(data?.pages) ? data.pages : []
if (!pages.length) throw new Error('Sin páginas en payload público')

const pageMedia = pages.map((page, index) => {
  const urls = new Set()
  ;[page.optimized_url, page.display_url, page.image_url, page.thumbnail_url].forEach((value) => {
    const url = cleanUrl(value)
    if (url && isIntapImage(url)) urls.add(url)
  })
  for (const url of extractUrls(parseCanvas(page.canvas_json))) {
    if (isIntapImage(url)) urls.add(url)
  }
  return { page_number: Number(page.page_number || index + 1), urls: [...urls] }
})

const uniqueUrls = [...new Set(pageMedia.flatMap((page) => page.urls))]
console.log(`Páginas: ${pages.length}`)
console.log(`Imágenes INTAP únicas: ${uniqueUrls.length}`)
console.log(`GET con concurrencia ${CONCURRENCY}...`)

const resources = await mapLimit(uniqueUrls, CONCURRENCY, getBytes)
const byUrl = new Map(resources.map((resource) => [resource.url, resource]))
const pagesReport = pageMedia.map((page) => {
  const rows = page.urls.map((url) => byUrl.get(url)).filter(Boolean)
  return {
    page_number: page.page_number,
    resource_count: rows.length,
    failed_count: rows.filter((row) => !row.ok).length,
    unique_bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    unique_mib: Math.round((rows.reduce((sum, row) => sum + row.bytes, 0) / 1024 / 1024) * 1000) / 1000,
    slowest_ms: rows.reduce((max, row) => Math.max(max, row.elapsed_ms || 0), 0),
  }
})

const totalBytes = resources.reduce((sum, row) => sum + row.bytes, 0)
const failed = resources.filter((row) => !row.ok)
const largest = [...resources].sort((a, b) => b.bytes - a.bytes).slice(0, 20)
const slowest = [...resources].sort((a, b) => (b.elapsed_ms || 0) - (a.elapsed_ms || 0)).slice(0, 20)

const report = {
  generated_at: new Date().toISOString(),
  api_url: API_URL,
  page_count: pages.length,
  unique_media_count: resources.length,
  failed_media_count: failed.length,
  total_unique_bytes: totalBytes,
  total_unique_mib: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
  pages: pagesReport,
  largest,
  slowest,
  failed,
  resources,
}

await fs.writeFile(OUTPUT, JSON.stringify(report, null, 2))
console.log(`Total único: ${report.total_unique_mib} MiB`)
console.log(`Fallos: ${failed.length}`)
console.log('')
console.log('=== PÁGINAS MÁS PESADAS (suma de recursos únicos usados por página) ===')
for (const page of [...pagesReport].sort((a, b) => b.unique_bytes - a.unique_bytes).slice(0, 15)) {
  console.log(`p${page.page_number}: ${page.resource_count} recursos | ${page.unique_mib} MiB | lento=${page.slowest_ms} ms | fallos=${page.failed_count}`)
}
console.log('')
console.log('=== 20 RECURSOS MÁS PESADOS ===')
for (const row of largest) console.log(`${(row.bytes / 1024).toFixed(1)} KiB | ${row.elapsed_ms} ms | ${row.status ?? 'ERR'} | ${row.url}`)
console.log('')
console.log('=== 20 RECURSOS MÁS LENTOS ===')
for (const row of slowest) console.log(`${row.elapsed_ms} ms | ${(row.bytes / 1024).toFixed(1)} KiB | ${row.status ?? 'ERR'} | ${row.url}`)
console.log(`Reporte JSON: ${OUTPUT}`)

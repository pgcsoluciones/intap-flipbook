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

function readU24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function parseImageDimensions(arrayBuffer, contentType = '', url = '') {
  const bytes = new Uint8Array(arrayBuffer)
  const lowerType = String(contentType || '').toLowerCase()
  const lowerUrl = String(url || '').toLowerCase()

  // PNG: IHDR stores width/height as big-endian uint32 at byte 16.
  if ((lowerType.includes('image/png') || lowerUrl.includes('.png')) && bytes.length >= 24) {
    const view = new DataView(arrayBuffer)
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return { width: view.getUint32(16, false), height: view.getUint32(20, false), format: 'png' }
    }
  }

  // WebP: RIFF....WEBP followed by VP8X, VP8L or VP8 chunk.
  if ((lowerType.includes('image/webp') || lowerUrl.includes('.webp')) && bytes.length >= 30) {
    const riff = String.fromCharCode(...bytes.slice(0, 4))
    const webp = String.fromCharCode(...bytes.slice(8, 12))
    if (riff === 'RIFF' && webp === 'WEBP') {
      let offset = 12
      while (offset + 8 <= bytes.length) {
        const fourcc = String.fromCharCode(...bytes.slice(offset, offset + 4))
        const size = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24)
        const dataOffset = offset + 8
        if (fourcc === 'VP8X' && dataOffset + 10 <= bytes.length) {
          return {
            width: 1 + readU24LE(bytes, dataOffset + 4),
            height: 1 + readU24LE(bytes, dataOffset + 7),
            format: 'webp-vp8x',
          }
        }
        if (fourcc === 'VP8L' && dataOffset + 5 <= bytes.length && bytes[dataOffset] === 0x2f) {
          const b1 = bytes[dataOffset + 1]
          const b2 = bytes[dataOffset + 2]
          const b3 = bytes[dataOffset + 3]
          const b4 = bytes[dataOffset + 4]
          return {
            width: 1 + (b1 | ((b2 & 0x3f) << 8)),
            height: 1 + (((b2 & 0xc0) >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
            format: 'webp-vp8l',
          }
        }
        if (fourcc === 'VP8 ' && dataOffset + 10 <= bytes.length) {
          const start = dataOffset + 3
          if (bytes[start] === 0x9d && bytes[start + 1] === 0x01 && bytes[start + 2] === 0x2a) {
            const width = (bytes[start + 3] | (bytes[start + 4] << 8)) & 0x3fff
            const height = (bytes[start + 5] | (bytes[start + 6] << 8)) & 0x3fff
            return { width, height, format: 'webp-vp8' }
          }
        }
        offset = dataOffset + size + (size % 2)
      }
    }
  }

  return { width: null, height: null, format: null }
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
    const contentType = response.headers.get('content-type')
    const dimensions = parseImageDimensions(body, contentType, url)
    const decodedBytes = dimensions.width && dimensions.height
      ? dimensions.width * dimensions.height * 4
      : null
    return {
      url,
      ok: response.ok,
      status: response.status,
      bytes: body.byteLength,
      width: dimensions.width,
      height: dimensions.height,
      decoded_rgba_bytes: decodedBytes,
      format: dimensions.format,
      ttfb_ms,
      elapsed_ms: Math.round((performance.now() - started) * 10) / 10,
      content_type: contentType,
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
      width: null,
      height: null,
      decoded_rgba_bytes: null,
      format: null,
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
  const encodedBytes = rows.reduce((sum, row) => sum + row.bytes, 0)
  const decodedBytes = rows.reduce((sum, row) => sum + (row.decoded_rgba_bytes || 0), 0)
  return {
    page_number: page.page_number,
    resource_count: rows.length,
    failed_count: rows.filter((row) => !row.ok).length,
    unique_bytes: encodedBytes,
    unique_mib: Math.round((encodedBytes / 1024 / 1024) * 1000) / 1000,
    decoded_rgba_bytes: decodedBytes,
    decoded_rgba_mib: Math.round((decodedBytes / 1024 / 1024) * 1000) / 1000,
    slowest_ms: rows.reduce((max, row) => Math.max(max, row.elapsed_ms || 0), 0),
  }
})

const totalBytes = resources.reduce((sum, row) => sum + row.bytes, 0)
const totalDecodedBytes = resources.reduce((sum, row) => sum + (row.decoded_rgba_bytes || 0), 0)
const dimensionsUnknown = resources.filter((row) => row.ok && (!row.width || !row.height)).length
const failed = resources.filter((row) => !row.ok)
const largest = [...resources].sort((a, b) => b.bytes - a.bytes).slice(0, 20)
const largestDecoded = [...resources].sort((a, b) => (b.decoded_rgba_bytes || 0) - (a.decoded_rgba_bytes || 0)).slice(0, 20)
const slowest = [...resources].sort((a, b) => (b.elapsed_ms || 0) - (a.elapsed_ms || 0)).slice(0, 20)

const report = {
  generated_at: new Date().toISOString(),
  api_url: API_URL,
  page_count: pages.length,
  unique_media_count: resources.length,
  failed_media_count: failed.length,
  dimensions_unknown_count: dimensionsUnknown,
  total_unique_bytes: totalBytes,
  total_unique_mib: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
  estimated_unique_decoded_rgba_bytes: totalDecodedBytes,
  estimated_unique_decoded_rgba_mib: Math.round((totalDecodedBytes / 1024 / 1024) * 100) / 100,
  pages: pagesReport,
  largest,
  largest_decoded: largestDecoded,
  slowest,
  failed,
  resources,
}

await fs.writeFile(OUTPUT, JSON.stringify(report, null, 2))
console.log(`Total comprimido único: ${report.total_unique_mib} MiB`)
console.log(`Memoria RGBA única estimada: ${report.estimated_unique_decoded_rgba_mib} MiB`)
console.log(`Dimensiones no resueltas: ${dimensionsUnknown}`)
console.log(`Fallos: ${failed.length}`)
console.log('')
console.log('=== PÁGINAS MÁS PESADAS (recursos usados por página) ===')
for (const page of [...pagesReport].sort((a, b) => b.decoded_rgba_bytes - a.decoded_rgba_bytes).slice(0, 15)) {
  console.log(`p${page.page_number}: ${page.resource_count} recursos | ${page.unique_mib} MiB comprimidos | ${page.decoded_rgba_mib} MiB RGBA | lento=${page.slowest_ms} ms | fallos=${page.failed_count}`)
}
console.log('')
console.log('=== 20 RECURSOS MÁS PESADOS COMPRIMIDOS ===')
for (const row of largest) console.log(`${(row.bytes / 1024).toFixed(1)} KiB | ${row.width || '?'}x${row.height || '?'} | ${row.elapsed_ms} ms | ${row.status ?? 'ERR'} | ${row.url}`)
console.log('')
console.log('=== 20 RECURSOS CON MAYOR MEMORIA DECODIFICADA ===')
for (const row of largestDecoded) console.log(`${((row.decoded_rgba_bytes || 0) / 1024 / 1024).toFixed(1)} MiB RGBA | ${row.width || '?'}x${row.height || '?'} | ${(row.bytes / 1024).toFixed(1)} KiB | ${row.url}`)
console.log('')
console.log('=== 20 RECURSOS MÁS LENTOS ===')
for (const row of slowest) console.log(`${row.elapsed_ms} ms | ${(row.bytes / 1024).toFixed(1)} KiB | ${row.status ?? 'ERR'} | ${row.url}`)
console.log(`Reporte JSON: ${OUTPUT}`)

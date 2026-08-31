// Read-only browser probe. It opens the public Viewer and navigates using existing UI controls.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const VIEWER_URL = process.env.INTAP_AUDIT_VIEWER_URL || 'https://flip.intaprd.com/?publication=catalogo-padres-2026'
const OUTPUT = process.env.INTAP_BROWSER_AUDIT_OUTPUT || 'audit-browser.json'
const DEBUG_PORT = Number(process.env.INTAP_CHROME_DEBUG_PORT || 9222)

async function waitForJson(url, timeoutMs = 20000) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch (error) { lastError = error }
    await sleep(200)
  }
  throw new Error(`No respondió ${url}: ${lastError?.message || 'timeout'}`)
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
  }
  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const waiter = this.pending.get(message.id)
        if (!waiter) return
        this.pending.delete(message.id)
        if (message.error) waiter.reject(new Error(message.error.message || JSON.stringify(message.error)))
        else waiter.resolve(message.result)
        return
      }
      const list = this.listeners.get(message.method) || []
      for (const fn of list) fn(message.params || {})
    })
  }
  on(method, fn) {
    const list = this.listeners.get(method) || []
    list.push(fn)
    this.listeners.set(method, list)
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  close() { try { this.ws.close() } catch {} }
}

async function evaluate(cdp, expression, awaitPromise = true) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed')
  return result.result?.value
}

async function poll(cdp, expression, predicate, timeoutMs = 20000, intervalMs = 200) {
  const started = Date.now()
  let value = null
  while (Date.now() - started < timeoutMs) {
    try {
      value = await evaluate(cdp, expression)
      if (predicate(value)) return value
    } catch {}
    await sleep(intervalMs)
  }
  return value
}

async function snapshot(cdp, label) {
  const pageState = await evaluate(cdp, `(() => {
    const pages = Array.from(document.querySelectorAll('#flipbook .page'))
    return {
      label: ${JSON.stringify(label)},
      pageInfo: document.getElementById('page-info')?.textContent || '',
      loadingVisible: !!document.getElementById('loading-screen'),
      preparingVisible: (() => { const e = document.getElementById('intap-page-preparing'); return !!e && getComputedStyle(e).display !== 'none' })(),
      pages: pages.map((p, index) => ({
        index,
        bgLoaded: !!p.__pageBackgroundLoaded,
        bgLoading: !!p.__pageBackgroundLoading,
        overlayBuilt: !!p.__overlayBuilt,
        overlayBuilding: !!p.__overlayBuilding,
        canvasCount: p.querySelectorAll('canvas').length,
        domImageCount: p.querySelectorAll('img').length,
        interactiveCount: p.querySelectorAll('[data-flip-interactive="true"]').length,
        backgroundImage: p.__pageSheet ? p.__pageSheet.style.backgroundImage : '',
      })),
      resourceEntries: performance.getEntriesByType('resource').length,
      transferBytes: performance.getEntriesByType('resource').reduce((s, e) => s + (e.transferSize || 0), 0),
      decodedBodyBytes: performance.getEntriesByType('resource').reduce((s, e) => s + (e.decodedBodySize || 0), 0),
    }
  })()`)
  const heap = await cdp.send('Runtime.getHeapUsage').catch(() => ({}))
  const dom = await cdp.send('Memory.getDOMCounters').catch(() => ({}))
  return { ...pageState, heap, dom, captured_at: new Date().toISOString() }
}

const chromeCandidates = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)
let chromeBin = null
for (const candidate of chromeCandidates) {
  try { await fs.access(candidate); chromeBin = candidate; break } catch {}
}
if (!chromeBin) throw new Error('No se encontró Chrome/Chromium en el runner.')

const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'intap-viewer-audit-'))
console.log(`Chrome: ${chromeBin}`)
console.log(`Viewer: ${VIEWER_URL}`)

const chrome = spawn(chromeBin, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`,
  '--window-size=1365,900',
  VIEWER_URL,
], { stdio: ['ignore', 'pipe', 'pipe'] })

let chromeErr = ''
chrome.stderr.on('data', (chunk) => { chromeErr += chunk.toString() })

const consoleEvents = []
const exceptions = []
const networkFailures = []
const httpErrors = []
const snapshots = []
let cdp = null

try {
  const targets = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`, 20000)
  const target = targets.find((item) => item.type === 'page') || targets[0]
  if (!target?.webSocketDebuggerUrl) throw new Error('No se encontró target CDP del Viewer.')

  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  cdp.on('Runtime.consoleAPICalled', (event) => {
    const text = (event.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')
    if (event.type === 'error' || event.type === 'warning' || /\[viewer\]/i.test(text)) {
      consoleEvents.push({ type: event.type, text, timestamp: event.timestamp })
    }
  })
  cdp.on('Runtime.exceptionThrown', (event) => {
    exceptions.push({ text: event.exceptionDetails?.text, description: event.exceptionDetails?.exception?.description, timestamp: event.timestamp })
  })
  cdp.on('Network.loadingFailed', (event) => {
    networkFailures.push({ requestId: event.requestId, errorText: event.errorText, canceled: event.canceled, type: event.type })
  })
  cdp.on('Network.responseReceived', (event) => {
    if ((event.response?.status || 0) >= 400) {
      httpErrors.push({ status: event.response.status, url: event.response.url, mimeType: event.response.mimeType, type: event.type })
    }
  })

  await Promise.all([
    cdp.send('Runtime.enable'),
    cdp.send('Network.enable'),
    cdp.send('Page.enable'),
    cdp.send('Performance.enable'),
  ])

  await poll(cdp, `document.readyState`, (value) => value === 'complete', 20000)
  const firstInfo = await poll(cdp, `document.getElementById('page-info')?.textContent || ''`, (value) => /\d+\s*\/\s*\d+/.test(value || ''), 30000)
  console.log(`Inicial: ${firstInfo || '(sin page-info)'}`)
  snapshots.push(await snapshot(cdp, 'initial'))

  // Navigate until the final page or until repeated attempts make no progress.
  let stagnant = 0
  let previousInfo = firstInfo
  for (let step = 1; step <= 22; step += 1) {
    await evaluate(cdp, `document.getElementById('btn-next')?.click(); true`)
    const nextInfo = await poll(
      cdp,
      `document.getElementById('page-info')?.textContent || ''`,
      (value) => value && value !== previousInfo,
      9000,
      150,
    )
    await sleep(350)
    const snap = await snapshot(cdp, `step-${step}`)
    snapshots.push(snap)
    console.log(`Paso ${step}: ${snap.pageInfo} | heap=${Math.round((snap.heap?.usedSize || 0) / 1024 / 1024)} MiB | nodes=${snap.dom?.nodes || 0} | resources=${snap.resourceEntries}`)

    if (snap.pageInfo === previousInfo) stagnant += 1
    else stagnant = 0
    previousInfo = snap.pageInfo

    const match = String(snap.pageInfo).match(/(\d+)\s*\/\s*(\d+)/)
    if (match && Number(match[1]) >= Number(match[2])) break
    if (stagnant >= 2) break
  }

  await sleep(5000)
  snapshots.push(await snapshot(cdp, 'after-5s-idle'))

  const finalResources = await evaluate(cdp, `performance.getEntriesByType('resource').map(e => ({name:e.name, initiatorType:e.initiatorType, duration:e.duration, transferSize:e.transferSize, encodedBodySize:e.encodedBodySize, decodedBodySize:e.decodedBodySize})).sort((a,b)=>b.duration-a.duration).slice(0,100)`)

  const report = {
    generated_at: new Date().toISOString(),
    viewer_url: VIEWER_URL,
    chrome: chromeBin,
    snapshots,
    console_events: consoleEvents,
    exceptions,
    network_failures: networkFailures,
    http_errors: httpErrors,
    slow_resources: finalResources,
    chrome_stderr_tail: chromeErr.slice(-6000),
  }
  await fs.writeFile(OUTPUT, JSON.stringify(report, null, 2))

  const final = snapshots.at(-1)
  const built = final.pages.filter((p) => p.overlayBuilt).length
  const loading = final.pages.filter((p) => p.overlayBuilding || p.bgLoading).length
  console.log('')
  console.log('=== BROWSER RESUMEN ===')
  console.log(`Final: ${final.pageInfo}`)
  console.log(`Overlays construidos: ${built}/${final.pages.length}`)
  console.log(`Páginas aún cargando: ${loading}`)
  console.log(`Heap usado: ${Math.round((final.heap?.usedSize || 0) / 1024 / 1024)} MiB`)
  console.log(`Documentos=${final.dom?.documents || 0} nodos=${final.dom?.nodes || 0} listeners=${final.dom?.jsEventListeners || 0}`)
  console.log(`Excepciones: ${exceptions.length}`)
  console.log(`Network loadingFailed: ${networkFailures.length}`)
  console.log(`HTTP >=400: ${httpErrors.length}`)
  console.log(`Consola warning/error viewer: ${consoleEvents.length}`)
  console.log(`Reporte JSON: ${OUTPUT}`)
} finally {
  cdp?.close()
  try { chrome.kill('SIGTERM') } catch {}
  await sleep(300)
  try { chrome.kill('SIGKILL') } catch {}
  await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {})
}

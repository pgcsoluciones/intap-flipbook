// Visual QA probe for the deployed Viewer Preview. Read-only: it only opens the Viewer and clicks Next.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const VIEWER_URL = process.env.INTAP_VISUAL_VIEWER_URL
const OUTPUT_DIR = process.env.INTAP_VISUAL_OUTPUT_DIR || 'audit-viewer-visual'
const DEBUG_PORT = Number(process.env.INTAP_VISUAL_CHROME_DEBUG_PORT || 9230)
const WIDTH = Number(process.env.INTAP_VISUAL_WIDTH || 1365)
const HEIGHT = Number(process.env.INTAP_VISUAL_HEIGHT || 900)
const TARGETS = String(process.env.INTAP_VISUAL_TARGETS || '1,16,18,20,34')
  .split(',').map((v) => Number(v.trim())).filter(Number.isFinite)
const SLOW_NETWORK = process.env.INTAP_VISUAL_SLOW_NETWORK === '1'
const CAPTURE_DELAY_MS = Number(process.env.INTAP_VISUAL_CAPTURE_DELAY_MS || (SLOW_NETWORK ? 10000 : 1200))

if (!VIEWER_URL) throw new Error('Falta INTAP_VISUAL_VIEWER_URL')
await fs.mkdir(OUTPUT_DIR, { recursive: true })

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
  }
  async open() {
    if (this.ws.readyState !== WebSocket.OPEN) {
      await new Promise((resolve, reject) => {
        this.ws.addEventListener('open', resolve, { once: true })
        this.ws.addEventListener('error', reject, { once: true })
      })
    }
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id) return
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message || JSON.stringify(message.error)))
      else waiter.resolve(message.result)
    })
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

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed')
  return result.result?.value
}

async function poll(cdp, expression, predicate, timeoutMs = 30000, intervalMs = 200) {
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

function pageNumber(info) {
  const m = String(info || '').match(/(\d+)\s*\/\s*(\d+)/)
  return m ? Number(m[1]) : null
}

async function currentState(cdp) {
  return evaluate(cdp, `(() => {
    const info = document.getElementById('page-info')?.textContent || ''
    const pages = Array.from(document.querySelectorAll('#flipbook .page'))
    const visible = pages.map((p, index) => {
      const r = p.getBoundingClientRect()
      const style = getComputedStyle(p)
      const onScreen = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && style.visibility !== 'hidden' && style.display !== 'none'
      return {
        index,
        onScreen,
        bgLoaded: !!p.__pageBackgroundLoaded,
        overlayBuilt: !!p.__overlayBuilt,
        canvases: p.querySelectorAll('canvas').length,
        imgs: p.querySelectorAll('img').length,
        interactives: p.querySelectorAll('[data-flip-interactive="true"]').length,
        rect: { left:r.left, top:r.top, width:r.width, height:r.height },
      }
    }).filter((p) => p.onScreen)
    return { info, width: innerWidth, height: innerHeight, visible }
  })()`)
}

async function capture(cdp, label) {
  await sleep(CAPTURE_DELAY_MS)
  const state = await currentState(cdp)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  const safe = label.replace(/[^a-zA-Z0-9_-]+/g, '-')
  await fs.writeFile(path.join(OUTPUT_DIR, `${safe}.png`), Buffer.from(shot.data, 'base64'))
  return { label, captureDelayMs: CAPTURE_DELAY_MS, ...state }
}

const chromeCandidates = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean)
let chromeBin = null
for (const candidate of chromeCandidates) {
  try { await fs.access(candidate); chromeBin = candidate; break } catch {}
}
if (!chromeBin) throw new Error('No se encontró Chrome/Chromium')

const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'intap-viewer-visual-'))
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking',
  '--disable-web-security', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDir}`, `--window-size=${WIDTH},${HEIGHT}`, VIEWER_URL,
], { stdio: ['ignore', 'pipe', 'pipe'] })

let cdp
try {
  const targets = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
  const target = targets.find((item) => item.type === 'page') || targets[0]
  if (!target?.webSocketDebuggerUrl) throw new Error('No target CDP')
  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await Promise.all([cdp.send('Runtime.enable'), cdp.send('Network.enable'), cdp.send('Page.enable')])
  if (SLOW_NETWORK) {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750, connectionType: 'cellular4g',
    })
  }
  await poll(cdp, `document.readyState`, (v) => v === 'complete', 20000)
  const first = await poll(cdp, `document.getElementById('page-info')?.textContent || ''`, (v) => /\d+\s*\/\s*\d+/.test(v || ''), 40000)
  if (!first) throw new Error('Viewer no mostró page-info')

  const manifest = []
  for (const targetPage of TARGETS) {
    let info = await evaluate(cdp, `document.getElementById('page-info')?.textContent || ''`)
    let current = pageNumber(info)
    let attempts = 0
    while (current != null && current < targetPage && attempts < 40) {
      const previous = info
      await evaluate(cdp, `document.getElementById('btn-next')?.click(); true`)
      info = await poll(cdp, `document.getElementById('page-info')?.textContent || ''`, (v) => v && v !== previous, 12000, 150)
      current = pageNumber(info)
      attempts += 1
      await sleep(350)
    }
    const actual = pageNumber(info)
    manifest.push(await capture(cdp, `target-${targetPage}-actual-${actual ?? 'none'}`))
  }
  await fs.writeFile(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify({ viewer_url: VIEWER_URL, width: WIDTH, height: HEIGHT, slow_network: SLOW_NETWORK, capture_delay_ms: CAPTURE_DELAY_MS, captures: manifest }, null, 2))
  console.log(JSON.stringify(manifest.map((m) => ({ label:m.label, info:m.info, visible:m.visible.length, captureDelayMs:m.captureDelayMs })), null, 2))
} finally {
  cdp?.close()
  try { chrome.kill('SIGTERM') } catch {}
  await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {})
}

import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function svgBytes(label, targetBytes) {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="1200" height="1600" fill="#f8fafc"/><text x="80" y="140" font-size="72" fill="#111827">${label}</text><!--`
  const tail = '--></svg>'
  const filler = 'x'.repeat(Math.max(0, targetBytes - Buffer.byteLength(head) - Buffer.byteLength(tail)))
  return Buffer.from(`${head}${filler}${tail}`)
}

const originals = Array.from({ length: 8 }, (_, index) => svgBytes(`legacy ${index + 1}`, 1_500_000 + index * 130_000))
const displays = Array.from({ length: 8 }, (_, index) => svgBytes(`display ${index + 1}`, 96_000 + index * 4_000))
const thumbs = Array.from({ length: 8 }, (_, index) => svgBytes(`thumb ${index + 1}`, 12_000 + index * 600))

function pageHtml(mode) {
  return `<!doctype html>
<meta charset="utf-8">
<title>pending</title>
<canvas id="canvas" width="360" height="480"></canvas>
<div id="bank"></div>
<pre id="result"></pre>
<script>
const mode = ${JSON.stringify(mode)};
const urls = Array.from({ length: 8 }, (_, i) => ({
  original: '/original-' + (i + 1) + '.svg',
  display: '/display-' + (i + 1) + '.svg',
  thumb: '/thumb-' + (i + 1) + '.svg'
}));
function now() { return performance.now(); }
function resourceBytes(filter) {
  return performance.getEntriesByType('resource')
    .filter((entry) => filter(entry.name))
    .reduce((sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || entry.decodedBodySize || 0), 0);
}
function countRequests(filter) {
  return performance.getEntriesByType('resource').filter((entry) => filter(entry.name)).length;
}
async function fetchAsset(url) {
  const start = now();
  const response = await fetch(url, { cache: 'no-store' });
  const buffer = await response.arrayBuffer();
  return { url, blob: new Blob([buffer], { type: response.headers.get('content-type') || 'image/svg+xml' }), loadMs: now() - start, bytes: buffer.byteLength };
}
function decodeBlob(blob) {
  const objectUrl = URL.createObjectURL(blob);
  const start = now();
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = async () => {
      const decodeStart = now();
      try { await img.decode(); } catch {}
      URL.revokeObjectURL(objectUrl);
      resolve({ img, loadMs: now() - start, decodeMs: now() - decodeStart });
    };
    img.onerror = (error) => { URL.revokeObjectURL(objectUrl); reject(error); };
    img.src = objectUrl;
  });
}
async function drawCanvas(url) {
  const fetched = await fetchAsset(url);
  const loaded = await decodeBlob(fetched.blob);
  const ctx = document.getElementById('canvas').getContext('2d');
  ctx.clearRect(0, 0, 360, 480);
  ctx.drawImage(loaded.img, 0, 0, 360, 480);
  return { ...loaded, url, bytes: fetched.bytes, loadMs: fetched.loadMs };
}
async function measure() {
  const activeUrl = mode === 'before' ? urls[0].original : urls[0].display;
  const page2Url = mode === 'before' ? urls[1].original : urls[1].display;
  const bankUrls = urls.map((item) => mode === 'before' ? item.original : item.thumb);
  const openStart = now();
  const firstCanvas = await drawCanvas(activeUrl);
  const firstRenderMs = now() - openStart;
  const switchStart = now();
  await drawCanvas(page2Url);
  const switchPageMs = now() - switchStart;
  const textStart = now();
  const ctx = document.getElementById('canvas').getContext('2d');
  ctx.font = '24px sans-serif';
  ctx.fillText('Texto aqui', 20, 60);
  const addTextMs = now() - textStart;
  const shapeStart = now();
  ctx.fillStyle = '#4f46e5';
  ctx.fillRect(60, 90, 120, 80);
  const addShapeMs = now() - shapeStart;
  const bankStart = now();
  await Promise.all(bankUrls.map((url) => fetchAsset(url)));
  const bankMs = now() - bankStart;
  const totalBytes = resourceBytes((name) => name.includes('/original-') || name.includes('/display-') || name.includes('/thumb-'));
  const originalRequests = countRequests((name) => name.includes('/original-'));
  const displayRequests = countRequests((name) => name.includes('/display-'));
  const thumbnailRequests = countRequests((name) => name.includes('/thumb-'));
  const result = {
    mode,
    firstRenderMs: Math.round(firstRenderMs * 10) / 10,
    activeImageLoadMs: Math.round(firstCanvas.loadMs * 10) / 10,
    activeImageDecodeMs: Math.round(firstCanvas.decodeMs * 10) / 10,
    switchPageMs: Math.round(switchPageMs * 10) / 10,
    addTextMs: Math.round(addTextMs * 10) / 10,
    addShapeMs: Math.round(addShapeMs * 10) / 10,
    bankMs: Math.round(bankMs * 10) / 10,
    totalBytes,
    requests: originalRequests + displayRequests + thumbnailRequests,
    originalRequests,
    displayRequests,
    thumbnailRequests,
    activeUrl,
    bankFirstUrl: bankUrls[0],
  };
  document.getElementById('result').textContent = JSON.stringify(result);
  document.title = 'done';
}
measure().catch((error) => {
  document.getElementById('result').textContent = JSON.stringify({ mode, error: String(error && error.message || error) });
  document.title = 'done';
});
</script>`
}

function extractResult(html) {
  const match = html.match(/<pre id="result">([^<]+)<\/pre>/)
  if (!match) throw new Error(`No benchmark result in Chrome output: ${html.slice(0, 500)}`)
  return JSON.parse(match[1].replace(/&quot;/g, '"'))
}

async function runChrome(url) {
  const profile = '/tmp/intap-editor-browser-perf-profile-' + process.pid + '-' + Math.random().toString(16).slice(2)
  const { stdout } = await execFileAsync(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    '--disable-background-networking',
    '--disable-extensions',
    `--user-data-dir=${profile}`,
    '--dump-dom',
    '--virtual-time-budget=10000',
    url,
  ], { maxBuffer: 1024 * 1024 * 5, timeout: 20000 })
  return extractResult(stdout)
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const asset = url.pathname.match(/^\/(original|display|thumb)-(\d+)\.svg$/)
  if (asset) {
    const [, kind, indexRaw] = asset
    const index = Number(indexRaw) - 1
    const body = kind === 'original' ? originals[index] : kind === 'display' ? displays[index] : thumbs[index]
    res.writeHead(200, {
      'content-type': 'image/svg+xml',
      'content-length': body.length,
      'cache-control': 'no-store',
      'timing-allow-origin': '*',
    })
    res.end(body)
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(pageHtml(url.searchParams.get('mode') === 'after' ? 'after' : 'before'))
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
try {
  const { port } = server.address()
  const before = await runChrome(`http://127.0.0.1:${port}/?mode=before&perf=1`)
  const after = await runChrome(`http://127.0.0.1:${port}/?mode=after&perf=1`)
  console.log(JSON.stringify({
    before,
    after,
    delta: {
      bytesSaved: before.totalBytes - after.totalBytes,
      bytesSavedPercent: Math.round((1 - after.totalBytes / before.totalBytes) * 1000) / 10,
      firstRenderMsSaved: Math.round((before.firstRenderMs - after.firstRenderMs) * 10) / 10,
      bankMsSaved: Math.round((before.bankMs - after.bankMs) * 10) / 10,
    },
  }, null, 2))
} finally {
  await new Promise((resolve) => server.close(resolve))
}

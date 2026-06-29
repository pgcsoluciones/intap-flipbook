import { readFileSync } from 'node:fs'

const HELP = 'Revisar docs/CRITICAL_EDITOR_BEHAVIORS.md.\nNo eliminar o alterar este mecanismo sin autorización explícita.'

function read(path) {
  return readFileSync(path, 'utf8')
}

function fail(message) {
  console.error(`Protected editor guardrail failed: ${message}\n${HELP}`)
  process.exit(1)
}

function requireIncludes(source, needle, label) {
  if (!source.includes(needle)) fail(`falta ${label}: ${needle}`)
}

const editor = read('apps/dashboard/src/pages/EditPublication.tsx')
const upload = read('apps/api/src/routes/upload.ts')
const index = read('apps/api/src/index.ts')

for (const [needle, label] of [
  ['const AUTOSAVE_DELAY_MS = 3000', 'debounce de autoguardado protegido'],
  ['restoreCanvasBackground', 'restauración de fondo en Undo/Redo'],
  ['saveSeqRef', 'secuencia de guardados por página'],
  ['saveChainRef', 'cola de guardados por página'],
  ['text:editing:entered', 'evento de entrada de edición de texto'],
  ['text:editing:exited', 'evento de salida de edición de texto'],
  ['function CtaActionFields', 'componente estable de acciones de ficha'],
  ['draftValue', 'borrador local de valor CTA'],
  ['draftMessage', 'borrador local de mensaje CTA'],
  ['commitDraft', 'confirmación controlada de CTA'],
  ['renderPageThumbnailSnapshot', 'renderizado de miniaturas'],
  ['normalizeFabricAssetJson', 'normalización de assets Fabric'],
  ['collectThumbnailImageUrls', 'detección de URLs de imagen para miniatura'],
  ['loadFabricImageForSnapshot', 'precarga CORS de imágenes para miniatura'],
]) {
  requireIncludes(editor, needle, label)
}

if (editor.includes("canvas.on('text:changed'") || editor.includes('canvas.on("text:changed"')) {
  fail("detectado listener prohibido canvas.on('text:changed')")
}

for (const [needle, label] of [
  ['servePublicUpload', 'ruta pública segura de uploads'],
  ["upload.get('/uploads/:key{.+}'", 'GET público seguro de uploads'],
  ["upload.on('HEAD', '/uploads/:key{.+}'", 'HEAD público seguro de uploads'],
  ["upload.use('*', jwtMiddleware)", 'protección JWT para rutas de upload no públicas'],
]) {
  requireIncludes(upload, needle, label)
}

const uploadRoute = "app.route('/api/upload', uploadRoutes)"
const apiRoute = "app.route('/api', pageRoutes)"
const uploadIndex = index.indexOf(uploadRoute)
const apiIndex = index.indexOf(apiRoute)
if (uploadIndex === -1) fail(`falta montaje de upload: ${uploadRoute}`)
if (apiIndex === -1) fail(`falta montaje general de API: ${apiRoute}`)
if (uploadIndex > apiIndex) {
  fail(`${uploadRoute} debe aparecer antes que ${apiRoute}`)
}

console.log('Protected editor guardrails OK')

import { BLANK_PAGE_URL } from '../lib/blankPage'
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
// @ts-ignore
import { fabric } from 'fabric'
import { ApiRequestError, api, toCanvasSafeAssetUrl, type MediaAsset, type MediaFolder } from '../lib/api'
import { PageBatchConfirmationError, pdfPageAssetName, processPageBatch, uploadPdfRenderedPagesAsAssets } from '../lib/pageBatch'
import { optimizeImageFile, type OptimizedImageResult } from '../lib/imageOptimization'
import {
  buildDisplayLookup,
  buildThumbnailLookup,
  firstVisibleIndexes,
  mergeThumbnailLookup,
  mergeSavedPagePreservingThumbnailVersion,
  normalizeCanvasTextBaseline,
  pageThumbCardPropsEqual,
  pageThumbnailCacheKey,
  patchPageThumbnailContent,
  resolveDisplayUrl,
  resolvePageCardBackgroundUrl,
  resolvePageThumbnailOverlay,
  thumbnailJobStillCurrent,
  shouldLoadPageThumbnail,
  upsertPageById,
} from '../lib/editorPerformance'
import {
  FABRIC_CLONE_CUSTOM_PROPS,
  clonePlainValue,
  collectFabricElementIds,
  editorClipboardCountLabel,
  getFabricSelectionObjects,
  prepareClipboardObjectsForPaste,
  resetDuplicateTree,
  serializeFabricSelectionForClipboard,
  shouldIgnoreEditorClipboardShortcut,
  stripDynamicAssociations,
} from '../lib/editorClipboard'
import {
  appendMediaPickerUrls,
  MEDIA_PICKER_REPLACEMENT_ERROR,
  readMediaPickerFolder,
  resolveMediaPickerReplacementSource,
  selectFirstMediaPickerUrl,
  shouldOpenImageReplacementForObject,
  writeMediaPickerFolder,
  type MediaPickerFolderId,
} from '../lib/mediaPickerIntent'
import {
  type EditorHistory,
  appendEditorHistorySnapshot,
  createEditorHistory,
  editorHistoryStorageKey,
  getEditorHistoryCurrentSnapshot,
  loadEditorHistoryFromSession,
  moveEditorHistoryIndex,
  removeEditorHistoryFromSession,
  saveEditorHistoryToSession,
} from '../lib/editorHistory'
import FileField from '../components/FileField'
import MediaPicker, { resolveExistingMediaFolderFilter } from '../components/MediaPicker'
import WidgetPreview from '../components/WidgetPreview'
import DynamicMarkerPanel from '../components/DynamicMarkerPanel'

// Tipos MIME para los distintos campos de subida del editor
const ACCEPT_AUDIO = 'audio/mpeg,audio/mp3,audio/ogg,audio/wav,audio/mp4,audio/aac'
const ACCEPT_VIDEO = 'video/mp4,video/webm,video/ogg'
const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,image/svg+xml,image/gif'
const ACCEPT_FILE  = 'application/pdf,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png,image/webp'

// Página en blanco: SVG data-URL blanco con proporción A4 retrato. Sirve como
// image_url de fondo cuando el usuario crea una página desde cero (sin subir nada).

// Dimensiones de diseño del lienzo (proporción A4 retrato). El viewer usa las
// mismas (DESIGN_W/DESIGN_H en flipbook.js) para que editor y publicado coincidan.
const CANVAS_W = 580
const CANVAS_H = Math.round(CANVAS_W * 1.414)
const THUMB_W = 220
// PROTECTED: 3-second editor autosave debounce.
// Reducing this can reintroduce excessive saves and focus loss while editing.
const AUTOSAVE_DELAY_MS = 3000
type MediaBankFolderFilter = undefined | null | string
type FabricObjectInstance = Record<string, any>
type FabricCanvasInstance = Record<string, any>
type EditorMediaPickerIntent =
  | { type: 'insert-images'; pageId: string }
  | { type: 'replace-object'; pageId: string; elementId: string; canvasInstance: FabricCanvasInstance }
  | { type: 'pages' }
  | { type: 'svg' }
  | { type: 'widget-gallery-add'; pageId: string; elementId: string; max: number }
  | { type: 'widget-gallery-replace'; pageId: string; elementId: string; imageIndex: number }
  | { type: 'action-gallery-add'; pageId: string; elementId: string; max: number }
  | { type: 'action-gallery-replace'; pageId: string; elementId: string; imageIndex: number }
  | { type: 'widget-image-field'; pageId: string; elementId: string; field: 'image' | 'poster' }
  | { type: 'action-image-field'; pageId: string; elementId: string; field: 'image' }
type OpenWidgetGalleryMediaPicker = (request:
  | { type: 'add'; max: number }
  | { type: 'replace'; imageIndex: number }
  | { type: 'field'; field: 'image' | 'poster' }
) => void
let editorHistorySessionStorageAccessWarningShown = false

function createFabricElementId() {
  return `el_${Math.random().toString(36).slice(2, 9)}`
}

function getEditorHistorySessionStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch (error) {
    if (!editorHistorySessionStorageAccessWarningShown) {
      editorHistorySessionStorageAccessWarningShown = true
      console.warn('[editorHistory] sessionStorage unavailable; undo history will remain in memory only', error)
    }
    return null
  }
}

// Calcula el recorte "cubrir" de una imagen dentro de un recuadro destino según el
// encuadre { zoom>=1, fx 0..1, fy 0..1 }. zoom=1 y fx=fy=0.5 → cubrir centrado.
// Por defecto el recuadro es el lienzo A4; se puede pasar otro (ej. la caja de una
// imagen seleccionada) para reencuadrar ese elemento con la misma lógica.
function computeCover(iw: number, ih: number, fr: { zoom?: number; fx?: number; fy?: number }, targetW: number = CANVAS_W, targetH: number = CANVAS_H) {
  const zoom = Math.max(1, fr?.zoom ?? 1)
  const fx = Math.min(1, Math.max(0, fr?.fx ?? 0.5))
  const fy = Math.min(1, Math.max(0, fr?.fy ?? 0.5))
  const targetAspect = targetW / targetH
  let baseW: number, baseH: number
  if (iw / ih > targetAspect) { baseH = ih; baseW = ih * targetAspect }
  else { baseW = iw; baseH = iw / targetAspect }
  const cropW = baseW / zoom, cropH = baseH / zoom
  const cropX = (iw - cropW) * fx
  const cropY = (ih - cropH) * fy
  return { cropX, cropY, cropW, cropH, scaleX: targetW / cropW, scaleY: targetH / cropH }
}

function stripBackgroundImage(json: any) {
  if (!json || typeof json !== 'object') return json
  const next = { ...json }
  delete next.backgroundImage
  return next
}

function serializeCanvasJson(canvas: any) {
  return stripBackgroundImage(canvas?.toJSON?.(['data']) as any)
}

function parseCoverFrame(coverJson: any) {
  try {
    return coverJson
      ? { zoom: 1, fx: 0.5, fy: 0.5, ...(typeof coverJson === 'string' ? JSON.parse(coverJson) : coverJson) }
      : { zoom: 1, fx: 0.5, fy: 0.5 }
  } catch {
    return { zoom: 1, fx: 0.5, fy: 0.5 }
  }
}

function isHttpUrl(url: any) {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

function formatMediaBytes(bytes?: number | null) {
  if (!Number.isFinite(bytes ?? 0) || !bytes || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatMediaMime(mime?: string | null) {
  if (!mime) return 'Imagen'
  if (mime.includes('svg')) return 'SVG'
  if (mime.includes('jpeg')) return 'JPG'
  if (mime.includes('png')) return 'PNG'
  if (mime.includes('webp')) return 'WebP'
  if (mime.includes('gif')) return 'GIF'
  return mime.split('/').pop()?.toUpperCase() ?? 'Imagen'
}

function emptyFabricJson() {
  return { version: '5.3.0', objects: [] }
}

// PROTECTED: Rewrites legacy direct R2 image URLs for Fabric-safe thumbnail loading.
// Removing this causes bank/uploaded raster images to disappear from thumbnails.
function normalizeFabricAssetJson(json: any, resolveUrl: (url: string) => string = (url) => url): any {
  if (!json) return json
  let root = json
  if (typeof root === 'string') {
    try {
      root = JSON.parse(root)
    } catch {
      return json
    }
  }
  const visit = (node: any): any => {
    if (!node || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map((item) => visit(item))
    const next = { ...node }

    // Corrige canvas_json antiguos que contienen un valor inválido para
    // CanvasTextBaseline. Se aplica también dentro de grupos y clipPaths.
    if ('textBaseline' in next) {
      next.textBaseline = normalizeCanvasTextBaseline(next.textBaseline)
    }

    if (typeof next.src === 'string' && isHttpUrl(next.src)) {
      next.src = resolveUrl(toCanvasSafeAssetUrl(next.src))
      next.crossOrigin = 'anonymous'
    }
    if (next.backgroundImage) next.backgroundImage = visit(next.backgroundImage)
    if (next.overlayImage) next.overlayImage = visit(next.overlayImage)
    if (next.clipPath) next.clipPath = visit(next.clipPath)
    if (Array.isArray(next.objects)) next.objects = next.objects.map((item: any) => visit(item))
    if (Array.isArray(next._objects)) next._objects = next._objects.map((item: any) => visit(item))
    return next
  }
  return visit(root)
}

// PROTECTED: Preloads Fabric images with CORS before snapshot to avoid tainted canvases.
function loadFabricImageForSnapshot(url: string) {
  return new Promise<any>((resolve, reject) => {
    const safeUrl = toCanvasSafeAssetUrl(url)
    const options = isHttpUrl(safeUrl) ? { crossOrigin: 'anonymous' } : undefined
    fabric.Image.fromURL(safeUrl, (img: any, isError: boolean) => {
      if (isError || !img) {
        reject(new Error(`No se pudo cargar la imagen: ${safeUrl}`))
        return
      }
      resolve(img)
    }, options as any)
  })
}

function loadCanvasFabricImage(url: string, onLoad: (img: any) => void, onError?: (message: string) => void) {
  const safeUrl = toCanvasSafeAssetUrl(url)
  const options = isHttpUrl(safeUrl) ? { crossOrigin: 'anonymous' } : undefined
  fabric.Image.fromURL(safeUrl, (img: any, isError: boolean) => {
    if (isError || !img) {
      console.error('[thumbnail] canvas image load failed', safeUrl)
      onError?.(`No se pudo cargar la imagen: ${safeUrl}`)
      return
    }
    onLoad(img)
  }, options as any)
}

const decodedImageCache = new Map<string, Promise<HTMLImageElement>>()

function perfEnabled() {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('perf') === '1'
}

function perfMark(name: string, detail?: Record<string, unknown>) {
  if (!perfEnabled()) return
  try {
    performance.mark(name)
    console.debug('[editor-perf]', name, detail ?? {})
  } catch {}
}

function perfMeasure(name: string, start: string, end?: string, detail?: Record<string, unknown>) {
  if (!perfEnabled()) return
  try {
    if (end) performance.measure(name, start, end)
    else performance.measure(name, start)
    const entry = performance.getEntriesByName(name).slice(-1)[0]
    console.debug('[editor-perf]', name, {
      duration_ms: entry ? Math.round(entry.duration * 10) / 10 : null,
      ...detail,
    })
  } catch {}
}

function resourceStats(url: string) {
  if (typeof performance === 'undefined') return null
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  const entry = entries.slice().reverse().find((item) => item.name === url)
  if (!entry) return null
  return {
    transferSize: entry.transferSize,
    decodedBodySize: entry.decodedBodySize,
    duration_ms: Math.round(entry.duration * 10) / 10,
  }
}

async function loadDecodedImage(url: string) {
  const safeUrl = toCanvasSafeAssetUrl(url)
  const cached = decodedImageCache.get(safeUrl)
  if (cached) {
    perfMark('image-cache-hit', { url: safeUrl })
    return cached
  }
  perfMark('image-cache-miss', { url: safeUrl })
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    if (isHttpUrl(safeUrl)) img.crossOrigin = 'anonymous'
    img.onload = async () => {
      try { await img.decode?.() } catch {}
      if (perfEnabled()) {
        console.debug('[editor-perf] image-loaded', {
          url: safeUrl,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          resource: resourceStats(safeUrl),
        })
      }
      resolve(img)
    }
    img.onerror = () => {
      decodedImageCache.delete(safeUrl)
      reject(new Error(`No se pudo cargar la imagen: ${safeUrl}`))
    }
    img.decoding = 'async'
    img.src = safeUrl
  })
  decodedImageCache.set(safeUrl, promise)
  return promise
}

async function loadFabricImageCached(url: string) {
  const img = await loadDecodedImage(url)
  return new fabric.Image(img)
}

const DUPLICATE_OFFSET = 20

function emptyFabricCanvasJson() {
  return { version: fabric.version, objects: [] }
}

function normalizeSourceCanvasJson(value: any) {
  if (!value) return emptyFabricCanvasJson()
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : clonePlainValue(value)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.objects)) return emptyFabricCanvasJson()
    return parsed
  } catch {
    return emptyFabricCanvasJson()
  }
}

function collectCanvasJsonElementIds(json: any, out = new Set<string>()) {
  const root = typeof json === 'string'
    ? (() => {
        try { return JSON.parse(json) } catch { return null }
      })()
    : json

  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return
    const elementId = node?.data?.elementId
    if (typeof elementId === 'string' && elementId) out.add(elementId)
    const children = Array.isArray(node.objects)
      ? node.objects
      : Array.isArray(node._objects) ? node._objects : []
    children.forEach(visit)
  }

  const objects = Array.isArray(root?.objects) ? root.objects : []
  objects.forEach(visit)
  return out
}

function cloneCanvasJsonForDuplicate(
  sourceJson: any,
  existingElementIds = new Set<string>(),
) {
  const clonedJson = clonePlainValue(normalizeSourceCanvasJson(sourceJson))
  ;(clonedJson.objects ?? []).forEach((obj: any) =>
    resetDuplicateTree(obj, existingElementIds),
  )
  return clonedJson
}

function cloneCoverJsonForDuplicate(coverJson: any) {
  if (!coverJson) return null
  try {
    const parsed = typeof coverJson === 'string' ? JSON.parse(coverJson) : coverJson
    return JSON.stringify(clonePlainValue(parsed))
  } catch {
    return typeof coverJson === 'string'
      ? coverJson
      : JSON.stringify(clonePlainValue(coverJson))
  }
}

function restoreDuplicateInteractivity(clone: any, source: any) {
  clone.set?.({
    visible: source?.visible !== false,
    selectable: source?.selectable !== false,
    evented: source?.evented !== false,
    hasControls: source?.hasControls !== false,
    hasBorders: source?.hasBorders !== false,
  })
  const cloneChildren = typeof clone?.getObjects === 'function' ? clone.getObjects() : clone?._objects
  const sourceChildren = typeof source?.getObjects === 'function' ? source.getObjects() : source?._objects
  if (Array.isArray(cloneChildren) && Array.isArray(sourceChildren)) {
    cloneChildren.forEach((child: any, index: number) => restoreDuplicateInteractivity(child, sourceChildren[index]))
  }
}

function exitTextEditingBeforeDuplicate(obj: any) {
  if (obj?.isEditing && typeof obj.exitEditing === 'function') {
    obj.exitEditing()
  }
  const children = typeof obj?.getObjects === 'function' ? obj.getObjects() : obj?._objects
  if (Array.isArray(children)) {
    children.forEach((child: any) => exitTextEditingBeforeDuplicate(child))
  }
}

function cloneFabricObject(obj: any) {
  return new Promise<any>((resolve, reject) => {
    try {
      const maybePromise = obj.clone((clone: any) => resolve(clone), FABRIC_CLONE_CUSTOM_PROPS)
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(resolve).catch(reject)
      }
    } catch (error) {
      reject(error)
    }
  })
}

function enlivenFabricObjects(objects: any[]) {
  return new Promise<any[]>((resolve, reject) => {
    try {
      const maybePromise = fabric.util.enlivenObjects(objects, (enlivened: any[]) => resolve(enlivened))
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(resolve).catch(reject)
      }
    } catch (error) {
      reject(error)
    }
  })
}

function keepObjectWithinCanvas(obj: any, canvas: any) {
  obj.setCoords?.()
  const rect = obj.getBoundingRect?.(true, true)
  if (!rect) return
  let dx = 0
  let dy = 0
  const canvasW = canvas.getWidth?.() ?? CANVAS_W
  const canvasH = canvas.getHeight?.() ?? CANVAS_H
  if (rect.left + rect.width > canvasW) dx = canvasW - (rect.left + rect.width)
  if (rect.top + rect.height > canvasH) dy = canvasH - (rect.top + rect.height)
  if (rect.left + dx < 0) dx = -rect.left
  if (rect.top + dy < 0) dy = -rect.top
  if (dx || dy) {
    obj.set({ left: (obj.left ?? 0) + dx, top: (obj.top ?? 0) + dy })
    obj.setCoords?.()
  }
}

// PROTECTED: Recurses through Fabric object/group/clipPath trees to find raster images.
function collectThumbnailImageUrls(node: any, out = new Set<string>()): Set<string> {
  if (!node || typeof node !== 'object') return out
  const list = Array.isArray(node) ? node : [node]
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    if (item.type === 'image' && isHttpUrl(item.src)) out.add(item.src)
    if (Array.isArray(item.objects)) collectThumbnailImageUrls(item.objects, out)
    if (Array.isArray(item._objects)) collectThumbnailImageUrls(item._objects, out)
    if (item.clipPath) collectThumbnailImageUrls(item.clipPath, out)
  }
  return out
}

// PROTECTED: Renders canvas_json into a transparent thumbnail overlay, including images.
// Do not filter out `type === "image"`; that causes bank/uploaded images to disappear.
// No carga el fondo (R2 sin CORS headers → toDataURL fallaría si hay imágenes tainted).
// El fondo se muestra como <img> CSS en la JSX; este PNG es el overlay de elementos.
//
// Transparencia garantizada: usamos `lowerCanvasEl.toDataURL()` directo en lugar de
// `sc.toDataURL({ multiplier })`. El método de Fabric crea un canvas intermediario
// interno que puede inicializarse en blanco en algunos entornos; el canvas HTML que
// nosotros creamos con `document.createElement('canvas')` empieza siempre transparente.
async function renderPageThumbnailSnapshot(snapshot: { image_url: string; canvas_json: any; cover_json: any }) {
  if (typeof document === 'undefined') return null
  const el = document.createElement('canvas')
  el.width = CANVAS_W
  el.height = CANVAS_H
  const sc = new fabric.StaticCanvas(el, { width: CANVAS_W, height: CANVAS_H })
  let disposed = false
  const isCanvasAlive = () => !disposed && !!(sc as any).lowerCanvasEl && !!(sc as any).contextContainer
  try {
    const rawJson = snapshot.canvas_json
    const parsedJson = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson
    if (!parsedJson) return null
    const clonedJson = JSON.parse(JSON.stringify(parsedJson))
    const safeJson = stripBackgroundImage(normalizeFabricAssetJson(clonedJson))
    const urls = [...collectThumbnailImageUrls(safeJson)]

    if (urls.length) {
      const loaded = await Promise.all(
        urls.map((url) => loadFabricImageForSnapshot(url))
      )
      if (loaded.some((image) => !image)) return null
    }

    await new Promise<void>((resolve) => {
      sc.loadFromJSON(safeJson, () => {
        if (isCanvasAlive()) resolve()
        else resolve()
      })
    })
    if (!isCanvasAlive()) return null
    // canvas_json hereda backgroundColor:'#ffffff' del canvas principal (bgColor state).
    // Si no lo limpiamos, renderAll() rellena el canvas con blanco antes de los objetos
    // → overlay opaco que tapa la foto de fondo. Forzar vacío → canvas transparente.
    ;(sc as any).backgroundColor = ''
    sc.renderAll()

    // Acceder al canvas HTML nativo que creamos — siempre transparente por defecto.
    const lower = (sc as any).lowerCanvasEl as HTMLCanvasElement | null
    if (!lower) return null
    return await new Promise<Blob | null>((resolve) => {
      lower.toBlob((blob) => resolve(blob), 'image/png')
    })
  } catch (error) {
    console.error('[thumbnail] persisted snapshot failed', error)
    return null
  } finally {
    disposed = true

    // Fabric puede dejar operaciones internas de imágenes/filtros terminando
    // después del snapshot. Cancelamos renders pendientes y damos un breve margen
    // antes de destruir el canvas para evitar clearRect sobre un contexto nulo.
    try {
      ;(sc as any).cancelRequestedRender?.()
    } catch {}

    const disposeWhenIdle = () => {
      try {
        const target = sc as any
        if (!target.lowerCanvasEl || !target.contextContainer) return
        target.cancelRequestedRender?.()
        target.dispose()
      } catch (error) {
        console.warn('[thumbnail] canvas dispose skipped', error)
      }
    }

    if (typeof window !== 'undefined') {
      window.setTimeout(disposeWhenIdle, 250)
    } else {
      disposeWhenIdle()
    }
  }
}

function captureLiveThumbnailDataUrl(pageId: string, pageIdRef: React.MutableRefObject<string | null>, canvasRef: React.MutableRefObject<any>, width = THUMB_W, canvasWidth = CANVAS_W) {
  if (pageIdRef.current !== pageId) return null
  const canvas = canvasRef.current
  if (!canvas) return null
  try {
    canvas.renderAll()
    return canvas.toDataURL({
      format: 'png',
      quality: 0.92,
      multiplier: width / canvasWidth,
      enableRetinaScaling: false,
    })
  } catch (error) {
    console.error('[thumbnail] live snapshot failed', error)
    return null
  }
}

type ThumbJob = {
  pageId: string
  token: number
  mode: 'live' | 'persisted'
  cacheKey: string
  snapshot?: {
    image_url: string
    canvas_json: any
    cover_json: any
  }
  priority?: boolean
}

type ThumbnailPumpHandle =
  | { kind: 'idle'; handle: number }
  | { kind: 'timeout'; handle: number }

type PageThumbnailCacheEntry = {
  key: string
  url: string
  status?: 'local' | 'error'
}

// ─── Iconos SVG monocromáticos (estilo línea, 20px, stroke uniforme) ──────────
// "stroke" = trazo. Todos comparten grosor 1.6 y currentColor para mantener
// consistencia visual en toda la barra de herramientas.
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const p: React.SVGProps<SVGSVGElement> = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
  }
  switch (name) {
    case 'pages':     return <svg {...p}><rect x="4" y="3" width="13" height="18" rx="2"/><path d="M20 7v12a2 2 0 0 1-2 2H8"/></svg>
    case 'templates': return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
    case 'text':      return <svg {...p}><path d="M5 5h14M12 5v14M9 19h6"/></svg>
    case 'image':     return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m3 17 5-4 4 3 3-3 6 5"/></svg>
    case 'shapes':    return <svg {...p}><circle cx="8" cy="8" r="4.5"/><rect x="12" y="12" width="8" height="8" rx="1.5"/></svg>
    case 'buttons':   return <svg {...p}><rect x="3" y="8" width="18" height="8" rx="4"/><path d="M8 12h8"/></svg>
    case 'elements':  return <svg {...p}><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/></svg>
    case 'svglib':    return <svg {...p}><path d="M3 5h12M3 10h12M3 15h7"/><path d="m16 13 5 5M21 13l-5 5"/></svg>
    case 'link':      return <svg {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
    case 'widgets':   return <svg {...p}><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>
    case 'uploads':   return <svg {...p}><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/></svg>
    case 'trash':     return <svg {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13"/></svg>
    case 'duplicate': return <svg {...p}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/></svg>
    case 'copy':      return <svg {...p}><rect x="8" y="7" width="11" height="13" rx="2"/><path d="M5 16V6a2 2 0 0 1 2-2h8"/></svg>
    case 'cut':       return <svg {...p}><circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.6 8.6 19 19M8.6 15.4 19 5"/></svg>
    case 'paste':     return <svg {...p}><path d="M9 4h6l1 2h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2z"/><path d="M9 4h6v4H9z"/></svg>
    case 'front':     return <svg {...p}><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M3 12h2M19 12h2M12 3v2M12 19v2"/></svg>
    case 'back':      return <svg {...p}><rect x="4" y="4" width="10" height="10" rx="1"/><rect x="10" y="10" width="10" height="10" rx="1"/></svg>
    case 'chevron':   return <svg {...p}><path d="m9 6 6 6-6 6"/></svg>
    case 'plus':      return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>
    case 'rect':      return <svg {...p}><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>
    case 'circle':    return <svg {...p}><circle cx="12" cy="12" r="8"/></svg>
    case 'triangle':  return <svg {...p}><path d="M12 4 21 20H3z"/></svg>
    case 'line':      return <svg {...p}><path d="M4 18 20 6"/></svg>
    case 'star':      return <svg {...p}><path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6L12 17.8 6.6 19.6l1-6L3.3 9.4l6-.9z"/></svg>
    case 'undo':      return <svg {...p}><path d="M3 10h10a6 6 0 0 1 0 12H8"/><path d="M3 6l-3 4 3 4"/></svg>
    case 'redo':      return <svg {...p}><path d="M21 10H11A6 6 0 0 0 11 22h5"/><path d="M21 6l3 4-3 4"/></svg>
    case 'refresh':   return <svg {...p}><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v6h-6"/></svg>
    case 'arrow':     return <svg {...p}><path d="M4 12h14M13 6l6 6-6 6"/></svg>
    case 'badge':     return <svg {...p}><circle cx="12" cy="9" r="6"/><path d="m8 14-1 7 5-3 5 3-1-7"/></svg>
    case 'map':       return <svg {...p}><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/></svg>
    case 'whatsapp':  return <svg {...p}><path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.6-1.2A9 9 0 1 0 12 3z"/><path d="M8.6 8.2c.6 0 .9 1.4 1 1.7.1.4-.4.7-.5 1 .6 1 1.4 1.6 2.4 2 .3-.2.6-.7 1-.6.4.2 1.7.6 1.7 1.2 0 1-1.2 1.4-1.9 1.4-2.6 0-5.3-2.7-5.3-5.3 0-.7.4-1.4 1.6-1.4z"/></svg>
    case 'contact':   return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>
    case 'video':     return <svg {...p}><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></svg>
    case 'audio':     return <svg {...p}><path d="M9 18V7l10-2v11"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>
    case 'qr':        return <svg {...p}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M21 14v7h-7"/></svg>
    case 'table':     return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/></svg>
    case 'like':      return <svg {...p}><path d="M7 10v10H4V10zM7 10l4-7c1.3 0 2 .8 2 2l-.7 5H19a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 18 21H7"/></svg>
    case 'quiz':      return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.3 2.4c-.8.3-1.3 1-1.3 1.8M12 17h.01"/></svg>
    case 'embed':     return <svg {...p}><path d="m9 8-5 4 5 4M15 8l5 4-5 4"/></svg>
    case 'group':     return <svg {...p}><rect x="3" y="3" width="13" height="13" rx="1.5"/><path d="M8 21h11a2 2 0 0 0 2-2V8"/></svg>
    case 'ungroup':   return <svg {...p}><rect x="3" y="3" width="9" height="9" rx="1.5"/><rect x="12" y="12" width="9" height="9" rx="1.5"/></svg>
    case 'forward':   return <svg {...p}><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M3 12h2M12 3v2"/></svg>
    case 'backward':  return <svg {...p}><rect x="4" y="4" width="9" height="9" rx="1.5"/><path d="M20 11v8a1 1 0 0 1-1 1h-8"/></svg>
    case 'lock':      return <svg {...p}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
    case 'unlock':    return <svg {...p}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>
    case 'eye':       return <svg {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    case 'eyeOff':    return <svg {...p}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
    case 'replace':   return <svg {...p}><path d="M4 8a8 8 0 0 1 13-2l3 3M20 16a8 8 0 0 1-13 2l-3-3"/><path d="M20 4v5h-5M4 20v-5h5"/></svg>
    case 'crop':      return <svg {...p}><path d="M6 2v16h16"/><path d="M2 6h16v16"/></svg>
    case 'alignLeft':   return <svg {...p}><path d="M4 4v16"/><rect x="7" y="7" width="11" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/></svg>
    case 'alignCenterH':return <svg {...p}><path d="M12 4v16"/><rect x="6" y="7" width="12" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg>
    case 'alignRight':  return <svg {...p}><path d="M20 4v16"/><rect x="6" y="7" width="11" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/></svg>
    case 'alignTop':    return <svg {...p}><path d="M4 4h16"/><rect x="7" y="7" width="4" height="11" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/></svg>
    case 'alignMiddle': return <svg {...p}><path d="M4 12h16"/><rect x="7" y="6" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg>
    case 'alignBottom': return <svg {...p}><path d="M4 20h16"/><rect x="7" y="6" width="4" height="11" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/></svg>
    default:          return <svg {...p}><circle cx="12" cy="12" r="8"/></svg>
  }
}

// ─── Herramientas de la barra lateral (icon rail) ─────────────────────────────
type ToolKey =
  | 'pages' | 'templates' | 'text' | 'image'
  | 'shapes' | 'buttons' | 'elements' | 'svglib' | 'link' | 'widgets' | 'uploads'

const RAIL: { key: ToolKey; label: string }[] = [
  { key: 'pages',     label: 'Páginas' },
  { key: 'templates', label: 'Plantilla' },
  { key: 'text',      label: 'Texto' },
  { key: 'image',     label: 'Imagen' },
  { key: 'shapes',    label: 'Formas' },
  { key: 'buttons',   label: 'Botones' },
  { key: 'elements',  label: 'Elementos' },
  { key: 'svglib',    label: 'Biblioteca' },
  { key: 'link',      label: 'Enlace' },
  { key: 'widgets',   label: 'Widgets' },
  { key: 'uploads',   label: 'Cargas' },
]

// Paletas de color prediseñadas (panel derecho de configuración)
const COLOR_SCHEMES: { name: string; colors: string[] }[] = [
  { name: 'Azul cielo',     colors: ['#0EA5E9', '#38BDF8', '#7DD3FC', '#BAE6FD'] },
  { name: 'Verde helecho',  colors: ['#059669', '#10B981', '#34D399', '#A7F3D0'] },
  { name: 'Marrón cálido',  colors: ['#92400E', '#B45309', '#D97706', '#FCD34D'] },
  { name: 'Medianoche',     colors: ['#1E1B4B', '#312E81', '#4F46E5', '#818CF8'] },
]

// Estilos de texto prediseñados
const TEXT_PRESETS = [
  { label: 'Agregar Título',    sample: 'Título',          opts: { fontSize: 44, fontWeight: 'bold' as const } },
  { label: 'Agregar Subtítulo', sample: 'Subtítulo',       opts: { fontSize: 28, fontWeight: 600 as any } },
  { label: 'Texto Principal',   sample: 'Cuerpo de texto', opts: { fontSize: 18, fontWeight: 'normal' as const } },
  { label: 'Texto pequeño',     sample: 'Pie de página',   opts: { fontSize: 13, fontWeight: 'normal' as const } },
]

// Librería de tipografías. "fontFamily" debe coincidir con las fuentes cargadas
// en index.html (Google Fonts) para que se vean igual en editor y visor.
const FONTS: { name: string; family: string }[] = [
  { name: 'Inter',           family: 'Inter, sans-serif' },
  { name: 'Poppins',         family: 'Poppins, sans-serif' },
  { name: 'Montserrat',      family: 'Montserrat, sans-serif' },
  { name: 'Oswald',          family: 'Oswald, sans-serif' },
  { name: 'Bebas Neue',      family: '"Bebas Neue", sans-serif' },
  { name: 'Roboto Slab',     family: '"Roboto Slab", serif' },
  { name: 'Merriweather',    family: 'Merriweather, serif' },
  { name: 'Playfair',        family: '"Playfair Display", serif' },
  { name: 'Lobster',         family: 'Lobster, cursive' },
  { name: 'Pacifico',        family: 'Pacifico, cursive' },
  { name: 'Dancing Script',  family: '"Dancing Script", cursive' },
  { name: 'Caveat',          family: 'Caveat, cursive' },
  { name: 'Georgia',         family: 'Georgia, serif' },
  { name: 'Courier',         family: '"Courier New", monospace' },
]

// Galería de iconos / figuras / señales (SVG vectorial). Cada `svg` es el
// contenido interno; `addIcon` lo envuelve y lo convierte en objeto Fabric.
type IconItem = { label: string; svg: string }
const ICON_STROKE = 'stroke="#334155" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'
const ICON_FILL = 'fill="#334155" stroke="none"'
const ICON_LIBRARY: { category: string; items: IconItem[] }[] = [
  {
    category: 'Flechas',
    items: [
      { label: 'Derecha',  svg: `<path d="M4 12h14M13 6l6 6-6 6" ${ICON_STROKE}/>` },
      { label: 'Arriba',   svg: `<path d="M12 20V5M6 11l6-6 6 6" ${ICON_STROKE}/>` },
      { label: 'Curva',    svg: `<path d="M5 16c5 3 11 0 13-6M18 5l1 5-5 1" ${ICON_STROKE}/>` },
      { label: 'Dobles',   svg: `<path d="M3 9l4-4 4 4M3 15l4 4 4-4M14 8h7M14 16h7" ${ICON_STROKE}/>` },
    ],
  },
  {
    category: 'Negocio',
    items: [
      { label: 'Teléfono', svg: `<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" ${ICON_STROKE}/>` },
      { label: 'Email',    svg: `<path d="M3 6h18v12H3zM3 7l9 6 9-6" ${ICON_STROKE}/>` },
      { label: 'Ubicación',svg: `<path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12zM12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" ${ICON_STROKE}/>` },
      { label: 'Carrito',  svg: `<path d="M3 4h2l2.5 12h11l2-8H6M9 20a1 1 0 1 0 .01 0M18 20a1 1 0 1 0 .01 0" ${ICON_STROKE}/>` },
      { label: 'Precio',   svg: `<path d="M3 12l8-8h8v8l-8 8zM16 8h.01" ${ICON_STROKE}/>` },
      { label: 'Reloj',    svg: `<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" ${ICON_STROKE}/>` },
    ],
  },
  {
    category: 'Señales',
    items: [
      { label: 'Check',    svg: `<path d="M5 13l4 4 10-11" ${ICON_STROKE}/>` },
      { label: 'Aviso',    svg: `<path d="M12 3 2 20h20zM12 9v5M12 18h.01" ${ICON_STROKE}/>` },
      { label: 'Info',     svg: `<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7h.01" ${ICON_STROKE}/>` },
      { label: 'OK',       svg: `<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6" ${ICON_STROKE}/>` },
    ],
  },
  {
    category: 'Decorativos',
    items: [
      { label: 'Estrella', svg: `<path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6L12 17.8 6.6 19.6l1-6L3.3 9.4l6-.9z" fill="#F59E0B" stroke="none"/>` },
      { label: 'Corazón',  svg: `<path d="M12 21s-7-4.7-9.3-9.2C1 8 3 4.5 6.5 4.5c2 0 3.5 1.3 5.5 3.5 2-2.2 3.5-3.5 5.5-3.5C21 4.5 23 8 21.3 11.8 19 16.3 12 21 12 21z" fill="#EF4444" stroke="none"/>` },
      { label: 'Corona',   svg: `<path d="M3 8l4 4 5-7 5 7 4-4-2 12H5z" ${ICON_FILL}/>` },
      { label: 'Destello', svg: `<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" ${ICON_STROKE}/>` },
    ],
  },
  {
    category: 'Redes',
    items: [
      { label: 'WhatsApp', svg: `<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.6-1.2A9 9 0 1 0 12 3zM8.6 8.2c.6 0 .9 1.4 1 1.7.1.4-.4.7-.5 1 .6 1 1.4 1.6 2.4 2 .3-.2.6-.7 1-.6.4.2 1.7.6 1.7 1.2 0 1-1.2 1.4-1.9 1.4-2.6 0-5.3-2.7-5.3-5.3 0-.7.4-1.4 1.6-1.4z" fill="#25D366" stroke="none"/>` },
      { label: 'Globo',    svg: `<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" ${ICON_STROKE}/>` },
      { label: 'Instagram',svg: `<path d="M4 8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16.5 7.5h.01" ${ICON_STROKE}/>` },
      { label: 'Facebook', svg: `<path d="M13 22V12h3l.5-4H13V6c0-1 .3-1.5 1.5-1.5H17V1.1C16.5 1 15.3 1 14 1c-2.7 0-4 1.6-4 4.3V8H7v4h3v10z" ${ICON_FILL}/>` },
    ],
  },
]

// Botones prediseñados con estilo coherente (relleno / contorno / texto)
const BUTTON_PRESETS: { label: string; variant: 'solid' | 'outline' | 'pill' }[] = [
  { label: 'Comprar Ahora',  variant: 'solid' },
  { label: 'Contáctanos',    variant: 'solid' },
  { label: 'Aprender Más',   variant: 'outline' },
  { label: 'Regístrate',     variant: 'pill' },
  { label: 'Iniciar Sesión', variant: 'outline' },
  { label: 'Reproducir',     variant: 'solid' },
]

// Tipos de acción de un botón (qué ocurre al hacer clic en el viewer)
type ActionType = 'link' | 'page' | 'call' | 'whatsapp' | 'email' | 'popup_text' | 'popup_image' | 'popup_video' | 'popup_audio' | 'download' | 'show_hide' | 'gallery_images' | 'gallery_videos' | 'popup_message' | 'show_comment' | 'copy_text'
const ACTION_TYPES: { type: ActionType; label: string; icon: string }[] = [
  { type: 'link',           label: 'Abrir Enlace',        icon: 'link' },
  { type: 'page',           label: 'Ir a Página',         icon: 'pages' },
  { type: 'call',           label: 'Llamar',              icon: 'badge' },
  { type: 'whatsapp',       label: 'WhatsApp',            icon: 'whatsapp' },
  { type: 'email',          label: 'Email',               icon: 'contact' },
  { type: 'popup_text',     label: 'Texto emergente',     icon: 'text' },
  { type: 'popup_image',    label: 'Imagen emergente',    icon: 'image' },
  { type: 'popup_video',    label: 'Video emergente',     icon: 'video' },
  { type: 'popup_audio',    label: 'Audio emergente',     icon: 'audio' },
  { type: 'popup_message',  label: 'Mensaje emergente',   icon: 'badge' },
  { type: 'show_comment',   label: 'Mostrar comentario',  icon: 'contact' },
  { type: 'copy_text',      label: 'Copiar texto',        icon: 'duplicate' },
  { type: 'download',       label: 'Descargar archivo',   icon: 'uploads' },
  { type: 'gallery_images', label: 'Galería de imágenes', icon: 'image' },
  { type: 'gallery_videos', label: 'Galería de videos',   icon: 'video' },
  { type: 'show_hide',      label: 'Mostrar/Ocultar',     icon: 'elements' },
]

// Catálogo de widgets. `type` identifica el comportamiento que el visor renderiza.
type WidgetType = 'map' | 'whatsapp' | 'social' | 'contact' | 'video' | 'audio' | 'qr' | 'barcode' | 'gallery' | 'table' | 'like' | 'embed' | 'quiz' | 'popup_banner' | 'download' | 'units_table' | 'product_card'

// Redes sociales: slug de Simple Icons (logo) + color de marca + plantilla de URL.
// El logo se carga como imagen desde el CDN de Simple Icons (cdn.simpleicons.org).
const SOCIAL_NETWORKS: Record<string, { label: string; slug: string; color: string; tpl: string; ph: string }> = {
  instagram: { label: 'Instagram', slug: 'instagram', color: 'E4405F', tpl: 'https://instagram.com/{v}', ph: 'usuario' },
  facebook:  { label: 'Facebook',  slug: 'facebook',  color: '0866FF', tpl: 'https://facebook.com/{v}',  ph: 'usuario o página' },
  tiktok:    { label: 'TikTok',    slug: 'tiktok',    color: '000000', tpl: 'https://tiktok.com/@{v}',   ph: 'usuario (sin @)' },
  youtube:   { label: 'YouTube',   slug: 'youtube',   color: 'FF0000', tpl: 'https://youtube.com/@{v}',  ph: 'canal o URL' },
  x:         { label: 'X / Twitter', slug: 'x',       color: '000000', tpl: 'https://x.com/{v}',         ph: 'usuario (sin @)' },
  telegram:  { label: 'Telegram',  slug: 'telegram',  color: '26A5E4', tpl: 'https://t.me/{v}',          ph: 'usuario o canal' },
  linkedin:  { label: 'LinkedIn',  slug: 'linkedin',  color: '0A66C2', tpl: 'https://linkedin.com/in/{v}', ph: 'perfil o URL' },
  pinterest: { label: 'Pinterest', slug: 'pinterest', color: 'BD081C', tpl: 'https://pinterest.com/{v}', ph: 'usuario' },
}
const WIDGETS: { type: WidgetType; label: string; icon: string; premium: boolean }[] = [
  { type: 'product_card', label: 'Ficha de producto',      icon: 'image',    premium: false },
  { type: 'map',          label: 'Mapa',                  icon: 'map',      premium: false },
  { type: 'whatsapp',     label: 'WhatsApp',              icon: 'whatsapp', premium: false },
  { type: 'social',       label: 'Redes sociales',        icon: 'link',     premium: false },
  { type: 'contact',      label: 'Formulario',            icon: 'contact',  premium: false },
  { type: 'gallery',      label: 'Galería / Slider',      icon: 'image',    premium: false },
  { type: 'video',        label: 'Video',                 icon: 'video',    premium: false },
  { type: 'audio',        label: 'Audio',                 icon: 'audio',    premium: false },
  { type: 'qr',           label: 'Código QR',             icon: 'qr',       premium: false },
  { type: 'barcode',      label: 'Código de barras',      icon: 'table',    premium: false },
  { type: 'table',        label: 'Tabla',                 icon: 'table',    premium: false },
  { type: 'like',         label: 'Me gusta',              icon: 'like',     premium: false },
  { type: 'download',     label: 'Descargar archivo',     icon: 'uploads',  premium: false },
  { type: 'popup_banner', label: 'Pop-up emergente',      icon: 'badge',    premium: false },
  { type: 'embed',        label: 'Incrustar / HTML',      icon: 'embed',    premium: false },
  { type: 'quiz',         label: 'Cuestionario',          icon: 'quiz',     premium: false },
  { type: 'units_table',  label: 'Tabla de Unidades',     icon: 'table',    premium: false },
]

// Configuración inicial de cada widget (la edita el usuario en el panel derecho).
const WIDGET_DEFAULTS: Record<WidgetType, any> = {
  map:      { address: '', mapsUrl: '', zoom: 14 },
  whatsapp: { phone: '', message: 'Hola, vi tu catálogo y quiero más información', label: 'Escríbenos por WhatsApp' },
  social:   { network: 'instagram', value: '' },
  gallery:  { images: [], autoplay: true, interval: 4, arrows: true, dots: true, transition: 'fade' },
  contact:  { title: 'Contáctanos', toEmail: '', button: 'Enviar', showPhone: true, showComment: true, nameRequired: true, emailRequired: true, phoneRequired: false },
  video:    { url: '', autoplay: false, controls: true, muted: false, poster: '', loop: false, playerStyle: 'native', playerColor: '#ef4444' },
  audio:    { url: '', playerColor: '#7c3aed', autoplay: false, loop: false, playerStyle: 'circle', label: '' },
  qr:       { data: '', caption: 'Escanéame' },
  barcode:  { value: '123456789012', format: 'code128', showText: true },
  table:    { csv: 'Producto, Precio\nCafé, $2.50\nTé, $2.00' },
  like:     { label: 'Me gusta' },
  download: { url: '', filename: '', title: 'Descarga aquí', button: 'Descargar', buttonColor: '#4F46E5' },
  embed:    { html: '' },
  quiz:     { title: 'Cuestionario', questions: [{ text: '¿Tu pregunta?', options: ['Opción A', 'Opción B'], type: 'single' }] },
  units_table: { publication_id: '', show_price: true, show_area: true, filter_status: 'all' },
  product_card: {
    images: [],
    galleryAutoplay: false,
    galleryInterval: 4,
    title: 'WALLPANEL 3D MDF EMBOZADO',
    category: 'EMBOZADOS',
    showCategory: true,
    price: 'RD$ 4,692.31',
    showPrice: true,
    description: 'Este producto es una solución ideal para tus proyectos. Contacta con nosotros para consultar disponibilidad y detalles técnicos adicionales.',
    refLabel: 'Ref.:',
    refValue: 'DEC7402',
    availLabel: 'Disponibilidad:',
    availValue: 'Inmediata',
    showSpecs: true,
    accent: '#4d7c0f',
    primaryText: 'SOLICITAR COTIZACIÓN',
    primaryColor: '#9aab3c',
    primaryAction: 'none',
    primaryValue: '',
    primaryMessage: '',
    secondaryText: 'VOLVER A RESULTADOS',
    showSecondary: true,
    secondaryAction: 'none',
    secondaryValue: '',
  },
  popup_banner: {
    template: 'offer',
    position: 'left',
    trigger: 'delay',
    delay: 5,
    animation: 'slide',
    autoClose: 0,
    title: '¡Oferta relámpago!',
    text: 'Aprovechá este descuento exclusivo por tiempo limitado.',
    buttonText: 'Ver oferta',
    buttonUrl: '',
    bgColor: '#1e1b4b',
    textColor: '#ffffff',
    image: '',
    imagePosition: 'left',
    imageZoom: 1,
    imagePosX: 50,
    imagePosY: 50,
    showOnce: true,
  },
}

// Fase 1 — representación visual de cada widget en el lienzo (tarjeta con icono +
// color de acento), en vez del rectángulo punteado genérico. `shape`:
//   'card'   → tarjeta blanca con borde/tinte de acento (mapa, video, formulario…)
//   'button' → botón relleno con el color de acento (WhatsApp, descargar, like…)
//   'square' → cuadro (QR, código de barras)
const WIDGET_VISUAL: Record<WidgetType, { glyph: string; color: string; w: number; h: number; shape: 'card' | 'button' | 'square' }> = {
  map:          { glyph: '📍', color: '#0ea5e9', w: 260, h: 170, shape: 'card' },
  whatsapp:     { glyph: '💬', color: '#25D366', w: 220, h: 60,  shape: 'button' },
  social:       { glyph: '🌐', color: '#4f46e5', w: 96,  h: 96,  shape: 'square' },
  gallery:      { glyph: '🖼️', color: '#0ea5e9', w: 280, h: 190, shape: 'card' },
  contact:      { glyph: '📝', color: '#4f46e5', w: 240, h: 180, shape: 'card' },
  video:        { glyph: '▶',  color: '#ef4444', w: 260, h: 150, shape: 'card' },
  audio:        { glyph: '🔊', color: '#7c3aed', w: 230, h: 76,  shape: 'card' },
  qr:           { glyph: 'QR', color: '#111827', w: 140, h: 140, shape: 'square' },
  barcode:      { glyph: '|||', color: '#111827', w: 220, h: 90, shape: 'square' },
  table:        { glyph: '▦',  color: '#0891b2', w: 260, h: 150, shape: 'card' },
  like:         { glyph: '❤',  color: '#e11d48', w: 130, h: 60,  shape: 'button' },
  download:     { glyph: '⬇',  color: '#16a34a', w: 210, h: 60,  shape: 'button' },
  embed:        { glyph: '</>', color: '#334155', w: 240, h: 150, shape: 'card' },
  quiz:         { glyph: '❓', color: '#f59e0b', w: 240, h: 170, shape: 'card' },
  units_table:  { glyph: '🏢', color: '#0891b2', w: 280, h: 170, shape: 'card' },
  popup_banner: { glyph: '🔔', color: '#4f46e5', w: 240, h: 120, shape: 'card' },
  product_card: { glyph: '🛍️', color: '#4d7c0f', w: 300, h: 420, shape: 'card' },
}

// Construye la previsualización visual (fabric.Group) que representa un widget en el
// lienzo, tal como se verá publicado — no un cuadro placeholder. El tamaño del grupo
// define el tamaño del widget en el viewer (que reemplaza esta vista por el componente
// interactivo real).

// Helpers de dibujo (coordenadas absolutas dentro del recuadro, origen arriba-izquierda)
function wRect(x: number, y: number, w: number, h: number, o: any = {}): any {
  return new fabric.Rect({ left: x, top: y, width: w, height: h, originX: 'left', originY: 'top', ...o })
}
function wText(str: string, x: number, y: number, o: any = {}): any {
  return new fabric.Text(str, { left: x, top: y, originX: 'left', originY: 'top', fontFamily: 'Inter, sans-serif', ...o })
}
function wGroup(els: any[]): any { return new fabric.Group(els, { originX: 'left', originY: 'top' }) }

// Logo de WhatsApp como vector (path de Simple Icons) — síncrono, sin red.
const WHATSAPP_PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z'

function buildFormPreview(): any {
  const W = 260, H = 232, P = 14
  const els: any[] = [
    wRect(0, 0, W, H, { rx: 14, ry: 14, fill: '#ffffff', stroke: '#e5e7eb', strokeWidth: 1 }),
    wText('Contáctanos', P, 16, { fontSize: 15, fontWeight: 'bold', fill: '#111827' }),
  ]
  ;[['Nombre *', 42], ['Email *', 76], ['Teléfono', 110]].forEach(([ph, y]: any) => {
    els.push(wRect(P, y, W - 2 * P, 26, { rx: 7, ry: 7, fill: '#ffffff', stroke: '#d1d5db', strokeWidth: 1 }))
    els.push(wText(ph, P + 10, y + 8, { fontSize: 11, fill: '#9ca3af' }))
  })
  els.push(wRect(P, 144, W - 2 * P, 42, { rx: 7, ry: 7, fill: '#ffffff', stroke: '#d1d5db', strokeWidth: 1 }))
  els.push(wText('Comentario', P + 10, 150, { fontSize: 11, fill: '#9ca3af' }))
  els.push(wRect(P, 194, W - 2 * P, 26, { rx: 8, ry: 8, fill: '#6d5cf5' }))
  els.push(wText('Enviar', W / 2, 207, { fontSize: 12, fontWeight: 'bold', fill: '#ffffff', originX: 'center' }))
  return wGroup(els)
}

function buildWhatsappPreview(): any {
  const W = 210, H = 52
  const logo = new fabric.Path(WHATSAPP_PATH, { left: 20, top: 13, originX: 'left', originY: 'top', fill: '#ffffff', scaleX: 1.08, scaleY: 1.08 })
  return wGroup([
    wRect(0, 0, W, H, { rx: 26, ry: 26, fill: '#25D366' }),
    logo,
    wText('WhatsApp', 58, H / 2, { fontSize: 16, fontWeight: 'bold', fill: '#ffffff', originY: 'center' }),
  ])
}

function buildMapPreview(): any {
  const W = 260, H = 180
  return wGroup([
    wRect(0, 0, W, H, { rx: 12, ry: 12, fill: '#e8edf0' }),
    wRect(150, 28, 96, 74, { rx: 8, ry: 8, fill: '#d4ead4' }),
    wRect(0, 72, W, 12, { fill: '#ffffff' }),
    wRect(82, 0, 12, H, { fill: '#ffffff' }),
    wRect(0, 118, W, 8, { fill: '#f3d9a0' }),
    wText('📍', W / 2 - 12, H / 2 - 34, { fontSize: 34 }),
    wRect(10, 10, 66, 24, { rx: 6, ry: 6, fill: '#ffffff', stroke: '#e5e7eb', strokeWidth: 1 }),
    wText('Maps ↗', 18, 16, { fontSize: 12, fontWeight: 'bold', fill: '#1a73e8' }),
    wRect(0, H - 30, W, 30, { fill: '#ffffff' }),
    wText('Tu ubicación', 12, H - 22, { fontSize: 12, fontWeight: 'bold', fill: '#374151' }),
  ])
}

function buildVideoPreview(): any {
  const W = 260, H = 150
  return wGroup([
    wRect(0, 0, W, H, { rx: 12, ry: 12, fill: '#0b0b0f' }),
    new fabric.Circle({ left: W / 2, top: H / 2, radius: 26, fill: 'rgba(255,255,255,0.16)', originX: 'center', originY: 'center' }),
    new fabric.Triangle({ left: W / 2 + 2, top: H / 2, width: 22, height: 24, fill: '#ffffff', angle: 90, originX: 'center', originY: 'center' }),
    wText('Video', 12, H - 22, { fontSize: 12, fontWeight: 'bold', fill: '#e5e7eb' }),
  ])
}

function buildAudioPreview(): any {
  const W = 240, H = 64
  return wGroup([
    wRect(0, 0, W, H, { rx: 14, ry: 14, fill: '#f3f0ff', stroke: '#e5e0fb', strokeWidth: 1 }),
    new fabric.Circle({ left: 32, top: H / 2, radius: 18, fill: '#7c3aed', originX: 'center', originY: 'center' }),
    new fabric.Triangle({ left: 34, top: H / 2, width: 14, height: 16, fill: '#ffffff', angle: 90, originX: 'center', originY: 'center' }),
    wRect(60, H / 2 - 3, 162, 6, { rx: 3, ry: 3, fill: '#ddd6fe' }),
    wRect(60, H / 2 - 3, 64, 6, { rx: 3, ry: 3, fill: '#7c3aed' }),
    new fabric.Circle({ left: 124, top: H / 2, radius: 6, fill: '#7c3aed', originX: 'center', originY: 'center' }),
  ])
}

function buildTablePreview(headerColor: string, title: string): any {
  const W = 260, H = 150, rows = 4, rh = H / rows
  const els: any[] = [
    wRect(0, 0, W, H, { rx: 10, ry: 10, fill: '#ffffff', stroke: '#e5e7eb', strokeWidth: 1 }),
    wRect(0, 0, W, rh, { rx: 10, ry: 10, fill: headerColor }),
    wText(title, 12, rh / 2 - 7, { fontSize: 12, fontWeight: 'bold', fill: '#ffffff' }),
    wText('Detalle', 160, rh / 2 - 7, { fontSize: 12, fontWeight: 'bold', fill: '#ffffff' }),
  ]
  for (let i = 1; i < rows; i++) {
    els.push(wRect(0, i * rh, W, 1, { fill: '#eef2f5' }))
    els.push(wText('————', 12, i * rh + rh / 2 - 8, { fontSize: 12, fill: '#9ca3af' }))
    els.push(wText('——', 160, i * rh + rh / 2 - 8, { fontSize: 12, fill: '#9ca3af' }))
  }
  return wGroup(els)
}

function buildLikePreview(): any {
  const W = 140, H = 48
  return wGroup([
    wRect(0, 0, W, H, { rx: 24, ry: 24, fill: '#ffffff', stroke: '#e5e7eb', strokeWidth: 1 }),
    wText('♥', 18, H / 2, { fontSize: 18, fill: '#ef4444', originY: 'center' }),
    wText('Me gusta (0)', 42, H / 2, { fontSize: 13, fontWeight: 'bold', fill: '#374151', originY: 'center' }),
  ])
}

function buildButtonPreview(glyph: string, label: string, color: string): any {
  const W = 210, H = 52
  return wGroup([
    wRect(0, 0, W, H, { rx: 12, ry: 12, fill: color }),
    wText(`${glyph}  ${label}`, W / 2, H / 2, { fontSize: 14, fontWeight: 'bold', fill: '#ffffff', originX: 'center', originY: 'center' }),
  ])
}

function buildEmbedPreview(): any {
  const W = 240, H = 150
  return wGroup([
    wRect(0, 0, W, H, { rx: 12, ry: 12, fill: '#0f172a' }),
    wText('</>', W / 2, H / 2 - 12, { fontSize: 34, fontWeight: 'bold', fill: '#38bdf8', originX: 'center', originY: 'center' }),
    wText('HTML incrustado', W / 2, H / 2 + 22, { fontSize: 12, fill: '#94a3b8', originX: 'center', originY: 'center' }),
  ])
}

function buildQuizPreview(): any {
  const W = 250, H = 170
  return wGroup([
    wRect(0, 0, W, H, { rx: 12, ry: 12, fill: '#ffffff', stroke: '#fde68a', strokeWidth: 2 }),
    wText('❓ ¿Tu pregunta?', 16, 16, { fontSize: 14, fontWeight: 'bold', fill: '#92400e' }),
    wRect(16, 52, W - 32, 34, { rx: 8, ry: 8, fill: '#fffbeb', stroke: '#fcd34d', strokeWidth: 1 }),
    wText('Opción A', 28, 62, { fontSize: 12, fill: '#78350f' }),
    wRect(16, 94, W - 32, 34, { rx: 8, ry: 8, fill: '#fffbeb', stroke: '#fcd34d', strokeWidth: 1 }),
    wText('Opción B', 28, 104, { fontSize: 12, fill: '#78350f' }),
    wRect(16, 136, 92, 24, { rx: 8, ry: 8, fill: '#f59e0b' }),
    wText('Enviar', 62, 142, { fontSize: 12, fontWeight: 'bold', fill: '#ffffff', originX: 'center' }),
  ])
}

function buildPopupPreview(): any {
  const W = 240, H = 130
  return wGroup([
    wRect(0, 0, W, H, { rx: 14, ry: 14, fill: '#4f46e5' }),
    wText('🔔  ¡Oferta!', 16, 16, { fontSize: 14, fontWeight: 'bold', fill: '#ffffff' }),
    wText('Mensaje del pop-up emergente', 16, 46, { fontSize: 12, fill: '#e0e7ff' }),
    wRect(16, 88, 112, 28, { rx: 8, ry: 8, fill: '#ffffff' }),
    wText('Ver más', 72, 95, { fontSize: 12, fontWeight: 'bold', fill: '#4f46e5', originX: 'center' }),
  ])
}

function buildGalleryPreview(): any {
  const W = 280, H = 190
  return wGroup([
    wRect(0, 0, W, H, { rx: 12, ry: 12, fill: '#0f172a' }),
    // marco de "foto" central
    wRect(20, 18, W - 40, H - 56, { rx: 8, ry: 8, fill: '#1e293b', stroke: '#334155', strokeWidth: 1 }),
    new fabric.Triangle({ left: W / 2 - 28, top: H / 2 - 22, width: 26, height: 22, fill: '#64748b', angle: 0, originX: 'center', originY: 'center' }),
    new fabric.Circle({ left: W / 2 + 26, top: H / 2 - 30, radius: 9, fill: '#facc15', originX: 'center', originY: 'center' }),
    // flechas
    wText('‹', 30, H / 2 - 30, { fontSize: 30, fontWeight: 'bold', fill: '#e2e8f0' }),
    wText('›', W - 44, H / 2 - 30, { fontSize: 30, fontWeight: 'bold', fill: '#e2e8f0' }),
    // puntos indicadores
    new fabric.Circle({ left: W / 2 - 16, top: H - 22, radius: 4, fill: '#ffffff', originX: 'center', originY: 'center' }),
    new fabric.Circle({ left: W / 2, top: H - 22, radius: 4, fill: '#64748b', originX: 'center', originY: 'center' }),
    new fabric.Circle({ left: W / 2 + 16, top: H - 22, radius: 4, fill: '#64748b', originX: 'center', originY: 'center' }),
    wText('Galería / Slider', W / 2, 20, { fontSize: 12, fontWeight: 'bold', fill: '#cbd5e1', originX: 'center' }),
  ])
}

function buildProductCardPreview(): any {
  const W = 280, H = 400, P = 18, accent = '#4d7c0f'
  const els: any[] = [
    wRect(0, 0, W, H, { rx: 16, ry: 16, fill: '#ffffff', stroke: '#e5e7eb', strokeWidth: 1 }),
    // zona de imagen
    wRect(0, 0, W, 150, { rx: 16, ry: 16, fill: '#eef2f5' }),
    wRect(0, 130, W, 20, { fill: '#eef2f5' }),
    wText('🛍️', W / 2 - 16, 56, { fontSize: 40, originX: 'left' }),
    // título
    wText('Ficha de producto', P, 168, { fontSize: 16, fontWeight: 'bold', fill: '#1f2937' }),
    // categoría (pill)
    wRect(P, 196, 96, 22, { rx: 11, ry: 11, fill: '#e8f0dc' }),
    wText('CATEGORÍA', P + 12, 201, { fontSize: 9, fontWeight: 'bold', fill: accent }),
    // precio
    wText('RD$ 4,692.31', P, 230, { fontSize: 20, fontWeight: 'bold', fill: accent }),
    // descripción (líneas)
    wRect(P, 264, W - 2 * P, 8, { rx: 4, ry: 4, fill: '#eef2f5' }),
    wRect(P, 278, W - 2 * P - 40, 8, { rx: 4, ry: 4, fill: '#eef2f5' }),
    // specs
    wRect(P, 300, (W - 2 * P - 8) / 2, 36, { rx: 8, ry: 8, fill: '#f3f4f6' }),
    wRect(P + (W - 2 * P - 8) / 2 + 8, 300, (W - 2 * P - 8) / 2, 36, { rx: 8, ry: 8, fill: '#f3f4f6' }),
    wText('✓ Ref.', P + 10, 312, { fontSize: 11, fontWeight: 'bold', fill: '#374151' }),
    wText('✓ Disp.', P + (W - 2 * P - 8) / 2 + 18, 312, { fontSize: 11, fontWeight: 'bold', fill: '#374151' }),
    // botones CTA
    wRect(P, 350, (W - 2 * P - 10) / 2, 38, { rx: 10, ry: 10, fill: '#9aab3c' }),
    wText('COTIZAR', P + 22, 361, { fontSize: 11, fontWeight: 'bold', fill: '#ffffff' }),
    wRect(P + (W - 2 * P - 10) / 2 + 10, 350, (W - 2 * P - 10) / 2, 38, { rx: 10, ry: 10, fill: '#eef0f3' }),
    wText('VOLVER', P + (W - 2 * P - 10) / 2 + 32, 361, { fontSize: 11, fontWeight: 'bold', fill: '#4b5563' }),
  ]
  return wGroup(els)
}

function makeWidgetCard(type: WidgetType, label: string): any {
  switch (type) {
    case 'product_card': return buildProductCardPreview()
    case 'gallery':      return buildGalleryPreview()
    case 'contact':      return buildFormPreview()
    case 'whatsapp':     return buildWhatsappPreview()
    case 'map':          return buildMapPreview()
    case 'video':        return buildVideoPreview()
    case 'audio':        return buildAudioPreview()
    case 'table':        return buildTablePreview('#0891b2', 'Tabla')
    case 'units_table':  return buildTablePreview('#0891b2', '🏢 Unidades')
    case 'like':         return buildLikePreview()
    case 'download':     return buildButtonPreview('⬇', 'Descargar archivo', '#16a34a')
    case 'embed':        return buildEmbedPreview()
    case 'quiz':         return buildQuizPreview()
    case 'popup_banner': return buildPopupPreview()
    default: {
      const v = WIDGET_VISUAL[type] ?? { glyph: '▦', color: '#4f46e5', w: 230, h: 150, shape: 'card' as const }
      return wGroup([
        wRect(0, 0, v.w, v.h, { rx: 12, ry: 12, fill: '#ffffff', stroke: v.color, strokeWidth: 2 }),
        wText(`${v.glyph}  ${label}`, v.w / 2, v.h / 2, { fontSize: 15, fontWeight: 'bold', fill: v.color, originX: 'center', originY: 'center' }),
      ])
    }
  }
}

// URL de la imagen real de un widget basado en imagen (QR, código de barras o logo
// social). Misma fuente que usa el viewer, para que el lienzo y el publicado coincidan.
function codeImageUrl(type: WidgetType, cfg: any): string {
  if (type === 'social') {
    const net = SOCIAL_NETWORKS[cfg.network] ?? SOCIAL_NETWORKS.instagram
    // Iconify devuelve el SVG con width/height explícitos (240) → la imagen tiene
    // dimensiones fiables y escala bien (cdn.simpleicons.org daba width=0 → gigante).
    return `https://api.iconify.design/simple-icons:${net.slug}.svg?color=%23${net.color}&width=240&height=240`
  }
  if (type === 'barcode') {
    const fmt = cfg.format || 'code128'
    const val = String(cfg.value || '123456789012')
    return `https://barcodeapi.org/api/${encodeURIComponent(fmt)}/${encodeURIComponent(val)}`
  }
  const data = cfg.data && String(cfg.data).trim() ? String(cfg.data).trim() : 'https://intaprd.com'
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(data)}`
}

// Recarga la imagen del código (QR/barras) en el lienzo según su config actual,
// conservando posición y tamaño. La llaman los paneles de QR y Código de barras.
function refreshCodeOnCanvas(obj: any) {
  if (!obj || !obj.setSrc) return
  const w = obj.data?.widget; if (!w) return
  obj.setSrc(codeImageUrl(w.type, w.config ?? {}), () => { obj.setCoords && obj.setCoords(); obj.canvas && obj.canvas.requestRenderAll() })
}

// Plantillas prediseñadas para el pop-up emergente
const POPUP_TEMPLATES: { key: string; label: string; defaults: Partial<typeof WIDGET_DEFAULTS['popup_banner']> }[] = [
  { key: 'offer',   label: '⚡ Oferta relámpago', defaults: { title: '¡Oferta relámpago!', text: 'Solo por hoy — 30% OFF en toda la tienda.', buttonText: 'Ver ofertas', bgColor: '#7c3aed', textColor: '#fff' } },
  { key: 'contact', label: '📞 Datos de contacto', defaults: { title: '¿Necesitás ayuda?', text: 'Nuestro equipo está disponible. ¡Escribinos!', buttonText: 'Contactar', bgColor: '#0369a1', textColor: '#fff' } },
  { key: 'bonus',   label: '🎁 Bono / Descuento',  defaults: { title: '¡Bono exclusivo!', text: 'Registrate y obtené un bono de bienvenida.', buttonText: 'Reclamar', bgColor: '#15803d', textColor: '#fff' } },
  { key: 'news',    label: '📰 Novedad',            defaults: { title: 'Nueva colección disponible', text: 'Mirá las últimas novedades de temporada.', buttonText: 'Ver ahora', bgColor: '#b45309', textColor: '#fff' } },
  { key: 'custom',  label: '✏️ Personalizado',      defaults: { bgColor: '#111827', textColor: '#fff' } },
]

// Reúne todas las URLs de imágenes ya usadas en el proyecto: fondos de página
// y elementos de imagen dentro del canvas de cada página.
function collectBankFromPages(ps: any[]): string[] {
  const urls = new Set<string>()
  for (const pg of ps) {
    if (pg?.image_url) urls.add(pg.image_url)
    const cj = pg?.canvas_json
    if (cj) {
      try {
        const parsed = typeof cj === 'string' ? JSON.parse(cj) : cj
        for (const o of parsed?.objects ?? []) {
          if (o?.type === 'image' && o?.src) urls.add(o.src)
          if (o?.data?.src) urls.add(o.data.src)
        }
      } catch { /* canvas_json inválido: lo ignoramos */ }
    }
  }
  return [...urls]
}

export default function EditPublication() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const [pub, setPub]       = useState<any>(null)
  const [pages, setPages]   = useState<any[]>([])
  const [activePage, setActivePage] = useState<any>(null)
  const [uploading, setUploading]   = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const selectedRef = useRef<any>(null)
  const editorClipboardRef = useRef<{ publicationId: string; mode: 'copy' | 'cut'; objects: any[] } | null>(null)
  const [editorClipboardCount, setEditorClipboardCount] = useState(0)
  const [editorClipboardNotice, setEditorClipboardNotice] = useState('')
  const editorClipboardNoticeTimer = useRef<any>(null)
  const [defaultFont, setDefaultFont] = useState<string>(FONTS[0].family) // tipografía para texto nuevo
  const [imageBank, setImageBank] = useState<string[]>([]) // banco de imágenes subidas en este proyecto
  const [mediaBankAssets, setMediaBankAssets] = useState<MediaAsset[]>([])
  const [mediaBankFolders, setMediaBankFolders] = useState<MediaFolder[]>([])
  const [mediaBankFolderId, setMediaBankFolderId] = useState<MediaBankFolderFilter>(undefined)
  const [mediaPickerInitialFolderId, setMediaPickerInitialFolderId] = useState<MediaBankFolderFilter>(undefined)
  const [mediaBankTotal, setMediaBankTotal] = useState(0)
  const [oldImagesPendingCount, setOldImagesPendingCount] = useState(0)
  const [legacyOptimization, setLegacyOptimization] = useState({ running: false, cancelled: false, done: 0, total: 0, failed: 0, message: '' })
  const [selectVersion, setSelectVersion] = useState(0) // fuerza refresco del panel de props
  // Miniaturas reales por página: conserva solo el último dataURL válido para page.id + versión.
  const [thumbnailByPageId, setThumbnailByPageId] = useState<Record<string, PageThumbnailCacheEntry>>({})
  const [thumbnailUrlByPublicUrl, setThumbnailUrlByPublicUrl] = useState<Record<string, string>>({})
  const [displayUrlByPublicUrl, setDisplayUrlByPublicUrl] = useState<Record<string, string>>({})
  const [canvasLoading, setCanvasLoading] = useState(false)
  // Debounce por página para agrupar cambios reales antes de pedir un snapshot.
  const thumbnailTimersRef = useRef<Record<string, any>>({})
  // Tokens por página: invalidan resultados viejos cuando entra un trabajo nuevo.
  const thumbnailTokensRef = useRef<Record<string, number>>({})
  // Cola de trabajos de miniatura; cada página mantiene como máximo un job pendiente.
  const thumbnailQueueRef = useRef<ThumbJob[]>([])
  // Indica si el pump está procesando un trabajo de miniatura.
  const thumbnailProcessingRef = useRef(false)
  // Solo cancela el requestIdleCallback / setTimeout pendiente al desmontar.
  const thumbnailPumpHandleRef = useRef<ThumbnailPumpHandle | null>(null)
  // Evita escribir miniaturas después de desmontar el editor.
  const thumbnailMountedRef = useRef(true)
  const thumbnailPumpRef = useRef<(() => Promise<void>) | null>(null)
  const thumbnailByPageIdRef = useRef<Record<string, PageThumbnailCacheEntry>>({})
  const thumbnailObjectUrlsRef = useRef(new Set<string>())
  const localThumbnailVersionRef = useRef<Record<string, number>>({})
  const [zoom, setZoom]   = useState(100)

  // Estado de autoguardado: 'idle' | 'saving' | 'saved'
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [deepLinkNotice, setDeepLinkNotice] = useState('')

  const [activeTool, setActiveTool] = useState<ToolKey>('pages')
  const [panelOpen, setPanelOpen]   = useState(true)
  const [pagePanelTab, setPagePanelTab] = useState<'config' | 'actions' | 'dynamic'>('config')
  const [ctxMenu, setCtxMenu]       = useState<{ x: number; y: number } | null>(null)
  const [alignRef, setAlignRef]     = useState<'canvas' | 'selection'>('canvas')
  const [mediaPickerIntent, setMediaPickerIntent] = useState<EditorMediaPickerIntent | null>(null)
  const [mediaPickerProgress, setMediaPickerProgress] = useState('')
  const [templates, setTemplates]   = useState<any[]>([])
  const [tplQuery, setTplQuery]     = useState('')
  const [bgColor, setBgColor]       = useState('#ffffff')

  const refreshMediaBank = useCallback(async () => {
    if (!id) return
    try {
      const [foldersRes, pendingRes] = await Promise.all([
        api.mediaFolders.list(id),
        api.mediaAssets.list({ publication_id: id, limit: 1, page: 1, needs_optimization: true }),
      ])
      const folders = foldersRes.data ?? []
      const effectiveFolderId = resolveExistingMediaFolderFilter(mediaBankFolderId, folders)
      const assetsRes = await api.mediaAssets.list({ publication_id: id, limit: 12, page: 1, folder_id: effectiveFolderId })
      const assets = assetsRes.data ?? []
      if (effectiveFolderId !== mediaBankFolderId) setMediaBankFolderId(effectiveFolderId)
      setMediaBankFolders(folders)
      setMediaBankAssets(assets)
      setMediaBankTotal(assetsRes.page?.total ?? assets.length)
      setOldImagesPendingCount(pendingRes.page?.total ?? 0)
      setThumbnailUrlByPublicUrl((prev) => mergeThumbnailLookup(prev, buildThumbnailLookup(assets, toCanvasSafeAssetUrl)))
      setDisplayUrlByPublicUrl((prev) => mergeThumbnailLookup(prev, buildDisplayLookup(assets, toCanvasSafeAssetUrl)))
    } catch (err) {
      console.warn('[media-bank] failed to load assets', err)
    }
  }, [id, mediaBankFolderId])

  const getMediaPickerSessionStorage = useCallback(() => {
    if (typeof window === 'undefined') return null
    try {
      return window.sessionStorage
    } catch {
      return null
    }
  }, [])

  const getRememberedMediaPickerFolder = useCallback((): MediaPickerFolderId => {
    if (!id) return undefined
    return readMediaPickerFolder(getMediaPickerSessionStorage(), id)
  }, [getMediaPickerSessionStorage, id])

  const rememberMediaPickerFolder = useCallback((folderId: MediaPickerFolderId) => {
    if (!id) return
    writeMediaPickerFolder(getMediaPickerSessionStorage(), id, folderId)
  }, [getMediaPickerSessionStorage, id])

  const openMediaPicker = useCallback((intent: EditorMediaPickerIntent, preferredFolderId?: MediaPickerFolderId) => {
    if (!id) return
    const initialFolderId =
      preferredFolderId === undefined
        ? getRememberedMediaPickerFolder()
        : preferredFolderId
    setMediaPickerProgress('')
    setMediaPickerInitialFolderId(initialFolderId)
    setMediaPickerIntent(intent)
  }, [getRememberedMediaPickerFolder, id])

  const ensureFabricElementIdForPicker = useCallback((obj: FabricObjectInstance) => {
    const data = ((obj as any).data ?? {}) as Record<string, unknown>
    const existing = data.elementId
    if (typeof existing === 'string' && existing) return existing
    const elementId = createFabricElementId()
    ;(obj as any).data = { ...data, elementId }
    return elementId
  }, [])

  const findCanvasObjectByElementId = useCallback((canvas: FabricCanvasInstance, elementId: string) => {
    return (canvas.getObjects?.() ?? []).find((obj: FabricObjectInstance) => (obj as any).data?.elementId === elementId) ?? null
  }, [])

  useEffect(() => {
    void refreshMediaBank()
  }, [refreshMediaBank])

  // Biblioteca SVG (recursos vectoriales del super admin, filtrados por plan)
  const [svgLib, setSvgLib]         = useState<any[]>([])
  const [svgLibLoaded, setSvgLibLoaded] = useState(false)
  const [svgLibQuery, setSvgLibQuery]   = useState('')
  const [svgLibFamily, setSvgLibFamily] = useState('') // '' = todas
  const [svgSync, setSvgSync]           = useState(false) // sincronizar SVG en todas las páginas

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<any>(null)
  const pageIdRef = useRef<string | null>(null)
  const canvasReadyRef = useRef(false)
  const canvasGenerationRef = useRef(0)
  const duplicateInFlightRef = useRef(false)
  const deletingPageIdsRef = useRef(new Set<string>())
  const deletedPageIdsRef = useRef(new Set<string>())
  const legacyOptimizationCancelRef = useRef(false)
  // Fuente estable para resolver trabajos persisted sin closures viejos.
  const pagesRef = useRef<any[]>([])
  // Solo para priorización/verificación de página activa; no reconstruye snapshots live.
  const activePageRef = useRef<string | null>(null)
  // Objeto que se va a reemplazar in-situ (icono/SVG/forma/botón/texto): al insertar
  // el siguiente elemento desde el panel, se intercambia por éste conservando caja y posición.
  const replaceTargetRef = useRef<any>(null)
  // ── Reencuadre manual de la hoja (zoom + arrastrar) ──
  const bgImgRef = useRef<any>(null)              // imagen de fondo Fabric actual
  const bgNatRef = useRef<{ iw: number; ih: number }>({ iw: 0, ih: 0 }) // dims naturales
  const coverRef = useRef<{ zoom: number; fx: number; fy: number }>({ zoom: 1, fx: 0.5, fy: 0.5 })
  const coverSaveTimer = useRef<any>(null)
  const adjustModeRef = useRef(false)             // espejo de adjustMode para los listeners del canvas
  const [adjustMode, setAdjustMode] = useState(false)
  const [oddWarnDismissed, setOddWarnDismissed] = useState(false)
  const [coverZoom, setCoverZoom] = useState(1)   // valor del slider (espejo de coverRef.zoom)
  const [adjustTarget, setAdjustTarget] = useState<'bg' | 'image'>('bg') // qué se reencuadra (UI)
  const adjustTargetRef = useRef<'bg' | 'image'>('bg')                   // idem para los listeners
  const imgAdjustRef = useRef<any>(null)                                 // imagen seleccionada a reencuadrar
  const imgBoxRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })     // su recuadro mostrado (px lienzo)
  const imgNatRef = useRef<{ iw: number; ih: number }>({ iw: 0, ih: 0 }) // dims naturales de esa imagen
  const imgCenterRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })  // centro a mantener fijo
  // Vista previa de la hoja activa (snapshot del canvas actual, no editable)
  const [sheetPreview, setSheetPreview] = useState<{ imageUrl: string; cover: any; json: any } | null>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const deepLinkRef = useRef<{
    pageId: string
    markerId: string
    objectId: string
    attempted: boolean
  } | null>(null)
  if (!deepLinkRef.current) {
    const pageId = searchParams.get('page')?.trim() ?? ''
    const markerId = searchParams.get('marker')?.trim() ?? ''
    const objectId = searchParams.get('object')?.trim() ?? ''
    deepLinkRef.current = {
      pageId,
      markerId,
      objectId,
      attempted: !pageId || !objectId,
    }
  }
  const autosaveTimer = useRef<any>(null)
  const savedFlashTimer = useRef<any>(null)
  const isTextEditingRef = useRef(false)
  // PROTECTED: Per-page save sequencing/queue prevents stale saves overwriting newer edits.
  const saveSeqRef = useRef<Record<string, number>>({})
  const saveChainRef = useRef<Record<string, Promise<void>>>({})

  // ── Historial de deshacer/rehacer (undo/redo) ──
  // El historial persistente vive aislado por publicación/página en sessionStorage.
  // Estas refs son el espejo activo para conservar la integración existente.
  const historyRef      = useRef<string[]>([])
  const historyIndexRef = useRef<number>(-1)
  const activeHistoryRef = useRef<EditorHistory | null>(null)
  const activeHistoryKeyRef = useRef<string | null>(null)
  const historyByKeyRef = useRef<Record<string, EditorHistory>>({})
  const isUndoRedoRef   = useRef<boolean>(false)   // true mientras cargamos un estado pasado
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const updateUndoRedoState = useCallback((history = activeHistoryRef.current) => {
    const index = history?.index ?? historyIndexRef.current
    const length = history?.entries.length ?? historyRef.current.length
    setCanUndo(index > 0)
    setCanRedo(index >= 0 && index < length - 1)
  }, [])

  const syncActiveHistory = useCallback((history: EditorHistory | null, persist = true) => {
    activeHistoryRef.current = history
    if (!history) {
      activeHistoryKeyRef.current = null
      historyRef.current = []
      historyIndexRef.current = -1
      updateUndoRedoState(null)
      return
    }
    const key = editorHistoryStorageKey(history.publicationId, history.pageId)
    activeHistoryKeyRef.current = key
    historyByKeyRef.current[key] = history
    historyRef.current = history.entries
    historyIndexRef.current = history.index
    if (persist) saveEditorHistoryToSession(getEditorHistorySessionStorage(), history)
    updateUndoRedoState(history)
  }, [updateUndoRedoState])

  const showEditorClipboardNotice = useCallback((message: string) => {
    setEditorClipboardNotice(message)
    clearTimeout(editorClipboardNoticeTimer.current)
    editorClipboardNoticeTimer.current = window.setTimeout(() => {
      setEditorClipboardNotice('')
    }, 1600)
  }, [])

  useEffect(() => {
    editorClipboardRef.current = null
    setEditorClipboardCount(0)
    setEditorClipboardNotice('')
    historyByKeyRef.current = {}
    syncActiveHistory(null, false)
    return () => {
      editorClipboardRef.current = null
      clearTimeout(editorClipboardNoticeTimer.current)
    }
  }, [id, syncActiveHistory])

  const pushHistory = useCallback((json: string) => {
    const publicationId = id ?? ''
    const pageId = pageIdRef.current ?? activePageRef.current ?? ''
    if (!publicationId || !pageId) return
    const current = activeHistoryRef.current?.publicationId === publicationId && activeHistoryRef.current?.pageId === pageId
      ? activeHistoryRef.current
      : createEditorHistory(publicationId, pageId, json)
    syncActiveHistory(appendEditorHistorySnapshot(current, json))
  }, [id, syncActiveHistory])

  const scheduleAutosaveRef = useRef<() => void>(() => {})

  // PROTECTED: Restores page background after history load.
  // Removing this causes a blank canvas after Undo/Redo.
  const restoreCanvasBackground = useCallback((canvas: any, page: any) => {
    return new Promise<void>((resolve) => {
      const src = page?.image_url || BLANK_PAGE_URL
      const safeSrc = resolveDisplayUrl(src, displayUrlByPublicUrl, toCanvasSafeAssetUrl)
      loadFabricImageCached(safeSrc).then((img: any) => {
        if (img && img.width && img.height) {
          bgNatRef.current = { iw: img.width, ih: img.height }
          const { cropX, cropY, cropW, cropH, scaleX, scaleY } = computeCover(img.width, img.height, coverRef.current)
          img.set({ cropX, cropY, width: cropW, height: cropH, scaleX, scaleY, originX: 'left', originY: 'top', left: 0, top: 0 })
        }
        img?.set?.({ selectable: false, evented: false })
        canvas.setBackgroundImage(img, () => {
          bgImgRef.current = canvas.backgroundImage ?? img
          canvas.renderAll()
          resolve()
        })
      }).catch(() => {
        canvas.renderAll()
        resolve()
      })
    })
  }, [displayUrlByPublicUrl])

  // PROTECTED: Undo/Redo must reload objects and then restore the page background before render.
  const applyHistory = useCallback((json: string) => {
    const c = fabricRef.current
    if (!c) return
    const pageId = pageIdRef.current
    clearTimeout(autosaveTimer.current)
    if (pageId) saveSeqRef.current[pageId] = (saveSeqRef.current[pageId] ?? 0) + 1
    isUndoRedoRef.current = true
    try {
      c.loadFromJSON(stripBackgroundImage(normalizeFabricAssetJson(json, (url) => resolveDisplayUrl(url, displayUrlByPublicUrl, toCanvasSafeAssetUrl))), async () => {
        try {
          if (fabricRef.current !== c || pageIdRef.current !== pageId) return
          await restoreCanvasBackground(c, pageId ? pagesRef.current.find((p) => p.id === pageId) : activePage)
          const active = c.getActiveObject?.() ?? null
          selectedRef.current = active
          setSelected(active)
          setSelectVersion((v) => v + 1)
          scheduleAutosaveRef.current()
        } catch (error) {
          console.error('[editor] apply history failed', error)
          c.renderAll?.()
        } finally {
          isUndoRedoRef.current = false
        }
      })
    } catch (error) {
      isUndoRedoRef.current = false
      console.error('[editor] apply history failed', error)
    }
  }, [activePage, displayUrlByPublicUrl, restoreCanvasBackground])

  useEffect(() => {
    pagesRef.current = pages
  }, [pages])

  useEffect(() => {
    activePageRef.current = activePage?.id ?? null
  }, [activePage?.id])

  useEffect(() => {
    thumbnailMountedRef.current = true
    return () => {
      thumbnailMountedRef.current = false
      for (const timer of Object.values(thumbnailTimersRef.current)) clearTimeout(timer)
      thumbnailTimersRef.current = {}
      if (thumbnailPumpHandleRef.current) {
        const handle = thumbnailPumpHandleRef.current
        const win = typeof window !== 'undefined' ? (window as Window & {
          cancelIdleCallback?: (id: number) => void
        }) : null
        if (handle.kind === 'idle' && win?.cancelIdleCallback) {
          win.cancelIdleCallback(handle.handle)
        } else {
          clearTimeout(handle.handle)
        }
        thumbnailPumpHandleRef.current = null
      }
      thumbnailProcessingRef.current = false
      thumbnailQueueRef.current = []
      thumbnailTokensRef.current = {}
      for (const url of thumbnailObjectUrlsRef.current) URL.revokeObjectURL(url)
      thumbnailObjectUrlsRef.current.clear()
      thumbnailByPageIdRef.current = {}
    }
  }, [])

  useEffect(() => {
    thumbnailByPageIdRef.current = thumbnailByPageId
  }, [thumbnailByPageId])

  const buildPersistedThumbnailSnapshot = useCallback((pageId: string) => {
    const page = pagesRef.current.find((p) => p.id === pageId)
    if (!page) return null
    return {
      image_url: toCanvasSafeAssetUrl(page.image_url || BLANK_PAGE_URL),
      canvas_json: page.canvas_json ?? { version: '5.3.0', objects: [] },
      cover_json: page.cover_json ?? { zoom: 1, fx: 0.5, fy: 0.5 },
    }
  }, [])

  const invalidateThumbnailJob = useCallback((pageId: string) => {
    if (!pageId) return 0
    const nextToken = (thumbnailTokensRef.current[pageId] ?? 0) + 1
    thumbnailTokensRef.current[pageId] = nextToken
    clearTimeout(thumbnailTimersRef.current[pageId])
    delete thumbnailTimersRef.current[pageId]
    thumbnailQueueRef.current = thumbnailQueueRef.current.filter((job) => job.pageId !== pageId)
    return nextToken
  }, [])

  const revokeThumbnailUrl = useCallback((url?: string | null) => {
    if (!url || !url.startsWith('blob:')) return
    if (!thumbnailObjectUrlsRef.current.has(url)) return
    URL.revokeObjectURL(url)
    thumbnailObjectUrlsRef.current.delete(url)
  }, [])

  const replaceLocalPageThumbnail = useCallback((pageId: string, cacheKey: string, blob: Blob) => {
    const url = URL.createObjectURL(blob)
    thumbnailObjectUrlsRef.current.add(url)
    setThumbnailByPageId((prev) => {
      if (!thumbnailMountedRef.current) {
        revokeThumbnailUrl(url)
        return prev
      }
      const previous = prev[pageId]
      if (previous?.key === cacheKey && previous.url === url) return prev
      if (previous?.url && previous.url !== url) revokeThumbnailUrl(previous.url)
      const next = { ...prev, [pageId]: { key: cacheKey, url, status: 'local' as const } }
      thumbnailByPageIdRef.current = next
      return next
    })
  }, [revokeThumbnailUrl])

  const scheduleThumbnailPump = useCallback(() => {
    if (
      thumbnailPumpHandleRef.current ||
      thumbnailProcessingRef.current ||
      thumbnailQueueRef.current.length === 0
    ) return
    if (typeof window === 'undefined') return
    const win = window as Window & {
      requestIdleCallback?: (cb: IdleRequestCallback) => number
    }
    const run = () => {
      thumbnailPumpHandleRef.current = null
      void thumbnailPumpRef.current?.()
    }
    if (typeof win.requestIdleCallback === 'function') {
      const handle = win.requestIdleCallback(run)
      thumbnailPumpHandleRef.current = { kind: 'idle', handle }
    } else {
      const handle = window.setTimeout(run, 0)
      thumbnailPumpHandleRef.current = { kind: 'timeout', handle }
    }
  }, [])

  const enqueueThumbnailJob = useCallback((job: ThumbJob) => {
    if (!job?.pageId) return
    if ((thumbnailTokensRef.current[job.pageId] ?? 0) !== job.token) return

    const nextQueue = thumbnailQueueRef.current.filter((item) => item.pageId !== job.pageId)
    if (job.priority) nextQueue.unshift(job)
    else nextQueue.push(job)
    thumbnailQueueRef.current = nextQueue
    scheduleThumbnailPump()
  }, [scheduleThumbnailPump])

  const pumpThumbnailQueue = useCallback(async () => {
    if (thumbnailProcessingRef.current) return
    const job = thumbnailQueueRef.current.shift()
    if (!job) return
    thumbnailProcessingRef.current = true

    try {
      if (!thumbnailMountedRef.current) return
      if ((thumbnailTokensRef.current[job.pageId] ?? 0) !== job.token) return
      if (!pagesRef.current.some((page) => page.id === job.pageId)) return

      // Para 'live': serializa el canvas activo (sin fondo) y renderiza miniatura igual que 'persisted'.
      // No usar captureLiveThumbnailDataUrl: el canvas principal está tintado (background sin crossOrigin).
      let snapshot
      if (job.mode === 'live' && pageIdRef.current === job.pageId && fabricRef.current) {
        const page = pagesRef.current.find((p) => p.id === job.pageId)
        if (page) {
          const liveJson = serializeCanvasJson(fabricRef.current)
          snapshot = { image_url: page.image_url, canvas_json: liveJson, cover_json: page.cover_json }
        }
      } else {
        snapshot = buildPersistedThumbnailSnapshot(job.pageId)
      }
      const blob = snapshot ? await renderPageThumbnailSnapshot(snapshot) : null
      if (!thumbnailMountedRef.current) return
      const currentPage = pagesRef.current.find((page) => page.id === job.pageId)
      if (!thumbnailJobStillCurrent(thumbnailTokensRef.current[job.pageId], job.token, currentPage, job.cacheKey)) return
      if (!blob) {
        setThumbnailByPageId((prev) => {
          const current = prev[job.pageId]
          if (!current || current.key !== job.cacheKey) return prev
          const next = { ...prev, [job.pageId]: { ...current, status: 'error' as const } }
          thumbnailByPageIdRef.current = next
          return next
        })
        return
      }
      replaceLocalPageThumbnail(job.pageId, job.cacheKey, blob)
    } finally {
      thumbnailProcessingRef.current = false
      if (thumbnailQueueRef.current.length > 0) scheduleThumbnailPump()
    }
  }, [buildPersistedThumbnailSnapshot, replaceLocalPageThumbnail, scheduleThumbnailPump])

  useEffect(() => {
    thumbnailPumpRef.current = pumpThumbnailQueue
    return () => {
      thumbnailPumpRef.current = null
    }
  }, [pumpThumbnailQueue])

  const requestThumbnailUpdate = useCallback((pageId: string, mode: ThumbJob['mode'], opts?: {
    immediate?: boolean
    priority?: boolean
  }) => {
    if (!pageId) return
    const page = pagesRef.current.find((item) => item.id === pageId)
    if (!page) return
    const immediate = !!opts?.immediate
    const priority = opts?.priority ?? pageId === activePageRef.current

    const token = invalidateThumbnailJob(pageId)
    const job: ThumbJob = {
      pageId,
      token,
      mode,
      cacheKey: pageThumbnailCacheKey(page),
      priority,
    }

    if (immediate) {
      clearTimeout(thumbnailTimersRef.current[pageId])
      delete thumbnailTimersRef.current[pageId]
      enqueueThumbnailJob(job)
      return
    }

    clearTimeout(thumbnailTimersRef.current[pageId])
    thumbnailTimersRef.current[pageId] = window.setTimeout(() => {
      delete thumbnailTimersRef.current[pageId]
      enqueueThumbnailJob(job)
    }, 400)
  }, [enqueueThumbnailJob, invalidateThumbnailJob])

  const refreshCurrentThumbnail = useCallback((immediate = false) => {
    const pageId = pageIdRef.current
    if (!pageId) return
    requestThumbnailUpdate(pageId, 'live', { immediate, priority: true })
  }, [requestThumbnailUpdate])

  const rememberMediaAssets = useCallback((assets: MediaAsset[]) => {
    const validAssets = assets.filter((asset) => asset?.id)
    if (!validAssets.length) return
    setThumbnailUrlByPublicUrl((prev) => mergeThumbnailLookup(prev, buildThumbnailLookup(validAssets, toCanvasSafeAssetUrl)))
    setDisplayUrlByPublicUrl((prev) => mergeThumbnailLookup(prev, buildDisplayLookup(validAssets, toCanvasSafeAssetUrl)))
    setMediaBankAssets((prev) => {
      const seen = new Set(prev.map((asset) => asset.id))
      const nextAssets = validAssets.filter((asset) => !seen.has(asset.id))
      if (!nextAssets.length) return prev
      setMediaBankTotal((total) => Math.max(total, prev.length) + nextAssets.length)
      return [...nextAssets, ...prev]
    })
  }, [])

  const markActivePageCanvasChanged = useCallback(() => {
    const pageId = pageIdRef.current
    const canvas = fabricRef.current
    if (!pageId || !canvas || !canvasReadyRef.current) return
    if (deletingPageIdsRef.current.has(pageId) || deletedPageIdsRef.current.has(pageId)) return
    const json = JSON.stringify(serializeCanvasJson(canvas))
    const nextVersion = (localThumbnailVersionRef.current[pageId] ?? 0) + 1
    localThumbnailVersionRef.current[pageId] = nextVersion
    const thumbnailVersion = `local:${nextVersion}`
    let nextPageForThumbnail: any = null
    setPages((prev) => {
      const next = patchPageThumbnailContent(prev, pageId, json, thumbnailVersion)
      pagesRef.current = next
      nextPageForThumbnail = next.find((page) => page.id === pageId) ?? null
      return next
    })
    setActivePage((prev: any) => (
      prev?.id === pageId ? { ...prev, canvas_json: json, thumbnail_version: thumbnailVersion } : prev
    ))
    requestAnimationFrame(() => {
      const page = nextPageForThumbnail ?? pagesRef.current.find((item) => item.id === pageId)
      if (!page || pageThumbnailCacheKey(page) !== pageThumbnailCacheKey(pagesRef.current.find((item) => item.id === pageId) ?? page)) return
      requestThumbnailUpdate(pageId, 'live', { immediate: false, priority: true })
    })
  }, [requestThumbnailUpdate])

  const resolvePublicationThumbnails = useCallback(async (pageList: any[]) => {
    if (!id || !pageList.length) return
    const urls = collectBankFromPages(pageList).map((url) => toCanvasSafeAssetUrl(url)).filter(Boolean)
    if (!urls.length) return
    try {
      const res = await api.mediaAssets.resolveThumbnails({ publication_id: id, public_urls: urls })
      setThumbnailUrlByPublicUrl((prev) => mergeThumbnailLookup(prev, res.data.thumbnails ?? {}))
      setDisplayUrlByPublicUrl((prev) => mergeThumbnailLookup(prev, res.data.displays ?? {}))
      rememberMediaAssets(res.data.assets ?? [])
    } catch (error) {
      console.warn('[page-thumbnails] metadata lookup failed', error)
    }
  }, [id, rememberMediaAssets])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    let bootstrapTimer: ReturnType<typeof setTimeout> | null = null
    api.publications.get(id).then((res) => {
      if (cancelled) return
      setPub(res.data)
      const ps = res.data.pages ?? []
      pagesRef.current = ps
      setPages(ps)
      const requestedPageId = deepLinkRef.current?.pageId ?? ''
      const requestedPage = requestedPageId ? ps.find((page: any) => page.id === requestedPageId) : null
      if (requestedPageId && !requestedPage) {
        setDeepLinkNotice('La página asociada a esta ficha ya no existe.')
        if (deepLinkRef.current) deepLinkRef.current.attempted = true
      }
      if (ps.length > 0) setActivePage(requestedPage ?? ps[0])
      // Banco de imágenes: imágenes del proyecto + las guardadas localmente (subidas pero quizá no colocadas)
      let stored: string[] = []
      let hidden: string[] = []
      try {
        const parsed = JSON.parse(localStorage.getItem(`imgbank_${id}`) ?? '[]')
        stored = Array.isArray(parsed) ? parsed : []
      } catch {}
      try {
        const parsed = JSON.parse(localStorage.getItem(`imgbank_hidden_${id}`) ?? '[]')
        hidden = Array.isArray(parsed) ? parsed : []
      } catch {}
      const hiddenUrls = new Set(hidden.map((url) => toCanvasSafeAssetUrl(url)).filter(Boolean))
      const merged = Array.from(new Set(
        [...collectBankFromPages(ps), ...stored]
          .map((url) => toCanvasSafeAssetUrl(url))
          .filter(Boolean),
      )).filter((url) => !hiddenUrls.has(url))
      setImageBank(merged)
      void refreshMediaBank()
      void resolvePublicationThumbnails(ps)
      bootstrapTimer = setTimeout(() => {
        if (cancelled || !thumbnailMountedRef.current) return
        const firstPageId = (requestedPage ?? ps[0])?.id
        if (firstPageId) requestThumbnailUpdate(firstPageId, 'persisted', { immediate: true, priority: true })
      }, 0)
    })
    api.templates.list().then((r) => setTemplates(r.data ?? [])).catch(() => {})
    return () => {
      cancelled = true
      if (bootstrapTimer) clearTimeout(bootstrapTimer)
    }
  }, [id, refreshMediaBank, resolvePublicationThumbnails])

  // Agrega una URL al banco de imágenes del proyecto (sin duplicar) y lo persiste.
  // Si había sido quitada manualmente del banco, una nueva inserción explícita la restaura.
  const addToBank = useCallback((url: string) => {
    if (!url) return
    const safeUrl = toCanvasSafeAssetUrl(url)
    if (!safeUrl) return
    try {
      const parsed = JSON.parse(localStorage.getItem(`imgbank_hidden_${id}`) ?? '[]')
      const hidden = Array.isArray(parsed) ? parsed : []
      const nextHidden = Array.from(new Set(
        hidden
          .map((entry) => toCanvasSafeAssetUrl(entry))
          .filter((entry) => entry && entry !== safeUrl),
      ))
      localStorage.setItem(`imgbank_hidden_${id}`, JSON.stringify(nextHidden))
    } catch {}
    setImageBank((prev) => {
      if (prev.includes(safeUrl)) return prev
      const next = [safeUrl, ...prev]
      try { localStorage.setItem(`imgbank_${id}`, JSON.stringify(next)) } catch {}
      return next
    })
  }, [id])

  // Retira URLs legacy del banco visual sin modificar las páginas, el canvas ni crear media_assets.
  const removeLegacyUrlsFromBank = useCallback((urls: string[]) => {
    const removedUrls = new Set(
      urls.map((url) => toCanvasSafeAssetUrl(url)).filter(Boolean),
    )
    if (!removedUrls.size) return

    try {
      const parsed = JSON.parse(localStorage.getItem(`imgbank_hidden_${id}`) ?? '[]')
      const hidden = Array.isArray(parsed) ? parsed : []
      const nextHidden = Array.from(new Set([
        ...hidden.map((url) => toCanvasSafeAssetUrl(url)).filter(Boolean),
        ...removedUrls,
      ]))
      localStorage.setItem(`imgbank_hidden_${id}`, JSON.stringify(nextHidden))
    } catch {}

    setImageBank((prev) => {
      const next = prev.filter((url) => !removedUrls.has(toCanvasSafeAssetUrl(url)))
      try { localStorage.setItem(`imgbank_${id}`, JSON.stringify(next)) } catch {}
      return next
    })
  }, [id])

  const cancelLegacyOptimization = useCallback(() => {
    legacyOptimizationCancelRef.current = true
    setLegacyOptimization((prev) => ({ ...prev, cancelled: true, running: false, message: 'Cancelado. Podés continuar luego.' }))
  }, [])

  const optimizeLegacyImages = useCallback(async () => {
    if (!id || legacyOptimization.running) return
    legacyOptimizationCancelRef.current = false
    const knownUrls = new Set(mediaBankAssets.map((asset) => toCanvasSafeAssetUrl(asset.public_url)).filter(Boolean))
    const legacyCandidates = Array.from(new Set([
      ...collectBankFromPages(pagesRef.current),
      ...imageBank,
    ].map((url) => toCanvasSafeAssetUrl(url)).filter(Boolean)))
      .filter((url) => !knownUrls.has(url))
      .slice(0, 100)

    for (const url of legacyCandidates) {
      if (legacyOptimizationCancelRef.current) break
      try {
        const res = await api.mediaAssets.adopt({ publication_id: id, public_url: url })
        rememberMediaAssets([res.data.asset])
      } catch (error) {
        console.warn('[media-bank] legacy adopt skipped', url, error)
      }
    }

    const firstBatch = await api.mediaAssets.list({ publication_id: id, limit: 12, page: 1, needs_optimization: true })
    const total = firstBatch.page?.total ?? (firstBatch.data ?? []).length
    if (!total) {
      setOldImagesPendingCount(0)
      setLegacyOptimization({ running: false, cancelled: false, done: 0, total: 0, failed: 0, message: 'No quedan imágenes pendientes.' })
      return
    }
    let done = 0
    let failed = 0
    const failedThisRun = new Set<string>()
    setLegacyOptimization({ running: true, cancelled: false, done: 0, total, failed: 0, message: `Optimizando 0 de ${total}` })

    const runAsset = async (asset: MediaAsset) => {
      try {
        const res = await fetch(toCanvasSafeAssetUrl(asset.public_url), { mode: 'cors' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const file = new File([blob], asset.original_name || 'imagen', { type: blob.type || asset.mime_type })
        const optimized = await optimizeImageFile(file)
        const thumbnailRes = await api.mediaAssets.uploadVariants(asset.id, {
          publication_id: id,
          display: optimized.displayFile,
          thumbnail: optimized.thumbnailFile,
          metadata: {
            optimized_width: optimized.metadata.optimized_width,
            optimized_height: optimized.metadata.optimized_height,
            thumbnail_width: optimized.metadata.thumbnail_width,
            thumbnail_height: optimized.metadata.thumbnail_height,
            optimization_status: optimized.metadata.optimization_status,
            optimization_version: optimized.metadata.optimization_version,
          },
        })
        const updatedAsset = thumbnailRes.data.asset
        setThumbnailUrlByPublicUrl((prev) => mergeThumbnailLookup(prev, buildThumbnailLookup([updatedAsset], toCanvasSafeAssetUrl)))
        setDisplayUrlByPublicUrl((prev) => mergeThumbnailLookup(prev, buildDisplayLookup([updatedAsset], toCanvasSafeAssetUrl)))
        setMediaBankAssets((prev) => prev.map((item) =>
          item.id === asset.id
            ? { ...item, ...updatedAsset }
            : item,
        ))
      } catch (error: any) {
        failed += 1
        failedThisRun.add(asset.id)
        console.warn('[media-bank] legacy optimization failed', asset.public_url, error)
      } finally {
        done += 1
        setLegacyOptimization({
          running: !legacyOptimizationCancelRef.current && done < total,
          cancelled: legacyOptimizationCancelRef.current,
          done,
          total,
          failed,
          message: legacyOptimizationCancelRef.current
            ? 'Cancelado. Podés continuar luego.'
            : `Optimizando ${done} de ${total}${failed ? ` · ${failed} fallidas por CORS/formato` : ''}`,
        })
      }
    }

    const runBatch = async (queue: MediaAsset[]) => {
      while (!legacyOptimizationCancelRef.current) {
        const asset = queue.shift()
        if (!asset) return
        await runAsset(asset)
      }
    }

    let batch = firstBatch.data ?? []
    while (!legacyOptimizationCancelRef.current && batch.length) {
      const candidates = batch.filter((asset) => !failedThisRun.has(asset.id))
      if (!candidates.length) break
      const queue = [...candidates]
      await Promise.all(Array.from({ length: Math.min(2, queue.length) }, () => runBatch(queue)))
      if (legacyOptimizationCancelRef.current) break
      const nextBatch = await api.mediaAssets.list({ publication_id: id, limit: 12, page: 1, needs_optimization: true })
      batch = (nextBatch.data ?? []).filter((asset) => !failedThisRun.has(asset.id))
      setOldImagesPendingCount(nextBatch.page?.total ?? batch.length)
    }
    await refreshMediaBank()
    setLegacyOptimization((prev) => ({
      ...prev,
      running: false,
      cancelled: legacyOptimizationCancelRef.current,
      message: legacyOptimizationCancelRef.current
        ? 'Cancelado. Podés continuar luego.'
        : `Optimización completada: ${prev.done} de ${prev.total}${prev.failed ? ` · ${prev.failed} fallidas por CORS/formato` : ''}`,
    }))
  }, [id, legacyOptimization.running, refreshMediaBank, imageBank, mediaBankAssets, rememberMediaAssets])

  const imageBankItems = useMemo(() => {
    const seen = new Set<string>()
    const folderById = new Map(mediaBankFolders.map((folder) => [folder.id, folder]))
    const items: Array<{ key: string; url: string; thumbUrl?: string; name: string; meta: string; folderLabel?: string }> = []
    for (const asset of mediaBankAssets) {
      if (items.length >= 12) break
      const originalUrl = toCanvasSafeAssetUrl(asset.public_url)
      const url = toCanvasSafeAssetUrl(asset.display_url || asset.optimized_url || asset.public_url)
      if (!url || !originalUrl || seen.has(originalUrl)) continue
      seen.add(originalUrl)
      const folderLabel = mediaBankFolderId === undefined
        ? (asset.folder_id ? folderById.get(asset.folder_id)?.name ?? 'Carpeta' : 'Banco general')
        : undefined
      items.push({
        key: `asset:${asset.id}`,
        url,
        thumbUrl: asset.thumbnail_url ? toCanvasSafeAssetUrl(asset.thumbnail_url) : url,
        name: asset.original_name || 'Imagen',
        meta: [formatMediaMime(asset.mime_type), formatMediaBytes(asset.size_bytes)].filter(Boolean).join(' · '),
        folderLabel,
      })
    }
    if (mediaBankFolderId !== undefined && mediaBankFolderId !== null) return items
    for (const entry of imageBank) {
      if (items.length >= 12) break
      const originalUrl = toCanvasSafeAssetUrl(entry)
      const url = resolveDisplayUrl(originalUrl, displayUrlByPublicUrl, toCanvasSafeAssetUrl)
      if (!originalUrl || !url || seen.has(originalUrl)) continue
      seen.add(originalUrl)
      const name = decodeURIComponent(originalUrl.split('/').pop()?.split('?')[0] || 'Imagen anterior')
      items.push({
        key: `legacy:${originalUrl}`,
        url,
        thumbUrl: thumbnailUrlByPublicUrl[originalUrl] || url,
        name,
        meta: originalUrl.toLowerCase().includes('.svg') ? 'SVG · Anterior' : 'Anterior',
        folderLabel: mediaBankFolderId === undefined ? 'Banco general' : undefined,
      })
    }
    return items
  }, [displayUrlByPublicUrl, imageBank, mediaBankAssets, mediaBankFolderId, mediaBankFolders, thumbnailUrlByPublicUrl])

  // ── Autoguardado: guarda el canvas actual en segundo plano ──
  // Se llama tras cada cambio (debounce) y al cambiar de página.
  const persistCanvas = useCallback(async (pageId: string, canvas: any, flash = true) => {
    if (!pageId || !canvas) return
    if (deletingPageIdsRef.current.has(pageId) || deletedPageIdsRef.current.has(pageId)) return
    const isCurrentCanvas = pageId === pageIdRef.current && canvas === fabricRef.current
    if (isCurrentCanvas && !canvasReadyRef.current) return
    const seq = (saveSeqRef.current[pageId] ?? 0) + 1
    saveSeqRef.current[pageId] = seq

    // Serializa al programar el guardado, no al ejecutarlo después de otros saves.
    const rawJson = serializeCanvasJson(canvas) as any
    if (rawJson?.objects) {
      rawJson.objects = rawJson.objects.map((obj: any) => {
        if (obj.data?.hiddenInEditor && obj.data?.originalOpacity != null) {
          return { ...obj, opacity: obj.data.originalOpacity, selectable: true, evented: true, hasControls: true, hasBorders: true }
        }
        return obj
      })
    }
    const json = JSON.stringify(rawJson)

    const run = async () => {
      if (deletingPageIdsRef.current.has(pageId) || deletedPageIdsRef.current.has(pageId)) return
      setSaveState('saving')
      const saved = await api.pages.saveCanvas(pageId, json)
      if (saveSeqRef.current[pageId] !== seq) return
      setPages((prev) => {
        const current = prev.find((page) => page.id === pageId)
        const next = upsertPageById(prev, pageId, mergeSavedPagePreservingThumbnailVersion(current, saved?.data, json))
        pagesRef.current = next
        return next
      })
      setActivePage((prev: any) => (
        prev?.id === pageId ? { ...prev, ...mergeSavedPagePreservingThumbnailVersion(prev, saved?.data, json) } : prev
      ))

      // Propagar objetos con syncGroupId a otras páginas.
      // syncGroupId (identificador de sincronización) marca SVGs que deben ser iguales en todas las páginas.
      // Solo sincronizamos propiedades visuales (escala, ángulo, datos) manteniendo la posición por página.
      try {
        const parsed = JSON.parse(json)
        const synced: any[] = (parsed?.objects ?? []).filter((o: any) => o?.data?.syncGroupId)
        if (synced.length > 0) {
          const otherPages = pagesRef.current.filter((p) => p.id !== pageId && p.canvas_json)
          for (const page of otherPages) {
            try {
              const pj = typeof page.canvas_json === 'string' ? JSON.parse(page.canvas_json) : page.canvas_json
              let changed = false
              const updatedObjs = (pj?.objects ?? []).map((o: any) => {
                if (!o?.data?.syncGroupId) return o
                const match = synced.find((s: any) => s.data.syncGroupId === o.data.syncGroupId)
                if (!match) return o
                changed = true
                // Copia propiedades visuales pero conserva left/top/data.action de la copia local
                return { ...match, left: o.left, top: o.top, data: { ...match.data, action: o.data?.action } }
              })
              if (changed) {
                const newJson = JSON.stringify({ ...pj, objects: updatedObjs })
                if (deletingPageIdsRef.current.has(page.id) || deletedPageIdsRef.current.has(page.id)) continue
                await api.pages.saveCanvas(page.id, newJson)
                setPages((prev) => {
                  const next = upsertPageById(prev, page.id, { canvas_json: newJson })
                  pagesRef.current = next
                  return next
                })
              }
            } catch { /* página con JSON inválido — se ignora */ }
          }
        }
      } catch { /* ignorar errores de propagación */ }

      if (flash) {
        setSaveState('saved')
        clearTimeout(savedFlashTimer.current)
        savedFlashTimer.current = setTimeout(() => setSaveState('idle'), 1800)
      } else {
        setSaveState('idle')
      }
    }
    const previous = saveChainRef.current[pageId] ?? Promise.resolve()
    const queued = previous.catch(() => {}).then(run).catch(() => {
      if (saveSeqRef.current[pageId] === seq) setSaveState('idle')
    })
    saveChainRef.current[pageId] = queued
    return queued
  }, [requestThumbnailUpdate])

  // Programa un guardado diferido tras el último cambio confirmado.
  const scheduleAutosave = useCallback(() => {
    if (!pageIdRef.current) return
    if (deletingPageIdsRef.current.has(pageIdRef.current) || deletedPageIdsRef.current.has(pageIdRef.current)) return
    if (!canvasReadyRef.current) return
    clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => {
      if (!pageIdRef.current) return
      if (deletingPageIdsRef.current.has(pageIdRef.current) || deletedPageIdsRef.current.has(pageIdRef.current)) return
      if (!canvasReadyRef.current) return
      if (fabricRef.current && pageIdRef.current) persistCanvas(pageIdRef.current, fabricRef.current)
    }, AUTOSAVE_DELAY_MS)
  }, [persistCanvas])

  const recordCurrentCanvasChange = useCallback(() => {
    const c = fabricRef.current
    if (c && !isTextEditingRef.current && !isUndoRedoRef.current) {
      pushHistory(JSON.stringify(serializeCanvasJson(c)))
    }
    scheduleAutosave()
    markActivePageCanvasChanged()
  }, [markActivePageCanvasChanged, pushHistory, scheduleAutosave])

  // Mantiene la ref actualizada para que applyHistory pueda llamarla
  scheduleAutosaveRef.current = scheduleAutosave
  const activePageDisplayUrl = useMemo(() => (
    activePage ? resolveDisplayUrl(activePage.image_url || BLANK_PAGE_URL, displayUrlByPublicUrl, toCanvasSafeAssetUrl) : ''
  ), [activePage?.image_url, displayUrlByPublicUrl])

  // ── Inicialización del canvas Fabric.js por página ──
  useEffect(() => {
    if (!activePage || !canvasRef.current) return
    setCanvasLoading(true)
    perfMark('canvas-load-start', { pageId: activePage.id, image_url: activePage.image_url, display_url: activePageDisplayUrl })

    const generation = canvasGenerationRef.current + 1
    canvasGenerationRef.current = generation
    const loadingPageId = activePage.id
    canvasReadyRef.current = false
    pageIdRef.current = activePage.id
    if (fabricRef.current) { fabricRef.current.dispose(); fabricRef.current = null }
    selectedRef.current = null
    setSelected(null)
    // Cancela cualquier reemplazo in-situ pendiente y el modo "Ajustar hoja" al cambiar de página
    replaceTargetRef.current = null
    adjustModeRef.current = false
    setAdjustMode(false)

    const publicationId = id ?? ''
    const pageHistoryKey = publicationId ? editorHistoryStorageKey(publicationId, activePage.id) : null
    const restoredHistory = pageHistoryKey
      ? historyByKeyRef.current[pageHistoryKey] ?? loadEditorHistoryFromSession(getEditorHistorySessionStorage(), publicationId, activePage.id)
      : null
    syncActiveHistory(restoredHistory, !!restoredHistory)
    const restoredSnapshot = getEditorHistoryCurrentSnapshot(restoredHistory)

    const W = CANVAS_W
    const H = CANVAS_H
    const canvas = new fabric.Canvas(canvasRef.current, { width: W, height: H, backgroundColor: bgColor, preserveObjectStacking: true })
    canvas.uniformScaling = true   // escalado uniforme por defecto: las esquinas no deforman
    fabricRef.current = canvas

    // Evita que objetos y fondo aparezcan por etapas. El wrapper completo se hace
    // visible cuando JSON y fondo terminaron de preparar el primer render útil.
    const loadingWrapper = (canvas as any).wrapperEl as HTMLElement | undefined
    if (loadingWrapper) loadingWrapper.style.visibility = 'hidden'

    const isCurrentLoad = () =>
      generation === canvasGenerationRef.current &&
      pageIdRef.current === loadingPageId &&
      fabricRef.current === canvas

    // Inicializa el encuadre de esta página desde cover_json (o cubrir centrado).
    bgImgRef.current = null
    bgNatRef.current = { iw: 0, ih: 0 }
    try {
      coverRef.current = activePage.cover_json
        ? { zoom: 1, fx: 0.5, fy: 0.5, ...JSON.parse(activePage.cover_json) }
        : { zoom: 1, fx: 0.5, fy: 0.5 }
    } catch { coverRef.current = { zoom: 1, fx: 0.5, fy: 0.5 } }
    setCoverZoom(coverRef.current.zoom ?? 1)

    // Guarda bloquea el autoguardado mientras se deserializa el JSON de la página.
    // Sin esto, `object:added` dispara por cada objeto durante `loadFromJSON` y
    // el timer de 1.2s expira con el canvas a medio cargar, sobreescribiendo datos.
    let isLoading = true

    // La descarga/decodificación del fondo comienza en paralelo con loadFromJSON.
    // La asignación a Fabric continúa después del JSON porque loadFromJSON limpia el canvas.
    const backgroundImagePromise = activePageDisplayUrl
      ? loadFabricImageCached(activePageDisplayUrl).catch((error) => {
          console.warn('[editor] background image failed', activePageDisplayUrl, error)
          return null
        })
      : Promise.resolve(null)

    const loadBg = (onDone: () => void) => {
      const finishReady = () => {
        if (!isCurrentLoad()) return
        canvasReadyRef.current = true
        if (loadingWrapper) loadingWrapper.style.visibility = 'visible'
        setCanvasLoading(false)
        perfMark('canvas-first-useful-render', { pageId: activePage.id })
        perfMeasure('canvas-time-to-first-useful-render', 'canvas-load-start', undefined, { pageId: activePage.id })
        onDone()
      }

      backgroundImagePromise.then((img: any) => {
        if (!isCurrentLoad()) return

        if (!img) {
          canvas.renderAll()
          finishReady()
          return
        }

        img.set({ selectable: false, evented: false })

        if (img.width && img.height) {
          bgNatRef.current = { iw: img.width, ih: img.height }
          const { cropX, cropY, cropW, cropH, scaleX, scaleY } = computeCover(img.width, img.height, coverRef.current)
          img.set({
            cropX,
            cropY,
            width: cropW,
            height: cropH,
            scaleX,
            scaleY,
            originX: 'left',
            originY: 'top',
            left: 0,
            top: 0,
          })
        }

        canvas.setBackgroundImage(img, () => {
          if (!isCurrentLoad()) return
          bgImgRef.current = canvas.backgroundImage ?? img
          canvas.renderAll()
          finishReady()
        })
      })
    }

    const updateSelectedObject = (next: any) => {
      if (selectedRef.current === next) return
      selectedRef.current = next
      setSelected(next)
      setSelectVersion((v) => v + 1)
    }

    const tryDeepLinkSelection = () => {
      const target = deepLinkRef.current
      if (!target || target.attempted || !target.pageId || !target.objectId || activePage.id !== target.pageId) return
      target.attempted = true

      const matches = canvas.getObjects()
        .filter((o: any) => o?.selectable !== false && o?.evented !== false && o?.data?.elementId === target.objectId)

      if (matches.length === 1) {
        const obj = matches[0]
        canvas.setActiveObject(obj)
        obj.setCoords()
        canvas.requestRenderAll()
        updateSelectedObject(obj)
        setDeepLinkNotice('Ficha localizada en el Editor.')
        return
      }

      if (matches.length > 1) {
        setDeepLinkNotice('Hay más de un objeto con este identificador. Revisa la ficha en el Editor.')
        return
      }

      setDeepLinkNotice('No se encontró el objeto visual asociado a esta ficha.')
    }

    const canvasJsonToLoad = restoredSnapshot ?? activePage.canvas_json
    if (canvasJsonToLoad) {
      const pageJson = typeof canvasJsonToLoad === 'string'
        ? JSON.parse(canvasJsonToLoad)
        : canvasJsonToLoad
      const jsonWithoutBg = stripBackgroundImage(normalizeFabricAssetJson(pageJson, (url) => resolveDisplayUrl(url, displayUrlByPublicUrl, toCanvasSafeAssetUrl)))
      canvas.loadFromJSON(jsonWithoutBg, () => {
        if (!isCurrentLoad()) return
        isLoading = false
        canvas.getObjects().forEach((o: any) => {
          if (o.data?.hiddenInEditor) {
            o.set({ opacity: 0.07, selectable: false, evented: false, hasControls: false, hasBorders: false })
          }
        })
        canvas.renderAll()
        if (restoredHistory) {
          syncActiveHistory(restoredHistory)
        } else {
          syncActiveHistory(createEditorHistory(publicationId, activePage.id, JSON.stringify(serializeCanvasJson(canvas))))
        }
        loadBg(tryDeepLinkSelection)
      })
    } else {
      isLoading = false
      syncActiveHistory(createEditorHistory(publicationId, activePage.id, JSON.stringify(serializeCanvasJson(canvas))))
      loadBg(tryDeepLinkSelection)
    }

    const onSel = (kind: string) => (e: any) => {
      updateSelectedObject(canvas.getActiveObject() ?? e.selected?.[0] ?? null)
    }
    canvas.on('selection:created', onSel('selection:created'))
    canvas.on('selection:updated', onSel('selection:updated'))
    canvas.on('selection:cleared', (e: any) => {
      if (rightPanelRef.current && e?.e?.target && rightPanelRef.current.contains(e.e.target as Node)) return
      updateSelectedObject(null)
    })

    // Arrastre para reencuadrar la hoja (solo en "Ajustar hoja").
    let panning = false, lastPX = 0, lastPY = 0
    canvas.on('mouse:down', (opt: any) => {
      if (!adjustModeRef.current) return
      panning = true
      const pt = canvas.getPointer(opt.e); lastPX = pt.x; lastPY = pt.y
      canvas.setCursor('grabbing')
    })
    canvas.on('mouse:move', (opt: any) => {
      if (!adjustModeRef.current || !panning) return
      const pt = canvas.getPointer(opt.e)
      panCover(pt.x - lastPX, pt.y - lastPY)
      lastPX = pt.x; lastPY = pt.y
    })
    canvas.on('mouse:up', () => {
      if (!panning) return
      panning = false
      if (adjustModeRef.current) { canvas.setCursor('grab'); scheduleCoverSave(); refreshCurrentThumbnail(false) }
    })

    // Tecla Supr / Delete para eliminar el objeto seleccionado
    // Ctrl+Z = deshacer, Ctrl+Y / Ctrl+Shift+Z = rehacer
    const onKeyDown = (e: KeyboardEvent) => {
      const clipboardShortcutBlocked = shouldIgnoreEditorClipboardShortcut(e, isTextEditingRef.current)
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && !clipboardShortcutBlocked) {
        if (!e.shiftKey && key === 'c') {
          const o = canvas.getActiveObject()
          if (o && copySelectedToEditorClipboard()) e.preventDefault()
          return
        }
        if (!e.shiftKey && key === 'x') {
          const o = canvas.getActiveObject()
          if (o && cutSelectedToEditorClipboard()) e.preventDefault()
          return
        }
        if (!e.shiftKey && key === 'v') {
          const payload = editorClipboardRef.current
          const canPasteInternalClipboard = !!payload && payload.publicationId === id && payload.objects.length > 0
          if (canPasteInternalClipboard) {
            e.preventDefault()
            void pasteFromEditorClipboard()
          }
          return
        }
      }
      if (shouldIgnoreEditorClipboardShortcut({ target: e.target, altKey: false, repeat: false }, isTextEditingRef.current)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const o = canvas.getActiveObject()
        if (o) { canvas.remove(o); setSelected(null); scheduleAutosave() }
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z') {
        if (historyIndexRef.current > 0) {
          e.preventDefault()
          undo()
        }
      }
      if ((e.ctrlKey || e.metaKey) && (key === 'y' || (e.shiftKey && key === 'z'))) {
        if (historyIndexRef.current < historyRef.current.length - 1) {
          e.preventDefault()
          redo()
        }
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'd') {
        e.preventDefault()
        void duplicateSelected()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    // Autoguardado + historial en cada cambio confirmado del lienzo.
    const onChange = () => {
      if (isLoading) return  // no guardar durante la carga inicial del JSON
      if (isTextEditingRef.current) return
      if (!isUndoRedoRef.current) pushHistory(JSON.stringify(serializeCanvasJson(canvas)))
      scheduleAutosave()
      markActivePageCanvasChanged()
    }
    const onTextEditingEntered = () => {
      isTextEditingRef.current = true
      clearTimeout(autosaveTimer.current)
    }
    const onTextEditingExited = () => {
      if (isLoading) return
      isTextEditingRef.current = false
      if (!isUndoRedoRef.current) pushHistory(JSON.stringify(serializeCanvasJson(canvas)))
      scheduleAutosave()
      markActivePageCanvasChanged()
    }
    // Reemplazo in-situ: si hay un objeto marcado para reemplazar y el usuario
    // inserta uno nuevo desde el panel, lo intercambiamos conservando posición,
    // tamaño (encajado en la misma caja), ángulo y orden-z. Se registra antes que
    // onChange para que el autoguardado capture ya el elemento reubicado.
    const onObjectAdded = (e: any) => {
      if (isLoading) return
      const target = replaceTargetRef.current
      if (!target) return
      const added = e?.target
      if (!added || added === target) return
      replaceTargetRef.current = null
      try {
        const tW = target.getScaledWidth?.() ?? (target.width ?? 0) * (target.scaleX ?? 1)
        const tH = target.getScaledHeight?.() ?? (target.height ?? 0) * (target.scaleY ?? 1)
        const center = target.getCenterPoint?.()
        const nw = added.getScaledWidth?.() ?? (added.width ?? 0) * (added.scaleX ?? 1)
        const nh = added.getScaledHeight?.() ?? (added.height ?? 0) * (added.scaleY ?? 1)
        if (nw > 0 && nh > 0) {
          const fit = Math.min(tW / nw, tH / nh) || 1
          added.set({ scaleX: (added.scaleX ?? 1) * fit, scaleY: (added.scaleY ?? 1) * fit })
        }
        added.set({ angle: target.angle ?? 0 })
        if (center && added.setPositionByOrigin) added.setPositionByOrigin(center, 'center', 'center')
        const idx = canvas.getObjects().indexOf(target)
        canvas.remove(target)
        if (idx >= 0 && added.moveTo) added.moveTo(idx)
        canvas.setActiveObject(added)
        added.setCoords()
        canvas.requestRenderAll()
        setSelected(added); setSelectVersion((v) => v + 1)
        scheduleAutosave()
      } catch { /* si algo falla, se deja el elemento recién insertado tal cual */ }
    }
    canvas.on('object:added', onObjectAdded)

    // Anti-deformación de texto: al soltar un Textbox escalado, "horneamos" la escala en
    // tamaño de fuente + ancho y reseteamos scaleX/scaleY a 1 → el texto queda nítido y
    // sin estirarse; el ancho reajusta (reenvuelve) el texto en vez de deformarlo.
    canvas.on('object:modified', (e: any) => {
      const o = e?.target
      if (!o || o.type !== 'textbox') return
      if (Math.abs((o.scaleX ?? 1) - 1) < 0.001 && Math.abs((o.scaleY ?? 1) - 1) < 0.001) return
      const newFont = Math.max(6, Math.round((o.fontSize || 24) * (o.scaleY || 1)))
      o.set({ fontSize: newFont, width: Math.max(20, (o.width || 100) * (o.scaleX || 1)), scaleX: 1, scaleY: 1 })
      o.setCoords(); canvas.requestRenderAll()
    })
    canvas.on('object:modified', onChange)
    canvas.on('object:added', onChange)
    canvas.on('object:removed', onChange)
    // PROTECTED: Do not replace with text:changed.
    // Saving per keystroke causes focus loss and stale saves.
    canvas.on('text:editing:entered', onTextEditingEntered)
    canvas.on('text:editing:exited', onTextEditingExited)

    const cleanupCanvas = canvas
    const cleanupPageId = loadingPageId

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      clearTimeout(autosaveTimer.current)
      if (
        isCurrentLoad() &&
        canvasReadyRef.current &&
        !deletingPageIdsRef.current.has(cleanupPageId) &&
        !deletedPageIdsRef.current.has(cleanupPageId)
      ) {
        persistCanvas(cleanupPageId, cleanupCanvas, false)
      }
      canvasGenerationRef.current += 1
      canvasReadyRef.current = false
      setCanvasLoading(false)
      cleanupCanvas.dispose()
      if (fabricRef.current === cleanupCanvas) {
        fabricRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.id, activePageDisplayUrl, displayUrlByPublicUrl])

  useEffect(() => {
    if (!activePage || !pages.length) return
    const index = pages.findIndex((page) => page.id === activePage.id)
    if (index < 0) return
    for (const nearPage of [pages[index - 1], pages[index + 1]]) {
      const url = nearPage ? resolveDisplayUrl(nearPage.image_url || '', displayUrlByPublicUrl, toCanvasSafeAssetUrl) : ''
      if (url) void loadDecodedImage(url).catch(() => {})
    }
  }, [activePage?.id, displayUrlByPublicUrl, pages])

  // Activa/desactiva el modo de reencuadre (hoja o imagen): mientras está activo se
  // desactiva la selección de elementos (para arrastrar) y el cursor cambia a "grab".
  useEffect(() => {
    adjustModeRef.current = adjustMode
    const c = fabricRef.current; if (!c) return
    if (adjustMode) {
      c.discardActiveObject()
      setSelected(null)
      c.selection = false
      c.skipTargetFind = true
      c.defaultCursor = 'grab'
    } else {
      c.selection = true
      c.skipTargetFind = false
      c.defaultCursor = 'default'
      // Al salir, persistir y volver el target a "fondo"
      if (adjustTargetRef.current === 'image') scheduleAutosave()
      adjustTargetRef.current = 'bg'; setAdjustTarget('bg'); imgAdjustRef.current = null
    }
    c.requestRenderAll()
  }, [adjustMode])

  // Activa/desactiva el reencuadre del FONDO de la hoja (botón de la barra). Restaura
  // el encuadre guardado de la página en coverRef antes de entrar.
  function toggleBgAdjust() {
    if (adjustMode) { setAdjustMode(false); return }
    adjustTargetRef.current = 'bg'; setAdjustTarget('bg'); imgAdjustRef.current = null
    try {
      coverRef.current = activePage?.cover_json
        ? { zoom: 1, fx: 0.5, fy: 0.5, ...JSON.parse(activePage.cover_json) }
        : { zoom: 1, fx: 0.5, fy: 0.5 }
    } catch { coverRef.current = { zoom: 1, fx: 0.5, fy: 0.5 } }
    setCoverZoom(coverRef.current.zoom ?? 1)
    setAdjustMode(true)
  }

  // Guarda al cerrar/recargar la pestaña
  useEffect(() => {
    const handler = () => {
      if (fabricRef.current && pageIdRef.current) {
        if (deletingPageIdsRef.current.has(pageIdRef.current) || deletedPageIdsRef.current.has(pageIdRef.current)) return
        try {
          const json = JSON.stringify(serializeCanvasJson(fabricRef.current))
          api.pages.saveCanvas(pageIdRef.current, json).catch(() => {})
        } catch {}
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  function refreshSelected() { setSelectVersion((v) => v + 1) }

  // ── Elementos del canvas ──
  function addText(opts: any = {}) {
    const c = fabricRef.current; if (!c) return
    perfMark('add-text-start', { pageId: pageIdRef.current })
    const t = new fabric.Textbox(opts.sample ?? 'Texto aquí', {
      left: 60, top: 60, width: 240, fontSize: 24, fill: '#111827',
      fontFamily: defaultFont, data: { kind: 'text' }, ...opts,
    })
    c.add(t); c.setActiveObject(t); c.requestRenderAll()
    perfMeasure('add-text-latency', 'add-text-start', undefined, { pageId: pageIdRef.current })
    scheduleAutosave()
  }
  function addShape(kind: 'rect' | 'circle' | 'ellipse' | 'triangle' | 'line' | 'star') {
    const c = fabricRef.current; if (!c) return
    perfMark('add-shape-start', { pageId: pageIdRef.current, kind })
    let o: any
    const common = { left: 100, top: 100, fill: 'rgba(79,70,229,0.85)', data: { kind: 'shape' } }
    if (kind === 'rect') o = new fabric.Rect({ ...common, width: 160, height: 90, rx: 8, ry: 8 })
    else if (kind === 'circle') o = new fabric.Circle({ ...common, radius: 60 })
    else if (kind === 'ellipse') o = new fabric.Ellipse({ ...common, rx: 90, ry: 55 })
    else if (kind === 'triangle') o = new fabric.Triangle({ ...common, width: 120, height: 100 })
    else if (kind === 'line') o = new fabric.Line([0, 0, 250, 0], { ...common, stroke: '#111827', strokeWidth: 3, fill: '' })
    else {
      // estrella de 5 puntas
      const pts: { x: number; y: number }[] = []
      const spikes = 5, outer = 60, inner = 26
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outer : inner
        const a = (Math.PI / spikes) * i - Math.PI / 2
        pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
      }
      o = new fabric.Polygon(pts, { ...common, fill: '#F59E0B' })
    }
    c.add(o); c.setActiveObject(o); c.requestRenderAll()
    perfMeasure('add-shape-latency', 'add-shape-start', undefined, { pageId: pageIdRef.current, kind })
    scheduleAutosave()
  }

  // Crea un botón con texto + estilo coherente y una acción por defecto (enlace)
  function addButton(preset: { label: string; variant: 'solid' | 'outline' | 'pill' }) {
    const c = fabricRef.current; if (!c) return
    const accent = '#4F46E5'
    const radius = preset.variant === 'pill' ? 23 : 8
    const isOutline = preset.variant === 'outline'
    const rect = new fabric.Rect({
      width: 180, height: 46,
      fill: isOutline ? 'rgba(255,255,255,0)' : accent,
      stroke: isOutline ? accent : '',
      strokeWidth: isOutline ? 2 : 0,
      rx: radius, ry: radius, originX: 'center', originY: 'center',
    })
    const txt = new fabric.Text(preset.label, {
      fill: isOutline ? accent : '#fff', fontSize: 15,
      fontFamily: 'Inter, sans-serif', fontWeight: 'bold',
      originX: 'center', originY: 'center',
    })
    const btn = new fabric.Group([rect, txt], {
      left: 110, top: 130,
      data: {
        kind: 'button',
        label: preset.label,
        bg: accent, textColor: isOutline ? accent : '#fff',
        variant: preset.variant,
        action: { type: 'link' as ActionType, url: 'https://' },
      },
    })
    c.add(btn); c.setActiveObject(btn); c.requestRenderAll()
    setActiveTool('buttons')
    scheduleAutosave()
  }

  // Crea un botón con icono SVG de la biblioteca a la izquierda del texto.
  async function addButtonWithIcon(iconItem: any) {
    if (iconItem.locked) {
      alert(iconItem.upgrade_message || `Este recurso requiere plan superior.`)
      return
    }
    const c = fabricRef.current; if (!c) return
    const accent = '#4F46E5'
    try {
      const svgText = await api.svgRaw(iconItem.id)
      fabric.loadSVGFromString(svgText, (objects: any[], options: any) => {
        if (!objects?.length) return
        const icon = fabric.util.groupSVGElements(objects, options)
        icon.scaleToWidth(22)
        icon.set({ originX: 'center', originY: 'center', left: -68, top: 0 })
        const txt = new fabric.Text('Botón', {
          fill: '#fff', fontSize: 14, fontFamily: 'Inter, sans-serif', fontWeight: 'bold',
          originX: 'center', originY: 'center', left: 16, top: 0,
        })
        const bg = new fabric.Rect({
          width: 200, height: 46, fill: accent, rx: 8, ry: 8,
          originX: 'center', originY: 'center',
        })
        const btn = new fabric.Group([bg, icon, txt], {
          left: 110, top: 130,
          data: {
            kind: 'button', label: 'Botón', bg: accent, textColor: '#fff', variant: 'solid',
            svgIconId: iconItem.id,
            action: { type: 'link' as ActionType, url: 'https://' },
          },
        })
        c.add(btn); c.setActiveObject(btn); c.requestRenderAll()
        setActiveTool('buttons')
        scheduleAutosave()
      })
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo cargar el icono')
    }
  }

  // Inserta una imagen ya subida (del banco) como elemento editable, sin re-subir
  function addImageFromUrl(url: string) {
    const c = fabricRef.current; if (!c) return
    const displayUrl = resolveDisplayUrl(url, displayUrlByPublicUrl, toCanvasSafeAssetUrl)
    perfMark('add-image-start', { pageId: pageIdRef.current, url: displayUrl })
    return new Promise<void>((resolve) => {
      loadFabricImageCached(displayUrl).then((img: any) => {
      // Escala la imagen para que no ocupe más del 60 % del ancho del canvas
      const maxW = c.getWidth() * 0.6
      if (img.width > maxW) img.scaleToWidth(maxW)
      img.set({ left: 60, top: 60, data: { kind: 'image', src: displayUrl } })
      c.add(img); c.setActiveObject(img); c.requestRenderAll()
      perfMeasure('add-image-latency', 'add-image-start', undefined, { pageId: pageIdRef.current, url: displayUrl })
      scheduleAutosave()
      resolve()
    }).catch(() => resolve())
    })
  }

  function insertSvgTextAsElements(svgText: string) {
    if (!svgText || !fabricRef.current) return
    fabric.loadSVGFromString(svgText, (objects: any[], options: any) => {
      if (!objects.length) return
      const group = fabric.util.groupSVGElements(objects, options)
      const c = fabricRef.current!
      const maxW = c.getWidth() * 0.7
      if ((group.width ?? 0) > maxW) group.scaleToWidth(maxW)
      group.set({ left: 50, top: 50, data: { kind: 'svg_group' } })
      c.add(group); c.setActiveObject(group); c.requestRenderAll()
      scheduleAutosave()
    })
  }

  async function insertSvgFromUrl(url: string) {
    const res = await fetch(toCanvasSafeAssetUrl(url))
    if (!res.ok) throw new Error(`No se pudo cargar el SVG (${res.status})`)
    insertSvgTextAsElements(await res.text())
  }

  async function insertSvgUrls(urls: string[]) {
    if (!urls.length) return
    setUploading(true)
    try {
      for (const url of urls) await insertSvgFromUrl(url)
    } catch (err: any) {
      alert(err?.message ?? 'No se pudo insertar el SVG')
    } finally {
      setUploading(false)
    }
  }

  async function importPdfPages(file: File, onProgress?: (message: string) => void) {
    if (!file) return
    if (file.type && file.type !== 'application/pdf') {
      throw new Error('Selecciona un archivo PDF válido.')
    }
    if (file.size > 50 * 1024 * 1024) {
      throw new Error('El PDF supera el tamaño máximo permitido de 50 MB.')
    }
    const pdfjsLib = (window as any).pdfjsLib
    if (!pdfjsLib) throw new Error('pdf.js no está disponible. Recargá la página.')
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    setUploading(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const total = pdf.numPages
      if (!total) throw new Error('El PDF no contiene páginas.')
      const renderedPages: Array<{ file: File; width: number; height: number }> = []
      const pdfBaseName = file.name || 'PDF'
      for (let pageNum = 1; pageNum <= total; pageNum++) {
        onProgress?.(`Renderizando página ${pageNum} de ${total}`)
        const page = await pdf.getPage(pageNum)
        const viewport = page.getViewport({ scale: 1.5 })
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error(`No se pudo renderizar la página ${pageNum}`)
        await page.render({ canvasContext: ctx, viewport }).promise
        const blob = await new Promise<Blob>((res) =>
          canvas.toBlob((b) => res(b!), 'image/jpeg', 0.82),
        )
        if (!blob) throw new Error(`No se pudo renderizar la página ${pageNum}`)
        renderedPages.push({
          file: new File([blob], pdfPageAssetName(pdfBaseName, pageNum), { type: 'image/jpeg' }),
          width: canvas.width,
          height: canvas.height,
        })
        canvas.width = 0
        canvas.height = 0
      }
      const optimizedPages: Array<{ file: File; width: number | null; height: number | null }> = []
      const optimizedResults: OptimizedImageResult[] = []
      for (let index = 0; index < renderedPages.length; index += 1) {
        onProgress?.(`Optimizando página ${index + 1} de ${total}`)
        const optimized = await optimizeImageFile(renderedPages[index].file)
        optimizedResults[index] = optimized
        optimizedPages.push({
          file: optimized.displayFile,
          width: optimized.metadata.optimized_width,
          height: optimized.metadata.optimized_height,
        })
      }
      const uploaded = await uploadPdfRenderedPagesAsAssets<MediaAsset>({
        publicationId: id!,
        pages: optimizedPages,
        uploadAsset: (input, index) => {
          const optimized = optimizedResults[index]
          return api.mediaAssets.upload({
            ...input,
            thumbnail: optimized?.thumbnailFile ?? null,
            optimization: optimized?.metadata,
          })
        },
        onProgress,
      })
      rememberMediaAssets(uploaded.assets)
      const used = new Set(pagesRef.current.map((page) => toCanvasSafeAssetUrl(page.image_url || '').trim()).filter(Boolean))
      const duplicateCount = uploaded.urls.filter((url) => used.has(toCanvasSafeAssetUrl(url).trim())).length
      if (duplicateCount > 0) {
        const ok = window.confirm(duplicateCount === 1
          ? 'Esta imagen ya se agregó como página. ¿Deseas agregarla nuevamente?'
          : `${duplicateCount} de las imágenes renderizadas del PDF ya están utilizadas como páginas. ¿Deseas agregarlas nuevamente?`)
        if (!ok) throw new Error('No se agregaron páginas del PDF porque la importación fue cancelada.')
      }
      const result = await addPagesFromUrls(uploaded.urls, onProgress)
      void refreshMediaBank()
      return result
    } catch (err: any) {
      throw new Error(err.message ?? 'Error al importar el PDF')
    } finally {
      setUploading(false)
    }
  }

  function addLinkZone() {
    const c = fabricRef.current; if (!c) return
    const zone = new fabric.Rect({
      left: 80, top: 80, width: 180, height: 100,
      fill: 'rgba(79,70,229,0.15)', stroke: '#4F46E5', strokeDashArray: [6, 4], strokeWidth: 2,
      data: { kind: 'linkzone', action: { type: 'link' as ActionType, url: 'https://' } },
    })
    c.add(zone); c.setActiveObject(zone); c.requestRenderAll()
    scheduleAutosave()
  }

  // Agrega un punto activo animado. En el editor aparece como círculo con anillo;
  // en el visor se renderiza con animación CSS según el estilo elegido.
  function addHotspot(style: 'pulse' | 'blink' | 'ripple') {
    const c = fabricRef.current; if (!c) return
    const colorMap = { pulse: '#4F46E5', blink: '#ef4444', ripple: '#059669' }
    const color = colorMap[style]
    const ring = new fabric.Circle({ radius: 24, fill: `${color}33`, stroke: color, strokeWidth: 1.5, originX: 'center', originY: 'center' })
    const dot  = new fabric.Circle({ radius: 14, fill: color, originX: 'center', originY: 'center' })
    const group = new fabric.Group([ring, dot], {
      left: 120, top: 120,
      data: { kind: 'hotspot', hotspot: { style, color }, action: { type: 'link' as ActionType, url: 'https://' } },
    })
    c.add(group); c.setActiveObject(group); c.requestRenderAll()
    scheduleAutosave()
  }

  // Inserta un icono/figura de la galería como objeto vectorial editable
  function addIcon(svgInner: string) {
    const c = fabricRef.current; if (!c) return
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${svgInner}</svg>`
    fabric.loadSVGFromString(svg, (objects: any[], options: any) => {
      const obj = fabric.util.groupSVGElements(objects, options)
      obj.scaleToWidth(90)
      obj.set({ left: 100, top: 100, data: { kind: 'icon' } })
      c.add(obj); c.setActiveObject(obj); c.requestRenderAll()
      scheduleAutosave()
    })
  }

  // Carga (perezosa) la biblioteca SVG del módulo "Insertar en canvas".
  async function loadSvgLibrary() {
    if (svgLibLoaded) return
    try {
      const res = await api.svgLibrary('canvas_insert_svg')
      setSvgLib(res.data ?? [])
    } catch { /* silencioso: el panel muestra estado vacío */ }
    finally { setSvgLibLoaded(true) }
  }

  // Inserta un SVG de la biblioteca como VECTOR editable. Pide el contenido a la
  // API (no a r2.dev) para evitar CORS y validar el acceso por plan en el servidor.
  async function addSvgFromLibrary(item: any) {
    if (item.locked) {
      alert(item.upgrade_message || `Este recurso requiere el plan ${item.required_plan ?? 'superior'}.`)
      return
    }
    const c = fabricRef.current; if (!c) return
    try {
      const svgText = await api.svgRaw(item.id)
      fabric.loadSVGFromString(svgText, (objects: any[], options: any) => {
        if (!objects || !objects.length) { alert('No se pudo cargar el SVG.'); return }
        const obj = fabric.util.groupSVGElements(objects, options)
        obj.scaleToWidth(120)
        const syncId = svgSync ? crypto.randomUUID() : undefined
        obj.set({ left: 100, top: 100, data: { kind: 'svglib', svgResourceId: item.id, editable: item.editable, ...(syncId ? { syncGroupId: syncId } : {}) } })
        c.add(obj); c.setActiveObject(obj); c.requestRenderAll()
        scheduleAutosave()
      })
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo insertar el SVG')
    }
  }

  // Inserta un widget como un marcador (placeholder) en el lienzo. El visor
  // lo convierte en el componente real (mapa, formulario, video, etc.).
  function addWidget(w: { type: WidgetType; label: string; premium: boolean }) {
    const c = fabricRef.current; if (!c) return
    if (w.premium) { alert(`"${w.label}" es una función premium. Estará disponible al activar el plan correspondiente.`); return }
    const defaultCfg = { ...(WIDGET_DEFAULTS[w.type] ?? {}) }
    if (w.type === 'units_table' && id) defaultCfg.publication_id = id
    // QR y código de barras: se insertan como la IMAGEN real del código (colocable
    // y dimensionable en el lienzo), no como tarjeta.
    if (w.type === 'qr' || w.type === 'barcode' || w.type === 'social') {
      const v = WIDGET_VISUAL[w.type]
      fabric.Image.fromURL(codeImageUrl(w.type, defaultCfg), (img: any) => {
        // Escalado robusto: algunos SVG no reportan dimensiones (img.width = 0) y
        // scaleToWidth daría escala infinita. Usamos un fallback de 240px.
        const nat = img.width && img.width > 1 ? img.width : 240
        const scale = v.w / nat
        img.set({ left: 100, top: 120, scaleX: scale, scaleY: scale, data: { kind: 'widget', widget: { type: w.type, config: defaultCfg } } })
        c.add(img); c.setActiveObject(img); c.requestRenderAll(); scheduleAutosave()
      })
      setActiveTool('widgets')
      return
    }
    const group = makeWidgetCard(w.type, w.label)
    group.set({ left: 100, top: 120, data: { kind: 'widget', widget: { type: w.type, config: defaultCfg } } })
    c.add(group); c.setActiveObject(group); c.requestRenderAll()
    setActiveTool('widgets')
    scheduleAutosave()
  }

  // ── Imágenes / páginas ──
  async function refetchPublicationPages() {
    const res = await api.publications.get(id!)
    const serverPages = res.data.pages ?? []
    setPub(res.data)
    return serverPages
  }

  async function addPageFromUrl(url: string, makeActive = true) {
    const result = await addPagesFromUrls([url])
    const page = result?.confirmedPages[0]
    if (page && makeActive) setActivePage(page)
    return page
  }

  async function addPagesFromUrls(urls: string[], onProgress?: (message: string) => void) {
    if (!urls.length) return null
    setUploading(true)
    setMediaPickerProgress('')
    try {
      return await processPageBatch<any>({
        urls,
        createPages: async (selectedUrls) => {
          for (const url of selectedUrls) addToBank(url)
          const res = await api.pages.addBatch(id!, {
            pages: selectedUrls.map((url) => ({
              image_url: toCanvasSafeAssetUrl(url),
              canvas_json: emptyFabricJson(),
            })),
          })
          return res.pages ?? res.data?.pages ?? []
        },
        refetchPages: refetchPublicationPages,
        commitPages: (nextPages) => {
          pagesRef.current = nextPages
          setPages(nextPages)
        },
        requestThumbnail: (page, opts) => {
          requestThumbnailUpdate(page.id, 'persisted', { immediate: true, priority: opts.isLast })
        },
        setActivePage,
        onProgress: (message) => {
          setMediaPickerProgress(message)
          onProgress?.(message)
        },
      })
    } catch (err: any) {
      if (err instanceof PageBatchConfirmationError) {
        const confirmed = err.confirmation.confirmedPages.length
        const total = err.confirmation.requestedCount
        if (err.confirmation.serverPages.length) {
          pagesRef.current = err.confirmation.serverPages
          setPages(err.confirmation.serverPages)
        }
        throw new Error(confirmed
          ? `Se agregaron ${confirmed} de ${total} páginas. ${total - confirmed} páginas no pudieron agregarse.`
          : 'No se pudo agregar ninguna página.')
      }
      throw err
    } finally {
      setMediaPickerProgress('')
      setUploading(false)
    }
  }

  async function handleUpload(file: File) {
    const optimized = await optimizeImageFile(file)
    const res = await api.mediaAssets.upload({
      publication_id: id!,
      file: optimized.displayFile,
      thumbnail: optimized.thumbnailFile,
      width: optimized.metadata.optimized_width,
      height: optimized.metadata.optimized_height,
      optimization: optimized.metadata,
    })
    if (!res.success) throw new Error('Upload falló')
    await addPageFromUrl(res.data.url)
  }
  async function handleDeletePage(pageId: string) {
    if (deletingPageIdsRef.current.has(pageId)) return
    if (!confirm('¿Eliminar esta página?')) return
    deletingPageIdsRef.current.add(pageId)
    setUploading(true)

    const reconcileDeletedPage = () => {
      deletedPageIdsRef.current.add(pageId)
      deletingPageIdsRef.current.delete(pageId)
      saveSeqRef.current[pageId] = (saveSeqRef.current[pageId] ?? 0) + 1
      delete saveChainRef.current[pageId]
      if (id) {
        const historyKey = editorHistoryStorageKey(id, pageId)
        delete historyByKeyRef.current[historyKey]
        removeEditorHistoryFromSession(getEditorHistorySessionStorage(), id, pageId)
        if (activeHistoryKeyRef.current === historyKey) syncActiveHistory(null, false)
      }

      const currentPages = pagesRef.current
      const originalIndex = currentPages.findIndex((p) => p.id === pageId)
      const nextPages = currentPages
        .filter((p) => p.id !== pageId)
        .map((p, index) => ({ ...p, page_number: index + 1 }))

      pagesRef.current = nextPages
      setPages(nextPages)
      invalidateThumbnailJob(pageId)
      setThumbnailByPageId((curr) => {
        if (!(pageId in curr)) return curr
        const nextCache = { ...curr }
        delete nextCache[pageId]
        return nextCache
      })

      const nextActivePage = originalIndex >= 0
        ? (nextPages[originalIndex] ?? nextPages[originalIndex - 1] ?? nextPages[0] ?? null)
        : (nextPages[0] ?? null)
      if (activePage?.id === pageId) {
        setActivePage(nextActivePage)
      }
      if (nextActivePage?.id) requestThumbnailUpdate(nextActivePage.id, 'persisted', { immediate: true, priority: true })
    }

    try {
      if (activePage?.id === pageId) {
        clearTimeout(autosaveTimer.current)
      }
      await (saveChainRef.current[pageId] ?? Promise.resolve()).catch(() => {})
      await api.pages.delete(pageId)
      reconcileDeletedPage()
    } catch (e: any) {
      const status = e instanceof ApiRequestError ? e.status : e?.status
      const code = e instanceof ApiRequestError ? e.code : e?.code
      if (status === 404) {
        reconcileDeletedPage()
        return
      }
      deletingPageIdsRef.current.delete(pageId)
      if (status === 409 && code === 'PAGE_HAS_HISTORY') {
        alert(e?.message ?? 'No se puede eliminar esta página porque tiene historial asociado.')
        return
      }
      alert(e?.message ?? 'No se pudo eliminar la página.')
    } finally {
      setUploading(false)
    }
  }

  // Duplica una página existente con todo su contenido (imagen de fondo + canvas_json + cover_json).
  // Si la página a duplicar es la activa, primero guarda el estado actual del canvas para no perder cambios.
  async function duplicatePage(page: any) {
    let createdCopyId: string | null = null
    if (duplicateInFlightRef.current) return
    if (page.id === pageIdRef.current && !canvasReadyRef.current) {
      alert('Espera a que la página termine de cargar')
      return
    }
    duplicateInFlightRef.current = true
    clearTimeout(autosaveTimer.current)
    setUploading(true)
    try {
      const sourcePageId = page.id
      const coverJson = page.cover_json ?? null
      const existingElementIds = pagesRef.current.reduce((ids, item) => {
        collectCanvasJsonElementIds(item?.canvas_json, ids)
        return ids
      }, collectFabricElementIds(fabricRef.current?.getObjects?.() ?? []))

      let sourceSnapshot: any
      let savedSourceCanvasJson: string | null = null

      if (sourcePageId === pageIdRef.current) {
        const sourceCanvas = fabricRef.current
        if (!sourceCanvas || pageIdRef.current !== sourcePageId) return

        sourceSnapshot = serializeCanvasJson(sourceCanvas)
        const sourceCanvasJson = JSON.stringify(sourceSnapshot)
        savedSourceCanvasJson = sourceCanvasJson

        const seq = (saveSeqRef.current[sourcePageId] ?? 0) + 1
        saveSeqRef.current[sourcePageId] = seq
        const previous = saveChainRef.current[sourcePageId] ?? Promise.resolve()

        const queued = previous.catch(() => {}).then(async () => {
          setSaveState('saving')
          await api.pages.saveCanvas(sourcePageId, sourceCanvasJson)
          if (saveSeqRef.current[sourcePageId] !== seq) return
          setSaveState('idle')
        }).catch(() => {
          if (saveSeqRef.current[sourcePageId] === seq) setSaveState('idle')
          throw new Error('No se pudo guardar la página original')
        })

        saveChainRef.current[sourcePageId] = queued
        await queued
      } else {
        sourceSnapshot = normalizeSourceCanvasJson(page.canvas_json)
      }

      const copyCanvasJson = JSON.stringify(
        cloneCanvasJsonForDuplicate(sourceSnapshot, existingElementIds),
      )
      const copyCoverJson = cloneCoverJsonForDuplicate(coverJson)

      const basePages = savedSourceCanvasJson
        ? pagesRef.current.map((p) =>
            p.id === sourcePageId
              ? { ...p, canvas_json: savedSourceCanvasJson }
              : p,
          )
        : pagesRef.current

      // Algunas páginas legacy o diseñadas completamente en el canvas no tienen
      // image_url propio. Se crea la copia sobre una hoja blanca y luego se restaura
      // todo el canvas_json, evitando que la API rechace la duplicación.
      const duplicatePageImageUrl =
        typeof page.image_url === 'string' && page.image_url.trim()
          ? page.image_url.trim()
          : BLANK_PAGE_URL

      const res = await api.pages.add(id!, {
        image_url: duplicatePageImageUrl,
      })
      const createdPage = res.data
      createdCopyId = createdPage.id

      const updateRes = await api.pages.update(createdPage.id, {
        canvas_json: copyCanvasJson,
        cover_json: copyCoverJson,
      })

      const updatedPage = {
        ...createdPage,
        ...(updateRes?.data ?? {}),
        canvas_json: copyCanvasJson,
        cover_json: copyCoverJson,
      }
      const duplicateHistory = createEditorHistory(id!, updatedPage.id, copyCanvasJson)
      historyByKeyRef.current[editorHistoryStorageKey(id!, updatedPage.id)] = duplicateHistory
      saveEditorHistoryToSession(getEditorHistorySessionStorage(), duplicateHistory)

      const idx = basePages.findIndex((p) => p.id === sourcePageId)
      const insertAt = idx >= 0 ? idx + 1 : basePages.length
      const nextPages = [...basePages]
      nextPages.splice(insertAt, 0, updatedPage)

      const numberedPages = nextPages.map((p, index) => ({
        ...p,
        page_number: index + 1,
      }))

      await api.pages.reorder(id!, numberedPages.map((p) => p.id))

      createdCopyId = null
      pagesRef.current = numberedPages
      setPages(numberedPages)
      setActivePage(numberedPages[insertAt])
      requestThumbnailUpdate(updatedPage.id, 'persisted', {
        immediate: true,
        priority: true,
      })
    } catch (e: any) {
      if (createdCopyId) {
        try {
          await api.pages.delete(createdCopyId)
        } catch (rollbackError) {
          console.error('[duplicatePage] rollback failed', {
            page_id: createdCopyId,
            error: rollbackError,
          })
        }
      }
      alert(e.message ?? 'No se pudo duplicar la página')
    } finally {
      duplicateInFlightRef.current = false
      setUploading(false)
    }
  }

  // Agrega una página en blanco (lienzo blanco) a la publicación actual.
  // Usa un SVG data-URL blanco como image_url para no requerir subida a R2.
  async function addBlankPage() {
    setUploading(true)
    try {
      const res = await api.pages.add(id!, { image_url: BLANK_PAGE_URL })
      setPages((prev) => { const next = [...prev, res.data]; pagesRef.current = next; setActivePage(res.data); return next })
      requestThumbnailUpdate(res.data.id, 'persisted', { immediate: true, priority: true })
    } catch (e: any) {
      alert(e.message ?? 'No se pudo agregar la página en blanco')
    } finally { setUploading(false) }
  }

  // Agrega las páginas de una plantilla a la publicación actual y recarga
  async function useTemplate(tpl: any) {
    if (!confirm(`¿Agregar las páginas de «${tpl.name}» a esta publicación?`)) return
    try {
      const r = await api.templates.apply(tpl.id, { publication_id: id! })
      const res = await api.publications.get(id!)
      const ps = res.data.pages ?? []
      pagesRef.current = ps
      setPages(ps)
      if (ps.length > 0) setActivePage(ps[ps.length - (r.data.pages_added || 1)] ?? ps[0])
      void resolvePublicationThumbnails(ps)
      const activeTemplatePageId = (ps[ps.length - (r.data.pages_added || 1)] ?? ps[0])?.id
      if (activeTemplatePageId) requestThumbnailUpdate(activeTemplatePageId, 'persisted', { immediate: true, priority: true })
    } catch (e: any) {
      alert(e.message ?? 'No se pudo aplicar la plantilla')
    }
  }

  // ── Drag & drop ──
  const dragRef = useRef<number | null>(null)
  function onDragStart(i: number) { dragRef.current = i }
  function onDropReorder(i: number) {
    if (dragRef.current === null || dragRef.current === i) return
    const next = [...pages]
    const [moved] = next.splice(dragRef.current, 1)
    next.splice(i, 0, moved)
    pagesRef.current = next
    setPages(next)
    api.pages.reorder(id!, next.map((p) => p.id))
    dragRef.current = null
  }
  const [fileDrag, setFileDrag] = useState(false)
  function onFileDragOver(e: React.DragEvent) {
    if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); setFileDrag(true) }
  }
  function onFileDragLeave() { setFileDrag(false) }
  async function onFileDrop(e: React.DragEvent) {
    e.preventDefault(); setFileDrag(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'].includes(f.type))
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) await handleUpload(file)
    } catch (err: any) {
      alert(err?.message ?? 'No se pudieron agregar las páginas')
    } finally {
      setUploading(false)
    }
  }

  function applyBgColor(color: string, all = false) {
    setBgColor(color)
    const c = fabricRef.current
    if (c) { c.setBackgroundColor(color, c.renderAll.bind(c)); scheduleAutosave() }
    if (all) {
      // Aplica a todas las páginas (solo visual local; cada página lo persiste al abrirse)
      setPages((prev) => {
        const next = prev.map((p) => ({ ...p, bg_color: color }))
        pagesRef.current = next
        return next
      })
    }
  }

  async function handlePublish() {
    setPublishing(true)
    if (fabricRef.current && pageIdRef.current) await persistCanvas(pageIdRef.current, fabricRef.current, false)
    try {
      const res = await api.publications.publish(id!)
      setPub(res.data)
    } finally { setPublishing(false) }
  }

  function undo() {
    const history = activeHistoryRef.current
    if (!history || history.index <= 0) return
    const next = moveEditorHistoryIndex(history, -1)
    const snapshot = getEditorHistoryCurrentSnapshot(next)
    if (!snapshot || next.index === history.index) return
    syncActiveHistory(next)
    applyHistory(snapshot)
  }

  function redo() {
    const history = activeHistoryRef.current
    if (!history || history.index >= history.entries.length - 1) return
    const next = moveEditorHistoryIndex(history, 1)
    const snapshot = getEditorHistoryCurrentSnapshot(next)
    if (!snapshot || next.index === history.index) return
    syncActiveHistory(next)
    applyHistory(snapshot)
  }

  function deleteSelected() {
    const c = fabricRef.current
    const o = c?.getActiveObject()
    if (o) { c!.remove(o); setSelected(null); scheduleAutosave() }
  }

  function copySelectedToEditorClipboard() {
    const c = fabricRef.current
    const o = c?.getActiveObject()
    if (!id || !c || !o || isTextEditingRef.current) return false
    const objects = serializeFabricSelectionForClipboard(o, c.getObjects())
    if (!objects.length) return false
    editorClipboardRef.current = { publicationId: id, mode: 'copy', objects }
    setEditorClipboardCount(objects.length)
    showEditorClipboardNotice(editorClipboardCountLabel(objects.length, 'copiado'))
    return true
  }

  function cutSelectedToEditorClipboard() {
    const c = fabricRef.current
    const o = c?.getActiveObject()
    if (!id || !c || !o || isTextEditingRef.current) return false
    const objects = serializeFabricSelectionForClipboard(o, c.getObjects())
    const selectedObjects = getFabricSelectionObjects(o, c.getObjects())
    if (!objects.length || !selectedObjects.length) return false
    editorClipboardRef.current = { publicationId: id, mode: 'cut', objects }
    setEditorClipboardCount(objects.length)
    replaceTargetRef.current = null
    c.discardActiveObject()
    selectedObjects.forEach((obj) => c.remove(obj))
    setSelected(null)
    selectedRef.current = null
    setSelectVersion((v) => v + 1)
    c.requestRenderAll()
    scheduleAutosave()
    showEditorClipboardNotice(editorClipboardCountLabel(objects.length, 'cortado'))
    return true
  }

  async function pasteFromEditorClipboard() {
    const c = fabricRef.current
    const payload = editorClipboardRef.current
    if (!id || !c || !payload || payload.publicationId !== id || !payload.objects.length || isTextEditingRef.current) return false
    let addedObjects: any[] = []
    try {
      const prepared = prepareClipboardObjectsForPaste(payload.objects, c.getObjects())
      const enlivened = await enlivenFabricObjects(prepared)
      if (!enlivened.length || enlivened.length !== prepared.length) throw new Error('No se pudieron reconstruir todos los elementos.')

      replaceTargetRef.current = null
      c.discardActiveObject()
      enlivened.forEach((obj) => {
        obj.setCoords?.()
        c.add(obj)
        addedObjects.push(obj)
      })

      if (addedObjects.length === 1) {
        c.setActiveObject(addedObjects[0])
        setSelected(addedObjects[0])
      } else {
        const selection = new fabric.ActiveSelection(addedObjects, { canvas: c })
        selection.setCoords()
        c.setActiveObject(selection)
        setSelected(selection)
      }
      selectedRef.current = c.getActiveObject?.() ?? null
      setSelectVersion((v) => v + 1)
      c.requestRenderAll()
      scheduleAutosave()
      editorClipboardRef.current = { ...payload, mode: 'copy' }
      setEditorClipboardCount(payload.objects.length)
      showEditorClipboardNotice(editorClipboardCountLabel(payload.objects.length, 'pegado'))
      return true
    } catch (error) {
      for (const obj of addedObjects) c.remove(obj)
      c.discardActiveObject()
      setSelected(null)
      selectedRef.current = null
      setSelectVersion((v) => v + 1)
      c.requestRenderAll()
      console.error('[editor] paste from editor clipboard failed', error)
      alert('No se pudieron pegar los elementos. El portapapeles interno se mantiene intacto.')
      return false
    }
  }

  async function duplicateSelected() {
    const c = fabricRef.current
    const o = c?.getActiveObject()
    if (!c || !o) return
    try {
      exitTextEditingBeforeDuplicate(o)
      isTextEditingRef.current = false
      const clone = await cloneFabricObject(o)
      if (!clone) return

      replaceTargetRef.current = null
      const existingElementIds = collectFabricElementIds(c.getObjects())
      resetDuplicateTree(clone, existingElementIds)
      restoreDuplicateInteractivity(clone, o)
      clone.set({ left: (o.left ?? 0) + DUPLICATE_OFFSET, top: (o.top ?? 0) + DUPLICATE_OFFSET })

      c.discardActiveObject()
      if (o.type === 'activeSelection') {
        clone._restoreObjectsState?.()
        const clonedObjects = typeof clone.getObjects === 'function' ? clone.getObjects() : []
        clonedObjects.forEach((child: any) => {
          child.setCoords?.()
          c.add(child)
        })
        const selection = new fabric.ActiveSelection(clonedObjects, { canvas: c })
        keepObjectWithinCanvas(selection, c)
        selection.setCoords()
        c.setActiveObject(selection)
        setSelected(selection)
      } else {
        keepObjectWithinCanvas(clone, c)
        c.add(clone)
        clone.setCoords?.()
        c.setActiveObject(clone)
        setSelected(clone)
      }
      c.requestRenderAll()
      setSelectVersion((v) => v + 1)
      scheduleAutosave()
    } catch (error) {
      console.error('[editor] duplicate selected failed', error)
    }
  }
  function bringToFront() { const o = fabricRef.current?.getActiveObject(); if (o) { o.bringToFront(); fabricRef.current.requestRenderAll(); recordCurrentCanvasChange() } }
  function sendToBack() { const o = fabricRef.current?.getActiveObject(); if (o) { o.sendToBack(); fabricRef.current.requestRenderAll(); recordCurrentCanvasChange() } }
  function bringForward() { const o = fabricRef.current?.getActiveObject(); if (o) { o.bringForward(); fabricRef.current.requestRenderAll(); recordCurrentCanvasChange() } }
  function sendBackward() { const o = fabricRef.current?.getActiveObject(); if (o) { o.sendBackwards(); fabricRef.current.requestRenderAll(); recordCurrentCanvasChange() } }

  // Agrupar la selección múltiple en un solo objeto / desagrupar un grupo.
  function groupSelected() {
    const c = fabricRef.current; const o = c?.getActiveObject(); if (!o) return
    if (o.type === 'activeSelection') { o.toGroup(); c.requestRenderAll(); setSelectVersion((v) => v + 1); recordCurrentCanvasChange() }
  }
  function ungroupSelected() {
    const c = fabricRef.current; const o = c?.getActiveObject(); if (!o) return
    if (o.type === 'group') { o.toActiveSelection(); c.requestRenderAll(); setSelectVersion((v) => v + 1); recordCurrentCanvasChange() }
  }

  // Bloquear / desbloquear: impide mover, escalar y rotar el objeto.
  function toggleLock() {
    const c = fabricRef.current; const o = c?.getActiveObject(); if (!o) return
    const locked = !o.lockMovementX
    o.set({
      lockMovementX: locked, lockMovementY: locked,
      lockScalingX: locked, lockScalingY: locked, lockRotation: locked,
      hasControls: !locked, editable: !locked,
    })
    o.data = { ...(o.data ?? {}), locked }
    c.discardActiveObject(); c.requestRenderAll(); setSelected(null); setSelectVersion((v) => v + 1); recordCurrentCanvasChange()
  }

  // Oculta o muestra un elemento EN EL LIENZO del editor (no afecta la publicación).
  // Útil cuando hay muchos elementos superpuestos y se quiere trabajar en las capas de abajo.
  // La opacidad real se guarda en data.originalOpacity para que el viewer la use correctamente.
  function toggleHideInEditor() {
    const c = fabricRef.current; const o = c?.getActiveObject(); if (!o) return
    const nowHidden = !!o.data?.hiddenInEditor
    if (nowHidden) {
      const orig = o.data?.originalOpacity ?? 1
      o.data = { ...(o.data ?? {}), hiddenInEditor: false, originalOpacity: undefined }
      o.set({ opacity: orig, selectable: true, evented: true, hasControls: true, hasBorders: true })
    } else {
      o.data = { ...(o.data ?? {}), hiddenInEditor: true, originalOpacity: o.opacity ?? 1 }
      o.set({ opacity: 0.07, selectable: false, evented: false, hasControls: false, hasBorders: false })
      c.discardActiveObject()
      setSelected(null)
    }
    c.requestRenderAll()
    setSelectVersion((v) => v + 1)
    recordCurrentCanvasChange()
  }

  function showAllHiddenInEditor() {
    const c = fabricRef.current; if (!c) return
    let changed = false
    c.getObjects().forEach((o: any) => {
      if (o.data?.hiddenInEditor) {
        const orig = o.data?.originalOpacity ?? 1
        o.data = { ...o.data, hiddenInEditor: false, originalOpacity: undefined }
        o.set({ opacity: orig, selectable: true, evented: true, hasControls: true, hasBorders: true })
        changed = true
      }
    })
    if (changed) { c.requestRenderAll(); setSelectVersion((v) => v + 1); recordCurrentCanvasChange() }
  }

  // ── Reencuadre manual (cubrir + recorte) — funciona sobre el FONDO de la hoja o
  // sobre una IMAGEN seleccionada, según adjustTargetRef. Misma lógica para ambos. ──

  // Inicia el reencuadre de una imagen seleccionada (botón "Reencuadrar imagen").
  function startImageReframe(o: any) {
    const c = fabricRef.current; if (!c || !o) return
    const el = o.getElement?.() ?? o._element
    const iw = el?.naturalWidth || o.width || 0
    const ih = el?.naturalHeight || o.height || 0
    if (!iw || !ih) return
    const center = o.getCenterPoint?.() ?? { x: o.left ?? 0, y: o.top ?? 0 }
    imgAdjustRef.current = o
    imgBoxRef.current = { w: o.getScaledWidth?.() ?? 0, h: o.getScaledHeight?.() ?? 0 }
    imgNatRef.current = { iw, ih }
    imgCenterRef.current = { x: center.x, y: center.y }
    coverRef.current = { zoom: 1, fx: 0.5, fy: 0.5, ...(o.data?.imgCover ?? {}) }
    setCoverZoom(coverRef.current.zoom ?? 1)
    adjustTargetRef.current = 'image'; setAdjustTarget('image')
    setAdjustMode(true)
  }

  // Re-aplica el recorte según coverRef.current al target activo.
  function applyCover() {
    const c = fabricRef.current; if (!c) return
    if (adjustTargetRef.current === 'image') {
      const o = imgAdjustRef.current; const { iw, ih } = imgNatRef.current; const box = imgBoxRef.current
      if (!o || !iw || !ih || !box.w || !box.h) return
      const { cropX, cropY, cropW, cropH, scaleX, scaleY } = computeCover(iw, ih, coverRef.current, box.w, box.h)
      o.set({ cropX, cropY, width: cropW, height: cropH, scaleX, scaleY })
      o.setPositionByOrigin(new fabric.Point(imgCenterRef.current.x, imgCenterRef.current.y), 'center', 'center')
      o.data = { ...(o.data ?? {}), imgCover: { ...coverRef.current } }
      o.dirty = true   // invalida la caché interna → re-render en vivo del recorte
      o.setCoords(); c.requestRenderAll()
      return
    }
    const img = c.backgroundImage ?? bgImgRef.current
    if (img && bgImgRef.current !== img) bgImgRef.current = img
    const { iw, ih } = bgNatRef.current
    if (!img || !iw || !ih) return
    const { cropX, cropY, cropW, cropH, scaleX, scaleY } = computeCover(iw, ih, coverRef.current)
    img.set({ cropX, cropY, width: cropW, height: cropH, scaleX, scaleY, left: 0, top: 0, originX: 'left', originY: 'top' })
    img.dirty = true   // invalida la caché interna de Fabric → el zoom/recorte se ve al instante
    img.setCoords && img.setCoords()
    c.requestRenderAll()
  }

  // Mueve el encuadre (pan) según un arrastre en píxeles del lienzo. Arrastrar hacia
  // un lado revela el lado contrario, por eso fx/fy se mueven en sentido inverso.
  function panCover(dx: number, dy: number) {
    const isImg = adjustTargetRef.current === 'image'
    const { iw, ih } = isImg ? imgNatRef.current : bgNatRef.current
    if (!iw || !ih) return
    const box = imgBoxRef.current
    const tW = isImg ? box.w : undefined, tH = isImg ? box.h : undefined
    const { cropW, cropH, scaleX, scaleY } = computeCover(iw, ih, coverRef.current, tW, tH)
    const fr = coverRef.current
    const rangeX = iw - cropW, rangeY = ih - cropH
    if (rangeX > 0) fr.fx = Math.min(1, Math.max(0, fr.fx - (dx / scaleX) / rangeX))
    if (rangeY > 0) fr.fy = Math.min(1, Math.max(0, fr.fy - (dy / scaleY) / rangeY))
    applyCover()
  }

  // Cambia el zoom del encuadre (1x–3x) desde el slider.
  function setCoverZoomValue(z: number) {
    coverRef.current = { ...coverRef.current, zoom: z }
    setCoverZoom(z)
    applyCover(); scheduleCoverSave(); refreshCurrentThumbnail(false)
  }

  // Restablece el encuadre a "cubrir centrado".
  function resetCover() {
    coverRef.current = { zoom: 1, fx: 0.5, fy: 0.5 }
    setCoverZoom(1)
    applyCover(); scheduleCoverSave(); refreshCurrentThumbnail(false)
  }

  // Guarda el encuadre (debounce). Fondo → cover_json vía PUT; imagen → canvas_json
  // (el recorte ya queda en data.imgCover + cropX/cropY que Fabric serializa).
  function scheduleCoverSave() {
    clearTimeout(coverSaveTimer.current)
    coverSaveTimer.current = setTimeout(saveCover, 700)
  }
  async function saveCover() {
    if (adjustTargetRef.current === 'image') { scheduleAutosave(); return }
    const pid = pageIdRef.current; if (!pid) return
    const json = JSON.stringify(coverRef.current)
    try {
      await api.pages.update(pid, { cover_json: json })
      setPages((prev) => {
        const next = upsertPageById(prev, pid, { cover_json: json })
        pagesRef.current = next
        return next
      })
    } catch { /* si falla, el encuadre queda solo en pantalla hasta el próximo guardado */ }
  }

  // Abre la vista previa de la hoja activa: captura el estado actual del canvas
  // (objetos + encuadre del fondo) para renderizarlo limpio, sin manijas de selección.
  function openSheetPreview() {
    const c = fabricRef.current; if (!c || !activePage) return
    c.discardActiveObject(); c.requestRenderAll(); setSelected(null)
    const json = c.toJSON(['data'])
    setSheetPreview({ imageUrl: toCanvasSafeAssetUrl(activePage.image_url), cover: { ...coverRef.current }, json })
  }

  // Reemplazar el elemento seleccionado — enruta al panel de origen según tipo.
  // Imágenes: abren el modal del banco. Los demás tipos: se marcan para reemplazo
  // in-situ (replaceTargetRef) y se navega al panel; al insertar el nuevo elemento,
  // el listener object:added lo intercambia conservando posición y tamaño.
  function replaceSelected() {
    const c = fabricRef.current; const o = c?.getActiveObject()
    if (!o) return
    const kind = o.data?.kind
    // Imágenes y placeholders rectangulares/poligonales → selector del banco de imágenes.
    if (shouldOpenImageReplacementForObject({ kind, type: o.type })) {
      const pageId = pageIdRef.current
      if (!pageId || !c) return
      const hadElementId = typeof o.data?.elementId === 'string' && !!o.data.elementId
      const elementId = ensureFabricElementIdForPicker(o)
      if (!hadElementId) recordCurrentCanvasChange()
      openMediaPicker({ type: 'replace-object', pageId, elementId, canvasInstance: c })
      return
    }
    // Marca el objeto a reemplazar y abre el panel de origen correspondiente.
    replaceTargetRef.current = o
    // Iconos → panel Elementos
    if (kind === 'icon') { selectTool('elements'); return }
    // SVG de biblioteca → panel Biblioteca
    if (kind === 'svglib') { selectTool('svglib'); return }
    // Formas → panel Formas
    if (kind === 'shape' || o.type === 'rect' || o.type === 'circle' || o.type === 'triangle' || o.type === 'path') {
      selectTool('shapes'); return
    }
    // Botones → panel Botones
    if (kind === 'button') { selectTool('buttons'); return }
    // Texto → panel Texto
    if (o.type === 'i-text' || o.type === 'textbox') { selectTool('text'); return }
    // Tipo no reconocido: cancelamos el reemplazo in-situ y abrimos el modal de imagen
    replaceTargetRef.current = null
    const pageId = pageIdRef.current
    if (!pageId || !c) return
    const hadElementId = typeof o.data?.elementId === 'string' && !!o.data.elementId
    const elementId = ensureFabricElementIdForPicker(o)
    if (!hadElementId) recordCurrentCanvasChange()
    openMediaPicker({ type: 'replace-object', pageId, elementId, canvasInstance: c })
  }

  // Reemplaza la imagen activa por una URL nueva, conservando el MISMO recuadro
  // (posición, ancho y alto) de la imagen anterior. Modo "cubrir": la nueva imagen
  // se recorta (cropX/cropY) para llenar el recuadro sin deformarse, sin importar su
  // proporción. Se crea siempre con fabric.Image.fromURL (igual que addImageFromUrl,
  // la ruta que sí funciona) y SIN crossOrigin: forzar crossOrigin:'anonymous' rompe
  // la carga cuando R2 no envía cabeceras CORS (la imagen quedaba como una "línea").
  const getIntentCanvasObject = useCallback((intent: Extract<EditorMediaPickerIntent, { pageId: string; elementId: string }>) => {
    if (pageIdRef.current !== intent.pageId) return null
    const canvas = fabricRef.current
    if (!canvas) return null
    if (intent.type === 'replace-object' && canvas !== intent.canvasInstance) return null
    const target = findCanvasObjectByElementId(canvas, intent.elementId)
    if (!target) return null
    if (!canvas.getObjects?.().includes(target)) return null
    if ((target as any).data?.elementId !== intent.elementId) return null
    return { canvas, target }
  }, [findCanvasObjectByElementId])

  const updateWidgetGalleryImagesByIntent = useCallback((
    intent: Extract<EditorMediaPickerIntent, { type: 'widget-gallery-add' | 'widget-gallery-replace' }>,
    selectedUrls: string[],
  ) => {
    const resolved = getIntentCanvasObject(intent)
    if (!resolved) return false
    const data = { ...((resolved.target as any).data ?? {}) }
    const widget = { ...(data.widget ?? {}) }
    const config = { ...(widget.config ?? {}) }
    const currentImages = Array.isArray(config.images) ? [...config.images] : []
    let nextImages = currentImages

    if (intent.type === 'widget-gallery-add') {
      nextImages = appendMediaPickerUrls(currentImages, { urls: selectedUrls }, intent.max)
      if (nextImages === currentImages) return false
    } else {
      const url = selectFirstMediaPickerUrl({ urls: selectedUrls })
      if (!url) return false
      if (intent.imageIndex < 0 || intent.imageIndex >= currentImages.length) return false
      nextImages[intent.imageIndex] = url
    }

    widget.config = { ...config, images: nextImages }
    data.widget = widget
    ;(resolved.target as any).data = data
    resolved.canvas.requestRenderAll()
    recordCurrentCanvasChange()
    setSelectVersion((v) => v + 1)
    return true
  }, [getIntentCanvasObject, recordCurrentCanvasChange])

  const updateActionGalleryImagesByIntent = useCallback((
    intent: Extract<EditorMediaPickerIntent, { type: 'action-gallery-add' | 'action-gallery-replace' }>,
    selectedUrls: string[],
  ) => {
    const resolved = getIntentCanvasObject(intent)
    if (!resolved) return false
    const data = { ...((resolved.target as any).data ?? {}) }
    const action = { ...(data.action ?? { type: 'gallery_images' }) }
    const currentImages = Array.isArray(action.images) ? [...action.images] : []
    const cover = typeof action.cover === 'string' ? action.cover : currentImages[0] ?? ''
    let nextImages = currentImages

    if (intent.type === 'action-gallery-add') {
      nextImages = appendMediaPickerUrls(currentImages, { urls: selectedUrls }, intent.max)
      if (nextImages === currentImages) return false
    } else {
      const url = selectFirstMediaPickerUrl({ urls: selectedUrls })
      if (!url) return false
      if (intent.imageIndex < 0 || intent.imageIndex >= currentImages.length) return false
      nextImages[intent.imageIndex] = url
    }

    data.action = {
      ...action,
      images: nextImages,
      cover: nextImages.includes(cover) ? cover : (nextImages[0] ?? ''),
    }
    ;(resolved.target as any).data = data
    resolved.canvas.requestRenderAll()
    recordCurrentCanvasChange()
    setSelectVersion((v) => v + 1)
    return true
  }, [getIntentCanvasObject, recordCurrentCanvasChange])

  const updateWidgetImageFieldByIntent = useCallback((
    intent: Extract<EditorMediaPickerIntent, { type: 'widget-image-field' }>,
    selectedUrls: string[],
  ) => {
    const url = selectFirstMediaPickerUrl({ urls: selectedUrls })
    if (!url) return false
    const resolved = getIntentCanvasObject(intent)
    if (!resolved) return false
    const data = { ...((resolved.target as any).data ?? {}) }
    const widget = { ...(data.widget ?? {}) }
    const config = { ...(widget.config ?? {}) }
    widget.config = { ...config, [intent.field]: url }
    data.widget = widget
    ;(resolved.target as any).data = data
    resolved.canvas.requestRenderAll()
    recordCurrentCanvasChange()
    setSelectVersion((v) => v + 1)
    return true
  }, [getIntentCanvasObject, recordCurrentCanvasChange])

  const updateActionImageFieldByIntent = useCallback((
    intent: Extract<EditorMediaPickerIntent, { type: 'action-image-field' }>,
    selectedUrls: string[],
  ) => {
    const url = selectFirstMediaPickerUrl({ urls: selectedUrls })
    if (!url) return false
    const resolved = getIntentCanvasObject(intent)
    if (!resolved) return false
    const data = { ...((resolved.target as any).data ?? {}) }
    data.action = { ...(data.action ?? {}), [intent.field]: url }
    ;(resolved.target as any).data = data
    resolved.canvas.requestRenderAll()
    recordCurrentCanvasChange()
    setSelectVersion((v) => v + 1)
    return true
  }, [getIntentCanvasObject, recordCurrentCanvasChange])

  type ReplacementResult =
    | { ok: true; cause: 'replacement-applied'; loadedUrl: string; canonicalUrl: string }
    | { ok: false; cause: 'page-changed' | 'canvas-changed' | 'target-not-found' | 'element-id-changed' | 'image-load-failed' | 'image-invalid'; attemptedUrl?: string }
  type ReplacementFailure = Extract<ReplacementResult, { ok: false }>

  function safeReplacementDiagnosticUrl(url: string) {
    try {
      const parsed = new URL(url)
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString()
    } catch {
      return url.split('?')[0].split('#')[0]
    }
  }

  function validateReplacementTarget(
    targetObject: FabricObjectInstance,
    canvasInstance: FabricCanvasInstance,
    pageId: string,
    elementId: string,
  ): ReplacementFailure | null {
    if (pageIdRef.current !== pageId) return { ok: false, cause: 'page-changed' }
    if (fabricRef.current !== canvasInstance) return { ok: false, cause: 'canvas-changed' }
    if (!canvasInstance.getObjects?.().includes(targetObject)) return { ok: false, cause: 'target-not-found' }
    if ((targetObject as any).data?.elementId !== elementId) return { ok: false, cause: 'element-id-changed' }
    return null
  }

  function loadFabricImageCandidate(url: string): Promise<{ img?: any; error?: unknown }> {
    return new Promise((resolve) => {
      try {
        fabric.Image.fromURL(url, (img: any) => resolve({ img }), (message) => resolve({ error: message }))
      } catch (error) {
        resolve({ error })
      }
    })
  }

  async function doReplaceWithUrl(
    canonicalUrl: string,
    loadCandidates: string[],
    targetObject: FabricObjectInstance,
    canvasInstance: FabricCanvasInstance,
    pageId: string,
    elementId: string,
  ): Promise<ReplacementResult> {
    const c = canvasInstance
    let o = targetObject
    // Recuadro mostrado actual (ancho y alto ya escalados) que debemos replicar.
    const targetW = o.getScaledWidth?.() ?? (o.width ?? 0) * (o.scaleX ?? 1)
    const targetH = o.getScaledHeight?.() ?? (o.height ?? 0) * (o.scaleY ?? 1)
    const prevLeft = o.left ?? 0, prevTop = o.top ?? 0
    const prevAngle = o.angle ?? 0
    const prevFlipX = !!o.flipX, prevFlipY = !!o.flipY
    const prevOriginX = o.originX ?? 'left', prevOriginY = o.originY ?? 'top'
    const prevData = { ...(o.data ?? {}), kind: 'image', src: canonicalUrl }
    let idx = c.getObjects().indexOf(o)

    const initialInvalid = validateReplacementTarget(o, c, pageId, elementId)
    if (initialInvalid) return initialInvalid

    for (let candidateIndex = 0; candidateIndex < loadCandidates.length; candidateIndex += 1) {
      const attemptedUrl = loadCandidates[candidateIndex]
      const loaded = await loadFabricImageCandidate(attemptedUrl)
      if (loaded.error) {
        console.warn('[media-picker] image replacement candidate failed', {
          reason: 'image-load-failed',
          candidateIndex,
          url: safeReplacementDiagnosticUrl(attemptedUrl),
          pageId,
          elementId,
        })
        continue
      }
      const img = loaded.img
      if (!img || !img.width || !img.height) {
        console.warn('[media-picker] image replacement candidate failed', {
          reason: 'image-invalid',
          candidateIndex,
          url: safeReplacementDiagnosticUrl(attemptedUrl),
          pageId,
          elementId,
        })
        continue
      }

      // Fabric puede rehidratar el objeto mientras la imagen se descarga.
      // Se vuelve a localizar por elementId para no depender de la instancia anterior.
      const currentTarget = findCanvasObjectByElementId(c, elementId)
      if (!currentTarget) {
        return { ok: false, cause: 'target-not-found', attemptedUrl }
      }

      o = currentTarget
      idx = c.getObjects().indexOf(o)

      const asyncInvalid = validateReplacementTarget(o, c, pageId, elementId)
      if (asyncInvalid) return { ...asyncInvalid, attemptedUrl }

      try {
        const iw = img.width, ih = img.height
        // Modo "cubrir": recorta el sobrante para que la región mostrada tenga la misma
        // proporción que el recuadro destino, centrando el recorte.
        const targetAspect = targetH > 0 ? targetW / targetH : iw / ih
        let cropW = iw, cropH = ih, cropX = 0, cropY = 0
        if (iw / ih > targetAspect) {
          // Imagen más ancha que el recuadro → recortar lados
          cropW = ih * targetAspect; cropX = (iw - cropW) / 2
        } else {
          // Imagen más alta → recortar arriba/abajo
          cropH = iw / targetAspect; cropY = (ih - cropH) / 2
        }
        const scale = cropW > 0 ? targetW / cropW : 1
        img.set({
          cropX, cropY, width: cropW, height: cropH,
          left: prevLeft, top: prevTop, scaleX: scale, scaleY: scale, angle: prevAngle,
          flipX: prevFlipX, flipY: prevFlipY, originX: prevOriginX, originY: prevOriginY,
        })
        img.data = prevData
        const previousUndoRedo = isUndoRedoRef.current
        isUndoRedoRef.current = true
        try {
          c.remove(o)
          c.add(img)
        } finally {
          isUndoRedoRef.current = previousUndoRedo
        }
        if (idx >= 0 && img.moveTo) img.moveTo(idx)
        c.setActiveObject(img)
        img.setCoords(); c.requestRenderAll()
        setSelected(img); setSelectVersion((v) => v + 1)
        recordCurrentCanvasChange()
        addToBank(canonicalUrl)
        return { ok: true, cause: 'replacement-applied', loadedUrl: attemptedUrl, canonicalUrl }
      } catch (error) {
        console.warn('[media-picker] image replacement candidate failed', {
          reason: error instanceof Error ? error.message : 'replacement-error',
          candidateIndex,
          url: safeReplacementDiagnosticUrl(attemptedUrl),
          pageId,
          elementId,
        })
      }
    }

    return { ok: false, cause: 'image-load-failed', attemptedUrl: loadCandidates[loadCandidates.length - 1] }
  }

  const handleMediaPickerSelect = useCallback(async (urls: string[], assets?: MediaAsset[]) => {
    const intent = mediaPickerIntent
    const selectedUrls = urls.filter(Boolean)
    if (!intent || !selectedUrls.length) return
    const clearPickerIntent = () => {
      setMediaPickerIntent(null)
      replaceTargetRef.current = null
    }

    try {
      if (intent.type === 'pages') {
        const result = await addPagesFromUrls(selectedUrls)
        if (assets?.length) rememberMediaAssets(assets)
        clearPickerIntent()
        void refreshMediaBank()
        return { confirmedCount: result?.confirmedPages.length ?? 0 }
      }

      if (intent.type === 'svg') {
        await insertSvgUrls(selectedUrls)
        if (assets?.length) rememberMediaAssets(assets)
        clearPickerIntent()
        void refreshMediaBank()
        return
      }

      if (intent.type === 'insert-images') {
        if (pageIdRef.current !== intent.pageId) throw new Error('No se pudo aplicar la selección en la página actual.')
        for (const url of selectedUrls) {
          addToBank(url)
          await addImageFromUrl(url)
        }
        if (assets?.length) rememberMediaAssets(assets)
        clearPickerIntent()
        void refreshMediaBank()
        return
      }

      if (intent.type === 'replace-object') {
        const selectedIndex = selectedUrls.findIndex(Boolean)
        const selectedUrl = selectFirstMediaPickerUrl({ urls: selectedUrls, assets })
        const selectedAsset = selectedIndex >= 0 ? assets?.[selectedIndex] : assets?.[0]
        if (!selectedUrl) throw new Error(MEDIA_PICKER_REPLACEMENT_ERROR)
        const resolved = getIntentCanvasObject(intent)
        if (!resolved) throw new Error(MEDIA_PICKER_REPLACEMENT_ERROR)
        const source = resolveMediaPickerReplacementSource(selectedUrl, selectedAsset)
        if (!source.canonicalUrl || !source.loadCandidates.length) throw new Error(MEDIA_PICKER_REPLACEMENT_ERROR)
        const applied = await doReplaceWithUrl(source.canonicalUrl, source.loadCandidates, resolved.target, resolved.canvas, intent.pageId, intent.elementId)
        if (!applied.ok) {
          console.warn('[media-picker] image replacement did not apply', {
            reason: applied.cause,
            url: applied.attemptedUrl ? safeReplacementDiagnosticUrl(applied.attemptedUrl) : undefined,
            pageId: intent.pageId,
            elementId: intent.elementId,
          })
          throw new Error(MEDIA_PICKER_REPLACEMENT_ERROR)
        }
        if (selectedAsset) rememberMediaAssets([selectedAsset])
        clearPickerIntent()
        void refreshMediaBank()
        return
      }

      if (intent.type === 'widget-gallery-add' || intent.type === 'widget-gallery-replace') {
        const applied = updateWidgetGalleryImagesByIntent(intent, selectedUrls)
        if (!applied) throw new Error('No se pudo aplicar la selección a la galería.')
        if (assets?.length) rememberMediaAssets(assets)
        clearPickerIntent()
        void refreshMediaBank()
        return
      }

      if (intent.type === 'action-gallery-add' || intent.type === 'action-gallery-replace') {
        const applied = updateActionGalleryImagesByIntent(intent, selectedUrls)
        if (!applied) throw new Error('No se pudo aplicar la selección a la galería.')
        if (assets?.length) rememberMediaAssets(assets)
        clearPickerIntent()
        void refreshMediaBank()
        return
      }

      if (intent.type === 'widget-image-field') {
        const applied = updateWidgetImageFieldByIntent(intent, selectedUrls)
        if (!applied) throw new Error('No se pudo aplicar la imagen seleccionada.')
        if (assets?.length) rememberMediaAssets(assets)
        clearPickerIntent()
        void refreshMediaBank()
        return
      }

      if (intent.type === 'action-image-field') {
        const applied = updateActionImageFieldByIntent(intent, selectedUrls)
        if (!applied) throw new Error('No se pudo aplicar la imagen seleccionada.')
        if (assets?.length) rememberMediaAssets(assets)
        clearPickerIntent()
        void refreshMediaBank()
      }
    } catch (error) {
      console.warn('[media-picker] selection handler failed', error)
      throw error
    }
  }, [mediaPickerIntent, rememberMediaAssets, addPagesFromUrls, refreshMediaBank, insertSvgUrls, addToBank, addImageFromUrl, getIntentCanvasObject, updateWidgetGalleryImagesByIntent, updateActionGalleryImagesByIntent, updateWidgetImageFieldByIntent, updateActionImageFieldByIntent])

  // Activar/desactivar sincronización multi-página de un SVG seleccionado.
  // Al activar: marca el objeto con un syncGroupId y crea una copia en cada
  // página que aún no la tenga. Las ediciones posteriores se propagan vía persistCanvas.
  // Al desactivar: quita la marca (las copias quedan independientes).
  async function handleSvgSyncToggle(enabled: boolean) {
    const c = fabricRef.current; const o = c?.getActiveObject(); if (!o) return
    const pageId = pageIdRef.current

    if (!enabled) {
      o.data = { ...(o.data ?? {}), syncGroupId: undefined }
      c.requestRenderAll(); recordCurrentCanvasChange(); setSelectVersion((v) => v + 1)
      return
    }

    const syncId = crypto.randomUUID()
    o.data = { ...(o.data ?? {}), syncGroupId: syncId }
    c.requestRenderAll()
    // Serializa el objeto marcado para clonarlo en las demás páginas.
    const serialized = o.toObject(['data'])
    setUploading(true)
    try {
      const otherPages = pagesRef.current.filter((p) => p.id !== pageId)
      for (const page of otherPages) {
        try {
          const pj = page.canvas_json
            ? (typeof page.canvas_json === 'string' ? JSON.parse(page.canvas_json) : page.canvas_json)
            : { version: '5.3.0', objects: [] }
          // Evita duplicar si ya existe una copia con el mismo syncGroupId
          const exists = (pj.objects ?? []).some((x: any) => x?.data?.syncGroupId === syncId)
          if (exists) continue
          pj.objects = [...(pj.objects ?? []), serialized]
          const newJson = JSON.stringify(pj)
          await api.pages.saveCanvas(page.id, newJson)
          setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, canvas_json: newJson } : p)))
        } catch { /* página con JSON inválido — se ignora */ }
      }
    } finally { setUploading(false) }
    recordCurrentCanvasChange(); setSelectVersion((v) => v + 1)
  }

  // Alinear el objeto respecto al lienzo o a la selección múltiple.
  function alignSelected(how: 'left' | 'centerH' | 'right' | 'top' | 'middle' | 'bottom') {
    const c = fabricRef.current; const o = c?.getActiveObject(); if (!o) return

    if (alignRef === 'selection' && o.type === 'activeSelection') {
      // Alinear objetos dentro de los límites de la selección múltiple.
      // Las posiciones de sub-objetos son relativas al centro de la selección activa.
      const selW = o.getScaledWidth?.() ?? o.width ?? 0
      const selH = o.getScaledHeight?.() ?? o.height ?? 0
      const objs: any[] = (o as any).getObjects()
      objs.forEach((obj: any) => {
        const bw = obj.getScaledWidth?.() ?? obj.width ?? 0
        const bh = obj.getScaledHeight?.() ?? obj.height ?? 0
        switch (how) {
          case 'left':    obj.set({ left: -selW / 2 }); break
          case 'centerH': obj.set({ left: -bw / 2 }); break
          case 'right':   obj.set({ left: selW / 2 - bw }); break
          case 'top':     obj.set({ top: -selH / 2 }); break
          case 'middle':  obj.set({ top: -bh / 2 }); break
          case 'bottom':  obj.set({ top: selH / 2 - bh }); break
        }
        obj.setCoords()
      })
      o.setCoords(); c.requestRenderAll()
    } else {
      const W = c.getWidth(), H = c.getHeight()
      const bw = o.getScaledWidth?.() ?? o.width ?? 0
      const bh = o.getScaledHeight?.() ?? o.height ?? 0
      const offX = (o.originX === 'center') ? bw / 2 : 0
      const offY = (o.originY === 'center') ? bh / 2 : 0
      switch (how) {
        case 'left':    o.set({ left: offX }); break
        case 'centerH': o.set({ left: (W - bw) / 2 + offX }); break
        case 'right':   o.set({ left: W - bw + offX }); break
        case 'top':     o.set({ top: offY }); break
        case 'middle':  o.set({ top: (H - bh) / 2 + offY }); break
        case 'bottom':  o.set({ top: H - bh + offY }); break
      }
      o.setCoords(); c.requestRenderAll()
    }
    setSelectVersion((v) => v + 1); recordCurrentCanvasChange()
  }

  // Menú contextual (clic derecho) sobre el lienzo.
  function onCanvasContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    const c = fabricRef.current; if (!c) return
    const target = c.findTarget?.(e.nativeEvent, false)
    if (target) { c.setActiveObject(target); c.requestRenderAll(); setSelected(target); setSelectVersion((v) => v + 1) }
    else { c.discardActiveObject(); c.requestRenderAll(); setSelected(null) }
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  function selectTool(key: ToolKey) {
    if (key === 'image' || key === 'uploads') perfMark('media-bank-open', { tool: key })
    if (key === activeTool && panelOpen) { setPanelOpen(false); return }
    setActiveTool(key); setPanelOpen(true)
    if (key === 'svglib' || key === 'buttons') loadSvgLibrary()
  }

  const activePageIndex = activePage ? pages.findIndex((p) => p.id === activePage.id) : -1
  const filteredTpls = templates.filter((t) => t.name?.toLowerCase().includes(tplQuery.toLowerCase()))

  if (!pub) return <div style={s.loading}>Cargando editor...</div>

  return (
    <div style={s.root}>
      {/* ── Barra superior ── */}
      <div style={s.topBar}>
        <div style={s.topLeft}>
          <Link to="/publications" style={s.backLink}>&#8592; Mis flipbooks</Link>
          <span style={s.pubTitle}>{pub.title}</span>
        </div>
        <div style={s.topCenter}>
          {activePage && pages.length > 0 && (
            <span style={s.breadcrumb}>{activePageIndex + 1} / {pages.length}</span>
          )}
        </div>
        <div style={s.topRight}>
          <span style={s.saveInd}>
            {saveState === 'saving' ? '⟳ Guardando…' : saveState === 'saved' ? '✓ Guardado' : 'Autoguardado activo'}
          </span>
          <button style={s.btnOutlineWhite} onClick={openSheetPreview} disabled={!activePage} title="Ver cómo queda la hoja actual con los cambios">
            Vista previa de hoja
          </button>
          <Link to={`/publications/${id}/preview`}>
            <button style={s.btnOutlineWhite}>Vista previa</button>
          </Link>
          <button
            style={{ ...s.btnPublish, background: pub.status === 'published' ? '#16a34a' : '#4f46e5' }}
            onClick={handlePublish}
            disabled={publishing}
          >
            {publishing ? 'Publicando...' : pub.status === 'published' ? '✓ Publicado' : 'Publicar'}
          </button>
        </div>
      </div>

      {deepLinkNotice && (
        <div style={s.deepLinkNotice}>{deepLinkNotice}</div>
      )}
      {editorClipboardNotice && (
        <div style={s.editorClipboardNotice}>{editorClipboardNotice}</div>
      )}

      <div style={s.body}>
        {/* ── Icon rail ── */}
        <nav style={s.rail}>
          {RAIL.map((t) => {
            const active = activeTool === t.key && panelOpen
            return (
              <button
                key={t.key}
                onClick={() => selectTool(t.key)}
                title={t.label}
                style={{ ...s.railBtn, ...(active ? s.railBtnActive : {}) }}
              >
                <Icon name={t.key} />
                <span style={s.railLabel}>{t.label}</span>
              </button>
            )
          })}
        </nav>

        {/* ── Panel contextual ── */}
        {panelOpen && (
          <aside style={s.panel}>
            <ContextPanel
              tool={activeTool}
              pages={pages}
              thumbnailByPageId={thumbnailByPageId}
              thumbnailUrlByPublicUrl={thumbnailUrlByPublicUrl}
              displayUrlByPublicUrl={displayUrlByPublicUrl}
              activePage={activePage}
              requestThumbnailUpdate={requestThumbnailUpdate}
              setActivePage={setActivePage}
              onDragStart={onDragStart}
              onDropReorder={onDropReorder}
              handleDeletePage={handleDeletePage}
              duplicatePage={duplicatePage}
              addBlankPage={addBlankPage}
              uploading={uploading}
              fileDrag={fileDrag}
              onFileDragOver={onFileDragOver}
              onFileDragLeave={onFileDragLeave}
              onFileDrop={onFileDrop}
              templates={filteredTpls}
              useTemplate={useTemplate}
              tplQuery={tplQuery}
              setTplQuery={setTplQuery}
              addText={addText}
              addShape={addShape}
              addButton={addButton}
              addLinkZone={addLinkZone}
              openImagePicker={() => {
                const pageId = pageIdRef.current
                if (!pageId) return
                openMediaPicker({ type: 'insert-images', pageId }, mediaBankFolderId)
              }}
              openPagePicker={() => openMediaPicker({ type: 'pages' }, null)}
              openSvgPicker={() => openMediaPicker({ type: 'svg' })}
              addIcon={addIcon}
              addHotspot={addHotspot}
              addWidget={addWidget}
              svgLib={svgLib}
              svgLibLoaded={svgLibLoaded}
              svgLibQuery={svgLibQuery}
              setSvgLibQuery={setSvgLibQuery}
              svgLibFamily={svgLibFamily}
              setSvgLibFamily={setSvgLibFamily}
              addSvgFromLibrary={addSvgFromLibrary}
              svgSync={svgSync}
              setSvgSync={setSvgSync}
              addButtonWithIcon={addButtonWithIcon}
              defaultFont={defaultFont}
              setDefaultFont={setDefaultFont}
              imageBank={imageBank}
              imageBankItems={imageBankItems}
              mediaBankFolders={mediaBankFolders}
              mediaBankFolderId={mediaBankFolderId}
              setMediaBankFolderId={setMediaBankFolderId}
              imageBankTotal={mediaBankTotal || imageBankItems.length}
              oldImagesPendingOptimization={oldImagesPendingCount}
              legacyOptimization={legacyOptimization}
              optimizeLegacyImages={optimizeLegacyImages}
              cancelLegacyOptimization={cancelLegacyOptimization}
              insertImageFromBank={(url: string) => void addImageFromUrl(url)}
              onShowAllHidden={showAllHiddenInEditor}
            />
          </aside>
        )}

        {/* ── Canvas central ── */}
        <main style={s.center}>
          <div style={s.toolbar}>
            <ToolbarBtn icon="undo"      title="Deshacer (Ctrl+Z)" onClick={undo}             disabled={!canUndo} />
            <ToolbarBtn icon="redo"      title="Rehacer (Ctrl+Y)"  onClick={redo}             disabled={!canRedo} />
            <ToolbarBtn icon="crop"      title="Ajustar hoja (zoom y posición)" onClick={toggleBgAdjust} active={adjustMode && adjustTarget === 'bg'} disabled={!activePage} />
            <div style={s.toolSep} />
            <ToolbarBtn icon="copy"      title="Copiar"            onClick={copySelectedToEditorClipboard} disabled={!selected} />
            <ToolbarBtn icon="cut"       title="Cortar"            onClick={cutSelectedToEditorClipboard} disabled={!selected} />
            <ToolbarBtn icon="paste"     title="Pegar"             onClick={() => { void pasteFromEditorClipboard() }} disabled={editorClipboardCount <= 0} />
            <div style={s.toolSep} />
            <ToolbarBtn icon="duplicate" title="Duplicar"          onClick={duplicateSelected} disabled={!selected} />
            <ToolbarBtn icon="trash"     title="Eliminar"          onClick={deleteSelected}   disabled={!selected} />
            <div style={s.toolSep} />
            <ToolbarBtn icon="group"     title="Agrupar"           onClick={groupSelected}    disabled={selected?.type !== 'activeSelection'} />
            <ToolbarBtn icon="ungroup"   title="Desagrupar"        onClick={ungroupSelected}  disabled={selected?.type !== 'group'} />
            <div style={s.toolSep} />
            <ToolbarBtn icon="front"     title="Traer al frente"   onClick={bringToFront}     disabled={!selected} />
            <ToolbarBtn icon="forward"   title="Adelantar"         onClick={bringForward}     disabled={!selected} />
            <ToolbarBtn icon="backward"  title="Atrasar"           onClick={sendBackward}     disabled={!selected} />
            <ToolbarBtn icon="back"      title="Enviar al fondo"   onClick={sendToBack}       disabled={!selected} />
            <div style={s.toolSep} />
            <ToolbarBtn icon={selected?.data?.locked ? 'unlock' : 'lock'} title={selected?.data?.locked ? 'Desbloquear' : 'Bloquear'} onClick={toggleLock} disabled={!selected} />
            <ToolbarBtn icon="replace"   title="Reemplazar elemento" onClick={replaceSelected}  disabled={!selected} />
            <div style={s.toolSep} />
            <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: 7, overflow: 'hidden', fontSize: 10, fontWeight: 600 }}>
              <button
                style={{ padding: '0 7px', height: 30, border: 'none', cursor: 'pointer', background: alignRef === 'canvas' ? '#4F46E5' : '#fff', color: alignRef === 'canvas' ? '#fff' : '#6b7280', transition: 'background .15s' }}
                title="Alinear respecto al lienzo"
                onClick={() => setAlignRef('canvas')}
              >Lienzo</button>
              <button
                style={{ padding: '0 7px', height: 30, border: 'none', borderLeft: '1px solid #e5e7eb', cursor: 'pointer', background: alignRef === 'selection' ? '#4F46E5' : '#fff', color: alignRef === 'selection' ? '#fff' : '#6b7280', transition: 'background .15s' }}
                title="Alinear respecto a la selección múltiple"
                onClick={() => setAlignRef('selection')}
              >Objeto</button>
            </div>
            <ToolbarBtn icon="alignLeft"    title="Alinear a la izquierda" onClick={() => alignSelected('left')}    disabled={!selected} />
            <ToolbarBtn icon="alignCenterH" title="Centrar horizontal"     onClick={() => alignSelected('centerH')} disabled={!selected} />
            <ToolbarBtn icon="alignRight"   title="Alinear a la derecha"   onClick={() => alignSelected('right')}   disabled={!selected} />
            <ToolbarBtn icon="alignTop"     title="Alinear arriba"         onClick={() => alignSelected('top')}     disabled={!selected} />
            <ToolbarBtn icon="alignMiddle"  title="Centrar vertical"       onClick={() => alignSelected('middle')}  disabled={!selected} />
            <ToolbarBtn icon="alignBottom"  title="Alinear abajo"          onClick={() => alignSelected('bottom')}  disabled={!selected} />
            <div style={{ flex: 1 }} />
            <div style={s.zoomGroup}>
              {[50, 75, 100, 125].map((z) => (
                <button key={z} style={{ ...s.zoomBtn, ...(zoom === z ? s.zoomActive : {}) }} onClick={() => setZoom(z)}>
                  {z}%
                </button>
              ))}
            </div>
          </div>

          {adjustMode && activePage && (
            <div style={s.adjustBar}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{adjustTarget === 'image' ? 'Ajustar imagen' : 'Ajustar hoja'}</span>
              <span style={{ fontSize: 11, color: '#6b7280' }}>{adjustTarget === 'image' ? 'Arrastra la imagen para moverla' : 'Arrastra la hoja para moverla'}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#6b7280' }}>Zoom</span>
                <input
                  type="range" min={1} max={3} step={0.01} value={coverZoom}
                  onChange={(e) => setCoverZoomValue(parseFloat(e.target.value))}
                  style={{ width: 150 }}
                />
                <span style={{ fontSize: 11, color: '#374151', width: 34 }}>{coverZoom.toFixed(2)}x</span>
              </div>
              <button style={s.adjustReset} onClick={resetCover}>Restablecer</button>
              <button style={s.adjustDone} onClick={() => setAdjustMode(false)}>Listo</button>
            </div>
          )}

          {pages.length > 1 && pages.length % 2 === 1 && !oddWarnDismissed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 8px', padding: '8px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, color: '#92400e', fontSize: 12.5 }}>
              <span style={{ fontSize: 15 }}>⚠️</span>
              <span style={{ flex: 1 }}>
                Tu catálogo tiene <b>{pages.length} páginas (número impar)</b>. En escritorio el flipbook arma las hojas de a pares, así que una quedará sola. Para una mejor presentación, te recomendamos <b>agregar o quitar una página</b> (que quede par).
              </span>
              <button type="button" onClick={() => setOddWarnDismissed(true)} style={{ background: 'none', border: 'none', color: '#92400e', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }} title="Descartar">✕</button>
            </div>
          )}

          <div style={s.canvasWrap}>
            {activePage ? (
              <div
                style={{ position: 'relative', transform: `scale(${zoom / 100})`, transformOrigin: 'top center', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', ...(adjustMode ? { outline: '2px solid #4F46E5', outlineOffset: 2 } : {}) }}
                onContextMenu={onCanvasContextMenu}
              >
                <canvas ref={canvasRef} />
                {canvasLoading && (
                  <div style={s.canvasLoadingOverlay}>
                    <span style={s.canvasLoadingText}>Cargando página...</span>
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{ ...s.canvasEmpty, ...(fileDrag ? { background: 'rgba(79,70,229,0.08)' } : {}) }}
                onDragOver={onFileDragOver} onDragLeave={onFileDragLeave} onDrop={onFileDrop}
                onClick={() => openMediaPicker({ type: 'pages' }, null)}
              >
                <div style={{ marginBottom: 16, opacity: 0.35, color: '#374151' }}><Icon name="image" size={52} /></div>
                <p style={{ color: '#374151', fontSize: 15, fontWeight: 600, textAlign: 'center', maxWidth: 280 }}>
                  Arrastra imágenes aquí o haz clic para subir
                </p>
                <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 8 }}>JPG, PNG o WEBP · múltiples archivos</p>
              </div>
            )}
          </div>

          {/* ── Navegador de páginas ── */}
          {pages.length > 0 && (
            <div style={s.pageNav}>
              <button
                style={{ ...s.pageNavBtn, opacity: activePageIndex <= 0 ? 0.35 : 1 }}
                disabled={activePageIndex <= 0}
                title="Primera página"
                onClick={() => setActivePage(pages[0])}
              >⟸</button>
              <button
                style={{ ...s.pageNavBtn, opacity: activePageIndex <= 0 ? 0.35 : 1 }}
                disabled={activePageIndex <= 0}
                title="Página anterior"
                onClick={() => activePageIndex > 0 && setActivePage(pages[activePageIndex - 1])}
              >◀</button>
              <span style={s.pageNavInfo}>
                Pág {activePageIndex >= 0 ? activePageIndex + 1 : '—'} / {pages.length}
              </span>
              <button
                style={{ ...s.pageNavBtn, opacity: activePageIndex >= pages.length - 1 ? 0.35 : 1 }}
                disabled={activePageIndex >= pages.length - 1}
                title="Página siguiente"
                onClick={() => activePageIndex < pages.length - 1 && setActivePage(pages[activePageIndex + 1])}
              >▶</button>
              <button
                style={{ ...s.pageNavBtn, opacity: activePageIndex >= pages.length - 1 ? 0.35 : 1 }}
                disabled={activePageIndex >= pages.length - 1}
                title="Última página"
                onClick={() => setActivePage(pages[pages.length - 1])}
              >⟹</button>
            </div>
          )}
        </main>

        {/* ── Panel derecho: propiedades o configuración de página ── */}
        <aside ref={rightPanelRef} style={s.right}>
          {selected ? (
            <PropsPanel
              key={selectVersion}
              obj={selected}
              canvas={fabricRef.current}
              pages={pages}
              publicationId={id}
              pageId={activePage?.id}
              onChange={() => { recordCurrentCanvasChange() }}
              onSyncToggle={handleSvgSyncToggle}
              onReframeImage={startImageReframe}
              onToggleHide={toggleHideInEditor}
              openObjectImageReplacement={(obj) => {
                const pageId = pageIdRef.current
                const canvas = fabricRef.current
                if (!pageId || !canvas || !canvas.getObjects?.().includes(obj)) return
                const hadElementId = typeof obj.data?.elementId === 'string' && !!obj.data.elementId
                const elementId = ensureFabricElementIdForPicker(obj)
                if (!hadElementId) recordCurrentCanvasChange()
                openMediaPicker({ type: 'replace-object', pageId, elementId, canvasInstance: canvas })
              }}
              openWidgetGalleryMediaPicker={(obj, request) => {
                const pageId = pageIdRef.current
                if (!pageId) return
                const elementId = ensureFabricElementIdForPicker(obj)
                if (request.type === 'add') {
                  openMediaPicker({ type: 'widget-gallery-add', pageId, elementId, max: request.max })
                  return
                }
                if (request.type === 'field') {
                  openMediaPicker({ type: 'widget-image-field', pageId, elementId, field: request.field })
                  return
                }
                openMediaPicker({ type: 'widget-gallery-replace', pageId, elementId, imageIndex: request.imageIndex })
              }}
              openActionGalleryMediaPicker={(obj, request) => {
                const pageId = pageIdRef.current
                if (!pageId) return
                const elementId = ensureFabricElementIdForPicker(obj)
                if (request.type === 'add') {
                  openMediaPicker({ type: 'action-gallery-add', pageId, elementId, max: request.max })
                  return
                }
                if (request.type === 'field') {
                  if (request.field !== 'image') return
                  openMediaPicker({ type: 'action-image-field', pageId, elementId, field: request.field })
                  return
                }
                openMediaPicker({ type: 'action-gallery-replace', pageId, elementId, imageIndex: request.imageIndex })
              }}
            />
          ) : (
            <div style={s.propsScroll}>
              <div style={s.rightHeader}>Página</div>
              <div style={s.insTabs}>
                <button style={{ ...s.insTabBtn, ...(pagePanelTab === 'config' ? s.insTabActive : {}) }} onClick={() => setPagePanelTab('config')}>Propiedades</button>
                <button style={{ ...s.insTabBtn, ...(pagePanelTab === 'actions' ? s.insTabActive : {}) }} onClick={() => setPagePanelTab('actions')}>Acciones</button>
                <button style={{ ...s.insTabBtn, ...(pagePanelTab === 'dynamic' ? s.insTabActive : {}) }} onClick={() => setPagePanelTab('dynamic')}>Data Dinámica</button>
              </div>
              {pagePanelTab === 'config' && (
                <PageConfig bgColor={bgColor} applyBgColor={applyBgColor} onShowAllHidden={showAllHiddenInEditor} />
              )}
              {pagePanelTab === 'actions' && (
                <div style={s.props}>
                  <p style={cp.hint}>Selecciona un elemento del lienzo para configurar acciones.</p>
                </div>
              )}
              {pagePanelTab === 'dynamic' && (
                <div style={s.props}>
                  <DynamicMarkerPanel
                    publicationId={id}
                    pageId={activePage?.id}
                    selectedObject={null}
                    targetKind={null}
                    ensureElementId={() => null}
                  />
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      <MediaPicker
        open={Boolean(mediaPickerIntent)}
        publicationId={id ?? ''}
        initialFolderId={mediaPickerIntent?.type === 'pages' ? null : mediaPickerInitialFolderId}
        mode={mediaPickerIntent?.type === 'pages' ? 'pages' : mediaPickerIntent?.type === 'svg' ? 'svg' : 'image'}
        multiple={
          mediaPickerIntent?.type === 'insert-images'
          || mediaPickerIntent?.type === 'widget-gallery-add'
          || mediaPickerIntent?.type === 'action-gallery-add'
          || mediaPickerIntent?.type === 'pages'
          || mediaPickerIntent?.type === 'svg'
        }
        title={
          mediaPickerIntent?.type === 'replace-object'
            || mediaPickerIntent?.type === 'widget-gallery-replace'
            || mediaPickerIntent?.type === 'action-gallery-replace'
            || mediaPickerIntent?.type === 'widget-image-field'
            || mediaPickerIntent?.type === 'action-image-field'
            ? 'Reemplazar imagen'
            : mediaPickerIntent?.type === 'pages'
              ? 'Agregar páginas'
              : mediaPickerIntent?.type === 'svg'
                ? 'Insertar SVG editable'
                : mediaPickerIntent?.type === 'widget-gallery-add'
                  || mediaPickerIntent?.type === 'action-gallery-add'
                  ? 'Agregar imágenes'
                  : 'Agregar imagen'
        }
        legacyUrls={imageBank}
        busyMessage={mediaPickerProgress}
        usedPageUrls={pages.map((page) => page.image_url).filter(Boolean)}
        onClose={() => {
          setMediaPickerIntent(null)
          replaceTargetRef.current = null
          void refreshMediaBank()
        }}
        onSelect={handleMediaPickerSelect}
        onRemoveLegacyUrls={removeLegacyUrlsFromBank}
        onPdfSelect={async (file, onProgress) => {
          const result = await importPdfPages(file, onProgress)
          return { confirmedCount: result?.confirmedPages.length ?? 0 }
        }}
        onGoToPages={() => {
          setMediaPickerIntent(null)
          replaceTargetRef.current = null
          setActiveTool('pages')
          setPanelOpen(true)
        }}
        onFolderChange={
          mediaPickerIntent?.type !== 'pages'
            ? rememberMediaPickerFolder
            : undefined
        }
      />

      {/* ── Vista previa de la hoja activa ── */}
      {sheetPreview && <SheetPreviewModal data={sheetPreview} onClose={() => setSheetPreview(null)} />}

      {/* ── Menú contextual (clic derecho) ── */}
      {ctxMenu && (
        <>
          <div style={s.ctxOverlay} onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }} />
          <div style={{ ...s.ctxMenu, left: ctxMenu.x, top: ctxMenu.y }}>
            {selected ? (
              <>
                <CtxItem icon="copy" label="Copiar" onClick={() => { copySelectedToEditorClipboard(); setCtxMenu(null) }} />
                <CtxItem icon="cut" label="Cortar" onClick={() => { cutSelectedToEditorClipboard(); setCtxMenu(null) }} />
                {editorClipboardCount > 0 && <CtxItem icon="paste" label="Pegar" onClick={() => { void pasteFromEditorClipboard(); setCtxMenu(null) }} />}
                <div style={s.ctxSep} />
                <CtxItem icon="duplicate" label="Duplicar"        onClick={() => { duplicateSelected(); setCtxMenu(null) }} />
                <CtxItem icon="trash"     label="Eliminar"        onClick={() => { deleteSelected(); setCtxMenu(null) }} />
                <div style={s.ctxSep} />
                {selected?.type === 'activeSelection' && <CtxItem icon="group" label="Agrupar" onClick={() => { groupSelected(); setCtxMenu(null) }} />}
                {selected?.type === 'group' && <CtxItem icon="ungroup" label="Desagrupar" onClick={() => { ungroupSelected(); setCtxMenu(null) }} />}
                <CtxItem icon="front"    label="Traer al frente" onClick={() => { bringToFront(); setCtxMenu(null) }} />
                <CtxItem icon="forward"  label="Adelantar"       onClick={() => { bringForward(); setCtxMenu(null) }} />
                <CtxItem icon="backward" label="Atrasar"         onClick={() => { sendBackward(); setCtxMenu(null) }} />
                <CtxItem icon="back"     label="Enviar al fondo" onClick={() => { sendToBack(); setCtxMenu(null) }} />
                <div style={s.ctxSep} />
                <CtxItem icon={selected?.data?.locked ? 'unlock' : 'lock'} label={selected?.data?.locked ? 'Desbloquear' : 'Bloquear'} onClick={() => { toggleLock(); setCtxMenu(null) }} />
                <CtxItem icon="eye" label={selected?.data?.hiddenInEditor ? 'Mostrar en lienzo' : 'Ocultar en lienzo'} onClick={() => { toggleHideInEditor(); setCtxMenu(null) }} />
                {selected?.type !== 'activeSelection' &&
                  <CtxItem icon="replace" label={replaceLabel(selected)} onClick={() => { setCtxMenu(null); replaceSelected() }} />}
                <div style={s.ctxSep} />
                <CtxItem icon="alignLeft"    label="Alinear izquierda" onClick={() => { alignSelected('left'); setCtxMenu(null) }} />
                <CtxItem icon="alignCenterH" label="Centrar horizontal" onClick={() => { alignSelected('centerH'); setCtxMenu(null) }} />
                <CtxItem icon="alignRight"   label="Alinear derecha"   onClick={() => { alignSelected('right'); setCtxMenu(null) }} />
                <CtxItem icon="alignTop"     label="Alinear arriba"    onClick={() => { alignSelected('top'); setCtxMenu(null) }} />
                <CtxItem icon="alignMiddle"  label="Centrar vertical"  onClick={() => { alignSelected('middle'); setCtxMenu(null) }} />
                <CtxItem icon="alignBottom"  label="Alinear abajo"     onClick={() => { alignSelected('bottom'); setCtxMenu(null) }} />
              </>
            ) : (
              <>
                <div style={{ padding: '8px 12px', color: '#9ca3af', fontSize: 12 }}>Selecciona un elemento</div>
                <div style={s.ctxSep} />
                {editorClipboardCount > 0 && <CtxItem icon="paste" label="Pegar" onClick={() => { void pasteFromEditorClipboard(); setCtxMenu(null) }} />}
                <CtxItem icon="eye" label="Mostrar todos los ocultos" onClick={() => { setCtxMenu(null); showAllHiddenInEditor() }} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// Etiqueta de la opción "Reemplazar" del menú contextual según el tipo de elemento.
function replaceLabel(sel: any): string {
  const kind = sel?.data?.kind
  if (kind === 'image' || sel?.type === 'image') return 'Reemplazar imagen'
  if (kind === 'icon') return 'Reemplazar icono'
  if (kind === 'svglib') return 'Reemplazar SVG'
  if (kind === 'shape' || ['rect', 'circle', 'triangle', 'path'].includes(sel?.type)) return 'Reemplazar forma'
  if (kind === 'button') return 'Reemplazar botón'
  if (sel?.type === 'i-text' || sel?.type === 'textbox') return 'Reemplazar texto'
  return 'Reemplazar elemento'
}

function CtxItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      style={s.ctxItem}
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <Icon name={icon} size={15} />
      <span>{label}</span>
    </button>
  )
}

// Modal de vista previa de la hoja activa. Renderiza el fondo (con su encuadre
// "cubrir") + un StaticCanvas no editable con los objetos del diseño actual,
// escalado desde el espacio de diseño (CANVAS_W×CANVAS_H) al tamaño del preview.
function SheetPreviewModal({ data, onClose }: { data: { imageUrl: string; cover: any; json: any }; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const PH = Math.min(720, Math.round(window.innerHeight * 0.8))
  const PW = Math.round(PH / 1.414)

  useEffect(() => {
    if (!canvasRef.current) return
    const sc = new fabric.StaticCanvas(canvasRef.current, { width: PW, height: PH, backgroundColor: 'transparent' })
    let disposed = false
    const isCanvasAlive = () => !disposed && !!(sc as any).lowerCanvasEl && !!(sc as any).contextContainer
    // Sin fondo en el canvas: el fondo lo pinta el <img> de abajo (igual que el viewer)
    const objectsOnly = stripBackgroundImage(normalizeFabricAssetJson(Object.assign({}, data.json, { background: '', backgroundImage: null })))
    sc.setZoom(PW / CANVAS_W)
    sc.loadFromJSON(objectsOnly, () => { if (isCanvasAlive()) sc.renderAll() })
    return () => { disposed = true; sc.dispose() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const zoom = Math.max(1, data.cover?.zoom ?? 1)
  const fx = Math.min(1, Math.max(0, data.cover?.fx ?? 0.5))
  const fy = Math.min(1, Math.max(0, data.cover?.fy ?? 0.5))
  const posX = (fx * 100).toFixed(2), posY = (fy * 100).toFixed(2)
  const imgStyle: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
    objectPosition: `${posX}% ${posY}%`, display: 'block',
    ...(zoom > 1.0001 ? { transform: `scale(${zoom})`, transformOrigin: `${posX}% ${posY}%` } : {}),
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 }}
      onClick={onClose}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Vista previa de la hoja</span>
        <button onClick={onClose} style={{ background: '#fff', color: '#111827', border: 'none', borderRadius: 7, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cerrar ✕</button>
      </div>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', width: PW, height: PH, overflow: 'hidden', background: '#fff', borderRadius: 4, boxShadow: '0 12px 48px rgba(0,0,0,0.4)' }}
      >
        <img src={data.imageUrl} alt="" style={imgStyle} />
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
      </div>
      <span style={{ color: '#cbd5e1', fontSize: 11, maxWidth: PW + 80, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
        Vista del diseño actual. Los widgets interactivos (mapa, video, formulario…) se ven en su forma final en la "Vista previa" global del proyecto.
      </span>
    </div>
  )
}

function ToolbarBtn({ icon, title, onClick, disabled, active }: { icon: string; title: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      style={{ ...s.toolBtn, opacity: disabled ? 0.35 : 1, cursor: disabled ? 'default' : 'pointer', ...(active ? { background: '#4F46E5', color: '#fff' } : {}) }}
      title={title} onClick={onClick} disabled={disabled}
    >
      <Icon name={icon} size={18} />
    </button>
  )
}

function BankImageButton({ item, onClick }: { item: { url: string; thumbUrl?: string; name: string; meta: string; folderLabel?: string }; onClick: () => void }) {
  const [failed, setFailed] = useState(false)
  return (
    <button type="button" style={cp.bankItem} title={`${item.name}${item.meta ? ` · ${item.meta}` : ''}`} onClick={onClick}>
      {!failed ? (
        <img
          src={item.thumbUrl || item.url}
          alt={item.name}
          style={cp.bankImg}
          loading="lazy"
          decoding="async"
          onError={() => {
            console.warn('[image-bank] thumbnail failed', item.thumbUrl || item.url)
            setFailed(true)
          }}
        />
      ) : (
        <span style={cp.bankFallback}>{item.meta?.split(' · ')[0] || 'IMG'}</span>
      )}
      {item.folderLabel && <span style={cp.bankFolderBadge}>{item.folderLabel}</span>}
    </button>
  )
}

type PageThumbCardProps = {
  page: any
  index: number
  active: boolean
  shouldLoad: boolean
  backgroundUrl: string
  overlayUrl?: string
  overlayStatus?: PageThumbnailCacheEntry['status']
  onVisible: (pageId: string, index: number) => void
  onSelect: (index: number) => void
  onDragStart: (index: number) => void
  onDrop: (index: number) => void
  onDuplicate: (index: number) => void
  onRefresh: (index: number) => void
  onDelete: (pageId: string) => void
}

const PageThumbCard = React.memo(function PageThumbCard({
  page,
  index,
  active,
  shouldLoad,
  backgroundUrl,
  overlayUrl,
  overlayStatus,
  onVisible,
  onSelect,
  onDragStart,
  onDrop,
  onDuplicate,
  onRefresh,
  onDelete,
}: PageThumbCardProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [bgFailed, setBgFailed] = useState(false)
  const [overlayFailed, setOverlayFailed] = useState(false)
  const [bgLoaded, setBgLoaded] = useState(false)

  useEffect(() => {
    setBgFailed(false)
    setOverlayFailed(false)
    setBgLoaded(false)
  }, [backgroundUrl, overlayUrl])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (typeof IntersectionObserver !== 'function') {
      onVisible(page.id, index)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onVisible(page.id, index)
    }, { rootMargin: '320px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [index, onVisible, page.id])

  const canShowBackground = shouldLoad && !!backgroundUrl && !bgFailed
  const canShowOverlay = shouldLoad && !!overlayUrl && !overlayFailed

  return (
    <div
      ref={ref}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e: React.DragEvent) => e.preventDefault()}
      onDrop={() => onDrop(index)}
      onClick={() => onSelect(index)}
      style={{ ...cp.thumbItem, borderColor: active ? '#4F46E5' : 'transparent' }}
    >
      <div style={cp.thumbSkeleton}>
        {!bgLoaded && <span style={cp.thumbSkeletonText}>Cargando</span>}
      </div>
      {canShowBackground && (
        <img
          src={backgroundUrl}
          alt={`p${index + 1}`}
          style={cp.thumbImg}
          loading="lazy"
          decoding="async"
          onLoad={() => setBgLoaded(true)}
          onError={() => {
            setBgFailed(true)
            setBgLoaded(true)
          }}
        />
      )}
      {canShowOverlay && (
        <img
          src={overlayUrl}
          alt=""
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block', pointerEvents: 'none' }}
          loading="lazy"
          decoding="async"
          onError={() => setOverlayFailed(true)}
        />
      )}
      {overlayStatus === 'error' && (
        <div style={cp.thumbStatus}>!</div>
      )}
      <div style={cp.thumbNum}>{index + 1}</div>
      <button
        title="Duplicar página (copia con todo el contenido)"
        style={{ ...cp.thumbDel, right: 22, background: 'rgba(79,70,229,0.82)', color: '#fff', fontSize: 11 }}
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); onDuplicate(index) }}
      >⧉</button>
      <button
        title="Actualizar miniatura"
        aria-label="Actualizar miniatura"
        style={{ ...cp.thumbDel, right: 44, background: 'rgba(17,24,39,0.85)', color: '#fff', fontSize: 11 }}
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRefresh(index) }}
      >
        <Icon name="refresh" size={11} />
      </button>
      <button style={cp.thumbDel} onClick={(e: React.MouseEvent) => { e.stopPropagation(); onDelete(page.id) }}>x</button>
    </div>
  )
}, pageThumbCardPropsEqual)

function PagesPanel(p: any) {
  const propsRef = useRef(p)
  const initialVisible = useMemo(() => firstVisibleIndexes(p.pages.length), [p.pages.length])
  const [visibleIndexes, setVisibleIndexes] = useState<Set<number>>(initialVisible)

  useEffect(() => {
    propsRef.current = p
  }, [p])

  useEffect(() => {
    setVisibleIndexes((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const index of firstVisibleIndexes(p.pages.length)) {
        if (!next.has(index)) {
          next.add(index)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [p.pages.length])

  const markVisible = useCallback((pageId: string, index: number) => {
    setVisibleIndexes((prev) => {
      if (prev.has(index)) return prev
      const next = new Set(prev)
      next.add(index)
      return next
    })
    const props = propsRef.current
    const page = props.pages[index]
    const cached = props.thumbnailByPageId?.[pageId]
    if (page?.id === pageId && !cached) {
      const isActive = props.activePage?.id === pageId
      props.requestThumbnailUpdate?.(pageId, isActive ? 'live' : 'persisted', { immediate: false, priority: isActive })
    }
  }, [])

  const selectPage = useCallback((index: number) => {
    const page = propsRef.current.pages[index]
    if (page) propsRef.current.setActivePage(page)
  }, [])
  const dragStart = useCallback((index: number) => propsRef.current.onDragStart(index), [])
  const dropPage = useCallback((index: number) => propsRef.current.onDropReorder(index), [])
  const duplicate = useCallback((index: number) => {
    const page = propsRef.current.pages[index]
    if (page) propsRef.current.duplicatePage(page)
  }, [])
  const refresh = useCallback((index: number) => {
    const props = propsRef.current
    const page = props.pages[index]
    if (!page) return
    const isActive = props.activePage?.id === page.id
    props.requestThumbnailUpdate?.(page.id, isActive ? 'live' : 'persisted', { immediate: true, priority: isActive })
  }, [])
  const deletePage = useCallback((pageId: string) => propsRef.current.handleDeletePage(pageId), [])

  return (
    <>
      <PanelTitle title="Páginas" count={p.pages.length} />
      <div
        style={{ ...cp.thumbList, ...(p.fileDrag ? { outline: '2px dashed #818cf8' } : {}) }}
        onDragOver={p.onFileDragOver} onDragLeave={p.onFileDragLeave} onDrop={p.onFileDrop}
      >
        {p.pages.map((page: any, i: number) => {
          const cached = p.thumbnailByPageId[page.id]
          const overlay = resolvePageThumbnailOverlay(page, cached)
          const overlayUrl = overlay.url
          const overlayStatus = overlay.status as PageThumbnailCacheEntry['status'] | undefined
          const shouldLoad = shouldLoadPageThumbnail(i, visibleIndexes)
          return (
            <PageThumbCard
              key={page.id}
              page={page}
              index={i}
              active={p.activePage?.id === page.id}
              shouldLoad={shouldLoad}
              backgroundUrl={resolvePageCardBackgroundUrl(page, p.thumbnailUrlByPublicUrl ?? {}, p.displayUrlByPublicUrl ?? {}, toCanvasSafeAssetUrl) || BLANK_PAGE_URL}
              overlayUrl={overlayUrl}
              overlayStatus={overlayStatus}
              onVisible={markVisible}
              onSelect={selectPage}
              onDragStart={dragStart}
              onDrop={dropPage}
              onDuplicate={duplicate}
              onRefresh={refresh}
              onDelete={deletePage}
            />
          )
        })}
      </div>
      <button style={cp.primaryBtn} onClick={p.openPagePicker} disabled={p.uploading}>
        {p.uploading ? 'Subiendo...' : '+ Agregar páginas (imagen)'}
      </button>
      <button style={cp.secondaryBtn} onClick={p.addBlankPage} disabled={p.uploading}>
        + Página en blanco
      </button>
      <button style={cp.secondaryBtn} onClick={p.openPagePicker} disabled={p.uploading}>
        📄 Importar PDF como páginas
      </button>
      <button
        style={{ ...cp.secondaryBtn, background: '#fef3c7', color: '#92400e', borderColor: '#fde68a', marginTop: 4 }}
        onClick={p.onShowAllHidden}
        title="Muestra todos los elementos marcados como ocultos en este lienzo"
      >
        👁 Mostrar todos los ocultos
      </button>
    </>
  )
}

// ─── Panel contextual según herramienta ──────────────────────────────────────
function ContextPanel(p: any) {
  switch (p.tool) {
    case 'pages':
      return <PagesPanel {...p} />

    case 'templates':
      return (
        <>
          <PanelTitle title="Plantillas" />
          <input
            placeholder="Buscar plantilla..."
            value={p.tplQuery}
            onChange={(e: any) => p.setTplQuery(e.target.value)}
            style={cp.search}
          />
          {p.templates.length === 0 ? (
            <p style={cp.empty}>No hay plantillas disponibles todavía.</p>
          ) : (
            <div style={cp.tplGrid}>
              {p.templates.map((t: any) => (
                <div
                  key={t.id}
                  style={{ ...cp.tplCard, ...(t.locked ? cp.tplCardLocked : {}) }}
                  title={t.locked ? `${t.name} — Requiere plan superior` : `Agregar páginas de ${t.name}`}
                  onClick={t.locked
                    ? () => alert('Esta plantilla requiere un plan superior. Actualiza tu plan para acceder.')
                    : () => p.useTemplate(t)}
                >
                  {t.cover_url
                    ? <img src={t.cover_url} alt={t.name} style={{ ...cp.tplImg, ...(t.locked ? { filter: 'grayscale(60%) opacity(0.7)' } : {}) }} />
                    : <div style={cp.tplPlaceholder}><Icon name="templates" size={26} /></div>}
                  {t.locked && (
                    <div style={cp.tplLockOverlay}>🔒</div>
                  )}
                  <div style={cp.tplName}>{t.name}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )

    case 'text':
      return (
        <>
          <PanelTitle title="Texto" />
          <div style={cp.stack}>
            {TEXT_PRESETS.map((preset) => (
              <button key={preset.label} style={cp.listBtn} onClick={() => p.addText(preset.opts)}>
                <span style={{ fontSize: Math.min(preset.opts.fontSize as number, 22), fontWeight: preset.opts.fontWeight as any, fontFamily: p.defaultFont }}>Aa</span>
                {preset.label}
              </button>
            ))}
          </div>

          <div style={cp.sectionLabel}>Tipografías</div>
          <p style={cp.hint}>Elegí una fuente y luego agregá texto, o seleccioná un texto y cambiá su tipografía aquí.</p>
          <div style={cp.fontList}>
            {FONTS.map((f) => (
              <button
                key={f.name}
                onClick={() => p.setDefaultFont(f.family)}
                style={{ ...cp.fontBtn, ...(p.defaultFont === f.family ? cp.fontBtnActive : {}) }}
              >
                <span style={{ fontFamily: f.family, fontSize: 22 }}>Aa</span>
                <span style={cp.fontName}>{f.name}</span>
              </button>
            ))}
          </div>
        </>
      )

    case 'image':
    case 'uploads':
      return (
        <>
          <PanelTitle title={p.tool === 'image' ? 'Imagen' : 'Cargas'} />
          <button style={cp.primaryBtn} onClick={p.openImagePicker} disabled={!p.activePage}>
            Seleccionar imagen
          </button>
          <p style={{ fontSize: 11, color: '#9ca3af', margin: '-4px 0 6px' }}>Elegí una imagen del banco del proyecto o subila desde el equipo.</p>
          <p style={cp.hint}>La imagen se agrega como elemento editable sobre la página actual. Podés moverla, escalarla y asignarle una acción.</p>
          <div style={{ height: 1, background: '#f3f4f6', margin: '14px 0' }} />
          <button style={cp.primaryBtn} onClick={p.openSvgPicker} disabled={p.uploading}>
            🎨 Insertar SVG editable
          </button>
          <p style={cp.hint}>Importá un archivo .svg — cada forma se convierte en un elemento independiente que podés mover, colorear y escalar.</p>
          <div style={{ height: 1, background: '#f3f4f6', margin: '14px 0' }} />
          {/* Agregar como nueva página del flipbook */}
          <button style={{ ...cp.primaryBtn, background: '#64748b' }} onClick={p.openPagePicker} disabled={p.uploading}>
            {p.uploading ? 'Subiendo...' : '+ Agregar como nueva página'}
          </button>
          <p style={cp.hint}>Agrega la imagen como página nueva del flipbook (igual que en el panel Páginas).</p>

          <div style={cp.sectionLabel}>Mis imágenes ({p.imageBankTotal ?? p.imageBankItems?.length ?? 0})</div>
          <div style={cp.bankFolderNav}>
            <button
              type="button"
              style={{ ...cp.bankFolderBtn, ...(p.mediaBankFolderId === undefined ? cp.bankFolderActive : {}) }}
              onClick={() => p.setMediaBankFolderId(undefined)}
            >
              Todas
            </button>
            <button
              type="button"
              style={{ ...cp.bankFolderBtn, ...(p.mediaBankFolderId === null ? cp.bankFolderActive : {}) }}
              onClick={() => p.setMediaBankFolderId(null)}
            >
              Banco general
            </button>
            {p.mediaBankFolders?.map((folder: MediaFolder) => (
              <button
                key={folder.id}
                type="button"
                style={{ ...cp.bankFolderBtn, ...(p.mediaBankFolderId === folder.id ? cp.bankFolderActive : {}) }}
                onClick={() => p.setMediaBankFolderId(folder.id)}
              >
                {folder.name} ({folder.asset_count})
              </button>
            ))}
          </div>
          {p.oldImagesPendingOptimization > 0 && (
            <div style={cp.legacyOptimizeBox}>
              <div style={cp.legacyOptimizeTop}>
                <span>{p.oldImagesPendingOptimization} pendientes sin miniatura ligera</span>
                {p.legacyOptimization?.running ? (
                  <button type="button" style={cp.bankMoreBtn} onClick={p.cancelLegacyOptimization}>
                    Cancelar
                  </button>
                ) : (
                  <button type="button" style={cp.bankMoreBtn} onClick={p.optimizeLegacyImages}>
                    Optimizar imágenes antiguas
                  </button>
                )}
              </div>
              {p.legacyOptimization?.message && <p style={cp.hint}>{p.legacyOptimization.message}</p>}
            </div>
          )}
          {p.imageBankItems?.length ? (
            <>
              <div style={cp.bankGrid}>
                {p.imageBankItems.map((item: any) => (
                  <div key={item.key} style={cp.bankItemWrap}>
                    <BankImageButton item={item} onClick={() => p.insertImageFromBank(item.url)} />
                  </div>
                ))}
              </div>
              <button type="button" style={cp.bankMoreBtn} onClick={p.openImagePicker}>
                Ver más en el banco
              </button>
            </>
          ) : (
            <p style={cp.hint}>Todavía no hay imágenes en el banco del proyecto.</p>
          )}
        </>
      )

    case 'shapes':
      return (
        <>
          <PanelTitle title="Formas" />
          <div style={cp.shapeGrid}>
            <ShapeBtn icon="rect"     label="Rectángulo" onClick={() => p.addShape('rect')} />
            <ShapeBtn icon="circle"   label="Círculo"    onClick={() => p.addShape('circle')} />
            <ShapeBtn icon="circle"   label="Elipse"     onClick={() => p.addShape('ellipse')} />
            <ShapeBtn icon="triangle" label="Triángulo"  onClick={() => p.addShape('triangle')} />
            <ShapeBtn icon="line"     label="Línea"      onClick={() => p.addShape('line')} />
            <ShapeBtn icon="star"     label="Estrella"   onClick={() => p.addShape('star')} />
          </div>
        </>
      )

    case 'buttons': {
      // Acordeón por familia — cada familia empieza contraída.
      // "useState en un case" no se puede directamente; usamos un componente interno.
      const BtnIconAccordion = () => {
        const [openFam, setOpenFam] = React.useState<string | null>(null)
        const all = p.svgLib as any[]
        // Agrupar por familia (igual que en Biblioteca)
        const groups: { name: string; items: any[] }[] = []
        all.forEach((it) => {
          const fname = it.family_name || 'Sin familia'
          let g = groups.find((x) => x.name === fname)
          if (!g) { g = { name: fname, items: [] }; groups.push(g) }
          g.items.push(it)
        })
        groups.sort((a, b) => a.name === 'Sin familia' ? 1 : b.name === 'Sin familia' ? -1 : a.name.localeCompare(b.name))
        if (groups.length === 0) return null
        return (
          <>
            <div style={cp.sectionLabel}>Botón con ícono SVG</div>
            <p style={cp.hint}>Selecciona una familia, elige un ícono y se creará un botón listo para configurar.</p>
            {groups.map((g) => (
              <div key={g.name} style={{ marginBottom: 4 }}>
                <button
                  style={{ width: '100%', textAlign: 'left', background: openFam === g.name ? '#f0f0ff' : '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 7, padding: '7px 10px', fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => setOpenFam(openFam === g.name ? null : g.name)}
                >
                  <span>{g.name}</span>
                  <span style={{ fontSize: 10, color: '#9ca3af' }}>{openFam === g.name ? '▲' : '▼'} {g.items.length}</span>
                </button>
                {openFam === g.name && (
                  <div style={{ ...cp.iconGrid, marginTop: 6, marginBottom: 6 }}>
                    {g.items.map((it) => (
                      <button
                        key={it.id}
                        title={it.locked ? (it.upgrade_message || `Requiere plan ${it.required_plan ?? 'superior'}`) : it.name}
                        style={{ ...cp.iconBtn, position: 'relative', opacity: it.locked ? 0.55 : 1 }}
                        onClick={() => p.addButtonWithIcon(it)}
                      >
                        {it.svg_url
                          ? <img src={it.svg_url} alt={it.name} style={{ width: 28, height: 28, objectFit: 'contain' }} loading="lazy" />
                          : <span style={{ fontSize: 20 }}>🔒</span>}
                        <span style={cp.iconName}>{it.name}</span>
                        {it.locked && <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 11 }}>🔒</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )
      }
      return (
        <>
          <PanelTitle title="Botones" />
          <p style={cp.hint}>Agrega un botón y configura su acción y estilo en el panel derecho.</p>
          <div style={cp.btnList}>
            {BUTTON_PRESETS.map((b) => (
              <button
                key={b.label}
                style={{
                  ...cp.previewBtn,
                  ...(b.variant === 'outline'
                    ? { background: '#fff', color: '#4F46E5', border: '2px solid #4F46E5' }
                    : { background: '#4F46E5', color: '#fff', border: 'none' }),
                  borderRadius: b.variant === 'pill' ? 23 : 8,
                }}
                onClick={() => p.addButton(b)}
              >
                {b.label}
              </button>
            ))}
          </div>
          <BtnIconAccordion />
        </>
      )
    }

    case 'elements':
      return (
        <>
          <PanelTitle title="Elementos" />
          <p style={cp.hint}>Iconos, figuras y señales para catálogos, menús y portafolios. Hacé clic para agregarlos al diseño.</p>
          {ICON_LIBRARY.map((cat) => (
            <div key={cat.category}>
              <div style={cp.sectionLabel}>{cat.category}</div>
              <div style={cp.iconGrid}>
                {cat.items.map((it) => (
                  <button key={it.label} title={it.label} style={cp.iconBtn} onClick={() => p.addIcon(it.svg)}>
                    <svg width={26} height={26} viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: it.svg }} />
                    <span style={cp.iconName}>{it.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div style={cp.sectionLabel}>Puntos activos animados</div>
          <p style={cp.hint}>Indicadores que parpadean/pulsan en la publicación para llamar la atención del visitante. Configurá su acción en el panel derecho.</p>
          <div style={cp.iconGrid}>
            {([
              { style: 'pulse',  label: 'Pulso',     color: '#4F46E5' },
              { style: 'blink',  label: 'Parpadeo',  color: '#ef4444' },
              { style: 'ripple', label: 'Onda',       color: '#059669' },
            ] as const).map((h) => (
              <button key={h.style} style={cp.iconBtn} onClick={() => p.addHotspot(h.style)}>
                <span style={{ width: 24, height: 24, borderRadius: '50%', background: h.color, display: 'inline-block', boxShadow: `0 0 0 5px ${h.color}44` }} />
                <span style={cp.iconName}>{h.label}</span>
              </button>
            ))}
          </div>
        </>
      )

    case 'svglib': {
      const all = p.svgLib as any[]
      // Lista de familias presentes (únicas), ordenadas alfabéticamente.
      const familyNames = Array.from(
        new Set(all.map((it) => it.family_name).filter(Boolean))
      ).sort() as string[]
      const hasNoFamily = all.some((it) => !it.family_name)

      const q = (p.svgLibQuery || '').toLowerCase()
      const filtered = all.filter((it) => {
        if (q && !it.name?.toLowerCase().includes(q) &&
            !(it.tags ?? []).some((t: string) => t.toLowerCase().includes(q))) return false
        if (p.svgLibFamily) {
          if (p.svgLibFamily === '__none__') return !it.family_name
          return it.family_name === p.svgLibFamily
        }
        return true
      })

      // Agrupar por familia para mostrar encabezados de sección.
      const groups: { name: string; items: any[] }[] = []
      const pushTo = (name: string, it: any) => {
        let g = groups.find((x) => x.name === name)
        if (!g) { g = { name, items: [] }; groups.push(g) }
        g.items.push(it)
      }
      filtered.forEach((it) => pushTo(it.family_name || 'Sin familia', it))
      groups.sort((a, b) => a.name === 'Sin familia' ? 1 : b.name === 'Sin familia' ? -1 : a.name.localeCompare(b.name))

      return (
        <>
          <PanelTitle title="Biblioteca SVG" />
          <p style={cp.hint}>Íconos vectoriales editables. Hacé clic para insertarlos en la página. Los marcados con 🔒 requieren un plan superior. Al seleccionar un SVG en el canvas, activa "Sincronizar en páginas" desde el panel derecho.</p>
          <input
            style={cp.search}
            placeholder="Buscar por nombre o etiqueta…"
            value={p.svgLibQuery}
            onChange={(e) => p.setSvgLibQuery(e.target.value)}
          />
          {familyNames.length > 0 && (
            <select
              style={{ ...cp.search, marginTop: -4 }}
              value={p.svgLibFamily}
              onChange={(e) => p.setSvgLibFamily(e.target.value)}
            >
              <option value="">Todas las familias</option>
              {familyNames.map((fn) => <option key={fn} value={fn}>{fn}</option>)}
              {hasNoFamily && <option value="__none__">Sin familia</option>}
            </select>
          )}
          {!p.svgLibLoaded ? (
            <p style={cp.hint}>Cargando biblioteca…</p>
          ) : filtered.length === 0 ? (
            <p style={cp.hint}>No hay íconos para este filtro. El administrador puede agregar más desde el panel "Biblioteca SVG".</p>
          ) : (
            groups.map((g) => (
              <div key={g.name}>
                <div style={cp.sectionLabel}>{g.name}</div>
                <div style={cp.iconGrid}>
                  {g.items.map((it) => (
                    <button
                      key={it.id}
                      title={it.locked ? (it.upgrade_message || `Requiere plan ${it.required_plan ?? 'superior'}`) : it.name}
                      style={{ ...cp.iconBtn, position: 'relative', opacity: it.locked ? 0.55 : 1 }}
                      onClick={() => p.addSvgFromLibrary(it)}
                    >
                      {it.svg_url
                        ? <img src={it.svg_url} alt={it.name} style={{ width: 30, height: 30, objectFit: 'contain' }} loading="lazy" />
                        : <span style={{ fontSize: 22 }}>🔒</span>}
                      <span style={cp.iconName}>{it.name}</span>
                      {it.locked && <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 11 }}>🔒</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )
    }

    case 'link':
      return (
        <>
          <PanelTitle title="Enlace" />
          <button style={cp.primaryBtn} onClick={p.addLinkZone}>+ Zona clicable</button>
          <p style={cp.hint}>Crea un área transparente sobre la página. Selecciónala y define su acción en el panel derecho (enlace, ir a página, llamar, etc.).</p>
        </>
      )

    case 'widgets':
      return (
        <>
          <PanelTitle title="Widgets" />
          <p style={cp.hint}>Elementos interactivos. Se agregan al diseño y se configuran en el panel derecho; el visor los muestra en vivo.</p>
          <div style={cp.shapeGrid}>
            {WIDGETS.map((w) => (
              <button
                key={w.type}
                style={{ ...cp.widgetCard, opacity: w.premium ? 0.6 : 1, cursor: 'pointer' }}
                title={w.premium ? 'Función premium' : w.label}
                onClick={() => p.addWidget(w)}
              >
                <Icon name={w.icon} size={22} />
                <span style={cp.widgetLabel}>{w.label}</span>
                {w.premium && <span style={cp.crown}>★</span>}
              </button>
            ))}
          </div>
        </>
      )

    default:
      return null
  }
}

function PanelTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div style={cp.title}>
      <span>{title}</span>
      {count !== undefined && <span style={cp.titleCount}>{count}</span>}
    </div>
  )
}

function ShapeBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  const [hover, setHover] = React.useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...cp.shapeBtn, background: hover ? '#f1f5f9' : '#fff' }}
    >
      <Icon name={icon} size={24} />
      <span style={cp.shapeLabel}>{label}</span>
    </button>
  )
}

// ─── Configuración de página (panel derecho cuando no hay selección) ──────────
function PageConfig({ bgColor, applyBgColor, onShowAllHidden }: { bgColor: string; applyBgColor: (c: string, all?: boolean) => void; onShowAllHidden?: () => void }) {
  return (
    <div style={{ padding: 16, overflowY: 'auto', flex: 1, minHeight: 0 }}>
      <div style={s.rightHeader}>Configuración de página</div>

      {onShowAllHidden && (
        <button
          onClick={onShowAllHidden}
          style={{ width: '100%', marginBottom: 16, padding: '8px 12px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
          title="Muestra todos los elementos marcados como ocultos en este lienzo"
        >
          <span>👁</span> Mostrar todos los ocultos
        </button>
      )}

      <CfgGroup label="Tamaño de página">
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={cfg.sizeBox}><span style={cfg.sizeLabel}>A</span> 580</div>
          <div style={cfg.sizeBox}><span style={cfg.sizeLabel}>A</span> 820</div>
        </div>
      </CfgGroup>

      <CfgGroup label="Esquemas de color">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {COLOR_SCHEMES.map((sc) => (
            <div key={sc.name} style={cfg.scheme}>
              <div style={{ display: 'flex', gap: 3 }}>
                {sc.colors.map((c) => (
                  <span key={c} onClick={() => applyBgColor(c)} style={{ ...cfg.swatch, background: c }} />
                ))}
              </div>
              <span style={cfg.schemeName}>{sc.name}</span>
            </div>
          ))}
        </div>
      </CfgGroup>

      <CfgGroup label="Fondo">
        <input
          type="color"
          value={bgColor}
          onChange={(e) => applyBgColor(e.target.value)}
          style={{ width: '100%', height: 36, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}
        />
        <button style={cfg.applyAll} onClick={() => applyBgColor(bgColor, true)}>Aplicar a todas las páginas</button>
      </CfgGroup>
    </div>
  )
}

function CfgGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={cfg.groupLabel}>{label}</div>
      {children}
    </div>
  )
}

// ─── Panel de propiedades del elemento seleccionado ───────────────────────────
// Cambia según el tipo: texto, forma, botón, imagen o zona de enlace.
function PropsPanel({
  obj,
  canvas,
  pages,
  publicationId,
  pageId,
  onChange,
  onSyncToggle,
  onReframeImage,
  onToggleHide,
  openObjectImageReplacement,
  openWidgetGalleryMediaPicker,
  openActionGalleryMediaPicker,
}: {
  obj: any
  canvas: any
  pages: any[]
  publicationId?: string
  pageId?: string
  onChange: () => void
  onSyncToggle?: (enabled: boolean) => void
  onReframeImage?: (o: any) => void
  onToggleHide?: () => void
  openObjectImageReplacement?: (obj: FabricObjectInstance) => void
  openWidgetGalleryMediaPicker?: (obj: FabricObjectInstance, request: Parameters<OpenWidgetGalleryMediaPicker>[0]) => void
  openActionGalleryMediaPicker?: (obj: FabricObjectInstance, request: Parameters<OpenWidgetGalleryMediaPicker>[0]) => void
}) {
  const kind: string = (obj as any).data?.kind
    ?? (obj instanceof fabric.Textbox || obj instanceof fabric.Text ? 'text' : 'shape')

  const [, setTick] = React.useState(0)
  const set = (props: any) => { obj.set(props); canvas?.requestRenderAll(); onChange(); setTick((t) => t + 1) }
  const setData = (patch: any) => { (obj as any).data = { ...((obj as any).data ?? {}), ...patch }; onChange(); setTick((t) => t + 1) }
  const ensureElementId = () => {
    const existing = (obj as any).data?.elementId
    if (existing) return existing
    const elementId = createFabricElementId()
    setData({ elementId })
    return elementId
  }
  const [closeWarning, setCloseWarning] = React.useState('')

  const fill = typeof obj.fill === 'string' ? obj.fill : '#4f46e5'
  const titleMap: Record<string, string> = { text: 'Texto', shape: 'Forma', button: 'Botón', linkzone: 'Zona de enlace', image: 'Imagen', icon: 'Icono', widget: 'Widget', hotspot: 'Punto activo', svglib: 'Gráfico SVG' }

  // Inspector con pestañas: Propiedades (estilo/posición), Acciones e información dinámica.
  const [insTab, setInsTab] = React.useState<'config' | 'actions' | 'dynamic'>('config')
  const isWidget = kind === 'widget'

  // Elementos de esta página que tienen nombre asignado (excepto el actual): posibles
  // objetivos para la acción "Mostrar / ocultar". Se muestra el nombre, se guarda el elementId.
  const namedTargets = (canvas?.getObjects?.() ?? [])
    .filter((o: any) => o !== obj && o.data?.name && o.data?.elementId)
    .map((o: any) => ({ id: o.data.elementId as string, name: o.data.name as string }))

  const closeDefaults = {
    showCloseButton: true,
    closeOnOutsideClick: false,
    closeOnPageChange: false,
    closeOnTimer: false,
    timerSeconds: 5,
  }
  const closeKeys = ['showCloseButton', 'closeOnOutsideClick', 'closeOnPageChange', 'closeOnTimer']
  const rawCloseOptions = isWidget ? (obj as any).data?.widget?.config?.closeOptions : (obj as any).data?.closeOptions
  const hasCustomCloseOptions = !!rawCloseOptions
  const closeCfg = { ...closeDefaults, ...(rawCloseOptions ?? {}) }
  const activeCloseCount = closeKeys.filter((k) => !!(closeCfg as any)[k]).length
  const writeCloseOptions = (next: any | null) => {
    const data = { ...((obj as any).data ?? {}) }
    if (isWidget) {
      const widget = { ...(data.widget ?? { type: 'map', config: {} }) }
      const config = { ...(widget.config ?? {}) }
      if (next) config.closeOptions = next
      else delete config.closeOptions
      widget.config = config
      data.widget = widget
    } else {
      if (next) data.closeOptions = next
      else delete data.closeOptions
    }
    ;(obj as any).data = data
    onChange()
    setTick((t) => t + 1)
  }
  const setCustomCloseEnabled = (enabled: boolean) => {
    setCloseWarning('')
    writeCloseOptions(enabled ? closeDefaults : null)
  }
  const setCloseOption = (key: string, value: boolean | number) => {
    if (typeof value === 'boolean' && !value && closeKeys.includes(key) && activeCloseCount <= 1 && (closeCfg as any)[key]) {
      setCloseWarning('Activa al menos una forma de cierre para usar opciones personalizadas.')
      return
    }
    setCloseWarning('')
    writeCloseOptions({ ...closeCfg, [key]: value })
  }

  return (
    <div style={s.propsScroll}>
      <div style={s.rightHeader}>{titleMap[kind] ?? 'Elemento'}</div>

      {/* Pestañas del inspector */}
      <div style={s.insTabs}>
        <button style={{ ...s.insTabBtn, ...(insTab === 'config' ? s.insTabActive : {}) }} onClick={() => setInsTab('config')}>Propiedades</button>
        <button style={{ ...s.insTabBtn, ...(insTab === 'actions' ? s.insTabActive : {}) }} onClick={() => setInsTab('actions')}>Acciones</button>
        <button style={{ ...s.insTabBtn, ...(insTab === 'dynamic' ? s.insTabActive : {}) }} onClick={() => setInsTab('dynamic')}>Data Dinámica</button>
      </div>

      {insTab === 'config' && (
      <div style={s.props}>

        {/* Posición — común a todos */}
        <PropGroup label="Posición (X / Y)">
          <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 16px 1fr', gap: 6, alignItems: 'center' }}>
            <span style={s.axisLabel}>X</span>
            <input style={s.propInput} type="number" defaultValue={Math.round(obj.left ?? 0)} onChange={(e) => set({ left: +e.target.value })} />
            <span style={s.axisLabel}>Y</span>
            <input style={s.propInput} type="number" defaultValue={Math.round(obj.top ?? 0)} onChange={(e) => set({ top: +e.target.value })} />
          </div>
        </PropGroup>

        {/* Tamaño — ancho/alto en pantalla (vía escala del objeto) */}
        <PropGroup label="Tamaño (Ancho / Alto)">
          <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 16px 1fr', gap: 6, alignItems: 'center' }}>
            <span style={s.axisLabel}>A</span>
            <input style={s.propInput} type="number" min={4} defaultValue={Math.round(obj.getScaledWidth?.() ?? obj.width ?? 0)} onChange={(e) => {
              const w = +e.target.value; if (w > 0 && obj.width) { obj.set('scaleX', w / obj.width); canvas?.requestRenderAll(); onChange() }
            }} />
            <span style={s.axisLabel}>H</span>
            <input style={s.propInput} type="number" min={4} defaultValue={Math.round(obj.getScaledHeight?.() ?? obj.height ?? 0)} onChange={(e) => {
              const h = +e.target.value; if (h > 0 && obj.height) { obj.set('scaleY', h / obj.height); canvas?.requestRenderAll(); onChange() }
            }} />
          </div>
        </PropGroup>

        <PropGroup label="Rotación (grados)">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="range" min={0} max={360} step={1} defaultValue={Math.round(obj.angle ?? 0)} onChange={(e) => set({ angle: +e.target.value })} style={{ flex: 1 }} />
            <input style={{ ...s.propInput, width: 56 }} type="number" min={0} max={360} defaultValue={Math.round(obj.angle ?? 0)} onChange={(e) => set({ angle: +e.target.value })} />
          </div>
        </PropGroup>

        <PropGroup label="Opacidad">
          <input type="range" min={0} max={1} step={0.05} defaultValue={obj.opacity ?? 1} onChange={(e) => set({ opacity: +e.target.value })} style={{ width: '100%' }} />
        </PropGroup>

        {/* Sombra — universal para cualquier elemento */}
        <ShadowControl obj={obj} canvas={canvas} onChange={onChange} />

        {/* Animación continua (loop) — se reproduce en la vista previa y en el publicado */}
        <AnimationControl obj={obj} setData={setData} />

        {/* Animación de ENTRADA (estilo PowerPoint) — se reproduce al mostrarse la página */}
        <EntranceControl obj={obj} setData={setData} />

        {/* Nombre amigable del elemento. Internamente se le asigna un elementId único
            e inmutable (no editable) para que otra acción pueda apuntarlo de forma segura
            aunque dos elementos compartan el mismo nombre visible. */}
        <PropGroup label="Nombre del elemento">
          <input
            style={s.propInput}
            placeholder="ej: Precio apartamento"
            defaultValue={(obj as any).data?.name ?? ''}
            onChange={(e) => {
              const name = e.target.value
              const existing = (obj as any).data?.elementId
              setData({ name, elementId: existing || createFabricElementId() })
            }}
          />
          <p style={cp.hint}>Asígnale un nombre para poder mostrarlo u ocultarlo desde un botón o zona (acción "Mostrar / ocultar elemento").</p>
        </PropGroup>

        <PropGroup label="Visibilidad inicial">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#374151' }}>
            <input
              type="checkbox"
              checked={!!(obj as any).data?.startHidden}
              onChange={(e) => setData({ startHidden: e.target.checked })}
            />
            Empieza oculto (se revela al hacer clic en el disparador)
          </label>
        </PropGroup>

        <PropGroup label="Opciones de cierre">
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={hasCustomCloseOptions}
              onChange={(e) => setCustomCloseEnabled(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>Usar opciones de cierre personalizadas al mostrar este elemento</span>
          </label>
          {hasCustomCloseOptions && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, paddingLeft: 22 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!closeCfg.showCloseButton} onChange={(e) => setCloseOption('showCloseButton', e.target.checked)} /> Mostrar X para cerrar
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!closeCfg.closeOnOutsideClick} onChange={(e) => setCloseOption('closeOnOutsideClick', e.target.checked)} /> Cerrar al hacer clic fuera
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!closeCfg.closeOnPageChange} onChange={(e) => setCloseOption('closeOnPageChange', e.target.checked)} /> Cerrar al cambiar de página
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!closeCfg.closeOnTimer} onChange={(e) => setCloseOption('closeOnTimer', e.target.checked)} /> Cerrar automáticamente después de un tiempo
              </label>
              {closeCfg.closeOnTimer && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input style={{ ...s.propInput, width: 80 }} type="number" min={1} max={3600} value={closeCfg.timerSeconds} onChange={(e) => setCloseOption('timerSeconds', Math.max(1, +e.target.value || 1))} />
                  <span style={{ fontSize: 12, color: '#6b7280' }}>segundos</span>
                </div>
              )}
            </div>
          )}
          {closeWarning && <p style={{ ...cp.hint, color: '#b45309', marginTop: 8 }}>{closeWarning}</p>}
          <p style={cp.hint}>Sin opciones personalizadas, Mostrar/Ocultar conserva su cierre heredado. Estas opciones solo aplican cuando este elemento se abre mediante esa acción.</p>
        </PropGroup>

        <PropGroup label="Visibilidad en el lienzo">
          {(obj as any).data?.hiddenInEditor ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef3c7', borderRadius: 8, padding: '7px 10px', border: '1px solid #fbbf24' }}>
                <span style={{ fontSize: 15 }}>👁</span>
                <span style={{ fontSize: 12, color: '#92400e', fontWeight: 600, flex: 1 }}>Oculto en el lienzo — visible en producción</span>
              </div>
              <button
                type="button"
                style={{ ...s.alignBtn, fontSize: 12, color: '#047857', borderColor: '#6ee7b7', background: '#ecfdf5' }}
                onClick={() => { onToggleHide?.() }}
              >👁 Mostrar en lienzo</button>
            </div>
          ) : (
            <button
              type="button"
              style={{ ...s.alignBtn, fontSize: 12, width: '100%' }}
              onClick={() => { onToggleHide?.() }}
            >🚫 Ocultar en lienzo (no afecta la publicación)</button>
          )}
          <p style={cp.hint}>Útil cuando hay elementos superpuestos — podés ocultarlos mientras diseñás sin que desaparezcan del flipbook publicado.</p>
        </PropGroup>

        {/* ── TEXTO ── */}
        {kind === 'text' && (
          <>
            <PropGroup label="Contenido">
              <textarea style={{ ...s.propInput, height: 64, resize: 'vertical' } as any} defaultValue={(obj as any).text ?? ''} onChange={(e) => { (obj as any).set('text', e.target.value); canvas?.requestRenderAll(); onChange() }} />
            </PropGroup>
            <PropGroup label="Tipografía">
              <select style={s.propInput} value={(obj as any).fontFamily ?? FONTS[0].family} onChange={(e) => set({ fontFamily: e.target.value })}>
                {FONTS.map((f) => <option key={f.name} value={f.family} style={{ fontFamily: f.family }}>{f.name}</option>)}
              </select>
            </PropGroup>
            <PropGroup label="Tamaño de fuente">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button style={s.stepBtn} onClick={() => { const v = Math.max(6, ((obj as any).fontSize ?? 24) - 2); set({ fontSize: v }); }}>−</button>
                <input style={{ ...s.propInput, textAlign: 'center' }} type="number" min={6} max={300} value={(obj as any).fontSize ?? 24} onChange={(e) => set({ fontSize: +e.target.value })} />
                <button style={s.stepBtn} onClick={() => { const v = Math.min(300, ((obj as any).fontSize ?? 24) + 2); set({ fontSize: v }); }}>+</button>
              </div>
            </PropGroup>
            <PropGroup label="Estilo">
              <div style={{ display: 'flex', gap: 6 }}>
                <StyleToggle active={(obj as any).fontWeight === 'bold'} onClick={() => set({ fontWeight: (obj as any).fontWeight === 'bold' ? 'normal' : 'bold' })} label="B" bold />
                <StyleToggle active={(obj as any).fontStyle === 'italic'} onClick={() => set({ fontStyle: (obj as any).fontStyle === 'italic' ? 'normal' : 'italic' })} label="I" italic />
                <StyleToggle active={(obj as any).underline} onClick={() => set({ underline: !(obj as any).underline })} label="U" underline />
                <StyleToggle active={(obj as any).linethrough} onClick={() => set({ linethrough: !(obj as any).linethrough })} label="S" />
              </div>
            </PropGroup>
            <PropGroup label="Mayúsculas / minúsculas">
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={s.alignBtn} title="MAYÚSCULAS" onClick={() => { set({ text: String((obj as any).text ?? '').toUpperCase() }); }}>AA</button>
                <button style={s.alignBtn} title="minúsculas" onClick={() => { set({ text: String((obj as any).text ?? '').toLowerCase() }); }}>aa</button>
                <button style={s.alignBtn} title="Capitalizar Cada Palabra" onClick={() => { set({ text: String((obj as any).text ?? '').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase()) }); }}>Aa</button>
              </div>
            </PropGroup>
            <PropGroup label="Alineación">
              <div style={{ display: 'flex', gap: 6 }}>
                {['left', 'center', 'right', 'justify'].map((a) => (
                  <button key={a} style={{ ...s.alignBtn, ...((obj as any).textAlign === a ? s.alignActive : {}) }} onClick={() => set({ textAlign: a })}>
                    {a === 'left' ? '⟸' : a === 'center' ? '≡' : a === 'right' ? '⟹' : '☰'}
                  </button>
                ))}
              </div>
            </PropGroup>
            <FillControl obj={obj} canvas={canvas} onChange={onChange} defaultColor="#111827" />
            <PropGroup label="Resaltado (fondo del texto)">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" value={(typeof (obj as any).textBackgroundColor === 'string' && (obj as any).textBackgroundColor) || '#ffff00'} onChange={(e) => set({ textBackgroundColor: e.target.value })} style={s.colorInput} />
                <button style={{ ...s.alignBtn, flex: 1 }} onClick={() => set({ textBackgroundColor: '' })}>Sin resaltado</button>
              </div>
            </PropGroup>
            <PropGroup label="Espaciado entre letras">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="range" min={-100} max={800} step={10} value={(obj as any).charSpacing ?? 0} onChange={(e) => set({ charSpacing: +e.target.value })} style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: '#6b7280', width: 36, textAlign: 'right' }}>{(obj as any).charSpacing ?? 0}</span>
              </div>
            </PropGroup>
            <PropGroup label="Interlineado (espaciado de líneas)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="range" min={0.6} max={3} step={0.1} value={(obj as any).lineHeight ?? 1.16} onChange={(e) => set({ lineHeight: +e.target.value })} style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: '#6b7280', width: 36, textAlign: 'right' }}>{((obj as any).lineHeight ?? 1.16).toFixed(1)}</span>
              </div>
            </PropGroup>
            <PropGroup label="Lista con viñetas">
              <button style={{ ...s.alignBtn, width: '100%' }} onClick={() => {
                const t = String((obj as any).text ?? '')
                const lines = t.split('\n')
                const allBulleted = lines.every((l) => l.trim() === '' || l.startsWith('• '))
                const next = lines.map((l) => l.trim() === '' ? l : (allBulleted ? l.replace(/^•\s/, '') : '• ' + l)).join('\n')
                set({ text: next })
              }}>• Alternar viñetas</button>
            </PropGroup>
            {(obj as any).type === 'textbox' && (
              <PropGroup label="Cuadro de texto">
                <p style={cp.hint}>Arrastra los tiradores laterales para cambiar el ancho: el texto se reajusta dentro del cuadro (no se deforma). Usa Enter en el contenido para separar párrafos.</p>
              </PropGroup>
            )}
          </>
        )}

        {/* ── FORMA ── */}
        {kind === 'shape' && (
          <>
            <FillControl obj={obj} canvas={canvas} onChange={onChange} defaultColor="#4f46e5" />
            <PropGroup label="Borde">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" defaultValue={(typeof obj.stroke === 'string' && obj.stroke) || '#111827'} onChange={(e) => set({ stroke: e.target.value })} style={{ ...s.colorInput, width: 48 }} />
                <input style={s.propInput} type="number" min={0} max={20} defaultValue={obj.strokeWidth ?? 0} onChange={(e) => set({ strokeWidth: +e.target.value })} placeholder="Grosor" />
              </div>
            </PropGroup>
            {(obj.type === 'rect') && (
              <PropGroup label="Redondeo de esquinas">
                <input type="range" min={0} max={80} step={1} defaultValue={obj.rx ?? 0} onChange={(e) => { const v = +e.target.value; set({ rx: v, ry: v }) }} style={{ width: '100%' }} />
              </PropGroup>
            )}
          </>
        )}

        {/* ── BOTÓN: estilo visual + acción ── */}
        {kind === 'button' && (
          <ButtonProps obj={obj} canvas={canvas} pages={pages} setData={setData} onChange={onChange} />
        )}

        {/* ── IMAGEN: sugerencia de uso ── */}
        {kind === 'image' && (
          <PropGroup label="Imagen">
            <button
              style={{ width: '100%', padding: '9px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: '#fff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: 8, marginBottom: 8 }}
              onClick={() => openObjectImageReplacement?.(obj)}
            >
              Reemplazar imagen
            </button>
            <button
              style={{ width: '100%', padding: '9px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: 8 }}
              onClick={() => onReframeImage?.(obj)}
            >
              ⤢ Reencuadrar imagen (zoom y posición)
            </button>
            <p style={cp.hint}>Ajusta qué parte de la imagen se ve dentro de su recuadro, sin deformarla — igual que "Ajustar hoja". También puedes usar las esquinas para redimensionar y rotar.</p>
          </PropGroup>
        )}

        {kind === 'shape' && (obj.type === 'rect' || obj.type === 'polygon') && (
          <PropGroup label="Imagen">
            <button
              style={{ width: '100%', padding: '9px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: 8 }}
              onClick={() => openObjectImageReplacement?.(obj)}
            >
              Reemplazar por imagen
            </button>
          </PropGroup>
        )}

        {/* ── ICONO: color del trazo/relleno ── */}
        {kind === 'icon' && (
          <PropGroup label="Color del icono">
            <input type="color" defaultValue="#334155" onChange={(e) => {
              const col = e.target.value
              const apply = (o: any) => { if (o.fill && o.fill !== '') o.set('fill', col); if (o.stroke && o.stroke !== '') o.set('stroke', col) }
              if (obj.getObjects) obj.getObjects().forEach(apply); else apply(obj)
              canvas?.requestRenderAll(); onChange()
            }} style={s.colorInput} />
          </PropGroup>
        )}

        {/* ── GRÁFICO SVG de la biblioteca: recolorear, trazo, voltear ── */}
        {kind === 'svglib' && (
          <SvgLibProps obj={obj} canvas={canvas} onChange={onChange} onSyncToggle={onSyncToggle} />
        )}

        {/* ── PUNTO ACTIVO: color de animación ── */}
        {kind === 'hotspot' && (
          <PropGroup label="Color del punto">
            <input type="color" defaultValue={(obj as any).data?.hotspot?.color ?? '#4F46E5'} onChange={(e) => {
              const col = e.target.value
              setData({ hotspot: { ...((obj as any).data?.hotspot ?? {}), color: col } })
              const objs = obj.getObjects?.() ?? []
              objs.forEach((o: any) => {
                if (o.fill && o.fill !== 'transparent') { const isRing = o.radius > 16; o.set({ fill: isRing ? `${col}33` : col, stroke: col }) }
              })
              canvas?.requestRenderAll(); onChange()
            }} style={s.colorInput} />
          </PropGroup>
        )}

        {/* ── WIDGET: configuración propia según el tipo ── */}
        {kind === 'widget' && (
          <WidgetProps obj={obj} setData={setData} openImageBank={openWidgetGalleryMediaPicker} />
        )}

        <button style={s.deleteBtn} onClick={() => { canvas?.remove(obj); canvas?.requestRenderAll(); onChange() }}>Eliminar elemento</button>
      </div>
      )}

      {insTab === 'actions' && (
      <div style={s.props}>
        <TriggerSelector data={(obj as any).data ?? {}} setData={setData} />
        <ActionEditor
          data={(obj as any).data ?? {}}
          pages={pages}
          setData={setData}
          targets={namedTargets}
          openImageBank={(request) => openActionGalleryMediaPicker?.(obj, request)}
        />
        {isWidget && (
          <p style={{ ...cp.hint, marginTop: 8 }}>
            <b>Nota:</b> para que este widget pueda ser objetivo de "Mostrar / ocultar", asígnale un nombre en la pestaña <b>Propiedades</b>.
          </p>
        )}
      </div>
      )}
      {insTab === 'dynamic' && (
      <div style={s.props}>
        <DynamicMarkerPanel
          publicationId={publicationId}
          pageId={pageId}
          selectedObject={obj}
          targetKind={kind}
          ensureElementId={ensureElementId}
        />
      </div>
      )}
    </div>
  )
}

// Propiedades de un gráfico SVG de la biblioteca: recolorear (global y por capa),
// trazo y voltear. Respeta los permisos de edición definidos por el admin
// (data.editable.colors / stroke / geometry).
function SvgLibProps({ obj, canvas, onChange, onSyncToggle }: { obj: any; canvas: any; onChange: () => void; onSyncToggle?: (enabled: boolean) => void }) {
  const editable = (obj as any).data?.editable ?? { colors: true, stroke: true, geometry: true }
  const hasSyncGroup = !!(obj as any).data?.syncGroupId
  // Capas = sub-objetos del grupo SVG (cada path/forma). Si no es grupo, el propio objeto.
  const layers: any[] = obj.getObjects ? obj.getObjects() : [obj]

  const rerender = () => { canvas?.requestRenderAll(); onChange() }

  // Aplica un color de relleno a TODAS las capas con relleno visible.
  const recolorAll = (col: string) => {
    layers.forEach((o) => { if (o.fill && o.fill !== '' && o.fill !== 'transparent') o.set('fill', col) })
    rerender()
  }
  // Aplica color de trazo a todas las capas que tengan trazo.
  const strokeAll = (col: string) => {
    layers.forEach((o) => { if (o.stroke && o.stroke !== '') o.set('stroke', col) })
    rerender()
  }
  const strokeWidthAll = (w: number) => {
    layers.forEach((o) => { if (o.stroke && o.stroke !== '') o.set('strokeWidth', w) })
    rerender()
  }

  // Capas con relleno (para recoloreado individual). Limitamos a 12 para no saturar.
  const fillLayers = layers
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.fill && o.fill !== '' && o.fill !== 'transparent')
    .slice(0, 12)

  return (
    <>
      {editable.colors && (
        <PropGroup label="Color (todo el gráfico)">
          <input type="color" defaultValue="#334155"
            onChange={(e) => recolorAll(e.target.value)} style={s.colorInput} />
        </PropGroup>
      )}

      {editable.colors && fillLayers.length > 1 && (
        <PropGroup label="Color por capa">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {fillLayers.map(({ o, i }) => (
              <input
                key={i}
                type="color"
                title={`Capa ${i + 1}`}
                defaultValue={typeof o.fill === 'string' && o.fill.startsWith('#') ? o.fill : '#334155'}
                onChange={(e) => { o.set('fill', e.target.value); rerender() }}
                style={{ width: 34, height: 30, padding: 0, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}
              />
            ))}
          </div>
          <p style={cp.hint}>Cada cuadrito recolorea una parte distinta del gráfico.</p>
        </PropGroup>
      )}

      {editable.stroke && (
        <>
          <PropGroup label="Color del trazo">
            <input type="color" defaultValue="#334155"
              onChange={(e) => strokeAll(e.target.value)} style={s.colorInput} />
          </PropGroup>
          <PropGroup label="Grosor del trazo">
            <input type="range" min={0} max={12} step={0.5} defaultValue={2}
              onChange={(e) => strokeWidthAll(+e.target.value)} style={{ width: '100%' }} />
          </PropGroup>
        </>
      )}

      {editable.geometry !== false && (
        <PropGroup label="Voltear">
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={cp.secondaryBtn} onClick={() => { obj.set('flipX', !obj.flipX); rerender() }}>↔ Horizontal</button>
            <button style={cp.secondaryBtn} onClick={() => { obj.set('flipY', !obj.flipY); rerender() }}>↕ Vertical</button>
          </div>
        </PropGroup>
      )}

      {onSyncToggle && (
        <PropGroup label="Sincronizar en páginas">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={hasSyncGroup}
              onChange={(e) => onSyncToggle(e.target.checked)}
              style={{ accentColor: '#4F46E5', width: 15, height: 15 }}
            />
            <span>Aplicar cambios en todas las páginas</span>
          </label>
          {hasSyncGroup && <p style={{ fontSize: 11, color: '#9ca3af', margin: '4px 0 0' }}>Este SVG tiene un ID de sincronización. Los cambios se propagarán al guardar.</p>}
        </PropGroup>
      )}
    </>
  )
}

// Propiedades específicas del botón: estilo + acción
function ButtonProps({ obj, canvas, pages, setData, onChange }: { obj: any; canvas: any; pages: any[]; setData: (p: any) => void; onChange: () => void }) {
  const data = (obj as any).data ?? {}
  const [iconSizeDisplay, setIconSizeDisplay] = React.useState<number>(data.iconSize ?? 22)
  const [textSizeDisplay, setTextSizeDisplay] = React.useState<number>(data.textSize ?? 14)
  const namedTargets = (canvas?.getObjects?.() ?? [])
    .filter((o: any) => o !== obj && o.data?.name && o.data?.elementId)
    .map((o: any) => ({ id: o.data.elementId as string, name: o.data.name as string }))
  // Reaplica estilo al grupo (rect + text internos). El icono SVG se edita con SvgLibProps.
  function restyle(patch: any) {
    const next = { ...data, ...patch }
    ;(obj as any).data = next
    const objs = obj.getObjects?.() ?? []
    const rect = objs.find((o: any) => o.type === 'rect')
    const txt = objs.find((o: any) => o.type === 'text' || o.type === 'i-text')
    if (rect) {
      const outline = next.variant === 'outline'
      rect.set({
        fill: outline ? 'rgba(255,255,255,0)' : next.bg,
        stroke: outline ? next.bg : '',
        strokeWidth: outline ? 2 : 0,
        rx: next.variant === 'pill' ? 23 : 8,
        ry: next.variant === 'pill' ? 23 : 8,
      })
    }
    if (txt) {
      txt.set({ text: next.label, fill: next.variant === 'outline' ? next.bg : (next.textColor || '#fff') })
    }
    obj.addWithUpdate?.()
    canvas?.requestRenderAll()
    onChange()
  }

  // Ajusta el tamaño del sub-objeto ícono SVG dentro del grupo del botón.
  function resizeIcon(newSize: number) {
    const objs = obj.getObjects?.() ?? []
    const icon = objs.find((o: any) => o.type === 'group') ?? objs.find((o: any) => o.type === 'path')
    if (!icon) return
    icon.scaleToWidth(newSize)
    obj.data = { ...(obj.data ?? {}), iconSize: newSize }
    obj.addWithUpdate?.()
    canvas?.requestRenderAll()
    setIconSizeDisplay(newSize)
    onChange()
  }

  // Ajusta el tamaño del texto del botón.
  function resizeText(newSize: number) {
    const objs = obj.getObjects?.() ?? []
    const txt = objs.find((o: any) => o.type === 'text' || o.type === 'i-text')
    if (!txt) return
    txt.set('fontSize', newSize)
    obj.data = { ...(obj.data ?? {}), textSize: newSize }
    obj.addWithUpdate?.()
    canvas?.requestRenderAll()
    setTextSizeDisplay(newSize)
    onChange()
  }

  return (
    <>
      <PropGroup label="Texto del botón">
        <input style={s.propInput} defaultValue={data.label ?? ''} onChange={(e) => restyle({ label: e.target.value })} />
      </PropGroup>
      <PropGroup label="Tamaño del texto">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range" min={8} max={40} step={1}
            defaultValue={data.textSize ?? 14}
            onChange={(e) => resizeText(+e.target.value)}
            style={{ flex: 1, accentColor: '#4F46E5' }}
          />
          <span style={{ fontSize: 12, color: '#6b7280', minWidth: 30, textAlign: 'right' as const }}>{textSizeDisplay}px</span>
        </div>
      </PropGroup>
      <PropGroup label="Estilo">
        <div style={{ display: 'flex', gap: 6 }}>
          {(['solid', 'outline', 'pill'] as const).map((v) => (
            <button key={v} style={{ ...s.alignBtn, flex: 1, fontSize: 11, ...(data.variant === v ? s.alignActive : {}) }} onClick={() => restyle({ variant: v })}>
              {v === 'solid' ? 'Relleno' : v === 'outline' ? 'Contorno' : 'Píldora'}
            </button>
          ))}
        </div>
      </PropGroup>
      <PropGroup label="Color del botón">
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <span style={s.miniLabel}>Fondo</span>
            <input type="color" defaultValue={data.bg ?? '#4f46e5'} onChange={(e) => restyle({ bg: e.target.value })} style={s.colorInput} />
          </div>
          <div style={{ flex: 1 }}>
            <span style={s.miniLabel}>Texto</span>
            <input type="color" defaultValue={data.textColor ?? '#ffffff'} onChange={(e) => restyle({ textColor: e.target.value })} style={s.colorInput} />
          </div>
        </div>
      </PropGroup>

      {/* Relleno del fondo del botón (sólido o gradiente) — apunta al rect interno */}
      {(() => {
        const rect = (obj.getObjects?.() ?? []).find((o: any) => o.type === 'rect')
        if (!rect) return null
        return (
          <FillControl
            obj={obj} target={rect} canvas={canvas} onChange={onChange}
            defaultColor={data.bg ?? '#4f46e5'} label="Fondo del botón (gradiente)"
            afterApply={() => obj.addWithUpdate?.()}
          />
        )
      })()}

      {data.svgIconId && (
        <PropGroup label="Tamaño del ícono">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range" min={14} max={56} step={2}
              defaultValue={data.iconSize ?? 22}
              onChange={(e) => resizeIcon(+e.target.value)}
              style={{ flex: 1, accentColor: '#4F46E5' }}
            />
            <span style={{ fontSize: 12, color: '#6b7280', minWidth: 30, textAlign: 'right' as const }}>{iconSizeDisplay}px</span>
          </div>
        </PropGroup>
      )}

      {data.svgIconId && (() => {
        // Extraer el sub-objeto icono SVG (el sub-grupo con más paths, NO el rect ni el text)
        const objs2 = obj.getObjects?.() ?? []
        const iconObj = objs2.find((o: any) => o.type === 'group') ?? objs2.find((o: any) => o.type === 'path')
        if (!iconObj) return null
        // Aseguramos que el icono tenga editable activado para ver todas sus capas
        if (!iconObj.data) iconObj.data = {}
        if (!iconObj.data.editable) iconObj.data.editable = { colors: true, stroke: true, geometry: true }
        return (
          <PropGroup label="Ícono SVG — capas y color">
            <SvgLibProps obj={iconObj} canvas={canvas} onChange={() => { obj.addWithUpdate?.(); canvas?.requestRenderAll(); onChange() }} />
          </PropGroup>
        )
      })()}

    </>
  )
}

// Mapa con buscador de ubicación + vista previa embebida en vivo (estilo FlipHTML5).
// Usa estado local para que el iframe de previsualización se actualice al escribir.
function MapWidgetProps({ cfg, setCfg }: { cfg: any; setCfg: (p: any) => void }) {
  const [address, setAddress] = React.useState<string>(cfg.address ?? '')
  const [mapsUrl, setMapsUrl] = React.useState<string>(cfg.mapsUrl ?? '')
  const [zoom, setZoom] = React.useState<number>(cfg.zoom ?? 14)

  const previewSrc = mapsUrl.trim()
    ? mapsUrl.trim()
    : (address.trim() ? `https://www.google.com/maps?q=${encodeURIComponent(address.trim())}&z=${zoom}&output=embed` : '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Collapsible title="Ubicación">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={s.propLabel}>Dirección</span>
          <input style={s.propInput} placeholder="Av. Lincoln 100, Santo Domingo" value={address}
            onChange={(e) => { setAddress(e.target.value); setCfg({ address: e.target.value }) }} />
        </div>
        {previewSrc && (
          <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
            <iframe title="map-preview" src={previewSrc} style={{ width: '100%', height: 150, border: 0, display: 'block' }} loading="lazy" />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={s.propLabel}>…o pega un link embebido de Google Maps</span>
          <input style={s.propInput} placeholder="https://www.google.com/maps/embed?pb=..." value={mapsUrl}
            onChange={(e) => { setMapsUrl(e.target.value); setCfg({ mapsUrl: e.target.value }) }} />
        </div>
        <p style={cp.hint}>Maps → Compartir → Insertar mapa → copia el src del iframe. El mapa de arriba es una vista previa en vivo.</p>
      </Collapsible>

      <Collapsible title="Vista">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Zoom</span>
          <input type="range" min={1} max={20} step={1} value={zoom} style={{ flex: 1 }}
            onChange={(e) => { setZoom(+e.target.value); setCfg({ zoom: +e.target.value }) }} />
          <span style={{ fontSize: 11, color: '#374151', width: 24 }}>{zoom}</span>
        </div>
      </Collapsible>

      <Collapsible title="Interacción" defaultOpen={false}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={cfg.openInApp !== false} onChange={(e) => setCfg({ openInApp: e.target.checked })} />
          Mostrar botón "Abrir en Google Maps"
        </label>
        <p style={cp.hint}>Agrega un botón sobre el mapa que abre la ubicación en Google Maps (rastreable por analítica).</p>
      </Collapsible>

      <TrackingControl value={cfg.tracking} onChange={(t) => setCfg({ tracking: t })} />
    </div>
  )
}

// Panel rico de WhatsApp (piloto del patrón del inspector): Contenido + Estilo + Tracking.
function WhatsAppWidgetProps({ cfg, setCfg }: { cfg: any; setCfg: (p: any) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Collapsible title="Contenido">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={s.propLabel}>Número (código de país sin +, ej: 18095551234)</span>
          <input style={s.propInput} placeholder="18095551234" defaultValue={cfg.phone ?? ''} onChange={(e) => setCfg({ phone: e.target.value })} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={s.propLabel}>Mensaje prellenado</span>
          <textarea style={{ ...s.propInput, height: 64, resize: 'vertical' } as any} defaultValue={cfg.message ?? ''} onChange={(e) => setCfg({ message: e.target.value })} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={s.propLabel}>Texto del botón</span>
          <input style={s.propInput} defaultValue={cfg.label ?? 'Escríbenos'} onChange={(e) => setCfg({ label: e.target.value })} />
        </div>
      </Collapsible>

      <Collapsible title="Estilo" defaultOpen={false}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={s.propLabel}>Color del botón</span>
          <input type="color" value={cfg.color ?? '#25D366'} onChange={(e) => setCfg({ color: e.target.value })} style={s.colorInput} />
          <button style={{ ...s.adjustReset, padding: '4px 10px' }} onClick={() => setCfg({ color: '#25D366' })}>WhatsApp</button>
        </div>
      </Collapsible>

      <TrackingControl value={cfg.tracking} onChange={(t) => setCfg({ tracking: t })} />
    </div>
  )
}

// QR con vista previa en vivo dentro del panel.
function QrWidgetProps({ obj, cfg, setCfg }: { obj: any; cfg: any; setCfg: (p: any) => void }) {
  const [data, setData] = React.useState<string>(cfg.data ?? '')
  const [caption, setCaption] = React.useState<string>(cfg.caption ?? '')
  const qrContent = data.trim() || 'https://intaprd.com'
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrContent)}`

  return (
    <>
      <PropGroup label="Contenido (URL o texto — vacío = link del flipbook)">
        <input style={s.propInput} placeholder="https://..." value={data}
          onChange={(e) => { setData(e.target.value); setCfg({ data: e.target.value }) }}
          onBlur={() => refreshCodeOnCanvas(obj)} />
      </PropGroup>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
        <img src={qrSrc} alt="QR preview" width={130} height={130} style={{ border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 4 }} />
      </div>
      <PropGroup label="Leyenda">
        <input style={s.propInput} placeholder="Escanéame" value={caption}
          onChange={(e) => { setCaption(e.target.value); setCfg({ caption: e.target.value }) }} />
      </PropGroup>
      <p style={cp.hint}>La imagen del QR en el lienzo se actualiza al salir del campo.</p>
    </>
  )
}

// Panel de Código de barras: valor + formato; refresca la imagen del lienzo.
function BarcodeWidgetProps({ obj, cfg, setCfg }: { obj: any; cfg: any; setCfg: (p: any) => void }) {
  const [value, setValue] = React.useState<string>(cfg.value ?? '')
  const fmt = cfg.format ?? 'code128'
  const preview = `https://barcodeapi.org/api/${encodeURIComponent(fmt)}/${encodeURIComponent(value.trim() || '123456789012')}`
  return (
    <>
      <PropGroup label="Valor / código">
        <input style={s.propInput} placeholder="123456789012" value={value}
          onChange={(e) => { setValue(e.target.value); setCfg({ value: e.target.value }) }}
          onBlur={() => refreshCodeOnCanvas(obj)} />
      </PropGroup>
      <PropGroup label="Formato">
        <select style={s.propInput} value={fmt} onChange={(e) => { setCfg({ format: e.target.value }); setTimeout(() => refreshCodeOnCanvas(obj), 0) }}>
          <option value="code128">Code 128 (general)</option>
          <option value="ean13">EAN-13 (productos)</option>
          <option value="ean8">EAN-8</option>
          <option value="upca">UPC-A</option>
          <option value="code39">Code 39</option>
          <option value="qr">QR</option>
        </select>
      </PropGroup>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0', background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
        <img src={preview} alt="barcode preview" style={{ maxWidth: '100%', maxHeight: 80 }} />
      </div>
      <p style={cp.hint}>La imagen en el lienzo se actualiza al salir del campo o cambiar el formato.</p>
    </>
  )
}

// Presets de botón de reproducción (deben coincidir con makePlayButton del viewer).
const PLAYER_LABELS: Record<string, string> = {
  circle: 'Círculo', outline: 'Contorno', noteDark: 'Nota oscuro', noteLight: 'Nota claro',
  square: 'Cuadrado', gradient: 'Degradado', minimal: 'Minimal', pill: 'Píldora',
  bar: 'Barra nativa', native: 'Reproductor nativo',
}
const AUDIO_PRESETS = ['circle', 'outline', 'noteDark', 'noteLight', 'square', 'gradient', 'minimal', 'pill', 'bar']
const VIDEO_PRESETS = ['native', 'circle', 'outline', 'square', 'gradient', 'minimal']

// Miniatura visual de cada preset (réplica simplificada del render del viewer).
function presetThumb(id: string, color: string): React.ReactNode {
  const base: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700 }
  const circle = (bg: string, fg: string, border?: string, icon = '▶'): React.ReactNode =>
    <div style={{ ...base, width: 38, height: 38, borderRadius: '50%', background: bg, color: fg, border: border || 'none' }}>{icon}</div>
  switch (id) {
    case 'circle':    return circle(color, '#fff')
    case 'outline':   return circle('transparent', color, `2px solid ${color}`)
    case 'noteDark':  return circle('#1f2937', '#fff', undefined, '🎵')
    case 'noteLight': return circle('#fff', '#111', '1px solid #e5e7eb', '🎵')
    case 'square':    return <div style={{ ...base, width: 38, height: 38, borderRadius: 10, background: '#111827', color: '#fff' }}>🎵</div>
    case 'gradient':  return circle(`linear-gradient(135deg, ${color}, #a855f7)`, '#fff', undefined, '🎵')
    case 'minimal':   return <div style={{ ...base, color, fontSize: 26 }}>▶</div>
    case 'pill':      return <div style={{ ...base, padding: '7px 14px', borderRadius: 999, background: color, color: '#fff', fontSize: 12 }}>▶ Texto</div>
    case 'bar':       return <div style={{ ...base, width: 70, height: 22, borderRadius: 6, background: '#eef2ff', color, fontSize: 11, gap: 4 }}>▶ ▬▬▬</div>
    case 'native':    return <div style={{ ...base, width: 70, height: 30, borderRadius: 6, background: '#000', color: '#fff', fontSize: 11, gap: 4 }}>▶ ▬▬ ⛶</div>
    default:          return circle(color, '#fff')
  }
}

// Galería de selección de preset de reproducción (audio/video).
function PlayerGallery({ value, color, presets, onPick }: { value: string; color: string; presets: string[]; onPick: (id: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {presets.map((id) => {
        const sel = value === id
        return (
          <button key={id} type="button" onClick={() => onPick(id)} title={PLAYER_LABELS[id]}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '10px 4px', borderRadius: 10, cursor: 'pointer', background: sel ? `${color}14` : '#fff', border: sel ? `2px solid ${color}` : '1px solid #e5e7eb' }}>
            <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{presetThumb(id, color)}</div>
            <span style={{ fontSize: 10, color: '#6b7280', textAlign: 'center', lineHeight: 1.1 }}>{PLAYER_LABELS[id]}</span>
          </button>
        )
      })}
    </div>
  )
}

// Panel de Redes sociales: red + usuario/URL. Refresca el logo en el lienzo.
function SocialWidgetProps({ obj, cfg, setCfg }: { obj: any; cfg: any; setCfg: (p: any) => void }) {
  const net = SOCIAL_NETWORKS[cfg.network] ?? SOCIAL_NETWORKS.instagram
  const [value, setValue] = React.useState<string>(cfg.value ?? '')
  return (
    <>
      <PropGroup label="Red social">
        <select style={s.propInput} value={cfg.network ?? 'instagram'}
          onChange={(e) => { setCfg({ network: e.target.value }); setTimeout(() => refreshCodeOnCanvas(obj), 0) }}>
          {Object.entries(SOCIAL_NETWORKS).map(([k, n]) => <option key={k} value={k}>{n.label}</option>)}
        </select>
      </PropGroup>
      <PropGroup label="Usuario o URL completa">
        <input style={s.propInput} placeholder={net.ph} value={value}
          onChange={(e) => { setValue(e.target.value); setCfg({ value: e.target.value }) }} />
        <p style={cp.hint}>Pon tu usuario (ej. <b>{net.ph}</b>) o pega la URL completa. El logo se muestra en el lienzo y enlaza a tu perfil en el flipbook publicado.</p>
      </PropGroup>
    </>
  )
}

// ─── Encuadre por imagen (zoom + arrastrar para centrar) ──────────────────────
// "Fit" = cómo se acomoda una imagen dentro de su recuadro sin deformarse.
// Guardamos { zoom, x, y }: zoom 1–3 (acercar), x/y 0–100 (posición que se ve,
// como object-position en CSS). El viewer reproduce esto idéntico → editor = publicado.
type ImgFit = { zoom: number; x: number; y: number }
const DEFAULT_FIT: ImgFit = { zoom: 1, x: 50, y: 50 }

// Devuelve los estilos CSS que "cubren" el recuadro respetando el encuadre elegido.
function imageFitCss(fit?: Partial<ImgFit> | null): React.CSSProperties {
  const f = { ...DEFAULT_FIT, ...(fit ?? {}) }
  return {
    objectFit: 'cover',
    objectPosition: `${f.x}% ${f.y}%`,
    transform: `scale(${f.zoom})`,
    transformOrigin: `${f.x}% ${f.y}%`,
  }
}

// Control visual: caja de vista previa donde se ARRASTRA la imagen para centrarla
// + slider de zoom. Llama onChange con el nuevo { zoom, x, y }.
function ImageFitControl({ src, fit, onChange, aspect = 4 / 3 }: { src: string; fit?: Partial<ImgFit> | null; onChange: (f: ImgFit) => void; aspect?: number }) {
  const f: ImgFit = { ...DEFAULT_FIT, ...(fit ?? {}) }
  const boxRef = React.useRef<HTMLDivElement | null>(null)
  const drag = React.useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const onDown = (e: React.PointerEvent) => {
    const box = boxRef.current; if (!box) return
    box.setPointerCapture(e.pointerId)
    drag.current = { sx: e.clientX, sy: e.clientY, ox: f.x, oy: f.y }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current, box = boxRef.current; if (!d || !box) return
    const r = box.getBoundingClientRect()
    // Arrastrar a la derecha revela el lado izquierdo → la posición disminuye.
    // Dividimos por zoom para que a más acercamiento el control sea más fino.
    const nx = d.ox - ((e.clientX - d.sx) / r.width) * 100 / f.zoom
    const ny = d.oy - ((e.clientY - d.sy) / r.height) * 100 / f.zoom
    onChange({ zoom: f.zoom, x: Math.max(0, Math.min(100, nx)), y: Math.max(0, Math.min(100, ny)) })
  }
  const onUp = (e: React.PointerEvent) => {
    drag.current = null
    try { boxRef.current?.releasePointerCapture(e.pointerId) } catch {}
  }

  return (
    <div style={{ marginTop: 6 }}>
      <div
        ref={boxRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        style={{ position: 'relative', width: '100%', aspectRatio: String(aspect), borderRadius: 8, overflow: 'hidden', background: '#0f172a', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
      >
        {src
          ? <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', pointerEvents: 'none', ...imageFitCss(f) }} />
          : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: '#94a3b8', fontSize: 12 }}>Sin imagen</div>}
        <div style={{ position: 'absolute', left: 6, bottom: 6, background: 'rgba(15,23,42,.7)', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 4, pointerEvents: 'none' }}>⤢ Arrastra para centrar</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: '#6b7280', flex: 'none' }}>Zoom</span>
        <input
          type="range" min={1} max={3} step={0.01} value={f.zoom}
          style={{ flex: 1 }}
          onChange={(e) => onChange({ ...f, zoom: +e.target.value })}
        />
        <span style={{ fontSize: 11, color: '#374151', width: 34, textAlign: 'right' }}>{f.zoom.toFixed(1)}x</span>
        <button type="button" style={{ ...s.alignBtn, fontSize: 11, padding: '3px 8px', flex: 'none' }} onClick={() => onChange({ ...DEFAULT_FIT })}>Restablecer</button>
      </div>
    </div>
  )
}

// Fila de imagen con botón "Ajustar" que despliega el ImageFitControl inline.
// `fitMap` es el objeto { [url]: ImgFit } guardado en la config; setFit lo actualiza.
function ImageFitToggle({ url, fitMap, setFit, aspect }: { url: string; fitMap: Record<string, ImgFit>; setFit: (url: string, f: ImgFit) => void; aspect?: number }) {
  const [open, setOpen] = React.useState(false)
  if (!url) return null
  return (
    <div style={{ marginBottom: 6 }}>
      <button
        type="button"
        style={{ ...s.alignBtn, fontSize: 11, padding: '3px 8px', width: '100%', color: open ? '#4F46E5' : '#374151', borderColor: open ? '#c7d2fe' : undefined, background: open ? '#eef2ff' : undefined }}
        onClick={() => setOpen(o => !o)}
      >⤢ {open ? 'Cerrar ajuste' : 'Ajustar encuadre (zoom y centrar)'}</button>
      {open && <ImageFitControl src={url} fit={fitMap[url]} onChange={(f) => setFit(url, f)} aspect={aspect} />}
    </div>
  )
}

function ImageBankUrlField({ value, onChange, onOpenBank }: { value: string; onChange: (url: string) => void; onOpenBank?: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input style={{ ...s.propInput, flex: 1 }} placeholder="https://..." value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" style={{ ...s.alignBtn, flex: 'none' }} onClick={onOpenBank}>Banco</button>
    </div>
  )
}

// PROTECTED: Stable external component with local drafts prevents product action inputs
// from remounting or updating Fabric data on every keystroke.
function CtaActionFields({ cfg, setCfg, prefix }: { cfg: any; setCfg: (p: any) => void; prefix: 'primary' | 'secondary' }) {
  const action = cfg[`${prefix}Action`] ?? 'none'
  const externalValue = cfg[`${prefix}Value`] ?? ''
  const externalMessage = cfg[`${prefix}Message`] ?? ''

  const [draftValue, setDraftValue] = React.useState(externalValue)
  const [draftMessage, setDraftMessage] = React.useState(externalMessage)

  const focusedRef = React.useRef(false)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearDebounce = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }

  React.useEffect(() => () => clearDebounce(), [])

  React.useEffect(() => {
    if (focusedRef.current) return

    setDraftValue(externalValue)
    setDraftMessage(externalMessage)
    clearDebounce()
  }, [externalMessage, externalValue, prefix])

  const commitDraft = React.useCallback(
    (value = draftValue, message = draftMessage) => {
      clearDebounce()

      const patch: any = {}

      if (value !== externalValue) {
        patch[`${prefix}Value`] = value
      }

      if (message !== externalMessage) {
        patch[`${prefix}Message`] = message
      }

      if (Object.keys(patch).length) {
        setCfg(patch)
      }
    },
    [draftValue, draftMessage, externalValue, externalMessage, prefix, setCfg]
  )

  const scheduleCommit = (value: string, message: string) => {
    clearDebounce()

    if (!focusedRef.current) return

    debounceRef.current = setTimeout(() => {
      commitDraft(value, message)
    }, 700)
  }

  const updateDraftValue = (value: string) => {
    setDraftValue(value)
    scheduleCommit(value, draftMessage)
  }

  const updateDraftMessage = (message: string) => {
    setDraftMessage(message)
    scheduleCommit(draftValue, message)
  }

  const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return

    commitDraft()
    ;(e.currentTarget as HTMLInputElement).blur()
  }

  const updateAction = (nextAction: string) => {
    clearDebounce()
    setCfg({ [`${prefix}Action`]: nextAction })
  }

  return (
    <>
      <select style={s.propInput} value={action} onChange={(e) => updateAction(e.target.value)}>
        <option value="none">Sin acción</option>
        <option value="whatsapp">WhatsApp</option>
        <option value="link">Abrir enlace</option>
        <option value="call">Llamar por teléfono</option>
        <option value="email">Enviar email</option>
      </select>
      {action === 'whatsapp' && (
        <>
          <input
            style={{ ...s.propInput, marginTop: 6 }}
            placeholder="Teléfono con código país (ej. 18091234567)"
            value={draftValue}
            onFocus={() => {
              focusedRef.current = true
            }}
            onBlur={() => {
              focusedRef.current = false
              commitDraft()
            }}
            onKeyDown={commitOnEnter}
            onChange={(e) => updateDraftValue(e.target.value)}
          />
          <input
            style={{ ...s.propInput, marginTop: 6 }}
            placeholder="Mensaje predefinido (opcional)"
            value={draftMessage}
            onFocus={() => {
              focusedRef.current = true
            }}
            onBlur={() => {
              focusedRef.current = false
              commitDraft()
            }}
            onKeyDown={commitOnEnter}
            onChange={(e) => updateDraftMessage(e.target.value)}
          />
        </>
      )}
      {action === 'link' && (
        <input
          style={{ ...s.propInput, marginTop: 6 }}
          placeholder="https://..."
          value={draftValue}
          onFocus={() => {
            focusedRef.current = true
          }}
          onBlur={() => {
            focusedRef.current = false
            commitDraft()
          }}
          onKeyDown={commitOnEnter}
          onChange={(e) => updateDraftValue(e.target.value)}
        />
      )}
      {action === 'call' && (
        <input
          style={{ ...s.propInput, marginTop: 6 }}
          placeholder="Teléfono (ej. 8091234567)"
          value={draftValue}
          onFocus={() => {
            focusedRef.current = true
          }}
          onBlur={() => {
            focusedRef.current = false
            commitDraft()
          }}
          onKeyDown={commitOnEnter}
          onChange={(e) => updateDraftValue(e.target.value)}
        />
      )}
      {action === 'email' && (
        <input
          style={{ ...s.propInput, marginTop: 6 }}
          placeholder="correo@dominio.com"
          value={draftValue}
          onFocus={() => {
            focusedRef.current = true
          }}
          onBlur={() => {
            focusedRef.current = false
            commitDraft()
          }}
          onKeyDown={commitOnEnter}
          onChange={(e) => updateDraftValue(e.target.value)}
        />
      )}
    </>
  )
}

// Panel del widget Galería / Slider: lista de imágenes + opciones de reproducción.
// Panel de la Ficha de producto: galería (máx. 5), textos, especificaciones y botones CTA.
// Todos los campos se editan aquí y se ven en vivo con el botón "Vista previa".
function ProductCardWidgetProps({ cfg, setCfg, openImageBank }: { cfg: any; setCfg: (p: any) => void; openImageBank?: OpenWidgetGalleryMediaPicker }) {
  const MAX = 5
  const images: string[] = cfg.images ?? []
  const fitMap: Record<string, ImgFit> = cfg.fit ?? {}
  const setFit = (url: string, f: ImgFit) => setCfg({ fit: { ...fitMap, [url]: f } })
  const setImages = (next: string[]) => setCfg({ images: next })
  const updateImage = (i: number, url: string) => { const n = [...images]; n[i] = url; setImages(n) }
  const removeImage = (i: number) => setImages(images.filter((_, j) => j !== i))
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= images.length) return
    const n = [...images];[n[i], n[j]] = [n[j], n[i]]; setImages(n)
  }

  return (
    <>
      <PropGroup label={`Imágenes (${images.length}/${MAX})`}>
        {images.map((url, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6 }}>
            {url ? <img src={url} alt="" style={{ width: 30, height: 30, objectFit: 'cover', borderRadius: 4, flex: 'none', border: '1px solid #e5e7eb' }} /> : <div style={{ width: 30, height: 30, borderRadius: 4, background: '#f1f5f9', flex: 'none' }} />}
            <input style={{ ...s.propInput, flex: 1, fontSize: 11 }} placeholder="https://..." value={url} onChange={(e) => updateImage(i, e.target.value)} />
            <button type="button" style={{ ...s.alignBtn, fontSize: 11, padding: '4px 8px', flex: 'none' }} onClick={() => openImageBank?.({ type: 'replace', imageIndex: i })}>Banco</button>
            <button type="button" title="Subir en orden (la 1ª es la portada)" style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: '0 2px' }} onClick={() => move(i, -1)}>▲</button>
            <button type="button" title="Bajar en orden" style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: '0 2px' }} onClick={() => move(i, 1)}>▼</button>
            <button type="button" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '0 2px' }} onClick={() => removeImage(i)}>✕</button>
          </div>
        ))}
        {images.filter(Boolean).map((url) => (
          <ImageFitToggle key={'fit-' + url} url={url} fitMap={fitMap} setFit={setFit} aspect={4 / 3} />
        ))}
        {images.length < MAX && (
          <button type="button" style={{ ...s.alignBtn, width: '100%', fontSize: 12, fontWeight: 700, background: '#eef2ff', color: '#4F46E5', borderColor: '#c7d2fe', marginTop: 4 }} onClick={() => openImageBank?.({ type: 'add', max: MAX })}>
            Agregar imágenes
          </button>
        )}
        <p style={cp.hint}>La primera imagen es la portada. Usa ▲▼ para reordenar. Si subes varias, la ficha muestra una mini-galería con flechas.</p>
      </PropGroup>

      {images.length > 1 && (
        <PropGroup label="Galería">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" checked={!!cfg.galleryAutoplay} onChange={(e) => setCfg({ galleryAutoplay: e.target.checked })} /> Avance automático
          </label>
          {cfg.galleryAutoplay && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Cada</span>
              <input style={{ ...s.propInput, width: 70 }} type="number" min={1} max={30} value={cfg.galleryInterval ?? 4} onChange={(e) => setCfg({ galleryInterval: +e.target.value })} />
              <span style={{ fontSize: 12, color: '#6b7280' }}>segundos</span>
            </div>
          )}
        </PropGroup>
      )}

      <PropGroup label="Título">
        <input style={s.propInput} value={cfg.title ?? ''} onChange={(e) => setCfg({ title: e.target.value })} />
      </PropGroup>

      <PropGroup label="Categoría / etiqueta">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer', marginBottom: 6 }}>
          <input type="checkbox" checked={cfg.showCategory !== false} onChange={(e) => setCfg({ showCategory: e.target.checked })} /> Mostrar
        </label>
        {cfg.showCategory !== false && <input style={s.propInput} value={cfg.category ?? ''} onChange={(e) => setCfg({ category: e.target.value })} />}
      </PropGroup>

      <PropGroup label="Precio">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer', marginBottom: 6 }}>
          <input type="checkbox" checked={cfg.showPrice !== false} onChange={(e) => setCfg({ showPrice: e.target.checked })} /> Mostrar
        </label>
        {cfg.showPrice !== false && <input style={s.propInput} placeholder="RD$ 4,692.31" value={cfg.price ?? ''} onChange={(e) => setCfg({ price: e.target.value })} />}
      </PropGroup>

      <PropGroup label="Descripción">
        <textarea style={{ ...s.propInput, height: 70, resize: 'vertical' } as any} value={cfg.description ?? ''} onChange={(e) => setCfg({ description: e.target.value })} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>Tamaño:</span>
          <input type="range" min={10} max={22} step={1} value={cfg.descriptionSize ?? 14} onChange={(e) => setCfg({ descriptionSize: +e.target.value })} style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: '#6b7280', minWidth: 28, textAlign: 'right' }}>{cfg.descriptionSize ?? 14}px</span>
        </div>
      </PropGroup>

      <PropGroup label="Especificaciones técnicas">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer', marginBottom: 8 }}>
          <input type="checkbox" checked={cfg.showSpecs !== false} onChange={(e) => setCfg({ showSpecs: e.target.checked })} /> Mostrar
        </label>
        {cfg.showSpecs !== false && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input style={{ ...s.propInput, flex: '0 0 90px' }} placeholder="Ref.:" value={cfg.refLabel ?? ''} onChange={(e) => setCfg({ refLabel: e.target.value })} />
              <input style={{ ...s.propInput, flex: 1 }} placeholder="DEC7402" value={cfg.refValue ?? ''} onChange={(e) => setCfg({ refValue: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...s.propInput, flex: '0 0 90px' }} placeholder="Disponibilidad:" value={cfg.availLabel ?? ''} onChange={(e) => setCfg({ availLabel: e.target.value })} />
              <input style={{ ...s.propInput, flex: 1 }} placeholder="Inmediata" value={cfg.availValue ?? ''} onChange={(e) => setCfg({ availValue: e.target.value })} />
            </div>
          </>
        )}
      </PropGroup>

      <PropGroup label="Color de acento (precio, categoría, ✓)">
        <input type="color" value={cfg.accent ?? '#4d7c0f'} onChange={(e) => setCfg({ accent: e.target.value })} style={s.colorInput} />
      </PropGroup>

      <div style={s.actionDivider}>Botón principal</div>
      <PropGroup label="Texto del botón">
        <input style={s.propInput} value={cfg.primaryText ?? ''} onChange={(e) => setCfg({ primaryText: e.target.value })} />
      </PropGroup>
      <PropGroup label="Color del botón">
        <input type="color" value={cfg.primaryColor ?? '#9aab3c'} onChange={(e) => setCfg({ primaryColor: e.target.value })} style={s.colorInput} />
      </PropGroup>
      <PropGroup label="Acción al hacer clic">
        <CtaActionFields cfg={cfg} setCfg={setCfg} prefix="primary" />
      </PropGroup>

      <div style={s.actionDivider}>Botón secundario</div>
      <PropGroup label="Mostrar segundo botón">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={cfg.showSecondary !== false} onChange={(e) => setCfg({ showSecondary: e.target.checked })} /> Mostrar
        </label>
      </PropGroup>
      {cfg.showSecondary !== false && (
        <>
          <PropGroup label="Texto del botón">
            <input style={s.propInput} value={cfg.secondaryText ?? ''} onChange={(e) => setCfg({ secondaryText: e.target.value })} />
          </PropGroup>
          <PropGroup label="Acción al hacer clic">
            <CtaActionFields cfg={cfg} setCfg={setCfg} prefix="secondary" />
          </PropGroup>
        </>
      )}

      <p style={cp.hint}>Pulsa "👁 Vista previa" para ver la ficha completa tal como se verá publicada. En el lienzo verás un boceto para colocarla y dimensionarla.</p>
    </>
  )
}

function GalleryWidgetProps({ cfg, setCfg, openImageBank }: { cfg: any; setCfg: (p: any) => void; openImageBank?: OpenWidgetGalleryMediaPicker }) {
  const images: string[] = cfg.images ?? []
  const fitMap: Record<string, ImgFit> = cfg.fit ?? {}
  const setFit = (url: string, f: ImgFit) => setCfg({ fit: { ...fitMap, [url]: f } })
  const setImages = (next: string[]) => setCfg({ images: next })
  const addImage = () => { if (images.length < 30) setImages([...images, '']) }
  const updateImage = (i: number, url: string) => { const n = [...images]; n[i] = url; setImages(n) }
  const removeImage = (i: number) => setImages(images.filter((_, j) => j !== i))
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= images.length) return
    const n = [...images];[n[i], n[j]] = [n[j], n[i]]; setImages(n)
  }
  return (
    <>
      <PropGroup label={`Imágenes del slider (${images.length}/30)`}>
        {images.map((url, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6 }}>
            {url ? <img src={url} alt="" style={{ width: 30, height: 30, objectFit: 'cover', borderRadius: 4, flex: 'none', border: '1px solid #e5e7eb' }} /> : <div style={{ width: 30, height: 30, borderRadius: 4, background: '#f1f5f9', flex: 'none' }} />}
            <input style={{ ...s.propInput, flex: 1, fontSize: 11 }} placeholder="https://..." value={url} onChange={(e) => updateImage(i, e.target.value)} />
            <button type="button" style={{ ...s.alignBtn, fontSize: 11, padding: '4px 8px', flex: 'none' }} onClick={() => openImageBank?.({ type: 'replace', imageIndex: i })}>Banco</button>
            <button type="button" title="Subir en orden" style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: '0 2px' }} onClick={() => move(i, -1)}>▲</button>
            <button type="button" title="Bajar en orden" style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: '0 2px' }} onClick={() => move(i, 1)}>▼</button>
            <button type="button" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '0 2px' }} onClick={() => removeImage(i)}>✕</button>
          </div>
        ))}
        {images.filter(Boolean).map((url) => (
          <ImageFitToggle key={'fit-' + url} url={url} fitMap={fitMap} setFit={setFit} aspect={4 / 3} />
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button type="button" style={{ ...s.alignBtn, flex: 1, fontSize: 12, fontWeight: 700, background: '#eef2ff', color: '#4F46E5', borderColor: '#c7d2fe' }} onClick={() => openImageBank?.({ type: 'add', max: 30 })}>
            Agregar imágenes
          </button>
          <button type="button" style={{ ...s.alignBtn, fontSize: 12 }} onClick={addImage}>+ URL</button>
        </div>
      </PropGroup>
      <PropGroup label="Transición">
        <select style={s.propInput} value={cfg.transition ?? 'fade'} onChange={(e) => setCfg({ transition: e.target.value })}>
          <option value="fade">Fundido (fade)</option>
          <option value="slide">Deslizar (slide)</option>
          <option value="zoom">Zoom</option>
        </select>
      </PropGroup>
      <PropGroup label="Reproducción">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer', marginBottom: 6 }}>
          <input type="checkbox" checked={cfg.autoplay !== false} onChange={(e) => setCfg({ autoplay: e.target.checked })} /> Avance automático
        </label>
        {cfg.autoplay !== false && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>Cada</span>
            <input style={{ ...s.propInput, width: 70 }} type="number" min={1} max={30} value={cfg.interval ?? 4} onChange={(e) => setCfg({ interval: +e.target.value })} />
            <span style={{ fontSize: 12, color: '#6b7280' }}>segundos</span>
          </div>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer', marginBottom: 6 }}>
          <input type="checkbox" checked={cfg.arrows !== false} onChange={(e) => setCfg({ arrows: e.target.checked })} /> Flechas de navegación
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={cfg.dots !== false} onChange={(e) => setCfg({ dots: e.target.checked })} /> Puntos indicadores
        </label>
      </PropGroup>
      <p style={cp.hint}>El slider real (auto-avance, flechas, deslizar con el dedo) se ve en la publicación. En el lienzo verás el recuadro de la galería para colocarlo y dimensionarlo.</p>
    </>
  )
}

// Propiedades de un widget: campos de configuración según su tipo
function WidgetProps({ obj, setData, openImageBank }: { obj: any; setData: (p: any) => void; openImageBank?: (obj: FabricObjectInstance, request: Parameters<OpenWidgetGalleryMediaPicker>[0]) => void }) {
  const widget = (obj as any).data?.widget ?? { type: 'map', config: {} }
  const cfg = widget.config ?? {}
  const type: WidgetType = widget.type
  const setCfg = (patch: any) => setData({ widget: { ...widget, config: { ...cfg, ...patch } } })
  const [quizQuestions, setQuizQuestions] = React.useState<any[]>(cfg.questions ?? [{ text: '¿Tu pregunta?', options: ['Opción A', 'Opción B'], type: 'single' }])
  const [showPreview, setShowPreview] = React.useState(false)
  const Check = ({ k, label, def = true }: { k: string; label: string; def?: boolean }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
      <input type="checkbox" defaultChecked={cfg[k] !== undefined ? !!cfg[k] : def} onChange={(e) => setCfg({ [k]: e.target.checked })} />
      {label}
    </label>
  )
  const labels: Record<WidgetType, string> = {
    map: 'Mapa', whatsapp: 'WhatsApp', social: 'Redes sociales', contact: 'Formulario', video: 'Video',
    audio: 'Audio', qr: 'Código QR', barcode: 'Código de barras', gallery: 'Galería / Slider', table: 'Tabla', like: 'Me gusta',
    embed: 'Incrustar / HTML', quiz: 'Cuestionario', popup_banner: 'Pop-up emergente',
    download: 'Descargar archivo', units_table: 'Tabla de Unidades', product_card: 'Ficha de producto',
  }

  return (
    <>
      <div style={s.actionDivider}>Configuración · {labels[type]}</div>

      <button
        type="button"
        onClick={() => setShowPreview(true)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', marginBottom: 12, padding: '9px', border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4F46E5', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
      >
        👁 Vista previa
      </button>
      {showPreview && <WidgetPreview type={type} config={cfg} onClose={() => setShowPreview(false)} />}

      {type === 'map' && <MapWidgetProps cfg={cfg} setCfg={setCfg} />}

      {type === 'whatsapp' && <WhatsAppWidgetProps cfg={cfg} setCfg={setCfg} />}

      {type === 'contact' && (
        <>
          <WidgetField label="Título">
            <input style={s.propInput} defaultValue={cfg.title ?? ''} onChange={(e) => setCfg({ title: e.target.value })} />
          </WidgetField>
          <WidgetField label="Email destino">
            <input style={s.propInput} placeholder="ventas@dominio.com" defaultValue={cfg.toEmail ?? ''} onChange={(e) => setCfg({ toEmail: e.target.value })} />
          </WidgetField>
          <WidgetField label="Texto del botón">
            <input style={s.propInput} defaultValue={cfg.button ?? 'Enviar'} onChange={(e) => setCfg({ button: e.target.value })} />
          </WidgetField>
          <WidgetField label="Campos y obligatorios">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Check k="showPhone"     label="Incluir Teléfono / Móvil" />
              <Check k="showComment"   label="Incluir Comentario / Mensaje" />
              <Check k="nameRequired"  label="Nombre obligatorio (*)" />
              <Check k="emailRequired" label="Email obligatorio (*)" />
              <Check k="phoneRequired" label="Teléfono obligatorio (*)" def={false} />
            </div>
          </WidgetField>
        </>
      )}

      {type === 'video' && (
        <>
          <WidgetField label="URL del video (YouTube o Vimeo)">
            <input style={s.propInput} placeholder="https://youtube.com/watch?v=..." defaultValue={cfg.url ?? ''} onChange={(e) => setCfg({ url: e.target.value })} />
          </WidgetField>
          <WidgetField label="…o sube un archivo de video (MP4/WebM)">
            <FileField value={/^https?:\/\/(www\.)?(youtube|youtu\.be|vimeo)/.test(cfg.url ?? '') ? '' : (cfg.url ?? '')} onChange={(url) => setCfg({ url })} accept={ACCEPT_VIDEO} preview={false} hint="MP4, WebM · máx 50 MB" />
          </WidgetField>
          <WidgetField label="Portada / thumbnail (opcional, para MP4)">
            <ImageBankUrlField value={cfg.poster ?? ''} onChange={(url) => setCfg({ poster: url })} onOpenBank={() => openImageBank?.(obj, { type: 'field', field: 'poster' })} />
          </WidgetField>
          <WidgetField label="Botón de reproducción — elige un estilo">
            <PlayerGallery value={cfg.playerStyle ?? 'native'} color={cfg.playerColor ?? '#ef4444'} presets={VIDEO_PRESETS} onPick={(id) => setCfg({ playerStyle: id })} />
            <p style={cp.hint}>Los botones de play aplican a videos subidos (MP4/WebM). YouTube/Vimeo usan su propio reproductor.</p>
          </WidgetField>
          {(cfg.playerStyle ?? 'native') !== 'native' && (
            <WidgetField label="Color del botón de play">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" defaultValue={cfg.playerColor ?? '#ef4444'} onChange={(e) => setCfg({ playerColor: e.target.value })} style={s.colorInput} />
                <span style={{ fontSize: 11, color: '#6b7280' }}>Color del botón sobre el video</span>
              </div>
            </WidgetField>
          )}
          <WidgetField label="Opciones de reproducción">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Check k="autoplay" label="Autoplay (inicia automáticamente)" def={false} />
              <Check k="controls" label="Mostrar controles de reproducción" />
              <Check k="muted"    label="Silenciar (recomendado con autoplay)" def={false} />
              <Check k="loop"     label="Repetir en bucle" def={false} />
            </div>
          </WidgetField>
        </>
      )}

      {type === 'audio' && (
        <>
          <WidgetField label="Archivo de audio">
            <FileField value={cfg.url ?? ''} onChange={(url) => setCfg({ url })} accept={ACCEPT_AUDIO} preview={false} hint="MP3, OGG, WAV, M4A · máx 50 MB" />
          </WidgetField>
          <WidgetField label="Botón de reproducción — elige un estilo">
            <PlayerGallery value={cfg.playerStyle ?? 'circle'} color={cfg.playerColor ?? '#7c3aed'} presets={AUDIO_PRESETS} onPick={(id) => setCfg({ playerStyle: id })} />
          </WidgetField>
          {(cfg.playerStyle ?? 'circle') === 'pill' && (
            <WidgetField label="Texto del botón">
              <input style={s.propInput} placeholder="Escuchar" defaultValue={cfg.label ?? ''} onChange={(e) => setCfg({ label: e.target.value })} />
            </WidgetField>
          )}
          <WidgetField label="Color del reproductor">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" defaultValue={cfg.playerColor ?? '#7c3aed'} onChange={(e) => setCfg({ playerColor: e.target.value })} style={s.colorInput} />
              <span style={{ fontSize: 11, color: '#6b7280' }}>Color del botón / barra</span>
            </div>
          </WidgetField>
          <WidgetField label="Opciones">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Check k="autoplay" label="Autoplay al abrir la página" def={false} />
              <Check k="loop"     label="Repetir en bucle" def={false} />
            </div>
          </WidgetField>
        </>
      )}

      {type === 'qr' && <QrWidgetProps obj={obj} cfg={cfg} setCfg={setCfg} />}

      {type === 'barcode' && <BarcodeWidgetProps obj={obj} cfg={cfg} setCfg={setCfg} />}

      {type === 'social' && <SocialWidgetProps obj={obj} cfg={cfg} setCfg={setCfg} />}

      {type === 'gallery' && <GalleryWidgetProps cfg={cfg} setCfg={setCfg} openImageBank={(request) => openImageBank?.(obj, request)} />}

      {type === 'product_card' && <ProductCardWidgetProps cfg={cfg} setCfg={setCfg} openImageBank={(request) => openImageBank?.(obj, request)} />}

      {type === 'table' && (
        <WidgetField label="Datos (fila por línea, columnas separadas por coma)">
          <textarea style={{ ...s.propInput, height: 120, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 } as any} defaultValue={cfg.csv ?? ''} onChange={(e) => setCfg({ csv: e.target.value })} />
        </WidgetField>
      )}

      {type === 'like' && (
        <WidgetField label="Texto del botón">
          <input style={s.propInput} defaultValue={cfg.label ?? 'Me gusta'} onChange={(e) => setCfg({ label: e.target.value })} />
        </WidgetField>
      )}

      {type === 'download' && (
        <>
          <WidgetField label="Archivo a descargar">
            <FileField value={cfg.url ?? ''} onChange={(url) => setCfg({ url })} accept={ACCEPT_FILE} preview={false} hint="PDF, ZIP, Office, imágenes · máx 50 MB" />
          </WidgetField>
          <WidgetField label="Título">
            <input style={s.propInput} defaultValue={cfg.title ?? 'Descarga aquí'} onChange={(e) => setCfg({ title: e.target.value })} />
          </WidgetField>
          <WidgetField label="Texto del botón">
            <input style={s.propInput} defaultValue={cfg.button ?? 'Descargar'} onChange={(e) => setCfg({ button: e.target.value })} />
          </WidgetField>
          <WidgetField label="Nombre del archivo descargado (opcional)">
            <input style={s.propInput} placeholder="catalogo.pdf" defaultValue={cfg.filename ?? ''} onChange={(e) => setCfg({ filename: e.target.value })} />
          </WidgetField>
          <WidgetField label="Color del botón">
            <input type="color" defaultValue={cfg.buttonColor ?? '#4F46E5'} onChange={(e) => setCfg({ buttonColor: e.target.value })} style={s.colorInput} />
          </WidgetField>
        </>
      )}

      {type === 'embed' && (
        <>
          <WidgetField label="Código HTML / iframe a incrustar">
            <textarea style={{ ...s.propInput, height: 120, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 } as any} placeholder={'<iframe src="https://..." ...></iframe>\no código HTML corto'} defaultValue={cfg.html ?? ''} onChange={(e) => setCfg({ html: e.target.value })} />
          </WidgetField>
          <p style={cp.hint}>Pegá el código de inserción de cualquier servicio externo (Google Forms, Typeform, calendarios, mapas custom, etc.).</p>
        </>
      )}

      {type === 'quiz' && (
        <>
          <WidgetField label="Título del cuestionario">
            <input style={s.propInput} defaultValue={cfg.title ?? 'Cuestionario'} onChange={(e) => setCfg({ title: e.target.value })} />
          </WidgetField>
          <div style={cp.sectionLabel}>Preguntas</div>
          {quizQuestions.map((q: any, qi: number) => (
            <div key={qi} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>Pregunta {qi + 1}</span>
                <button onClick={() => { const next = quizQuestions.filter((_: any, i: number) => i !== qi); setQuizQuestions(next); setCfg({ questions: next }) }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>✕</button>
              </div>
              <input style={{ ...s.propInput, marginBottom: 6 }} placeholder="Texto de la pregunta" defaultValue={q.text} onChange={(e) => { const next = quizQuestions.map((qq: any, i: number) => i === qi ? { ...qq, text: e.target.value } : qq); setQuizQuestions(next); setCfg({ questions: next }) }} />
              <select style={{ ...s.propInput, marginBottom: 6 }} defaultValue={q.type ?? 'single'} onChange={(e) => { const next = quizQuestions.map((qq: any, i: number) => i === qi ? { ...qq, type: e.target.value } : qq); setQuizQuestions(next); setCfg({ questions: next }) }}>
                <option value="single">Opción única</option>
                <option value="multi">Múltiple selección</option>
              </select>
              {q.options.map((opt: string, oi: number) => (
                <div key={oi} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <input style={{ ...s.propInput, flex: 1 }} placeholder={`Opción ${oi + 1}`} defaultValue={opt} onChange={(e) => { const next = quizQuestions.map((qq: any, i: number) => i === qi ? { ...qq, options: qq.options.map((o: string, j: number) => j === oi ? e.target.value : o) } : qq); setQuizQuestions(next); setCfg({ questions: next }) }} />
                  <button onClick={() => { const next = quizQuestions.map((qq: any, i: number) => i === qi ? { ...qq, options: qq.options.filter((_: string, j: number) => j !== oi) } : qq); setQuizQuestions(next); setCfg({ questions: next }) }} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>✕</button>
                </div>
              ))}
              <button onClick={() => { const next = quizQuestions.map((qq: any, i: number) => i === qi ? { ...qq, options: [...qq.options, `Opción ${qq.options.length + 1}`] } : qq); setQuizQuestions(next); setCfg({ questions: next }) }} style={{ ...cp.primaryBtn, fontSize: 11, padding: '5px', marginTop: 4, background: '#f3f4f6', color: '#374151' }}>+ Agregar opción</button>
            </div>
          ))}
          <button onClick={() => { const next = [...quizQuestions, { text: `Pregunta ${quizQuestions.length + 1}`, options: ['Opción A', 'Opción B'], type: 'single' }]; setQuizQuestions(next); setCfg({ questions: next }) }} style={{ ...cp.primaryBtn, background: '#4F46E5', marginBottom: 4 }}>+ Agregar pregunta</button>
        </>
      )}

      {type === 'popup_banner' && (
        <>
          <WidgetField label="Plantilla rápida">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {POPUP_TEMPLATES.map((t) => (
                <button key={t.key} onClick={() => setCfg({ ...cfg, template: t.key, ...t.defaults })} style={{ padding: '6px 4px', border: `2px solid ${cfg.template === t.key ? '#4F46E5' : '#e5e7eb'}`, borderRadius: 6, background: cfg.template === t.key ? '#eef2ff' : '#fff', cursor: 'pointer', fontSize: 10, color: '#374151', textAlign: 'center' as const }}>
                  {t.label}
                </button>
              ))}
            </div>
          </WidgetField>
          <WidgetField label="Ubicación">
            <select style={s.propInput} defaultValue={cfg.position ?? 'left'} onChange={(e) => setCfg({ position: e.target.value })}>
              <option value="left">Lateral izquierdo</option>
              <option value="right">Lateral derecho</option>
              <option value="custom">Personalizado (donde está el cuadro)</option>
            </select>
            {cfg.position === 'custom' && (
              <p style={cp.hint}>El pop-up aparecerá exactamente donde colocaste y dimensionaste este cuadro en la página, no en un lateral.</p>
            )}
          </WidgetField>
          <WidgetField label="Cuándo aparecer">
            <select style={s.propInput} defaultValue={cfg.trigger ?? 'delay'} onChange={(e) => setCfg({ trigger: e.target.value })}>
              <option value="delay">Después de X segundos</option>
              <option value="immediate">Al abrir el flipbook</option>
              <option value="exit">Al intentar salir</option>
            </select>
          </WidgetField>
          {(cfg.trigger === 'delay' || !cfg.trigger) && (
            <>
              <WidgetField label="Inicio del contador">
                <select style={s.propInput} defaultValue={cfg.timer_scope ?? 'global'} onChange={(e) => setCfg({ timer_scope: e.target.value })}>
                  <option value="global">Al abrir el flipbook (global)</option>
                  <option value="page">Al llegar a esta página (focalizado)</option>
                </select>
                <p style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
                  {(cfg.timer_scope ?? 'global') === 'global'
                    ? 'El contador arranca desde que se abre el flipbook, sin importar en qué página esté el lector.'
                    : 'El contador arranca solo cuando el lector llega a la página donde colocaste este widget.'}
                </p>
              </WidgetField>
              <WidgetField label="Demora (segundos)">
                <input style={s.propInput} type="number" min={0} max={120} defaultValue={cfg.delay ?? 5} onChange={(e) => setCfg({ delay: +e.target.value })} />
              </WidgetField>
            </>
          )}
          <WidgetField label="Animación de entrada">
            <select style={s.propInput} defaultValue={cfg.animation ?? 'slide'} onChange={(e) => setCfg({ animation: e.target.value })}>
              <option value="slide">Deslizar (suave)</option>
              <option value="bounce">Saltos</option>
              <option value="heartbeat">Latidos</option>
              <option value="zoom">Zoom</option>
              <option value="none">Sin animación</option>
            </select>
          </WidgetField>
          <WidgetField label="Cerrar solo tras X segundos (0 = no cerrar)">
            <input style={s.propInput} type="number" min={0} max={120} defaultValue={cfg.autoClose ?? 0} onChange={(e) => setCfg({ autoClose: +e.target.value })} />
          </WidgetField>
          <WidgetField label="Título del pop-up">
            <input style={s.propInput} defaultValue={cfg.title ?? ''} onChange={(e) => setCfg({ title: e.target.value })} />
          </WidgetField>
          <WidgetField label="Texto del pop-up">
            <textarea style={{ ...s.propInput, height: 64, resize: 'vertical' } as any} defaultValue={cfg.text ?? ''} onChange={(e) => setCfg({ text: e.target.value })} />
          </WidgetField>
          <WidgetField label="Texto del botón">
            <input style={s.propInput} defaultValue={cfg.buttonText ?? ''} onChange={(e) => setCfg({ buttonText: e.target.value })} />
          </WidgetField>
          <WidgetField label="URL del botón">
            <input style={s.propInput} placeholder="https://..." defaultValue={cfg.buttonUrl ?? ''} onChange={(e) => setCfg({ buttonUrl: e.target.value })} />
          </WidgetField>
          <WidgetField label="Imagen (opcional)">
            <ImageBankUrlField value={cfg.image ?? ''} onChange={(url) => setCfg({ image: url })} onOpenBank={() => openImageBank?.(obj, { type: 'field', field: 'image' })} />
          </WidgetField>
          {cfg.image && (
            <WidgetField label="Lado de la imagen">
              <select style={s.propInput} defaultValue={cfg.imagePosition ?? 'left'} onChange={(e) => setCfg({ imagePosition: e.target.value })}>
                <option value="left">Imagen a la izquierda</option>
                <option value="right">Imagen a la derecha</option>
              </select>
            </WidgetField>
          )}
          {cfg.image && (
            <WidgetField label="Ajustar imagen">
              <ImageFitToggle
                key={`fit-${cfg.image}`}
                url={cfg.image}
                fitMap={{
                  [cfg.image]: {
                    zoom: cfg.imageZoom ?? 1,
                    x: cfg.imagePosX ?? 50,
                    y: cfg.imagePosY ?? 50,
                  },
                }}
                setFit={(_, f) => setCfg({
                  imageZoom: f.zoom,
                  imagePosX: f.x,
                  imagePosY: f.y,
                })}
                aspect={4 / 3}
              />
            </WidgetField>
          )}
          <WidgetField label="Colores">
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={s.miniLabel}>Fondo</div>
                <input type="color" defaultValue={cfg.bgColor ?? '#1e1b4b'} onChange={(e) => setCfg({ bgColor: e.target.value })} style={s.colorInput} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={s.miniLabel}>Texto</div>
                <input type="color" defaultValue={cfg.textColor ?? '#ffffff'} onChange={(e) => setCfg({ textColor: e.target.value })} style={s.colorInput} />
              </div>
            </div>
          </WidgetField>
          <WidgetField label="Opciones">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Check k="showOnce" label="Mostrar una sola vez por visitante" />
            </div>
          </WidgetField>
        </>
      )}

      {type === 'units_table' && (
        <>
          <WidgetField label="ID de publicación (se completa automáticamente)">
            <input style={s.propInput} value={cfg.publication_id ?? ''} readOnly />
          </WidgetField>
          <WidgetField label="Filtrar estado">
            <select style={s.propInput} defaultValue={cfg.filter_status ?? 'all'} onChange={(e) => setCfg({ filter_status: e.target.value })}>
              <option value="all">Todos</option>
              <option value="available">Solo disponibles</option>
              <option value="reserved">Solo reservadas</option>
              <option value="sold">Solo vendidas</option>
            </select>
          </WidgetField>
          <WidgetField label="Columnas visibles">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Check k="show_price" label="Mostrar precio" />
              <Check k="show_area"  label="Mostrar m²" />
            </div>
          </WidgetField>
        </>
      )}

      <p style={cp.hint}>El widget se muestra completo en la vista previa y en la publicación final.</p>
    </>
  )
}

// Ajustador de imagen: arrastrar para reposicionar + zoom. Guarda el encuadre
// como imageZoom (escala) + imagePosX/imagePosY (object-position 0–100 %), que
// el viewer aplica con object-fit:cover + object-position + transform:scale.
function ImageAdjuster({
  url, zoom, posX, posY, onChange,
}: {
  url: string; zoom: number; posX: number; posY: number
  onChange: (p: { imageZoom?: number; imagePosX?: number; imagePosY?: number }) => void
}) {
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  function down(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, px: posX, py: posY }
  }
  function move(e: React.PointerEvent) {
    if (!drag.current) return
    const d = drag.current
    // Arrastrar hacia un lado revela el lado opuesto → object-position se mueve al revés
    const nx = Math.min(100, Math.max(0, d.px - (e.clientX - d.x) * 0.4))
    const ny = Math.min(100, Math.max(0, d.py - (e.clientY - d.y) * 0.4))
    onChange({ imagePosX: Math.round(nx), imagePosY: Math.round(ny) })
  }
  function up() { drag.current = null }

  const zb: React.CSSProperties = { width: 26, height: 26, borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 15, lineHeight: 1, color: '#374151' }

  return (
    <div>
      <div
        style={{ position: 'relative', width: '100%', height: 150, borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb', background: '#f3f4f6', cursor: 'move', touchAction: 'none' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
      >
        <img
          src={url}
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${posX}% ${posY}%`, transform: `scale(${zoom})`, transformOrigin: 'center', userSelect: 'none', pointerEvents: 'none' }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: '#6b7280' }}>Zoom</span>
        <button type="button" style={zb} onClick={() => onChange({ imageZoom: Math.max(1, +(zoom - 0.1).toFixed(2)) })}>−</button>
        <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => onChange({ imageZoom: +e.target.value })} style={{ flex: 1 }} />
        <button type="button" style={zb} onClick={() => onChange({ imageZoom: Math.min(3, +(zoom + 0.1).toFixed(2)) })}>+</button>
      </div>
      <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>Arrastrá la imagen para reposicionarla y usá el zoom para ajustarla a tu gusto.</p>
    </div>
  )
}

// Selector del evento que dispara la acción (pestaña Acciones del inspector).
// Nota: hoy el viewer ejecuta la acción al hacer clic/tap. Los demás disparadores
// (hover, mantener presionado, al cargar) quedan guardados para soporte futuro.
const TRIGGERS: { key: string; label: string }[] = [
  { key: 'click', label: 'Al hacer clic' },
  { key: 'hover', label: 'Al pasar el cursor' },
  { key: 'hold',  label: 'Mantener presionado' },
  { key: 'load',  label: 'Al cargar la página' },
]
function TriggerSelector({ data, setData }: { data: any; setData: (p: any) => void }) {
  const trigger = data.trigger ?? 'click'
  return (
    <PropGroup label="Evento disparador">
      <select style={s.propInput} value={trigger} onChange={(e) => setData({ trigger: e.target.value })}>
        {TRIGGERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      {trigger !== 'click' && <p style={cp.hint}>El disparador "{TRIGGERS.find((t) => t.key === trigger)?.label}" se guardará; por ahora el visor ejecuta la acción al hacer clic/tap (soporte ampliado próximamente).</p>}
    </PropGroup>
  )
}

// Editor de acción reutilizable (botones y zonas de enlace)
function ActionEditor({
  data,
  pages,
  setData,
  targets = [],
  openImageBank,
}: {
  data: any
  pages: any[]
  setData: (p: any) => void
  targets?: { id: string; name: string }[]
  openImageBank?: OpenWidgetGalleryMediaPicker
}) {
  const action = data.action ?? { type: 'link' }
  const setAction = (patch: any) => setData({ action: { ...action, ...patch } })
  const current = action.type ?? 'none'

  return (
    <>
      <PropGroup label="Tipo de acción">
        <div style={s.actionGrid}>
          <button
            style={{ ...s.actionCard, ...(current === 'none' ? s.actionCardActive : {}) }}
            onClick={() => setAction({ type: 'none' })}
            title="Sin acción"
          >
            <Icon name="circle" size={16} />
            <span style={s.actionCardLabel}>Ninguna</span>
          </button>
          {ACTION_TYPES.map((a) => (
            <button
              key={a.type}
              style={{ ...s.actionCard, ...(current === a.type ? s.actionCardActive : {}) }}
              onClick={() => setAction({ type: a.type })}
              title={a.label}
            >
              <Icon name={a.icon} size={16} />
              <span style={s.actionCardLabel}>{a.label}</span>
            </button>
          ))}
        </div>
      </PropGroup>

      {action.type === 'link' && (
        <>
          <PropGroup label="URL">
            <input style={s.propInput} placeholder="https://..." defaultValue={action.url ?? 'https://'} onChange={(e) => setAction({ url: e.target.value })} />
          </PropGroup>
          <PropGroup label="Abrir en">
            <select style={s.propInput} value={action.target ?? '_blank'} onChange={(e) => setAction({ target: e.target.value })}>
              <option value="_blank">Nueva pestaña</option>
              <option value="_self">Misma pestaña</option>
            </select>
          </PropGroup>
        </>
      )}

      {action.type === 'page' && (
        <PropGroup label="Ir a la página">
          <select style={s.propInput} value={action.page ?? 1} onChange={(e) => setAction({ page: +e.target.value })}>
            {pages.map((_: any, i: number) => <option key={i} value={i + 1}>Página {i + 1}</option>)}
          </select>
        </PropGroup>
      )}

      {action.type === 'call' && (
        <PropGroup label="Número de teléfono">
          <input style={s.propInput} placeholder="+1 809 000 0000" defaultValue={action.phone ?? ''} onChange={(e) => setAction({ phone: e.target.value })} />
        </PropGroup>
      )}

      {action.type === 'email' && (
        <>
          <PropGroup label="Correo">
            <input style={s.propInput} placeholder="correo@dominio.com" defaultValue={action.email ?? ''} onChange={(e) => setAction({ email: e.target.value })} />
          </PropGroup>
          <PropGroup label="Asunto (opcional)">
            <input style={s.propInput} defaultValue={action.subject ?? ''} onChange={(e) => setAction({ subject: e.target.value })} />
          </PropGroup>
        </>
      )}

      {action.type === 'popup_text' && (
        <PropGroup label="Texto a mostrar">
          <textarea style={{ ...s.propInput, height: 80, resize: 'vertical' } as any} defaultValue={action.text ?? ''} onChange={(e) => setAction({ text: e.target.value })} />
        </PropGroup>
      )}

      {action.type === 'popup_image' && (
        <PropGroup label="Imagen emergente">
          <ImageBankUrlField value={action.image ?? ''} onChange={(url) => setAction({ image: url })} onOpenBank={() => openImageBank?.({ type: 'field', field: 'image' })} />
          {action.image && (
            <ImageFitToggle
              url={action.image}
              fitMap={action.fit ?? {}}
              setFit={(url, f) => setAction({ fit: { ...(action.fit ?? {}), [url]: f } })}
              aspect={4 / 3}
            />
          )}
        </PropGroup>
      )}

      {action.type === 'whatsapp' && (
        <>
          <PropGroup label="Número (código de país sin +)">
            <input style={s.propInput} placeholder="18095551234" defaultValue={action.phone ?? ''} onChange={(e) => setAction({ phone: e.target.value })} />
          </PropGroup>
          <PropGroup label="Mensaje prellenado (opcional)">
            <input style={s.propInput} defaultValue={action.message ?? ''} onChange={(e) => setAction({ message: e.target.value })} />
          </PropGroup>
        </>
      )}

      {action.type === 'popup_video' && (
        <PropGroup label="URL del video (YouTube, Vimeo o .mp4)">
          <input style={s.propInput} placeholder="https://youtube.com/watch?v=..." defaultValue={action.url ?? ''} onChange={(e) => setAction({ url: e.target.value })} />
        </PropGroup>
      )}

      {action.type === 'popup_audio' && (
        <PropGroup label="Audio emergente">
          <FileField value={action.url ?? ''} onChange={(url) => setAction({ url })} accept={ACCEPT_AUDIO} preview={false} hint="MP3, OGG, WAV, M4A · máx 50 MB" />
        </PropGroup>
      )}

      {action.type === 'download' && (
        <>
          <PropGroup label="Archivo a descargar">
            <FileField value={action.url ?? ''} onChange={(url) => setAction({ url })} accept={ACCEPT_FILE} preview={false} hint="PDF, ZIP, Office, imágenes · máx 50 MB" />
          </PropGroup>
          <PropGroup label="Nombre del archivo (opcional)">
            <input style={s.propInput} placeholder="catalogo.pdf" defaultValue={action.filename ?? ''} onChange={(e) => setAction({ filename: e.target.value })} />
          </PropGroup>
        </>
      )}

      {action.type === 'gallery_images' && (
        <GalleryImagesEditor action={action} setAction={setAction} openImageBank={openImageBank} />
      )}

      {action.type === 'gallery_videos' && (
        <GalleryVideosEditor action={action} setAction={setAction} />
      )}

      {action.type === 'show_hide' && (
        <PropGroup label="Elemento a mostrar u ocultar">
          {targets.length === 0 ? (
            <p style={cp.hint}>
              Primero selecciona el elemento objetivo y dale un nombre en su panel de propiedades. Luego vuelve aqui a configurar la accion.
            </p>
          ) : (
            <select style={s.propInput} value={action.target ?? ''} onChange={(e) => setAction({ target: e.target.value })}>
              <option value="">-- Selecciona un elemento --</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <p style={{ ...cp.hint, marginTop: 6 }}>
            El viewer oculta el elemento al cargar la pagina para que el primer clic lo muestre.
          </p>
        </PropGroup>
      )}
      {action.type === 'show_hide' && (
        <PropGroup label="Cierre automatico (segundos)">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number" min={0} max={300} step={1}
              style={{ ...s.propInput, width: 80 }}
              placeholder="0"
              value={action.dismissAfter ?? ''}
              onChange={(e) => setAction({ dismissAfter: e.target.value ? +e.target.value : undefined })}
            />
            <span style={{ fontSize: 12, color: '#6b7280' }}>seg - 0 = solo manual</span>
          </div>
          <p style={{ ...cp.hint, marginTop: 4 }}>
            El elemento se cierra solo tras N segundos. El boton X Cerrar siempre aparece flotando.
          </p>
        </PropGroup>
      )}

      {action.type === 'popup_message' && (
        <>
          <PropGroup label="Mensaje">
            <textarea style={{ ...s.propInput, height: 64, resize: 'vertical' } as any} placeholder="¡Gracias por tu interés!" defaultValue={action.message ?? ''} onChange={(e) => setAction({ message: e.target.value })} />
          </PropGroup>
          <PropGroup label="Estilo">
            <select style={s.propInput} value={action.style ?? 'info'} onChange={(e) => setAction({ style: e.target.value })}>
              <option value="info">Información (azul)</option>
              <option value="success">Éxito (verde)</option>
              <option value="warning">Advertencia (ámbar)</option>
              <option value="promo">Promoción (índigo)</option>
            </select>
          </PropGroup>
          <PropGroup label="Duración (segundos)">
            <input style={s.propInput} type="number" min={1} max={15} defaultValue={action.duration ?? 4} onChange={(e) => setAction({ duration: +e.target.value })} />
          </PropGroup>
        </>
      )}

      {action.type === 'show_comment' && (
        <>
          <PropGroup label="Comentario">
            <textarea style={{ ...s.propInput, height: 80, resize: 'vertical' } as any} defaultValue={action.text ?? ''} onChange={(e) => setAction({ text: e.target.value })} />
          </PropGroup>
          <PropGroup label="Autor (opcional)">
            <input style={s.propInput} placeholder="Nombre" defaultValue={action.author ?? ''} onChange={(e) => setAction({ author: e.target.value })} />
          </PropGroup>
          <PropGroup label="Fecha (opcional)">
            <input style={s.propInput} placeholder="ej: 12 jun 2026" defaultValue={action.date ?? ''} onChange={(e) => setAction({ date: e.target.value })} />
          </PropGroup>
        </>
      )}

      {action.type === 'copy_text' && (
        <>
          <PropGroup label="Texto a copiar">
            <textarea style={{ ...s.propInput, height: 64, resize: 'vertical' } as any} placeholder="Ej: código de descuento, dirección…" defaultValue={action.text ?? ''} onChange={(e) => setAction({ text: e.target.value })} />
          </PropGroup>
          <PropGroup label="Confirmación (opcional)">
            <input style={s.propInput} placeholder="¡Copiado!" defaultValue={action.confirm ?? ''} onChange={(e) => setAction({ confirm: e.target.value })} />
          </PropGroup>
        </>
      )}

      {current !== 'none' && (
        <TrackingControl value={data.tracking} onChange={(t) => setData({ tracking: t })} />
      )}
    </>
  )
}

// ─── Editor de galería de imágenes ────────────────────────────────────────────
function GalleryImagesEditor({ action, setAction, openImageBank }: { action: any; setAction: (p: any) => void; openImageBank?: OpenWidgetGalleryMediaPicker }) {
  const images: string[] = action.images ?? []
  const cover: string = action.cover ?? images[0] ?? ''
  const fitMap: Record<string, ImgFit> = action.fit ?? {}
  const setFit = (url: string, f: ImgFit) => setAction({ fit: { ...fitMap, [url]: f } })

  function setImages(next: string[]) {
    setAction({ images: next, cover: next.includes(cover) ? cover : (next[0] ?? '') })
  }

  function addImage() {
    openImageBank?.({ type: 'add', max: 20 })
  }

  function updateImage(i: number, url: string) {
    const next = [...images]
    next[i] = url
    setImages(next)
    if (!cover) setAction({ images: next, cover: url })
  }

  function removeImage(i: number) {
    const next = images.filter((_, j) => j !== i)
    setImages(next)
  }

  return (
    <>
      <PropGroup label="Imágenes de la galería (máx. 20)">
        {images.map((url, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6 }}>
            <input
              style={{ ...s.propInput, flex: 1, fontSize: 11 }}
              placeholder="https://..."
              value={url}
              onChange={(e) => updateImage(i, e.target.value)}
            />
            <button
              type="button"
              style={{ ...s.alignBtn, fontSize: 11, padding: '4px 8px', flex: 'none', whiteSpace: 'nowrap' }}
              onClick={() => openImageBank?.({ type: 'replace', imageIndex: i })}
            >Banco</button>
            <button
              type="button"
              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}
              onClick={() => removeImage(i)}
            >✕</button>
          </div>
        ))}
        {images.filter(Boolean).map((url) => (
          <ImageFitToggle key={'fit-' + url} url={url} fitMap={fitMap} setFit={setFit} aspect={4 / 3} />
        ))}
        {images.length < 20 && (
          <button type="button" style={{ ...s.alignBtn, fontSize: 12 }} onClick={addImage}>Agregar imágenes</button>
        )}
      </PropGroup>
      {images.filter(Boolean).length > 0 && (
        <PropGroup label="Imagen de portada">
          <select
            style={s.propInput}
            value={cover}
            onChange={(e) => setAction({ cover: e.target.value })}
          >
            {images.filter(Boolean).map((url, i) => (
              <option key={i} value={url}>Imagen {i + 1}</option>
            ))}
          </select>
        </PropGroup>
      )}
    </>
  )
}

// ─── Editor de galería de videos ──────────────────────────────────────────────
function GalleryVideosEditor({ action, setAction }: { action: any; setAction: (p: any) => void }) {
  const videos: string[] = action.videos ?? []

  function setVideos(next: string[]) {
    setAction({ videos: next })
  }

  function addVideo() {
    setVideos([...videos, ''])
  }

  function updateVideo(i: number, url: string) {
    const next = [...videos]
    next[i] = url
    setVideos(next)
  }

  function removeVideo(i: number) {
    setVideos(videos.filter((_, j) => j !== i))
  }

  return (
    <PropGroup label="Videos de la galería (YouTube, Vimeo o MP4)">
      {videos.map((url, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6 }}>
          <input
            style={{ ...s.propInput, flex: 1, fontSize: 11 }}
            placeholder="https://youtube.com/watch?v=..."
            value={url}
            onChange={(e) => updateVideo(i, e.target.value)}
          />
          <button
            type="button"
            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}
            onClick={() => removeVideo(i)}
          >✕</button>
        </div>
      ))}
      <button type="button" style={{ ...s.alignBtn, fontSize: 12 }} onClick={addVideo}>+ Agregar video</button>
    </PropGroup>
  )
}

function StyleToggle({ active, onClick, label, bold, italic, underline }: any) {
  return (
    <button
      onClick={onClick}
      style={{
        ...s.alignBtn, flex: 1,
        fontWeight: bold ? 700 : 500, fontStyle: italic ? 'italic' : 'normal', textDecoration: underline ? 'underline' : 'none',
        ...(active ? s.alignActive : {}),
      }}
    >{label}</button>
  )
}

function PropGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid #f3f4f6' }}>
      <span style={s.propLabel}>{label}</span>
      {children}
    </div>
  )
}

function WidgetField({ label, children }: { label: string; children: React.ReactNode }) {
  return <PropGroup label={label}>{children}</PropGroup>
}

// Sección colapsable reutilizable del inspector (patrón del mockup).
function Collapsible({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 11px', background: '#f8fafc', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: '#374151', fontFamily: 'inherit' }}
      >
        <span>{title}</span>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: '#9ca3af' }}><Icon name="chevron" size={14} /></span>
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '11px' }}>{children}</div>}
    </div>
  )
}

// Animación continua (loop) del elemento. Se guarda en data.anim = { type, speed }.
// El viewer la reproduce en bucle; no depende de ningún clic.
const ANIMATIONS: { key: string; label: string }[] = [
  { key: '',       label: 'Sin animación' },
  { key: 'pulse',  label: 'Latido (pulse)' },
  { key: 'float',  label: 'Flotar (arriba/abajo)' },
  { key: 'spin',   label: 'Girar (360°)' },
  { key: 'shake',  label: 'Sacudida' },
  { key: 'bounce', label: 'Rebote' },
  { key: 'blink',  label: 'Parpadeo' },
]
function AnimationControl({ obj, setData }: { obj: any; setData: (p: any) => void }) {
  const anim = (obj as any).data?.anim ?? {}
  const type = anim.type ?? ''
  const speed = anim.speed ?? 1
  return (
    <PropGroup label="Animación (continua)">
      <select style={s.propInput} value={type} onChange={(e) => setData({ anim: { ...anim, type: e.target.value } })}>
        {ANIMATIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
      </select>
      {type && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Velocidad</span>
          <input type="range" min={0.3} max={2.5} step={0.1} defaultValue={speed} onChange={(e) => setData({ anim: { ...anim, type, speed: +e.target.value } })} style={{ flex: 1 }} />
        </div>
      )}
      {type && <p style={cp.hint}>La animación se reproduce en bucle en el flipbook publicado y en la "Vista previa" del proyecto (no en el editor, para no estorbar la edición).</p>}
    </PropGroup>
  )
}

// Animación de ENTRADA (estilo PowerPoint): se reproduce una vez al mostrarse la página.
// Aplica a cualquier elemento (texto, imagen, forma, icono, botón…). Config en data.entrance.
const ENTRANCE_TYPES = [
  { key: '', label: 'Sin animación' },
  { key: 'fade', label: 'Aparecer (fade)' },
  { key: 'slide', label: 'Deslizar' },
  { key: 'zoom', label: 'Zoom' },
  { key: 'flip', label: 'Voltear (flip)' },
  { key: 'bounce', label: 'Rebote' },
]
function EntranceControl({ obj, setData }: { obj: any; setData: (p: any) => void }) {
  const ent = (obj as any).data?.entrance ?? {}
  const type = ent.type ?? ''
  const patch = (p: any) => setData({ entrance: { ...ent, ...p } })
  return (
    <PropGroup label="Animación de entrada">
      <select style={s.propInput} value={type} onChange={(e) => patch({ type: e.target.value })}>
        {ENTRANCE_TYPES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
      </select>
      {(type === 'slide' || type === 'flip') && (
        <div style={{ marginTop: 6 }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Dirección</span>
          <select style={s.propInput} value={ent.direction ?? 'up'} onChange={(e) => patch({ direction: e.target.value })}>
            <option value="up">Desde arriba</option>
            <option value="down">Desde abajo</option>
            <option value="left">Desde la izquierda</option>
            <option value="right">Desde la derecha</option>
          </select>
        </div>
      )}
      {type && (
        <>
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 11, color: '#6b7280' }}>Velocidad</span>
            <select style={s.propInput} value={ent.speed ?? 'normal'} onChange={(e) => patch({ speed: e.target.value })}>
              <option value="slow">Lenta</option>
              <option value="normal">Normal</option>
              <option value="fast">Rápida</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 11, color: '#6b7280' }}>Retardo (orden de aparición)</span>
            <input style={{ ...s.propInput, width: 70 }} type="number" min={0} max={20} step={0.1} defaultValue={ent.delay ?? 0} onChange={(e) => patch({ delay: +e.target.value })} />
            <span style={{ fontSize: 11, color: '#6b7280' }}>seg</span>
          </div>
          <p style={cp.hint}>Se reproduce al mostrarse la página en el flipbook publicado y en la "Vista previa". Usa el retardo para escalonar la aparición de varios elementos.</p>
        </>
      )}
    </PropGroup>
  )
}

// Sección de seguimiento (analítica) reutilizable — patrón del mockup (sección 0/8).
// value/onChange operan sobre un objeto { enabled, event, category, label }.
// El viewer respeta enabled=false (no registra) y usa label/category al registrar el clic.
function TrackingControl({ value, onChange }: { value: any; onChange: (t: any) => void }) {
  const t = value ?? {}
  const enabled = t.enabled !== false
  const patch = (p: any) => onChange({ ...t, ...p })
  return (
    <Collapsible title="Seguimiento (analítica)" defaultOpen={false}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#374151', cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        Registrar interacciones de este elemento
      </label>
      {enabled && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={s.propLabel}>Nombre del evento</span>
            <input style={s.propInput} placeholder="ej: clic_whatsapp" defaultValue={t.event ?? ''} onChange={(e) => patch({ event: e.target.value })} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={s.propLabel}>Categoría</span>
            <input style={s.propInput} placeholder="ej: Contacto" defaultValue={t.category ?? ''} onChange={(e) => patch({ category: e.target.value })} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={s.propLabel}>Etiqueta</span>
            <input style={s.propInput} placeholder="ej: Botón flotante WhatsApp" defaultValue={t.label ?? ''} onChange={(e) => patch({ label: e.target.value })} />
          </div>
          <p style={cp.hint}>La etiqueta aparece en Estadísticas. Desmarca la casilla para no registrar este elemento.</p>
        </>
      )}
    </Collapsible>
  )
}

// Aplica un gradiente fabric nativo a un objeto, dimensionado a su caja.
function applyGradientTo(target: any, c1: string, c2: string, type: 'linear' | 'radial', angle: number) {
  const w = target.width ?? 100, h = target.height ?? 100
  let coords: any
  if (type === 'radial') {
    coords = { x1: w / 2, y1: h / 2, r1: 0, x2: w / 2, y2: h / 2, r2: Math.max(w, h) / 2 }
  } else {
    const rad = (angle * Math.PI) / 180
    const cx = w / 2, cy = h / 2
    const dx = Math.cos(rad) * cx, dy = Math.sin(rad) * cy
    coords = { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy }
  }
  target.set('fill', new (fabric as any).Gradient({
    type, coords, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }],
  }))
}

// ─── Control universal de RELLENO: sólido o gradiente (lineal / radial) ───────
// Reutilizable en formas, texto, botones (target = rect) y otros objetos con `fill`.
// `obj` guarda la metadata; `target` (por defecto = obj) recibe el fill real.
function FillControl({ obj, canvas, onChange, defaultColor = '#4f46e5', target, label = 'Relleno', afterApply }: { obj: any; canvas: any; onChange: () => void; defaultColor?: string; target?: any; label?: string; afterApply?: () => void }) {
  const tgt = target ?? obj
  const data = (obj as any).data ?? {}
  const g = data.fillGradient ?? null
  const [mode, setMode] = React.useState<'solid' | 'gradient'>(g ? 'gradient' : 'solid')
  const [c1, setC1] = React.useState<string>(g?.c1 ?? (typeof tgt.fill === 'string' && tgt.fill.startsWith('#') ? tgt.fill : defaultColor))
  const [c2, setC2] = React.useState<string>(g?.c2 ?? '#ec4899')
  const [gtype, setGtype] = React.useState<'linear' | 'radial'>(g?.type ?? 'linear')
  const [angle, setAngle] = React.useState<number>(g?.angle ?? 0)

  function applySolid(color: string) {
    tgt.set('fill', color)
    obj.data = { ...(obj.data ?? {}), fillGradient: undefined }
    obj.dirty = true; afterApply?.(); canvas?.requestRenderAll(); onChange()
  }

  function applyGradient(nextC1 = c1, nextC2 = c2, type = gtype, ang = angle) {
    applyGradientTo(tgt, nextC1, nextC2, type, ang)
    obj.data = { ...(obj.data ?? {}), fillGradient: { c1: nextC1, c2: nextC2, type, angle: ang } }
    obj.dirty = true; afterApply?.(); canvas?.requestRenderAll(); onChange()
  }

  return (
    <PropGroup label={label}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
        <button style={{ ...s.alignBtn, flex: 1, fontSize: 11, ...(mode === 'solid' ? s.alignActive : {}) }}
          onClick={() => { setMode('solid'); applySolid(c1) }}>Sólido</button>
        <button style={{ ...s.alignBtn, flex: 1, fontSize: 11, ...(mode === 'gradient' ? s.alignActive : {}) }}
          onClick={() => { setMode('gradient'); applyGradient() }}>Gradiente</button>
      </div>
      {mode === 'solid' ? (
        <input type="color" value={c1} onChange={(e) => { setC1(e.target.value); applySolid(e.target.value) }} style={s.colorInput} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <span style={s.miniLabel}>Color 1</span>
              <input type="color" value={c1} onChange={(e) => { setC1(e.target.value); applyGradient(e.target.value, c2) }} style={s.colorInput} />
            </div>
            <div style={{ flex: 1 }}>
              <span style={s.miniLabel}>Color 2</span>
              <input type="color" value={c2} onChange={(e) => { setC2(e.target.value); applyGradient(c1, e.target.value) }} style={s.colorInput} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button style={{ ...s.alignBtn, flex: 1, fontSize: 11, ...(gtype === 'linear' ? s.alignActive : {}) }}
              onClick={() => { setGtype('linear'); applyGradient(c1, c2, 'linear') }}>Lineal</button>
            <button style={{ ...s.alignBtn, flex: 1, fontSize: 11, ...(gtype === 'radial' ? s.alignActive : {}) }}
              onClick={() => { setGtype('radial'); applyGradient(c1, c2, 'radial') }}>Radial</button>
          </div>
          {gtype === 'linear' && (
            <div style={{ marginTop: 6 }}>
              <span style={s.miniLabel}>Ángulo: {angle}°</span>
              <input type="range" min={0} max={360} step={5} value={angle}
                onChange={(e) => { const a = +e.target.value; setAngle(a); applyGradient(c1, c2, 'linear', a) }}
                style={{ width: '100%', accentColor: '#4F46E5' }} />
            </div>
          )}
        </>
      )}
    </PropGroup>
  )
}

// ─── Control universal de SOMBRA ──────────────────────────────────────────────
// Aplica un `fabric.Shadow` nativo a cualquier objeto.
function ShadowControl({ obj, canvas, onChange }: { obj: any; canvas: any; onChange: () => void }) {
  const sh = obj.shadow
  const [on, setOn] = React.useState<boolean>(!!sh)
  const [color, setColor] = React.useState<string>(sh?.color ?? '#00000066')
  const [blur, setBlur] = React.useState<number>(sh?.blur ?? 10)
  const [offX, setOffX] = React.useState<number>(sh?.offsetX ?? 4)
  const [offY, setOffY] = React.useState<number>(sh?.offsetY ?? 4)

  function apply(enabled: boolean, c = color, b = blur, ox = offX, oy = offY) {
    if (!enabled) { obj.set('shadow', null) }
    else { obj.set('shadow', new (fabric as any).Shadow({ color: c, blur: b, offsetX: ox, offsetY: oy })) }
    canvas?.requestRenderAll(); onChange()
  }

  return (
    <PropGroup label="Sombra">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
        <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); apply(e.target.checked) }} style={{ accentColor: '#4F46E5' }} />
        Activar sombra
      </label>
      {on && (
        <>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
            <input type="color" value={color.slice(0, 7)} onChange={(e) => { const c = e.target.value + '99'; setColor(c); apply(true, c) }} style={{ ...s.colorInput, width: 48 }} />
            <div style={{ flex: 1 }}>
              <span style={s.miniLabel}>Desenfoque: {blur}</span>
              <input type="range" min={0} max={40} step={1} value={blur} onChange={(e) => { const b = +e.target.value; setBlur(b); apply(true, color, b) }} style={{ width: '100%', accentColor: '#4F46E5' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <div style={{ flex: 1 }}>
              <span style={s.miniLabel}>Desp. X: {offX}</span>
              <input type="range" min={-30} max={30} step={1} value={offX} onChange={(e) => { const v = +e.target.value; setOffX(v); apply(true, color, blur, v) }} style={{ width: '100%', accentColor: '#4F46E5' }} />
            </div>
            <div style={{ flex: 1 }}>
              <span style={s.miniLabel}>Desp. Y: {offY}</span>
              <input type="range" min={-30} max={30} step={1} value={offY} onChange={(e) => { const v = +e.target.value; setOffY(v); apply(true, color, blur, offX, v) }} style={{ width: '100%', accentColor: '#4F46E5' }} />
            </div>
          </div>
        </>
      )}
    </PropGroup>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  root:    { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280', fontSize: 15 },

  topBar:   { display: 'flex', alignItems: 'center', height: 52, padding: '0 16px', background: '#1e1b4b', flexShrink: 0 },
  topLeft:  { display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  topCenter:{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 120, flexShrink: 0 },
  topRight: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  backLink: { color: 'rgba(255,255,255,0.7)', fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 },
  pubTitle: { fontWeight: 700, fontSize: 14, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  breadcrumb: { fontSize: 13, color: 'rgba(255,255,255,0.65)', fontWeight: 500 },
  saveInd:   { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 500, whiteSpace: 'nowrap', minWidth: 96, textAlign: 'right' as const },
  btnOutlineWhite: { background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  btnPublish: { border: 'none', color: '#fff', borderRadius: 6, padding: '6px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 },
  deepLinkNotice: { flexShrink: 0, borderBottom: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', padding: '8px 16px', fontSize: 12, fontWeight: 700 },
  editorClipboardNotice: { flexShrink: 0, borderBottom: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', padding: '8px 16px', fontSize: 12, fontWeight: 700 },

  body: { display: 'flex', flex: 1, overflow: 'hidden' },

  rail:    { width: 68, minWidth: 68, background: '#1a1827', display: 'flex', flexDirection: 'column', padding: '6px 0', overflowY: 'auto' },
  railBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: '11px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, borderLeft: '3px solid transparent', transition: 'color .15s, background .15s' },
  railBtnActive: { color: '#fff', background: 'rgba(129,140,248,0.18)', borderLeftColor: '#818cf8' },
  railLabel:{ fontSize: 9.5, fontWeight: 500 },

  panel: { width: 268, minWidth: 268, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', padding: 14, overflowY: 'auto' },

  center:    { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#e8eaed' },
  toolbar:   { display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', height: 44, background: '#fff', borderBottom: '1px solid #e5e7eb', flexShrink: 0, overflowX: 'auto' } as React.CSSProperties,
  toolBtn:   { background: 'none', border: '1px solid transparent', borderRadius: 8, width: 34, height: 34, minWidth: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', flexShrink: 0 },
  toolSep:   { width: 1, height: 20, background: '#e5e7eb', margin: '0 6px' },
  ctxOverlay:{ position: 'fixed', inset: 0, zIndex: 4000 },
  ctxMenu:   { position: 'fixed', zIndex: 4001, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 10px 40px rgba(0,0,0,0.18)', padding: 6, minWidth: 190, maxHeight: '80vh', overflowY: 'auto' },
  ctxItem:   { display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: 'none', background: 'transparent', borderRadius: 7, padding: '7px 10px', fontSize: 13, color: '#374151', cursor: 'pointer', textAlign: 'left' as const },
  ctxSep:    { height: 1, background: '#f0f0f0', margin: '4px 0' },
  zoomGroup: { display: 'flex', gap: 2 },
  zoomBtn:   { background: 'none', border: '1px solid transparent', borderRadius: 12, padding: '3px 9px', fontSize: 11, cursor: 'pointer', color: '#6b7280', fontWeight: 500 },
  zoomActive:{ background: '#f3f4f6', borderColor: '#e5e7eb', color: '#111827', fontWeight: 600 },
  canvasWrap:  { flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: 32, alignItems: 'flex-start' },
  canvasLoadingOverlay: { position: 'absolute', inset: 0, background: 'rgba(249,250,251,0.86)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
  canvasLoadingText: { fontSize: 14, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', boxShadow: '0 8px 24px rgba(15,23,42,0.12)' },
  adjustBar:   { display: 'flex', alignItems: 'center', gap: 14, padding: '8px 16px', background: '#eef2ff', borderBottom: '1px solid #c7d2fe', flexShrink: 0, flexWrap: 'wrap' } as React.CSSProperties,
  adjustReset: { background: '#fff', border: '1px solid #c7d2fe', borderRadius: 7, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: '#4338ca', cursor: 'pointer', fontFamily: 'inherit' } as React.CSSProperties,
  insTabs:   { display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', flexShrink: 0 } as React.CSSProperties,
  insTabBtn: { flex: 1, padding: '10px 8px', border: 'none', borderBottom: '2px solid transparent', background: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#6b7280', fontFamily: 'inherit' } as React.CSSProperties,
  insTabActive: { color: '#4F46E5', borderBottom: '2px solid #4F46E5' } as React.CSSProperties,
  actionGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 } as React.CSSProperties,
  actionCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 4px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', color: '#374151', fontFamily: 'inherit', minHeight: 56 } as React.CSSProperties,
  actionCardActive: { borderColor: '#4F46E5', background: '#eef2ff', color: '#4338ca' } as React.CSSProperties,
  actionCardLabel: { fontSize: 9.5, fontWeight: 600, textAlign: 'center', lineHeight: 1.15 } as React.CSSProperties,
  adjustDone:  { background: '#4F46E5', border: 'none', borderRadius: 7, padding: '5px 14px', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', marginLeft: 'auto' } as React.CSSProperties,
  pageNav:   { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 16px', background: '#fff', borderTop: '1px solid #e5e7eb', flexShrink: 0 },
  pageNavBtn: { background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, color: '#374151', transition: 'background .15s', fontFamily: 'inherit' } as React.CSSProperties,
  pageNavInfo:{ fontSize: 13, color: '#374151', fontWeight: 600, minWidth: 90, textAlign: 'center' as const },
  canvasEmpty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', cursor: 'pointer', borderRadius: 12, transition: 'background 0.2s' },

  right:      { width: 288, minWidth: 288, background: '#fff', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  rightHeader:{ fontSize: 13, fontWeight: 700, color: '#111827', padding: '14px 16px 10px', borderBottom: '1px solid #f3f4f6' },

  propsScroll: { display: 'flex', flexDirection: 'column', overflowY: 'auto', flex: 1, minHeight: 0 },
  props:     { padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 },
  propLabel: { fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  miniLabel: { fontSize: 10, color: '#9ca3af', display: 'block', marginBottom: 4 },
  propInput: { border: '1px solid #e5e7eb', borderRadius: 6, padding: '7px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const, background: '#fff' },
  colorInput:{ width: '100%', height: 34, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', padding: 2, boxSizing: 'border-box' as const },
  axisLabel: { fontSize: 11, color: '#9ca3af', textAlign: 'center' as const },
  alignBtn:  { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '7px 0', fontSize: 14, cursor: 'pointer', color: '#374151', flex: 1 },
  alignActive: { background: '#eef2ff', borderColor: '#4f46e5', color: '#4f46e5' },
  stepBtn:   { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, width: 32, height: 34, fontSize: 18, lineHeight: 1, cursor: 'pointer', color: '#374151', flex: 'none' } as React.CSSProperties,
  actionDivider: { fontSize: 12, fontWeight: 700, color: '#4f46e5', borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 2 },
  deleteBtn: { background: '#fff', color: '#ef4444', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', cursor: 'pointer', width: '100%', fontSize: 13, fontWeight: 500, marginTop: 4 },
}

const cp: Record<string, React.CSSProperties> = {
  title:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 12 },
  titleCount: { fontSize: 11, color: '#6b7280', background: '#f3f4f6', borderRadius: 10, padding: '1px 7px' },
  thumbList:  { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, borderRadius: 8 },
  thumbItem:  { position: 'relative', cursor: 'pointer', borderRadius: 6, overflow: 'hidden', border: '2px solid transparent', transition: 'border-color .15s', background: '#f8fafc', aspectRatio: '0.707' },
  thumbImg:   { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' as const, display: 'block' },
  thumbSkeleton: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #f8fafc 0%, #eef2f7 100%)', color: '#94a3b8', fontSize: 10, fontWeight: 700 },
  thumbSkeletonText: { background: 'rgba(255,255,255,0.78)', border: '1px solid #e5e7eb', borderRadius: 4, padding: '3px 7px' },
  thumbNum:   { position: 'absolute', bottom: 4, left: 6, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3 },
  thumbDel:   { position: 'absolute', top: 4, right: 4, background: 'rgba(239,68,68,0.9)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, width: 20, height: 20, cursor: 'pointer', padding: 0 },
  thumbStatus:{ position: 'absolute', bottom: 4, right: 6, background: 'rgba(239,68,68,0.92)', color: '#fff', fontSize: 11, fontWeight: 800, width: 18, height: 18, lineHeight: '18px', textAlign: 'center', borderRadius: 999 },
  primaryBtn: { width: '100%', background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  secondaryBtn: { width: '100%', background: '#fff', color: '#4F46E5', border: '1.5px solid #4F46E5', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginTop: 8 },
  search:     { width: '100%', boxSizing: 'border-box' as const, border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 12 },
  empty:      { fontSize: 12, color: '#9ca3af', textAlign: 'center' as const, padding: '20px 0' },
  hint:       { fontSize: 11, color: '#9ca3af', marginTop: 10, marginBottom: 4, lineHeight: 1.5 },
  tplGrid:        { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  tplCard:        { border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', position: 'relative' as const },
  tplCardLocked:  { cursor: 'not-allowed', opacity: 0.85 },
  tplImg:         { width: '100%', aspectRatio: '0.707', objectFit: 'cover' as const, display: 'block' },
  tplPlaceholder: { width: '100%', aspectRatio: '0.707', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', color: '#94a3b8' },
  tplLockOverlay: { position: 'absolute' as const, top: 4, right: 6, fontSize: 16, lineHeight: 1 },
  tplName:        { fontSize: 11, padding: '6px 8px', color: '#374151', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  stack:      { display: 'flex', flexDirection: 'column', gap: 8 },
  listBtn:    { display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#374151', textAlign: 'left' as const },
  shapeGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  shapeBtn:   { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, height: 72, border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', color: '#374151' },
  shapeLabel: { fontSize: 11, color: '#6b7280' },
  btnList:    { display: 'flex', flexDirection: 'column', gap: 8 },
  previewBtn: { width: '100%', padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  widgetCard: { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, height: 72, border: '1px solid #e5e7eb', borderRadius: 8, color: '#475569', background: '#fff' },
  widgetLabel:{ fontSize: 10, color: '#6b7280', textAlign: 'center' as const, lineHeight: 1.2 },
  crown:      { position: 'absolute', top: 4, right: 5, fontSize: 11, color: '#f59e0b' },
  sectionLabel:{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '16px 0 8px' },
  fontList:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  fontBtn:    { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, height: 64, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', color: '#111827' },
  fontBtnActive:{ borderColor: '#4F46E5', background: '#eef2ff', boxShadow: '0 0 0 1px #4F46E5 inset' },
  fontName:   { fontSize: 10, color: '#6b7280', fontFamily: 'Inter, sans-serif' },
  iconGrid:   { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 },
  iconBtn:    { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, height: 64, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', color: '#334155' },
  iconName:   { fontSize: 9, color: '#9ca3af', lineHeight: 1 },
  bankGrid:   { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 4 },
  bankItemWrap: { position: 'relative' as const, aspectRatio: '1' },
  bankItem:   { position: 'relative' as const, padding: 0, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', cursor: 'pointer', background: '#fff', width: '100%', height: '100%', display: 'block' },
  bankImg:    { width: '100%', height: '100%', objectFit: 'cover' as const, display: 'block' },
  bankFallback: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', color: '#64748b', fontSize: 11, fontWeight: 800 },
  bankFolderNav: { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginBottom: 8 },
  bankFolderBtn: { flex: '0 0 auto', border: '1px solid #e5e7eb', background: '#fff', color: '#475569', borderRadius: 7, padding: '6px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  bankFolderActive: { borderColor: '#4F46E5', background: '#eef2ff', color: '#3730a3' },
  bankFolderBadge: { position: 'absolute' as const, left: 4, right: 4, bottom: 4, background: 'rgba(15,23,42,0.78)', color: '#fff', borderRadius: 4, padding: '2px 4px', fontSize: 9, fontWeight: 800, textAlign: 'center' as const, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  bankMoreBtn: { width: '100%', marginTop: 8, background: '#fff', color: '#4F46E5', border: '1px solid #c7d2fe', borderRadius: 7, padding: '8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  legacyOptimizeBox: { border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, marginBottom: 8, background: '#f8fafc' },
  legacyOptimizeTop: { display: 'grid', gridTemplateColumns: '1fr', gap: 6, fontSize: 12, color: '#475569', fontWeight: 700 },
  bankDelBtn: { position: 'absolute' as const, top: 3, right: 3, width: 20, height: 20, padding: 0, border: 'none', borderRadius: '50%', background: 'rgba(220,38,38,.92)', color: '#fff', fontSize: 11, lineHeight: '20px', textAlign: 'center' as const, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.3)' },
}

const cfg: Record<string, React.CSSProperties> = {
  groupLabel: { fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8 },
  sizeBox:    { flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 10px', fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 },
  sizeLabel:  { fontSize: 10, color: '#9ca3af', fontWeight: 700 },
  scheme:     { display: 'flex', alignItems: 'center', gap: 8, padding: 6, border: '1px solid #f3f4f6', borderRadius: 8 },
  swatch:     { width: 18, height: 18, borderRadius: 4, cursor: 'pointer', display: 'inline-block' },
  schemeName: { fontSize: 11, color: '#6b7280' },
  applyAll:   { width: '100%', marginTop: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 6, padding: '7px', fontSize: 12, color: '#374151', cursor: 'pointer', fontWeight: 500 },
}

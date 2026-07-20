export const IMAGE_OPTIMIZATION_VERSION = 'phase1b-2026-07'
export const DISPLAY_MAX_SIDE = 2400
export const THUMBNAIL_MAX_SIDE = 360
export const DISPLAY_WEBP_QUALITY = 0.84
export const THUMBNAIL_WEBP_QUALITY = 0.76

export type OptimizationStatus =
  | 'optimized'
  | 'kept_original'
  | 'skipped_animation'
  | 'skipped_svg'
  | 'thumbnail_only'
  | 'failed'

export type OptimizedImageResult = {
  originalFile: File
  displayFile: File
  thumbnailFile: File
  metadata: {
    original_name: string
    original_mime_type: string
    original_size_bytes: number
    original_width: number | null
    original_height: number | null
    optimized_mime_type: string
    optimized_size_bytes: number
    optimized_width: number | null
    optimized_height: number | null
    thumbnail_size_bytes: number
    thumbnail_width: number | null
    thumbnail_height: number | null
    compression_saved_bytes: number
    compression_saved_percent: number
    optimization_status: OptimizationStatus
    optimization_version: string
  }
}

export type BatchOptimizationResult = {
  index: number
  file: File
  result?: OptimizedImageResult
  error?: string
}

export function fitWithin(width: number, height: number, maxSide: number) {
  if (!width || !height || width <= 0 || height <= 0) return { width: null, height: null }
  const largest = Math.max(width, height)
  const scale = largest > maxSide ? maxSide / largest : 1
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function compressionMetrics(originalSize: number, optimizedSize: number) {
  const saved = Math.max(0, originalSize - optimizedSize)
  return {
    compression_saved_bytes: saved,
    compression_saved_percent: originalSize > 0 ? Math.round((saved / originalSize) * 1000) / 10 : 0,
  }
}

export function shouldKeepOriginal(originalSize: number, optimizedSize: number) {
  return optimizedSize >= originalSize
}

export async function optimizeImagesBatch(files: File[], opts: {
  concurrency?: number
  onProgress?: (message: string, index: number, total: number) => void
} = {}) {
  const concurrency = Math.max(1, Math.min(3, opts.concurrency ?? 2))
  const results: BatchOptimizationResult[] = new Array(files.length)
  let cursor = 0
  let active = 0

  return new Promise<BatchOptimizationResult[]>((resolve) => {
    const pump = () => {
      if (cursor >= files.length && active === 0) {
        resolve(results)
        return
      }
      while (active < concurrency && cursor < files.length) {
        const index = cursor++
        const file = files[index]
        active += 1
        opts.onProgress?.(`Optimizando ${index + 1} de ${files.length}`, index, files.length)
        optimizeImageFile(file)
          .then((result) => { results[index] = { index, file, result } })
          .catch((error) => { results[index] = { index, file, error: error?.message ?? 'No se pudo optimizar' } })
          .finally(() => {
            active -= 1
            pump()
          })
      }
    }
    pump()
  })
}

export async function optimizeImageFile(file: File): Promise<OptimizedImageResult> {
  const mime = file.type || 'application/octet-stream'
  if (mime === 'image/gif') return optimizeAnimationPreservingOriginal(file)
  if (mime === 'image/svg+xml') return optimizeSvgPreservingOriginal(file)
  if (!mime.startsWith('image/')) throw new Error('El archivo no es una imagen compatible.')

  const source = await decodeImage(file)
  const displaySize = fitWithin(source.width, source.height, DISPLAY_MAX_SIDE)
  const thumbSize = fitWithin(source.width, source.height, THUMBNAIL_MAX_SIDE)
  if (!displaySize.width || !displaySize.height || !thumbSize.width || !thumbSize.height) {
    throw new Error('No se pudieron leer las dimensiones de la imagen.')
  }

  const displayBlob = await renderImageBlob(source, displaySize.width, displaySize.height, 'image/webp', DISPLAY_WEBP_QUALITY)
  const thumbnailBlob = await renderImageBlob(source, thumbSize.width, thumbSize.height, 'image/webp', THUMBNAIL_WEBP_QUALITY)
  const keepOriginal = shouldKeepOriginal(file.size, displayBlob.size)
  const displayFile = keepOriginal
    ? file
    : new File([displayBlob], replaceExtension(file.name, 'webp'), { type: 'image/webp' })
  const thumbnailFile = new File([thumbnailBlob], withSuffix(file.name, 'thumb', 'webp'), { type: 'image/webp' })
  const optimizedSize = displayFile.size
  const metrics = compressionMetrics(file.size, optimizedSize)

  cleanupImageSource(source)
  return {
    originalFile: file,
    displayFile,
    thumbnailFile,
    metadata: {
      original_name: file.name,
      original_mime_type: mime,
      original_size_bytes: file.size,
      original_width: source.width,
      original_height: source.height,
      optimized_mime_type: displayFile.type || mime,
      optimized_size_bytes: optimizedSize,
      optimized_width: keepOriginal ? source.width : displaySize.width,
      optimized_height: keepOriginal ? source.height : displaySize.height,
      thumbnail_size_bytes: thumbnailFile.size,
      thumbnail_width: thumbSize.width,
      thumbnail_height: thumbSize.height,
      optimization_status: keepOriginal ? 'kept_original' : 'optimized',
      optimization_version: IMAGE_OPTIMIZATION_VERSION,
      ...metrics,
    },
  }
}

async function optimizeAnimationPreservingOriginal(file: File) {
  const thumb = await staticThumbnailOrOriginal(file, 'skipped_animation')
  return thumb
}

async function optimizeSvgPreservingOriginal(file: File) {
  const thumb = await staticThumbnailOrOriginal(file, 'skipped_svg')
  return thumb
}

async function staticThumbnailOrOriginal(file: File, status: OptimizationStatus): Promise<OptimizedImageResult> {
  try {
    const source = await decodeImage(file)
    const thumbSize = fitWithin(source.width, source.height, THUMBNAIL_MAX_SIDE)
    const thumbnailBlob = thumbSize.width && thumbSize.height
      ? await renderImageBlob(source, thumbSize.width, thumbSize.height, 'image/webp', THUMBNAIL_WEBP_QUALITY)
      : file
    const thumbnailFile = thumbnailBlob instanceof File
      ? thumbnailBlob
      : new File([thumbnailBlob], withSuffix(file.name, 'thumb', 'webp'), { type: 'image/webp' })
    cleanupImageSource(source)
    return buildOriginalResult(file, thumbnailFile, source.width, source.height, thumbSize.width, thumbSize.height, status)
  } catch {
    return buildOriginalResult(file, file, null, null, null, null, status)
  }
}

function buildOriginalResult(
  file: File,
  thumbnailFile: File,
  originalWidth: number | null,
  originalHeight: number | null,
  thumbnailWidth: number | null,
  thumbnailHeight: number | null,
  status: OptimizationStatus,
): OptimizedImageResult {
  return {
    originalFile: file,
    displayFile: file,
    thumbnailFile,
    metadata: {
      original_name: file.name,
      original_mime_type: file.type || 'application/octet-stream',
      original_size_bytes: file.size,
      original_width: originalWidth,
      original_height: originalHeight,
      optimized_mime_type: file.type || 'application/octet-stream',
      optimized_size_bytes: file.size,
      optimized_width: originalWidth,
      optimized_height: originalHeight,
      thumbnail_size_bytes: thumbnailFile.size,
      thumbnail_width: thumbnailWidth,
      thumbnail_height: thumbnailHeight,
      compression_saved_bytes: 0,
      compression_saved_percent: 0,
      optimization_status: status,
      optimization_version: IMAGE_OPTIMIZATION_VERSION,
    },
  }
}

async function decodeImage(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ image: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen.'))
    }
    img.src = url
  })
}

function cleanupImageSource(source: { close?: () => void }) {
  try { source.close?.() } catch {}
}

function renderImageBlob(source: { image: CanvasImageSource }, width: number, height: number, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('No se pudo preparar el canvas de optimización.'))
      return
    }
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(source.image, 0, 0, width, height)
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('No se pudo generar la imagen optimizada.'))
      else resolve(blob)
    }, type, quality)
  })
}

function replaceExtension(name: string, ext: string) {
  return `${name.replace(/\.[^.]+$/, '') || 'imagen'}.${ext}`
}

function withSuffix(name: string, suffix: string, ext: string) {
  return `${name.replace(/\.[^.]+$/, '') || 'imagen'}-${suffix}.${ext}`
}

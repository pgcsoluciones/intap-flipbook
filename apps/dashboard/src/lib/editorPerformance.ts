export const PAGE_THUMBNAIL_PAGE_SIZE = 12
export const PAGE_THUMBNAIL_MARGIN = 2

export type PageLike = {
  id: string
  image_url?: string | null
  canvas_json?: unknown
  cover_json?: unknown
  updated_at?: string | null
  thumbnail_version?: string | number | null
}

export function stableString(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function normalizeCanvasTextBaseline(value: unknown) {
  return value === 'alphabetical' ? 'alphabetic' : value
}

export function pageThumbnailCacheKey(page: PageLike) {
  return [
    page.id,
    page.thumbnail_version ?? page.updated_at ?? '',
    page.image_url ?? '',
    stableString(page.cover_json),
    stableString(page.canvas_json),
  ].join('|')
}

export function patchPageThumbnailContent<T extends PageLike>(
  pages: T[],
  pageId: string,
  canvasJson: unknown,
  thumbnailVersion: string | number,
) {
  return upsertPageById(pages, pageId, {
    canvas_json: canvasJson,
    thumbnail_version: thumbnailVersion,
  } as Partial<T>)
}

export function thumbnailJobStillCurrent(
  currentToken: number | undefined,
  jobToken: number,
  currentPage: PageLike | null | undefined,
  jobCacheKey: string,
) {
  return currentToken === jobToken && !!currentPage && pageThumbnailCacheKey(currentPage) === jobCacheKey
}

export function resolvePageThumbnailOverlay<T extends { key: string; url: string; status?: string }>(
  page: PageLike,
  entry: T | null | undefined,
) {
  if (!entry) return { url: undefined, status: undefined }

  // Cuando cambia el canvas, la página recibe una nueva cache key antes de que
  // termine el render de la nueva miniatura. Conservamos el último overlay válido
  // para evitar que la tarjeta quede blanca durante el debounce y la cola de render.
  // replaceLocalPageThumbnail lo sustituirá de forma atómica cuando el nuevo blob
  // esté listo.
  return { url: entry.url, status: entry.status }
}

export function mergeSavedPagePreservingThumbnailVersion<T extends PageLike>(
  current: T | null | undefined,
  saved: Partial<T> | null | undefined,
  canvasJson: unknown,
) {
  return {
    ...(saved ?? {}),
    canvas_json: canvasJson,
    thumbnail_version: current?.thumbnail_version,
  } as Partial<T>
}

export function pageThumbCardPropsEqual(
  prev: {
    page: PageLike
    index: number
    active: boolean
    shouldLoad: boolean
    backgroundUrl: string
    overlayUrl?: string
    overlayStatus?: string
  },
  next: {
    page: PageLike
    index: number
    active: boolean
    shouldLoad: boolean
    backgroundUrl: string
    overlayUrl?: string
    overlayStatus?: string
  },
) {
  return (
    prev.page === next.page &&
    prev.index === next.index &&
    prev.active === next.active &&
    prev.shouldLoad === next.shouldLoad &&
    prev.backgroundUrl === next.backgroundUrl &&
    prev.overlayUrl === next.overlayUrl &&
    prev.overlayStatus === next.overlayStatus
  )
}

export function visibleIndexesFromRange(start: number, end: number, total: number, margin = PAGE_THUMBNAIL_MARGIN) {
  if (total <= 0) return new Set<number>()
  const safeStart = Math.max(0, Math.min(total - 1, start))
  const safeEnd = Math.max(safeStart, Math.min(total - 1, end))
  const first = Math.max(0, safeStart - margin)
  const last = Math.min(total - 1, safeEnd + margin)
  const indexes = new Set<number>()
  for (let index = first; index <= last; index += 1) indexes.add(index)
  return indexes
}

export function firstVisibleIndexes(total: number, pageSize = PAGE_THUMBNAIL_PAGE_SIZE) {
  return visibleIndexesFromRange(0, Math.min(total, pageSize) - 1, total, 0)
}

export function shouldLoadPageThumbnail(index: number, visibleIndexes: Set<number>) {
  return visibleIndexes.has(index)
}

export function normalizeUrlForLookup(url: string | null | undefined, normalize: (url: string) => string = (value) => value) {
  const raw = String(url ?? '').trim()
  return raw ? normalize(raw).trim() : ''
}

export function resolvePageImageThumbnailUrl(page: PageLike, thumbnailByUrl: Record<string, string>, normalize: (url: string) => string = (value) => value) {
  const imageUrl = normalizeUrlForLookup(page.image_url, normalize)
  if (!imageUrl) return ''
  return thumbnailByUrl[imageUrl] || imageUrl
}

export function resolveDisplayUrl(url: string | null | undefined, displayByUrl: Record<string, string>, normalize: (value: string) => string = (value) => value) {
  const safeUrl = normalizeUrlForLookup(url, normalize)
  if (!safeUrl) return ''
  return displayByUrl[safeUrl] || safeUrl
}

export function resolvePageCardBackgroundUrl(
  page: PageLike,
  thumbnailByUrl: Record<string, string>,
  displayByUrl: Record<string, string>,
  normalize: (value: string) => string = (value) => value,
) {
  const originalUrl = normalizeUrlForLookup(page.image_url, normalize)
  if (!originalUrl) return ''
  return thumbnailByUrl[originalUrl] || displayByUrl[originalUrl] || originalUrl
}

export function upsertPageById<T extends { id: string }>(pages: T[], pageId: string, patch: Partial<T>) {
  let changed = false
  const next = pages.map((page) => {
    if (page.id !== pageId) return page
    changed = true
    return { ...page, ...patch }
  })
  return changed ? next : pages
}

export function buildThumbnailLookup<T extends { public_url?: string | null; thumbnail_url?: string | null }>(
  assets: T[],
  normalize: (url: string) => string = (value) => value,
) {
  const lookup: Record<string, string> = {}
  for (const asset of assets) {
    const publicUrl = normalizeUrlForLookup(asset.public_url, normalize)
    const thumbnailUrl = normalizeUrlForLookup(asset.thumbnail_url, normalize)
    if (publicUrl && thumbnailUrl) lookup[publicUrl] = thumbnailUrl
  }
  return lookup
}

export function buildDisplayLookup<T extends { public_url?: string | null; display_url?: string | null; optimized_url?: string | null }>(
  assets: T[],
  normalize: (url: string) => string = (value) => value,
) {
  const lookup: Record<string, string> = {}
  for (const asset of assets) {
    const publicUrl = normalizeUrlForLookup(asset.public_url, normalize)
    const displayUrl = normalizeUrlForLookup(asset.display_url || asset.optimized_url || asset.public_url, normalize)
    if (publicUrl && displayUrl) lookup[publicUrl] = displayUrl
  }
  return lookup
}

export function mergeThumbnailLookup(
  current: Record<string, string>,
  incoming: Record<string, string>,
) {
  let changed = false
  const next = { ...current }
  for (const [url, thumbnailUrl] of Object.entries(incoming)) {
    if (!url || !thumbnailUrl || next[url] === thumbnailUrl) continue
    next[url] = thumbnailUrl
    changed = true
  }
  return changed ? next : current
}

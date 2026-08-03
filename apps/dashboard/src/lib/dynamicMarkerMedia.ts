import type { MediaAsset } from './api'

export type DynamicMarkerMediaVisibility = 'public' | 'internal' | 'private' | 'hidden'

export type DynamicMarkerMediaItem = {
  id?: unknown
  type?: unknown
  url?: unknown
  thumbnail_url?: unknown
  poster_url?: unknown
  title?: unknown
  alt?: unknown
  visibility?: unknown
  sort_order?: unknown
  cover?: unknown
  is_cover?: unknown
  featured?: unknown
}

export function parseDynamicMarkerMediaItems(value: unknown): DynamicMarkerMediaItem[] {
  if (Array.isArray(value)) return value.filter((item): item is DynamicMarkerMediaItem => Boolean(item) && typeof item === 'object')
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item): item is DynamicMarkerMediaItem => Boolean(item) && typeof item === 'object')
      : []
  } catch {
    return []
  }
}

function sortOrder(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function cleanUrl(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isPublicMedia(item: DynamicMarkerMediaItem) {
  const visibility = typeof item.visibility === 'string' ? item.visibility : 'public'
  return visibility === 'public'
}

function isExplicitCover(item: DynamicMarkerMediaItem) {
  return item.cover === true || item.is_cover === true || item.featured === true
}

export function getDynamicMarkerThumbnail(media: unknown): string | null {
  const ordered = parseDynamicMarkerMediaItems(media)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => sortOrder(a.item.sort_order, a.index) - sortOrder(b.item.sort_order, b.index))
    .map(({ item }) => item)
    .filter(isPublicMedia)

  const images = ordered.filter((item) => item.type === 'image' && cleanUrl(item.url))
  const cover = images.find(isExplicitCover) ?? images[0]
  if (cover) return cleanUrl(cover.thumbnail_url) || cleanUrl(cover.url) || null

  const videoPoster = ordered.find((item) => item.type === 'video' && cleanUrl(item.poster_url))
  return videoPoster ? cleanUrl(videoPoster.poster_url) : null
}

export function countDynamicMarkerMediaItems(media: unknown) {
  return parseDynamicMarkerMediaItems(media).length
}

export function dynamicMarkerPreviewToneUsesGlobalOpacity(style: Record<string, unknown>) {
  return Object.prototype.hasOwnProperty.call(style, 'opacity')
}

export function dynamicMarkerMediaTypeFromMime(mimeType: string | null | undefined): 'image' | 'video' | 'audio' {
  const mime = (mimeType ?? '').toLowerCase()
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'image'
}

function assetUrl(asset: MediaAsset) {
  return (
    asset.display_url
    || asset.optimized_url
    || asset.public_url
    || asset.original_url
    || ''
  ).trim()
}

export function dynamicMarkerMediaItemFromAsset(asset: MediaAsset): DynamicMarkerMediaItem | null {
  const url = assetUrl(asset)
  if (!url) return null
  const type = dynamicMarkerMediaTypeFromMime(asset.mime_type)
  return {
    id: asset.id,
    type,
    url,
    thumbnail_url: asset.thumbnail_url || undefined,
    title: asset.original_name || undefined,
    alt: type === 'image' ? asset.original_name || undefined : undefined,
    visibility: 'public',
  }
}

export function normalizeDynamicMarkerMediaItems(items: DynamicMarkerMediaItem[]) {
  return items
    .filter((item) => cleanUrl(item.url))
    .map((item, index) => {
      const normalized: DynamicMarkerMediaItem = {
        id: item.id,
        type: item.type === 'video' || item.type === 'audio' ? item.type : 'image',
        url: cleanUrl(item.url),
        sort_order: index,
        visibility: 'public',
      }
      const thumbnailUrl = cleanUrl(item.thumbnail_url)
      const posterUrl = cleanUrl(item.poster_url)
      const title = typeof item.title === 'string' ? item.title.trim() : ''
      const alt = typeof item.alt === 'string' ? item.alt.trim() : ''
      if (thumbnailUrl) normalized.thumbnail_url = thumbnailUrl
      if (posterUrl) normalized.poster_url = posterUrl
      if (title) normalized.title = title
      if (alt) normalized.alt = alt
      return normalized
    })
}

export function mergeDynamicMarkerMediaItems(
  current: DynamicMarkerMediaItem[],
  incoming: DynamicMarkerMediaItem[],
) {
  const seen = new Set<string>()
  const merged: DynamicMarkerMediaItem[] = []

  for (const item of [...current, ...incoming]) {
    const key = cleanUrl(item.id) || cleanUrl(item.url)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }

  return normalizeDynamicMarkerMediaItems(merged)
}

export function removeDynamicMarkerMediaItem(items: DynamicMarkerMediaItem[], idOrUrl: string) {
  const target = idOrUrl.trim()
  return normalizeDynamicMarkerMediaItems(items.filter((item) => {
    const key = cleanUrl(item.id) || cleanUrl(item.url)
    return key !== target
  }))
}

export function moveDynamicMarkerMediaItem(items: DynamicMarkerMediaItem[], idOrUrl: string, direction: -1 | 1) {
  const target = idOrUrl.trim()
  const copy = [...items]
  const index = copy.findIndex((item) => (cleanUrl(item.id) || cleanUrl(item.url)) === target)
  const nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= copy.length) return normalizeDynamicMarkerMediaItems(copy)
  const [item] = copy.splice(index, 1)
  copy.splice(nextIndex, 0, item)
  return normalizeDynamicMarkerMediaItems(copy)
}

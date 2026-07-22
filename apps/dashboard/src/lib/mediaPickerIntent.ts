export type MediaPickerFolderId = undefined | null | string

export type MediaPickerSelection = {
  urls: string[]
  assets?: unknown[]
}

export type MediaPickerReplacementAsset = {
  public_url?: string | null
  original_url?: string | null
  display_url?: string | null
  optimized_url?: string | null
}

export const MEDIA_PICKER_FOLDER_STORAGE_VERSION = 1

export function mediaPickerFolderStorageKey(publicationId: string) {
  return `intap_media_picker_folder_v${MEDIA_PICKER_FOLDER_STORAGE_VERSION}:${publicationId}`
}

export function normalizeMediaPickerFolderId(folderId: MediaPickerFolderId, existingFolders: Array<{ id: string }>): MediaPickerFolderId {
  if (folderId === undefined || folderId === null) return folderId
  return existingFolders.some((folder) => folder.id === folderId) ? folderId : null
}

export function readMediaPickerFolder(storage: Pick<Storage, 'getItem'> | null | undefined, publicationId: string): MediaPickerFolderId {
  if (!storage || !publicationId) return undefined
  try {
    const raw = storage.getItem(mediaPickerFolderStorageKey(publicationId))
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    if (parsed === null) return null
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

export function writeMediaPickerFolder(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  publicationId: string,
  folderId: MediaPickerFolderId,
) {
  if (!storage || !publicationId) return false
  try {
    storage.setItem(mediaPickerFolderStorageKey(publicationId), JSON.stringify(folderId ?? null))
    return true
  } catch {
    return false
  }
}

export function selectFirstMediaPickerUrl(selection: MediaPickerSelection) {
  return selection.urls.find(Boolean) ?? ''
}

export function appendMediaPickerUrls(current: string[], selection: MediaPickerSelection, max = Infinity) {
  const remaining = Math.max(0, max - current.length)
  if (!remaining) return current
  const additions = selection.urls.filter(Boolean).slice(0, remaining)
  return additions.length ? [...current, ...additions] : current
}

export function shouldOpenImageReplacementForObject(input: { kind?: string | null; type?: string | null }) {
  if (input.kind === 'image' || input.type === 'image') return true
  return input.kind === 'shape' && (input.type === 'rect' || input.type === 'polygon')
}

function firstNonEmpty(values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? ''
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

export function resolveMediaPickerReplacementSource(selectedUrl: string, asset?: MediaPickerReplacementAsset | null) {
  const canonicalUrl = firstNonEmpty([asset?.public_url, asset?.original_url, selectedUrl])
  const loadCandidates = uniqueNonEmpty([
    asset?.display_url,
    asset?.optimized_url,
    asset?.public_url,
    asset?.original_url,
    selectedUrl,
  ])
  return { canonicalUrl, loadCandidates }
}

export function shouldClearMediaPickerIntentAfterSelection(input: { intentType: string; applied?: boolean }) {
  return input.intentType !== 'replace-object' || input.applied === true
}

export function shouldRememberMediaAssetsAfterSelection(input: { intentType: string; applied?: boolean }) {
  return input.intentType !== 'replace-object' || input.applied === true
}

export const MEDIA_PICKER_REPLACEMENT_ERROR = 'No se pudo aplicar la imagen seleccionada al objeto.'

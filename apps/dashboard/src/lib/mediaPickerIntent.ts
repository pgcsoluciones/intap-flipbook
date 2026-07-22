export type MediaPickerFolderId = undefined | null | string

export type MediaPickerSelection = {
  urls: string[]
  assets?: unknown[]
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

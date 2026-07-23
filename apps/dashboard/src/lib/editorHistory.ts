export const EDITOR_HISTORY_VERSION = 2
export const MAX_UNDO_STEPS = 20
export const MAX_HISTORY_ENTRIES = MAX_UNDO_STEPS + 1

export type EditorHistory = {
  version: typeof EDITOR_HISTORY_VERSION
  publicationId: string
  pageId: string
  entries: string[]
  index: number
  updatedAt?: number
}

export type EditorHistoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

let storageWarningShown = false

function warnStorageFailure(error: unknown) {
  if (storageWarningShown) return
  storageWarningShown = true
  console.warn('[editorHistory] sessionStorage unavailable; undo history will remain in memory only', error)
}

function trimHistoryEntries(entries: string[], index: number) {
  const overflow = Math.max(0, entries.length - MAX_HISTORY_ENTRIES)
  if (!overflow) return { entries, index }
  return {
    entries: entries.slice(overflow),
    index: Math.max(0, index - overflow),
  }
}

function isSerializedJson(value: string) {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

export function editorHistoryStorageKey(publicationId: string, pageId: string) {
  return `intap_editor_history_v${EDITOR_HISTORY_VERSION}:${publicationId}:${pageId}`
}

export function createEditorHistory(publicationId: string, pageId: string, initialSnapshot: string): EditorHistory {
  return {
    version: EDITOR_HISTORY_VERSION,
    publicationId,
    pageId,
    entries: [initialSnapshot],
    index: 0,
    updatedAt: Date.now(),
  }
}

export function normalizeEditorHistory(value: unknown, publicationId: string, pageId: string): EditorHistory | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<EditorHistory>
  if (candidate.version !== EDITOR_HISTORY_VERSION) return null
  if (candidate.publicationId !== publicationId || candidate.pageId !== pageId) return null
  if (!Array.isArray(candidate.entries) || candidate.entries.length === 0) return null

  const entries = candidate.entries.filter((entry): entry is string => typeof entry === 'string' && isSerializedJson(entry))
  if (entries.length !== candidate.entries.length || entries.length === 0) return null

  const rawIndex = Number.isInteger(candidate.index) ? candidate.index as number : entries.length - 1
  const clampedIndex = Math.min(entries.length - 1, Math.max(0, rawIndex))
  const trimmed = trimHistoryEntries(entries, clampedIndex)

  return {
    version: EDITOR_HISTORY_VERSION,
    publicationId,
    pageId,
    entries: trimmed.entries,
    index: Math.min(trimmed.entries.length - 1, Math.max(0, trimmed.index)),
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
  }
}

export function appendEditorHistorySnapshot(history: EditorHistory, snapshot: string): EditorHistory {
  if (history.entries[history.index] === snapshot) {
    return { ...history, updatedAt: Date.now() }
  }

  const entries = history.entries.slice(0, history.index + 1)
  entries.push(snapshot)
  const trimmed = trimHistoryEntries(entries, entries.length - 1)

  return {
    ...history,
    entries: trimmed.entries,
    index: trimmed.index,
    updatedAt: Date.now(),
  }
}

export function moveEditorHistoryIndex(history: EditorHistory, delta: number): EditorHistory {
  const nextIndex = Math.min(history.entries.length - 1, Math.max(0, history.index + delta))
  if (nextIndex === history.index) return history
  return {
    ...history,
    index: nextIndex,
    updatedAt: Date.now(),
  }
}

export function getEditorHistoryCurrentSnapshot(history: EditorHistory | null | undefined) {
  if (!history) return null
  return history.entries[history.index] ?? null
}

export function parseEditorHistory(raw: string | null, publicationId: string, pageId: string) {
  if (!raw) return null
  try {
    return normalizeEditorHistory(JSON.parse(raw), publicationId, pageId)
  } catch {
    return null
  }
}

export function loadEditorHistoryFromSession(
  storage: EditorHistoryStorage | null | undefined,
  publicationId: string,
  pageId: string,
) {
  if (!storage) return null
  try {
    return parseEditorHistory(storage.getItem(editorHistoryStorageKey(publicationId, pageId)), publicationId, pageId)
  } catch (error) {
    warnStorageFailure(error)
    return null
  }
}

export function saveEditorHistoryToSession(
  storage: EditorHistoryStorage | null | undefined,
  history: EditorHistory,
) {
  if (!storage) return false
  try {
    storage.setItem(editorHistoryStorageKey(history.publicationId, history.pageId), JSON.stringify(history))
    return true
  } catch (error) {
    warnStorageFailure(error)
    return false
  }
}

export function removeEditorHistoryFromSession(
  storage: EditorHistoryStorage | null | undefined,
  publicationId: string,
  pageId: string,
) {
  if (!storage) return false
  try {
    storage.removeItem(editorHistoryStorageKey(publicationId, pageId))
    return true
  } catch (error) {
    warnStorageFailure(error)
    return false
  }
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, toCanvasSafeAssetUrl, type MediaAsset, type MediaFolder } from '../lib/api'
import { optimizeImageFile, type OptimizedImageResult } from '../lib/imageOptimization'
import { normalizeMediaPickerFolderId, type MediaPickerFolderId } from '../lib/mediaPickerIntent'

const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,image/svg+xml,image/gif'
const ACCEPT_SVG = '.svg,image/svg+xml'
const MAX_PDF_BYTES = 50 * 1024 * 1024
const BANK_PAGE_SIZE = 12

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

function perfMeasure(name: string, start: string, detail?: Record<string, unknown>) {
  if (!perfEnabled()) return
  try {
    performance.measure(name, start)
    const entry = performance.getEntriesByName(name).slice(-1)[0]
    console.debug('[editor-perf]', name, {
      duration_ms: entry ? Math.round(entry.duration * 10) / 10 : null,
      ...detail,
    })
  } catch {}
}

type MediaPickerMode = 'image' | 'pages' | 'svg'

type MediaPickerProps = {
  open: boolean
  publicationId: string
  initialFolderId?: ActiveFolderId
  mode?: MediaPickerMode
  title?: string
  legacyUrls?: string[]
  multiple?: boolean
  busyMessage?: string
  usedPageUrls?: string[]
  onClose: () => void
  onSelect: (urls: string[], assets?: MediaAsset[]) => void | { confirmedCount?: number } | Promise<void | { confirmedCount?: number }>
  onRemoveLegacyUrls?: (urls: string[]) => void | Promise<void>
  onPdfSelect?: (file: File, onProgress?: (message: string) => void) => void | { confirmedCount?: number } | Promise<void | { confirmedCount?: number }>
  onGoToPages?: () => void
  onFolderChange?: (folderId: MediaPickerFolderId) => void
}

type PickerItem = {
  key: string
  url: string
  thumbUrl?: string
  name: string
  format: string
  size: string
  asset?: MediaAsset
}

type UploadResult = {
  file: File
  optimized?: OptimizedImageResult
  asset: MediaAsset
  url: string
  reused: boolean
  error?: string
}

type DeletePromptItem = {
  asset?: MediaAsset
  legacyUrl?: string
  usage_count: number
  can_delete_physical: boolean
  usages: Array<{ label: string; type: string }>
}

type DeletePrompt = {
  mode: 'in-use' | 'unused'
  items: DeletePromptItem[]
  totalUses: number
}

type ActiveFolderId = undefined | null | string

export function shouldShowLegacyForFolder(folderId: ActiveFolderId) {
  return folderId === undefined || folderId === null
}

export function canMoveMediaPickerSelection(items: Array<{ asset?: MediaAsset }>) {
  return items.length > 0 && items.every((item) => !!item.asset)
}

export function selectedMediaAssetIdsForMove(
  draggedItem: { asset?: MediaAsset; key: string },
  selectedItems: Array<{ asset?: MediaAsset; key: string }>,
) {
  if (!draggedItem.asset) return []
  const selected = selectedItems.some((item) => item.key === draggedItem.key)
    ? selectedItems
    : [draggedItem]
  if (!canMoveMediaPickerSelection(selected)) return []
  return selected.map((item) => item.asset!.id)
}

export function isSameMoveDestination(items: Array<{ asset?: MediaAsset }>, folderId: string | null) {
  return items.length > 0 && items.every((item) => item.asset && (item.asset.folder_id ?? null) === folderId)
}

export function canExecuteMediaMove(items: Array<{ asset?: MediaAsset }>, folderId: string | null | undefined, busy = false) {
  return !busy && folderId !== undefined && canMoveMediaPickerSelection(items) && !isSameMoveDestination(items, folderId)
}

export function mediaFolderLabel(folderId: string | null | undefined, folders: Array<{ id: string; name: string }>) {
  if (folderId == null) return 'Banco general'
  return folders.find((folder) => folder.id === folderId)?.name ?? 'Carpeta'
}

export function resolveExistingMediaFolderFilter(folderId: ActiveFolderId, folders: Array<{ id: string }>): ActiveFolderId {
  if (typeof folderId !== 'string') return folderId
  return folders.some((folder) => folder.id === folderId) ? folderId : null
}

export function parseDraggedMediaAssetIds(value: string) {
  return value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

export function resolveDropMediaAssetIds(refIds: string[], transferValue: string) {
  return refIds.length ? refIds : parseDraggedMediaAssetIds(transferValue)
}

export function getCombinedMediaPage<TAsset, TLegacy>({
  assets,
  legacyItems,
  assetTotal,
  page,
  pageSize = BANK_PAGE_SIZE,
  keyForAsset,
  keyForLegacy,
}: {
  assets: TAsset[]
  legacyItems: TLegacy[]
  assetTotal: number
  page: number
  pageSize?: number
  keyForAsset: (asset: TAsset) => string
  keyForLegacy: (legacy: TLegacy) => string
}) {
  const safePage = Math.max(1, page)
  const safeAssetTotal = Math.max(0, assetTotal)
  const offset = (safePage - 1) * pageSize
  const assetSlots = Math.max(0, Math.min(pageSize, safeAssetTotal - offset))
  const pageAssets = assetSlots > 0 ? assets.slice(0, assetSlots) : []
  const legacyStart = Math.max(0, offset - safeAssetTotal)
  const legacySlots = pageSize - pageAssets.length
  const seen = new Set(pageAssets.map(keyForAsset))
  const pageLegacy: TLegacy[] = []
  for (const legacy of legacyItems.slice(legacyStart)) {
    if (pageLegacy.length >= legacySlots) break
    const key = keyForLegacy(legacy)
    if (seen.has(key)) continue
    seen.add(key)
    pageLegacy.push(legacy)
  }
  return {
    items: [...pageAssets, ...pageLegacy],
    total: safeAssetTotal + legacyItems.length,
    totalPages: Math.max(1, Math.ceil((safeAssetTotal + legacyItems.length) / pageSize)),
  }
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatMime(mime?: string) {
  if (!mime) return 'Imagen'
  if (mime === 'image/svg+xml') return 'SVG'
  return mime.replace('image/', '').toUpperCase()
}

export function mediaAssetToPickerItem(asset: MediaAsset): PickerItem | null {
  const originalUrl = toCanvasSafeAssetUrl(asset.public_url)
  const url = toCanvasSafeAssetUrl(asset.display_url || asset.optimized_url || asset.public_url)
  if (!url) return null
  const thumbUrl = asset.thumbnail_url ? toCanvasSafeAssetUrl(asset.thumbnail_url) : url
  return {
    key: `asset:${asset.id}`,
    url,
    thumbUrl,
    name: asset.original_name,
    format: formatMime(asset.mime_type),
    size: formatBytes(asset.size_bytes),
    asset: {
      ...asset,
      public_url: originalUrl || url,
      original_url: asset.original_url ? toCanvasSafeAssetUrl(asset.original_url) : originalUrl || url,
      optimized_url: asset.optimized_url ? toCanvasSafeAssetUrl(asset.optimized_url) : asset.optimized_url,
      display_url: url,
      thumbnail_url: asset.thumbnail_url ? thumbUrl : asset.thumbnail_url,
    },
  }
}

function isSvgUrl(url: string) {
  return /\.svg($|[?#])/i.test(url) || url.startsWith('data:image/svg+xml')
}

function isAllowedLegacyUrl(url: string, mode: MediaPickerMode) {
  if (mode === 'svg') return isSvgUrl(url)
  return true
}

function isAllowedAsset(asset: MediaAsset, mode: MediaPickerMode) {
  if (mode === 'svg') return asset.mime_type === 'image/svg+xml'
  return ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif'].includes(asset.mime_type)
}

function readImageSize(file: File) {
  return new Promise<{ width: number | null; height: number | null }>((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve({ width: null, height: null })
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ width: null, height: null })
    }
    img.src = url
  })
}

function Thumb({ item, selected }: { item: PickerItem; selected: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <span style={{ ...styles.thumbWrap, ...(selected ? styles.thumbSelected : {}) }}>
      {!failed ? (
        <img
          src={item.thumbUrl || item.url}
          alt=""
          style={styles.thumb}
          loading="lazy"
          decoding="async"
          onError={() => {
            console.warn('[MediaPicker] thumbnail failed', item.thumbUrl || item.url)
            setFailed(true)
          }}
        />
      ) : (
        <span style={styles.fallback}>{item.format || 'IMG'}</span>
      )}
      {selected && <span style={styles.check}>Seleccionada</span>}
    </span>
  )
}

export default function MediaPicker({
  open,
  publicationId,
  initialFolderId,
  mode = 'image',
  title,
  legacyUrls = [],
  multiple,
  busyMessage = '',
  usedPageUrls = [],
  onClose,
  onSelect,
  onRemoveLegacyUrls,
  onPdfSelect,
  onGoToPages,
  onFolderChange,
}: MediaPickerProps) {
  const [tab, setTab] = useState<'bank' | 'upload' | 'pdf'>('bank')
  const [q, setQ] = useState('')
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [folders, setFolders] = useState<MediaFolder[]>([])
  const [activeFolderId, setActiveFolderId] = useState<ActiveFolderId>(undefined)
  const [uploadFolderId, setUploadFolderId] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [renameFolderName, setRenameFolderName] = useState('')
  const [uploadFolderName, setUploadFolderName] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [deleteFolderPrompt, setDeleteFolderPrompt] = useState<MediaFolder | null>(null)
  const [allAssetTotal, setAllAssetTotal] = useState(0)
  const [showHiddenAssets, setShowHiddenAssets] = useState(false)
  const [knownAssetUrls, setKnownAssetUrls] = useState<string[]>([])
  const [pageNumber, setPageNumber] = useState(1)
  const [pageInfo, setPageInfo] = useState({ page: 1, total: 0, total_pages: 1, has_more: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizationStatus, setOptimizationStatus] = useState('')
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([])
  const [selectedItems, setSelectedItems] = useState<PickerItem[]>([])
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string>('none')
  const [dragMoveAssetIds, setDragMoveAssetIds] = useState<string[]>([])
  const [dragOverFolderId, setDragOverFolderId] = useState<ActiveFolderId>(undefined)
  const [selectedUploads, setSelectedUploads] = useState<string[]>([])
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfProcessing, setPdfProcessing] = useState(false)
  const [pdfStatus, setPdfStatus] = useState('')
  const [processingSelection, setProcessingSelection] = useState(false)
  const [selectionStatus, setSelectionStatus] = useState('')
  const [pendingSelection, setPendingSelection] = useState<{ urls: string[]; assets?: MediaAsset[]; duplicateCount: number } | null>(null)
  const [successNotice, setSuccessNotice] = useState<{ count: number } | null>(null)
  const [deletePrompt, setDeletePrompt] = useState<DeletePrompt | null>(null)
  const loadSeqRef = useRef(0)
  const folderSeqRef = useRef(0)
  const dragMoveAssetIdsRef = useRef<string[]>([])
  const onFolderChangeRef = useRef<typeof onFolderChange>(onFolderChange)
  const requestedAssetPageRef = useRef(1)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pdfInputRef = useRef<HTMLInputElement | null>(null)
  const [foldersLoaded, setFoldersLoaded] = useState(false)
  const isMulti = multiple ?? mode !== 'image'
  const accept = mode === 'svg' ? ACCEPT_SVG : ACCEPT_IMAGE

  useEffect(() => {
    onFolderChangeRef.current = onFolderChange
  }, [onFolderChange])

  useEffect(() => {
    return () => {
      for (const url of Object.values(previewUrls)) URL.revokeObjectURL(url)
    }
  }, [previewUrls])

  useEffect(() => {
    if (!open) return
    setTab('bank')
    setQ('')
    setPageNumber(1)
    setAssets([])
    setFolders([])
    setFoldersLoaded(false)
    setActiveFolderId(initialFolderId)
    setUploadFolderId(null)
    setNewFolderName('')
    setRenameFolderName('')
    setUploadFolderName('')
    setFolderBusy(false)
    setFolderError('')
    setDeleteFolderPrompt(null)
    setAllAssetTotal(0)
    setShowHiddenAssets(false)
    setFiles([])
    setPreviewUrls((prev) => {
      for (const url of Object.values(prev)) URL.revokeObjectURL(url)
      return {}
    })
    setUploadResults([])
    setOptimizing(false)
    setOptimizationStatus('')
    setSelectedUploads([])
    setSelectedItems([])
    setMoveTargetFolderId('none')
    setDragMoveAssetIds([])
    dragMoveAssetIdsRef.current = []
    setDragOverFolderId(undefined)
    setPdfFile(null)
    setPdfProcessing(false)
    setPdfStatus('')
    setProcessingSelection(false)
    setSelectionStatus('')
    setPendingSelection(null)
    setSuccessNotice(null)
    setDeletePrompt(null)
    setError('')
    setNotice('')
  }, [initialFolderId, open, mode])

  const loadFolders = useCallback(async () => {
    if (!open || !publicationId) return
    const seq = folderSeqRef.current + 1
    folderSeqRef.current = seq
    setFoldersLoaded(false)
    setFolderError('')
    try {
      const [res, totalRes] = await Promise.all([
        api.mediaFolders.list(publicationId),
        api.mediaAssets.list({ publication_id: publicationId, limit: 1, page: 1 }),
      ])
      if (seq !== folderSeqRef.current) return
      const nextFolders = res.data ?? []
      setFolders(nextFolders)
      setAllAssetTotal(totalRes.page?.total ?? 0)
      setActiveFolderId((current) => {
        const normalized = normalizeMediaPickerFolderId(current, nextFolders)
        if (normalized !== current) {
          setPageNumber(1)
          onFolderChangeRef.current?.(normalized)
        }
        return normalized
      })
      setFoldersLoaded(true)
    } catch (err: any) {
      if (seq === folderSeqRef.current) {
        setFolderError(err?.message ?? 'No se pudieron cargar las carpetas.')
        setActiveFolderId(null)
        setFoldersLoaded(true)
      }
    }
  }, [open, publicationId])

  const loadAssets = useCallback(async (nextPage: number) => {
    if (!open || !publicationId || !foldersLoaded) return
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq
    setLoading(true)
    setError('')
    setNotice('')
    try {
      perfMark('media-picker-list-start', { page: nextPage })
      const res = await api.mediaAssets.list({
        publication_id: publicationId,
        q,
        limit: BANK_PAGE_SIZE,
        page: nextPage,
        folder_id: activeFolderId,
        hidden: showHiddenAssets,
      })
      if (seq !== loadSeqRef.current) return
      setAssets(res.data ?? [])
      setKnownAssetUrls(res.meta?.known_urls ?? res.page?.known_urls ?? [])
      setPageNumber(nextPage)
      setPageInfo({
        page: nextPage,
        total: res.page?.total ?? 0,
        total_pages: res.page?.total_pages ?? 1,
        has_more: !!res.page?.has_more,
      })
      perfMeasure('media-picker-list-loaded', 'media-picker-list-start', { count: (res.data ?? []).length, page: nextPage })
    } catch (err: any) {
      if (seq === loadSeqRef.current) setError(err?.message ?? 'No se pudo cargar el banco del proyecto')
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [activeFolderId, foldersLoaded, open, publicationId, q, showHiddenAssets])

  useEffect(() => {
    if (!open) return
    const handle = window.setTimeout(() => {
      const nextPage = requestedAssetPageRef.current
      requestedAssetPageRef.current = 1
      void loadAssets(nextPage)
    }, 200)
    return () => window.clearTimeout(handle)
  }, [loadAssets, open])

  useEffect(() => {
    if (!open) return
    void loadFolders()
  }, [loadFolders, open])

  const legacyItems = useMemo(() => {
    if (showHiddenAssets) return []
    if (!shouldShowLegacyForFolder(activeFolderId)) return []
    const seen = new Set<string>()
    const query = q.trim().toLowerCase()
    const known = new Set(knownAssetUrls.map(normalizeUrlForCompare))
    const result: PickerItem[] = []
    for (const legacyUrl of legacyUrls) {
      const url = toCanvasSafeAssetUrl(legacyUrl)
      if (!url || seen.has(url) || known.has(normalizeUrlForCompare(url)) || !isAllowedLegacyUrl(url, mode)) continue
      const name = url.split('/').pop()?.split('?')[0] || 'Imagen anterior'
      if (query && !name.toLowerCase().includes(query) && !url.toLowerCase().includes(query)) continue
      seen.add(url)
      result.push({
        key: `legacy:${url}`,
        url,
        name,
        format: isSvgUrl(url) ? 'SVG' : 'URL',
        size: 'Anterior',
      })
    }
    return result
  }, [activeFolderId, knownAssetUrls, legacyUrls, mode, q, showHiddenAssets])

  const items = useMemo(() => {
    const assetItems: PickerItem[] = []
    for (const asset of assets) {
      if (!isAllowedAsset(asset, mode)) continue
      const item = mediaAssetToPickerItem(asset)
      if (!item || assetItems.some((existing) => existing.url === item.url)) continue
      assetItems.push(item)
    }
    return getCombinedMediaPage({
      assets: assetItems,
      legacyItems,
      assetTotal: pageInfo.total,
      page: pageNumber,
      keyForAsset: (asset) => normalizeUrlForCompare(asset.asset?.public_url || asset.url),
      keyForLegacy: (legacy) => normalizeUrlForCompare(legacy.url),
    }).items
  }, [assets, legacyItems, mode, pageInfo.total, pageNumber])

  const combinedPage = useMemo(() => getCombinedMediaPage({
    assets: [],
    legacyItems,
    assetTotal: pageInfo.total,
    page: pageNumber,
    keyForAsset: () => '',
    keyForLegacy: (legacy) => normalizeUrlForCompare(legacy.url),
  }), [legacyItems, pageInfo.total, pageNumber])
  const combinedTotal = combinedPage.total
  const combinedTotalPages = combinedPage.totalPages
  const activeFolder = typeof activeFolderId === 'string' ? folders.find((folder) => folder.id === activeFolderId) ?? null : null
  const uploadTargetFolderId = uploadFolderId
  const selectedHasLegacy = selectedItems.some((item) => !item.asset)
  const selectedHasHidden = selectedItems.some((item) => item.asset?.is_hidden)
  const selectedCanMove = !selectedHasHidden && canMoveMediaPickerSelection(selectedItems)
  const activeFolderLabel = activeFolderId === undefined ? 'Todas' : activeFolderId === null ? 'Banco general' : activeFolder?.name ?? 'Carpeta'
  const selectedMoveTarget = moveTargetFolderId === 'none' ? undefined : moveTargetFolderId === 'unfiled' ? null : moveTargetFolderId
  const moveTargetInvalid = !canExecuteMediaMove(selectedItems, selectedMoveTarget, loading)
  const unfiledCount = Math.max(0, allAssetTotal - folders.reduce((sum, folder) => sum + folder.asset_count, 0))

  if (!open) return null

  const resolvedTitle = title ?? (
    mode === 'pages' ? 'Agregar páginas' : mode === 'svg' ? 'Insertar SVG editable' : 'Seleccionar imagen'
  )

  const chooseFiles = (nextFiles: File[]) => {
    setError('')
    setUploadResults([])
    setSelectedUploads([])
    setFiles((prev) => {
      const merged = [...prev, ...nextFiles]
      const nextPreviews: Record<string, string> = {}
      for (const file of merged) nextPreviews[fileKey(file)] = URL.createObjectURL(file)
      setPreviewUrls((old) => {
        for (const url of Object.values(old)) URL.revokeObjectURL(url)
        return nextPreviews
      })
      return merged
    })
  }

  const clearSelection = () => {
    setSelectedItems([])
    setSelectedUploads([])
  }

  const refreshBank = async (nextPage = 1) => {
    requestedAssetPageRef.current = nextPage
    await loadFolders()
  }

  const selectFolder = (folderId: ActiveFolderId) => {
    setActiveFolderId(folderId)
    setPageNumber(1)
    setSelectedItems([])
    setError('')
    setNotice('')
    setRenameFolderName('')
    onFolderChangeRef.current?.(folderId)
  }

  const createFolder = async (name: string, target: 'bank' | 'upload') => {
    const trimmed = name.trim()
    if (!trimmed || folderBusy) {
      setFolderError('Escribe un nombre para la carpeta.')
      return
    }
    setFolderBusy(true)
    setFolderError('')
    setError('')
    try {
      const res = await api.mediaFolders.create({ publication_id: publicationId, name: trimmed })
      await loadFolders()
      if (target === 'bank') selectFolder(res.data.id)
      if (target === 'upload') setUploadFolderId(res.data.id)
      setNewFolderName('')
      setUploadFolderName('')
      setNotice(`Carpeta "${res.data.name}" creada.`)
    } catch (err: any) {
      setFolderError(err?.message ?? 'No se pudo crear la carpeta.')
    } finally {
      setFolderBusy(false)
    }
  }

  const renameActiveFolder = async () => {
    if (!activeFolder || folderBusy) return
    const trimmed = renameFolderName.trim()
    if (!trimmed) {
      setFolderError('Escribe un nombre para renombrar la carpeta.')
      return
    }
    setFolderBusy(true)
    setFolderError('')
    try {
      await api.mediaFolders.rename(activeFolder.id, trimmed)
      await loadFolders()
      setRenameFolderName('')
      setNotice('Carpeta renombrada.')
    } catch (err: any) {
      setFolderError(err?.message ?? 'No se pudo renombrar la carpeta.')
    } finally {
      setFolderBusy(false)
    }
  }

  const deleteActiveFolder = async () => {
    if (!activeFolder || folderBusy) return
    setDeleteFolderPrompt(activeFolder)
  }

  const confirmDeleteFolder = async () => {
    if (!deleteFolderPrompt || folderBusy) return
    setFolderBusy(true)
    setFolderError('')
    try {
      const res = await api.mediaFolders.remove(deleteFolderPrompt.id)
      selectFolder(null)
      if (uploadFolderId === deleteFolderPrompt.id) setUploadFolderId(null)
      setDeleteFolderPrompt(null)
      await refreshBank(1)
      setNotice(`${res.data.moved_count} imagen(es) volvieron a Banco general.`)
    } catch (err: any) {
      setFolderError(err?.message ?? 'No se pudo eliminar la carpeta.')
    } finally {
      setFolderBusy(false)
    }
  }

  const moveSelectedAssets = async (folderId: string | null) => {
    const assetsToMove = selectedItems.flatMap((item) => item.asset ? [item.asset] : [])
    if (!assetsToMove.length) {
      setError('Selecciona imágenes del banco para moverlas.')
      return
    }
    if (assetsToMove.length !== selectedItems.length) {
      setError('Las imágenes anteriores sin registro de asset no se pueden mover.')
      return
    }
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const res = await api.mediaAssets.move({
        publication_id: publicationId,
        asset_ids: assetsToMove.map((asset) => asset.id),
        folder_id: folderId,
      })
      clearSelection()
      await refreshBank(pageNumber)
      setNotice(`${res.data.moved_count} imagen(es) movida(s).`)
    } catch (err: any) {
      setError(err?.message ?? 'No se pudieron mover las imágenes.')
    } finally {
      setLoading(false)
    }
  }

  const moveAssetIds = async (assetIds: string[], folderId: string | null) => {
    if (!assetIds.length || loading) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const res = await api.mediaAssets.move({
        publication_id: publicationId,
        asset_ids: assetIds,
        folder_id: folderId,
      })
      clearSelection()
      setMoveTargetFolderId('none')
      await refreshBank(pageNumber)
      setNotice(`${res.data.moved_count} imagen(es) movida(s).`)
    } catch (err: any) {
      setError(err?.message ?? 'No se pudieron mover las imágenes.')
    } finally {
      setLoading(false)
    }
  }

  const handleDropOnFolder = async (event: React.DragEvent, folderId: string | null) => {
    event.preventDefault()
    event.stopPropagation()
    const ids = dragMoveAssetIds
    const refIds = dragMoveAssetIdsRef.current
    const transferIds = event.dataTransfer.getData('text/plain')
    const resolvedIds = resolveDropMediaAssetIds(refIds.length ? refIds : ids, transferIds)
    setDragMoveAssetIds([])
    dragMoveAssetIdsRef.current = []
    setDragOverFolderId(undefined)
    if (!resolvedIds.length) return
    await moveAssetIds(resolvedIds, folderId)
  }

  const deleteSelectedFromBank = async () => {
    const selectedBankItems = selectedItems.filter((item) => item.asset || item.key.startsWith('legacy:'))
    if (!selectedBankItems.length) {
      setError('Selecciona una imagen del banco para eliminarla.')
      return
    }
    setLoading(true)
    setError('')
    setNotice('')
    setDeletePrompt(null)
    try {
      let totalUses = 0
      const usageItems: DeletePromptItem[] = []

      for (const item of selectedBankItems) {
        if (item.asset) {
          const usage = await api.mediaAssets.usage(item.asset.id, publicationId)
          totalUses += usage.data.usage_count
          usageItems.push({
            asset: item.asset,
            usage_count: usage.data.usage_count,
            can_delete_physical: usage.data.can_delete_physical,
            usages: usage.data.usages.map((usageItem) => ({
              label: usageItem.label,
              type: usageItem.type,
            })),
          })
          continue
        }

        const usage = await api.mediaAssets.usageByUrl({
          publication_id: publicationId,
          public_url: item.url,
        })
        totalUses += usage.data.usage_count
        usageItems.push({
          legacyUrl: item.url,
          usage_count: usage.data.usage_count,
          can_delete_physical: false,
          usages: usage.data.usages.map((usageItem) => ({
            label: usageItem.label,
            type: usageItem.type,
          })),
        })
      }

      setDeletePrompt({
        mode: totalUses > 0 ? 'in-use' : 'unused',
        items: usageItems,
        totalUses,
      })
    } catch (err: any) {
      setError(
        err?.message?.startsWith('Error 500')
          ? 'No se pudieron consultar los usos de esta imagen.'
          : err?.message ?? 'No fue posible eliminar la imagen.',
      )
    } finally {
      setLoading(false)
    }
  }

  const refreshAfterBankRemoval = async (
    removedAssets: MediaAsset[],
    removedLegacyUrls: string[] = [],
  ) => {
    if (removedLegacyUrls.length) {
      if (!onRemoveLegacyUrls) {
        throw new Error('No fue posible actualizar el banco de imágenes anteriores.')
      }
      await onRemoveLegacyUrls(removedLegacyUrls)
    }

    const removedLegacySet = new Set(
      removedLegacyUrls.map((url) => normalizeUrlForCompare(url)),
    )

    setSelectedItems((prev) => prev.filter((item) => {
      if (item.asset) {
        return !removedAssets.some((asset) => asset.id === item.asset?.id)
      }

      if (removedLegacySet.has(normalizeUrlForCompare(item.url))) {
        return false
      }

      return !removedAssets.some((asset) =>
        normalizeUrlForCompare(asset.public_url) === normalizeUrlForCompare(item.url)
        || normalizeUrlForCompare(asset.display_url || asset.optimized_url || '') === normalizeUrlForCompare(item.url),
      )
    }))

    setAssets((prev) =>
      prev.filter((asset) => !removedAssets.some((removed) => removed.id === asset.id)),
    )

    if (removedAssets.length) {
      setKnownAssetUrls((prev) =>
        Array.from(new Set([
          ...prev,
          ...removedAssets.map((asset) => asset.public_url),
        ])),
      )
    }

    const removedCount = removedAssets.length + removedLegacyUrls.length
    const nextPage = items.length <= removedCount && pageNumber > 1
      ? pageNumber - 1
      : pageNumber

    await loadAssets(nextPage)
  }

  const hidePromptAssets = async () => {
    if (!deletePrompt || loading) return

    const selectedAssets = deletePrompt.items.flatMap((item) =>
      item.asset ? [item.asset] : [],
    )
    const selectedLegacyUrls = deletePrompt.items.flatMap((item) =>
      item.legacyUrl ? [item.legacyUrl] : [],
    )
    const totalSelected = selectedAssets.length + selectedLegacyUrls.length

    setLoading(true)
    setError('')
    setNotice('')

    try {
      for (const asset of selectedAssets) {
        await api.mediaAssets.hide(asset.id, true)
      }

      await refreshAfterBankRemoval(selectedAssets, selectedLegacyUrls)
      setDeletePrompt(null)
      setNotice(
        totalSelected === 1
          ? 'La imagen fue quitada del banco sin afectar el proyecto.'
          : 'Las imágenes fueron quitadas del banco sin afectar el proyecto.',
      )
    } catch (err: any) {
      setError(err?.message ?? 'No fue posible quitar la imagen del banco.')
    } finally {
      setLoading(false)
    }
  }

  const deletePromptAssets = async () => {
    if (!deletePrompt || loading) return

    const selectedAssets = deletePrompt.items.flatMap((item) =>
      item.asset ? [item.asset] : [],
    )

    if (!selectedAssets.length) {
      setError('No hay archivos seguros disponibles para eliminación definitiva.')
      return
    }

    setLoading(true)
    setError('')
    setNotice('')

    try {
      for (const asset of selectedAssets) {
        await api.mediaAssets.deleteMediaAsset(asset.id, publicationId)
      }

      await refreshAfterBankRemoval(selectedAssets)
      await api.plan.usage().catch(() => null)
      setDeletePrompt(null)
      setNotice(
        selectedAssets.length === 1
          ? 'La imagen fue eliminada definitivamente.'
          : 'Las imágenes fueron eliminadas definitivamente.',
      )
    } catch (err: any) {
      setError(err?.message ?? 'No fue posible eliminar la imagen.')
    } finally {
      setLoading(false)
    }
  }

  const removeFile = (key: string) => {
    setFiles((prev) => prev.filter((file) => fileKey(file) !== key))
    setPreviewUrls((prev) => {
      const copy = { ...prev }
      if (copy[key]) URL.revokeObjectURL(copy[key])
      delete copy[key]
      return copy
    })
  }

  const toggleItem = (item: PickerItem) => {
    if (!isMulti) {
      void onSelect([item.url], item.asset ? [item.asset] : [])
      return
    }
    setSelectedItems((prev) => {
      if (prev.some((entry) => entry.key === item.key)) return prev.filter((entry) => entry.key !== item.key)
      return [...prev, item]
    })
  }

  const uploadFiles = async () => {
    if (!files.length || uploading || processingSelection) return
    setOptimizing(true)
    setOptimizationStatus(`Optimizando 1 de ${files.length}`)
    setUploading(true)
    setError('')
    const results: UploadResult[] = []
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        try {
          setOptimizationStatus(`Optimizando ${index + 1} de ${files.length}`)
          const optimized = await optimizeImageFile(file)
          setOptimizing(false)
          setOptimizationStatus(`Subiendo ${index + 1} de ${files.length}`)
          const res = await api.mediaAssets.upload({
            publication_id: publicationId,
            folder_id: uploadTargetFolderId,
            file: optimized.displayFile,
            thumbnail: optimized.thumbnailFile,
            width: optimized.metadata.optimized_width,
            height: optimized.metadata.optimized_height,
            optimization: optimized.metadata,
          })
          const asset = res.data.asset
          results.push({ file, optimized, asset, url: toCanvasSafeAssetUrl(asset.display_url || asset.optimized_url || res.data.url), reused: res.data.reused })
          setAssets((prev) => {
            if (prev.some((item) => item.id === asset.id)) return prev
            return [asset, ...prev]
          })
        } catch (err: any) {
          results.push({ file, asset: null as any, url: '', reused: false, error: err?.message ?? 'No se pudo subir' })
        }
      }
      setUploadResults(results)
      setSelectedUploads(results.filter((item) => !item.error).map((item) => fileKey(item.file)))
      await Promise.all([loadFolders(), loadAssets(1)])
    } finally {
      setOptimizing(false)
      setOptimizationStatus('')
      setUploading(false)
    }
  }

  const resetForAnotherBatch = () => {
    setTab('bank')
    setFiles([])
    setUploadResults([])
    setSelectedUploads([])
    setSelectedItems([])
    setPdfFile(null)
    setPendingSelection(null)
    setSuccessNotice(null)
    setSelectionStatus('')
    setError('')
  }

  const executeSelection = async (urls: string[], assets?: MediaAsset[]) => {
    if (!urls.length || processingSelection) return
    setProcessingSelection(true)
    setSelectionStatus(mode === 'pages' ? `Creando página 1 de ${urls.length}` : 'Aplicando selección...')
    setError('')
    try {
      const result = await onSelect(urls, assets)
      if (mode === 'pages') {
        const confirmedCount = result && typeof result === 'object' ? result.confirmedCount : undefined
        setSuccessNotice({ count: confirmedCount ?? urls.length })
      } else {
        resetForAnotherBatch()
      }
      setSelectionStatus('')
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo completar la selección.')
    } finally {
      setProcessingSelection(false)
    }
  }

  const submitSelection = async (urls: string[], assets?: MediaAsset[]) => {
    if (!urls.length || processingSelection) return
    if (mode === 'pages') {
      const used = new Set(usedPageUrls.map(normalizeUrlForCompare))
      const duplicateCount = urls.filter((url) => used.has(normalizeUrlForCompare(url))).length
      if (duplicateCount > 0) {
        setPendingSelection({ urls, assets, duplicateCount })
        return
      }
    }
    await executeSelection(urls, assets)
  }

  const useUploaded = async () => {
    const chosen = uploadResults.filter((item) => selectedUploads.includes(fileKey(item.file)) && !item.error)
    if (!chosen.length) return
    await submitSelection(chosen.map((item) => item.url), chosen.map((item) => item.asset))
  }

  const useSelectedItems = async () => {
    if (!selectedItems.length) return
    await submitSelection(selectedItems.map((item) => item.url), selectedItems.map((item) => item.asset).filter(Boolean) as MediaAsset[])
  }

  const usePdf = async () => {
    if (!pdfFile || !onPdfSelect || pdfProcessing) return
    if (pdfFile.type && pdfFile.type !== 'application/pdf') {
      setError('Selecciona un archivo PDF válido.')
      return
    }
    if (pdfFile.size > MAX_PDF_BYTES) {
      setError('El PDF supera el tamaño máximo permitido de 50 MB.')
      return
    }
    setPdfProcessing(true)
    setPdfStatus('Preparando PDF...')
    setError('')
    try {
      const result = await onPdfSelect(pdfFile, setPdfStatus)
      const confirmedCount = result && typeof result === 'object' ? result.confirmedCount : undefined
      setSuccessNotice({ count: confirmedCount ?? 0 })
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo importar el PDF.')
    } finally {
      setPdfProcessing(false)
      setPdfStatus('')
    }
  }

  if (successNotice) {
    return (
      <div style={styles.overlay} onClick={onClose}>
        <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
          <div style={styles.header}>
            <h3 style={styles.title}>Páginas agregadas</h3>
            <button type="button" style={styles.close} onClick={onClose}>x</button>
          </div>
          <div style={styles.body}>
            <div style={styles.success}>Se agregaron correctamente {successNotice.count} páginas.</div>
            <div style={styles.actions}>
              <button type="button" style={styles.secondary} onClick={resetForAnotherBatch}>Seguir agregando</button>
              <button type="button" style={styles.primary} onClick={onGoToPages ?? onClose}>Ir a Páginas</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (pendingSelection) {
    const omitRepeated = () => {
      const used = new Set(usedPageUrls.map(normalizeUrlForCompare))
      const filteredUrls: string[] = []
      const filteredAssets: MediaAsset[] = []
      pendingSelection.urls.forEach((url, index) => {
        if (used.has(normalizeUrlForCompare(url))) return
        filteredUrls.push(url)
        const asset = pendingSelection.assets?.[index]
        if (asset) filteredAssets.push(asset)
      })
      setPendingSelection(null)
      if (!filteredUrls.length) {
        setError('No quedan imágenes nuevas para agregar.')
        return
      }
      void executeSelection(filteredUrls, filteredAssets)
    }

    return (
      <div style={styles.overlay} onClick={() => setPendingSelection(null)}>
        <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
          <div style={styles.header}>
            <h3 style={styles.title}>Imagen ya utilizada</h3>
            <button type="button" style={styles.close} onClick={() => setPendingSelection(null)}>x</button>
          </div>
          <div style={styles.body}>
            <div style={styles.warning}>
              {pendingSelection.urls.length === 1
                ? 'Esta imagen ya se agregó como página. ¿Deseas agregarla nuevamente?'
                : `${pendingSelection.duplicateCount} de las imágenes seleccionadas ya están utilizadas como páginas. ¿Deseas agregarlas nuevamente?`}
            </div>
            <div style={styles.actions}>
              <button type="button" style={styles.secondary} onClick={() => setPendingSelection(null)}>Cancelar</button>
              <button type="button" style={styles.secondary} onClick={omitRepeated}>
                {pendingSelection.urls.length === 1 ? 'No agregar' : 'Omitir repetidas'}
              </button>
              <button type="button" style={styles.primary} onClick={() => {
                const selection = pendingSelection
                setPendingSelection(null)
                void executeSelection(selection.urls, selection.assets)
              }}>
                {pendingSelection.urls.length === 1 ? 'Agregar nuevamente' : 'Agregar todas'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (deletePrompt) {
    const labels = deletePrompt.items.flatMap((item) => item.usages.map((usage) => usage.label))
    const canDeleteAllPhysical = deletePrompt.items.length > 0
      && deletePrompt.items.every((item) => item.can_delete_physical)
    const hasHiddenAssets = deletePrompt.items.some((item) => item.asset?.is_hidden)
    return (
      <div style={styles.overlay} onClick={() => setDeletePrompt(null)}>
        <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
          <div style={styles.header}>
            <h3 style={styles.title}>{deletePrompt.mode === 'in-use' ? 'Imagen en uso' : 'Eliminar imagen'}</h3>
            <button type="button" style={styles.close} onClick={() => setDeletePrompt(null)}>x</button>
          </div>
          <div style={styles.body}>
            <div style={deletePrompt.mode === 'in-use' ? styles.warning : styles.error}>
              {deletePrompt.mode === 'in-use'
                ? `${deletePrompt.items.length === 1 ? 'Esta imagen está' : 'Estas imágenes están'} siendo utilizada${deletePrompt.items.length === 1 ? '' : 's'} en ${deletePrompt.totalUses} lugares del proyecto.`
                : canDeleteAllPhysical
                  ? `${deletePrompt.items.length === 1 ? 'Esta imagen no está' : 'Estas imágenes no están'} siendo utilizada${deletePrompt.items.length === 1 ? '' : 's'}. Esta acción eliminará el archivo definitivamente y liberará almacenamiento.`
                  : `${deletePrompt.items.length === 1 ? 'Esta imagen no está' : 'Estas imágenes no están'} siendo utilizada${deletePrompt.items.length === 1 ? '' : 's'}, pero el archivo de origen no pertenece a un almacenamiento seguro para borrado físico.`}
            </div>
            {notice && <div style={styles.success}>{notice}</div>}
            {error && <div style={styles.error}>{error}</div>}
            {labels.length > 0 && (
              <div style={styles.usageList}>
                {labels.slice(0, 8).map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
                {labels.length > 8 && <span>{labels.length - 8} uso(s) más</span>}
              </div>
            )}
            <div style={styles.actions}>
              <button type="button" style={styles.secondary} disabled={loading} onClick={() => setDeletePrompt(null)}>Cancelar</button>
              {deletePrompt.mode === 'in-use' ? (
                <>
                  <button type="button" style={styles.secondary} disabled={!labels.length || loading} onClick={() => setNotice(labels.join(', '))}>Ver dónde se utiliza</button>
                  {!hasHiddenAssets && <button type="button" style={styles.primary} disabled={loading} onClick={() => void hidePromptAssets()}>{loading ? 'Quitando...' : 'Quitar del banco'}</button>}
                </>
              ) : canDeleteAllPhysical ? (
                <button type="button" style={styles.primary} disabled={loading} onClick={() => void deletePromptAssets()}>{loading ? 'Eliminando...' : 'Eliminar definitivamente'}</button>
              ) : (
                !hasHiddenAssets && <button type="button" style={styles.primary} disabled={loading} onClick={() => void hidePromptAssets()}>{loading ? 'Quitando...' : 'Quitar del banco'}</button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (deleteFolderPrompt) {
    return (
      <div style={styles.overlay} onClick={() => setDeleteFolderPrompt(null)}>
        <div style={styles.modalSmall} onClick={(event) => event.stopPropagation()}>
          <div style={styles.header}>
            <h3 style={styles.title}>Eliminar carpeta</h3>
            <button type="button" style={styles.close} onClick={() => setDeleteFolderPrompt(null)}>x</button>
          </div>
          <div style={styles.body}>
            <div style={styles.warning}>
              La carpeta "{deleteFolderPrompt.name}" se eliminará. Sus imágenes regresarán a Banco general.
            </div>
            {folderError && <div style={styles.error}>{folderError}</div>}
            <div style={styles.actions}>
              <button type="button" style={styles.secondary} disabled={folderBusy} onClick={() => setDeleteFolderPrompt(null)}>Cancelar</button>
              <button type="button" style={styles.primary} disabled={folderBusy} onClick={() => void confirmDeleteFolder()}>
                {folderBusy ? 'Eliminando...' : 'Eliminar carpeta'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>{resolvedTitle}</h3>
          <button type="button" style={styles.close} onClick={onClose}>x</button>
        </div>

        <div style={styles.tabs}>
          <button type="button" style={{ ...styles.tab, ...(tab === 'bank' ? styles.tabActive : {}) }} onClick={() => setTab('bank')}>
            Banco del proyecto
          </button>
          <button type="button" style={{ ...styles.tab, ...(tab === 'upload' ? styles.tabActive : {}) }} onClick={() => setTab('upload')}>
            Subir desde el equipo
          </button>
          {mode === 'pages' && (
            <button type="button" style={{ ...styles.tab, ...(tab === 'pdf' ? styles.tabActive : {}) }} onClick={() => setTab('pdf')}>
              Importar PDF
            </button>
          )}
        </div>

        {tab === 'bank' && (
          <div style={styles.body}>
            <div style={styles.folderPanel}>
              <div style={styles.folderHeader}>
                <span style={styles.folderTitle}>Carpeta activa: {activeFolderLabel}</span>
                <span style={styles.meta}>{folders.length} carpeta(s)</span>
              </div>
              <div style={styles.folderNav}>
                <button type="button" style={{ ...styles.folderButton, ...(activeFolderId === undefined ? styles.folderButtonActive : {}) }} onClick={() => selectFolder(undefined)}>
                  Todas
                </button>
                <button type="button" style={{ ...styles.folderButton, ...(activeFolderId === null ? styles.folderButtonActive : {}), ...(dragOverFolderId === null ? styles.folderButtonDrop : {}) }} onClick={() => selectFolder(null)} onDragOver={(event) => { if (dragMoveAssetIdsRef.current.length || dragMoveAssetIds.length) { event.preventDefault(); setDragOverFolderId(null) } }} onDragLeave={() => setDragOverFolderId(undefined)} onDrop={(event) => void handleDropOnFolder(event, null)}>
                  Banco general
                </button>
                {folders.map((folder) => (
                  <button key={folder.id} type="button" style={{ ...styles.folderButton, ...(activeFolderId === folder.id ? styles.folderButtonActive : {}), ...(dragOverFolderId === folder.id ? styles.folderButtonDrop : {}) }} onClick={() => selectFolder(folder.id)} onDragOver={(event) => { if (dragMoveAssetIdsRef.current.length || dragMoveAssetIds.length) { event.preventDefault(); setDragOverFolderId(folder.id) } }} onDragLeave={() => setDragOverFolderId(undefined)} onDrop={(event) => void handleDropOnFolder(event, folder.id)}>
                    {folder.name} ({folder.asset_count})
                  </button>
                ))}
              </div>
              {folderError && <div style={styles.error}>{folderError}</div>}
              <div style={styles.folderCreateBox}>
                <span style={styles.formTitle}>Crear carpeta</span>
                <div style={styles.inlineForm}>
                  <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="Nombre de carpeta nueva" style={styles.inlineInput} maxLength={80} />
                  <button type="button" style={styles.secondary} disabled={folderBusy || !newFolderName.trim()} onClick={() => void createFolder(newFolderName, 'bank')}>
                    {folderBusy ? 'Creando...' : 'Crear'}
                  </button>
                </div>
              </div>
              {activeFolder && (
                <div style={styles.folderEditBox}>
                  <span style={styles.formTitle}>Carpeta activa</span>
                  <div style={styles.inlineForm}>
                    <input value={renameFolderName} onChange={(event) => setRenameFolderName(event.target.value)} placeholder={`Renombrar "${activeFolder.name}"`} style={styles.inlineInput} maxLength={80} />
                    <button type="button" style={styles.secondary} disabled={folderBusy || !renameFolderName.trim()} onClick={() => void renameActiveFolder()}>
                      {folderBusy ? 'Guardando...' : 'Renombrar'}
                    </button>
                    <button type="button" style={styles.remove} disabled={folderBusy} onClick={() => void deleteActiveFolder()}>
                      Eliminar carpeta
                    </button>
                  </div>
                </div>
              )}
              {selectedCanMove && (
                <div style={styles.moveBar}>
                  <span style={styles.moveTitle}>Mover {selectedItems.length} imagen{selectedItems.length === 1 ? '' : 'es'} a</span>
                  <select value={moveTargetFolderId} onChange={(event) => setMoveTargetFolderId(event.target.value)} style={styles.moveSelect}>
                    <option value="none">Seleccionar destino</option>
                    <option value="unfiled">Banco general ({unfiledCount})</option>
                    {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name} ({folder.asset_count})</option>)}
                  </select>
                  <button type="button" style={styles.primary} disabled={loading || moveTargetInvalid} onClick={() => selectedMoveTarget !== undefined && void moveSelectedAssets(selectedMoveTarget)}>
                    {loading ? 'Moviendo...' : 'Mover'}
                  </button>
                </div>
              )}
              {selectedHasLegacy && selectedItems.length > 0 && (
                <div style={styles.warning}>Las imágenes anteriores sin registro de asset no se pueden mover.</div>
              )}
            </div>
            <div style={styles.searchRow}>
              <input value={q} onChange={(event) => { setQ(event.target.value); setPageNumber(1) }} placeholder="Buscar por nombre" style={styles.search} />
              <label style={styles.hiddenToggle}>
                <input
                  type="checkbox"
                  checked={showHiddenAssets}
                  onChange={(event) => {
                    setShowHiddenAssets(event.target.checked)
                    setSelectedItems([])
                    setPageNumber(1)
                  }}
                />
                Ocultas
              </label>
            </div>
            {error && <div style={styles.error}>{error}</div>}
            {notice && <div style={styles.success}>{notice}</div>}
            {(busyMessage || selectionStatus) && <div style={styles.empty}>{busyMessage || selectionStatus}</div>}
            <div style={styles.pageSummary}>
              <span>{selectedItems.length} seleccionada(s)</span>
              <span>{combinedTotal} imagen(es)</span>
            </div>
            {loading && items.length === 0 ? (
              <div style={styles.empty}>Cargando imágenes...</div>
            ) : items.length === 0 ? (
              <div style={styles.empty}>Todavía no hay recursos disponibles para esta selección.</div>
            ) : (
              <div style={styles.grid}>
                {items.map((item) => {
                  const selected = selectedItems.some((entry) => entry.key === item.key)
                  return (
                    <button
                      key={item.key}
                      type="button"
                      style={{ ...styles.card, ...(selected ? styles.cardSelected : {}) }}
                      title={item.name}
                      draggable={!!item.asset}
                      onDragStart={(event) => {
                        const ids = selectedMediaAssetIdsForMove(item, selectedItems)
                        if (!ids.length) {
                          event.preventDefault()
                          return
                        }
                        dragMoveAssetIdsRef.current = ids
                        setDragMoveAssetIds(ids)
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', ids.join(','))
                      }}
                      onDragEnd={() => {
                        setDragMoveAssetIds([])
                        dragMoveAssetIdsRef.current = []
                        setDragOverFolderId(undefined)
                      }}
                      onClick={() => toggleItem(item)}
                    >
                      <Thumb item={item} selected={selected} />
                      {activeFolderId === undefined && item.asset && <span style={styles.folderBadge}>{mediaFolderLabel(item.asset.folder_id, folders)}</span>}
                      <span style={styles.name}>{item.name}</span>
                      <span style={styles.meta}>{item.format}{item.size ? ` · ${item.size}` : ''}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <div style={styles.pagination}>
              <button type="button" style={styles.more} disabled={loading || pageNumber <= 1} onClick={() => void loadAssets(pageNumber - 1)}>Anterior</button>
              <span>Página {pageInfo.page} de {combinedTotalPages}</span>
              <button type="button" style={styles.more} disabled={loading || pageNumber >= combinedTotalPages} onClick={() => void loadAssets(pageNumber + 1)}>Siguiente</button>
            </div>
            {isMulti && (
              <div style={styles.actions}>
                <button type="button" style={styles.secondary} disabled={processingSelection} onClick={onClose}>Cancelar</button>
                <button type="button" style={styles.secondary} disabled={!selectedItems.length || processingSelection} onClick={clearSelection}>Limpiar selección</button>
                <button type="button" style={styles.secondary} disabled={!selectedItems.some((item) => item.asset || item.key.startsWith('legacy:')) || processingSelection || loading} onClick={() => void deleteSelectedFromBank()}>{showHiddenAssets ? 'Eliminar definitivamente' : 'Eliminar del banco'}</button>
                <button type="button" style={styles.primary} disabled={!selectedItems.length || selectedHasHidden || processingSelection} onClick={() => void useSelectedItems()}>
                  {processingSelection ? (busyMessage || selectionStatus || 'Procesando...') : mode === 'pages' ? `Agregar páginas (${selectedItems.length})` : `Usar selección (${selectedItems.length})`}
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'upload' && (
          <div style={styles.body}>
            <div style={styles.folderPanel}>
              <label style={styles.fieldLabel}>
                Guardar en
                <select value={uploadFolderId ?? 'unfiled'} onChange={(event) => setUploadFolderId(event.target.value === 'unfiled' ? null : event.target.value)} style={styles.select}>
                  <option value="unfiled">Banco general</option>
                  {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
              </label>
              <div style={styles.inlineForm}>
                <input value={uploadFolderName} onChange={(event) => setUploadFolderName(event.target.value)} placeholder="Crear carpeta para esta subida" style={styles.inlineInput} maxLength={80} />
                <button type="button" style={styles.secondary} disabled={folderBusy || !uploadFolderName.trim()} onClick={() => void createFolder(uploadFolderName, 'upload')}>
                  {folderBusy ? 'Creando...' : 'Crear y seleccionar'}
                </button>
              </div>
              {folderError && <div style={styles.error}>{folderError}</div>}
            </div>
            <label style={styles.drop}>
              <input
                ref={fileInputRef}
                type="file"
                accept={accept}
                multiple={isMulti}
                style={{ display: 'none' }}
                onChange={(event) => chooseFiles(Array.from(event.target.files ?? []))}
              />
              <span style={styles.dropTitle}>{isMulti ? 'Seleccionar archivos' : 'Seleccionar archivo'}</span>
              <span style={styles.dropText}>{mode === 'svg' ? 'SVG seguro. Máximo 10 MB por archivo.' : 'JPEG, PNG, WebP, GIF o SVG seguro. Máximo 10 MB por archivo.'}</span>
            </label>

            {files.length > 0 && (
              <div style={styles.fileList}>
                {files.map((entry, index) => {
                  const key = fileKey(entry)
                  return (
                    <div key={key} style={styles.previewRow}>
                      {previewUrls[key] && <img src={previewUrls[key]} alt="" style={styles.preview} />}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={styles.fileName}>{index + 1}. {entry.name}</div>
                        <div style={styles.meta}>{entry.type || 'Tipo desconocido'} · {formatBytes(entry.size)}</div>
                      </div>
                      {!uploadResults.length && (
                        <button type="button" style={styles.remove} onClick={() => removeFile(key)}>Quitar</button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {uploadResults.length > 0 && (
              <div style={styles.results}>
                {uploadResults.map((result) => {
                  const key = fileKey(result.file)
                  const ok = !result.error
                  const selected = selectedUploads.includes(key)
                  return (
                    <label key={key} style={{ ...styles.resultRow, ...(ok ? {} : styles.resultError) }}>
                      {ok && isMulti && (
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => setSelectedUploads((prev) => selected ? prev.filter((item) => item !== key) : [...prev, key])}
                        />
                      )}
                      <span style={{ flex: 1 }}>
                        <b>{result.file.name}</b>
                        <span style={styles.meta}>
                          {' '}
                          {ok
                            ? `${result.reused ? 'Reutilizada' : 'Nueva'} · ${formatBytes(result.optimized?.metadata.original_size_bytes ?? result.file.size)} -> ${formatBytes(result.optimized?.metadata.optimized_size_bytes ?? result.asset?.size_bytes ?? result.file.size)}${result.optimized ? ` · Ahorro ${result.optimized.metadata.compression_saved_percent}%` : ''}`
                            : result.error}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            {error && <div style={styles.error}>{error}</div>}
            {optimizationStatus && <div style={styles.empty}>{optimizationStatus}</div>}
            {(busyMessage || selectionStatus) && <div style={styles.empty}>{busyMessage || selectionStatus}</div>}
            <div style={styles.actions}>
              <button type="button" style={styles.secondary} disabled={uploading || optimizing || processingSelection} onClick={onClose}>Cancelar</button>
              <button type="button" style={styles.secondary} disabled={!selectedUploads.length || uploading || optimizing || processingSelection} onClick={clearSelection}>Limpiar selección</button>
              {uploadResults.length ? (
                <button
                  type="button"
                  style={styles.primary}
                  disabled={processingSelection || (isMulti ? selectedUploads.length === 0 : !uploadResults.some((item) => !item.error))}
                  onClick={() => void useUploaded()}
                >
                  {processingSelection
                    ? (busyMessage || selectionStatus || 'Procesando...')
                    : mode === 'pages'
                    ? `Crear páginas (${isMulti ? selectedUploads.length : uploadResults.filter((item) => !item.error).length})`
                    : `Usar subidas (${isMulti ? selectedUploads.length : uploadResults.filter((item) => !item.error).length})`}
                </button>
              ) : (
                <button type="button" style={styles.primary} disabled={!files.length || uploading || optimizing || processingSelection} onClick={() => void uploadFiles()}>
                  {uploading || optimizing ? (optimizationStatus || 'Subiendo...') : mode === 'pages' ? `Subir y crear páginas (${files.length})` : `Subir ${files.length || ''}`.trim()}
                </button>
              )}
            </div>
          </div>
        )}

        {tab === 'pdf' && mode === 'pages' && (
          <div style={styles.body}>
            <label style={styles.drop}>
              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                style={{ display: 'none' }}
                onChange={(event) => {
                  setError('')
                  setPdfFile(event.target.files?.[0] ?? null)
                }}
              />
              <span style={styles.dropTitle}>Seleccionar PDF</span>
              <span style={styles.dropText}>Se convertirá en páginas como el flujo anterior. El PDF no se guarda en el banco.</span>
            </label>
            {pdfFile && (
              <div style={styles.previewRow}>
                <span style={styles.pdfIcon}>PDF</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={styles.fileName}>{pdfFile.name}</div>
                  <div style={styles.meta}>{formatBytes(pdfFile.size)}</div>
                </div>
              </div>
            )}
            {pdfStatus && <div style={styles.empty}>{pdfStatus}</div>}
            <div style={styles.actions}>
              <button type="button" style={styles.secondary} disabled={pdfProcessing} onClick={onClose}>Cancelar</button>
              <button type="button" style={styles.primary} disabled={!pdfFile || pdfProcessing} onClick={() => void usePdf()}>
                {pdfProcessing ? (pdfStatus || 'Importando...') : 'Importar PDF'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function normalizeUrlForCompare(url: string) {
  return toCanvasSafeAssetUrl(url).trim()
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 5200, background: 'rgba(17, 24, 39, 0.58)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modal: { width: 760, maxWidth: '100%', height: '86vh', maxHeight: '86vh', background: '#fff', borderRadius: 8, boxShadow: '0 22px 70px rgba(15, 23, 42, 0.32)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  modalSmall: { width: 460, maxWidth: '100%', background: '#fff', borderRadius: 8, boxShadow: '0 22px 70px rgba(15, 23, 42, 0.32)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid #e5e7eb' },
  title: { margin: 0, fontSize: 16, fontWeight: 750, color: '#111827' },
  close: { border: 'none', background: 'transparent', fontSize: 18, color: '#6b7280', cursor: 'pointer', width: 30, height: 30 },
  tabs: { display: 'flex', borderBottom: '1px solid #e5e7eb' },
  tab: { flex: 1, border: 'none', background: '#f9fafb', color: '#6b7280', fontSize: 13, fontWeight: 700, padding: '12px 14px', cursor: 'pointer' },
  tabActive: { background: '#fff', color: '#111827', boxShadow: 'inset 0 -2px 0 #4F46E5' },
  body: { padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 },
  searchRow: { display: 'flex', gap: 8, alignItems: 'center' },
  search: { height: 38, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 12px', fontSize: 13, outline: 'none', flex: 1 },
  hiddenToggle: { minHeight: 38, display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 12, color: '#374151', background: '#fff', whiteSpace: 'nowrap' },
  folderPanel: { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: '#fff' },
  folderHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  folderTitle: { fontSize: 13, fontWeight: 800, color: '#111827' },
  folderNav: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 },
  folderButton: { border: '1px solid #d1d5db', background: '#fff', color: '#374151', borderRadius: 7, padding: '7px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  folderButtonActive: { borderColor: '#4F46E5', background: '#eef2ff', color: '#3730a3' },
  folderButtonDrop: { borderColor: '#16a34a', background: '#f0fdf4', color: '#166534', boxShadow: '0 0 0 2px rgba(22, 163, 74, 0.16)' },
  folderCreateBox: { borderTop: '1px solid #f3f4f6', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 7 },
  folderEditBox: { borderTop: '1px solid #f3f4f6', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 7 },
  formTitle: { fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' },
  inlineForm: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  inlineInput: { height: 36, minWidth: 190, flex: '1 1 190px', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13, outline: 'none' },
  moveBar: { display: 'grid', gridTemplateColumns: 'auto minmax(190px, 1fr) auto', alignItems: 'center', gap: 8, border: '1px solid #c7d2fe', background: '#eef2ff', borderRadius: 8, padding: 10 },
  moveTitle: { fontSize: 13, fontWeight: 850, color: '#312e81', whiteSpace: 'nowrap' },
  moveSelect: { height: 38, minWidth: 0, border: '1px solid #a5b4fc', borderRadius: 7, padding: '0 10px', fontSize: 13, background: '#fff', color: '#111827' },
  fieldLabel: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 800, color: '#374151' },
  select: { height: 38, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13, background: '#fff', color: '#111827' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(142px, 1fr))', gap: 10 },
  card: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 8, cursor: 'pointer', textAlign: 'left', minWidth: 0 },
  cardSelected: { borderColor: '#4F46E5', boxShadow: '0 0 0 2px rgba(79, 70, 229, 0.12)' },
  thumbWrap: { position: 'relative', display: 'block', aspectRatio: '1', borderRadius: 6, background: '#f3f4f6', overflow: 'hidden', marginBottom: 8 },
  thumbSelected: { outline: '2px solid #4F46E5', outlineOffset: -2 },
  thumb: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  fallback: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 12, fontWeight: 800, background: '#e5e7eb' },
  check: { position: 'absolute', left: 6, right: 6, bottom: 6, background: '#4F46E5', color: '#fff', borderRadius: 5, padding: '3px 4px', fontSize: 10, fontWeight: 800, textAlign: 'center' },
  folderBadge: { display: 'inline-block', maxWidth: '100%', marginBottom: 5, background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 999, padding: '2px 6px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  name: { display: 'block', fontSize: 12, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  meta: { display: 'block', fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  empty: { color: '#6b7280', background: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: 8, padding: 18, textAlign: 'center', fontSize: 13 },
  error: { color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, padding: '9px 10px', fontSize: 12 },
  more: { alignSelf: 'center', border: '1px solid #d1d5db', background: '#fff', color: '#374151', borderRadius: 7, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  pageSummary: { display: 'flex', justifyContent: 'space-between', gap: 12, color: '#6b7280', fontSize: 12, fontWeight: 700 },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#374151', fontSize: 12, fontWeight: 700 },
  drop: { border: '1px dashed #9ca3af', borderRadius: 8, padding: 22, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', background: '#f9fafb' },
  dropTitle: { fontSize: 14, fontWeight: 750, color: '#111827' },
  dropText: { fontSize: 12, color: '#6b7280' },
  fileList: { display: 'flex', flexDirection: 'column', gap: 8 },
  previewRow: { display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #e5e7eb', borderRadius: 8, padding: 10 },
  preview: { width: 58, height: 58, objectFit: 'cover', borderRadius: 6, background: '#f3f4f6' },
  fileName: { fontSize: 13, fontWeight: 750, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  remove: { border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  results: { border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' },
  resultRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 12 },
  resultError: { background: '#fef2f2' },
  pdfIcon: { width: 58, height: 58, borderRadius: 6, background: '#fee2e2', color: '#991b1b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900 },
  success: { color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 7, padding: '12px 14px', fontSize: 13, fontWeight: 700 },
  warning: { color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, padding: '12px 14px', fontSize: 13 },
  usageList: { display: 'flex', flexDirection: 'column', gap: 6, color: '#374151', border: '1px solid #e5e7eb', borderRadius: 7, padding: '10px 12px', fontSize: 12 },
  actions: { position: 'sticky', bottom: -18, zIndex: 2, display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 0 0', marginTop: 'auto', background: '#fff', borderTop: '1px solid #e5e7eb', flexWrap: 'wrap' },
  primary: { border: 'none', background: '#4F46E5', color: '#fff', borderRadius: 7, padding: '9px 14px', fontSize: 13, fontWeight: 750, cursor: 'pointer' },
  secondary: { border: '1px solid #d1d5db', background: '#fff', color: '#374151', borderRadius: 7, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
}

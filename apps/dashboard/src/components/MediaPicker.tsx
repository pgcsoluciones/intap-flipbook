import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, toCanvasSafeAssetUrl, type MediaAsset } from '../lib/api'

const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,image/svg+xml,image/gif'
const ACCEPT_SVG = '.svg,image/svg+xml'
const MAX_PDF_BYTES = 50 * 1024 * 1024

type MediaPickerMode = 'image' | 'pages' | 'svg'

type MediaPickerProps = {
  open: boolean
  publicationId: string
  mode?: MediaPickerMode
  title?: string
  legacyUrls?: string[]
  multiple?: boolean
  busyMessage?: string
  usedPageUrls?: string[]
  onClose: () => void
  onSelect: (urls: string[], assets?: MediaAsset[]) => void | { confirmedCount?: number } | Promise<void | { confirmedCount?: number }>
  onPdfSelect?: (file: File, onProgress?: (message: string) => void) => void | { confirmedCount?: number } | Promise<void | { confirmedCount?: number }>
  onGoToPages?: () => void
}

type PickerItem = {
  key: string
  url: string
  name: string
  format: string
  size: string
  asset?: MediaAsset
}

type UploadResult = {
  file: File
  asset: MediaAsset
  url: string
  reused: boolean
  error?: string
}

type DeletePrompt = {
  mode: 'in-use' | 'unused'
  assets: Array<{ asset: MediaAsset; usage_count: number; usages: Array<{ label: string; type: string }> }>
  totalUses: number
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
          src={item.url}
          alt=""
          style={styles.thumb}
          loading="lazy"
          onError={() => {
            console.warn('[MediaPicker] thumbnail failed', item.url)
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
  mode = 'image',
  title,
  legacyUrls = [],
  multiple,
  busyMessage = '',
  usedPageUrls = [],
  onClose,
  onSelect,
  onPdfSelect,
  onGoToPages,
}: MediaPickerProps) {
  const [tab, setTab] = useState<'bank' | 'upload' | 'pdf'>('bank')
  const [q, setQ] = useState('')
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [pageNumber, setPageNumber] = useState(1)
  const [pageInfo, setPageInfo] = useState({ page: 1, total: 0, total_pages: 1, has_more: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([])
  const [selectedItems, setSelectedItems] = useState<PickerItem[]>([])
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
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pdfInputRef = useRef<HTMLInputElement | null>(null)
  const isMulti = multiple ?? mode !== 'image'
  const accept = mode === 'svg' ? ACCEPT_SVG : ACCEPT_IMAGE

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
    setFiles([])
    setPreviewUrls((prev) => {
      for (const url of Object.values(prev)) URL.revokeObjectURL(url)
      return {}
    })
    setUploadResults([])
    setSelectedUploads([])
    setSelectedItems([])
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
  }, [open, mode])

  const loadAssets = useCallback(async (nextPage: number) => {
    if (!open || !publicationId) return
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const res = await api.mediaAssets.list({
        publication_id: publicationId,
        q,
        limit: 12,
        page: nextPage,
      })
      if (seq !== loadSeqRef.current) return
      setAssets(res.data ?? [])
      setPageNumber(res.page?.page ?? nextPage)
      setPageInfo({
        page: res.page?.page ?? nextPage,
        total: res.page?.total ?? 0,
        total_pages: res.page?.total_pages ?? 1,
        has_more: !!res.page?.has_more,
      })
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo cargar el banco del proyecto')
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [open, publicationId, q])

  useEffect(() => {
    if (!open) return
    const handle = window.setTimeout(() => {
      void loadAssets(1)
    }, 200)
    return () => window.clearTimeout(handle)
  }, [loadAssets, open])

  const items = useMemo(() => {
    const seen = new Set<string>()
    const result: PickerItem[] = []
    for (const asset of assets) {
      if (!isAllowedAsset(asset, mode)) continue
      const url = toCanvasSafeAssetUrl(asset.public_url)
      if (!url || seen.has(url)) continue
      seen.add(url)
      result.push({
        key: `asset:${asset.id}`,
        url,
        name: asset.original_name,
        format: formatMime(asset.mime_type),
        size: formatBytes(asset.size_bytes),
        asset: { ...asset, public_url: url },
      })
    }
    const query = q.trim().toLowerCase()
    for (const legacyUrl of legacyUrls) {
      if (result.length >= 12) break
      const url = toCanvasSafeAssetUrl(legacyUrl)
      if (!url || seen.has(url) || !isAllowedLegacyUrl(url, mode)) continue
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
  }, [assets, legacyUrls, mode, q])

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

  const deleteSelectedFromBank = async () => {
    const selectedAssets = selectedItems.filter((item) => item.asset).map((item) => item.asset!)
    if (!selectedAssets.length) {
      setError('Selecciona una imagen del banco para eliminarla.')
      return
    }
    setLoading(true)
    setError('')
    setNotice('')
    setDeletePrompt(null)
    try {
      let totalUses = 0
      const usageByAsset: DeletePrompt['assets'] = []
      for (const asset of selectedAssets) {
        const usage = await api.mediaAssets.usage(asset.id, publicationId)
        totalUses += usage.data.usage_count
        usageByAsset.push({
          asset,
          usage_count: usage.data.usage_count,
          usages: usage.data.usages.map((item) => ({ label: item.label, type: item.type })),
        })
      }
      setDeletePrompt({ mode: totalUses > 0 ? 'in-use' : 'unused', assets: usageByAsset, totalUses })
    } catch (err: any) {
      setError(err?.message?.startsWith('Error 500') ? 'No se pudieron consultar los usos de esta imagen.' : err?.message ?? 'No fue posible eliminar la imagen.')
    } finally {
      setLoading(false)
    }
  }

  const refreshAfterBankRemoval = async (removedAssets: MediaAsset[]) => {
    setSelectedItems((prev) => prev.filter((item) => !item.asset || !removedAssets.some((asset) => asset.id === item.asset?.id)))
    const nextPage = items.length <= removedAssets.length && pageNumber > 1 ? pageNumber - 1 : pageNumber
    await loadAssets(nextPage)
  }

  const hidePromptAssets = async () => {
    if (!deletePrompt || loading) return
    const selectedAssets = deletePrompt.assets.map((item) => item.asset)
    setLoading(true)
    setError('')
    setNotice('')
    try {
      for (const asset of selectedAssets) await api.mediaAssets.hide(asset.id, true)
      setDeletePrompt(null)
      setNotice(selectedAssets.length === 1 ? 'La imagen fue quitada del banco sin afectar el proyecto.' : 'Las imágenes fueron quitadas del banco sin afectar el proyecto.')
      await refreshAfterBankRemoval(selectedAssets)
    } catch (err: any) {
      setError(err?.message ?? 'No fue posible quitar la imagen del banco.')
    } finally {
      setLoading(false)
    }
  }

  const deletePromptAssets = async () => {
    if (!deletePrompt || loading) return
    const selectedAssets = deletePrompt.assets.map((item) => item.asset)
    setLoading(true)
    setError('')
    setNotice('')
    try {
      for (const asset of selectedAssets) await api.mediaAssets.deleteMediaAsset(asset.id, publicationId)
      setDeletePrompt(null)
      setNotice(selectedAssets.length === 1 ? 'La imagen fue eliminada definitivamente.' : 'Las imágenes fueron eliminadas definitivamente.')
      await refreshAfterBankRemoval(selectedAssets)
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
    setUploading(true)
    setError('')
    const results: UploadResult[] = []
    try {
      for (const file of files) {
        try {
          const size = await readImageSize(file)
          const res = await api.mediaAssets.upload({
            publication_id: publicationId,
            file,
            width: size.width,
            height: size.height,
          })
          const asset = res.data.asset
          results.push({ file, asset, url: toCanvasSafeAssetUrl(res.data.url), reused: res.data.reused })
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
    } finally {
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
    const labels = deletePrompt.assets.flatMap((item) => item.usages.map((usage) => usage.label))
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
                ? `${deletePrompt.assets.length === 1 ? 'Esta imagen está' : 'Estas imágenes están'} siendo utilizada${deletePrompt.assets.length === 1 ? '' : 's'} en ${deletePrompt.totalUses} lugares del proyecto.`
                : `${deletePrompt.assets.length === 1 ? 'Esta imagen no está' : 'Estas imágenes no están'} siendo utilizada${deletePrompt.assets.length === 1 ? '' : 's'}. ¿Deseas eliminarla${deletePrompt.assets.length === 1 ? '' : 's'} definitivamente?`}
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
                  <button type="button" style={styles.primary} disabled={loading} onClick={() => void hidePromptAssets()}>{loading ? 'Quitando...' : 'Quitar del banco'}</button>
                </>
              ) : (
                <button type="button" style={styles.primary} disabled={loading} onClick={() => void deletePromptAssets()}>{loading ? 'Eliminando...' : 'Eliminar definitivamente'}</button>
              )}
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
            <input value={q} onChange={(event) => { setQ(event.target.value); setPageNumber(1) }} placeholder="Buscar por nombre" style={styles.search} />
            {error && <div style={styles.error}>{error}</div>}
            {notice && <div style={styles.success}>{notice}</div>}
            {(busyMessage || selectionStatus) && <div style={styles.empty}>{busyMessage || selectionStatus}</div>}
            <div style={styles.pageSummary}>
              <span>{selectedItems.length} seleccionada(s)</span>
              <span>{pageInfo.total} imagen(es)</span>
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
                    <button key={item.key} type="button" style={{ ...styles.card, ...(selected ? styles.cardSelected : {}) }} title={item.name} onClick={() => toggleItem(item)}>
                      <Thumb item={item} selected={selected} />
                      <span style={styles.name}>{item.name}</span>
                      <span style={styles.meta}>{item.format}{item.size ? ` · ${item.size}` : ''}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <div style={styles.pagination}>
              <button type="button" style={styles.more} disabled={loading || pageNumber <= 1} onClick={() => void loadAssets(pageNumber - 1)}>Anterior</button>
              <span>Página {pageInfo.page} de {pageInfo.total_pages}</span>
              <button type="button" style={styles.more} disabled={loading || !pageInfo.has_more} onClick={() => void loadAssets(pageNumber + 1)}>Siguiente</button>
            </div>
            {isMulti && (
              <div style={styles.actions}>
                <button type="button" style={styles.secondary} disabled={processingSelection} onClick={onClose}>Cancelar</button>
                <button type="button" style={styles.secondary} disabled={!selectedItems.length || processingSelection} onClick={clearSelection}>Limpiar selección</button>
                <button type="button" style={styles.secondary} disabled={!selectedItems.some((item) => item.asset) || processingSelection || loading} onClick={() => void deleteSelectedFromBank()}>Eliminar del banco</button>
                <button type="button" style={styles.primary} disabled={!selectedItems.length || processingSelection} onClick={() => void useSelectedItems()}>
                  {processingSelection ? (busyMessage || selectionStatus || 'Procesando...') : mode === 'pages' ? `Agregar páginas (${selectedItems.length})` : `Usar selección (${selectedItems.length})`}
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'upload' && (
          <div style={styles.body}>
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
                        <span style={styles.meta}> {ok ? (result.reused ? 'Reutilizada' : 'Nueva') : result.error}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            {error && <div style={styles.error}>{error}</div>}
            {(busyMessage || selectionStatus) && <div style={styles.empty}>{busyMessage || selectionStatus}</div>}
            <div style={styles.actions}>
              <button type="button" style={styles.secondary} disabled={uploading || processingSelection} onClick={onClose}>Cancelar</button>
              <button type="button" style={styles.secondary} disabled={!selectedUploads.length || uploading || processingSelection} onClick={clearSelection}>Limpiar selección</button>
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
                <button type="button" style={styles.primary} disabled={!files.length || uploading || processingSelection} onClick={() => void uploadFiles()}>
                  {uploading ? 'Subiendo...' : mode === 'pages' ? `Subir y crear páginas (${files.length})` : `Subir ${files.length || ''}`.trim()}
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
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid #e5e7eb' },
  title: { margin: 0, fontSize: 16, fontWeight: 750, color: '#111827' },
  close: { border: 'none', background: 'transparent', fontSize: 18, color: '#6b7280', cursor: 'pointer', width: 30, height: 30 },
  tabs: { display: 'flex', borderBottom: '1px solid #e5e7eb' },
  tab: { flex: 1, border: 'none', background: '#f9fafb', color: '#6b7280', fontSize: 13, fontWeight: 700, padding: '12px 14px', cursor: 'pointer' },
  tabActive: { background: '#fff', color: '#111827', boxShadow: 'inset 0 -2px 0 #4F46E5' },
  body: { padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 },
  search: { height: 38, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 12px', fontSize: 13, outline: 'none' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(142px, 1fr))', gap: 10 },
  card: { border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 8, cursor: 'pointer', textAlign: 'left', minWidth: 0 },
  cardSelected: { borderColor: '#4F46E5', boxShadow: '0 0 0 2px rgba(79, 70, 229, 0.12)' },
  thumbWrap: { position: 'relative', display: 'block', aspectRatio: '1', borderRadius: 6, background: '#f3f4f6', overflow: 'hidden', marginBottom: 8 },
  thumbSelected: { outline: '2px solid #4F46E5', outlineOffset: -2 },
  thumb: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  fallback: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 12, fontWeight: 800, background: '#e5e7eb' },
  check: { position: 'absolute', left: 6, right: 6, bottom: 6, background: '#4F46E5', color: '#fff', borderRadius: 5, padding: '3px 4px', fontSize: 10, fontWeight: 800, textAlign: 'center' },
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

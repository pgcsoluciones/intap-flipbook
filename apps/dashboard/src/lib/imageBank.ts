import { toCanvasSafeAssetUrl } from './api'

const IMAGE_BANK_PREFIX = 'imgbank_'
const LAST_IMAGE_BANK_FOLDER_KEY = 'image_bank_last_folder'

export type ImageBankFolder = {
  id: string
  name: string
  count?: number
}

export type TenantImageBankView = {
  folders: ImageBankFolder[]
  general: string[]
  byFolder: Record<string, string[]>
  all: string[]
}

type MediaFolderLike = {
  id?: string | number | null
  name?: string | null
}

type MediaAssetLike = {
  public_url?: string | null
  optimized_url?: string | null
  thumbnail_url?: string | null
  url?: string | null
  mime_type?: string | null
  folder_id?: string | number | null
  is_hidden?: boolean | number | null
  deleted_at?: string | null
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return /^https?:\/\//i.test(value) || value.startsWith('/api/upload/uploads/')
}

function safeBankUrl(value: unknown): string | null {
  if (!isHttpUrl(value)) return null
  if (value.startsWith('data:') || value.startsWith('blob:')) return null
  return toCanvasSafeAssetUrl(value)
}

function normalizeFolderId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

function extractList(payload: any): any[] {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.data?.items)) return payload.data.items
  if (Array.isArray(payload?.data?.folders)) return payload.data.folders
  if (Array.isArray(payload?.data?.assets)) return payload.data.assets
  if (Array.isArray(payload?.folders)) return payload.folders
  if (Array.isArray(payload?.assets)) return payload.assets
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

function normalizeMediaFolders(payload: any): ImageBankFolder[] {
  return extractList(payload)
    .map((folder: MediaFolderLike) => {
      const id = normalizeFolderId(folder?.id)
      if (!id) return null
      return {
        id,
        name: String(folder?.name ?? 'Carpeta'),
      }
    })
    .filter(Boolean) as ImageBankFolder[]
}

function normalizeMediaAssets(payload: any): MediaAssetLike[] {
  return extractList(payload).filter((asset: MediaAssetLike) => {
    if (!asset || typeof asset !== 'object') return false
    if (asset.deleted_at) return false
    if (asset.is_hidden === true || asset.is_hidden === 1) return false
    const mimeType = String(asset.mime_type ?? '')
    return !mimeType || mimeType.startsWith('image/')
  })
}

function buildMediaImageBankView(foldersPayload: any, assetsPayload: any): TenantImageBankView {
  const folders = normalizeMediaFolders(foldersPayload)
  const general = new Set<string>()
  const byFolder: Record<string, Set<string>> = {}
  const all = new Set<string>()

  folders.forEach((folder) => { byFolder[folder.id] = new Set<string>() })

  normalizeMediaAssets(assetsPayload).forEach((asset) => {
    const url = safeBankUrl(asset.optimized_url ?? asset.public_url ?? asset.url ?? asset.thumbnail_url)
    if (!url) return
    const folderId = normalizeFolderId(asset.folder_id)
    if (folderId) {
      if (!byFolder[folderId]) byFolder[folderId] = new Set<string>()
      byFolder[folderId].add(url)
    } else {
      general.add(url)
    }
    all.add(url)
  })

  return {
    folders: folders.map((folder) => ({ ...folder, count: byFolder[folder.id]?.size ?? 0 })),
    general: Array.from(general),
    byFolder: Object.fromEntries(Object.entries(byFolder).map(([folderId, urls]) => [folderId, Array.from(urls)])),
    all: Array.from(all),
  }
}

export function imageBankKey(publicationId: string | number | null | undefined): string {
  return `${IMAGE_BANK_PREFIX}${publicationId ?? ''}`
}

export function readProjectImageBank(publicationId: string | number | null | undefined): string[] {
  if (!publicationId) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(imageBankKey(publicationId)) ?? '[]')
    return Array.isArray(parsed)
      ? Array.from(new Set(parsed.map(safeBankUrl).filter(Boolean) as string[]))
      : []
  } catch {
    return []
  }
}

export function writeProjectImageBank(publicationId: string | number | null | undefined, values: string[]): string[] {
  if (!publicationId) return []
  const next = Array.from(new Set(values.map(safeBankUrl).filter(Boolean) as string[]))
  try { localStorage.setItem(imageBankKey(publicationId), JSON.stringify(next)) } catch {}
  return next
}

export function mergeProjectImageBank(publicationId: string | number | null | undefined, current: string[], urls: string[]): string[] {
  return writeProjectImageBank(publicationId, [...urls, ...current, ...readProjectImageBank(publicationId)])
}

export function collectImageBankFromPages(pages: any[]): string[] {
  const urls = new Set<string>()

  const add = (value: unknown) => {
    const safe = safeBankUrl(value)
    if (safe) urls.add(safe)
  }

  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    const item = node as Record<string, unknown>
    if (item.type === 'image') add(item.src)
    add(item.data && typeof item.data === 'object' ? (item.data as Record<string, unknown>).src : null)
    if (Array.isArray(item.objects)) visit(item.objects)
    if (Array.isArray(item._objects)) visit(item._objects)
    if (item.clipPath) visit(item.clipPath)
  }

  for (const page of pages) {
    add(page?.image_url)
    const canvasJson = page?.canvas_json
    if (!canvasJson) continue
    try {
      visit(typeof canvasJson === 'string' ? JSON.parse(canvasJson) : canvasJson)
    } catch {
      /* invalid canvas_json is ignored, matching the Editor behavior */
    }
  }

  return Array.from(urls)
}

export function buildProjectImageBank(publicationId: string | number | null | undefined, pages: any[]): string[] {
  return Array.from(new Set([...collectImageBankFromPages(pages), ...readProjectImageBank(publicationId)]))
}

export async function loadTenantImageBank(api: {
  publications: {
    list: () => Promise<{ success: true; data: any[] }>
    get: (id: string) => Promise<{ success: true; data: any }>
  }
}): Promise<string[]> {
  const publications = await api.publications.list()
  const ids = (publications.data ?? []).map((publication: any) => String(publication.id)).filter(Boolean)
  const details = await Promise.allSettled(ids.map((id) => api.publications.get(id)))
  const urls = new Set<string>()

  ids.forEach((id) => {
    readProjectImageBank(id).forEach((url) => urls.add(url))
  })
  details.forEach((entry, index) => {
    if (entry.status !== 'fulfilled') return
    buildProjectImageBank(ids[index], entry.value.data?.pages ?? []).forEach((url) => urls.add(url))
  })

  return Array.from(urls)
}

export async function loadTenantImageBankView(api: {
  publications: {
    list: () => Promise<{ success: true; data: any[] }>
    get: (id: string) => Promise<{ success: true; data: any }>
  }
  folders: {
    list: () => Promise<{ success: true; data: any[] }>
  }
}): Promise<TenantImageBankView> {
  const [publications, foldersResponse] = await Promise.all([
    api.publications.list(),
    api.folders.list().catch(() => ({ success: true as const, data: [] })),
  ])
  const publicationsList = publications.data ?? []
  const folders = (foldersResponse.data ?? []).map((folder: any) => ({
    id: String(folder.id),
    name: String(folder.name ?? 'Carpeta'),
    count: Number(folder.pub_count ?? 0),
  }))
  const details = await Promise.allSettled(publicationsList.map((publication: any) => api.publications.get(String(publication.id))))
  const general = new Set<string>()
  const byFolder: Record<string, Set<string>> = {}
  const all = new Set<string>()

  publicationsList.forEach((publication: any, index: number) => {
    const id = String(publication.id)
    const folderId = publication.folder_id ? String(publication.folder_id) : null
    const entry = details[index]
    const pages = entry.status === 'fulfilled' ? entry.value.data?.pages ?? [] : []
    const urls = buildProjectImageBank(id, pages)
    if (folderId) {
      if (!byFolder[folderId]) byFolder[folderId] = new Set<string>()
      urls.forEach((url) => byFolder[folderId].add(url))
    } else {
      urls.forEach((url) => general.add(url))
    }
    urls.forEach((url) => all.add(url))
  })

  return {
    folders,
    general: Array.from(general),
    byFolder: Object.fromEntries(Object.entries(byFolder).map(([folderId, urls]) => [folderId, Array.from(urls)])),
    all: Array.from(all),
  }
}

export function getLastImageBankFolder(): string | null {
  try {
    const value = localStorage.getItem(LAST_IMAGE_BANK_FOLDER_KEY)
    return value ? value : null
  } catch {
    return null
  }
}

export function setLastImageBankFolder(folderId: string | null): void {
  try {
    if (folderId) localStorage.setItem(LAST_IMAGE_BANK_FOLDER_KEY, folderId)
    else localStorage.removeItem(LAST_IMAGE_BANK_FOLDER_KEY)
  } catch {}
}

export async function addTenantImageBankUrl(
  api: {
    publications: {
      list: () => Promise<{ success: true; data: any[] }>
    }
  },
  url: string,
  folderId?: string | null,
): Promise<string[]> {
  const safe = safeBankUrl(url)
  if (!safe) return []
  const publications = await api.publications.list()
  const ids = (publications.data ?? [])
    .filter((publication: any) => folderId ? String(publication.folder_id ?? '') === folderId : !publication.folder_id)
    .map((publication: any) => String(publication.id))
    .filter(Boolean)
  ids.forEach((id) => mergeProjectImageBank(id, readProjectImageBank(id), [safe]))
  return ids
}

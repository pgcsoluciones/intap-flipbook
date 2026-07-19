export type PageLike = {
  id: string
  page_number?: number | null
  image_url?: string | null
  canvas_json?: unknown
  [key: string]: unknown
}

export type PageBatchConfirmation<Page extends PageLike = PageLike> = {
  requestedCount: number
  createdPages: Page[]
  confirmedPages: Page[]
  serverPages: Page[]
}

export class PageBatchConfirmationError<Page extends PageLike = PageLike> extends Error {
  confirmation: PageBatchConfirmation<Page>

  constructor(message: string, confirmation: PageBatchConfirmation<Page>) {
    super(message)
    this.name = 'PageBatchConfirmationError'
    this.confirmation = confirmation
  }
}

export type ProcessPageBatchOptions<Page extends PageLike> = {
  urls: string[]
  createPages: (urls: string[]) => Promise<Page[]>
  refetchPages: () => Promise<Page[]>
  commitPages: (pages: Page[]) => void
  requestThumbnail?: (page: Page, opts: { isLast: boolean; index: number }) => void
  setActivePage?: (page: Page) => void
  onProgress?: (message: string, index: number, total: number) => void
}

export type ProcessPageBatchResult<Page extends PageLike> = PageBatchConfirmation<Page> & {
  lastPage: Page | null
}

export type UploadedPdfAsset<Asset = unknown> = {
  asset: Asset
  url: string
  reused: boolean
}

export type UploadPdfRenderedPagesOptions<Asset = unknown> = {
  publicationId: string
  pages: Array<{ file: File; width?: number | null; height?: number | null }>
  uploadAsset: (input: { publication_id: string; file: File; width?: number | null; height?: number | null }) => Promise<{ success: true; data: UploadedPdfAsset<Asset> }>
  onProgress?: (message: string, index: number, total: number) => void
}

export async function processPageBatch<Page extends PageLike>({
  urls,
  createPages,
  refetchPages,
  commitPages,
  requestThumbnail,
  setActivePage,
  onProgress,
}: ProcessPageBatchOptions<Page>): Promise<ProcessPageBatchResult<Page>> {
  const selectedUrls = urls.filter(Boolean)
  const total = selectedUrls.length
  if (!total) {
    return { requestedCount: 0, createdPages: [], confirmedPages: [], serverPages: [], lastPage: null }
  }

  onProgress?.(`Creando página 1 de ${total}`, 0, total)
  const createdPages = await createPages(selectedUrls)
  onProgress?.('Confirmando páginas...', total - 1, total)
  const serverPages = await refetchPages()
  const createdIds = new Set(createdPages.map((page) => page.id).filter(Boolean))
  const confirmedPages = serverPages.filter((page) =>
    createdIds.has(page.id)
    && !!page.image_url
    && hasValidCanvasJson(page.canvas_json)
  )

  if (confirmedPages.length !== total) {
    const confirmation = { requestedCount: total, createdPages, confirmedPages, serverPages }
    throw new PageBatchConfirmationError(
      confirmedPages.length
        ? `Se agregaron ${confirmedPages.length} de ${total} páginas. ${total - confirmedPages.length} páginas no pudieron confirmarse.`
        : 'No se pudo agregar ninguna página.',
      confirmation,
    )
  }

  commitPages(serverPages)
  const lastPage = confirmedPages[confirmedPages.length - 1] ?? null
  for (let index = 0; index < confirmedPages.length; index += 1) {
    const page = confirmedPages[index]
    requestThumbnail?.(page, { isLast: page.id === lastPage?.id, index })
  }
  if (lastPage) setActivePage?.(lastPage)

  return { requestedCount: total, createdPages, confirmedPages, serverPages, lastPage }
}

export function hasValidCanvasJson(value: unknown) {
  if (!value) return false
  if (typeof value === 'string') {
    try {
      return hasValidCanvasJson(JSON.parse(value))
    } catch {
      return false
    }
  }
  return typeof value === 'object' && Array.isArray((value as any).objects)
}

export function pdfPageAssetName(pdfName: string, pageNumber: number) {
  const baseName = (pdfName || 'PDF').replace(/\.[^.]+$/, '').trim() || 'PDF'
  return `${baseName} — página ${String(pageNumber).padStart(3, '0')}.jpg`
}

export async function uploadPdfRenderedPagesAsAssets<Asset = unknown>({
  publicationId,
  pages,
  uploadAsset,
  onProgress,
}: UploadPdfRenderedPagesOptions<Asset>) {
  const results: UploadedPdfAsset<Asset>[] = []
  const total = pages.length
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]
    onProgress?.(`Guardando imagen ${index + 1} de ${total} en el banco`, index, total)
    const res = await uploadAsset({
      publication_id: publicationId,
      file: page.file,
      width: page.width ?? null,
      height: page.height ?? null,
    })
    results.push(res.data)
  }
  return {
    results,
    assets: results.map((item) => item.asset),
    urls: results.map((item) => item.url),
    reusedCount: results.filter((item) => item.reused).length,
    createdAssetCount: results.filter((item) => !item.reused).length,
  }
}

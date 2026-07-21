type PreviewUrlInput = {
  viewerBase: string
  tenantSlug?: string | null
  publicationSlug?: string | null
  apiBase?: string | null
  previewToken?: string | null
  previewMode?: boolean
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '')
}

function cleanAbsoluteUrl(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL inválida')
  url.hash = ''
  return url
}

export function canOpenPublicationPreview(publication: { public_slug?: string | null; pages?: unknown[] | null }) {
  return !!publication.public_slug && Array.isArray(publication.pages) && publication.pages.length > 0
}

export function buildPublicationViewerUrl(input: PreviewUrlInput) {
  if (!input.publicationSlug) return null

  const base = cleanAbsoluteUrl(input.viewerBase)
  const tenant = trimSlashes(input.tenantSlug || 'preview')
  const publication = trimSlashes(input.publicationSlug)
  base.pathname = `/${tenant}/${publication}`

  if (input.previewMode) {
    if (!input.apiBase || !input.previewToken) return null
    base.searchParams.set('preview', '1')
    base.searchParams.set('publication', publication)
    base.searchParams.set('api_base', cleanAbsoluteUrl(input.apiBase).toString().replace(/\/+$/, ''))
    base.searchParams.set('preview_token', input.previewToken)
  }

  return base.toString()
}

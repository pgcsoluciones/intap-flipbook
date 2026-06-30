type Env = {
  API_BASE_URL?: string
  ASSETS: Fetcher
}

type SocialMeta = {
  title: string
  description: string
  image_url: string | null
  image_version: string | null
  canonical_url: string
}

type SocialMetaResponse = {
  success?: boolean
  data?: Partial<SocialMeta>
}

type PagesContext = {
  request: Request
  env: Env
  params: {
    tenantSlug?: string | string[]
    publicationSlug?: string | string[]
  }
  next: () => Promise<Response>
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const META_TIMEOUT_MS = 1500
const SOCIAL_HTML_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400'

function singleParam(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : null
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function withVersion(rawUrl: string, version?: string | null) {
  const url = new URL(rawUrl)
  if (version) url.searchParams.set('v', version)
  return url.toString()
}

function requestCanonicalUrl(request: Request) {
  const url = new URL(request.url)
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function fetchMetaWithTimeout(
  apiBaseUrl: string,
  tenantSlug: string,
  publicationSlug: string,
  fallbackCanonical: string,
): Promise<SocialMeta | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), META_TIMEOUT_MS)

  try {
    const base = apiBaseUrl.replace(/\/+$/, '')
    const res = await fetch(
      `${base}/view/meta/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(publicationSlug)}`,
      {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      },
    )
    if (!res.ok) return null

    const payload = await res.json() as SocialMetaResponse
    const data = payload?.data
    if (!data || typeof data.title !== 'string' || typeof data.description !== 'string') return null

    const canonicalUrl = isHttpsUrl(data.canonical_url) ? data.canonical_url : fallbackCanonical
    const imageUrl = isHttpsUrl(data.image_url) ? data.image_url : null

    return {
      title: data.title,
      description: data.description,
      image_url: imageUrl,
      image_version: typeof data.image_version === 'string' ? data.image_version : null,
      canonical_url: canonicalUrl,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

class RemoveElementHandler {
  element(element: Element) {
    element.remove()
  }
}

class HeadMetaHandler {
  constructor(private readonly meta: SocialMeta) {}

  element(element: Element) {
    const title = escapeAttr(this.meta.title)
    const description = escapeAttr(this.meta.description)
    const canonical = escapeAttr(this.meta.canonical_url)
    const tags = [
      `<meta property="og:title" content="${title}">`,
      `<meta property="og:description" content="${description}">`,
      `<meta property="og:url" content="${canonical}">`,
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:title" content="${title}">`,
      `<meta name="twitter:description" content="${description}">`,
      `<link rel="canonical" href="${canonical}">`,
    ]

    if (this.meta.image_url) {
      const imageUrl = escapeAttr(withVersion(this.meta.image_url, this.meta.image_version))
      tags.splice(2, 0, `<meta property="og:image" content="${imageUrl}">`)
      tags.splice(7, 0, `<meta name="twitter:image" content="${imageUrl}">`)
    }

    element.append(tags.join('\n'), { html: true })
  }
}

class TitleHandler {
  constructor(private readonly title: string) {}

  element(element: Element) {
    element.setInnerContent(this.title)
  }
}

function rewriteHtml(shell: Response, meta: SocialMeta) {
  const remove = new RemoveElementHandler()
  const rewritten = new HTMLRewriter()
    .on('meta[property="og:title"]', remove)
    .on('meta[property="og:description"]', remove)
    .on('meta[property="og:image"]', remove)
    .on('meta[property="og:url"]', remove)
    .on('meta[name="twitter:card"]', remove)
    .on('meta[name="twitter:title"]', remove)
    .on('meta[name="twitter:description"]', remove)
    .on('meta[name="twitter:image"]', remove)
    .on('link[rel="canonical"]', remove)
    .on('title', new TitleHandler(meta.title))
    .on('head', new HeadMetaHandler(meta))
    .transform(shell)

  const headers = new Headers(rewritten.headers)
  headers.set('Cache-Control', SOCIAL_HTML_CACHE)
  headers.delete('content-length')

  return new Response(rewritten.body, {
    status: rewritten.status,
    statusText: rewritten.statusText,
    headers,
  })
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  if (context.request.method !== 'GET') return context.next()
  if (!context.env.API_BASE_URL) return context.next()

  const tenantSlug = singleParam(context.params.tenantSlug)
  const publicationSlug = singleParam(context.params.publicationSlug)
  if (!tenantSlug || !publicationSlug || !SLUG_RE.test(tenantSlug) || !SLUG_RE.test(publicationSlug)) {
    return context.next()
  }

  const fallbackCanonical = requestCanonicalUrl(context.request)
  const meta = await fetchMetaWithTimeout(context.env.API_BASE_URL, tenantSlug, publicationSlug, fallbackCanonical)
  if (!meta) return context.next()

  const shell = await context.next()
  const contentType = shell.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) return shell

  return rewriteHtml(shell, meta)
}

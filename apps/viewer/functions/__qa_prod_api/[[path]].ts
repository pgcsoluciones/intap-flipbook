type Env = {
  API_BASE_URL?: string
}

type PagesContext = {
  request: Request
  env: Env
  params: {
    path?: string | string[]
  }
}

function pathParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join('/')
  return typeof value === 'string' ? value : ''
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const method = context.request.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }

  const relativePath = pathParam(context.params.path).replace(/^\/+/, '')
  if (!relativePath.startsWith('view/')) {
    return new Response('Not Found', { status: 404 })
  }

  const apiBase = context.env.API_BASE_URL?.replace(/\/+$/, '')
  if (!apiBase) {
    return new Response('QA proxy unavailable', { status: 503 })
  }

  const incoming = new URL(context.request.url)
  const upstream = new URL(`${apiBase}/${relativePath}`)
  upstream.search = incoming.search

  const response = await fetch(upstream.toString(), {
    method,
    headers: {
      Accept: context.request.headers.get('Accept') || 'application/json',
    },
  })

  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.delete('set-cookie')

  return new Response(method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

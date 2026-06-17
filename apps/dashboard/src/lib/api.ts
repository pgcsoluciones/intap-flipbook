export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

function getToken(): string | null {
  return localStorage.getItem('token')
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  const raw = await res.text()
  let data: any = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    // La respuesta no es JSON (p. ej. "404 Not Found" de una ruta no desplegada)
    if (!res.ok) {
      throw new Error(
        res.status === 404
          ? 'Esta función aún no está disponible en el servidor (falta desplegar la API).'
          : `Error ${res.status}: ${raw.slice(0, 120)}`,
      )
    }
    throw new Error('Respuesta inválida del servidor')
  }
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
  return data
}

export const api = {
  auth: {
    register: (email: string, password: string, name?: string) =>
      request<{ success: true; data: { token: string } }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      }),
    login: (email: string, password: string) =>
      request<{ success: true; data: { token: string } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    me: () =>
      request<{ success: true; data: { id: string; email: string; name: string; plan_id: string } }>('/auth/me'),
  },

  publications: {
    list: () => request<{ success: true; data: any[] }>('/api/publications'),
    get: (id: string) => request<{ success: true; data: any }>(`/api/publications/${id}`),
    create: (body: { title: string; description?: string; category?: string }) =>
      request<{ success: true; data: any }>('/api/publications', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      request<{ success: true; data: any }>(`/api/publications/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: string) =>
      request<{ success: true; data: any }>(`/api/publications/${id}`, { method: 'DELETE' }),
    publish: (id: string) =>
      request<{ success: true; data: any }>(`/api/publications/${id}/publish`, { method: 'POST' }),
  },

  pages: {
    add: (pubId: string, body: { image_url: string; title?: string; description?: string; price?: string }) =>
      request<{ success: true; data: any }>(`/api/publications/${pubId}/pages`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (pageId: string, body: Record<string, unknown>) =>
      request<{ success: true; data: any }>(`/api/pages/${pageId}`, { method: 'PUT', body: JSON.stringify(body) }),
    saveCanvas: (pageId: string, canvasJson: string) =>
      request<{ success: true; data: any }>(`/api/pages/${pageId}`, { method: 'PUT', body: JSON.stringify({ canvas_json: canvasJson }) }),
    delete: (pageId: string) =>
      request<{ success: true; data: any }>(`/api/pages/${pageId}`, { method: 'DELETE' }),
    reorder: (publicationId: string, pageIds: string[]) =>
      request<{ success: true; data: any }>('/api/pages/reorder', {
        method: 'POST',
        body: JSON.stringify({ publication_id: publicationId, page_ids: pageIds }),
      }),
  },

  plan: {
    usage: () => request<{ success: true; data: any }>('/api/me/usage'),
  },

  templates: {
    list: () => request<{ success: true; data: any[] }>('/api/templates'),
    apply: (templateId: number | string, body: { publication_id?: string; title?: string }) =>
      request<{ success: true; data: { publication_id: string; pages_added: number } }>(
        `/api/templates/${templateId}/apply`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
  },

  resources: {
    list: () => request<{ success: true; data: any[] }>('/api/resources'),
  },

  responses: {
    list: () => request<{ success: true; data: any[] }>('/api/responses'),
    unreadCount: () => request<{ success: true; data: { count: number } }>('/api/responses/unread-count'),
    markRead: (id: number | string) => request<{ success: true }>(`/api/responses/${id}/read`, { method: 'PATCH' }),
    remove: (id: number | string) => request<{ success: true }>(`/api/responses/${id}`, { method: 'DELETE' }),
  },

  upload: (file: File) => {
    const token = getToken()
    const form = new FormData()
    form.append('file', file)
    return fetch(`${API_BASE}/api/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    }).then((r) => r.json()) as Promise<{ success: true; data: { url: string; key: string } }>
  },
}

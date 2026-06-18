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
    register: (email: string, password: string, name?: string, slug?: string) =>
      request<{ success: true; data: { token: string } }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name, slug }),
      }),
    login: (email: string, password: string) =>
      request<{ success: true; data: { token: string } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    me: () =>
      request<{ success: true; data: { id: string; email: string; name: string; slug: string | null; plan_id: string; is_admin?: number } }>('/auth/me'),
    updateProfile: (body: { name?: string; slug?: string }) =>
      request<{ success: true; data: any }>('/auth/me', { method: 'PUT', body: JSON.stringify(body) }),
    impersonate: (userId: string) =>
      request<{ success: true; data: { token: string; user: any } }>(`/admin/users/${userId}/impersonate`, { method: 'POST' }),
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

  folders: {
    list: () => request<{ success: true; data: any[] }>('/api/folders'),
    create: (name: string) => request<{ success: true; data: any }>('/api/folders', { method: 'POST', body: JSON.stringify({ name }) }),
    rename: (id: string, name: string) => request<{ success: true }>(`/api/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
    remove: (id: string) => request<{ success: true }>(`/api/folders/${id}`, { method: 'DELETE' }),
    move: (pubId: string, folder_id: string | null) =>
      request<{ success: true }>(`/api/publications/${pubId}/folder`, { method: 'PATCH', body: JSON.stringify({ folder_id }) }),
  },

  modules: {
    myModules: () => request<{ success: true; data: any[] }>('/api/me/modules'),
    tenantModules: (userId: string) => request<{ success: true; data: any[] }>(`/admin/users/${userId}/modules`),
    toggleTenantModule: (userId: string, key: string, enabled: boolean) =>
      request<{ success: true }>(`/admin/users/${userId}/modules/${key}`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  },

  planRequests: {
    create: (requested_plan: string, notes?: string) =>
      request<{ success: true; data: { id: number } }>('/api/plan-requests', {
        method: 'POST',
        body: JSON.stringify({ requested_plan, notes }),
      }),
    list: () => request<{ success: true; data: any[] }>('/api/plan-requests'),
  },

  notifications: {
    list: () => request<{ success: true; data: any[] }>('/api/notifications'),
    markRead: (id: number | string) => request<{ success: true }>(`/api/notifications/${id}/read`, { method: 'PATCH' }),
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

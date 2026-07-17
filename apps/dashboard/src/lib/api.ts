export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'
const API_ORIGIN = new URL(API_BASE).origin

export function toCanvasSafeAssetUrl(url: string) {
  const value = (url ?? '').trim()
  if (!value) return value
  try {
    const parsed = new URL(value)
    if (parsed.origin === API_ORIGIN && parsed.pathname.startsWith('/api/upload/')) return value
    if (parsed.hostname.endsWith('.r2.dev') && parsed.pathname.startsWith('/uploads/')) {
      return `${API_ORIGIN}/api/upload${parsed.pathname}${parsed.search}${parsed.hash}`
    }
  } catch {
    return value
  }
  return value
}

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

export type DynamicMarkerStatus = 'draft' | 'active' | 'inactive'
export type DynamicMarkerVisibility = 'public' | 'internal'
export type DynamicMarkerCustomFieldType = 'text' | 'number' | 'boolean' | 'date' | 'url' | 'email' | 'phone'
export type DynamicMarkerMediaType = 'image' | 'video' | 'audio'

export type DynamicMarkerActions = {
  contact_whatsapp?: {
    enabled: boolean
    phone: string
    label?: string
    message_template: string
  }
  whatsapp?: {
    enabled: boolean
    phone: string
    label?: string
    message_template: string
  }
  external_link?: {
    enabled: boolean
    label: string
    url: string
  }
  share?: {
    enabled?: boolean
    label?: string
    whatsapp: boolean
    facebook: boolean
    x: boolean
    copy_link: boolean
    native: boolean
    instagram_url?: string
  }
  offer_cta?: {
    target: '' | 'contact_whatsapp' | 'external_link' | 'share'
    preset?: string
    custom_label?: string
  }
}

export type DynamicMarker = {
  id: string
  user_id: string
  publication_id: string
  page_id: string
  target_object_id: string
  target_kind: string | null
  status: DynamicMarkerStatus
  name: string | null
  reference: string | null
  category: string | null
  description: string | null
  price_minor: number | null
  previous_price_minor: number | null
  currency: string | null
  availability: string | null
  promotion_text: string | null
  accent_color: string | null
  badge_text: string | null
  promotion_ends_at: string | null
  post_promotion_price_minor: number | null
  colors_json: string
  materials_json: string
  sizes_json: string
  measurements_json: string
  media_json: string
  actions_json: string
  custom_fields_json: string
  cloned_from_marker_id: string | null
  created_at: string
  updated_at: string
}

export type DynamicMarkerCatalogItem = {
  id: string
  publication_id: string
  publication_title: string | null
  page_id: string
  page_number: number | null
  target_object_id: string
  target_kind: string | null
  status: DynamicMarkerStatus
  name: string | null
  reference: string | null
  category: string | null
  price_minor: number | null
  currency: string | null
  availability: string | null
  cover_url: string | null
  updated_at: string
}

export type CreateDynamicMarkerInput = {
  publication_id: string
  page_id: string
  target_object_id: string
  target_kind?: string | null
}

export type UpdateDynamicMarkerInput = {
  status?: DynamicMarkerStatus
  name?: string | null
  reference?: string | null
  category?: string | null
  description?: string | null
  price_minor?: number | null
  previous_price_minor?: number | null
  currency?: string | null
  availability?: string | null
  promotion_text?: string | null
  accent_color?: string | null
  badge_text?: string | null
  promotion_ends_at?: string | null
  post_promotion_price_minor?: number | null
  colors_json?: unknown[] | string | null
  materials_json?: unknown[] | string | null
  sizes_json?: unknown[] | string | null
  measurements_json?: unknown[] | string | null
  media_json?: unknown[] | string | null
  actions_json?: DynamicMarkerActions | string | null
  custom_fields_json?: unknown[] | string | null
  target_kind?: string | null
}

export type ReuseDynamicMarkerInput = {
  target_marker_id: string
  name: string
  reference?: string | null
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
      request<{ success: true; data: { id: string; email: string; name: string; slug: string | null; plan_id: string; is_admin?: number; watermark_tenant?: string | null; logo_url?: string | null; contact_phone?: string | null; contact_whatsapp?: string | null; contact_email?: string | null; contact_address?: string | null } }>('/auth/me'),
    updateProfile: (body: { name?: string; slug?: string; logo_url?: string | null; contact_phone?: string | null; contact_whatsapp?: string | null; contact_email?: string | null; contact_address?: string | null }) =>
      request<{ success: true; data: any }>('/auth/me', { method: 'PUT', body: JSON.stringify(body) }),
    impersonate: (userId: string) =>
      request<{ success: true; data: { token: string; user: any } }>(`/admin/users/${userId}/impersonate`, { method: 'POST' }),
  },

  publications: {
    list: () => request<{ success: true; data: any[] }>('/api/publications'),
    trash: () => request<{ success: true; data: any[] }>('/api/publications/trash'),
    restore: (id: string) => request<{ success: true; data: any }>(`/api/publications/${id}/restore`, { method: 'PATCH' }),
    permanentDelete: (id: string) => request<{ success: true; data: any }>(`/api/publications/${id}/permanent`, { method: 'DELETE' }),
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

  stats: {
    publication: (id: string) =>
      request<{ success: true; data: {
        publication: { id: string; title: string; status: string; views_count: number; public_slug: string | null }
        total_views: number
        recent_views: { id: number; viewed_at: string; device: string }[]
        device_breakdown: { device: string; count: number }[]
        page_times: { page_number: number; visits: number; avg_ms: number }[]
        button_clicks: { label: string; action_type: string; page_number: number; clicks: number }[]
        views_by_day: { day: string; views: number }[]
      } }>(`/auth/stats/pub/${id}`),
  },

  responses: {
    list: () => request<{ success: true; data: any[] }>('/api/responses'),
    unreadCount: () => request<{ success: true; data: { count: number } }>('/api/responses/unread-count'),
    markRead: (id: number | string) => request<{ success: true }>(`/api/responses/${id}/read`, { method: 'PATCH' }),
    remove: (id: number | string) => request<{ success: true }>(`/api/responses/${id}`, { method: 'DELETE' }),
  },

  proposals: {
    create: (data: { publication_id: string; title: string; description?: string; category?: string; cover_url?: string }) =>
      request<{ success: true; data: { id: number } }>('/api/template-proposals', { method: 'POST', body: JSON.stringify(data) }),
    list: () => request<{ success: true; data: any[] }>('/api/template-proposals'),
    listAll: () => request<{ success: true; data: any[] }>('/admin/template-proposals'),
    approve: (id: number | string) =>
      request<{ success: true; data: { template_id: number } }>(`/admin/template-proposals/${id}/approve`, { method: 'PATCH' }),
    reject: (id: number | string, adminNotes?: string) =>
      request<{ success: true }>(`/admin/template-proposals/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ admin_notes: adminNotes }) }),
  },

  dynamicMarkers: {
    catalog: (params: {
      limit?: number
      cursor?: string | null
      q?: string
      status?: DynamicMarkerStatus | ''
      publication_id?: string
    } = {}) => {
      const qs = new URLSearchParams()
      if (params.limit != null) qs.set('limit', String(params.limit))
      if (params.cursor) qs.set('cursor', params.cursor)
      if (params.q) qs.set('q', params.q)
      if (params.status) qs.set('status', params.status)
      if (params.publication_id) qs.set('publication_id', params.publication_id)
      return request<{
        success: true
        data: DynamicMarkerCatalogItem[]
        page: {
          limit: number
          has_more: boolean
          next_cursor: string | null
        }
      }>(`/api/dynamic-markers/catalog${qs.size ? `?${qs}` : ''}`)
    },
    list: (publicationId: string, pageId?: string) => {
      const qs = `publication_id=${encodeURIComponent(publicationId)}${pageId ? `&page_id=${encodeURIComponent(pageId)}` : ''}`
      return request<{ success: true; data: DynamicMarker[] }>(`/api/dynamic-markers?${qs}`)
    },
    get: (id: string) =>
      request<{ success: true; data: DynamicMarker }>(`/api/dynamic-markers/${encodeURIComponent(id)}`),
    create: (input: CreateDynamicMarkerInput) =>
      request<{ success: true; data: DynamicMarker }>('/api/dynamic-markers', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: UpdateDynamicMarkerInput) =>
      request<{ success: true; data: DynamicMarker }>(`/api/dynamic-markers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
    setStatus: (id: string, status: DynamicMarkerStatus) =>
      request<{ success: true; data: DynamicMarker }>(`/api/dynamic-markers/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    reuse: (sourceId: string, body: ReuseDynamicMarkerInput) =>
      request<{ success: true; data: DynamicMarker }>(`/api/dynamic-markers/${encodeURIComponent(sourceId)}/reuse`, { method: 'POST', body: JSON.stringify(body) }),
  },
  adminSvg: {
    list: (params?: { family?: string; status?: string; q?: string }) => {
      const qs = new URLSearchParams(
        Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][]
      ).toString()
      return request<{ success: true; data: any[] }>(`/admin/svg${qs ? `?${qs}` : ''}`)
    },
    create: (data: any) =>
      request<{ success: true; data: { id: number; slug: string; svg_url: string } }>('/admin/svg', {
        method: 'POST', body: JSON.stringify(data),
      }),
    batch: (data: { items: { name: string; svg_content: string; tags?: string[] }[] } & Record<string, any>) =>
      request<{ success: true; data: { created: any[]; errors: any[] } }>('/admin/svg/batch', {
        method: 'POST', body: JSON.stringify(data),
      }),
    update: (id: number | string, data: any) =>
      request<{ success: true }>(`/admin/svg/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    archive: (id: number | string) =>
      request<{ success: true }>(`/admin/svg/${id}/archive`, { method: 'PATCH' }),
    remove: (id: number | string) =>
      request<{ success: true }>(`/admin/svg/${id}`, { method: 'DELETE' }),
    newVersion: (id: number | string, svg_content: string) =>
      request<{ success: true; data: { version: number; svg_url: string } }>(`/admin/svg/${id}/version`, {
        method: 'POST', body: JSON.stringify({ svg_content }),
      }),
    versions: (id: number | string) =>
      request<{ success: true; data: any[] }>(`/admin/svg/${id}/versions`),
    families: {
      list: () => request<{ success: true; data: any[] }>('/admin/svg/families'),
      create: (data: { name: string; category?: string; sort_order?: number }) =>
        request<{ success: true; data: { id: number; slug: string } }>('/admin/svg/families', {
          method: 'POST', body: JSON.stringify(data),
        }),
      update: (id: number | string, data: any) =>
        request<{ success: true }>(`/admin/svg/families/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
      remove: (id: number | string) =>
        request<{ success: true }>(`/admin/svg/families/${id}`, { method: 'DELETE' }),
    },
  },

  // Biblioteca SVG — consumo del tenant (filtrada por plan/módulo)
  svgLibrary: (module?: string) =>
    request<{ success: true; data: any[] }>(`/api/svg${module ? `?module=${encodeURIComponent(module)}` : ''}`),

  // Contenido SVG crudo (texto) de un recurso — para insertar como vector en el editor.
  // Se pide a la API (no a r2.dev) para evitar CORS y validar acceso por plan.
  svgRaw: (id: number | string) => {
    const token = getToken()
    return fetch(`${API_BASE}/api/svg/${id}/raw`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(async (r) => {
      if (!r.ok) {
        const t = await r.text().catch(() => '')
        let msg = `Error ${r.status}`
        try { msg = JSON.parse(t)?.error ?? msg } catch {}
        throw new Error(msg)
      }
      return r.text()
    })
  },

  public: {
    feed: (tenantSlug: string) =>
      fetch(`${API_BASE}/public/${encodeURIComponent(tenantSlug)}`)
        .then((r) => r.json()) as Promise<{ success: true; data: any[] }>,
  },

  upload: (file: File) => {
    const token = getToken()
    const form = new FormData()
    form.append('file', file)
    return fetch(`${API_BASE}/api/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    }).then(async (r) => {
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.success) throw new Error(data?.error ?? `Error ${r.status} al subir archivo`)
      if (data?.data?.url) data.data.url = toCanvasSafeAssetUrl(data.data.url)
      return data
    }) as Promise<{ success: true; data: { url: string; key: string } }>
  },

  // Borra un archivo subido a R2 a partir de su URL pública.
  deleteUpload: (url: string) =>
    request<{ success: true }>('/api/upload', {
      method: 'DELETE',
      body: JSON.stringify({ url }),
    }),
}

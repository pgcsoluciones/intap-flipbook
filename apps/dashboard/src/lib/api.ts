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

export class ApiRequestError extends Error {
  status: number
  code?: string
  data?: unknown

  constructor(message: string, status: number, code?: string, data?: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.data = data
  }
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
      throw new ApiRequestError(`Error ${res.status}`, res.status)
    }
    throw new Error('Respuesta inválida del servidor')
  }
  if (!res.ok) throw new ApiRequestError(data?.error ?? `HTTP ${res.status}`, res.status, data?.code, data)
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
  booking?: {
    enabled: boolean
    label?: string
    appointment_types?: string[]
    require_date?: boolean
    require_time?: boolean
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
  page_id: string | null
  target_object_id: string | null
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
  booking_calendar_id: string | null
  cloned_from_marker_id: string | null
  usage_count?: number
  is_in_use?: boolean
  created_at: string
  updated_at: string
}

export type DynamicMarkerCatalogItem = {
  id: string
  publication_id: string
  publication_title: string | null
  page_id: string | null
  page_number: number | null
  target_object_id: string | null
  target_kind: string | null
  status: DynamicMarkerStatus
  name: string | null
  reference: string | null
  category: string | null
  price_minor: number | null
  currency: string | null
  availability: string | null
  cover_url: string | null
  usage_count: number
  is_in_use: boolean
  booking_calendar: {
    id: string
    name: string | null
  } | null
  updated_at: string
}

export type DynamicMarkerUsage = {
  marker_id: string
  publication_id: string
  publication_name: string
  public_slug: string | null
  page_id: string
  page_number: number
  element_id: string | null
  object_type: string | null
  object_label: string | null
  sources: Array<'direct' | 'action'>
}

export type DynamicMarkerUsageResponse = {
  marker_id: string
  usage_count: number
  usages: DynamicMarkerUsage[]
}

export type CreateDynamicMarkerInput = {
  publication_id: string
  page_id: string
  target_object_id: string
  target_kind?: string | null
}

export type CreateIndependentDynamicMarkerInput = {
  publication_id: string
  name: string
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
  booking_calendar_id?: string | null
  target_kind?: string | null
}

export type AppointmentCalendarWindow = {
  id?: string
  weekday: number
  start_time: string
  end_time: string
  active?: boolean | number
  sort_order?: number
}

export type AppointmentCalendarException = {
  id?: string
  date: string
  kind: 'blocked_full' | 'blocked_partial' | 'extra'
  start_time?: string | null
  end_time?: string | null
  max_per_slot_override?: number | null
  note?: string | null
}

export type AppointmentCalendarType = {
  id?: string
  label: string
  delivery_mode?: 'in_person' | 'video_call' | 'phone_call' | 'other'
  location_text?: string | null
  meeting_url?: string | null
  customer_instructions?: string | null
  duration_minutes?: number | null
  buffer_minutes?: number | null
  max_per_slot?: number | null
  active?: boolean | number
  sort_order?: number
}

export type AppointmentCalendar = {
  id: string
  user_id: string
  name: string
  timezone: string
  slot_interval_minutes: number
  default_duration_minutes: number
  default_buffer_minutes: number
  max_per_slot: number
  max_per_day: number
  min_notice_minutes: number
  booking_horizon_days: number
  hold_expires_after_minutes: number
  marker_count?: number
  has_active_windows?: boolean | number
  has_active_types?: boolean | number
  created_at: string
  updated_at: string
}

export type AppointmentBooking = {
  id: string
  user_id: string
  publication_id: string
  marker_id: string
  calendar_id: string
  appointment_type: string
  starts_at_utc: string
  ends_at_utc: string
  local_date: string
  local_time: string
  timezone: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'rejected' | 'expired'
  hold_expires_at: string | null
  delivery_mode_snapshot?: 'in_person' | 'video_call' | 'phone_call' | 'other' | null
  location_snapshot?: string | null
  customer_instructions_snapshot?: string | null
  calendar_name?: string | null
  marker_name?: string | null
  marker_reference?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  customer_email?: string | null
  created_at: string
  updated_at: string
}

export type AppointmentCalendarInput = {
  marker_id?: string
  name: string
  timezone: string
  slot_interval_minutes: number
  default_duration_minutes: number
  default_buffer_minutes: number
  max_per_slot: number
  max_per_day: number
  min_notice_minutes: number
  booking_horizon_days: number
  hold_expires_after_minutes: number
  weekly_windows: AppointmentCalendarWindow[]
  exceptions: AppointmentCalendarException[]
  appointment_types: AppointmentCalendarType[]
}

export type ReuseDynamicMarkerInput = {
  target_marker_id: string
  name: string
  reference?: string | null
}

export type CloneDynamicMarkerInput = {
  publication_id: string
  page_id: string
  target_object_id: string
  target_kind?: string | null
}

export type LeadIntakeStatus = 'new' | 'contacted' | 'quoted' | 'won' | 'lost'
export type LeadIntakeRequestType = 'quote' | 'booking'

export type LeadIntake = {
  id: string
  tenant_id: string
  publication_id: string
  marker_id: string
  request_type: LeadIntakeRequestType
  status: LeadIntakeStatus
  customer_name: string
  customer_phone: string
  customer_email: string | null
  customer_message: string | null
  marker_snapshot_json: string
  selection_json: string | null
  source_url: string | null
  internal_note: string | null
  crm_contact_id: string | null
  crm_lead_id: string | null
  booking_id: string | null
  booking_calendar_id?: string | null
  booking_local_date?: string | null
  booking_local_time?: string | null
  booking_appointment_type?: string | null
  booking_status?: string | null
  booking_delivery_mode?: 'in_person' | 'video_call' | 'phone_call' | 'other' | null
  booking_location?: string | null
  booking_customer_instructions?: string | null
  read_at?: string | null
  created_at: string
  updated_at: string
  handled_at: string | null
  marker_name?: string | null
  marker_reference?: string | null
  publication_title?: string | null
}

export type LeadIntakeCustomerMessageEvent =
  | 'quote_sent'
  | 'booking_confirmed'
  | 'booking_rejected'
  | 'booking_cancelled'
  | 'booking_rescheduled'

export type LeadIntakeCustomerMessageStatus = 'pending' | 'opened' | 'sent'

export type LeadIntakeCustomerMessage = {
  id: string
  tenant_id: string
  lead_intake_id: string
  event_type: LeadIntakeCustomerMessageEvent
  channel: 'whatsapp'
  message_text: string
  note_text: string | null
  status: LeadIntakeCustomerMessageStatus
  opened_at: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
  attachment?: LeadIntakeCustomerMessageAttachment | null
}

export type LeadIntakeCustomerMessageAttachment = {
  id: string
  original_name: string
  mime_type: string
  size_bytes: number
  download_expires_at: string | null
  created_at: string
}

export type MediaAsset = {
  id: string
  tenant_id: string
  publication_id: string
  folder_id?: string | null
  storage_bucket: string
  storage_key: string
  public_url: string
  original_url?: string
  optimized_storage_key?: string | null
  optimized_url?: string | null
  optimized_mime_type?: string | null
  optimized_size_bytes?: number | null
  optimized_width?: number | null
  optimized_height?: number | null
  display_url?: string
  original_name: string
  mime_type: string
  size_bytes: number
  sha256: string
  width: number | null
  height: number | null
  original_mime_type?: string | null
  original_size_bytes?: number | null
  original_width?: number | null
  original_height?: number | null
  thumbnail_storage_key?: string | null
  thumbnail_url?: string | null
  thumbnail_mime_type?: string | null
  thumbnail_size_bytes?: number | null
  thumbnail_width?: number | null
  thumbnail_height?: number | null
  optimization_status?: string | null
  optimization_version?: string | null
  optimized_at?: string | null
  is_hidden?: number | null
  deleted_at?: string | null
  created_at: string
  updated_at: string
}

export type ProductDetailStatus = 'active' | 'inactive'

export type ProductDetail = {
  id: number
  tenant_id: string
  internal_name: string
  title: string
  description: string | null
  price: string | null
  image_url: string | null
  accent_color: string
  cta_type: string | null
  cta_label: string | null
  cta_target: string | null
  status: ProductDetailStatus
  usage_count: number
  created_at: string
  updated_at: string
}

export type ProductDetailInput = {
  internal_name: string
  title: string
  description?: string | null
  price?: string | null
  image_url?: string | null
  accent_color?: string | null
  cta_type?: string | null
  cta_label?: string | null
  cta_target?: string | null
  status?: ProductDetailStatus
}

export type ProductDetailImportRow = ProductDetailInput & {
  row: number
  existing_id?: number
  import_decision?: 'replace' | 'keep' | 'skip'
}

export type ProductDetailImportResult = {
  success: true
  created: number
  updated?: number
  kept?: number
  skipped?: number
  invalid: Array<{ row: number; field: string; message: string }>
  duplicates: Array<{
    row: number
    internal_name: string
    title?: string
    existing_id?: number
    existing_internal_name?: string
    existing_title?: string
    match_fields?: string[]
    changes?: Array<{ field: string; current: string | null; incoming: string | null }>
  }>
}

export type MediaFolder = {
  id: string
  tenant_id: string
  publication_id: string
  name: string
  asset_count: number
  created_at: string
  updated_at: string
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
    previewAccess: (id: string) =>
      request<{ success: true; data: { token: string; public_slug: string; expires_in_seconds: number } }>(`/api/publications/${id}/preview-access`),
  },

  pages: {
    add: (pubId: string, body: { image_url: string; title?: string; description?: string; price?: string }) =>
      request<{ success: true; data: any }>(`/api/publications/${pubId}/pages`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    addBatch: (pubId: string, body: { pages: Array<{ image_url: string; canvas_json: unknown; size_bytes?: number }> }) =>
      request<{ success: true; pages: any[]; data?: { pages: any[] } }>(`/api/publications/${pubId}/pages/batch`, {
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
      has_booking?: boolean | null
    } = {}) => {
      const qs = new URLSearchParams()
      if (params.limit != null) qs.set('limit', String(params.limit))
      if (params.cursor) qs.set('cursor', params.cursor)
      if (params.q) qs.set('q', params.q)
      if (params.status) qs.set('status', params.status)
      if (params.publication_id) qs.set('publication_id', params.publication_id)
      if (params.has_booking != null) qs.set('has_booking', params.has_booking ? 'true' : 'false')
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
    usages: (id: string) =>
      request<{ success: true; data: DynamicMarkerUsageResponse }>(`/api/dynamic-markers/${encodeURIComponent(id)}/usages`),
    create: (input: CreateDynamicMarkerInput) =>
      request<{ success: true; data: DynamicMarker }>('/api/dynamic-markers', { method: 'POST', body: JSON.stringify(input) }),
    createIndependent: (input: CreateIndependentDynamicMarkerInput) =>
      request<{ success: true; data: DynamicMarker }>('/api/dynamic-markers/independent', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: UpdateDynamicMarkerInput) =>
      request<{ success: true; data: DynamicMarker }>(`/api/dynamic-markers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
    setStatus: (id: string, status: DynamicMarkerStatus) =>
      request<{ success: true; data: DynamicMarker }>(`/api/dynamic-markers/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    reuse: (sourceId: string, body: ReuseDynamicMarkerInput) =>
      request<{ success: true; data: DynamicMarker }>(`/api/dynamic-markers/${encodeURIComponent(sourceId)}/reuse`, { method: 'POST', body: JSON.stringify(body) }),
    clone: (sourceId: string, body: CloneDynamicMarkerInput) =>
      request<{ success: true; data: DynamicMarker }>(`/api/dynamic-markers/${encodeURIComponent(sourceId)}/clone`, { method: 'POST', body: JSON.stringify(body) }),
  },
  productDetails: {
    list: (params: { q?: string; status?: ProductDetailStatus | ''; limit?: number; offset?: number } = {}) => {
      const qs = new URLSearchParams()
      if (params.q) qs.set('q', params.q)
      if (params.status) qs.set('status', params.status)
      if (params.limit != null) qs.set('limit', String(params.limit))
      if (params.offset != null) qs.set('offset', String(params.offset))
      return request<{
        success: true
        data: ProductDetail[]
        page?: {
          limit: number
          offset: number
          total: number
          total_pages: number
        }
      }>(`/api/product-details${qs.size ? `?${qs}` : ''}`)
    },
    get: (id: number | string) =>
      request<{ success: true; data: ProductDetail }>(`/api/product-details/${encodeURIComponent(id)}`),
    linkable: (id: number | string) =>
      request<{ success: true; data: ProductDetail }>(`/api/product-details/${encodeURIComponent(id)}/linkable`),
    create: (body: ProductDetailInput) =>
      request<{ success: true; data: ProductDetail }>('/api/product-details', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number | string, body: ProductDetailInput) =>
      request<{ success: true; data: ProductDetail }>(`/api/product-details/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    setStatus: (id: number | string, status: ProductDetailStatus) =>
      request<{ success: true; data: ProductDetail }>(`/api/product-details/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    duplicate: (id: number | string) =>
      request<{ success: true; data: ProductDetail }>(`/api/product-details/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
    usage: (id: number | string) =>
      request<{ success: true; data: { id: number; usage_count: number } }>(`/api/product-details/${encodeURIComponent(id)}/usage`),
    import: (rows: ProductDetailImportRow[], dryRun = false) =>
      request<ProductDetailImportResult>('/api/product-details/import', { method: 'POST', body: JSON.stringify({ rows, dry_run: dryRun }) }),
    remove: (id: number | string) =>
      request<{ success: true; data: { id: number } }>(`/api/product-details/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  appointmentCalendars: {
    list: (params: {
      publication_id?: string
      q?: string
      scope?: 'publication' | 'tenant'
      limit?: number
      cursor?: string
    } = {}) => {
      const qs = new URLSearchParams()
      if (params.publication_id) qs.set('publication_id', params.publication_id)
      if (params.q) qs.set('q', params.q)
      if (params.scope) qs.set('scope', params.scope)
      if (params.limit != null) qs.set('limit', String(params.limit))
      if (params.cursor) qs.set('cursor', params.cursor)
      return request<{
        success: true
        data: AppointmentCalendar[]
        page?: {
          limit: number
          has_more: boolean
          next_cursor: string | null
        }
      }>(`/api/appointment-calendars${qs.size ? `?${qs}` : ''}`)
    },
    create: (body: AppointmentCalendarInput) =>
      request<{ success: true; data: AppointmentCalendar }>('/api/appointment-calendars', { method: 'POST', body: JSON.stringify(body) }),
    get: (id: string) =>
      request<{ success: true; data: { calendar: AppointmentCalendar; windows: AppointmentCalendarWindow[]; exceptions: AppointmentCalendarException[]; types: AppointmentCalendarType[] } }>(`/api/appointment-calendars/${encodeURIComponent(id)}`),
    update: (id: string, body: AppointmentCalendarInput) =>
      request<{ success: true; data: { calendar: AppointmentCalendar; windows: AppointmentCalendarWindow[]; exceptions: AppointmentCalendarException[]; types: AppointmentCalendarType[] } }>(`/api/appointment-calendars/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    availability: (id: string, params: { date?: string; appointment_type?: string } = {}) => {
      const qs = new URLSearchParams()
      if (params.date) qs.set('date', params.date)
      if (params.appointment_type) qs.set('appointment_type', params.appointment_type)
      return request<{ success: true; data: { timezone: string; date: string; slots: { time: string; label: string }[] } }>(`/api/appointment-calendars/${encodeURIComponent(id)}/availability${qs.size ? `?${qs}` : ''}`)
    },
  },
  appointments: {
    list: (params: {
      publication_id?: string
      calendar_id?: string
      marker_id?: string
      status?: AppointmentBooking['status'] | ''
      appointment_type?: string
      from?: string
      to?: string
      limit?: number
      cursor?: string
    } = {}) => {
      const qs = new URLSearchParams()
      if (params.publication_id) qs.set('publication_id', params.publication_id)
      if (params.calendar_id) qs.set('calendar_id', params.calendar_id)
      if (params.marker_id) qs.set('marker_id', params.marker_id)
      if (params.status) qs.set('status', params.status)
      if (params.appointment_type) qs.set('appointment_type', params.appointment_type)
      if (params.from) qs.set('from', params.from)
      if (params.to) qs.set('to', params.to)
      if (params.limit != null) qs.set('limit', String(params.limit))
      if (params.cursor) qs.set('cursor', params.cursor)
      return request<{
        success: true
        data: AppointmentBooking[]
        page: {
          from: string
          to: string
          limit: number
          has_more: boolean
          next_cursor: string | null
        }
      }>(`/api/appointments${qs.size ? `?${qs}` : ''}`)
    },
    setStatus: (id: string, status: AppointmentBooking['status']) =>
      request<{ success: true; data: AppointmentBooking }>(`/api/appointments/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    reschedule: (id: string, body: { local_date: string; local_time: string; appointment_type?: string }) =>
      request<{ success: true; data: AppointmentBooking }>(`/api/appointments/${encodeURIComponent(id)}/reschedule`, { method: 'PATCH', body: JSON.stringify(body) }),
  },
  leadIntakes: {
    list: (params: {
      publication_id?: string
      status?: LeadIntakeStatus | ''
      request_type?: LeadIntakeRequestType | ''
      q?: string
      limit?: number
      cursor?: string | null
    } = {}) => {
      const qs = new URLSearchParams()
      if (params.publication_id) qs.set('publication_id', params.publication_id)
      if (params.status) qs.set('status', params.status)
      if (params.request_type) qs.set('request_type', params.request_type)
      if (params.q) qs.set('q', params.q)
      if (params.limit) qs.set('limit', String(params.limit))
      if (params.cursor) qs.set('cursor', params.cursor)

      return request<{
        success: true
        data: LeadIntake[]
        page: {
          limit: number
          has_more: boolean
          next_cursor: string | null
        }
      }>(`/api/lead-intakes${qs.size ? `?${qs}` : ''}`)
    },
    summary: () =>
      request<{
        success: true
        data: {
          total: number
          quotes: number
          bookings: number
        }
      }>('/api/lead-intakes/summary'),
    markRead: (id: string) =>
      request<{ success: true; data: { id: string; read_at: string | null } }>(
        `/api/lead-intakes/${encodeURIComponent(id)}/read`,
        { method: 'PATCH' },
      ),
    customerMessages: {
      list: (id: string) =>
        request<{ success: true; data: LeadIntakeCustomerMessage[] }>(
          `/api/lead-intakes/${encodeURIComponent(id)}/customer-messages`,
        ),
      createDraft: (id: string, event_type: LeadIntakeCustomerMessageEvent) =>
        request<{ success: true; data: LeadIntakeCustomerMessage }>(
          `/api/lead-intakes/${encodeURIComponent(id)}/customer-messages`,
          { method: 'POST', body: JSON.stringify({ event_type }) },
        ),
      update: (
        id: string,
        messageId: string,
        body: {
          message_text?: string
          note_text?: string
          status?: LeadIntakeCustomerMessageStatus
        },
      ) =>
        request<{ success: true; data: LeadIntakeCustomerMessage }>(
          `/api/lead-intakes/${encodeURIComponent(id)}/customer-messages/${encodeURIComponent(messageId)}`,
          { method: 'PATCH', body: JSON.stringify(body) },
        ),
      attach: (id: string, messageId: string, file: File) => {
        const token = getToken()
        const form = new FormData()
        form.append('file', file)
        return fetch(
          `${API_BASE}/api/lead-intakes/${encodeURIComponent(id)}/customer-messages/${encodeURIComponent(messageId)}/attachment`,
          {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: form,
          },
        ).then(async (response) => {
          const data = await response.json().catch(() => null)
          if (!response.ok || !data?.success) {
            throw new Error(data?.error ?? `Error ${response.status} al adjuntar cotización`)
          }
          return data
        }) as Promise<{ success: true; data: LeadIntakeCustomerMessageAttachment }>
      },
      removeAttachment: (id: string, messageId: string) =>
        request<{ success: true }>(
          `/api/lead-intakes/${encodeURIComponent(id)}/customer-messages/${encodeURIComponent(messageId)}/attachment`,
          { method: 'DELETE' },
        ),
      createAttachmentLink: (id: string, messageId: string) =>
        request<{ success: true; data: { download_url: string; expires_at: string | null } }>(
          `/api/lead-intakes/${encodeURIComponent(id)}/customer-messages/${encodeURIComponent(messageId)}/attachment-link`,
          { method: 'POST' },
        ),
    },
    get: (id: string) =>
      request<{ success: true; data: LeadIntake }>(`/api/lead-intakes/${encodeURIComponent(id)}`),
    update: (id: string, body: { status?: LeadIntakeStatus; internal_note?: string }) =>
      request<{ success: true; data: LeadIntake }>(`/api/lead-intakes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
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

  mediaAssets: {
    list: (params: { publication_id: string; q?: string; limit?: number; cursor?: string | null; page?: number; folder_id?: string | null; hidden?: boolean; needs_thumbnail?: boolean; needs_optimization?: boolean; kind?: 'image' | 'media' }) => {
      const qs = new URLSearchParams()
      qs.set('publication_id', params.publication_id)
      if (params.q) qs.set('q', params.q)
      if (params.limit != null) qs.set('limit', String(params.limit))
      if (params.cursor) qs.set('cursor', params.cursor)
      if (params.page != null) qs.set('page', String(params.page))
      if (params.folder_id !== undefined) qs.set('folder_id', params.folder_id ?? 'unfiled')
      if (params.hidden) qs.set('hidden', 'true')
      if (params.needs_thumbnail) qs.set('needs_thumbnail', 'true')
      if (params.needs_optimization) qs.set('needs_optimization', 'true')
      if (params.kind) qs.set('kind', params.kind)
      return request<{
        success: true
        data: MediaAsset[]
        page: { limit: number; page: number; total: number; total_pages: number; has_more: boolean; next_cursor: string | null; known_urls?: string[] }
        meta?: { known_urls?: string[]; excluded_legacy_urls?: string[] }
      }>(`/api/upload/media-assets?${qs}`)
    },
    adopt: (input: { publication_id: string; public_url: string; original_name?: string }) =>
      request<{ success: true; data: { asset: MediaAsset; url: string; reused: boolean } }>('/api/upload/media-assets/adopt', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((data) => {
        if (data?.data?.asset?.public_url) data.data.asset.public_url = toCanvasSafeAssetUrl(data.data.asset.public_url)
        if (data?.data?.url) data.data.url = toCanvasSafeAssetUrl(data.data.url)
        return data
      }),
    move: (input: { publication_id: string; asset_ids: string[]; folder_id: string | null }) =>
      request<{ success: true; data: { moved_count: number; folder_id: string | null } }>('/api/upload/media-assets/move', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    upload: (input: {
      publication_id: string
      file: File
      folder_id?: string | null
      thumbnail?: File | null
      width?: number | null
      height?: number | null
      optimization?: Record<string, unknown>
    }) => {
      const token = getToken()
      const form = new FormData()
      form.append('publication_id', input.publication_id)
      form.append('file', input.file)
      if (input.folder_id !== undefined) form.append('folder_id', input.folder_id ?? 'unfiled')
      if (input.thumbnail) form.append('thumbnail', input.thumbnail)
      if (input.width != null) form.append('width', String(input.width))
      if (input.height != null) form.append('height', String(input.height))
      if (input.optimization) {
        for (const [key, value] of Object.entries(input.optimization)) {
          if (value != null) form.append(key, String(value))
        }
      }
      return fetch(`${API_BASE}/api/upload/media-assets`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      }).then(async (r) => {
        const data = await r.json().catch(() => null)
        if (!r.ok || !data?.success) throw new Error(data?.error ?? `Error ${r.status} al subir imagen`)
        if (data?.data?.asset?.public_url) data.data.asset.public_url = toCanvasSafeAssetUrl(data.data.asset.public_url)
        if (data?.data?.asset?.original_url) data.data.asset.original_url = toCanvasSafeAssetUrl(data.data.asset.original_url)
        if (data?.data?.asset?.optimized_url) data.data.asset.optimized_url = toCanvasSafeAssetUrl(data.data.asset.optimized_url)
        if (data?.data?.asset?.display_url) data.data.asset.display_url = toCanvasSafeAssetUrl(data.data.asset.display_url)
        if (data?.data?.asset?.thumbnail_url) data.data.asset.thumbnail_url = toCanvasSafeAssetUrl(data.data.asset.thumbnail_url)
        if (data?.data?.url) data.data.url = toCanvasSafeAssetUrl(data.data.asset?.display_url || data.data.url)
        return data
      }) as Promise<{ success: true; data: { asset: MediaAsset; url: string; reused: boolean } }>
    },
    uploadThumbnail: (assetId: string, input: { publication_id: string; thumbnail: File; metadata?: Record<string, unknown> }) => {
      const token = getToken()
      const form = new FormData()
      form.append('publication_id', input.publication_id)
      form.append('thumbnail', input.thumbnail)
      if (input.metadata) {
        for (const [key, value] of Object.entries(input.metadata)) {
          if (value != null) form.append(key, String(value))
        }
      }
      return fetch(`${API_BASE}/api/upload/media-assets/${encodeURIComponent(assetId)}/thumbnail`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      }).then(async (r) => {
        const data = await r.json().catch(() => null)
        if (!r.ok || !data?.success) throw new Error(data?.error ?? `Error ${r.status} al subir miniatura`)
        if (data?.data?.asset?.public_url) data.data.asset.public_url = toCanvasSafeAssetUrl(data.data.asset.public_url)
        if (data?.data?.asset?.thumbnail_url) data.data.asset.thumbnail_url = toCanvasSafeAssetUrl(data.data.asset.thumbnail_url)
        return data
      }) as Promise<{ success: true; data: { asset: MediaAsset } }>
    },
    uploadVariants: (assetId: string, input: { publication_id: string; display?: File | null; thumbnail?: File | null; metadata?: Record<string, unknown> }) => {
      const token = getToken()
      const form = new FormData()
      form.append('publication_id', input.publication_id)
      if (input.display) form.append('display', input.display)
      if (input.thumbnail) form.append('thumbnail', input.thumbnail)
      if (input.metadata) {
        for (const [key, value] of Object.entries(input.metadata)) {
          if (value != null) form.append(key, String(value))
        }
      }
      return fetch(`${API_BASE}/api/upload/media-assets/${encodeURIComponent(assetId)}/variants`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      }).then(async (r) => {
        const data = await r.json().catch(() => null)
        if (!r.ok || !data?.success) throw new Error(data?.error ?? `Error ${r.status} al subir variantes`)
        if (data?.data?.asset?.public_url) data.data.asset.public_url = toCanvasSafeAssetUrl(data.data.asset.public_url)
        if (data?.data?.asset?.original_url) data.data.asset.original_url = toCanvasSafeAssetUrl(data.data.asset.original_url)
        if (data?.data?.asset?.optimized_url) data.data.asset.optimized_url = toCanvasSafeAssetUrl(data.data.asset.optimized_url)
        if (data?.data?.asset?.display_url) data.data.asset.display_url = toCanvasSafeAssetUrl(data.data.asset.display_url)
        if (data?.data?.asset?.thumbnail_url) data.data.asset.thumbnail_url = toCanvasSafeAssetUrl(data.data.asset.thumbnail_url)
        return data
      }) as Promise<{ success: true; data: { asset: MediaAsset } }>
    },
    usage: (assetId: string, publicationId: string) => {
      const qs = new URLSearchParams({ publication_id: publicationId })
      return request<{ success: true; data: { asset_id: string; usage_count: number; can_delete_physical: boolean; usages: Array<{ type: string; page_id?: string; page_number?: number | null; marker_id?: string; field: string; label: string }> } }>(
        `/api/upload/media-assets/${encodeURIComponent(assetId)}/usage?${qs}`,
      )
    },
    usageByUrl: (input: { publication_id: string; public_url: string }) =>
      request<{ success: true; data: { asset_id: null; public_url: string; usage_count: number; can_delete_physical: false; usages: Array<{ type: string; page_id?: string; page_number?: number | null; marker_id?: string; field: string; label: string }> } }>(
        '/api/upload/media-assets/usage-by-url',
        {
          method: 'POST',
          body: JSON.stringify({
            publication_id: input.publication_id,
            public_url: toCanvasSafeAssetUrl(input.public_url),
          }),
        },
      ),
    resolveThumbnails: (input: { publication_id: string; public_urls: string[] }) =>
      request<{ success: true; data: { thumbnails: Record<string, string>; displays?: Record<string, string>; variants?: Record<string, { original_url: string; display_url: string; thumbnail_url: string | null; optimized_url: string | null }>; assets: MediaAsset[] } }>('/api/upload/media-assets/resolve-thumbnails', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((data) => {
        const thumbnails: Record<string, string> = {}
        const displays: Record<string, string> = {}
        const variants: Record<string, { original_url: string; display_url: string; thumbnail_url: string | null; optimized_url: string | null }> = {}
        for (const [url, thumbnailUrl] of Object.entries(data.data.thumbnails ?? {})) {
          thumbnails[toCanvasSafeAssetUrl(url)] = toCanvasSafeAssetUrl(thumbnailUrl)
        }
        for (const [url, displayUrl] of Object.entries(data.data.displays ?? {})) {
          displays[toCanvasSafeAssetUrl(url)] = toCanvasSafeAssetUrl(displayUrl)
        }
        for (const [url, variant] of Object.entries(data.data.variants ?? {})) {
          variants[toCanvasSafeAssetUrl(url)] = {
            original_url: toCanvasSafeAssetUrl(variant.original_url),
            display_url: toCanvasSafeAssetUrl(variant.display_url),
            thumbnail_url: variant.thumbnail_url ? toCanvasSafeAssetUrl(variant.thumbnail_url) : null,
            optimized_url: variant.optimized_url ? toCanvasSafeAssetUrl(variant.optimized_url) : null,
          }
        }
        data.data.thumbnails = thumbnails
        data.data.displays = displays
        data.data.variants = variants
        data.data.assets = (data.data.assets ?? []).map((asset) => ({
          ...asset,
          public_url: toCanvasSafeAssetUrl(asset.public_url),
          original_url: asset.original_url ? toCanvasSafeAssetUrl(asset.original_url) : toCanvasSafeAssetUrl(asset.public_url),
          optimized_url: asset.optimized_url ? toCanvasSafeAssetUrl(asset.optimized_url) : asset.optimized_url,
          display_url: asset.display_url ? toCanvasSafeAssetUrl(asset.display_url) : toCanvasSafeAssetUrl(asset.optimized_url || asset.public_url),
          thumbnail_url: asset.thumbnail_url ? toCanvasSafeAssetUrl(asset.thumbnail_url) : asset.thumbnail_url,
        }))
        return data
      }),
    hide: (assetId: string, isHidden = true) =>
      request<{ success: true; data: MediaAsset }>(`/api/upload/media-assets/${encodeURIComponent(assetId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_hidden: isHidden }),
      }),
    deleteMediaAsset: (assetId: string, publicationId: string) => {
      const qs = new URLSearchParams({ publication_id: publicationId })
      return request<{ success: true; data: { deleted: true } }>(`/api/upload/media-assets/${encodeURIComponent(assetId)}?${qs}`, {
        method: 'DELETE',
      })
    },
  },

  mediaFolders: {
    list: (publicationId: string) => {
      const qs = new URLSearchParams({ publication_id: publicationId })
      return request<{ success: true; data: MediaFolder[] }>(`/api/upload/media-folders?${qs}`)
    },
    create: (input: { publication_id: string; name: string }) =>
      request<{ success: true; data: MediaFolder }>('/api/upload/media-folders', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    rename: (folderId: string, name: string) =>
      request<{ success: true; data: MediaFolder }>(`/api/upload/media-folders/${encodeURIComponent(folderId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    remove: (folderId: string) =>
      request<{ success: true; data: { deleted: true; moved_count: number } }>(`/api/upload/media-folders/${encodeURIComponent(folderId)}`, {
        method: 'DELETE',
      }),
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

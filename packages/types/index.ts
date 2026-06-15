export type PlanId = 'free' | 'basic' | 'pro'

export interface Plan {
  id: PlanId
  name: string
  max_publications: number | null
  max_pages_per_pub: number
  max_storage_mb: number
  custom_domain: boolean
  sound_enabled: boolean
  price_usd: number
}

export interface User {
  id: string
  email: string
  name: string | null
  plan_id: PlanId
  created_at: string
}

export interface Publication {
  id: string
  user_id: string
  title: string
  description: string | null
  category: 'catalog' | 'menu' | 'portfolio' | null
  status: 'draft' | 'published'
  public_slug: string | null
  cover_image_url: string | null
  sound_enabled: boolean
  created_at: string
  updated_at: string
}

export interface Page {
  id: string
  publication_id: string
  page_number: number
  image_url: string
  title: string | null
  description: string | null
  price: string | null
  created_at: string
}

export interface ApiResponse<T> {
  success: true
  data: T
}

export interface ApiError {
  success: false
  error: string
}

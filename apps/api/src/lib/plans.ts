import { getIntegerEntitlement } from './entitlements'
import {
  checkTenantStorageLimit,
  getTenantStorageUsage,
} from './storageUsage'

export interface Plan {
  id: string
  name: string
  max_publications: number | null
  max_pages_per_pub: number
  max_storage_mb: number
  custom_domain: number
  sound_enabled: number
  price_usd: number
}

export interface CustomLimits {
  max_publications: number | null
  max_pages: number | null
  max_storage_mb: number | null
}

export interface UserPlan {
  userId: string
  planId: string
  plan: Plan
  customLimits: CustomLimits
}

export async function getUserPlan(db: D1Database, userId: string): Promise<UserPlan> {
  const user = await db
    .prepare('SELECT id, plan_id, custom_max_publications, custom_max_pages, custom_max_storage_mb FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; plan_id: string; custom_max_publications: number | null; custom_max_pages: number | null; custom_max_storage_mb: number | null }>()
  if (!user) throw new Error('User not found')

  const plan = await db
    .prepare('SELECT * FROM plans WHERE id = ?')
    .bind(user.plan_id)
    .first<Plan>()
  if (!plan) throw new Error('Plan not found')

  return {
    userId, planId: user.plan_id, plan,
    customLimits: {
      max_publications: user.custom_max_publications ?? null,
      max_pages: user.custom_max_pages ?? null,
      max_storage_mb: user.custom_max_storage_mb ?? null,
    },
  }
}

export async function checkPublicationLimit(db: D1Database, userId: string, plan: Plan, customLimits?: CustomLimits): Promise<string | null> {
  const effectiveMax = customLimits?.max_publications ?? plan.max_publications
  if (effectiveMax === null) return null
  const row = await db
    .prepare('SELECT COUNT(*) as count FROM publications WHERE user_id = ?')
    .bind(userId)
    .first<{ count: number }>()
  const count = row?.count ?? 0
  if (count >= effectiveMax) {
    return `Tu plan ${plan.name} permite máximo ${effectiveMax} publicación(es). Actualiza tu plan para crear más.`
  }
  return null
}

export async function checkPageLimit(db: D1Database, publicationId: string, plan: Plan, customLimits?: CustomLimits): Promise<string | null> {
  const effectiveMax = customLimits?.max_pages ?? plan.max_pages_per_pub
  if (effectiveMax === null) return null
  const row = await db
    .prepare('SELECT COUNT(*) as count FROM pages WHERE publication_id = ?')
    .bind(publicationId)
    .first<{ count: number }>()
  const count = row?.count ?? 0
  if (count >= effectiveMax) {
    return `Tu plan ${plan.name} permite máximo ${effectiveMax} páginas por publicación. Actualiza tu plan para agregar más.`
  }
  return null
}

export async function checkStorageLimit(db: D1Database, userId: string, plan: Plan, newFileBytes: number, customLimits?: CustomLimits): Promise<string | null> {
  const explicitMaxMb = customLimits?.max_storage_mb ?? undefined
  const storageCheck = await checkTenantStorageLimit(
    db,
    userId,
    newFileBytes,
    0,
    explicitMaxMb,
  )

  return storageCheck.allowed
    ? null
    : storageCheck.message
      ?? `Almacenamiento insuficiente para el plan ${plan.name}.`
}

export function checkSoundAllowed(plan: Plan): string | null {
  if (!plan.sound_enabled) {
    return `El sonido al voltear páginas requiere plan Basic o Pro.`
  }
  return null
}

export function checkCustomDomainAllowed(plan: Plan): string | null {
  if (!plan.custom_domain) {
    return `Los dominios personalizados requieren plan Pro.`
  }
  return null
}

export async function getPlanUsage(db: D1Database, userId: string, plan: Plan) {
  const [pubRow, storageRow] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM publications WHERE user_id = ?').bind(userId).first<{ count: number }>(),
    getTenantStorageUsage(db, userId),
  ])

  const pubCount = pubRow?.count ?? 0
  const maxStorageMb = await getIntegerEntitlement(
    db,
    userId,
    'storage.max_mb',
  )

  return {
    plan_id: plan.id,
    plan_name: plan.name,
    publications: {
      used: pubCount,
      max: plan.max_publications,
      unlimited: plan.max_publications === null,
    },
    storage: {
      used_mb: storageRow.used_mb,
      max_mb: maxStorageMb,
      total_bytes: storageRow.total_bytes,
      object_count: storageRow.object_count,
      breakdown: storageRow.breakdown,
      unlimited: maxStorageMb === null,
    },
    features: {
      sound_enabled: plan.sound_enabled === 1,
      custom_domain: plan.custom_domain === 1,
      max_pages_per_pub: plan.max_pages_per_pub,
    },
  }
}

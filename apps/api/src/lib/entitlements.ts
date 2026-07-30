export type EntitlementValueType =
  | 'boolean'
  | 'integer'
  | 'decimal'
  | 'string'
  | 'json'

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type EntitlementSource =
  | 'tenant'
  | 'legacy_tenant'
  | 'plan'
  | 'default'
  | 'global_disabled'

export interface ResolvedEntitlement {
  featureKey: string
  valueType: EntitlementValueType
  value: JsonValue
  source: EntitlementSource
  planId: string
  tenantId: string
}

interface EntitlementRow {
  tenant_id: string
  plan_id: string
  feature_key: string
  active_globally: number
  value_type: string | null
  default_value_json: string | null
  plan_value_json: string | null
  tenant_value_json: string | null
  tenant_enabled: number | null
  tenant_expires_at: string | null
  custom_max_publications: number | null
  custom_max_pages: number | null
  custom_max_storage_mb: number | null
}

const VALUE_TYPES = new Set<EntitlementValueType>([
  'boolean',
  'integer',
  'decimal',
  'string',
  'json',
])

function normalizeValueType(value: unknown): EntitlementValueType {
  return VALUE_TYPES.has(value as EntitlementValueType)
    ? value as EntitlementValueType
    : 'boolean'
}

function parseRawJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export function parseEntitlementValue(
  raw: string | null | undefined,
  valueType: EntitlementValueType,
): JsonValue {
  if (raw === null || raw === undefined) return null

  const parsed = parseRawJson(raw)

  if (parsed === null) return null

  switch (valueType) {
    case 'boolean':
      return (
        parsed === true
        || parsed === 1
        || parsed === '1'
        || parsed === 'true'
      )

    case 'integer': {
      const value = Number(parsed)
      return Number.isFinite(value) ? Math.trunc(value) : 0
    }

    case 'decimal': {
      const value = Number(parsed)
      return Number.isFinite(value) ? value : 0
    }

    case 'string':
      return typeof parsed === 'string'
        ? parsed
        : String(parsed)

    case 'json':
      return parsed as JsonValue
  }
}

function disabledValue(
  valueType: EntitlementValueType,
): JsonValue {
  switch (valueType) {
    case 'boolean':
      return false

    case 'integer':
    case 'decimal':
      return 0

    case 'string':
      return ''

    case 'json':
      return null
  }
}

function tenantOverrideIsActive(
  expiresAt: string | null,
): boolean {
  if (!expiresAt) return true

  const timestamp = Date.parse(expiresAt)

  return Number.isFinite(timestamp) && timestamp > Date.now()
}

function legacyTenantLimitRaw(
  row: EntitlementRow,
  featureKey: string,
): string | null {
  let value: number | null = null

  switch (featureKey) {
    case 'publications.max_count':
      value = row.custom_max_publications
      break

    case 'pages.max_per_publication':
      value = row.custom_max_pages
      break

    case 'storage.max_mb':
      value = row.custom_max_storage_mb
      break

    default:
      return null
  }

  return value === null ? null : String(value)
}

export async function resolveEntitlement(
  db: D1Database,
  tenantId: string,
  featureKey: string,
): Promise<ResolvedEntitlement> {
  const row = await db.prepare(
    `SELECT
       u.id AS tenant_id,
       u.plan_id,
       u.custom_max_publications,
       u.custom_max_pages,
       u.custom_max_storage_mb,
       m.key AS feature_key,
       m.active_globally,
       m.value_type,
       m.default_value_json,
       pm.value_json AS plan_value_json,
       tm.value_json AS tenant_value_json,
       tm.enabled AS tenant_enabled,
       tm.expires_at AS tenant_expires_at
     FROM users u
     JOIN modules m
       ON m.key = ?
     LEFT JOIN plan_modules pm
       ON pm.plan_id = u.plan_id
      AND pm.module_key = m.key
     LEFT JOIN tenant_modules tm
       ON tm.user_id = u.id
      AND tm.module_key = m.key
     WHERE u.id = ?
     LIMIT 1`,
  )
    .bind(featureKey, tenantId)
    .first<EntitlementRow>()

  if (!row) {
    throw new Error(
      `No se encontró el entitlement ${featureKey} para el tenant ${tenantId}`,
    )
  }

  const valueType = normalizeValueType(row.value_type)

  if (row.active_globally !== 1) {
    return {
      featureKey,
      valueType,
      value: disabledValue(valueType),
      source: 'global_disabled',
      planId: row.plan_id,
      tenantId: row.tenant_id,
    }
  }

  const hasTenantOverride = (
    row.tenant_value_json !== null
    || (
      valueType === 'boolean'
      && row.tenant_enabled !== null
    )
  )

  if (
    hasTenantOverride
    && tenantOverrideIsActive(row.tenant_expires_at)
  ) {
    const rawValue = row.tenant_value_json
      ?? (row.tenant_enabled === 1 ? 'true' : 'false')

    return {
      featureKey,
      valueType,
      value: parseEntitlementValue(rawValue, valueType),
      source: 'tenant',
      planId: row.plan_id,
      tenantId: row.tenant_id,
    }
  }

  const legacyRawValue = legacyTenantLimitRaw(
    row,
    featureKey,
  )

  if (legacyRawValue !== null) {
    return {
      featureKey,
      valueType,
      value: parseEntitlementValue(
        legacyRawValue,
        valueType,
      ),
      source: 'legacy_tenant',
      planId: row.plan_id,
      tenantId: row.tenant_id,
    }
  }

  if (row.plan_value_json !== null) {
    return {
      featureKey,
      valueType,
      value: parseEntitlementValue(
        row.plan_value_json,
        valueType,
      ),
      source: 'plan',
      planId: row.plan_id,
      tenantId: row.tenant_id,
    }
  }

  return {
    featureKey,
    valueType,
    value: parseEntitlementValue(
      row.default_value_json,
      valueType,
    ),
    source: 'default',
    planId: row.plan_id,
    tenantId: row.tenant_id,
  }
}

export async function isFeatureEnabled(
  db: D1Database,
  tenantId: string,
  featureKey: string,
): Promise<boolean> {
  const entitlement = await resolveEntitlement(
    db,
    tenantId,
    featureKey,
  )

  if (entitlement.valueType !== 'boolean') {
    throw new Error(
      `${featureKey} no es una función booleana`,
    )
  }

  return entitlement.value === true
}

export async function getIntegerEntitlement(
  db: D1Database,
  tenantId: string,
  featureKey: string,
): Promise<number | null> {
  const entitlement = await resolveEntitlement(
    db,
    tenantId,
    featureKey,
  )

  if (entitlement.valueType !== 'integer') {
    throw new Error(
      `${featureKey} no es un límite entero`,
    )
  }

  if (entitlement.value === null) return null

  const value = Number(entitlement.value)

  if (!Number.isFinite(value)) {
    throw new Error(
      `${featureKey} contiene un valor numérico inválido`,
    )
  }

  return Math.trunc(value)
}

export async function assertFeatureEnabled(
  db: D1Database,
  tenantId: string,
  featureKey: string,
): Promise<void> {
  const enabled = await isFeatureEnabled(
    db,
    tenantId,
    featureKey,
  )

  if (!enabled) {
    throw new Error(
      `La función ${featureKey} no está habilitada para este tenant`,
    )
  }
}

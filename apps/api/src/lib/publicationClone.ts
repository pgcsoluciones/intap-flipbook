export type CloneColumn = {
  name: string
}

export type CloneMapScalar = string | number | null
export type CloneMapRow = Record<string, CloneMapScalar>

export type CloneSqlOverride = {
  sql: string
  bindings?: unknown[]
}

export type CloneSqlStatement = {
  sql: string
  bindings: unknown[]
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function quoteCloneIdentifier(value: string): string {
  if (!IDENTIFIER_RE.test(value)) {
    throw new Error(`Identificador SQL no permitido: ${value}`)
  }
  return `"${value}"`
}

export function normalizeCloneColumns(rows: Array<{ name?: unknown }>): string[] {
  return rows
    .map((row) => (typeof row?.name === 'string' ? row.name.trim() : ''))
    .filter((name) => IDENTIFIER_RE.test(name))
}

function jsonMapCte(fields: string[]): string {
  if (!fields.length) throw new Error('El mapa de clonación necesita al menos un campo')
  const projection = fields
    .map((field) => {
      quoteCloneIdentifier(field)
      return `json_extract(value, '$.${field}') AS ${quoteCloneIdentifier(field)}`
    })
    .join(', ')
  return `clone_map AS (SELECT ${projection} FROM json_each(?))`
}

export function buildMappedCloneInsertStatement(input: {
  table: string
  columns: string[]
  mapRows: CloneMapRow[]
  mapFields: string[]
  overrides?: Record<string, CloneSqlOverride>
  sourceIdColumn?: string
  mapSourceIdField?: string
}): CloneSqlStatement | null {
  if (!input.mapRows.length) return null

  const table = quoteCloneIdentifier(input.table)
  const columns = input.columns.map(quoteCloneIdentifier)
  const sourceIdColumn = quoteCloneIdentifier(input.sourceIdColumn ?? 'id')
  const mapSourceIdField = quoteCloneIdentifier(input.mapSourceIdField ?? 'old_id')
  const overrides = input.overrides ?? {}
  const bindings: unknown[] = [JSON.stringify(input.mapRows)]

  const selectExpressions = input.columns.map((column) => {
    const override = overrides[column]
    if (!override) return `source.${quoteCloneIdentifier(column)}`
    if (override.bindings?.length) bindings.push(...override.bindings)
    return override.sql
  })

  return {
    sql: `WITH ${jsonMapCte(input.mapFields)}\n` +
      `INSERT INTO ${table} (${columns.join(', ')})\n` +
      `SELECT ${selectExpressions.join(', ')}\n` +
      `FROM ${table} AS source\n` +
      `JOIN clone_map AS map ON source.${sourceIdColumn} = map.${mapSourceIdField}`,
    bindings,
  }
}

export function buildMappedStorageReferenceStatement(
  mapRows: Array<{ old_id: string; new_id: string }>,
  newPublicationId: string,
  sourcePublicationId: string,
): CloneSqlStatement | null {
  if (!mapRows.length) return null

  return {
    sql: `WITH ${jsonMapCte(['old_id', 'new_id'])}\n` +
      `INSERT OR IGNORE INTO storage_object_references (\n` +
      `  storage_object_id, tenant_id, publication_id, source_type, source_id, source_field, created_at\n` +
      `)\n` +
      `SELECT refs.storage_object_id, refs.tenant_id, ?, refs.source_type, map.new_id, refs.source_field, datetime('now')\n` +
      `FROM storage_object_references AS refs\n` +
      `JOIN clone_map AS map ON refs.source_id = map.old_id\n` +
      `WHERE refs.publication_id = ?`,
    bindings: [JSON.stringify(mapRows), newPublicationId, sourcePublicationId],
  }
}

export function buildJsonColumnUpdateStatement(input: {
  table: string
  idColumn?: string
  valueColumn: string
  rows: Array<{ id: string; value: string | null }>
}): CloneSqlStatement | null {
  if (!input.rows.length) return null
  const table = quoteCloneIdentifier(input.table)
  const idColumn = quoteCloneIdentifier(input.idColumn ?? 'id')
  const valueColumn = quoteCloneIdentifier(input.valueColumn)

  return {
    sql: `WITH updates AS (\n` +
      `  SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.value') AS value\n` +
      `  FROM json_each(?)\n` +
      `)\n` +
      `UPDATE ${table}\n` +
      `SET ${valueColumn} = (SELECT updates.value FROM updates WHERE updates.id = ${table}.${idColumn})\n` +
      `WHERE ${idColumn} IN (SELECT id FROM updates)`,
    bindings: [JSON.stringify(input.rows)],
  }
}

const MARKER_REFERENCE_KEYS = new Set([
  'marker_id',
  'markerId',
  'dynamic_marker_id',
  'dynamicMarkerId',
])

const PRODUCT_DETAIL_REFERENCE_KEYS = new Set([
  'detail_id',
  'detailId',
  'product_detail_id',
  'productDetailId',
])

function remapLinkedReferences(
  value: unknown,
  markerIds: ReadonlyMap<string, string>,
  productDetailIds: ReadonlyMap<number, number>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => remapLinkedReferences(item, markerIds, productDetailIds))
  }
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const isProductDetailAction = record.type === 'open_product_detail'
  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(record)) {
    if (MARKER_REFERENCE_KEYS.has(key) && typeof child === 'string' && markerIds.has(child)) {
      next[key] = markerIds.get(child)!
      continue
    }

    if (isProductDetailAction && PRODUCT_DETAIL_REFERENCE_KEYS.has(key)) {
      const numericId = typeof child === 'number' ? child : Number(child)
      if (Number.isInteger(numericId) && productDetailIds.has(numericId)) {
        const nextId = productDetailIds.get(numericId)!
        next[key] = typeof child === 'string' ? String(nextId) : nextId
        continue
      }
    }

    next[key] = remapLinkedReferences(child, markerIds, productDetailIds)
  }
  return next
}

export function remapPublicationCanvasJson(
  canvasJson: string | null | undefined,
  markerIdMap: ReadonlyMap<string, string>,
  productDetailIdMap: ReadonlyMap<number, number> = new Map(),
): string | null {
  if (canvasJson == null) return null
  if (!canvasJson.trim() || (markerIdMap.size === 0 && productDetailIdMap.size === 0)) return canvasJson

  try {
    const parsed = JSON.parse(canvasJson)
    const remapped = remapLinkedReferences(parsed, markerIdMap, productDetailIdMap)
    return JSON.stringify(remapped)
  } catch {
    // El editor ya tolera canvas_json históricos o dañados. Una clonación no debe
    // destruir ni "arreglar" silenciosamente esos datos; se preservan tal cual.
    return canvasJson
  }
}

export function cloneMapPairs(map: ReadonlyMap<string, string>): Array<{ old_id: string; new_id: string }> {
  return Array.from(map.entries()).map(([old_id, new_id]) => ({ old_id, new_id }))
}

export function cloneNumericMapPairs(map: ReadonlyMap<number, number>): Array<{ old_id: number; new_id: number }> {
  return Array.from(map.entries()).map(([old_id, new_id]) => ({ old_id, new_id }))
}

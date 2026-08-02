export type DynamicMarkerUsageSource = 'direct' | 'action'

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
  sources: DynamicMarkerUsageSource[]
}

export type DynamicMarkerUsagePage = {
  publication_id: string
  publication_name: string | null
  public_slug: string | null
  page_id: string
  page_number: number | null
  canvas_json: unknown
}

export type DynamicMarkerUsageTarget = {
  marker_id: string
  publication_id: string
  page_id: string | null
  target_object_id: string | null
}

type ObjectRecord = {
  node: Record<string, unknown>
  path: string
  type: string | null
  elementId: string | null
  identity: string
  label: string | null
}

export function parseCanvasJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? null
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown, max = 80): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/\s+/g, ' ')
  if (!text) return null
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

function objectLabel(node: Record<string, unknown>, data: Record<string, unknown> | null, type: string | null) {
  return (
    cleanText(data?.label)
    || cleanText(data?.name)
    || cleanText(data?.kind)
    || cleanText(node.text)
    || cleanText(node.name)
    || type
  )
}

function actionMarkerId(value: unknown, targetIds?: Set<string>): string | null {
  if (!isRecord(value)) return null
  if (value.type !== 'open_dynamic_marker') return null
  const markerId = typeof value.marker_id === 'string' ? value.marker_id.trim() : ''
  if (!markerId) return null
  if (targetIds && !targetIds.has(markerId)) return null
  return markerId
}

function collectObjects(value: unknown): ObjectRecord[] {
  const objects: ObjectRecord[] = []
  const visited = new WeakSet<object>()

  const visit = (node: unknown, path: string) => {
    if (!node || typeof node !== 'object') return
    if (visited.has(node as object)) return
    visited.add(node as object)

    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${path}[${index}]`))
      return
    }

    const record = node as Record<string, unknown>
    const data = isRecord(record.data) ? record.data : null
    const type = typeof record.type === 'string' ? record.type : null
    const elementId = typeof data?.elementId === 'string' && data.elementId ? data.elementId : null

    if (type) {
      objects.push({
        node: record,
        path,
        type,
        elementId,
        identity: elementId || `json:${path}`,
        label: objectLabel(record, data, type),
      })
    }

    Object.entries(record).forEach(([key, child]) => {
      if (key === 'data' || key === 'action') return
      visit(child, `${path}.${key}`)
    })
  }

  visit(value, '$')
  return objects
}

function addUsage(
  usages: Map<string, DynamicMarkerUsage>,
  page: DynamicMarkerUsagePage,
  object: ObjectRecord,
  markerId: string,
  source: DynamicMarkerUsageSource,
) {
  const key = `${page.publication_id}::${page.page_id}::${object.identity}::${markerId}`
  const existing = usages.get(key)
  if (existing) {
    if (!existing.sources.includes(source)) existing.sources.push(source)
    existing.sources.sort((a, b) => (a === b ? 0 : a === 'direct' ? -1 : 1))
    return
  }

  usages.set(key, {
    marker_id: markerId,
    publication_id: page.publication_id,
    publication_name: page.publication_name || 'Publicacion',
    public_slug: page.public_slug ?? null,
    page_id: page.page_id,
    page_number: Number(page.page_number ?? 0),
    element_id: object.elementId,
    object_type: object.type,
    object_label: object.label,
    sources: [source],
  })
}

export function collectDynamicMarkerUsages(
  pages: DynamicMarkerUsagePage[],
  targets: DynamicMarkerUsageTarget[],
): DynamicMarkerUsage[] {
  const targetIds = new Set(targets.map((target) => target.marker_id).filter(Boolean))
  const directTargetsByPage = new Map<string, DynamicMarkerUsageTarget[]>()
  const usages = new Map<string, DynamicMarkerUsage>()

  for (const target of targets) {
    if (!target.page_id || !target.target_object_id) continue
    const key = `${target.publication_id}::${target.page_id}`
    const pageTargets = directTargetsByPage.get(key) ?? []
    pageTargets.push(target)
    directTargetsByPage.set(key, pageTargets)
  }

  for (const page of pages) {
    const parsed = parseCanvasJson(page.canvas_json)
    const objects = collectObjects(parsed)
    if (!objects.length) continue

    const objectsByElementId = new Map<string, ObjectRecord>()
    for (const object of objects) {
      if (object.elementId && !objectsByElementId.has(object.elementId)) {
        objectsByElementId.set(object.elementId, object)
      }
    }

    const directTargets = directTargetsByPage.get(`${page.publication_id}::${page.page_id}`) ?? []
    for (const target of directTargets) {
      const object = objectsByElementId.get(target.target_object_id || '')
      if (object) addUsage(usages, page, object, target.marker_id, 'direct')
    }

    for (const object of objects) {
      const data = isRecord(object.node.data) ? object.node.data : null
      const markerIdsForObject = new Set<string>()
      const dataMarkerId = actionMarkerId(data?.action, targetIds)
      const objectMarkerId = actionMarkerId(object.node.action, targetIds)
      if (dataMarkerId) markerIdsForObject.add(dataMarkerId)
      if (objectMarkerId) markerIdsForObject.add(objectMarkerId)

      markerIdsForObject.forEach((markerId) => {
        addUsage(usages, page, object, markerId, 'action')
      })
    }
  }

  return Array.from(usages.values()).sort(compareDynamicMarkerUsages)
}

export function countDynamicMarkerUsages(usages: DynamicMarkerUsage[]) {
  const counts = new Map<string, number>()
  usages.forEach((usage) => {
    counts.set(usage.marker_id, (counts.get(usage.marker_id) ?? 0) + 1)
  })
  return counts
}

export function compareDynamicMarkerUsages(a: DynamicMarkerUsage, b: DynamicMarkerUsage) {
  return (
    a.publication_name.localeCompare(b.publication_name)
    || a.publication_id.localeCompare(b.publication_id)
    || a.page_number - b.page_number
    || (a.object_label || '').localeCompare(b.object_label || '')
    || (a.element_id || '').localeCompare(b.element_id || '')
    || a.marker_id.localeCompare(b.marker_id)
  )
}

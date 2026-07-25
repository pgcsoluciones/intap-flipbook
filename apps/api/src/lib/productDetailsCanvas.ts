export function cleanProductDetailId(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function parseCanvasJson(raw: unknown): unknown {
  if (!raw || typeof raw !== 'string') return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function countOpenProductDetailReferences(
  value: unknown,
  allowedIds?: Set<number>,
): Map<number, number> {
  const counts = new Map<number, number>()
  const visited = new WeakSet<object>()

  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (visited.has(node as object)) return
    visited.add(node as object)

    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }

    const record = node as Record<string, unknown>

    if (typeof record.type === 'string') {
      const data =
        record.data &&
        typeof record.data === 'object' &&
        !Array.isArray(record.data)
          ? (record.data as Record<string, unknown>)
          : null

      const candidates = [data?.action, record.action]
      const idsForObject = new Set<number>()

      candidates.forEach((candidate) => {
        if (
          !candidate ||
          typeof candidate !== 'object' ||
          Array.isArray(candidate)
        ) return

        const action = candidate as Record<string, unknown>
        if (action.type !== 'open_product_detail') return

        const detailId = cleanProductDetailId(action.detail_id)
        if (detailId && (!allowedIds || allowedIds.has(detailId))) {
          idsForObject.add(detailId)
        }
      })

      idsForObject.forEach((detailId) => {
        counts.set(detailId, (counts.get(detailId) ?? 0) + 1)
      })
    }

    Object.values(record).forEach(visit)
  }

  try {
    visit(value)
  } catch {
    return counts
  }

  return counts
}

export function canvasUsesOpenProductDetail(
  value: unknown,
  detailId: number,
): boolean {
  return (
    countOpenProductDetailReferences(value, new Set([detailId])).get(detailId) ??
    0
  ) > 0
}

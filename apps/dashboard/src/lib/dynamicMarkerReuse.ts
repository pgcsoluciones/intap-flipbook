import type { CSSProperties } from 'react'
import type { CloneDynamicMarkerInput, DynamicMarkerCatalogItem } from './api'

export type DynamicMarkerCloneTarget = CloneDynamicMarkerInput

export type DynamicMarkerSelectionDecision = 'noop' | 'select' | 'confirm'

export function getDynamicMarkerSelectionDecision(
  item: Pick<DynamicMarkerCatalogItem, 'id' | 'usage_count' | 'is_in_use'>,
  currentValue?: string | null,
): DynamicMarkerSelectionDecision {
  if (item.id === currentValue) return 'noop'
  const usageCount = item.usage_count ?? (item.is_in_use ? 1 : 0)
  return usageCount > 0 ? 'confirm' : 'select'
}

export function canCloneDynamicMarkerToTarget(target?: DynamicMarkerCloneTarget | null): target is DynamicMarkerCloneTarget {
  return Boolean(
    target?.publication_id?.trim()
    && target?.page_id?.trim()
    && target?.target_object_id?.trim(),
  )
}

export function buildDynamicMarkerCloneBody(target: DynamicMarkerCloneTarget): CloneDynamicMarkerInput {
  return {
    publication_id: target.publication_id,
    page_id: target.page_id,
    target_object_id: target.target_object_id,
    target_kind: target.target_kind || null,
  }
}

export function dynamicMarkerCloneErrorMessage(error: unknown) {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: unknown }).status
    : undefined
  if (status === 409) return 'Este elemento ya tiene una ficha asociada.'
  return 'No pudimos crear la copia de esta ficha.'
}

export function dynamicMarkerCardToneStyles(inUse: boolean): CSSProperties {
  if (!inUse) return { background: '#fff', borderColor: '#e5e7eb' }
  return {
    background: '#f8fafc',
    borderColor: '#d1d5db',
    boxShadow: 'inset 3px 0 0 #cbd5e1',
  }
}

export function dynamicMarkerPreviewToneStyles(inUse: boolean): CSSProperties {
  return inUse ? { opacity: 0.86 } : { opacity: 1 }
}

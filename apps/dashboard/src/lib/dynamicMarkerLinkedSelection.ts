export const DYNAMIC_MARKER_LINKED_LOAD_ERROR = 'No pudimos cargar la ficha vinculada.'

export type DynamicMarkerLinkedResolution =
  | { kind: 'linked-marker'; markerId: string }
  | { kind: 'direct-target'; targetObjectId: string }
  | { kind: 'none' }

function cleanId(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function getDynamicMarkerActionMarkerId(selectedObject: unknown): string | null {
  if (!selectedObject || typeof selectedObject !== 'object') return null
  const data = (selectedObject as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const action = (data as { action?: unknown }).action
  if (!action || typeof action !== 'object') return null
  const markerId = cleanId((action as { marker_id?: unknown }).marker_id)
  return markerId || null
}

export function getDynamicMarkerTargetObjectId(selectedObject: unknown): string | null {
  if (!selectedObject || typeof selectedObject !== 'object') return null
  const data = (selectedObject as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const elementId = cleanId((data as { elementId?: unknown }).elementId)
  return elementId || null
}

export function resolveDynamicMarkerLinkedSelection(selectedObject: unknown): DynamicMarkerLinkedResolution {
  const markerId = getDynamicMarkerActionMarkerId(selectedObject)
  if (markerId) return { kind: 'linked-marker', markerId }

  const targetObjectId = getDynamicMarkerTargetObjectId(selectedObject)
  if (targetObjectId) return { kind: 'direct-target', targetObjectId }

  return { kind: 'none' }
}

export function shouldCreateDirectDynamicMarker(resolution: DynamicMarkerLinkedResolution) {
  return resolution.kind !== 'linked-marker'
}

export function dynamicMarkerSaveTargetId(markerId: string | null) {
  return cleanId(markerId) || null
}

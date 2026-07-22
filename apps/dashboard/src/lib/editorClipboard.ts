export const FABRIC_CLONE_CUSTOM_PROPS = ['data']

export const DYNAMIC_ASSOCIATION_KEYS = new Set([
  'dynamicMarkerId',
  'dynamic_marker_id',
  'dynamicMarker',
  'dynamic_marker',
  'markerId',
  'marker_id',
  'marker',
  'targetObjectId',
  'target_object_id',
  'syncGroupId',
  'sync_group_id',
  'booking_calendar_id',
  'hiddenInEditor',
  'originalOpacity',
])

export type EditorClipboardMode = 'copy' | 'cut'

export type EditorClipboardPayload = {
  publicationId: string
  mode: EditorClipboardMode
  objects: any[]
}

export function clonePlainValue(value: any): any {
  if (value == null || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    if (Array.isArray(value)) return value.map((item) => clonePlainValue(item))
    return { ...value }
  }
}

export function makeElementId(existing = new Set<string>()) {
  let id = ''
  do {
    id = `el_${Math.random().toString(36).slice(2, 9)}`
  } while (existing.has(id))
  existing.add(id)
  return id
}

export function collectFabricElementIds(objects: any[], out = new Set<string>()) {
  for (const obj of objects) {
    const elementId = obj?.data?.elementId
    if (typeof elementId === 'string' && elementId) out.add(elementId)
    const children = typeof obj?.getObjects === 'function' ? obj.getObjects() : (obj?._objects ?? obj?.objects)
    if (Array.isArray(children)) collectFabricElementIds(children, out)
  }
  return out
}

export function stripDynamicAssociations(value: any): any {
  if (Array.isArray(value)) return value.map((item) => stripDynamicAssociations(item))
  if (!value || typeof value !== 'object') return value
  const next: any = {}
  for (const [key, child] of Object.entries(value)) {
    if (DYNAMIC_ASSOCIATION_KEYS.has(key)) continue
    next[key] = stripDynamicAssociations(child)
  }
  return next
}

export function resetDuplicateData(obj: any, existingElementIds: Set<string>) {
  const sourceData = clonePlainValue(obj?.data ?? {})
  const cleanData = stripDynamicAssociations(sourceData)
  cleanData.elementId = makeElementId(existingElementIds)
  obj.data = cleanData
}

export function resetDuplicateTree(obj: any, existingElementIds: Set<string>, restoreHiddenDynamicVisuals = false) {
  const data = obj?.data ?? {}
  if (restoreHiddenDynamicVisuals && typeof data.originalOpacity === 'number') obj.opacity = data.originalOpacity
  if (restoreHiddenDynamicVisuals && data.hiddenInEditor) {
    obj.visible = obj.visible !== false
    obj.selectable = true
    obj.evented = true
    obj.hasControls = true
    obj.hasBorders = true
  }
  for (const key of DYNAMIC_ASSOCIATION_KEYS) delete obj?.[key]
  resetDuplicateData(obj, existingElementIds)
  const children = typeof obj?.getObjects === 'function' ? obj.getObjects() : (obj?._objects ?? obj?.objects)
  if (Array.isArray(children)) {
    children.forEach((child: any) => resetDuplicateTree(child, existingElementIds, restoreHiddenDynamicVisuals))
  }
}

export function getFabricSelectionObjects(activeObject: any, canvasObjects: any[] = []) {
  if (!activeObject) return []
  if (activeObject.type !== 'activeSelection') return [activeObject]
  const selectedObjects = typeof activeObject.getObjects === 'function' ? activeObject.getObjects() : []
  const order = new Map(canvasObjects.map((obj, index) => [obj, index]))
  return [...selectedObjects].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
}

export function serializeFabricSelectionForClipboard(activeObject: any, canvasObjects: any[] = []) {
  return getFabricSelectionObjects(activeObject, canvasObjects).map((obj) => {
    if (typeof obj?.toObject === 'function') {
      return clonePlainValue(obj.toObject(FABRIC_CLONE_CUSTOM_PROPS))
    }
    return clonePlainValue(obj)
  })
}

export function prepareClipboardObjectsForPaste(serializedObjects: any[], existingObjects: any[] = []) {
  const existingElementIds = collectFabricElementIds(existingObjects)
  return serializedObjects.map((obj) => {
    const clone = clonePlainValue(obj)
    resetDuplicateTree(clone, existingElementIds, true)
    return clone
  })
}

export function editorClipboardCountLabel(count: number, action: 'copiado' | 'cortado' | 'pegado') {
  return `${count} ${count === 1 ? 'elemento' : 'elementos'} ${count === 1 ? action : `${action}s`}`
}

export function isTextInputLikeTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (typeof el.isContentEditable === 'boolean' && el.isContentEditable) return true
  if (typeof el.closest === 'function' && el.closest('[contenteditable="true"]')) return true
  return false
}

export function shouldIgnoreEditorClipboardShortcut(event: {
  target: EventTarget | null
  altKey?: boolean
  repeat?: boolean
}, fabricTextEditing: boolean) {
  if (event.altKey) return true
  if (event.repeat) return true
  if (fabricTextEditing) return true
  return isTextInputLikeTarget(event.target)
}

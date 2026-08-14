export type InteractiveOverlapPosition = 'above' | 'below'

export type InteractiveOverlapConflict = {
  object: any
  objectIndex: number
  activeIndex: number
  position: InteractiveOverlapPosition
  kind: string
  label: string
  elementId?: string
}

const PUBLIC_ACTION_TYPES = new Set([
  'link',
  'page',
  'call',
  'whatsapp',
  'email',
  'popup_text',
  'popup_image',
  'popup_video',
  'popup_audio',
  'download',
  'show_hide',
  'gallery_images',
  'gallery_videos',
  'popup_message',
  'show_comment',
  'copy_text',
  'open_product_detail',
  'open_dynamic_marker',
])

function getObjectAction(obj: any) {
  const nestedAction = obj?.data?.action
  if (
    nestedAction &&
    typeof nestedAction === 'object' &&
    PUBLIC_ACTION_TYPES.has(nestedAction.type)
  ) {
    return nestedAction
  }

  // Compatibilidad legacy conocida actualmente.
  const directAction = obj?.action
  if (directAction?.type === 'open_product_detail') {
    return directAction
  }

  return null
}

export function isInteractiveCanvasObject(obj: any) {
  if (!obj) return false
  if (obj.visible === false) return false
  if (obj.evented === false) return false
  if (obj.opacity === 0) return false
  if (obj.type === 'activeSelection') return false

  const kind = obj?.data?.kind

  if (kind === 'dynamic_marker_button') return true
  if (kind === 'hotspot') return true
  if (kind === 'linkzone') return true

  return !!getObjectAction(obj)
}

export function canvasObjectsOverlap(a: any, b: any) {
  if (!a || !b || a === b) return false

  const intersects =
    typeof a.intersectsWithObject === 'function'
      ? a.intersectsWithObject(b)
      : false

  if (intersects) return true

  const aInsideB =
    typeof a.isContainedWithinObject === 'function'
      ? a.isContainedWithinObject(b)
      : false

  if (aInsideB) return true

  return typeof b.isContainedWithinObject === 'function'
    ? b.isContainedWithinObject(a)
    : false
}

export function getInteractiveObjectLabel(obj: any) {
  const kind = obj?.data?.kind
  const label = obj?.data?.label

  if (typeof label === 'string' && label.trim()) {
    return label.trim()
  }

  switch (kind) {
    case 'dynamic_marker_button':
      return 'Botón de ficha'
    case 'hotspot':
      return 'Punto activo'
    case 'linkzone':
      return 'Zona de enlace'
    case 'button':
      return 'Botón'
    case 'image':
      return 'Imagen'
    case 'shape':
      return 'Forma'
    case 'widget':
      return 'Widget'
    default:
      return 'Elemento interactivo'
  }
}

export function findInteractiveOverlaps(
  activeObject: any,
  canvasObjects: any[],
): InteractiveOverlapConflict[] {
  if (!activeObject || !Array.isArray(canvasObjects)) return []
  if (!isInteractiveCanvasObject(activeObject)) return []

  const activeIndex = canvasObjects.indexOf(activeObject)
  if (activeIndex < 0) return []

  return canvasObjects
    .map((object, objectIndex) => ({ object, objectIndex }))
    .filter(({ object }) => object !== activeObject)
    .filter(({ object }) => isInteractiveCanvasObject(object))
    .filter(({ object }) => canvasObjectsOverlap(activeObject, object))
    .map(({ object, objectIndex }) => ({
      object,
      objectIndex,
      activeIndex,
      position: objectIndex > activeIndex
        ? 'above' as const
        : 'below' as const,
      kind: object?.data?.kind ?? object?.type ?? 'object',
      label: getInteractiveObjectLabel(object),
      elementId:
        typeof object?.data?.elementId === 'string'
          ? object.data.elementId
          : undefined,
    }))
    .sort((a, b) => a.objectIndex - b.objectIndex)
}

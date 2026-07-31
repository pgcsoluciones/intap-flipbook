export const DYNAMIC_MARKER_BUTTON_KIND = 'dynamic_marker_button'

export type DynamicMarkerButtonShape = 'rect' | 'square' | 'circle' | 'text'
export type DynamicMarkerButtonAlign = 'left' | 'center' | 'right'

export type DynamicMarkerButtonStyle = {
  presetId: string
  label: string
  shape: DynamicMarkerButtonShape
  width: number
  height: number
  backgroundColor: string
  textColor: string
  borderColor: string
  borderWidth: number
  borderRadius: number
  opacity: number
  textSize: number
  fontFamily: string
  fontWeight: '400' | '700'
  textAlign: DynamicMarkerButtonAlign
}

export type DynamicMarkerButtonPreset = DynamicMarkerButtonStyle & {
  name: string
}

export const DYNAMIC_MARKER_BUTTON_PRESETS: DynamicMarkerButtonPreset[] = [
  { presetId: 'solid-rect', name: 'Rectangular sólido', label: 'Ver ficha', shape: 'rect', width: 180, height: 56, backgroundColor: '#2563eb', textColor: '#ffffff', borderColor: '#1d4ed8', borderWidth: 0, borderRadius: 8, opacity: 1, textSize: 18, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'center' },
  { presetId: 'rounded-rect', name: 'Rectangular redondeado', label: 'Más información', shape: 'rect', width: 210, height: 58, backgroundColor: '#0f766e', textColor: '#ffffff', borderColor: '#115e59', borderWidth: 0, borderRadius: 16, opacity: 1, textSize: 17, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'center' },
  { presetId: 'pill', name: 'Tipo píldora', label: 'Abrir ficha', shape: 'rect', width: 190, height: 52, backgroundColor: '#7c3aed', textColor: '#ffffff', borderColor: '#6d28d9', borderWidth: 0, borderRadius: 999, opacity: 1, textSize: 16, fontFamily: 'Poppins, sans-serif', fontWeight: '700', textAlign: 'center' },
  { presetId: 'outline', name: 'Contorno', label: 'Consultar ficha', shape: 'rect', width: 210, height: 56, backgroundColor: '#ffffff', textColor: '#1d4ed8', borderColor: '#2563eb', borderWidth: 2, borderRadius: 10, opacity: 1, textSize: 17, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'center' },
  { presetId: 'square', name: 'Cuadrado', label: 'Ficha', shape: 'square', width: 96, height: 96, backgroundColor: '#111827', textColor: '#ffffff', borderColor: '#111827', borderWidth: 0, borderRadius: 10, opacity: 1, textSize: 16, fontFamily: 'Montserrat, sans-serif', fontWeight: '700', textAlign: 'center' },
  { presetId: 'circle', name: 'Circular', label: 'Ver', shape: 'circle', width: 104, height: 104, backgroundColor: '#be123c', textColor: '#ffffff', borderColor: '#9f1239', borderWidth: 0, borderRadius: 999, opacity: 1, textSize: 18, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'center' },
  { presetId: 'badge', name: 'Tipo etiqueta o badge', label: 'Ficha destacada', shape: 'rect', width: 210, height: 46, backgroundColor: '#f59e0b', textColor: '#111827', borderColor: '#b45309', borderWidth: 1, borderRadius: 6, opacity: 1, textSize: 15, fontFamily: 'Poppins, sans-serif', fontWeight: '700', textAlign: 'center' },
  { presetId: 'text-only', name: 'Solo texto', label: 'Leer ficha interactiva', shape: 'text', width: 220, height: 40, backgroundColor: 'rgba(255,255,255,0)', textColor: '#2563eb', borderColor: 'rgba(255,255,255,0)', borderWidth: 0, borderRadius: 0, opacity: 1, textSize: 18, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'center' },
]

export function createDynamicMarkerButtonStyle(presetId: string): DynamicMarkerButtonStyle {
  const preset = DYNAMIC_MARKER_BUTTON_PRESETS.find((item) => item.presetId === presetId) ?? DYNAMIC_MARKER_BUTTON_PRESETS[0]
  const { name: _name, ...style } = preset
  return { ...style }
}

export function createDynamicMarkerButtonData(style: DynamicMarkerButtonStyle, markerId?: string) {
  const data: any = {
    kind: DYNAMIC_MARKER_BUTTON_KIND,
    label: style.label,
    dynamicMarkerButton: { ...style },
  }
  if (markerId) data.action = { type: 'open_dynamic_marker', marker_id: markerId }
  return data
}

export function isDynamicMarkerButtonLinked(data: any) {
  return data?.action?.type === 'open_dynamic_marker' && !!data.action.marker_id
}

export function getDynamicMarkerButtonStatusColor(data: any) {
  return isDynamicMarkerButtonLinked(data) ? '#22c55e' : '#94a3b8'
}

export function getDynamicMarkerButtonCornerRadius(style: DynamicMarkerButtonStyle) {
  if (style.shape !== 'rect') return style.shape === 'circle' ? Math.min(style.width, style.height) / 2 : 0
  if (style.presetId === 'pill' || style.borderRadius >= 999) return Math.min(style.width, style.height) / 2
  return style.borderRadius
}

export function setDynamicMarkerButtonMarker(data: any, markerId?: string) {
  const next = { ...(data || {}) }
  delete next.marker_id
  if (markerId) {
    next.action = { type: 'open_dynamic_marker', marker_id: markerId }
  } else if (next.action?.type === 'open_dynamic_marker') {
    delete next.action
  }
  return next
}

export function updateDynamicMarkerButtonStyle(data: any, patch: Partial<DynamicMarkerButtonStyle>) {
  const current = data?.dynamicMarkerButton ?? createDynamicMarkerButtonStyle('solid-rect')
  const nextStyle = { ...current, ...patch }
  return {
    ...(data || {}),
    label: nextStyle.label,
    dynamicMarkerButton: nextStyle,
  }
}

export const DYNAMIC_MARKER_BUTTON_KIND = 'dynamic_marker_button'

export type DynamicMarkerButtonShape = 'rect' | 'square' | 'circle' | 'text'
export type DynamicMarkerButtonAlign = 'left' | 'center' | 'right'
export type DynamicMarkerButtonIconPosition = 'left' | 'right' | 'top' | 'only'

export type DynamicMarkerButtonIcon = {
  id: string
  name: string
  path: string
}

export type DynamicMarkerButtonShadow = {
  enabled: boolean
  blur: number
  offsetX: number
  offsetY: number
  color: string
}

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
  iconId?: string
  iconPosition: DynamicMarkerButtonIconPosition
  iconColor: string
  iconSize: number
  iconGap: number
  shadow: DynamicMarkerButtonShadow
}

export type DynamicMarkerButtonPreset = DynamicMarkerButtonStyle & {
  name: string
}

export const DYNAMIC_MARKER_BUTTON_ICONS: DynamicMarkerButtonIcon[] = [
  { id: 'info', name: 'Información', path: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7h.01' },
  { id: 'more', name: 'Ver más', path: 'M5 12h14M13 6l6 6-6 6' },
  { id: 'tag', name: 'Etiqueta', path: 'M3 12l8-8h8v8l-8 8zM16 8h.01' },
  { id: 'card', name: 'Ficha', path: 'M4 5h16v14H4zM7 9h10M7 13h6' },
  { id: 'arrow-right', name: 'Flecha derecha', path: 'M4 12h14M13 6l6 6-6 6' },
  { id: 'search', name: 'Lupa', path: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16 16l5 5' },
  { id: 'link', name: 'Enlace', path: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1' },
  { id: 'cart', name: 'Producto', path: 'M3 4h2l2.5 12h11l2-8H6M9 20a1 1 0 1 0 .01 0M18 20a1 1 0 1 0 .01 0' },
  { id: 'calendar', name: 'Calendario', path: 'M4 6h16v14H4zM8 3v5M16 3v5M4 11h16' },
  { id: 'whatsapp', name: 'WhatsApp', path: 'M12 3a9 9 0 0 0-7.7 13.6L3 21l4.6-1.2A9 9 0 1 0 12 3zM8.6 8.2c.6 0 .9 1.4 1 1.7.1.4-.4.7-.5 1 .6 1 1.4 1.6 2.4 2 .3-.2.6-.7 1-.6.4.2 1.7.6 1.7 1.2 0 1-1.2 1.4-1.9 1.4-2.6 0-5.3-2.7-5.3-5.3 0-.7.4-1.4 1.6-1.4z' },
]

export const DEFAULT_DYNAMIC_MARKER_BUTTON_SHADOW: DynamicMarkerButtonShadow = {
  enabled: false,
  blur: 12,
  offsetX: 0,
  offsetY: 4,
  color: 'rgba(15,23,42,0.22)',
}

export const DYNAMIC_MARKER_BUTTON_PRESETS: DynamicMarkerButtonPreset[] = [
  { presetId: 'solid-rect', name: 'Rectangular sólido', label: 'Ver ficha', shape: 'rect', width: 180, height: 56, backgroundColor: '#2563eb', textColor: '#ffffff', borderColor: '#1d4ed8', borderWidth: 0, borderRadius: 8, opacity: 1, textSize: 18, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'center', iconPosition: 'left', iconColor: '#ffffff', iconSize: 18, iconGap: 8, shadow: DEFAULT_DYNAMIC_MARKER_BUTTON_SHADOW },
  { presetId: 'rounded-rect', name: 'Rectangular redondeado', label: 'Más información', shape: 'rect', width: 210, height: 58, backgroundColor: '#0f766e', textColor: '#ffffff', borderColor: '#115e59', borderWidth: 0, borderRadius: 16, opacity: 1, textSize: 17, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'center', iconPosition: 'left', iconColor: '#ffffff', iconSize: 18, iconGap: 8, shadow: DEFAULT_DYNAMIC_MARKER_BUTTON_SHADOW },
  { presetId: 'pill', name: 'Tipo píldora', label: 'Abrir ficha', shape: 'rect', width: 190, height: 52, backgroundColor: '#7c3aed', textColor: '#ffffff', borderColor: '#6d28d9', borderWidth: 0, borderRadius: 999, opacity: 1, textSize: 16, fontFamily: 'Poppins, sans-serif', fontWeight: '700', textAlign: 'center', iconPosition: 'left', iconColor: '#ffffff', iconSize: 18, iconGap: 8, shadow: DEFAULT_DYNAMIC_MARKER_BUTTON_SHADOW },
  { presetId: 'outline', name: 'Contorno', label: 'Consultar ficha', shape: 'rect', width: 210, height: 56, backgroundColor: '#ffffff', textColor: '#1d4ed8', borderColor: '#2563eb', borderWidth: 2, borderRadius: 10, opacity: 1, textSize: 17, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'center', iconPosition: 'left', iconColor: '#1d4ed8', iconSize: 18, iconGap: 8, shadow: DEFAULT_DYNAMIC_MARKER_BUTTON_SHADOW },
  { presetId: 'square', name: 'Cuadrado', label: 'Ficha', shape: 'square', width: 96, height: 96, backgroundColor: '#111827', textColor: '#ffffff', borderColor: '#111827', borderWidth: 0, borderRadius: 10, opacity: 1, textSize: 16, fontFamily: 'Montserrat, sans-serif', fontWeight: '700', textAlign: 'center', iconPosition: 'top', iconColor: '#ffffff', iconSize: 20, iconGap: 8, shadow: DEFAULT_DYNAMIC_MARKER_BUTTON_SHADOW },
  { presetId: 'circle', name: 'Circular', label: 'Ver', shape: 'circle', width: 104, height: 104, backgroundColor: '#be123c', textColor: '#ffffff', borderColor: '#9f1239', borderWidth: 0, borderRadius: 999, opacity: 1, textSize: 18, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'center', iconPosition: 'top', iconColor: '#ffffff', iconSize: 20, iconGap: 8, shadow: DEFAULT_DYNAMIC_MARKER_BUTTON_SHADOW },
  { presetId: 'badge', name: 'Tipo etiqueta o badge', label: 'Ficha destacada', shape: 'rect', width: 210, height: 46, backgroundColor: '#f59e0b', textColor: '#111827', borderColor: '#b45309', borderWidth: 1, borderRadius: 6, opacity: 1, textSize: 15, fontFamily: 'Poppins, sans-serif', fontWeight: '700', textAlign: 'center', iconPosition: 'left', iconColor: '#111827', iconSize: 16, iconGap: 7, shadow: DEFAULT_DYNAMIC_MARKER_BUTTON_SHADOW },
  { presetId: 'text-only', name: 'Solo texto', label: 'Leer ficha interactiva', shape: 'text', width: 220, height: 40, backgroundColor: 'rgba(255,255,255,0)', textColor: '#2563eb', borderColor: 'rgba(255,255,255,0)', borderWidth: 0, borderRadius: 0, opacity: 1, textSize: 18, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'center', iconPosition: 'left', iconColor: '#2563eb', iconSize: 18, iconGap: 6, shadow: DEFAULT_DYNAMIC_MARKER_BUTTON_SHADOW },
  { presetId: 'text-arrow', name: 'Texto con flecha', label: 'Ver más', shape: 'rect', width: 180, height: 48, backgroundColor: '#0f172a', textColor: '#ffffff', borderColor: '#0f172a', borderWidth: 0, borderRadius: 8, opacity: 1, textSize: 16, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'center', iconId: 'arrow-right', iconPosition: 'right', iconColor: '#ffffff', iconSize: 18, iconGap: 8, shadow: DEFAULT_DYNAMIC_MARKER_BUTTON_SHADOW },
  { presetId: 'info-circle', name: 'Información circular', label: 'Info', shape: 'circle', width: 104, height: 104, backgroundColor: '#0369a1', textColor: '#ffffff', borderColor: '#075985', borderWidth: 0, borderRadius: 999, opacity: 1, textSize: 15, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'center', iconId: 'info', iconPosition: 'top', iconColor: '#ffffff', iconSize: 22, iconGap: 7, shadow: DEFAULT_DYNAMIC_MARKER_BUTTON_SHADOW },
  { presetId: 'featured-product', name: 'Producto destacado', label: 'Ver producto', shape: 'rect', width: 210, height: 56, backgroundColor: '#15803d', textColor: '#ffffff', borderColor: '#166534', borderWidth: 0, borderRadius: 12, opacity: 1, textSize: 16, fontFamily: 'Poppins, sans-serif', fontWeight: '700', textAlign: 'center', iconId: 'cart', iconPosition: 'left', iconColor: '#ffffff', iconSize: 19, iconGap: 9, shadow: DEFAULT_DYNAMIC_MARKER_BUTTON_SHADOW },
  { presetId: 'shadow-button', name: 'Botón con sombra', label: 'Abrir ficha', shape: 'rect', width: 196, height: 56, backgroundColor: '#ffffff', textColor: '#111827', borderColor: '#e5e7eb', borderWidth: 1, borderRadius: 14, opacity: 1, textSize: 16, fontFamily: 'Inter, sans-serif', fontWeight: '700', textAlign: 'center', iconId: 'card', iconPosition: 'left', iconColor: '#2563eb', iconSize: 19, iconGap: 9, shadow: { enabled: true, blur: 14, offsetX: 0, offsetY: 6, color: 'rgba(15,23,42,0.24)' } },
]

export function createDynamicMarkerButtonStyle(presetId: string): DynamicMarkerButtonStyle {
  const preset = DYNAMIC_MARKER_BUTTON_PRESETS.find((item) => item.presetId === presetId) ?? DYNAMIC_MARKER_BUTTON_PRESETS[0]
  const { name: _name, ...style } = preset
  return normalizeDynamicMarkerButtonStyle(style)
}

export function getDynamicMarkerButtonIcon(iconId?: string) {
  if (!iconId) return null
  return DYNAMIC_MARKER_BUTTON_ICONS.find((icon) => icon.id === iconId) ?? null
}

export function normalizeDynamicMarkerButtonStyle(style: Partial<DynamicMarkerButtonStyle>): DynamicMarkerButtonStyle {
  return {
    presetId: style.presetId ?? 'solid-rect',
    label: style.label ?? 'Ver ficha',
    shape: style.shape ?? 'rect',
    width: style.width ?? 180,
    height: style.height ?? 56,
    backgroundColor: style.backgroundColor ?? '#2563eb',
    textColor: style.textColor ?? '#ffffff',
    borderColor: style.borderColor ?? '#1d4ed8',
    borderWidth: style.borderWidth ?? 0,
    borderRadius: style.borderRadius ?? 8,
    opacity: style.opacity ?? 1,
    textSize: style.textSize ?? 18,
    fontFamily: style.fontFamily ?? 'Inter, sans-serif',
    fontWeight: style.fontWeight ?? '700',
    textAlign: style.textAlign ?? 'center',
    iconId: style.iconId || undefined,
    iconPosition: style.iconPosition ?? 'left',
    iconColor: style.iconColor ?? style.textColor ?? '#ffffff',
    iconSize: style.iconSize ?? 18,
    iconGap: style.iconGap ?? 8,
    shadow: { ...DEFAULT_DYNAMIC_MARKER_BUTTON_SHADOW, ...(style.shadow ?? {}) },
  }
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

export function getDynamicMarkerButtonShadow(style: DynamicMarkerButtonStyle) {
  return style.shadow?.enabled
    ? {
        color: style.shadow.color,
        blur: style.shadow.blur,
        offsetX: style.shadow.offsetX,
        offsetY: style.shadow.offsetY,
      }
    : null
}

export function getDynamicMarkerButtonCacheSignature(style: DynamicMarkerButtonStyle) {
  return [
    style.label,
    style.textSize,
    style.fontFamily,
    style.fontWeight,
    style.iconId ?? '',
    style.iconColor,
    style.iconSize,
    style.iconGap,
    style.iconPosition,
    style.width,
    style.height,
  ].join('|')
}

export function getDynamicMarkerButtonScaledStyle(style: DynamicMarkerButtonStyle, scaleX: number, scaleY: number) {
  return normalizeDynamicMarkerButtonStyle({
    ...style,
    width: Math.max(32, Math.round(style.width * scaleX)),
    height: Math.max(24, Math.round(style.height * scaleY)),
  })
}

export function getDynamicMarkerButtonLayout(style: DynamicMarkerButtonStyle) {
  const icon = getDynamicMarkerButtonIcon(style.iconId)
  const showIcon = !!icon
  const showText = style.iconPosition !== 'only' && !!style.label
  const iconSize = showIcon ? Math.max(8, style.iconSize) : 0
  const gap = showIcon && showText ? Math.max(0, style.iconGap) : 0
  const maxTextWidth = Math.max(24, style.width - 18 - (style.iconPosition === 'left' || style.iconPosition === 'right' ? iconSize + gap : 0))
  const estimatedTextWidth = showText ? Math.min(maxTextWidth, Math.max(12, style.label.length * style.textSize * 0.56)) : 0
  if (!showIcon || !showText) {
    return {
      icon,
      showIcon,
      showText,
      iconX: 0,
      iconY: 0,
      textX: 0,
      textY: 0,
      textWidth: maxTextWidth,
    }
  }
  if (style.iconPosition === 'top') {
    const totalHeight = iconSize + gap + style.textSize
    return {
      icon,
      showIcon,
      showText,
      iconX: 0,
      iconY: -totalHeight / 2 + iconSize / 2,
      textX: 0,
      textY: totalHeight / 2 - style.textSize / 2,
      textWidth: maxTextWidth,
    }
  }
  const totalWidth = iconSize + gap + estimatedTextWidth
  const iconX = style.iconPosition === 'right'
    ? totalWidth / 2 - iconSize / 2
    : -totalWidth / 2 + iconSize / 2
  const textX = style.iconPosition === 'right'
    ? -totalWidth / 2 + estimatedTextWidth / 2
    : totalWidth / 2 - estimatedTextWidth / 2
  return {
    icon,
    showIcon,
    showText,
    iconX,
    iconY: 0,
    textX,
    textY: 0,
    textWidth: maxTextWidth,
  }
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
  const current = normalizeDynamicMarkerButtonStyle(data?.dynamicMarkerButton ?? createDynamicMarkerButtonStyle('solid-rect'))
  const nextStyle = normalizeDynamicMarkerButtonStyle({ ...current, ...patch })
  return {
    ...(data || {}),
    label: nextStyle.label,
    dynamicMarkerButton: nextStyle,
  }
}

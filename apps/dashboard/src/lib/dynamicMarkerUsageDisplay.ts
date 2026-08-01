import type { DynamicMarkerUsage } from './api'

export function dynamicMarkerUsageBadgeLabel(usageCount: number) {
  return usageCount > 0 ? `En uso · ${usageCount}` : 'Sin uso'
}

export function dynamicMarkerUsageSummary(usageCount: number) {
  return usageCount === 1 ? '1 uso' : `${usageCount} usos`
}

export function canOpenDynamicMarkerUsage(usageCount: number) {
  return usageCount > 0
}

export function dynamicMarkerUsageSourceLabel(sources: DynamicMarkerUsage['sources']) {
  const unique = new Set(sources)
  const hasDirect = unique.has('direct')
  const hasAction = unique.has('action')
  if (hasDirect && hasAction) return 'Ficha directa y acción'
  if (hasDirect) return 'Ficha directa'
  if (hasAction) return 'Botón o acción'
  return 'Uso'
}

export function dynamicMarkerUsageObjectLabel(usage: Pick<DynamicMarkerUsage, 'object_label' | 'object_type'>) {
  if (usage.object_label?.trim()) return usage.object_label.trim()
  if (usage.object_type === 'group') return 'Grupo'
  if (usage.object_type === 'textbox' || usage.object_type === 'i-text' || usage.object_type === 'text') return 'Texto'
  if (usage.object_type === 'image') return 'Imagen'
  if (usage.object_type === 'rect') return 'Rectángulo'
  if (usage.object_type === 'circle') return 'Círculo'
  if (usage.object_type === 'ellipse') return 'Óvalo'
  return usage.object_type || 'Elemento'
}

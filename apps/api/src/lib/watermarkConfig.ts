export type WatermarkPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'bottom-center'

export interface WatermarkConfig {
  text: string
  link_url: string
  logo_url: string | null
  position: WatermarkPosition
  opacity: number
}

export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  text: 'Creado con Intap Flipbook',
  link_url: 'https://intapflipbook.com/',
  logo_url: null,
  position: 'bottom-right',
  opacity: 80,
}

const POSITIONS = new Set<WatermarkPosition>([
  'bottom-right',
  'bottom-left',
  'bottom-center',
])

export function normalizeHttpUrl(
  value: unknown,
): string | null {
  const candidate = String(value ?? '').trim()

  if (!candidate) return null

  try {
    const url = new URL(candidate)

    if (
      url.protocol !== 'http:'
      && url.protocol !== 'https:'
    ) {
      return null
    }

    return url.toString()
  } catch {
    return null
  }
}

function normalizeText(value: unknown): string {
  const text = String(value ?? '')
    .trim()
    .slice(0, 120)

  return text || DEFAULT_WATERMARK_CONFIG.text
}

function normalizePosition(
  value: unknown,
): WatermarkPosition {
  return POSITIONS.has(value as WatermarkPosition)
    ? value as WatermarkPosition
    : DEFAULT_WATERMARK_CONFIG.position
}

function normalizeOpacity(value: unknown): number {
  const opacity = Number(value)

  if (!Number.isFinite(opacity)) {
    return DEFAULT_WATERMARK_CONFIG.opacity
  }

  return Math.min(
    100,
    Math.max(10, Math.round(opacity)),
  )
}

export function normalizeWatermarkConfig(
  value: Partial<WatermarkConfig> | null | undefined,
): WatermarkConfig {
  return {
    text: normalizeText(value?.text),

    link_url: normalizeHttpUrl(value?.link_url)
      ?? DEFAULT_WATERMARK_CONFIG.link_url,

    logo_url: normalizeHttpUrl(value?.logo_url),

    position: normalizePosition(value?.position),

    opacity: normalizeOpacity(value?.opacity),
  }
}

export async function getGlobalWatermarkConfig(
  db: D1Database,
): Promise<WatermarkConfig> {
  const row = await db.prepare(
    `SELECT
       text,
       link_url,
       logo_url,
       position,
       opacity
     FROM watermark_config
     WHERE id = 1
     LIMIT 1`,
  ).first<Partial<WatermarkConfig>>()

  return normalizeWatermarkConfig(row)
}

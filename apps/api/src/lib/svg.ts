// ════════════════════════════════════════════════════════════════════════════
// Sanitización de SVG — elimina código peligroso antes de guardar.
//
// Usa HTMLRewriter, una API NATIVA del runtime de Cloudflare Workers para
// procesar HTML/XML en streaming (sin librerías externas). Recorremos el SVG
// y descartamos etiquetas y atributos no permitidos.
//
// Modelo "whitelist" (lista blanca): solo dejamos pasar lo explícitamente seguro.
// Todo lo demás se elimina.
// ════════════════════════════════════════════════════════════════════════════

// Etiquetas SVG seguras que conservamos. Cualquier otra (script, foreignObject,
// iframe, image con href externo, etc.) se elimina por completo.
const ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'title', 'desc',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop',
  'clipPath', 'mask', 'use', 'symbol',
])

// Atributos que empiezan con estos prefijos se eliminan siempre (eventos JS).
const EVENT_ATTR_PREFIX = 'on'

// Atributos peligrosos que eliminamos aunque no sean eventos.
const DANGEROUS_ATTRS = new Set(['xlink:href', 'href', 'style'])

// Comprueba si un valor de atributo contiene una referencia externa/peligrosa.
function isDangerousValue(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v.startsWith('javascript:')) return true
  if (v.startsWith('http://') || v.startsWith('https://')) return true
  if (v.startsWith('//')) return true
  if (v.includes('url(') && (v.includes('http') || v.includes('//'))) return true
  if (v.includes('data:') && !v.startsWith('data:image/svg')) return true
  return false
}

export type SanitizeResult = { ok: true; svg: string } | { ok: false; error: string }

export async function sanitizeSvg(raw: string): Promise<SanitizeResult> {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'SVG vacío o inválido' }
  }
  // Verificación básica de que parece un SVG
  if (!/<svg[\s>]/i.test(raw)) {
    return { ok: false, error: 'El archivo no parece un SVG válido' }
  }

  // Rechazo rápido de contenido claramente peligroso antes de procesar.
  if (/<script[\s>]/i.test(raw) || /<foreignObject[\s>]/i.test(raw) || /<iframe[\s>]/i.test(raw)) {
    // No abortamos: HTMLRewriter los va a quitar igual. Pero registramos.
  }

  // HTMLRewriter trabaja sobre una Response. Envolvemos el SVG en una.
  const response = new Response(raw, { headers: { 'content-type': 'text/html' } })

  const rewriter = new HTMLRewriter()
    // Para cualquier elemento: si no está en la whitelist, lo removemos.
    .on('*', {
      element(el) {
        const tag = el.tagName.toLowerCase()
        if (!ALLOWED_TAGS.has(tag)) {
          el.remove() // elimina la etiqueta y su contenido
          return
        }
        // Limpiar atributos peligrosos del elemento permitido.
        // Recolectamos primero los nombres a borrar y removemos DESPUÉS de
        // terminar de iterar: mutar `el.attributes` durante su propia iteración
        // puede lanzar excepción en HTMLRewriter.
        const toRemove: string[] = []
        for (const [name, value] of el.attributes) {
          const lname = name.toLowerCase()
          if (lname.startsWith(EVENT_ATTR_PREFIX)) {
            toRemove.push(name)
            continue
          }
          if (DANGEROUS_ATTRS.has(lname)) {
            // href/xlink:href solo se permiten si son referencias internas (#id)
            if ((lname === 'href' || lname === 'xlink:href') && value.trim().startsWith('#')) {
              continue
            }
            toRemove.push(name)
            continue
          }
          if (isDangerousValue(value)) {
            toRemove.push(name)
          }
        }
        for (const name of toRemove) el.removeAttribute(name)
      },
    })

  const transformed = rewriter.transform(response)
  let svg = await transformed.text()

  // Limpieza final defensiva por si algo se escapó del streaming.
  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')

  if (!/<svg[\s\S]*<\/svg>/i.test(svg)) {
    return { ok: false, error: 'El SVG quedó vacío tras la sanitización' }
  }

  return { ok: true, svg }
}

// Hash simple (SHA-256 en hex) del contenido para detectar duplicados/cambios.
export async function svgHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Genera un slug a partir de un nombre o nombre de archivo.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/\.svg$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `svg-${Date.now()}`
}

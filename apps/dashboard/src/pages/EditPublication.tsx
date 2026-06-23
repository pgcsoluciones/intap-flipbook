import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
// @ts-ignore
import { fabric } from 'fabric'
import { api } from '../lib/api'
import FileField from '../components/FileField'
import WidgetPreview from '../components/WidgetPreview'

// Tipos MIME para los distintos campos de subida del editor
const ACCEPT_AUDIO = 'audio/mpeg,audio/mp3,audio/ogg,audio/wav,audio/mp4,audio/aac'
const ACCEPT_VIDEO = 'video/mp4,video/webm,video/ogg'
const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,image/svg+xml,image/gif'
const ACCEPT_FILE  = 'application/pdf,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png,image/webp'

// Página en blanco: SVG data-URL blanco con proporción A4 retrato. Sirve como
// image_url de fondo cuando el usuario crea una página desde cero (sin subir nada).
export const BLANK_PAGE_URL = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754"><rect width="1240" height="1754" fill="#ffffff"/></svg>',
)

// ─── Iconos SVG monocromáticos (estilo línea, 20px, stroke uniforme) ──────────
// "stroke" = trazo. Todos comparten grosor 1.6 y currentColor para mantener
// consistencia visual en toda la barra de herramientas.
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const p: React.SVGProps<SVGSVGElement> = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
  }
  switch (name) {
    case 'pages':     return <svg {...p}><rect x="4" y="3" width="13" height="18" rx="2"/><path d="M20 7v12a2 2 0 0 1-2 2H8"/></svg>
    case 'templates': return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
    case 'text':      return <svg {...p}><path d="M5 5h14M12 5v14M9 19h6"/></svg>
    case 'image':     return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m3 17 5-4 4 3 3-3 6 5"/></svg>
    case 'shapes':    return <svg {...p}><circle cx="8" cy="8" r="4.5"/><rect x="12" y="12" width="8" height="8" rx="1.5"/></svg>
    case 'buttons':   return <svg {...p}><rect x="3" y="8" width="18" height="8" rx="4"/><path d="M8 12h8"/></svg>
    case 'elements':  return <svg {...p}><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/></svg>
    case 'svglib':    return <svg {...p}><path d="M3 5h12M3 10h12M3 15h7"/><path d="m16 13 5 5M21 13l-5 5"/></svg>
    case 'link':      return <svg {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
    case 'widgets':   return <svg {...p}><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>
    case 'uploads':   return <svg {...p}><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/></svg>
    case 'trash':     return <svg {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13"/></svg>
    case 'duplicate': return <svg {...p}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/></svg>
    case 'front':     return <svg {...p}><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M3 12h2M19 12h2M12 3v2M12 19v2"/></svg>
    case 'back':      return <svg {...p}><rect x="4" y="4" width="10" height="10" rx="1"/><rect x="10" y="10" width="10" height="10" rx="1"/></svg>
    case 'chevron':   return <svg {...p}><path d="m9 6 6 6-6 6"/></svg>
    case 'plus':      return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>
    case 'rect':      return <svg {...p}><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>
    case 'circle':    return <svg {...p}><circle cx="12" cy="12" r="8"/></svg>
    case 'triangle':  return <svg {...p}><path d="M12 4 21 20H3z"/></svg>
    case 'line':      return <svg {...p}><path d="M4 18 20 6"/></svg>
    case 'star':      return <svg {...p}><path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6L12 17.8 6.6 19.6l1-6L3.3 9.4l6-.9z"/></svg>
    case 'undo':      return <svg {...p}><path d="M3 10h10a6 6 0 0 1 0 12H8"/><path d="M3 6l-3 4 3 4"/></svg>
    case 'redo':      return <svg {...p}><path d="M21 10H11A6 6 0 0 0 11 22h5"/><path d="M21 6l3 4-3 4"/></svg>
    case 'arrow':     return <svg {...p}><path d="M4 12h14M13 6l6 6-6 6"/></svg>
    case 'badge':     return <svg {...p}><circle cx="12" cy="9" r="6"/><path d="m8 14-1 7 5-3 5 3-1-7"/></svg>
    case 'map':       return <svg {...p}><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/></svg>
    case 'whatsapp':  return <svg {...p}><path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.6-1.2A9 9 0 1 0 12 3z"/><path d="M8.6 8.2c.6 0 .9 1.4 1 1.7.1.4-.4.7-.5 1 .6 1 1.4 1.6 2.4 2 .3-.2.6-.7 1-.6.4.2 1.7.6 1.7 1.2 0 1-1.2 1.4-1.9 1.4-2.6 0-5.3-2.7-5.3-5.3 0-.7.4-1.4 1.6-1.4z"/></svg>
    case 'contact':   return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>
    case 'video':     return <svg {...p}><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></svg>
    case 'audio':     return <svg {...p}><path d="M9 18V7l10-2v11"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>
    case 'qr':        return <svg {...p}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M21 14v7h-7"/></svg>
    case 'table':     return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/></svg>
    case 'like':      return <svg {...p}><path d="M7 10v10H4V10zM7 10l4-7c1.3 0 2 .8 2 2l-.7 5H19a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 18 21H7"/></svg>
    case 'quiz':      return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.3 2.4c-.8.3-1.3 1-1.3 1.8M12 17h.01"/></svg>
    case 'embed':     return <svg {...p}><path d="m9 8-5 4 5 4M15 8l5 4-5 4"/></svg>
    case 'group':     return <svg {...p}><rect x="3" y="3" width="13" height="13" rx="1.5"/><path d="M8 21h11a2 2 0 0 0 2-2V8"/></svg>
    case 'ungroup':   return <svg {...p}><rect x="3" y="3" width="9" height="9" rx="1.5"/><rect x="12" y="12" width="9" height="9" rx="1.5"/></svg>
    case 'forward':   return <svg {...p}><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M3 12h2M12 3v2"/></svg>
    case 'backward':  return <svg {...p}><rect x="4" y="4" width="9" height="9" rx="1.5"/><path d="M20 11v8a1 1 0 0 1-1 1h-8"/></svg>
    case 'lock':      return <svg {...p}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
    case 'unlock':    return <svg {...p}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>
    case 'replace':   return <svg {...p}><path d="M4 8a8 8 0 0 1 13-2l3 3M20 16a8 8 0 0 1-13 2l-3-3"/><path d="M20 4v5h-5M4 20v-5h5"/></svg>
    case 'alignLeft':   return <svg {...p}><path d="M4 4v16"/><rect x="7" y="7" width="11" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/></svg>
    case 'alignCenterH':return <svg {...p}><path d="M12 4v16"/><rect x="6" y="7" width="12" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg>
    case 'alignRight':  return <svg {...p}><path d="M20 4v16"/><rect x="6" y="7" width="11" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/></svg>
    case 'alignTop':    return <svg {...p}><path d="M4 4h16"/><rect x="7" y="7" width="4" height="11" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/></svg>
    case 'alignMiddle': return <svg {...p}><path d="M4 12h16"/><rect x="7" y="6" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg>
    case 'alignBottom': return <svg {...p}><path d="M4 20h16"/><rect x="7" y="6" width="4" height="11" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/></svg>
    default:          return <svg {...p}><circle cx="12" cy="12" r="8"/></svg>
  }
}

// ─── Herramientas de la barra lateral (icon rail) ─────────────────────────────
type ToolKey =
  | 'pages' | 'templates' | 'text' | 'image'
  | 'shapes' | 'buttons' | 'elements' | 'svglib' | 'link' | 'widgets' | 'uploads'

const RAIL: { key: ToolKey; label: string }[] = [
  { key: 'pages',     label: 'Páginas' },
  { key: 'templates', label: 'Plantilla' },
  { key: 'text',      label: 'Texto' },
  { key: 'image',     label: 'Imagen' },
  { key: 'shapes',    label: 'Formas' },
  { key: 'buttons',   label: 'Botones' },
  { key: 'elements',  label: 'Elementos' },
  { key: 'svglib',    label: 'Biblioteca' },
  { key: 'link',      label: 'Enlace' },
  { key: 'widgets',   label: 'Widgets' },
  { key: 'uploads',   label: 'Cargas' },
]

// Paletas de color prediseñadas (panel derecho de configuración)
const COLOR_SCHEMES: { name: string; colors: string[] }[] = [
  { name: 'Azul cielo',     colors: ['#0EA5E9', '#38BDF8', '#7DD3FC', '#BAE6FD'] },
  { name: 'Verde helecho',  colors: ['#059669', '#10B981', '#34D399', '#A7F3D0'] },
  { name: 'Marrón cálido',  colors: ['#92400E', '#B45309', '#D97706', '#FCD34D'] },
  { name: 'Medianoche',     colors: ['#1E1B4B', '#312E81', '#4F46E5', '#818CF8'] },
]

// Estilos de texto prediseñados
const TEXT_PRESETS = [
  { label: 'Agregar Título',    sample: 'Título',          opts: { fontSize: 44, fontWeight: 'bold' as const } },
  { label: 'Agregar Subtítulo', sample: 'Subtítulo',       opts: { fontSize: 28, fontWeight: 600 as any } },
  { label: 'Texto Principal',   sample: 'Cuerpo de texto', opts: { fontSize: 18, fontWeight: 'normal' as const } },
  { label: 'Texto pequeño',     sample: 'Pie de página',   opts: { fontSize: 13, fontWeight: 'normal' as const } },
]

// Librería de tipografías. "fontFamily" debe coincidir con las fuentes cargadas
// en index.html (Google Fonts) para que se vean igual en editor y visor.
const FONTS: { name: string; family: string }[] = [
  { name: 'Inter',           family: 'Inter, sans-serif' },
  { name: 'Poppins',         family: 'Poppins, sans-serif' },
  { name: 'Montserrat',      family: 'Montserrat, sans-serif' },
  { name: 'Oswald',          family: 'Oswald, sans-serif' },
  { name: 'Bebas Neue',      family: '"Bebas Neue", sans-serif' },
  { name: 'Roboto Slab',     family: '"Roboto Slab", serif' },
  { name: 'Merriweather',    family: 'Merriweather, serif' },
  { name: 'Playfair',        family: '"Playfair Display", serif' },
  { name: 'Lobster',         family: 'Lobster, cursive' },
  { name: 'Pacifico',        family: 'Pacifico, cursive' },
  { name: 'Dancing Script',  family: '"Dancing Script", cursive' },
  { name: 'Caveat',          family: 'Caveat, cursive' },
  { name: 'Georgia',         family: 'Georgia, serif' },
  { name: 'Courier',         family: '"Courier New", monospace' },
]

// Galería de iconos / figuras / señales (SVG vectorial). Cada `svg` es el
// contenido interno; `addIcon` lo envuelve y lo convierte en objeto Fabric.
type IconItem = { label: string; svg: string }
const ICON_STROKE = 'stroke="#334155" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'
const ICON_FILL = 'fill="#334155" stroke="none"'
const ICON_LIBRARY: { category: string; items: IconItem[] }[] = [
  {
    category: 'Flechas',
    items: [
      { label: 'Derecha',  svg: `<path d="M4 12h14M13 6l6 6-6 6" ${ICON_STROKE}/>` },
      { label: 'Arriba',   svg: `<path d="M12 20V5M6 11l6-6 6 6" ${ICON_STROKE}/>` },
      { label: 'Curva',    svg: `<path d="M5 16c5 3 11 0 13-6M18 5l1 5-5 1" ${ICON_STROKE}/>` },
      { label: 'Dobles',   svg: `<path d="M3 9l4-4 4 4M3 15l4 4 4-4M14 8h7M14 16h7" ${ICON_STROKE}/>` },
    ],
  },
  {
    category: 'Negocio',
    items: [
      { label: 'Teléfono', svg: `<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" ${ICON_STROKE}/>` },
      { label: 'Email',    svg: `<path d="M3 6h18v12H3zM3 7l9 6 9-6" ${ICON_STROKE}/>` },
      { label: 'Ubicación',svg: `<path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12zM12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" ${ICON_STROKE}/>` },
      { label: 'Carrito',  svg: `<path d="M3 4h2l2.5 12h11l2-8H6M9 20a1 1 0 1 0 .01 0M18 20a1 1 0 1 0 .01 0" ${ICON_STROKE}/>` },
      { label: 'Precio',   svg: `<path d="M3 12l8-8h8v8l-8 8zM16 8h.01" ${ICON_STROKE}/>` },
      { label: 'Reloj',    svg: `<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" ${ICON_STROKE}/>` },
    ],
  },
  {
    category: 'Señales',
    items: [
      { label: 'Check',    svg: `<path d="M5 13l4 4 10-11" ${ICON_STROKE}/>` },
      { label: 'Aviso',    svg: `<path d="M12 3 2 20h20zM12 9v5M12 18h.01" ${ICON_STROKE}/>` },
      { label: 'Info',     svg: `<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7h.01" ${ICON_STROKE}/>` },
      { label: 'OK',       svg: `<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6" ${ICON_STROKE}/>` },
    ],
  },
  {
    category: 'Decorativos',
    items: [
      { label: 'Estrella', svg: `<path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6L12 17.8 6.6 19.6l1-6L3.3 9.4l6-.9z" fill="#F59E0B" stroke="none"/>` },
      { label: 'Corazón',  svg: `<path d="M12 21s-7-4.7-9.3-9.2C1 8 3 4.5 6.5 4.5c2 0 3.5 1.3 5.5 3.5 2-2.2 3.5-3.5 5.5-3.5C21 4.5 23 8 21.3 11.8 19 16.3 12 21 12 21z" fill="#EF4444" stroke="none"/>` },
      { label: 'Corona',   svg: `<path d="M3 8l4 4 5-7 5 7 4-4-2 12H5z" ${ICON_FILL}/>` },
      { label: 'Destello', svg: `<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" ${ICON_STROKE}/>` },
    ],
  },
  {
    category: 'Redes',
    items: [
      { label: 'WhatsApp', svg: `<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.6-1.2A9 9 0 1 0 12 3zM8.6 8.2c.6 0 .9 1.4 1 1.7.1.4-.4.7-.5 1 .6 1 1.4 1.6 2.4 2 .3-.2.6-.7 1-.6.4.2 1.7.6 1.7 1.2 0 1-1.2 1.4-1.9 1.4-2.6 0-5.3-2.7-5.3-5.3 0-.7.4-1.4 1.6-1.4z" fill="#25D366" stroke="none"/>` },
      { label: 'Globo',    svg: `<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" ${ICON_STROKE}/>` },
      { label: 'Instagram',svg: `<path d="M4 8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16.5 7.5h.01" ${ICON_STROKE}/>` },
      { label: 'Facebook', svg: `<path d="M13 22V12h3l.5-4H13V6c0-1 .3-1.5 1.5-1.5H17V1.1C16.5 1 15.3 1 14 1c-2.7 0-4 1.6-4 4.3V8H7v4h3v10z" ${ICON_FILL}/>` },
    ],
  },
]

// Botones prediseñados con estilo coherente (relleno / contorno / texto)
const BUTTON_PRESETS: { label: string; variant: 'solid' | 'outline' | 'pill' }[] = [
  { label: 'Comprar Ahora',  variant: 'solid' },
  { label: 'Contáctanos',    variant: 'solid' },
  { label: 'Aprender Más',   variant: 'outline' },
  { label: 'Regístrate',     variant: 'pill' },
  { label: 'Iniciar Sesión', variant: 'outline' },
  { label: 'Reproducir',     variant: 'solid' },
]

// Tipos de acción de un botón (qué ocurre al hacer clic en el viewer)
type ActionType = 'link' | 'page' | 'call' | 'whatsapp' | 'email' | 'popup_text' | 'popup_image' | 'popup_video' | 'popup_audio' | 'download' | 'show_hide' | 'gallery_images' | 'gallery_videos'
const ACTION_TYPES: { type: ActionType; label: string; icon: string }[] = [
  { type: 'link',           label: 'Abrir Enlace',        icon: 'link' },
  { type: 'page',           label: 'Ir a Página',         icon: 'pages' },
  { type: 'call',           label: 'Llamar',              icon: 'badge' },
  { type: 'whatsapp',       label: 'WhatsApp',            icon: 'whatsapp' },
  { type: 'email',          label: 'Email',               icon: 'contact' },
  { type: 'popup_text',     label: 'Texto emergente',     icon: 'text' },
  { type: 'popup_image',    label: 'Imagen emergente',    icon: 'image' },
  { type: 'popup_video',    label: 'Video emergente',     icon: 'video' },
  { type: 'popup_audio',    label: 'Audio emergente',     icon: 'audio' },
  { type: 'download',       label: 'Descargar archivo',   icon: 'uploads' },
  { type: 'gallery_images', label: 'Galería de imágenes', icon: 'image' },
  { type: 'gallery_videos', label: 'Galería de videos',   icon: 'video' },
  { type: 'show_hide',      label: 'Mostrar/Ocultar',     icon: 'elements' },
]

// Catálogo de widgets. `type` identifica el comportamiento que el visor renderiza.
type WidgetType = 'map' | 'whatsapp' | 'contact' | 'video' | 'audio' | 'qr' | 'table' | 'like' | 'embed' | 'quiz' | 'popup_banner' | 'download' | 'units_table'
const WIDGETS: { type: WidgetType; label: string; icon: string; premium: boolean }[] = [
  { type: 'map',          label: 'Mapa',                  icon: 'map',      premium: false },
  { type: 'whatsapp',     label: 'WhatsApp',              icon: 'whatsapp', premium: false },
  { type: 'contact',      label: 'Formulario',            icon: 'contact',  premium: false },
  { type: 'video',        label: 'Video',                 icon: 'video',    premium: false },
  { type: 'audio',        label: 'Audio',                 icon: 'audio',    premium: false },
  { type: 'qr',           label: 'Código QR',             icon: 'qr',       premium: false },
  { type: 'table',        label: 'Tabla',                 icon: 'table',    premium: false },
  { type: 'like',         label: 'Me gusta',              icon: 'like',     premium: false },
  { type: 'download',     label: 'Descargar archivo',     icon: 'uploads',  premium: false },
  { type: 'popup_banner', label: 'Pop-up emergente',      icon: 'badge',    premium: false },
  { type: 'embed',        label: 'Incrustar / HTML',      icon: 'embed',    premium: false },
  { type: 'quiz',         label: 'Cuestionario',          icon: 'quiz',     premium: false },
  { type: 'units_table',  label: 'Tabla de Unidades',     icon: 'table',    premium: false },
]

// Configuración inicial de cada widget (la edita el usuario en el panel derecho).
const WIDGET_DEFAULTS: Record<WidgetType, any> = {
  map:      { address: '', mapsUrl: '', zoom: 14 },
  whatsapp: { phone: '', message: 'Hola, vi tu catálogo y quiero más información', label: 'Escríbenos por WhatsApp' },
  contact:  { title: 'Contáctanos', toEmail: '', button: 'Enviar', showPhone: true, showComment: true, nameRequired: true, emailRequired: true, phoneRequired: false },
  video:    { url: '', autoplay: false, controls: true, muted: false, poster: '', loop: false },
  audio:    { url: '', playerColor: '#4F46E5', autoplay: false, loop: false },
  qr:       { data: '', caption: 'Escanéame' },
  table:    { csv: 'Producto, Precio\nCafé, $2.50\nTé, $2.00' },
  like:     { label: 'Me gusta' },
  download: { url: '', filename: '', title: 'Descarga aquí', button: 'Descargar', buttonColor: '#4F46E5' },
  embed:    { html: '' },
  quiz:     { title: 'Cuestionario', questions: [{ text: '¿Tu pregunta?', options: ['Opción A', 'Opción B'], type: 'single' }] },
  units_table: { publication_id: '', show_price: true, show_area: true, filter_status: 'all' },
  popup_banner: {
    template: 'offer',
    position: 'left',
    trigger: 'delay',
    delay: 5,
    animation: 'slide',
    autoClose: 0,
    title: '¡Oferta relámpago!',
    text: 'Aprovechá este descuento exclusivo por tiempo limitado.',
    buttonText: 'Ver oferta',
    buttonUrl: '',
    bgColor: '#1e1b4b',
    textColor: '#ffffff',
    image: '',
    imagePosition: 'left',
    imageZoom: 1,
    imagePosX: 50,
    imagePosY: 50,
    showOnce: true,
  },
}

// Plantillas prediseñadas para el pop-up emergente
const POPUP_TEMPLATES: { key: string; label: string; defaults: Partial<typeof WIDGET_DEFAULTS['popup_banner']> }[] = [
  { key: 'offer',   label: '⚡ Oferta relámpago', defaults: { title: '¡Oferta relámpago!', text: 'Solo por hoy — 30% OFF en toda la tienda.', buttonText: 'Ver ofertas', bgColor: '#7c3aed', textColor: '#fff' } },
  { key: 'contact', label: '📞 Datos de contacto', defaults: { title: '¿Necesitás ayuda?', text: 'Nuestro equipo está disponible. ¡Escribinos!', buttonText: 'Contactar', bgColor: '#0369a1', textColor: '#fff' } },
  { key: 'bonus',   label: '🎁 Bono / Descuento',  defaults: { title: '¡Bono exclusivo!', text: 'Registrate y obtené un bono de bienvenida.', buttonText: 'Reclamar', bgColor: '#15803d', textColor: '#fff' } },
  { key: 'news',    label: '📰 Novedad',            defaults: { title: 'Nueva colección disponible', text: 'Mirá las últimas novedades de temporada.', buttonText: 'Ver ahora', bgColor: '#b45309', textColor: '#fff' } },
  { key: 'custom',  label: '✏️ Personalizado',      defaults: { bgColor: '#111827', textColor: '#fff' } },
]

// Reúne todas las URLs de imágenes ya usadas en el proyecto: fondos de página
// y elementos de imagen dentro del canvas de cada página.
function collectBankFromPages(ps: any[]): string[] {
  const urls = new Set<string>()
  for (const pg of ps) {
    if (pg?.image_url) urls.add(pg.image_url)
    const cj = pg?.canvas_json
    if (cj) {
      try {
        const parsed = typeof cj === 'string' ? JSON.parse(cj) : cj
        for (const o of parsed?.objects ?? []) {
          if (o?.type === 'image' && o?.src) urls.add(o.src)
          if (o?.data?.src) urls.add(o.data.src)
        }
      } catch { /* canvas_json inválido: lo ignoramos */ }
    }
  }
  return [...urls]
}

export default function EditPublication() {
  const { id } = useParams<{ id: string }>()
  const [pub, setPub]       = useState<any>(null)
  const [pages, setPages]   = useState<any[]>([])
  const [activePage, setActivePage] = useState<any>(null)
  const [uploading, setUploading]   = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [defaultFont, setDefaultFont] = useState<string>(FONTS[0].family) // tipografía para texto nuevo
  const [imageBank, setImageBank] = useState<string[]>([]) // banco de imágenes subidas en este proyecto
  const [selectVersion, setSelectVersion] = useState(0) // fuerza refresco del panel de props
  const [zoom, setZoom]   = useState(100)

  // Estado de autoguardado: 'idle' | 'saving' | 'saved'
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

  const [activeTool, setActiveTool] = useState<ToolKey>('pages')
  const [panelOpen, setPanelOpen]   = useState(true)
  const [ctxMenu, setCtxMenu]       = useState<{ x: number; y: number } | null>(null)
  const [alignRef, setAlignRef]     = useState<'canvas' | 'selection'>('canvas')
  const [replaceModal, setReplaceModal] = useState(false)
  const [templates, setTemplates]   = useState<any[]>([])
  const [tplQuery, setTplQuery]     = useState('')
  const [bgColor, setBgColor]       = useState('#ffffff')

  // Biblioteca SVG (recursos vectoriales del super admin, filtrados por plan)
  const [svgLib, setSvgLib]         = useState<any[]>([])
  const [svgLibLoaded, setSvgLibLoaded] = useState(false)
  const [svgLibQuery, setSvgLibQuery]   = useState('')
  const [svgLibFamily, setSvgLibFamily] = useState('') // '' = todas
  const [svgSync, setSvgSync]           = useState(false) // sincronizar SVG en todas las páginas

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<any>(null)
  const pageIdRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imgInputRef  = useRef<HTMLInputElement>(null)
  const svgInputRef = useRef<HTMLInputElement>(null)
  const pdfPagesInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const autosaveTimer = useRef<any>(null)
  const savedFlashTimer = useRef<any>(null)

  // ── Historial de deshacer/rehacer (undo/redo) ──
  // Guardamos hasta 20 snapshots (JSON del canvas) por página.
  // historyRef[historyIndexRef] = estado actual.
  const historyRef      = useRef<string[]>([])
  const historyIndexRef = useRef<number>(-1)
  const isUndoRedoRef   = useRef<boolean>(false)   // true mientras cargamos un estado pasado
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const updateUndoRedoState = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0)
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1)
  }, [])

  const pushHistory = useCallback((json: string) => {
    // Descarta cualquier redo pendiente y agrega el nuevo estado
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1)
    historyRef.current.push(json)
    if (historyRef.current.length > 20) historyRef.current.shift()
    historyIndexRef.current = historyRef.current.length - 1
    updateUndoRedoState()
  }, [updateUndoRedoState])

  const scheduleAutosaveRef = useRef<() => void>(() => {})

  const applyHistory = useCallback((json: string) => {
    const c = fabricRef.current
    if (!c) return
    isUndoRedoRef.current = true
    c.loadFromJSON(json, () => {
      c.renderAll()
      isUndoRedoRef.current = false
      scheduleAutosaveRef.current()
    })
  }, [])

  useEffect(() => {
    if (!id) return
    api.publications.get(id).then((res) => {
      setPub(res.data)
      const ps = res.data.pages ?? []
      setPages(ps)
      if (ps.length > 0) setActivePage(ps[0])
      // Banco de imágenes: imágenes del proyecto + las guardadas localmente (subidas pero quizá no colocadas)
      let stored: string[] = []
      try { stored = JSON.parse(localStorage.getItem(`imgbank_${id}`) ?? '[]') } catch {}
      const merged = Array.from(new Set([...collectBankFromPages(ps), ...stored]))
      setImageBank(merged)
    })
    api.templates.list().then((r) => setTemplates(r.data ?? [])).catch(() => {})
  }, [id])

  // Agrega una URL al banco de imágenes del proyecto (sin duplicar) y lo persiste
  const addToBank = useCallback((url: string) => {
    if (!url) return
    setImageBank((prev) => {
      if (prev.includes(url)) return prev
      const next = [url, ...prev]
      try { localStorage.setItem(`imgbank_${id}`, JSON.stringify(next)) } catch {}
      return next
    })
  }, [id])

  // Borra una imagen del banco: la elimina de R2, del estado y de localStorage.
  const deleteFromBank = useCallback(async (url: string) => {
    if (!url) return
    const ok = window.confirm(
      '¿Eliminar esta imagen?\n\nSe borrará del almacenamiento. Si está en uso en alguna página, dejará de mostrarse ahí.\n\nEsta acción no se puede deshacer.'
    )
    if (!ok) return
    try {
      await api.deleteUpload(url)
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo eliminar la imagen.')
      return
    }
    setImageBank((prev) => {
      const next = prev.filter((u) => u !== url)
      try { localStorage.setItem(`imgbank_${id}`, JSON.stringify(next)) } catch {}
      return next
    })
  }, [id])

  // Ref a pages para acceder dentro de persistCanvas sin re-crear el callback
  const pagesRef = useRef<any[]>([])
  useEffect(() => { pagesRef.current = pages }, [pages])

  // ── Autoguardado: guarda el canvas actual en segundo plano ──
  // Se llama tras cada cambio (debounce) y al cambiar de página.
  const persistCanvas = useCallback(async (pageId: string, canvas: any, flash = true) => {
    if (!pageId || !canvas) return
    setSaveState('saving')
    try {
      const json = JSON.stringify(canvas.toJSON(['data']))
      await api.pages.saveCanvas(pageId, json)
      setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, canvas_json: json } : p)))

      // Propagar objetos con syncGroupId a otras páginas.
      // syncGroupId (identificador de sincronización) marca SVGs que deben ser iguales en todas las páginas.
      // Solo sincronizamos propiedades visuales (escala, ángulo, datos) manteniendo la posición por página.
      try {
        const parsed = JSON.parse(json)
        const synced: any[] = (parsed?.objects ?? []).filter((o: any) => o?.data?.syncGroupId)
        if (synced.length > 0) {
          const otherPages = pagesRef.current.filter((p) => p.id !== pageId && p.canvas_json)
          for (const page of otherPages) {
            try {
              const pj = typeof page.canvas_json === 'string' ? JSON.parse(page.canvas_json) : page.canvas_json
              let changed = false
              const updatedObjs = (pj?.objects ?? []).map((o: any) => {
                if (!o?.data?.syncGroupId) return o
                const match = synced.find((s: any) => s.data.syncGroupId === o.data.syncGroupId)
                if (!match) return o
                changed = true
                // Copia propiedades visuales pero conserva left/top/data.action de la copia local
                return { ...match, left: o.left, top: o.top, data: { ...match.data, action: o.data?.action } }
              })
              if (changed) {
                const newJson = JSON.stringify({ ...pj, objects: updatedObjs })
                await api.pages.saveCanvas(page.id, newJson)
                setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, canvas_json: newJson } : p)))
              }
            } catch { /* página con JSON inválido — se ignora */ }
          }
        }
      } catch { /* ignorar errores de propagación */ }

      if (flash) {
        setSaveState('saved')
        clearTimeout(savedFlashTimer.current)
        savedFlashTimer.current = setTimeout(() => setSaveState('idle'), 1800)
      } else {
        setSaveState('idle')
      }
    } catch {
      setSaveState('idle')
    }
  }, [])

  // Programa un guardado diferido (1.2s tras el último cambio)
  const scheduleAutosave = useCallback(() => {
    if (!pageIdRef.current) return
    clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => {
      if (fabricRef.current && pageIdRef.current) persistCanvas(pageIdRef.current, fabricRef.current)
    }, 1200)
  }, [persistCanvas])

  // Mantiene la ref actualizada para que applyHistory pueda llamarla
  scheduleAutosaveRef.current = scheduleAutosave

  // ── Inicialización del canvas Fabric.js por página ──
  useEffect(() => {
    if (!activePage || !canvasRef.current) return

    // Guarda la página anterior ANTES de cambiar (no perder trabajo)
    if (fabricRef.current && pageIdRef.current && pageIdRef.current !== activePage.id) {
      clearTimeout(autosaveTimer.current)
      persistCanvas(pageIdRef.current, fabricRef.current, false)
    }
    pageIdRef.current = activePage.id
    if (fabricRef.current) { fabricRef.current.dispose(); fabricRef.current = null }
    setSelected(null)

    // Reinicia el historial al cambiar de página
    historyRef.current = []
    historyIndexRef.current = -1
    setCanUndo(false)
    setCanRedo(false)

    const W = 580
    const H = Math.round(W * 1.414)
    const canvas = new fabric.Canvas(canvasRef.current, { width: W, height: H, backgroundColor: bgColor, preserveObjectStacking: true })
    fabricRef.current = canvas

    // Guarda bloquea el autoguardado mientras se deserializa el JSON de la página.
    // Sin esto, `object:added` dispara por cada objeto durante `loadFromJSON` y
    // el timer de 1.2s expira con el canvas a medio cargar, sobreescribiendo datos.
    let isLoading = true

    fabric.Image.fromURL(activePage.image_url, (img: any) => {
      img.scaleToWidth(W)
      img.scaleToHeight(H)
      img.set({ selectable: false, evented: false })
      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas))
    })

    if (activePage.canvas_json) {
      canvas.loadFromJSON(activePage.canvas_json, () => {
        isLoading = false
        canvas.renderAll()
        // Estado inicial en el historial
        pushHistory(JSON.stringify(canvas.toJSON(['data'])))
      })
    } else {
      isLoading = false
      // Página vacía: estado inicial
      pushHistory(JSON.stringify(canvas.toJSON(['data'])))
    }

    const onSel = (e: any) => { setSelected(e.selected?.[0] ?? canvas.getActiveObject() ?? null); setSelectVersion((v) => v + 1) }
    canvas.on('selection:created', onSel)
    canvas.on('selection:updated', onSel)
    canvas.on('selection:cleared', (e: any) => {
      if (rightPanelRef.current && e?.e?.target && rightPanelRef.current.contains(e.e.target as Node)) return
      setSelected(null)
    })

    // Tecla Supr / Delete para eliminar el objeto seleccionado
    // Ctrl+Z = deshacer, Ctrl+Y / Ctrl+Shift+Z = rehacer
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const o = canvas.getActiveObject()
        if (o) { canvas.remove(o); setSelected(null); scheduleAutosave() }
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        if (historyIndexRef.current > 0) {
          historyIndexRef.current--
          updateUndoRedoState()
          applyHistory(historyRef.current[historyIndexRef.current])
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault()
        if (historyIndexRef.current < historyRef.current.length - 1) {
          historyIndexRef.current++
          updateUndoRedoState()
          applyHistory(historyRef.current[historyIndexRef.current])
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)

    // Autoguardado + historial en cada cambio del lienzo
    const onChange = () => {
      if (isLoading) return  // no guardar durante la carga inicial del JSON
      if (!isUndoRedoRef.current) pushHistory(JSON.stringify(canvas.toJSON(['data'])))
      scheduleAutosave()
    }
    canvas.on('object:modified', onChange)
    canvas.on('object:added', onChange)
    canvas.on('object:removed', onChange)
    canvas.on('text:changed', onChange)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (fabricRef.current) {
        clearTimeout(autosaveTimer.current)
        persistCanvas(activePage.id, fabricRef.current, false)
        fabricRef.current.dispose()
        fabricRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.id])

  // Guarda al cerrar/recargar la pestaña
  useEffect(() => {
    const handler = () => {
      if (fabricRef.current && pageIdRef.current) {
        try {
          const json = JSON.stringify(fabricRef.current.toJSON(['data']))
          api.pages.saveCanvas(pageIdRef.current, json).catch(() => {})
        } catch {}
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  function refreshSelected() { setSelectVersion((v) => v + 1) }

  // ── Elementos del canvas ──
  function addText(opts: any = {}) {
    const c = fabricRef.current; if (!c) return
    const t = new fabric.Textbox(opts.sample ?? 'Texto aquí', {
      left: 60, top: 60, width: 240, fontSize: 24, fill: '#111827',
      fontFamily: defaultFont, data: { kind: 'text' }, ...opts,
    })
    c.add(t); c.setActiveObject(t); c.requestRenderAll()
  }
  function addShape(kind: 'rect' | 'circle' | 'ellipse' | 'triangle' | 'line' | 'star') {
    const c = fabricRef.current; if (!c) return
    let o: any
    const common = { left: 100, top: 100, fill: 'rgba(79,70,229,0.85)', data: { kind: 'shape' } }
    if (kind === 'rect') o = new fabric.Rect({ ...common, width: 160, height: 90, rx: 8, ry: 8 })
    else if (kind === 'circle') o = new fabric.Circle({ ...common, radius: 60 })
    else if (kind === 'ellipse') o = new fabric.Ellipse({ ...common, rx: 90, ry: 55 })
    else if (kind === 'triangle') o = new fabric.Triangle({ ...common, width: 120, height: 100 })
    else if (kind === 'line') o = new fabric.Line([0, 0, 250, 0], { ...common, stroke: '#111827', strokeWidth: 3, fill: '' })
    else {
      // estrella de 5 puntas
      const pts: { x: number; y: number }[] = []
      const spikes = 5, outer = 60, inner = 26
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outer : inner
        const a = (Math.PI / spikes) * i - Math.PI / 2
        pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
      }
      o = new fabric.Polygon(pts, { ...common, fill: '#F59E0B' })
    }
    c.add(o); c.setActiveObject(o); c.requestRenderAll()
  }

  // Crea un botón con texto + estilo coherente y una acción por defecto (enlace)
  function addButton(preset: { label: string; variant: 'solid' | 'outline' | 'pill' }) {
    const c = fabricRef.current; if (!c) return
    const accent = '#4F46E5'
    const radius = preset.variant === 'pill' ? 23 : 8
    const isOutline = preset.variant === 'outline'
    const rect = new fabric.Rect({
      width: 180, height: 46,
      fill: isOutline ? 'rgba(255,255,255,0)' : accent,
      stroke: isOutline ? accent : '',
      strokeWidth: isOutline ? 2 : 0,
      rx: radius, ry: radius, originX: 'center', originY: 'center',
    })
    const txt = new fabric.Text(preset.label, {
      fill: isOutline ? accent : '#fff', fontSize: 15,
      fontFamily: 'Inter, sans-serif', fontWeight: 'bold',
      originX: 'center', originY: 'center',
    })
    const btn = new fabric.Group([rect, txt], {
      left: 110, top: 130,
      data: {
        kind: 'button',
        label: preset.label,
        bg: accent, textColor: isOutline ? accent : '#fff',
        variant: preset.variant,
        action: { type: 'link' as ActionType, url: 'https://' },
      },
    })
    c.add(btn); c.setActiveObject(btn); c.requestRenderAll()
    setActiveTool('buttons')
  }

  // Crea un botón con icono SVG de la biblioteca a la izquierda del texto.
  async function addButtonWithIcon(iconItem: any) {
    if (iconItem.locked) {
      alert(iconItem.upgrade_message || `Este recurso requiere plan superior.`)
      return
    }
    const c = fabricRef.current; if (!c) return
    const accent = '#4F46E5'
    try {
      const svgText = await api.svgRaw(iconItem.id)
      fabric.loadSVGFromString(svgText, (objects: any[], options: any) => {
        if (!objects?.length) return
        const icon = fabric.util.groupSVGElements(objects, options)
        icon.scaleToWidth(22)
        icon.set({ originX: 'center', originY: 'center', left: -68, top: 0 })
        const txt = new fabric.Text('Botón', {
          fill: '#fff', fontSize: 14, fontFamily: 'Inter, sans-serif', fontWeight: 'bold',
          originX: 'center', originY: 'center', left: 16, top: 0,
        })
        const bg = new fabric.Rect({
          width: 200, height: 46, fill: accent, rx: 8, ry: 8,
          originX: 'center', originY: 'center',
        })
        const btn = new fabric.Group([bg, icon, txt], {
          left: 110, top: 130,
          data: {
            kind: 'button', label: 'Botón', bg: accent, textColor: '#fff', variant: 'solid',
            svgIconId: iconItem.id,
            action: { type: 'link' as ActionType, url: 'https://' },
          },
        })
        c.add(btn); c.setActiveObject(btn); c.requestRenderAll()
        setActiveTool('buttons')
        scheduleAutosave()
      })
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo cargar el icono')
    }
  }

  // Sube una imagen al banco del proyecto. El usuario la inserta desde el banco.
  async function addImageElement(file: File) {
    setUploading(true)
    try {
      const up = await api.upload(file)
      if (!up.success) throw new Error('Upload falló')
      addToBank(up.data.url)
      // No insertamos en canvas — el usuario elige desde el banco del proyecto
    } finally { setUploading(false) }
  }

  // Inserta una imagen ya subida (del banco) como elemento editable, sin re-subir
  function addImageFromUrl(url: string) {
    const c = fabricRef.current; if (!c) return
    fabric.Image.fromURL(url, (img: any) => {
      // Escala la imagen para que no ocupe más del 60 % del ancho del canvas
      const maxW = c.getWidth() * 0.6
      if (img.width > maxW) img.scaleToWidth(maxW)
      img.set({ left: 60, top: 60, data: { kind: 'image', src: url } })
      c.add(img); c.setActiveObject(img); c.requestRenderAll()
      scheduleAutosave()
    })
  }
  async function handleImgInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    for (const file of files) await addImageElement(file)
  }

  function insertSvgAsElements(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const svgText = e.target?.result as string
      if (!svgText || !fabricRef.current) return
      fabric.loadSVGFromString(svgText, (objects: any[], options: any) => {
        if (!objects.length) return
        const group = fabric.util.groupSVGElements(objects, options)
        const c = fabricRef.current!
        const maxW = c.getWidth() * 0.7
        if ((group.width ?? 0) > maxW) group.scaleToWidth(maxW)
        group.set({ left: 50, top: 50, data: { kind: 'svg_group' } })
        c.add(group); c.setActiveObject(group); c.requestRenderAll()
        scheduleAutosave()
      })
    }
    reader.readAsText(file)
  }

  async function importPdfPages(file: File) {
    const pdfjsLib = (window as any).pdfjsLib
    if (!pdfjsLib) { alert('pdf.js no está disponible. Recargá la página.'); return }
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    setUploading(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const total = pdf.numPages
      for (let pageNum = 1; pageNum <= total; pageNum++) {
        const page = await pdf.getPage(pageNum)
        const viewport = page.getViewport({ scale: 1.5 })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport }).promise
        const blob = await new Promise<Blob>((res) =>
          canvas.toBlob((b) => res(b!), 'image/jpeg', 0.82),
        )
        const pngFile = new File([blob], `pdf-page-${pageNum}.jpg`, { type: 'image/jpeg' })
        const up = await api.upload(pngFile)
        if (!up.success) throw new Error(`Error al subir página ${pageNum}`)
        const res = await api.pages.add(id!, { image_url: up.data.url })
        setPages((prev) => {
          const next = [...prev, res.data]
          if (pageNum === total) setActivePage(res.data)
          return next
        })
      }
    } catch (err: any) {
      alert(err.message ?? 'Error al importar el PDF')
    } finally {
      setUploading(false)
    }
  }

  function addLinkZone() {
    const c = fabricRef.current; if (!c) return
    const zone = new fabric.Rect({
      left: 80, top: 80, width: 180, height: 100,
      fill: 'rgba(79,70,229,0.15)', stroke: '#4F46E5', strokeDashArray: [6, 4], strokeWidth: 2,
      data: { kind: 'linkzone', action: { type: 'link' as ActionType, url: 'https://' } },
    })
    c.add(zone); c.setActiveObject(zone); c.requestRenderAll()
  }

  // Agrega un punto activo animado. En el editor aparece como círculo con anillo;
  // en el visor se renderiza con animación CSS según el estilo elegido.
  function addHotspot(style: 'pulse' | 'blink' | 'ripple') {
    const c = fabricRef.current; if (!c) return
    const colorMap = { pulse: '#4F46E5', blink: '#ef4444', ripple: '#059669' }
    const color = colorMap[style]
    const ring = new fabric.Circle({ radius: 24, fill: `${color}33`, stroke: color, strokeWidth: 1.5, originX: 'center', originY: 'center' })
    const dot  = new fabric.Circle({ radius: 14, fill: color, originX: 'center', originY: 'center' })
    const group = new fabric.Group([ring, dot], {
      left: 120, top: 120,
      data: { kind: 'hotspot', hotspot: { style, color }, action: { type: 'link' as ActionType, url: 'https://' } },
    })
    c.add(group); c.setActiveObject(group); c.requestRenderAll()
    scheduleAutosave()
  }

  // Inserta un icono/figura de la galería como objeto vectorial editable
  function addIcon(svgInner: string) {
    const c = fabricRef.current; if (!c) return
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${svgInner}</svg>`
    fabric.loadSVGFromString(svg, (objects: any[], options: any) => {
      const obj = fabric.util.groupSVGElements(objects, options)
      obj.scaleToWidth(90)
      obj.set({ left: 100, top: 100, data: { kind: 'icon' } })
      c.add(obj); c.setActiveObject(obj); c.requestRenderAll()
      scheduleAutosave()
    })
  }

  // Carga (perezosa) la biblioteca SVG del módulo "Insertar en canvas".
  async function loadSvgLibrary() {
    if (svgLibLoaded) return
    try {
      const res = await api.svgLibrary('canvas_insert_svg')
      setSvgLib(res.data ?? [])
    } catch { /* silencioso: el panel muestra estado vacío */ }
    finally { setSvgLibLoaded(true) }
  }

  // Inserta un SVG de la biblioteca como VECTOR editable. Pide el contenido a la
  // API (no a r2.dev) para evitar CORS y validar el acceso por plan en el servidor.
  async function addSvgFromLibrary(item: any) {
    if (item.locked) {
      alert(item.upgrade_message || `Este recurso requiere el plan ${item.required_plan ?? 'superior'}.`)
      return
    }
    const c = fabricRef.current; if (!c) return
    try {
      const svgText = await api.svgRaw(item.id)
      fabric.loadSVGFromString(svgText, (objects: any[], options: any) => {
        if (!objects || !objects.length) { alert('No se pudo cargar el SVG.'); return }
        const obj = fabric.util.groupSVGElements(objects, options)
        obj.scaleToWidth(120)
        const syncId = svgSync ? crypto.randomUUID() : undefined
        obj.set({ left: 100, top: 100, data: { kind: 'svglib', svgResourceId: item.id, editable: item.editable, ...(syncId ? { syncGroupId: syncId } : {}) } })
        c.add(obj); c.setActiveObject(obj); c.requestRenderAll()
        scheduleAutosave()
      })
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo insertar el SVG')
    }
  }

  // Inserta un widget como un marcador (placeholder) en el lienzo. El visor
  // lo convierte en el componente real (mapa, formulario, video, etc.).
  function addWidget(w: { type: WidgetType; label: string; premium: boolean }) {
    const c = fabricRef.current; if (!c) return
    if (w.premium) { alert(`"${w.label}" es una función premium. Estará disponible al activar el plan correspondiente.`); return }
    const W = 230, H = 150
    const rect = new fabric.Rect({
      width: W, height: H, fill: 'rgba(79,70,229,0.06)', stroke: '#4F46E5',
      strokeDashArray: [6, 4], strokeWidth: 1.5, rx: 10, ry: 10, originX: 'center', originY: 'center',
    })
    const title = new fabric.Text(w.label, {
      fontSize: 15, fontFamily: 'Inter, sans-serif', fontWeight: 'bold', fill: '#4F46E5',
      originX: 'center', originY: 'center', top: -14,
    })
    const hint = new fabric.Text('Configura en el panel derecho →', {
      fontSize: 11, fontFamily: 'Inter, sans-serif', fill: '#6b7280',
      originX: 'center', originY: 'center', top: 14,
    })
    const defaultCfg = { ...(WIDGET_DEFAULTS[w.type] ?? {}) }
    if (w.type === 'units_table' && id) defaultCfg.publication_id = id
    const group = new fabric.Group([rect, title, hint], {
      left: 100, top: 120,
      data: { kind: 'widget', widget: { type: w.type, config: defaultCfg } },
    })
    c.add(group); c.setActiveObject(group); c.requestRenderAll()
    setActiveTool('widgets')
  }

  // ── Imágenes / páginas ──
  async function handleUpload(file: File) {
    setUploading(true)
    try {
      const up = await api.upload(file)
      if (!up.success) throw new Error('Upload falló')
      addToBank(up.data.url)
      const res = await api.pages.add(id!, { image_url: up.data.url })
      setPages((prev) => { const next = [...prev, res.data]; setActivePage(res.data); return next })
    } finally { setUploading(false) }
  }
  async function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    e.target.value = ''
    for (const file of files) await handleUpload(file)
  }
  async function handleDeletePage(pageId: string) {
    if (!confirm('¿Eliminar esta página?')) return
    await api.pages.delete(pageId)
    setPages((prev) => {
      const next = prev.filter((p) => p.id !== pageId)
      if (activePage?.id === pageId) setActivePage(next[0] ?? null)
      return next
    })
  }

  // Agrega una página en blanco (lienzo blanco) a la publicación actual.
  // Usa un SVG data-URL blanco como image_url para no requerir subida a R2.
  async function addBlankPage() {
    setUploading(true)
    try {
      const res = await api.pages.add(id!, { image_url: BLANK_PAGE_URL })
      setPages((prev) => { const next = [...prev, res.data]; setActivePage(res.data); return next })
    } catch (e: any) {
      alert(e.message ?? 'No se pudo agregar la página en blanco')
    } finally { setUploading(false) }
  }

  // Agrega las páginas de una plantilla a la publicación actual y recarga
  async function useTemplate(tpl: any) {
    if (!confirm(`¿Agregar las páginas de «${tpl.name}» a esta publicación?`)) return
    try {
      const r = await api.templates.apply(tpl.id, { publication_id: id! })
      const res = await api.publications.get(id!)
      const ps = res.data.pages ?? []
      setPages(ps)
      if (ps.length > 0) setActivePage(ps[ps.length - (r.data.pages_added || 1)] ?? ps[0])
    } catch (e: any) {
      alert(e.message ?? 'No se pudo aplicar la plantilla')
    }
  }

  // ── Drag & drop ──
  const dragRef = useRef<number | null>(null)
  function onDragStart(i: number) { dragRef.current = i }
  function onDropReorder(i: number) {
    if (dragRef.current === null || dragRef.current === i) return
    const next = [...pages]
    const [moved] = next.splice(dragRef.current, 1)
    next.splice(i, 0, moved)
    setPages(next)
    api.pages.reorder(id!, next.map((p) => p.id))
    dragRef.current = null
  }
  const [fileDrag, setFileDrag] = useState(false)
  function onFileDragOver(e: React.DragEvent) {
    if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); setFileDrag(true) }
  }
  function onFileDragLeave() { setFileDrag(false) }
  async function onFileDrop(e: React.DragEvent) {
    e.preventDefault(); setFileDrag(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type))
    for (const file of files) await handleUpload(file)
  }

  function applyBgColor(color: string, all = false) {
    setBgColor(color)
    const c = fabricRef.current
    if (c) { c.setBackgroundColor(color, c.renderAll.bind(c)); scheduleAutosave() }
    if (all) {
      // Aplica a todas las páginas (solo visual local; cada página lo persiste al abrirse)
      setPages((prev) => prev.map((p) => ({ ...p, bg_color: color })))
    }
  }

  async function handlePublish() {
    setPublishing(true)
    if (fabricRef.current && pageIdRef.current) await persistCanvas(pageIdRef.current, fabricRef.current, false)
    try {
      const res = await api.publications.publish(id!)
      setPub(res.data)
    } finally { setPublishing(false) }
  }

  function undo() {
    if (historyIndexRef.current <= 0) return
    historyIndexRef.current--
    updateUndoRedoState()
    applyHistory(historyRef.current[historyIndexRef.current])
  }

  function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return
    historyIndexRef.current++
    updateUndoRedoState()
    applyHistory(historyRef.current[historyIndexRef.current])
  }

  function deleteSelected() {
    const c = fabricRef.current
    const o = c?.getActiveObject()
    if (o) { c!.remove(o); setSelected(null) }
  }
  function duplicateSelected() {
    const c = fabricRef.current
    const o = c?.getActiveObject()
    if (!o) return
    o.clone((clone: any) => {
      clone.set({ left: (o.left ?? 0) + 20, top: (o.top ?? 0) + 20 })
      c!.add(clone); c!.setActiveObject(clone); c!.requestRenderAll()
    }, ['data'])
  }
  function bringToFront() { const o = fabricRef.current?.getActiveObject(); if (o) { o.bringToFront(); fabricRef.current.requestRenderAll(); scheduleAutosave() } }
  function sendToBack() { const o = fabricRef.current?.getActiveObject(); if (o) { o.sendToBack(); fabricRef.current.requestRenderAll(); scheduleAutosave() } }
  function bringForward() { const o = fabricRef.current?.getActiveObject(); if (o) { o.bringForward(); fabricRef.current.requestRenderAll(); scheduleAutosave() } }
  function sendBackward() { const o = fabricRef.current?.getActiveObject(); if (o) { o.sendBackwards(); fabricRef.current.requestRenderAll(); scheduleAutosave() } }

  // Agrupar la selección múltiple en un solo objeto / desagrupar un grupo.
  function groupSelected() {
    const c = fabricRef.current; const o = c?.getActiveObject(); if (!o) return
    if (o.type === 'activeSelection') { o.toGroup(); c.requestRenderAll(); setSelectVersion((v) => v + 1); scheduleAutosave() }
  }
  function ungroupSelected() {
    const c = fabricRef.current; const o = c?.getActiveObject(); if (!o) return
    if (o.type === 'group') { o.toActiveSelection(); c.requestRenderAll(); setSelectVersion((v) => v + 1); scheduleAutosave() }
  }

  // Bloquear / desbloquear: impide mover, escalar y rotar el objeto.
  function toggleLock() {
    const c = fabricRef.current; const o = c?.getActiveObject(); if (!o) return
    const locked = !o.lockMovementX
    o.set({
      lockMovementX: locked, lockMovementY: locked,
      lockScalingX: locked, lockScalingY: locked, lockRotation: locked,
      hasControls: !locked, editable: !locked,
    })
    o.data = { ...(o.data ?? {}), locked }
    c.discardActiveObject(); c.requestRenderAll(); setSelected(null); setSelectVersion((v) => v + 1); scheduleAutosave()
  }

  // Reemplazar la imagen seleccionada — abre el modal con banco + subir nueva.
  function replaceSelected() {
    const o = fabricRef.current?.getActiveObject()
    if (!o) return
    setReplaceModal(true)
  }

  // Reemplaza el objeto activo con una URL nueva, preservando posición y tamaño.
  function doReplaceWithUrl(url: string) {
    const c = fabricRef.current; const o = c?.getActiveObject(); if (!o) return
    const prevLeft = o.left, prevTop = o.top
    const prevScaleX = o.scaleX, prevScaleY = o.scaleY
    const prevAngle = o.angle ?? 0
    o.setSrc(url, () => {
      o.set({ left: prevLeft, top: prevTop, scaleX: prevScaleX, scaleY: prevScaleY, angle: prevAngle })
      o.data = { ...(o.data ?? {}), src: url }
      o.setCoords(); c.requestRenderAll(); scheduleAutosave()
    }, { crossOrigin: 'anonymous' })
    addToBank(url)
    setReplaceModal(false)
  }

  async function handleReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const up = await api.upload(file)
      if (!up.success) throw new Error('Upload falló')
      doReplaceWithUrl(up.data.url)
    } catch (err: any) { alert(err?.message ?? 'No se pudo reemplazar la imagen') }
    finally { setUploading(false) }
  }

  // Activar/desactivar sincronización multi-página de un SVG seleccionado.
  // Al activar: marca el objeto con un syncGroupId y crea una copia en cada
  // página que aún no la tenga. Las ediciones posteriores se propagan vía persistCanvas.
  // Al desactivar: quita la marca (las copias quedan independientes).
  async function handleSvgSyncToggle(enabled: boolean) {
    const c = fabricRef.current; const o = c?.getActiveObject(); if (!o) return
    const pageId = pageIdRef.current

    if (!enabled) {
      o.data = { ...(o.data ?? {}), syncGroupId: undefined }
      c.requestRenderAll(); scheduleAutosave(); setSelectVersion((v) => v + 1)
      return
    }

    const syncId = crypto.randomUUID()
    o.data = { ...(o.data ?? {}), syncGroupId: syncId }
    c.requestRenderAll()
    // Serializa el objeto marcado para clonarlo en las demás páginas.
    const serialized = o.toObject(['data'])
    setUploading(true)
    try {
      const otherPages = pagesRef.current.filter((p) => p.id !== pageId)
      for (const page of otherPages) {
        try {
          const pj = page.canvas_json
            ? (typeof page.canvas_json === 'string' ? JSON.parse(page.canvas_json) : page.canvas_json)
            : { version: '5.3.0', objects: [] }
          // Evita duplicar si ya existe una copia con el mismo syncGroupId
          const exists = (pj.objects ?? []).some((x: any) => x?.data?.syncGroupId === syncId)
          if (exists) continue
          pj.objects = [...(pj.objects ?? []), serialized]
          const newJson = JSON.stringify(pj)
          await api.pages.saveCanvas(page.id, newJson)
          setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, canvas_json: newJson } : p)))
        } catch { /* página con JSON inválido — se ignora */ }
      }
    } finally { setUploading(false) }
    scheduleAutosave(); setSelectVersion((v) => v + 1)
  }

  // Alinear el objeto respecto al lienzo o a la selección múltiple.
  function alignSelected(how: 'left' | 'centerH' | 'right' | 'top' | 'middle' | 'bottom') {
    const c = fabricRef.current; const o = c?.getActiveObject(); if (!o) return

    if (alignRef === 'selection' && o.type === 'activeSelection') {
      // Alinear objetos dentro de los límites de la selección múltiple.
      // Las posiciones de sub-objetos son relativas al centro de la selección activa.
      const selW = o.getScaledWidth?.() ?? o.width ?? 0
      const selH = o.getScaledHeight?.() ?? o.height ?? 0
      const objs: any[] = (o as any).getObjects()
      objs.forEach((obj: any) => {
        const bw = obj.getScaledWidth?.() ?? obj.width ?? 0
        const bh = obj.getScaledHeight?.() ?? obj.height ?? 0
        switch (how) {
          case 'left':    obj.set({ left: -selW / 2 }); break
          case 'centerH': obj.set({ left: -bw / 2 }); break
          case 'right':   obj.set({ left: selW / 2 - bw }); break
          case 'top':     obj.set({ top: -selH / 2 }); break
          case 'middle':  obj.set({ top: -bh / 2 }); break
          case 'bottom':  obj.set({ top: selH / 2 - bh }); break
        }
        obj.setCoords()
      })
      o.setCoords(); c.requestRenderAll()
    } else {
      const W = c.getWidth(), H = c.getHeight()
      const bw = o.getScaledWidth?.() ?? o.width ?? 0
      const bh = o.getScaledHeight?.() ?? o.height ?? 0
      const offX = (o.originX === 'center') ? bw / 2 : 0
      const offY = (o.originY === 'center') ? bh / 2 : 0
      switch (how) {
        case 'left':    o.set({ left: offX }); break
        case 'centerH': o.set({ left: (W - bw) / 2 + offX }); break
        case 'right':   o.set({ left: W - bw + offX }); break
        case 'top':     o.set({ top: offY }); break
        case 'middle':  o.set({ top: (H - bh) / 2 + offY }); break
        case 'bottom':  o.set({ top: H - bh + offY }); break
      }
      o.setCoords(); c.requestRenderAll()
    }
    setSelectVersion((v) => v + 1); scheduleAutosave()
  }

  // Menú contextual (clic derecho) sobre el lienzo.
  function onCanvasContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    const c = fabricRef.current; if (!c) return
    const target = c.findTarget?.(e.nativeEvent, false)
    if (target) { c.setActiveObject(target); c.requestRenderAll(); setSelected(target); setSelectVersion((v) => v + 1) }
    else { c.discardActiveObject(); c.requestRenderAll(); setSelected(null) }
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  function selectTool(key: ToolKey) {
    if (key === activeTool && panelOpen) { setPanelOpen(false); return }
    setActiveTool(key); setPanelOpen(true)
    if (key === 'svglib' || key === 'buttons') loadSvgLibrary()
  }

  const activePageIndex = activePage ? pages.findIndex((p) => p.id === activePage.id) : -1
  const filteredTpls = templates.filter((t) => t.name?.toLowerCase().includes(tplQuery.toLowerCase()))

  if (!pub) return <div style={s.loading}>Cargando editor...</div>

  return (
    <div style={s.root}>
      {/* ── Barra superior ── */}
      <div style={s.topBar}>
        <div style={s.topLeft}>
          <Link to="/publications" style={s.backLink}>&#8592; Mis flipbooks</Link>
          <span style={s.pubTitle}>{pub.title}</span>
        </div>
        <div style={s.topCenter}>
          {activePage && pages.length > 0 && (
            <span style={s.breadcrumb}>{activePageIndex + 1} / {pages.length}</span>
          )}
        </div>
        <div style={s.topRight}>
          <span style={s.saveInd}>
            {saveState === 'saving' ? '⟳ Guardando…' : saveState === 'saved' ? '✓ Guardado' : 'Autoguardado activo'}
          </span>
          <Link to={`/publications/${id}/preview`}>
            <button style={s.btnOutlineWhite}>Vista previa</button>
          </Link>
          <button
            style={{ ...s.btnPublish, background: pub.status === 'published' ? '#16a34a' : '#4f46e5' }}
            onClick={handlePublish}
            disabled={publishing}
          >
            {publishing ? 'Publicando...' : pub.status === 'published' ? '✓ Publicado' : 'Publicar'}
          </button>
        </div>
      </div>

      <div style={s.body}>
        {/* ── Icon rail ── */}
        <nav style={s.rail}>
          {RAIL.map((t) => {
            const active = activeTool === t.key && panelOpen
            return (
              <button
                key={t.key}
                onClick={() => selectTool(t.key)}
                title={t.label}
                style={{ ...s.railBtn, ...(active ? s.railBtnActive : {}) }}
              >
                <Icon name={t.key} />
                <span style={s.railLabel}>{t.label}</span>
              </button>
            )
          })}
        </nav>

        {/* ── Panel contextual ── */}
        {panelOpen && (
          <aside style={s.panel}>
            <ContextPanel
              tool={activeTool}
              pages={pages}
              activePage={activePage}
              setActivePage={setActivePage}
              onDragStart={onDragStart}
              onDropReorder={onDropReorder}
              handleDeletePage={handleDeletePage}
              addBlankPage={addBlankPage}
              fileInputRef={fileInputRef}
              uploading={uploading}
              fileDrag={fileDrag}
              onFileDragOver={onFileDragOver}
              onFileDragLeave={onFileDragLeave}
              onFileDrop={onFileDrop}
              templates={filteredTpls}
              useTemplate={useTemplate}
              tplQuery={tplQuery}
              setTplQuery={setTplQuery}
              addText={addText}
              addShape={addShape}
              addButton={addButton}
              addLinkZone={addLinkZone}
              imgInputRef={imgInputRef}
              uploadingImg={uploading}
              addIcon={addIcon}
              addHotspot={addHotspot}
              addWidget={addWidget}
              svgLib={svgLib}
              svgLibLoaded={svgLibLoaded}
              svgLibQuery={svgLibQuery}
              setSvgLibQuery={setSvgLibQuery}
              svgLibFamily={svgLibFamily}
              setSvgLibFamily={setSvgLibFamily}
              addSvgFromLibrary={addSvgFromLibrary}
              svgSync={svgSync}
              setSvgSync={setSvgSync}
              addButtonWithIcon={addButtonWithIcon}
              defaultFont={defaultFont}
              setDefaultFont={setDefaultFont}
              imageBank={imageBank}
              addImageFromUrl={addImageFromUrl}
              deleteFromBank={deleteFromBank}
              svgInputRef={svgInputRef}
              pdfPagesInputRef={pdfPagesInputRef}
            />
          </aside>
        )}

        {/* ── Canvas central ── */}
        <main style={s.center}>
          <div style={s.toolbar}>
            <ToolbarBtn icon="undo"      title="Deshacer (Ctrl+Z)" onClick={undo}             disabled={!canUndo} />
            <ToolbarBtn icon="redo"      title="Rehacer (Ctrl+Y)"  onClick={redo}             disabled={!canRedo} />
            <div style={s.toolSep} />
            <ToolbarBtn icon="duplicate" title="Duplicar"          onClick={duplicateSelected} disabled={!selected} />
            <ToolbarBtn icon="trash"     title="Eliminar"          onClick={deleteSelected}   disabled={!selected} />
            <div style={s.toolSep} />
            <ToolbarBtn icon="group"     title="Agrupar"           onClick={groupSelected}    disabled={selected?.type !== 'activeSelection'} />
            <ToolbarBtn icon="ungroup"   title="Desagrupar"        onClick={ungroupSelected}  disabled={selected?.type !== 'group'} />
            <div style={s.toolSep} />
            <ToolbarBtn icon="front"     title="Traer al frente"   onClick={bringToFront}     disabled={!selected} />
            <ToolbarBtn icon="forward"   title="Adelantar"         onClick={bringForward}     disabled={!selected} />
            <ToolbarBtn icon="backward"  title="Atrasar"           onClick={sendBackward}     disabled={!selected} />
            <ToolbarBtn icon="back"      title="Enviar al fondo"   onClick={sendToBack}       disabled={!selected} />
            <div style={s.toolSep} />
            <ToolbarBtn icon={selected?.data?.locked ? 'unlock' : 'lock'} title={selected?.data?.locked ? 'Desbloquear' : 'Bloquear'} onClick={toggleLock} disabled={!selected} />
            <ToolbarBtn icon="replace"   title="Reemplazar imagen" onClick={replaceSelected}  disabled={!selected} />
            <div style={s.toolSep} />
            <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: 7, overflow: 'hidden', fontSize: 10, fontWeight: 600 }}>
              <button
                style={{ padding: '0 7px', height: 30, border: 'none', cursor: 'pointer', background: alignRef === 'canvas' ? '#4F46E5' : '#fff', color: alignRef === 'canvas' ? '#fff' : '#6b7280', transition: 'background .15s' }}
                title="Alinear respecto al lienzo"
                onClick={() => setAlignRef('canvas')}
              >Lienzo</button>
              <button
                style={{ padding: '0 7px', height: 30, border: 'none', borderLeft: '1px solid #e5e7eb', cursor: 'pointer', background: alignRef === 'selection' ? '#4F46E5' : '#fff', color: alignRef === 'selection' ? '#fff' : '#6b7280', transition: 'background .15s' }}
                title="Alinear respecto a la selección múltiple"
                onClick={() => setAlignRef('selection')}
              >Objeto</button>
            </div>
            <ToolbarBtn icon="alignLeft"    title="Alinear a la izquierda" onClick={() => alignSelected('left')}    disabled={!selected} />
            <ToolbarBtn icon="alignCenterH" title="Centrar horizontal"     onClick={() => alignSelected('centerH')} disabled={!selected} />
            <ToolbarBtn icon="alignRight"   title="Alinear a la derecha"   onClick={() => alignSelected('right')}   disabled={!selected} />
            <ToolbarBtn icon="alignTop"     title="Alinear arriba"         onClick={() => alignSelected('top')}     disabled={!selected} />
            <ToolbarBtn icon="alignMiddle"  title="Centrar vertical"       onClick={() => alignSelected('middle')}  disabled={!selected} />
            <ToolbarBtn icon="alignBottom"  title="Alinear abajo"          onClick={() => alignSelected('bottom')}  disabled={!selected} />
            <div style={{ flex: 1 }} />
            <div style={s.zoomGroup}>
              {[50, 75, 100, 125].map((z) => (
                <button key={z} style={{ ...s.zoomBtn, ...(zoom === z ? s.zoomActive : {}) }} onClick={() => setZoom(z)}>
                  {z}%
                </button>
              ))}
            </div>
          </div>

          <div style={s.canvasWrap}>
            {activePage ? (
              <div
                style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
                onContextMenu={onCanvasContextMenu}
              >
                <canvas ref={canvasRef} />
              </div>
            ) : (
              <div
                style={{ ...s.canvasEmpty, ...(fileDrag ? { background: 'rgba(79,70,229,0.08)' } : {}) }}
                onDragOver={onFileDragOver} onDragLeave={onFileDragLeave} onDrop={onFileDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div style={{ marginBottom: 16, opacity: 0.35, color: '#374151' }}><Icon name="image" size={52} /></div>
                <p style={{ color: '#374151', fontSize: 15, fontWeight: 600, textAlign: 'center', maxWidth: 280 }}>
                  Arrastra imágenes aquí o haz clic para subir
                </p>
                <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 8 }}>JPG, PNG o WEBP · múltiples archivos</p>
              </div>
            )}
          </div>

          {/* ── Navegador de páginas ── */}
          {pages.length > 0 && (
            <div style={s.pageNav}>
              <button
                style={{ ...s.pageNavBtn, opacity: activePageIndex <= 0 ? 0.35 : 1 }}
                disabled={activePageIndex <= 0}
                title="Primera página"
                onClick={() => setActivePage(pages[0])}
              >⟸</button>
              <button
                style={{ ...s.pageNavBtn, opacity: activePageIndex <= 0 ? 0.35 : 1 }}
                disabled={activePageIndex <= 0}
                title="Página anterior"
                onClick={() => activePageIndex > 0 && setActivePage(pages[activePageIndex - 1])}
              >◀</button>
              <span style={s.pageNavInfo}>
                Pág {activePageIndex >= 0 ? activePageIndex + 1 : '—'} / {pages.length}
              </span>
              <button
                style={{ ...s.pageNavBtn, opacity: activePageIndex >= pages.length - 1 ? 0.35 : 1 }}
                disabled={activePageIndex >= pages.length - 1}
                title="Página siguiente"
                onClick={() => activePageIndex < pages.length - 1 && setActivePage(pages[activePageIndex + 1])}
              >▶</button>
              <button
                style={{ ...s.pageNavBtn, opacity: activePageIndex >= pages.length - 1 ? 0.35 : 1 }}
                disabled={activePageIndex >= pages.length - 1}
                title="Última página"
                onClick={() => setActivePage(pages[pages.length - 1])}
              >⟹</button>
            </div>
          )}
        </main>

        {/* ── Panel derecho: propiedades o configuración de página ── */}
        <aside ref={rightPanelRef} style={s.right}>
          {selected ? (
            <PropsPanel
              key={selectVersion}
              obj={selected}
              canvas={fabricRef.current}
              pages={pages}
              onChange={() => { scheduleAutosave() }}
              onSyncToggle={handleSvgSyncToggle}
            />
          ) : (
            <PageConfig bgColor={bgColor} applyBgColor={applyBgColor} />
          )}
        </aside>
      </div>

      {/* Input para insertar imagen como elemento editable del canvas */}
      <input
        ref={imgInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={handleImgInputChange}
      />
      {/* Input para agregar páginas nuevas al flipbook */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
      <input
        ref={svgInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) insertSvgAsElements(f)
        }}
      />
      <input
        ref={pdfPagesInputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) importPdfPages(f)
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml,image/gif"
        style={{ display: 'none' }}
        onChange={handleReplaceFile}
      />

      {/* ── Modal de reemplazo de imagen ── */}
      {replaceModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setReplaceModal(false)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 540, maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Reemplazar imagen</h3>
              <button style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280' }} onClick={() => setReplaceModal(false)}>✕</button>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>La imagen sustituida conservará la misma posición y tamaño exactos.</p>
            <button
              style={{ background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }}
              onClick={() => replaceInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Subiendo…' : '📤 Subir nueva imagen'}
            </button>
            <div style={{ fontWeight: 700, fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
              Banco del proyecto ({imageBank.length} imágenes)
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {imageBank.length === 0 ? (
                <p style={{ color: '#9ca3af', fontSize: 13 }}>Aún no hay imágenes en el banco. Subí algunas desde el panel Imagen.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {imageBank.map((url) => (
                    <button
                      key={url}
                      title="Usar esta imagen"
                      style={{ padding: 0, border: '2px solid transparent', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: '#f9fafb', aspectRatio: '1' }}
                      onClick={() => doReplaceWithUrl(url)}
                    >
                      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Menú contextual (clic derecho) ── */}
      {ctxMenu && (
        <>
          <div style={s.ctxOverlay} onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }} />
          <div style={{ ...s.ctxMenu, left: ctxMenu.x, top: ctxMenu.y }}>
            {selected ? (
              <>
                <CtxItem icon="duplicate" label="Duplicar"        onClick={() => { duplicateSelected(); setCtxMenu(null) }} />
                <CtxItem icon="trash"     label="Eliminar"        onClick={() => { deleteSelected(); setCtxMenu(null) }} />
                <div style={s.ctxSep} />
                {selected?.type === 'activeSelection' && <CtxItem icon="group" label="Agrupar" onClick={() => { groupSelected(); setCtxMenu(null) }} />}
                {selected?.type === 'group' && <CtxItem icon="ungroup" label="Desagrupar" onClick={() => { ungroupSelected(); setCtxMenu(null) }} />}
                <CtxItem icon="front"    label="Traer al frente" onClick={() => { bringToFront(); setCtxMenu(null) }} />
                <CtxItem icon="forward"  label="Adelantar"       onClick={() => { bringForward(); setCtxMenu(null) }} />
                <CtxItem icon="backward" label="Atrasar"         onClick={() => { sendBackward(); setCtxMenu(null) }} />
                <CtxItem icon="back"     label="Enviar al fondo" onClick={() => { sendToBack(); setCtxMenu(null) }} />
                <div style={s.ctxSep} />
                <CtxItem icon={selected?.data?.locked ? 'unlock' : 'lock'} label={selected?.data?.locked ? 'Desbloquear' : 'Bloquear'} onClick={() => { toggleLock(); setCtxMenu(null) }} />
                {(selected?.data?.kind === 'image' || selected?.type === 'image') &&
                  <CtxItem icon="replace" label="Reemplazar imagen" onClick={() => { setCtxMenu(null); replaceSelected() }} />}
                <div style={s.ctxSep} />
                <CtxItem icon="alignLeft"    label="Alinear izquierda" onClick={() => { alignSelected('left'); setCtxMenu(null) }} />
                <CtxItem icon="alignCenterH" label="Centrar horizontal" onClick={() => { alignSelected('centerH'); setCtxMenu(null) }} />
                <CtxItem icon="alignRight"   label="Alinear derecha"   onClick={() => { alignSelected('right'); setCtxMenu(null) }} />
                <CtxItem icon="alignTop"     label="Alinear arriba"    onClick={() => { alignSelected('top'); setCtxMenu(null) }} />
                <CtxItem icon="alignMiddle"  label="Centrar vertical"  onClick={() => { alignSelected('middle'); setCtxMenu(null) }} />
                <CtxItem icon="alignBottom"  label="Alinear abajo"     onClick={() => { alignSelected('bottom'); setCtxMenu(null) }} />
              </>
            ) : (
              <div style={{ padding: '8px 12px', color: '#9ca3af', fontSize: 12 }}>Selecciona un elemento</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function CtxItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      style={s.ctxItem}
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <Icon name={icon} size={15} />
      <span>{label}</span>
    </button>
  )
}

function ToolbarBtn({ icon, title, onClick, disabled }: { icon: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button style={{ ...s.toolBtn, opacity: disabled ? 0.35 : 1, cursor: disabled ? 'default' : 'pointer' }} title={title} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={18} />
    </button>
  )
}

// ─── Panel contextual según herramienta ──────────────────────────────────────
function ContextPanel(p: any) {
  switch (p.tool) {
    case 'pages':
      return (
        <>
          <PanelTitle title="Páginas" count={p.pages.length} />
          <div
            style={{ ...cp.thumbList, ...(p.fileDrag ? { outline: '2px dashed #818cf8' } : {}) }}
            onDragOver={p.onFileDragOver} onDragLeave={p.onFileDragLeave} onDrop={p.onFileDrop}
          >
            {p.pages.map((page: any, i: number) => (
              <div
                key={page.id}
                draggable
                onDragStart={() => p.onDragStart(i)}
                onDragOver={(e: React.DragEvent) => e.preventDefault()}
                onDrop={() => p.onDropReorder(i)}
                onClick={() => p.setActivePage(page)}
                style={{ ...cp.thumbItem, borderColor: p.activePage?.id === page.id ? '#4F46E5' : 'transparent' }}
              >
                <img src={page.image_url} alt={`p${i + 1}`} style={cp.thumbImg} />
                <div style={cp.thumbNum}>{i + 1}</div>
                <button style={cp.thumbDel} onClick={(e: React.MouseEvent) => { e.stopPropagation(); p.handleDeletePage(page.id) }}>✕</button>
              </div>
            ))}
          </div>
          <button style={cp.primaryBtn} onClick={() => p.fileInputRef.current?.click()} disabled={p.uploading}>
            {p.uploading ? 'Subiendo...' : '+ Agregar páginas (imagen)'}
          </button>
          <button style={cp.secondaryBtn} onClick={p.addBlankPage} disabled={p.uploading}>
            + Página en blanco
          </button>
          <button style={cp.secondaryBtn} onClick={() => p.pdfPagesInputRef?.current?.click()} disabled={p.uploading}>
            📄 Importar PDF como páginas
          </button>
        </>
      )

    case 'templates':
      return (
        <>
          <PanelTitle title="Plantillas" />
          <input
            placeholder="Buscar plantilla..."
            value={p.tplQuery}
            onChange={(e: any) => p.setTplQuery(e.target.value)}
            style={cp.search}
          />
          {p.templates.length === 0 ? (
            <p style={cp.empty}>No hay plantillas disponibles todavía.</p>
          ) : (
            <div style={cp.tplGrid}>
              {p.templates.map((t: any) => (
                <div
                  key={t.id}
                  style={{ ...cp.tplCard, ...(t.locked ? cp.tplCardLocked : {}) }}
                  title={t.locked ? `${t.name} — Requiere plan superior` : `Agregar páginas de ${t.name}`}
                  onClick={t.locked
                    ? () => alert('Esta plantilla requiere un plan superior. Actualiza tu plan para acceder.')
                    : () => p.useTemplate(t)}
                >
                  {t.cover_url
                    ? <img src={t.cover_url} alt={t.name} style={{ ...cp.tplImg, ...(t.locked ? { filter: 'grayscale(60%) opacity(0.7)' } : {}) }} />
                    : <div style={cp.tplPlaceholder}><Icon name="templates" size={26} /></div>}
                  {t.locked && (
                    <div style={cp.tplLockOverlay}>🔒</div>
                  )}
                  <div style={cp.tplName}>{t.name}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )

    case 'text':
      return (
        <>
          <PanelTitle title="Texto" />
          <div style={cp.stack}>
            {TEXT_PRESETS.map((preset) => (
              <button key={preset.label} style={cp.listBtn} onClick={() => p.addText(preset.opts)}>
                <span style={{ fontSize: Math.min(preset.opts.fontSize as number, 22), fontWeight: preset.opts.fontWeight as any, fontFamily: p.defaultFont }}>Aa</span>
                {preset.label}
              </button>
            ))}
          </div>

          <div style={cp.sectionLabel}>Tipografías</div>
          <p style={cp.hint}>Elegí una fuente y luego agregá texto, o seleccioná un texto y cambiá su tipografía aquí.</p>
          <div style={cp.fontList}>
            {FONTS.map((f) => (
              <button
                key={f.name}
                onClick={() => p.setDefaultFont(f.family)}
                style={{ ...cp.fontBtn, ...(p.defaultFont === f.family ? cp.fontBtnActive : {}) }}
              >
                <span style={{ fontFamily: f.family, fontSize: 22 }}>Aa</span>
                <span style={cp.fontName}>{f.name}</span>
              </button>
            ))}
          </div>
        </>
      )

    case 'image':
    case 'uploads':
      return (
        <>
          <PanelTitle title={p.tool === 'image' ? 'Imagen' : 'Cargas'} />
          {/* Subir imagen al banco del proyecto */}
          <button style={cp.primaryBtn} onClick={() => p.imgInputRef.current?.click()} disabled={p.uploadingImg}>
            {p.uploadingImg ? 'Subiendo al banco…' : '📤 Subir imagen al banco'}
          </button>
          <p style={{ fontSize: 11, color: '#9ca3af', margin: '-4px 0 6px' }}>La imagen se guarda en "Mis imágenes". Luego hacé clic en ella para insertarla en la página.</p>
          <p style={cp.hint}>La imagen se agrega como elemento editable sobre la página actual. Podés moverla, escalarla y asignarle una acción.</p>
          <div style={{ height: 1, background: '#f3f4f6', margin: '14px 0' }} />
          <button style={cp.primaryBtn} onClick={() => p.svgInputRef?.current?.click()} disabled={p.uploadingImg}>
            🎨 Insertar SVG editable
          </button>
          <p style={cp.hint}>Importá un archivo .svg — cada forma se convierte en un elemento independiente que podés mover, colorear y escalar.</p>
          <div style={{ height: 1, background: '#f3f4f6', margin: '14px 0' }} />
          {/* Agregar como nueva página del flipbook */}
          <button style={{ ...cp.primaryBtn, background: '#64748b' }} onClick={() => p.fileInputRef.current?.click()} disabled={p.uploading}>
            {p.uploading ? 'Subiendo...' : '+ Agregar como nueva página'}
          </button>
          <p style={cp.hint}>Agrega la imagen como página nueva del flipbook (igual que en el panel Páginas).</p>

          {/* Banco de imágenes del proyecto: reutilizar sin volver a subir */}
          <div style={cp.sectionLabel}>Mis imágenes ({p.imageBank?.length ?? 0})</div>
          {(!p.imageBank || p.imageBank.length === 0) ? (
            <p style={cp.empty}>Las imágenes que subas en este catálogo aparecerán aquí para reutilizarlas.</p>
          ) : (
            <>
              <p style={cp.hint}>Hacé clic en una imagen para insertarla en la página actual sin volver a subirla.</p>
              <div style={cp.bankGrid}>
                {p.imageBank.map((url: string) => (
                  <div key={url} style={cp.bankItemWrap}>
                    <button style={cp.bankItem} title="Insertar en la página" onClick={() => p.addImageFromUrl(url)}>
                      <img src={url} alt="" style={cp.bankImg} loading="lazy" />
                    </button>
                    <button
                      style={cp.bankDelBtn}
                      title="Eliminar imagen"
                      onClick={(e) => { e.stopPropagation(); p.deleteFromBank(url) }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )

    case 'shapes':
      return (
        <>
          <PanelTitle title="Formas" />
          <div style={cp.shapeGrid}>
            <ShapeBtn icon="rect"     label="Rectángulo" onClick={() => p.addShape('rect')} />
            <ShapeBtn icon="circle"   label="Círculo"    onClick={() => p.addShape('circle')} />
            <ShapeBtn icon="circle"   label="Elipse"     onClick={() => p.addShape('ellipse')} />
            <ShapeBtn icon="triangle" label="Triángulo"  onClick={() => p.addShape('triangle')} />
            <ShapeBtn icon="line"     label="Línea"      onClick={() => p.addShape('line')} />
            <ShapeBtn icon="star"     label="Estrella"   onClick={() => p.addShape('star')} />
          </div>
        </>
      )

    case 'buttons': {
      // Acordeón por familia — cada familia empieza contraída.
      // "useState en un case" no se puede directamente; usamos un componente interno.
      const BtnIconAccordion = () => {
        const [openFam, setOpenFam] = React.useState<string | null>(null)
        const all = p.svgLib as any[]
        // Agrupar por familia (igual que en Biblioteca)
        const groups: { name: string; items: any[] }[] = []
        all.forEach((it) => {
          const fname = it.family_name || 'Sin familia'
          let g = groups.find((x) => x.name === fname)
          if (!g) { g = { name: fname, items: [] }; groups.push(g) }
          g.items.push(it)
        })
        groups.sort((a, b) => a.name === 'Sin familia' ? 1 : b.name === 'Sin familia' ? -1 : a.name.localeCompare(b.name))
        if (groups.length === 0) return null
        return (
          <>
            <div style={cp.sectionLabel}>Botón con ícono SVG</div>
            <p style={cp.hint}>Selecciona una familia, elige un ícono y se creará un botón listo para configurar.</p>
            {groups.map((g) => (
              <div key={g.name} style={{ marginBottom: 4 }}>
                <button
                  style={{ width: '100%', textAlign: 'left', background: openFam === g.name ? '#f0f0ff' : '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 7, padding: '7px 10px', fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => setOpenFam(openFam === g.name ? null : g.name)}
                >
                  <span>{g.name}</span>
                  <span style={{ fontSize: 10, color: '#9ca3af' }}>{openFam === g.name ? '▲' : '▼'} {g.items.length}</span>
                </button>
                {openFam === g.name && (
                  <div style={{ ...cp.iconGrid, marginTop: 6, marginBottom: 6 }}>
                    {g.items.map((it) => (
                      <button
                        key={it.id}
                        title={it.locked ? (it.upgrade_message || `Requiere plan ${it.required_plan ?? 'superior'}`) : it.name}
                        style={{ ...cp.iconBtn, position: 'relative', opacity: it.locked ? 0.55 : 1 }}
                        onClick={() => p.addButtonWithIcon(it)}
                      >
                        {it.svg_url
                          ? <img src={it.svg_url} alt={it.name} style={{ width: 28, height: 28, objectFit: 'contain' }} loading="lazy" />
                          : <span style={{ fontSize: 20 }}>🔒</span>}
                        <span style={cp.iconName}>{it.name}</span>
                        {it.locked && <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 11 }}>🔒</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )
      }
      return (
        <>
          <PanelTitle title="Botones" />
          <p style={cp.hint}>Agrega un botón y configura su acción y estilo en el panel derecho.</p>
          <div style={cp.btnList}>
            {BUTTON_PRESETS.map((b) => (
              <button
                key={b.label}
                style={{
                  ...cp.previewBtn,
                  ...(b.variant === 'outline'
                    ? { background: '#fff', color: '#4F46E5', border: '2px solid #4F46E5' }
                    : { background: '#4F46E5', color: '#fff', border: 'none' }),
                  borderRadius: b.variant === 'pill' ? 23 : 8,
                }}
                onClick={() => p.addButton(b)}
              >
                {b.label}
              </button>
            ))}
          </div>
          <BtnIconAccordion />
        </>
      )
    }

    case 'elements':
      return (
        <>
          <PanelTitle title="Elementos" />
          <p style={cp.hint}>Iconos, figuras y señales para catálogos, menús y portafolios. Hacé clic para agregarlos al diseño.</p>
          {ICON_LIBRARY.map((cat) => (
            <div key={cat.category}>
              <div style={cp.sectionLabel}>{cat.category}</div>
              <div style={cp.iconGrid}>
                {cat.items.map((it) => (
                  <button key={it.label} title={it.label} style={cp.iconBtn} onClick={() => p.addIcon(it.svg)}>
                    <svg width={26} height={26} viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: it.svg }} />
                    <span style={cp.iconName}>{it.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div style={cp.sectionLabel}>Puntos activos animados</div>
          <p style={cp.hint}>Indicadores que parpadean/pulsan en la publicación para llamar la atención del visitante. Configurá su acción en el panel derecho.</p>
          <div style={cp.iconGrid}>
            {([
              { style: 'pulse',  label: 'Pulso',     color: '#4F46E5' },
              { style: 'blink',  label: 'Parpadeo',  color: '#ef4444' },
              { style: 'ripple', label: 'Onda',       color: '#059669' },
            ] as const).map((h) => (
              <button key={h.style} style={cp.iconBtn} onClick={() => p.addHotspot(h.style)}>
                <span style={{ width: 24, height: 24, borderRadius: '50%', background: h.color, display: 'inline-block', boxShadow: `0 0 0 5px ${h.color}44` }} />
                <span style={cp.iconName}>{h.label}</span>
              </button>
            ))}
          </div>
        </>
      )

    case 'svglib': {
      const all = p.svgLib as any[]
      // Lista de familias presentes (únicas), ordenadas alfabéticamente.
      const familyNames = Array.from(
        new Set(all.map((it) => it.family_name).filter(Boolean))
      ).sort() as string[]
      const hasNoFamily = all.some((it) => !it.family_name)

      const q = (p.svgLibQuery || '').toLowerCase()
      const filtered = all.filter((it) => {
        if (q && !it.name?.toLowerCase().includes(q) &&
            !(it.tags ?? []).some((t: string) => t.toLowerCase().includes(q))) return false
        if (p.svgLibFamily) {
          if (p.svgLibFamily === '__none__') return !it.family_name
          return it.family_name === p.svgLibFamily
        }
        return true
      })

      // Agrupar por familia para mostrar encabezados de sección.
      const groups: { name: string; items: any[] }[] = []
      const pushTo = (name: string, it: any) => {
        let g = groups.find((x) => x.name === name)
        if (!g) { g = { name, items: [] }; groups.push(g) }
        g.items.push(it)
      }
      filtered.forEach((it) => pushTo(it.family_name || 'Sin familia', it))
      groups.sort((a, b) => a.name === 'Sin familia' ? 1 : b.name === 'Sin familia' ? -1 : a.name.localeCompare(b.name))

      return (
        <>
          <PanelTitle title="Biblioteca SVG" />
          <p style={cp.hint}>Íconos vectoriales editables. Hacé clic para insertarlos en la página. Los marcados con 🔒 requieren un plan superior. Al seleccionar un SVG en el canvas, activa "Sincronizar en páginas" desde el panel derecho.</p>
          <input
            style={cp.search}
            placeholder="Buscar por nombre o etiqueta…"
            value={p.svgLibQuery}
            onChange={(e) => p.setSvgLibQuery(e.target.value)}
          />
          {familyNames.length > 0 && (
            <select
              style={{ ...cp.search, marginTop: -4 }}
              value={p.svgLibFamily}
              onChange={(e) => p.setSvgLibFamily(e.target.value)}
            >
              <option value="">Todas las familias</option>
              {familyNames.map((fn) => <option key={fn} value={fn}>{fn}</option>)}
              {hasNoFamily && <option value="__none__">Sin familia</option>}
            </select>
          )}
          {!p.svgLibLoaded ? (
            <p style={cp.hint}>Cargando biblioteca…</p>
          ) : filtered.length === 0 ? (
            <p style={cp.hint}>No hay íconos para este filtro. El administrador puede agregar más desde el panel “Biblioteca SVG”.</p>
          ) : (
            groups.map((g) => (
              <div key={g.name}>
                <div style={cp.sectionLabel}>{g.name}</div>
                <div style={cp.iconGrid}>
                  {g.items.map((it) => (
                    <button
                      key={it.id}
                      title={it.locked ? (it.upgrade_message || `Requiere plan ${it.required_plan ?? 'superior'}`) : it.name}
                      style={{ ...cp.iconBtn, position: 'relative', opacity: it.locked ? 0.55 : 1 }}
                      onClick={() => p.addSvgFromLibrary(it)}
                    >
                      {it.svg_url
                        ? <img src={it.svg_url} alt={it.name} style={{ width: 30, height: 30, objectFit: 'contain' }} loading="lazy" />
                        : <span style={{ fontSize: 22 }}>🔒</span>}
                      <span style={cp.iconName}>{it.name}</span>
                      {it.locked && <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 11 }}>🔒</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )
    }

    case 'link':
      return (
        <>
          <PanelTitle title="Enlace" />
          <button style={cp.primaryBtn} onClick={p.addLinkZone}>+ Zona clicable</button>
          <p style={cp.hint}>Crea un área transparente sobre la página. Selecciónala y define su acción en el panel derecho (enlace, ir a página, llamar, etc.).</p>
        </>
      )

    case 'widgets':
      return (
        <>
          <PanelTitle title="Widgets" />
          <p style={cp.hint}>Elementos interactivos. Se agregan al diseño y se configuran en el panel derecho; el visor los muestra en vivo.</p>
          <div style={cp.shapeGrid}>
            {WIDGETS.map((w) => (
              <button
                key={w.type}
                style={{ ...cp.widgetCard, opacity: w.premium ? 0.6 : 1, cursor: 'pointer' }}
                title={w.premium ? 'Función premium' : w.label}
                onClick={() => p.addWidget(w)}
              >
                <Icon name={w.icon} size={22} />
                <span style={cp.widgetLabel}>{w.label}</span>
                {w.premium && <span style={cp.crown}>★</span>}
              </button>
            ))}
          </div>
        </>
      )

    default:
      return null
  }
}

function PanelTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div style={cp.title}>
      <span>{title}</span>
      {count !== undefined && <span style={cp.titleCount}>{count}</span>}
    </div>
  )
}

function ShapeBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  const [hover, setHover] = React.useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...cp.shapeBtn, background: hover ? '#f1f5f9' : '#fff' }}
    >
      <Icon name={icon} size={24} />
      <span style={cp.shapeLabel}>{label}</span>
    </button>
  )
}

// ─── Configuración de página (panel derecho cuando no hay selección) ──────────
function PageConfig({ bgColor, applyBgColor }: { bgColor: string; applyBgColor: (c: string, all?: boolean) => void }) {
  return (
    <div style={{ padding: 16, overflowY: 'auto', flex: 1, minHeight: 0 }}>
      <div style={s.rightHeader}>Configuración de página</div>

      <CfgGroup label="Tamaño de página">
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={cfg.sizeBox}><span style={cfg.sizeLabel}>A</span> 580</div>
          <div style={cfg.sizeBox}><span style={cfg.sizeLabel}>A</span> 820</div>
        </div>
      </CfgGroup>

      <CfgGroup label="Esquemas de color">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {COLOR_SCHEMES.map((sc) => (
            <div key={sc.name} style={cfg.scheme}>
              <div style={{ display: 'flex', gap: 3 }}>
                {sc.colors.map((c) => (
                  <span key={c} onClick={() => applyBgColor(c)} style={{ ...cfg.swatch, background: c }} />
                ))}
              </div>
              <span style={cfg.schemeName}>{sc.name}</span>
            </div>
          ))}
        </div>
      </CfgGroup>

      <CfgGroup label="Fondo">
        <input
          type="color"
          value={bgColor}
          onChange={(e) => applyBgColor(e.target.value)}
          style={{ width: '100%', height: 36, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}
        />
        <button style={cfg.applyAll} onClick={() => applyBgColor(bgColor, true)}>Aplicar a todas las páginas</button>
      </CfgGroup>
    </div>
  )
}

function CfgGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={cfg.groupLabel}>{label}</div>
      {children}
    </div>
  )
}

// ─── Panel de propiedades del elemento seleccionado ───────────────────────────
// Cambia según el tipo: texto, forma, botón, imagen o zona de enlace.
function PropsPanel({ obj, canvas, pages, onChange, onSyncToggle }: { obj: any; canvas: any; pages: any[]; onChange: () => void; onSyncToggle?: (enabled: boolean) => void }) {
  const kind: string = (obj as any).data?.kind
    ?? (obj instanceof fabric.Textbox || obj instanceof fabric.Text ? 'text' : 'shape')

  const set = (props: any) => { obj.set(props); canvas?.requestRenderAll(); onChange() }
  const setData = (patch: any) => { (obj as any).data = { ...((obj as any).data ?? {}), ...patch }; onChange() }

  const fill = typeof obj.fill === 'string' ? obj.fill : '#4f46e5'
  const titleMap: Record<string, string> = { text: 'Texto', shape: 'Forma', button: 'Botón', linkzone: 'Zona de enlace', image: 'Imagen', icon: 'Icono', widget: 'Widget', hotspot: 'Punto activo', svglib: 'Gráfico SVG' }

  // Elementos de esta página que tienen nombre asignado (excepto el actual): posibles
  // objetivos para la acción "Mostrar / ocultar". Se muestra el nombre, se guarda el elementId.
  const namedTargets = (canvas?.getObjects?.() ?? [])
    .filter((o: any) => o !== obj && o.data?.name && o.data?.elementId)
    .map((o: any) => ({ id: o.data.elementId as string, name: o.data.name as string }))

  return (
    <div style={s.propsScroll}>
      <div style={s.rightHeader}>{titleMap[kind] ?? 'Elemento'}</div>
      <div style={s.props}>

        {/* Posición — común a todos */}
        <PropGroup label="Posición (X / Y)">
          <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 16px 1fr', gap: 6, alignItems: 'center' }}>
            <span style={s.axisLabel}>X</span>
            <input style={s.propInput} type="number" defaultValue={Math.round(obj.left ?? 0)} onChange={(e) => set({ left: +e.target.value })} />
            <span style={s.axisLabel}>Y</span>
            <input style={s.propInput} type="number" defaultValue={Math.round(obj.top ?? 0)} onChange={(e) => set({ top: +e.target.value })} />
          </div>
        </PropGroup>

        {/* Tamaño — ancho/alto en pantalla (vía escala del objeto) */}
        <PropGroup label="Tamaño (Ancho / Alto)">
          <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 16px 1fr', gap: 6, alignItems: 'center' }}>
            <span style={s.axisLabel}>A</span>
            <input style={s.propInput} type="number" min={4} defaultValue={Math.round(obj.getScaledWidth?.() ?? obj.width ?? 0)} onChange={(e) => {
              const w = +e.target.value; if (w > 0 && obj.width) { obj.set('scaleX', w / obj.width); canvas?.requestRenderAll(); onChange() }
            }} />
            <span style={s.axisLabel}>H</span>
            <input style={s.propInput} type="number" min={4} defaultValue={Math.round(obj.getScaledHeight?.() ?? obj.height ?? 0)} onChange={(e) => {
              const h = +e.target.value; if (h > 0 && obj.height) { obj.set('scaleY', h / obj.height); canvas?.requestRenderAll(); onChange() }
            }} />
          </div>
        </PropGroup>

        <PropGroup label="Rotación (grados)">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="range" min={0} max={360} step={1} defaultValue={Math.round(obj.angle ?? 0)} onChange={(e) => set({ angle: +e.target.value })} style={{ flex: 1 }} />
            <input style={{ ...s.propInput, width: 56 }} type="number" min={0} max={360} defaultValue={Math.round(obj.angle ?? 0)} onChange={(e) => set({ angle: +e.target.value })} />
          </div>
        </PropGroup>

        <PropGroup label="Opacidad">
          <input type="range" min={0} max={1} step={0.05} defaultValue={obj.opacity ?? 1} onChange={(e) => set({ opacity: +e.target.value })} style={{ width: '100%' }} />
        </PropGroup>

        {/* Nombre amigable del elemento. Internamente se le asigna un elementId único
            e inmutable (no editable) para que otra acción pueda apuntarlo de forma segura
            aunque dos elementos compartan el mismo nombre visible. */}
        <PropGroup label="Nombre del elemento">
          <input
            style={s.propInput}
            placeholder="ej: Precio apartamento"
            defaultValue={(obj as any).data?.name ?? ''}
            onChange={(e) => {
              const name = e.target.value
              const existing = (obj as any).data?.elementId
              setData({ name, elementId: existing || `el_${Math.random().toString(36).slice(2, 9)}` })
            }}
          />
          <p style={cp.hint}>Asígnale un nombre para poder mostrarlo u ocultarlo desde un botón o zona (acción "Mostrar / ocultar elemento").</p>
        </PropGroup>

        <PropGroup label="Visibilidad inicial">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#374151' }}>
            <input
              type="checkbox"
              checked={!!(obj as any).data?.startHidden}
              onChange={(e) => setData({ startHidden: e.target.checked })}
            />
            Empieza oculto (se revela al hacer clic en el disparador)
          </label>
        </PropGroup>

        {/* ── TEXTO ── */}
        {kind === 'text' && (
          <>
            <PropGroup label="Contenido">
              <textarea style={{ ...s.propInput, height: 64, resize: 'vertical' } as any} defaultValue={(obj as any).text ?? ''} onChange={(e) => { (obj as any).set('text', e.target.value); canvas?.requestRenderAll(); onChange() }} />
            </PropGroup>
            <PropGroup label="Tipografía">
              <select style={s.propInput} value={(obj as any).fontFamily ?? FONTS[0].family} onChange={(e) => set({ fontFamily: e.target.value })}>
                {FONTS.map((f) => <option key={f.name} value={f.family} style={{ fontFamily: f.family }}>{f.name}</option>)}
              </select>
            </PropGroup>
            <PropGroup label="Tamaño de fuente">
              <input style={s.propInput} type="number" min={8} max={160} defaultValue={(obj as any).fontSize ?? 24} onChange={(e) => set({ fontSize: +e.target.value })} />
            </PropGroup>
            <PropGroup label="Estilo">
              <div style={{ display: 'flex', gap: 6 }}>
                <StyleToggle active={(obj as any).fontWeight === 'bold'} onClick={() => set({ fontWeight: (obj as any).fontWeight === 'bold' ? 'normal' : 'bold' })} label="B" bold />
                <StyleToggle active={(obj as any).fontStyle === 'italic'} onClick={() => set({ fontStyle: (obj as any).fontStyle === 'italic' ? 'normal' : 'italic' })} label="I" italic />
                <StyleToggle active={(obj as any).underline} onClick={() => set({ underline: !(obj as any).underline })} label="U" underline />
              </div>
            </PropGroup>
            <PropGroup label="Alineación">
              <div style={{ display: 'flex', gap: 6 }}>
                {['left', 'center', 'right'].map((a) => (
                  <button key={a} style={{ ...s.alignBtn, ...((obj as any).textAlign === a ? s.alignActive : {}) }} onClick={() => set({ textAlign: a })}>
                    {a === 'left' ? '⟸' : a === 'center' ? '≡' : '⟹'}
                  </button>
                ))}
              </div>
            </PropGroup>
            <PropGroup label="Color de texto">
              <input type="color" defaultValue={fill.startsWith('#') ? fill : '#111827'} onChange={(e) => set({ fill: e.target.value })} style={s.colorInput} />
            </PropGroup>
          </>
        )}

        {/* ── FORMA ── */}
        {kind === 'shape' && (
          <>
            <PropGroup label="Color de relleno">
              <input type="color" defaultValue={fill.startsWith('#') ? fill : '#4f46e5'} onChange={(e) => set({ fill: e.target.value })} style={s.colorInput} />
            </PropGroup>
            <PropGroup label="Borde">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" defaultValue={(typeof obj.stroke === 'string' && obj.stroke) || '#111827'} onChange={(e) => set({ stroke: e.target.value })} style={{ ...s.colorInput, width: 48 }} />
                <input style={s.propInput} type="number" min={0} max={20} defaultValue={obj.strokeWidth ?? 0} onChange={(e) => set({ strokeWidth: +e.target.value })} placeholder="Grosor" />
              </div>
            </PropGroup>
            {(obj.type === 'rect') && (
              <PropGroup label="Redondeo de esquinas">
                <input type="range" min={0} max={80} step={1} defaultValue={obj.rx ?? 0} onChange={(e) => { const v = +e.target.value; set({ rx: v, ry: v }) }} style={{ width: '100%' }} />
              </PropGroup>
            )}
          </>
        )}

        {/* ── BOTÓN: estilo visual + acción ── */}
        {kind === 'button' && (
          <ButtonProps obj={obj} canvas={canvas} pages={pages} setData={setData} onChange={onChange} />
        )}

        {/* ── IMAGEN: sugerencia de uso ── */}
        {kind === 'image' && (
          <PropGroup label="Imagen">
            <p style={cp.hint}>Usa las esquinas para redimensionar y rotar. Asigna una acción abajo.</p>
          </PropGroup>
        )}

        {/* ── ICONO: color del trazo/relleno ── */}
        {kind === 'icon' && (
          <PropGroup label="Color del icono">
            <input type="color" defaultValue="#334155" onChange={(e) => {
              const col = e.target.value
              const apply = (o: any) => { if (o.fill && o.fill !== '') o.set('fill', col); if (o.stroke && o.stroke !== '') o.set('stroke', col) }
              if (obj.getObjects) obj.getObjects().forEach(apply); else apply(obj)
              canvas?.requestRenderAll(); onChange()
            }} style={s.colorInput} />
          </PropGroup>
        )}

        {/* ── GRÁFICO SVG de la biblioteca: recolorear, trazo, voltear ── */}
        {kind === 'svglib' && (
          <SvgLibProps obj={obj} canvas={canvas} onChange={onChange} onSyncToggle={onSyncToggle} />
        )}

        {/* ── PUNTO ACTIVO: color de animación ── */}
        {kind === 'hotspot' && (
          <PropGroup label="Color del punto">
            <input type="color" defaultValue={(obj as any).data?.hotspot?.color ?? '#4F46E5'} onChange={(e) => {
              const col = e.target.value
              setData({ hotspot: { ...((obj as any).data?.hotspot ?? {}), color: col } })
              const objs = obj.getObjects?.() ?? []
              objs.forEach((o: any) => {
                if (o.fill && o.fill !== 'transparent') { const isRing = o.radius > 16; o.set({ fill: isRing ? `${col}33` : col, stroke: col }) }
              })
              canvas?.requestRenderAll(); onChange()
            }} style={s.colorInput} />
          </PropGroup>
        )}

        {/* ── WIDGET: configuración propia según el tipo ── */}
        {kind === 'widget' && (
          <WidgetProps obj={obj} setData={setData} />
        )}

        {/* ── ACCIÓN: disponible para todos menos botón y widget
            (el botón ya incluye su ActionEditor; el widget es autónomo) ── */}
        {kind !== 'button' && kind !== 'widget' && (
          <>
            <div style={s.actionDivider}>Acción al hacer clic</div>
            <ActionEditor data={(obj as any).data ?? {}} pages={pages} setData={setData} targets={namedTargets} />
          </>
        )}

        <button style={s.deleteBtn} onClick={() => { canvas?.remove(obj); canvas?.requestRenderAll(); onChange() }}>Eliminar elemento</button>
      </div>
    </div>
  )
}

// Propiedades de un gráfico SVG de la biblioteca: recolorear (global y por capa),
// trazo y voltear. Respeta los permisos de edición definidos por el admin
// (data.editable.colors / stroke / geometry).
function SvgLibProps({ obj, canvas, onChange, onSyncToggle }: { obj: any; canvas: any; onChange: () => void; onSyncToggle?: (enabled: boolean) => void }) {
  const editable = (obj as any).data?.editable ?? { colors: true, stroke: true, geometry: true }
  const hasSyncGroup = !!(obj as any).data?.syncGroupId
  // Capas = sub-objetos del grupo SVG (cada path/forma). Si no es grupo, el propio objeto.
  const layers: any[] = obj.getObjects ? obj.getObjects() : [obj]

  const rerender = () => { canvas?.requestRenderAll(); onChange() }

  // Aplica un color de relleno a TODAS las capas con relleno visible.
  const recolorAll = (col: string) => {
    layers.forEach((o) => { if (o.fill && o.fill !== '' && o.fill !== 'transparent') o.set('fill', col) })
    rerender()
  }
  // Aplica color de trazo a todas las capas que tengan trazo.
  const strokeAll = (col: string) => {
    layers.forEach((o) => { if (o.stroke && o.stroke !== '') o.set('stroke', col) })
    rerender()
  }
  const strokeWidthAll = (w: number) => {
    layers.forEach((o) => { if (o.stroke && o.stroke !== '') o.set('strokeWidth', w) })
    rerender()
  }

  // Capas con relleno (para recoloreado individual). Limitamos a 12 para no saturar.
  const fillLayers = layers
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.fill && o.fill !== '' && o.fill !== 'transparent')
    .slice(0, 12)

  return (
    <>
      {editable.colors && (
        <PropGroup label="Color (todo el gráfico)">
          <input type="color" defaultValue="#334155"
            onChange={(e) => recolorAll(e.target.value)} style={s.colorInput} />
        </PropGroup>
      )}

      {editable.colors && fillLayers.length > 1 && (
        <PropGroup label="Color por capa">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {fillLayers.map(({ o, i }) => (
              <input
                key={i}
                type="color"
                title={`Capa ${i + 1}`}
                defaultValue={typeof o.fill === 'string' && o.fill.startsWith('#') ? o.fill : '#334155'}
                onChange={(e) => { o.set('fill', e.target.value); rerender() }}
                style={{ width: 34, height: 30, padding: 0, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}
              />
            ))}
          </div>
          <p style={cp.hint}>Cada cuadrito recolorea una parte distinta del gráfico.</p>
        </PropGroup>
      )}

      {editable.stroke && (
        <>
          <PropGroup label="Color del trazo">
            <input type="color" defaultValue="#334155"
              onChange={(e) => strokeAll(e.target.value)} style={s.colorInput} />
          </PropGroup>
          <PropGroup label="Grosor del trazo">
            <input type="range" min={0} max={12} step={0.5} defaultValue={2}
              onChange={(e) => strokeWidthAll(+e.target.value)} style={{ width: '100%' }} />
          </PropGroup>
        </>
      )}

      {editable.geometry !== false && (
        <PropGroup label="Voltear">
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={cp.secondaryBtn} onClick={() => { obj.set('flipX', !obj.flipX); rerender() }}>↔ Horizontal</button>
            <button style={cp.secondaryBtn} onClick={() => { obj.set('flipY', !obj.flipY); rerender() }}>↕ Vertical</button>
          </div>
        </PropGroup>
      )}

      {onSyncToggle && (
        <PropGroup label="Sincronizar en páginas">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={hasSyncGroup}
              onChange={(e) => onSyncToggle(e.target.checked)}
              style={{ accentColor: '#4F46E5', width: 15, height: 15 }}
            />
            <span>Aplicar cambios en todas las páginas</span>
          </label>
          {hasSyncGroup && <p style={{ fontSize: 11, color: '#9ca3af', margin: '4px 0 0' }}>Este SVG tiene un ID de sincronización. Los cambios se propagarán al guardar.</p>}
        </PropGroup>
      )}
    </>
  )
}

// Propiedades específicas del botón: estilo + acción
function ButtonProps({ obj, canvas, pages, setData, onChange }: { obj: any; canvas: any; pages: any[]; setData: (p: any) => void; onChange: () => void }) {
  const data = (obj as any).data ?? {}
  const [iconSizeDisplay, setIconSizeDisplay] = React.useState<number>(data.iconSize ?? 22)
  const namedTargets = (canvas?.getObjects?.() ?? [])
    .filter((o: any) => o !== obj && o.data?.name && o.data?.elementId)
    .map((o: any) => ({ id: o.data.elementId as string, name: o.data.name as string }))
  // Reaplica estilo al grupo (rect + text internos). El icono SVG se edita con SvgLibProps.
  function restyle(patch: any) {
    const next = { ...data, ...patch }
    ;(obj as any).data = next
    const objs = obj.getObjects?.() ?? []
    const rect = objs.find((o: any) => o.type === 'rect')
    const txt = objs.find((o: any) => o.type === 'text' || o.type === 'i-text')
    if (rect) {
      const outline = next.variant === 'outline'
      rect.set({
        fill: outline ? 'rgba(255,255,255,0)' : next.bg,
        stroke: outline ? next.bg : '',
        strokeWidth: outline ? 2 : 0,
        rx: next.variant === 'pill' ? 23 : 8,
        ry: next.variant === 'pill' ? 23 : 8,
      })
    }
    if (txt) {
      txt.set({ text: next.label, fill: next.variant === 'outline' ? next.bg : (next.textColor || '#fff') })
    }
    obj.addWithUpdate?.()
    canvas?.requestRenderAll()
    onChange()
  }

  // Ajusta el tamaño del sub-objeto ícono SVG dentro del grupo del botón.
  function resizeIcon(newSize: number) {
    const objs = obj.getObjects?.() ?? []
    const icon = objs.find((o: any) => o.type === 'group') ?? objs.find((o: any) => o.type === 'path')
    if (!icon) return
    icon.scaleToWidth(newSize)
    obj.data = { ...(obj.data ?? {}), iconSize: newSize }
    obj.addWithUpdate?.()
    canvas?.requestRenderAll()
    setIconSizeDisplay(newSize)
    onChange()
  }

  return (
    <>
      <PropGroup label="Texto del botón">
        <input style={s.propInput} defaultValue={data.label ?? ''} onChange={(e) => restyle({ label: e.target.value })} />
      </PropGroup>
      <PropGroup label="Estilo">
        <div style={{ display: 'flex', gap: 6 }}>
          {(['solid', 'outline', 'pill'] as const).map((v) => (
            <button key={v} style={{ ...s.alignBtn, flex: 1, fontSize: 11, ...(data.variant === v ? s.alignActive : {}) }} onClick={() => restyle({ variant: v })}>
              {v === 'solid' ? 'Relleno' : v === 'outline' ? 'Contorno' : 'Píldora'}
            </button>
          ))}
        </div>
      </PropGroup>
      <PropGroup label="Color del botón">
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <span style={s.miniLabel}>Fondo</span>
            <input type="color" defaultValue={data.bg ?? '#4f46e5'} onChange={(e) => restyle({ bg: e.target.value })} style={s.colorInput} />
          </div>
          <div style={{ flex: 1 }}>
            <span style={s.miniLabel}>Texto</span>
            <input type="color" defaultValue={data.textColor ?? '#ffffff'} onChange={(e) => restyle({ textColor: e.target.value })} style={s.colorInput} />
          </div>
        </div>
      </PropGroup>

      {data.svgIconId && (
        <PropGroup label="Tamaño del ícono">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range" min={14} max={56} step={2}
              defaultValue={data.iconSize ?? 22}
              onChange={(e) => resizeIcon(+e.target.value)}
              style={{ flex: 1, accentColor: '#4F46E5' }}
            />
            <span style={{ fontSize: 12, color: '#6b7280', minWidth: 30, textAlign: 'right' as const }}>{iconSizeDisplay}px</span>
          </div>
        </PropGroup>
      )}

      {data.svgIconId && (() => {
        // Extraer el sub-objeto icono SVG (el sub-grupo con más paths, NO el rect ni el text)
        const objs2 = obj.getObjects?.() ?? []
        const iconObj = objs2.find((o: any) => o.type === 'group') ?? objs2.find((o: any) => o.type === 'path')
        if (!iconObj) return null
        // Aseguramos que el icono tenga editable activado para ver todas sus capas
        if (!iconObj.data) iconObj.data = {}
        if (!iconObj.data.editable) iconObj.data.editable = { colors: true, stroke: true, geometry: true }
        return (
          <PropGroup label="Ícono SVG — capas y color">
            <SvgLibProps obj={iconObj} canvas={canvas} onChange={() => { obj.addWithUpdate?.(); canvas?.requestRenderAll(); onChange() }} />
          </PropGroup>
        )
      })()}

      <div style={s.actionDivider}>Acción al hacer clic</div>
      <ActionEditor data={data} pages={pages} setData={setData} targets={namedTargets} />
    </>
  )
}

// Mapa con buscador de ubicación + vista previa embebida en vivo (estilo FlipHTML5).
// Usa estado local para que el iframe de previsualización se actualice al escribir.
function MapWidgetProps({ cfg, setCfg }: { cfg: any; setCfg: (p: any) => void }) {
  const [address, setAddress] = React.useState<string>(cfg.address ?? '')
  const [mapsUrl, setMapsUrl] = React.useState<string>(cfg.mapsUrl ?? '')
  const [zoom, setZoom] = React.useState<number>(cfg.zoom ?? 14)

  const previewSrc = mapsUrl.trim()
    ? mapsUrl.trim()
    : (address.trim() ? `https://www.google.com/maps?q=${encodeURIComponent(address.trim())}&z=${zoom}&output=embed` : '')

  return (
    <>
      <PropGroup label="Ingresa la ubicación">
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={{ ...s.propInput, flex: 1 }} placeholder="Av. Lincoln 100, Santo Domingo" value={address}
            onChange={(e) => { setAddress(e.target.value); setCfg({ address: e.target.value }) }} />
        </div>
      </PropGroup>

      {previewSrc && (
        <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb', marginBottom: 4 }}>
          <iframe title="map-preview" src={previewSrc} style={{ width: '100%', height: 150, border: 0, display: 'block' }} loading="lazy" />
        </div>
      )}

      <PropGroup label="…o pega un link embebido de Google Maps">
        <input style={s.propInput} placeholder="https://www.google.com/maps/embed?pb=..." value={mapsUrl}
          onChange={(e) => { setMapsUrl(e.target.value); setCfg({ mapsUrl: e.target.value }) }} />
      </PropGroup>
      <PropGroup label="Zoom (1–20)">
        <input style={s.propInput} type="number" min={1} max={20} value={zoom}
          onChange={(e) => { setZoom(+e.target.value); setCfg({ zoom: +e.target.value }) }} />
      </PropGroup>
      <p style={cp.hint}>Para el link embebido: Maps → Compartir → Insertar mapa → copiá el src del iframe. El mapa de arriba es una vista previa en vivo.</p>
    </>
  )
}

// QR con vista previa en vivo dentro del panel.
function QrWidgetProps({ cfg, setCfg }: { cfg: any; setCfg: (p: any) => void }) {
  const [data, setData] = React.useState<string>(cfg.data ?? '')
  const [caption, setCaption] = React.useState<string>(cfg.caption ?? '')
  const qrContent = data.trim() || 'https://intaprd.com'
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrContent)}`

  return (
    <>
      <PropGroup label="Contenido (URL o texto — vacío = link del flipbook)">
        <input style={s.propInput} placeholder="https://..." value={data}
          onChange={(e) => { setData(e.target.value); setCfg({ data: e.target.value }) }} />
      </PropGroup>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
        <img src={qrSrc} alt="QR preview" width={130} height={130} style={{ border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 4 }} />
      </div>
      <PropGroup label="Leyenda">
        <input style={s.propInput} placeholder="Escanéame" value={caption}
          onChange={(e) => { setCaption(e.target.value); setCfg({ caption: e.target.value }) }} />
      </PropGroup>
    </>
  )
}

// Propiedades de un widget: campos de configuración según su tipo
function WidgetProps({ obj, setData }: { obj: any; setData: (p: any) => void }) {
  const widget = (obj as any).data?.widget ?? { type: 'map', config: {} }
  const cfg = widget.config ?? {}
  const type: WidgetType = widget.type
  const setCfg = (patch: any) => setData({ widget: { ...widget, config: { ...cfg, ...patch } } })
  const [quizQuestions, setQuizQuestions] = React.useState<any[]>(cfg.questions ?? [{ text: '¿Tu pregunta?', options: ['Opción A', 'Opción B'], type: 'single' }])
  const [showPreview, setShowPreview] = React.useState(false)

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <PropGroup label={label}>{children}</PropGroup>
  )
  const Check = ({ k, label, def = true }: { k: string; label: string; def?: boolean }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
      <input type="checkbox" defaultChecked={cfg[k] !== undefined ? !!cfg[k] : def} onChange={(e) => setCfg({ [k]: e.target.checked })} />
      {label}
    </label>
  )
  const labels: Record<WidgetType, string> = {
    map: 'Mapa', whatsapp: 'WhatsApp', contact: 'Formulario', video: 'Video',
    audio: 'Audio', qr: 'Código QR', table: 'Tabla', like: 'Me gusta',
    embed: 'Incrustar / HTML', quiz: 'Cuestionario', popup_banner: 'Pop-up emergente',
    download: 'Descargar archivo', units_table: 'Tabla de Unidades',
  }

  return (
    <>
      <div style={s.actionDivider}>Configuración · {labels[type]}</div>

      <button
        type="button"
        onClick={() => setShowPreview(true)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', marginBottom: 12, padding: '9px', border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4F46E5', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
      >
        👁 Vista previa
      </button>
      {showPreview && <WidgetPreview type={type} config={cfg} onClose={() => setShowPreview(false)} />}

      {type === 'map' && <MapWidgetProps cfg={cfg} setCfg={setCfg} />}

      {type === 'whatsapp' && (
        <>
          <Field label="Número (código de país sin +, ej: 18095551234)">
            <input style={s.propInput} placeholder="18095551234" defaultValue={cfg.phone ?? ''} onChange={(e) => setCfg({ phone: e.target.value })} />
          </Field>
          <Field label="Mensaje prellenado">
            <textarea style={{ ...s.propInput, height: 64, resize: 'vertical' } as any} defaultValue={cfg.message ?? ''} onChange={(e) => setCfg({ message: e.target.value })} />
          </Field>
          <Field label="Texto del botón">
            <input style={s.propInput} defaultValue={cfg.label ?? 'Escríbenos'} onChange={(e) => setCfg({ label: e.target.value })} />
          </Field>
        </>
      )}

      {type === 'contact' && (
        <>
          <Field label="Título">
            <input style={s.propInput} defaultValue={cfg.title ?? ''} onChange={(e) => setCfg({ title: e.target.value })} />
          </Field>
          <Field label="Email destino">
            <input style={s.propInput} placeholder="ventas@dominio.com" defaultValue={cfg.toEmail ?? ''} onChange={(e) => setCfg({ toEmail: e.target.value })} />
          </Field>
          <Field label="Texto del botón">
            <input style={s.propInput} defaultValue={cfg.button ?? 'Enviar'} onChange={(e) => setCfg({ button: e.target.value })} />
          </Field>
          <Field label="Campos y obligatorios">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Check k="showPhone"     label="Incluir Teléfono / Móvil" />
              <Check k="showComment"   label="Incluir Comentario / Mensaje" />
              <Check k="nameRequired"  label="Nombre obligatorio (*)" />
              <Check k="emailRequired" label="Email obligatorio (*)" />
              <Check k="phoneRequired" label="Teléfono obligatorio (*)" def={false} />
            </div>
          </Field>
        </>
      )}

      {type === 'video' && (
        <>
          <Field label="URL del video (YouTube o Vimeo)">
            <input style={s.propInput} placeholder="https://youtube.com/watch?v=..." defaultValue={cfg.url ?? ''} onChange={(e) => setCfg({ url: e.target.value })} />
          </Field>
          <Field label="…o sube un archivo de video (MP4/WebM)">
            <FileField value={/^https?:\/\/(www\.)?(youtube|youtu\.be|vimeo)/.test(cfg.url ?? '') ? '' : (cfg.url ?? '')} onChange={(url) => setCfg({ url })} accept={ACCEPT_VIDEO} preview={false} hint="MP4, WebM · máx 50 MB" />
          </Field>
          <Field label="Portada / thumbnail (opcional, para MP4)">
            <FileField value={cfg.poster ?? ''} onChange={(url) => setCfg({ poster: url })} accept={ACCEPT_IMAGE} hint="JPG, PNG, WEBP" />
          </Field>
          <Field label="Opciones de reproducción">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Check k="autoplay" label="Autoplay (inicia automáticamente)" def={false} />
              <Check k="controls" label="Mostrar controles de reproducción" />
              <Check k="muted"    label="Silenciar (recomendado con autoplay)" def={false} />
              <Check k="loop"     label="Repetir en bucle" def={false} />
            </div>
          </Field>
        </>
      )}

      {type === 'audio' && (
        <>
          <Field label="Archivo de audio">
            <FileField value={cfg.url ?? ''} onChange={(url) => setCfg({ url })} accept={ACCEPT_AUDIO} preview={false} hint="MP3, OGG, WAV, M4A · máx 50 MB" />
          </Field>
          <Field label="Color del reproductor">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" defaultValue={cfg.playerColor ?? '#4F46E5'} onChange={(e) => setCfg({ playerColor: e.target.value })} style={s.colorInput} />
              <span style={{ fontSize: 11, color: '#6b7280' }}>Color del botón y barra de progreso</span>
            </div>
          </Field>
          <Field label="Opciones">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Check k="autoplay" label="Autoplay al abrir la página" def={false} />
              <Check k="loop"     label="Repetir en bucle" def={false} />
            </div>
          </Field>
        </>
      )}

      {type === 'qr' && <QrWidgetProps cfg={cfg} setCfg={setCfg} />}

      {type === 'table' && (
        <Field label="Datos (fila por línea, columnas separadas por coma)">
          <textarea style={{ ...s.propInput, height: 120, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 } as any} defaultValue={cfg.csv ?? ''} onChange={(e) => setCfg({ csv: e.target.value })} />
        </Field>
      )}

      {type === 'like' && (
        <Field label="Texto del botón">
          <input style={s.propInput} defaultValue={cfg.label ?? 'Me gusta'} onChange={(e) => setCfg({ label: e.target.value })} />
        </Field>
      )}

      {type === 'download' && (
        <>
          <Field label="Archivo a descargar">
            <FileField value={cfg.url ?? ''} onChange={(url) => setCfg({ url })} accept={ACCEPT_FILE} preview={false} hint="PDF, ZIP, Office, imágenes · máx 50 MB" />
          </Field>
          <Field label="Título">
            <input style={s.propInput} defaultValue={cfg.title ?? 'Descarga aquí'} onChange={(e) => setCfg({ title: e.target.value })} />
          </Field>
          <Field label="Texto del botón">
            <input style={s.propInput} defaultValue={cfg.button ?? 'Descargar'} onChange={(e) => setCfg({ button: e.target.value })} />
          </Field>
          <Field label="Nombre del archivo descargado (opcional)">
            <input style={s.propInput} placeholder="catalogo.pdf" defaultValue={cfg.filename ?? ''} onChange={(e) => setCfg({ filename: e.target.value })} />
          </Field>
          <Field label="Color del botón">
            <input type="color" defaultValue={cfg.buttonColor ?? '#4F46E5'} onChange={(e) => setCfg({ buttonColor: e.target.value })} style={s.colorInput} />
          </Field>
        </>
      )}

      {type === 'embed' && (
        <>
          <Field label="Código HTML / iframe a incrustar">
            <textarea style={{ ...s.propInput, height: 120, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 } as any} placeholder={'<iframe src="https://..." ...></iframe>\no código HTML corto'} defaultValue={cfg.html ?? ''} onChange={(e) => setCfg({ html: e.target.value })} />
          </Field>
          <p style={cp.hint}>Pegá el código de inserción de cualquier servicio externo (Google Forms, Typeform, calendarios, mapas custom, etc.).</p>
        </>
      )}

      {type === 'quiz' && (
        <>
          <Field label="Título del cuestionario">
            <input style={s.propInput} defaultValue={cfg.title ?? 'Cuestionario'} onChange={(e) => setCfg({ title: e.target.value })} />
          </Field>
          <div style={cp.sectionLabel}>Preguntas</div>
          {quizQuestions.map((q: any, qi: number) => (
            <div key={qi} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>Pregunta {qi + 1}</span>
                <button onClick={() => { const next = quizQuestions.filter((_: any, i: number) => i !== qi); setQuizQuestions(next); setCfg({ questions: next }) }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>✕</button>
              </div>
              <input style={{ ...s.propInput, marginBottom: 6 }} placeholder="Texto de la pregunta" defaultValue={q.text} onChange={(e) => { const next = quizQuestions.map((qq: any, i: number) => i === qi ? { ...qq, text: e.target.value } : qq); setQuizQuestions(next); setCfg({ questions: next }) }} />
              <select style={{ ...s.propInput, marginBottom: 6 }} defaultValue={q.type ?? 'single'} onChange={(e) => { const next = quizQuestions.map((qq: any, i: number) => i === qi ? { ...qq, type: e.target.value } : qq); setQuizQuestions(next); setCfg({ questions: next }) }}>
                <option value="single">Opción única</option>
                <option value="multi">Múltiple selección</option>
              </select>
              {q.options.map((opt: string, oi: number) => (
                <div key={oi} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <input style={{ ...s.propInput, flex: 1 }} placeholder={`Opción ${oi + 1}`} defaultValue={opt} onChange={(e) => { const next = quizQuestions.map((qq: any, i: number) => i === qi ? { ...qq, options: qq.options.map((o: string, j: number) => j === oi ? e.target.value : o) } : qq); setQuizQuestions(next); setCfg({ questions: next }) }} />
                  <button onClick={() => { const next = quizQuestions.map((qq: any, i: number) => i === qi ? { ...qq, options: qq.options.filter((_: string, j: number) => j !== oi) } : qq); setQuizQuestions(next); setCfg({ questions: next }) }} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>✕</button>
                </div>
              ))}
              <button onClick={() => { const next = quizQuestions.map((qq: any, i: number) => i === qi ? { ...qq, options: [...qq.options, `Opción ${qq.options.length + 1}`] } : qq); setQuizQuestions(next); setCfg({ questions: next }) }} style={{ ...cp.primaryBtn, fontSize: 11, padding: '5px', marginTop: 4, background: '#f3f4f6', color: '#374151' }}>+ Agregar opción</button>
            </div>
          ))}
          <button onClick={() => { const next = [...quizQuestions, { text: `Pregunta ${quizQuestions.length + 1}`, options: ['Opción A', 'Opción B'], type: 'single' }]; setQuizQuestions(next); setCfg({ questions: next }) }} style={{ ...cp.primaryBtn, background: '#4F46E5', marginBottom: 4 }}>+ Agregar pregunta</button>
        </>
      )}

      {type === 'popup_banner' && (
        <>
          <Field label="Plantilla rápida">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {POPUP_TEMPLATES.map((t) => (
                <button key={t.key} onClick={() => setCfg({ ...cfg, template: t.key, ...t.defaults })} style={{ padding: '6px 4px', border: `2px solid ${cfg.template === t.key ? '#4F46E5' : '#e5e7eb'}`, borderRadius: 6, background: cfg.template === t.key ? '#eef2ff' : '#fff', cursor: 'pointer', fontSize: 10, color: '#374151', textAlign: 'center' as const }}>
                  {t.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Lado donde aparece">
            <select style={s.propInput} defaultValue={cfg.position ?? 'left'} onChange={(e) => setCfg({ position: e.target.value })}>
              <option value="left">Lateral izquierdo</option>
              <option value="right">Lateral derecho</option>
            </select>
          </Field>
          <Field label="Cuándo aparecer">
            <select style={s.propInput} defaultValue={cfg.trigger ?? 'delay'} onChange={(e) => setCfg({ trigger: e.target.value })}>
              <option value="delay">Después de X segundos</option>
              <option value="immediate">Al abrir el flipbook</option>
              <option value="exit">Al intentar salir</option>
            </select>
          </Field>
          {(cfg.trigger === 'delay' || !cfg.trigger) && (
            <Field label="Demora (segundos)">
              <input style={s.propInput} type="number" min={0} max={120} defaultValue={cfg.delay ?? 5} onChange={(e) => setCfg({ delay: +e.target.value })} />
            </Field>
          )}
          <Field label="Animación de entrada">
            <select style={s.propInput} defaultValue={cfg.animation ?? 'slide'} onChange={(e) => setCfg({ animation: e.target.value })}>
              <option value="slide">Deslizar (suave)</option>
              <option value="bounce">Saltos</option>
              <option value="heartbeat">Latidos</option>
              <option value="zoom">Zoom</option>
              <option value="none">Sin animación</option>
            </select>
          </Field>
          <Field label="Cerrar solo tras X segundos (0 = no cerrar)">
            <input style={s.propInput} type="number" min={0} max={120} defaultValue={cfg.autoClose ?? 0} onChange={(e) => setCfg({ autoClose: +e.target.value })} />
          </Field>
          <Field label="Título del pop-up">
            <input style={s.propInput} defaultValue={cfg.title ?? ''} onChange={(e) => setCfg({ title: e.target.value })} />
          </Field>
          <Field label="Texto del pop-up">
            <textarea style={{ ...s.propInput, height: 64, resize: 'vertical' } as any} defaultValue={cfg.text ?? ''} onChange={(e) => setCfg({ text: e.target.value })} />
          </Field>
          <Field label="Texto del botón">
            <input style={s.propInput} defaultValue={cfg.buttonText ?? ''} onChange={(e) => setCfg({ buttonText: e.target.value })} />
          </Field>
          <Field label="URL del botón">
            <input style={s.propInput} placeholder="https://..." defaultValue={cfg.buttonUrl ?? ''} onChange={(e) => setCfg({ buttonUrl: e.target.value })} />
          </Field>
          <Field label="Imagen (opcional)">
            <FileField value={cfg.image ?? ''} onChange={(url) => setCfg({ image: url })} accept={ACCEPT_IMAGE} hint="JPG, PNG, WEBP" />
          </Field>
          {cfg.image && (
            <Field label="Lado de la imagen">
              <select style={s.propInput} defaultValue={cfg.imagePosition ?? 'left'} onChange={(e) => setCfg({ imagePosition: e.target.value })}>
                <option value="left">Imagen a la izquierda</option>
                <option value="right">Imagen a la derecha</option>
              </select>
            </Field>
          )}
          {cfg.image && (
            <Field label="Ajustar imagen">
              <ImageAdjuster
                url={cfg.image}
                zoom={cfg.imageZoom ?? 1}
                posX={cfg.imagePosX ?? 50}
                posY={cfg.imagePosY ?? 50}
                onChange={(p) => setCfg(p)}
              />
            </Field>
          )}
          <Field label="Colores">
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={s.miniLabel}>Fondo</div>
                <input type="color" defaultValue={cfg.bgColor ?? '#1e1b4b'} onChange={(e) => setCfg({ bgColor: e.target.value })} style={s.colorInput} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={s.miniLabel}>Texto</div>
                <input type="color" defaultValue={cfg.textColor ?? '#ffffff'} onChange={(e) => setCfg({ textColor: e.target.value })} style={s.colorInput} />
              </div>
            </div>
          </Field>
          <Field label="Opciones">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Check k="showOnce" label="Mostrar una sola vez por visitante" />
            </div>
          </Field>
        </>
      )}

      {type === 'units_table' && (
        <>
          <Field label="ID de publicación (se completa automáticamente)">
            <input style={s.propInput} value={cfg.publication_id ?? ''} readOnly />
          </Field>
          <Field label="Filtrar estado">
            <select style={s.propInput} defaultValue={cfg.filter_status ?? 'all'} onChange={(e) => setCfg({ filter_status: e.target.value })}>
              <option value="all">Todos</option>
              <option value="available">Solo disponibles</option>
              <option value="reserved">Solo reservadas</option>
              <option value="sold">Solo vendidas</option>
            </select>
          </Field>
          <Field label="Columnas visibles">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Check k="show_price" label="Mostrar precio" />
              <Check k="show_area"  label="Mostrar m²" />
            </div>
          </Field>
        </>
      )}

      <p style={cp.hint}>El widget se muestra completo en la vista previa y en la publicación final.</p>
    </>
  )
}

// Ajustador de imagen: arrastrar para reposicionar + zoom. Guarda el encuadre
// como imageZoom (escala) + imagePosX/imagePosY (object-position 0–100 %), que
// el viewer aplica con object-fit:cover + object-position + transform:scale.
function ImageAdjuster({
  url, zoom, posX, posY, onChange,
}: {
  url: string; zoom: number; posX: number; posY: number
  onChange: (p: { imageZoom?: number; imagePosX?: number; imagePosY?: number }) => void
}) {
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  function down(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, px: posX, py: posY }
  }
  function move(e: React.PointerEvent) {
    if (!drag.current) return
    const d = drag.current
    // Arrastrar hacia un lado revela el lado opuesto → object-position se mueve al revés
    const nx = Math.min(100, Math.max(0, d.px - (e.clientX - d.x) * 0.4))
    const ny = Math.min(100, Math.max(0, d.py - (e.clientY - d.y) * 0.4))
    onChange({ imagePosX: Math.round(nx), imagePosY: Math.round(ny) })
  }
  function up() { drag.current = null }

  const zb: React.CSSProperties = { width: 26, height: 26, borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 15, lineHeight: 1, color: '#374151' }

  return (
    <div>
      <div
        style={{ position: 'relative', width: '100%', height: 150, borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb', background: '#f3f4f6', cursor: 'move', touchAction: 'none' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
      >
        <img
          src={url}
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${posX}% ${posY}%`, transform: `scale(${zoom})`, transformOrigin: 'center', userSelect: 'none', pointerEvents: 'none' }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: '#6b7280' }}>Zoom</span>
        <button type="button" style={zb} onClick={() => onChange({ imageZoom: Math.max(1, +(zoom - 0.1).toFixed(2)) })}>−</button>
        <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => onChange({ imageZoom: +e.target.value })} style={{ flex: 1 }} />
        <button type="button" style={zb} onClick={() => onChange({ imageZoom: Math.min(3, +(zoom + 0.1).toFixed(2)) })}>+</button>
      </div>
      <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>Arrastrá la imagen para reposicionarla y usá el zoom para ajustarla a tu gusto.</p>
    </div>
  )
}

// Editor de acción reutilizable (botones y zonas de enlace)
function ActionEditor({ data, pages, setData, targets = [] }: { data: any; pages: any[]; setData: (p: any) => void; targets?: { id: string; name: string }[] }) {
  const action = data.action ?? { type: 'link' }
  const setAction = (patch: any) => setData({ action: { ...action, ...patch } })

  return (
    <>
      <PropGroup label="Tipo de acción">
        <select style={s.propInput} value={action.type ?? 'none'} onChange={(e) => setAction({ type: e.target.value })}>
          <option value="none">— Sin acción —</option>
          {ACTION_TYPES.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
        </select>
      </PropGroup>

      {action.type === 'link' && (
        <>
          <PropGroup label="URL">
            <input style={s.propInput} placeholder="https://..." defaultValue={action.url ?? 'https://'} onChange={(e) => setAction({ url: e.target.value })} />
          </PropGroup>
          <PropGroup label="Abrir en">
            <select style={s.propInput} value={action.target ?? '_blank'} onChange={(e) => setAction({ target: e.target.value })}>
              <option value="_blank">Nueva pestaña</option>
              <option value="_self">Misma pestaña</option>
            </select>
          </PropGroup>
        </>
      )}

      {action.type === 'page' && (
        <PropGroup label="Ir a la página">
          <select style={s.propInput} value={action.page ?? 1} onChange={(e) => setAction({ page: +e.target.value })}>
            {pages.map((_: any, i: number) => <option key={i} value={i + 1}>Página {i + 1}</option>)}
          </select>
        </PropGroup>
      )}

      {action.type === 'call' && (
        <PropGroup label="Número de teléfono">
          <input style={s.propInput} placeholder="+1 809 000 0000" defaultValue={action.phone ?? ''} onChange={(e) => setAction({ phone: e.target.value })} />
        </PropGroup>
      )}

      {action.type === 'email' && (
        <>
          <PropGroup label="Correo">
            <input style={s.propInput} placeholder="correo@dominio.com" defaultValue={action.email ?? ''} onChange={(e) => setAction({ email: e.target.value })} />
          </PropGroup>
          <PropGroup label="Asunto (opcional)">
            <input style={s.propInput} defaultValue={action.subject ?? ''} onChange={(e) => setAction({ subject: e.target.value })} />
          </PropGroup>
        </>
      )}

      {action.type === 'popup_text' && (
        <PropGroup label="Texto a mostrar">
          <textarea style={{ ...s.propInput, height: 80, resize: 'vertical' } as any} defaultValue={action.text ?? ''} onChange={(e) => setAction({ text: e.target.value })} />
        </PropGroup>
      )}

      {action.type === 'popup_image' && (
        <PropGroup label="Imagen emergente">
          <FileField value={action.image ?? ''} onChange={(url) => setAction({ image: url })} accept={ACCEPT_IMAGE} hint="JPG, PNG, WEBP · máx 10 MB" />
        </PropGroup>
      )}

      {action.type === 'whatsapp' && (
        <>
          <PropGroup label="Número (código de país sin +)">
            <input style={s.propInput} placeholder="18095551234" defaultValue={action.phone ?? ''} onChange={(e) => setAction({ phone: e.target.value })} />
          </PropGroup>
          <PropGroup label="Mensaje prellenado (opcional)">
            <input style={s.propInput} defaultValue={action.message ?? ''} onChange={(e) => setAction({ message: e.target.value })} />
          </PropGroup>
        </>
      )}

      {action.type === 'popup_video' && (
        <PropGroup label="URL del video (YouTube, Vimeo o .mp4)">
          <input style={s.propInput} placeholder="https://youtube.com/watch?v=..." defaultValue={action.url ?? ''} onChange={(e) => setAction({ url: e.target.value })} />
        </PropGroup>
      )}

      {action.type === 'popup_audio' && (
        <PropGroup label="Audio emergente">
          <FileField value={action.url ?? ''} onChange={(url) => setAction({ url })} accept={ACCEPT_AUDIO} preview={false} hint="MP3, OGG, WAV, M4A · máx 50 MB" />
        </PropGroup>
      )}

      {action.type === 'download' && (
        <>
          <PropGroup label="Archivo a descargar">
            <FileField value={action.url ?? ''} onChange={(url) => setAction({ url })} accept={ACCEPT_FILE} preview={false} hint="PDF, ZIP, Office, imágenes · máx 50 MB" />
          </PropGroup>
          <PropGroup label="Nombre del archivo (opcional)">
            <input style={s.propInput} placeholder="catalogo.pdf" defaultValue={action.filename ?? ''} onChange={(e) => setAction({ filename: e.target.value })} />
          </PropGroup>
        </>
      )}

      {action.type === 'gallery_images' && (
        <GalleryImagesEditor action={action} setAction={setAction} />
      )}

      {action.type === 'gallery_videos' && (
        <GalleryVideosEditor action={action} setAction={setAction} />
      )}

      {action.type === 'show_hide' && (
        <PropGroup label="Elemento a mostrar u ocultar">
          {targets.length === 0 ? (
            <p style={cp.hint}>
              Primero selecciona el elemento objetivo y asígnale un “Nombre del elemento”
              en su panel de propiedades. Luego vuelve aquí a configurar la acción.
            </p>
          ) : (
            <select style={s.propInput} value={action.target ?? ''} onChange={(e) => setAction({ target: e.target.value })}>
              <option value="">— Selecciona un elemento —</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <p style={cp.hint}>
            Para que el elemento empiece oculto, selecciónalo y marca “Empieza oculto” en su panel de propiedades.
          </p>
        </PropGroup>
      )}
    </>
  )
}

// ─── Editor de galería de imágenes ────────────────────────────────────────────
function GalleryImagesEditor({ action, setAction }: { action: any; setAction: (p: any) => void }) {
  const images: string[] = action.images ?? []
  const cover: string = action.cover ?? images[0] ?? ''
  const fileRefs = useRef<(HTMLInputElement | null)[]>([])

  function setImages(next: string[]) {
    setAction({ images: next, cover: next.includes(cover) ? cover : (next[0] ?? '') })
  }

  function addImage() {
    if (images.length >= 20) return
    setImages([...images, ''])
  }

  function updateImage(i: number, url: string) {
    const next = [...images]
    next[i] = url
    setImages(next)
    if (!cover) setAction({ images: next, cover: url })
  }

  function removeImage(i: number) {
    const next = images.filter((_, j) => j !== i)
    setImages(next)
  }

  async function uploadImage(i: number, file: File) {
    try {
      const res = await api.upload(file)
      updateImage(i, res.data.url)
    } catch (e: any) {
      alert('Error al subir: ' + (e.message ?? e))
    }
  }

  return (
    <>
      <PropGroup label="Imágenes de la galería (máx. 20)">
        {images.map((url, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6 }}>
            <input
              style={{ ...s.propInput, flex: 1, fontSize: 11 }}
              placeholder="https://..."
              value={url}
              onChange={(e) => updateImage(i, e.target.value)}
            />
            <input
              ref={(el) => { fileRefs.current[i] = el }}
              type="file"
              accept={ACCEPT_IMAGE}
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(i, f); e.target.value = '' }}
            />
            <button
              type="button"
              style={{ ...s.alignBtn, fontSize: 11, padding: '4px 8px', flex: 'none', whiteSpace: 'nowrap' }}
              onClick={() => fileRefs.current[i]?.click()}
            >Subir</button>
            <button
              type="button"
              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}
              onClick={() => removeImage(i)}
            >✕</button>
          </div>
        ))}
        {images.length < 20 && (
          <button type="button" style={{ ...s.alignBtn, fontSize: 12 }} onClick={addImage}>+ Agregar imagen</button>
        )}
      </PropGroup>
      {images.filter(Boolean).length > 0 && (
        <PropGroup label="Imagen de portada">
          <select
            style={s.propInput}
            value={cover}
            onChange={(e) => setAction({ cover: e.target.value })}
          >
            {images.filter(Boolean).map((url, i) => (
              <option key={i} value={url}>Imagen {i + 1}</option>
            ))}
          </select>
        </PropGroup>
      )}
    </>
  )
}

// ─── Editor de galería de videos ──────────────────────────────────────────────
function GalleryVideosEditor({ action, setAction }: { action: any; setAction: (p: any) => void }) {
  const videos: string[] = action.videos ?? []

  function setVideos(next: string[]) {
    setAction({ videos: next })
  }

  function addVideo() {
    setVideos([...videos, ''])
  }

  function updateVideo(i: number, url: string) {
    const next = [...videos]
    next[i] = url
    setVideos(next)
  }

  function removeVideo(i: number) {
    setVideos(videos.filter((_, j) => j !== i))
  }

  return (
    <PropGroup label="Videos de la galería (YouTube, Vimeo o MP4)">
      {videos.map((url, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6 }}>
          <input
            style={{ ...s.propInput, flex: 1, fontSize: 11 }}
            placeholder="https://youtube.com/watch?v=..."
            value={url}
            onChange={(e) => updateVideo(i, e.target.value)}
          />
          <button
            type="button"
            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}
            onClick={() => removeVideo(i)}
          >✕</button>
        </div>
      ))}
      <button type="button" style={{ ...s.alignBtn, fontSize: 12 }} onClick={addVideo}>+ Agregar video</button>
    </PropGroup>
  )
}

function StyleToggle({ active, onClick, label, bold, italic, underline }: any) {
  return (
    <button
      onClick={onClick}
      style={{
        ...s.alignBtn, flex: 1,
        fontWeight: bold ? 700 : 500, fontStyle: italic ? 'italic' : 'normal', textDecoration: underline ? 'underline' : 'none',
        ...(active ? s.alignActive : {}),
      }}
    >{label}</button>
  )
}

function PropGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid #f3f4f6' }}>
      <span style={s.propLabel}>{label}</span>
      {children}
    </div>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  root:    { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280', fontSize: 15 },

  topBar:   { display: 'flex', alignItems: 'center', height: 52, padding: '0 16px', background: '#1e1b4b', flexShrink: 0 },
  topLeft:  { display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  topCenter:{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 120, flexShrink: 0 },
  topRight: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  backLink: { color: 'rgba(255,255,255,0.7)', fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 },
  pubTitle: { fontWeight: 700, fontSize: 14, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  breadcrumb: { fontSize: 13, color: 'rgba(255,255,255,0.65)', fontWeight: 500 },
  saveInd:   { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 500, whiteSpace: 'nowrap', minWidth: 96, textAlign: 'right' as const },
  btnOutlineWhite: { background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  btnPublish: { border: 'none', color: '#fff', borderRadius: 6, padding: '6px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 },

  body: { display: 'flex', flex: 1, overflow: 'hidden' },

  rail:    { width: 68, minWidth: 68, background: '#1a1827', display: 'flex', flexDirection: 'column', padding: '6px 0', overflowY: 'auto' },
  railBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: '11px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, borderLeft: '3px solid transparent', transition: 'color .15s, background .15s' },
  railBtnActive: { color: '#fff', background: 'rgba(129,140,248,0.18)', borderLeftColor: '#818cf8' },
  railLabel:{ fontSize: 9.5, fontWeight: 500 },

  panel: { width: 268, minWidth: 268, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', padding: 14, overflowY: 'auto' },

  center:    { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#e8eaed' },
  toolbar:   { display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', height: 44, background: '#fff', borderBottom: '1px solid #e5e7eb', flexShrink: 0 },
  toolBtn:   { background: 'none', border: '1px solid transparent', borderRadius: 8, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151' },
  toolSep:   { width: 1, height: 20, background: '#e5e7eb', margin: '0 6px' },
  ctxOverlay:{ position: 'fixed', inset: 0, zIndex: 4000 },
  ctxMenu:   { position: 'fixed', zIndex: 4001, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 10px 40px rgba(0,0,0,0.18)', padding: 6, minWidth: 190, maxHeight: '80vh', overflowY: 'auto' },
  ctxItem:   { display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: 'none', background: 'transparent', borderRadius: 7, padding: '7px 10px', fontSize: 13, color: '#374151', cursor: 'pointer', textAlign: 'left' as const },
  ctxSep:    { height: 1, background: '#f0f0f0', margin: '4px 0' },
  zoomGroup: { display: 'flex', gap: 2 },
  zoomBtn:   { background: 'none', border: '1px solid transparent', borderRadius: 12, padding: '3px 9px', fontSize: 11, cursor: 'pointer', color: '#6b7280', fontWeight: 500 },
  zoomActive:{ background: '#f3f4f6', borderColor: '#e5e7eb', color: '#111827', fontWeight: 600 },
  canvasWrap:  { flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: 32, alignItems: 'flex-start' },
  pageNav:   { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 16px', background: '#fff', borderTop: '1px solid #e5e7eb', flexShrink: 0 },
  pageNavBtn: { background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, color: '#374151', transition: 'background .15s', fontFamily: 'inherit' } as React.CSSProperties,
  pageNavInfo:{ fontSize: 13, color: '#374151', fontWeight: 600, minWidth: 90, textAlign: 'center' as const },
  canvasEmpty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', cursor: 'pointer', borderRadius: 12, transition: 'background 0.2s' },

  right:      { width: 288, minWidth: 288, background: '#fff', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  rightHeader:{ fontSize: 13, fontWeight: 700, color: '#111827', padding: '14px 16px 10px', borderBottom: '1px solid #f3f4f6' },

  propsScroll: { display: 'flex', flexDirection: 'column', overflowY: 'auto', flex: 1, minHeight: 0 },
  props:     { padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 },
  propLabel: { fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  miniLabel: { fontSize: 10, color: '#9ca3af', display: 'block', marginBottom: 4 },
  propInput: { border: '1px solid #e5e7eb', borderRadius: 6, padding: '7px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const, background: '#fff' },
  colorInput:{ width: '100%', height: 34, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', padding: 2, boxSizing: 'border-box' as const },
  axisLabel: { fontSize: 11, color: '#9ca3af', textAlign: 'center' as const },
  alignBtn:  { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '7px 0', fontSize: 14, cursor: 'pointer', color: '#374151', flex: 1 },
  alignActive: { background: '#eef2ff', borderColor: '#4f46e5', color: '#4f46e5' },
  actionDivider: { fontSize: 12, fontWeight: 700, color: '#4f46e5', borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 2 },
  deleteBtn: { background: '#fff', color: '#ef4444', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', cursor: 'pointer', width: '100%', fontSize: 13, fontWeight: 500, marginTop: 4 },
}

const cp: Record<string, React.CSSProperties> = {
  title:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 12 },
  titleCount: { fontSize: 11, color: '#6b7280', background: '#f3f4f6', borderRadius: 10, padding: '1px 7px' },
  thumbList:  { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, borderRadius: 8 },
  thumbItem:  { position: 'relative', cursor: 'pointer', borderRadius: 6, overflow: 'hidden', border: '2px solid transparent', transition: 'border-color .15s' },
  thumbImg:   { width: '100%', aspectRatio: '0.707', objectFit: 'cover' as const, display: 'block' },
  thumbNum:   { position: 'absolute', bottom: 4, left: 6, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3 },
  thumbDel:   { position: 'absolute', top: 4, right: 4, background: 'rgba(239,68,68,0.9)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, width: 20, height: 20, cursor: 'pointer', padding: 0 },
  primaryBtn: { width: '100%', background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  secondaryBtn: { width: '100%', background: '#fff', color: '#4F46E5', border: '1.5px solid #4F46E5', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginTop: 8 },
  search:     { width: '100%', boxSizing: 'border-box' as const, border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 12 },
  empty:      { fontSize: 12, color: '#9ca3af', textAlign: 'center' as const, padding: '20px 0' },
  hint:       { fontSize: 11, color: '#9ca3af', marginTop: 10, marginBottom: 4, lineHeight: 1.5 },
  tplGrid:        { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  tplCard:        { border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', position: 'relative' as const },
  tplCardLocked:  { cursor: 'not-allowed', opacity: 0.85 },
  tplImg:         { width: '100%', aspectRatio: '0.707', objectFit: 'cover' as const, display: 'block' },
  tplPlaceholder: { width: '100%', aspectRatio: '0.707', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', color: '#94a3b8' },
  tplLockOverlay: { position: 'absolute' as const, top: 4, right: 6, fontSize: 16, lineHeight: 1 },
  tplName:        { fontSize: 11, padding: '6px 8px', color: '#374151', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  stack:      { display: 'flex', flexDirection: 'column', gap: 8 },
  listBtn:    { display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#374151', textAlign: 'left' as const },
  shapeGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  shapeBtn:   { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, height: 72, border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', color: '#374151' },
  shapeLabel: { fontSize: 11, color: '#6b7280' },
  btnList:    { display: 'flex', flexDirection: 'column', gap: 8 },
  previewBtn: { width: '100%', padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  widgetCard: { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, height: 72, border: '1px solid #e5e7eb', borderRadius: 8, color: '#475569', background: '#fff' },
  widgetLabel:{ fontSize: 10, color: '#6b7280', textAlign: 'center' as const, lineHeight: 1.2 },
  crown:      { position: 'absolute', top: 4, right: 5, fontSize: 11, color: '#f59e0b' },
  sectionLabel:{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '16px 0 8px' },
  fontList:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  fontBtn:    { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, height: 64, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', color: '#111827' },
  fontBtnActive:{ borderColor: '#4F46E5', background: '#eef2ff', boxShadow: '0 0 0 1px #4F46E5 inset' },
  fontName:   { fontSize: 10, color: '#6b7280', fontFamily: 'Inter, sans-serif' },
  iconGrid:   { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 },
  iconBtn:    { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, height: 64, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', color: '#334155' },
  iconName:   { fontSize: 9, color: '#9ca3af', lineHeight: 1 },
  bankGrid:   { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 4 },
  bankItemWrap: { position: 'relative' as const, aspectRatio: '1' },
  bankItem:   { padding: 0, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', cursor: 'pointer', background: '#fff', width: '100%', height: '100%', display: 'block' },
  bankImg:    { width: '100%', height: '100%', objectFit: 'cover' as const, display: 'block' },
  bankDelBtn: { position: 'absolute' as const, top: 3, right: 3, width: 20, height: 20, padding: 0, border: 'none', borderRadius: '50%', background: 'rgba(220,38,38,.92)', color: '#fff', fontSize: 11, lineHeight: '20px', textAlign: 'center' as const, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.3)' },
}

const cfg: Record<string, React.CSSProperties> = {
  groupLabel: { fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8 },
  sizeBox:    { flex: 1, border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 10px', fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 },
  sizeLabel:  { fontSize: 10, color: '#9ca3af', fontWeight: 700 },
  scheme:     { display: 'flex', alignItems: 'center', gap: 8, padding: 6, border: '1px solid #f3f4f6', borderRadius: 8 },
  swatch:     { width: 18, height: 18, borderRadius: 4, cursor: 'pointer', display: 'inline-block' },
  schemeName: { fontSize: 11, color: '#6b7280' },
  applyAll:   { width: '100%', marginTop: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 6, padding: '7px', fontSize: 12, color: '#374151', cursor: 'pointer', fontWeight: 500 },
}

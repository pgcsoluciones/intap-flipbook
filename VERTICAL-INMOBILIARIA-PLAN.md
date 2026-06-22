# Intap Flip — Plan de trabajo: Vertical Inmobiliaria/Construcción + Mejoras Globales

**Repo:** `pgcsoluciones/intap-flipbook` (branch `claude/kind-shannon-udb4qo`)
**Fecha de planeación:** Junio 2026
**Estado:** Documento de propuesta — nada de esto está codificado todavía. Es la fuente de verdad para redactar tareas/prompts a Claude Code, fase por fase, con confirmación entre cada una.

---

## 0. Principio rector del diseño

> **Mobile-first / tablet-first.** Todo lo que se construya — interactividad, visuales, tamaños de zona clicable, modales, galerías — se diseña y prueba primero pensando en pantalla táctil (celular/tablet). El escritorio es el caso secundario, no al revés.

> **Features globales por defecto.** Toda funcionalidad nueva se construye disponible para cualquier tenant del SaaS. Solo se vuelve "específica de vertical" cuando el dato/comportamiento no tiene sentido fuera de inmobiliaria/construcción (ej. estado de unidad: disponible/reservada/vendida).

---

## 1. Gap analysis — Auditoría del estado actual (Fase 1)

### Ya existe en el repo
- Modelo base: `publications`, `pages`, `categories`, `templates`/`template_pages`
- Analítica base: `page_events` (clics por tipo: link/whatsapp/call/widget + tiempo por página + dispositivo)
- Leads: `form_responses` (formularios de contacto y cuestionarios)
- Sistema de "forma clicable + acción" en el editor (Fabric.js): cualquier zona dibujada en una página puede tener una acción asignada (`link`, `call`, `email`, `whatsapp`, `popup_text`, `popup_image`, `popup_video`, `download`, `show_hide`, `page`)
- Widgets de canvas: `map`, `video`, `audio`, `whatsapp`, `qr`, `table`, `like`, `download`, `embed`, `contact`, `quiz`, `popup_banner` (trigger por tiempo)
- Slug de tenant (`users.slug`) y convención de URL `{slug-tenant}/{slug-flipbook}` (documentada, no implementada como listado público)
- Patrón de aprobación reutilizable: `plan_requests` (status pending/approved/rejected + resolved_by/resolved_at)
- Sistema de papelera/eliminación **(con bug crítico, ver sección 5)**

### No existe — confirmado por auditoría de código
- Galería/modal de imágenes y de videos (ver más imágenes/videos en una página)
- Audio emergente como acción de zona clicable (hoy solo widget fijo)
- Categoría/plantilla "Inmobiliaria/Construcción"
- Entidad "Unidad" estructurada (disponible/reservada/vendida, precio, m²)
- Carga semi-automatizada de contenido por lote
- Logo/branding propio del tenant (solo existe el logo de marca de agua de Intap)
- Datos de contacto empresarial por defecto a nivel de perfil de tenant
- Pre-carga de datos de proyecto al crear un flipbook
- Multiusuario / permisos por sub-usuario
- Feed o galería pública de flipbooks por tenant
- Plantillas creadas por el propio tenant (hoy solo las crea admin de Intap)
- Portada designada por galería de imágenes
- Edición centralizada tipo CMS (datos → se reflejan solos en las páginas)
- Reporte/moderación de contenido público
- Geolocalización en estadísticas
- Backup/exportación de datos del tenant

---

## 2. Modelo de datos (Fase 2)

| Cambio | Detalle | Alcance |
|---|---|---|
| `users` +columnas | `logo_url`, `contact_phone`, `contact_whatsapp`, `contact_email`, `contact_address` | Global |
| `publications` +columnas | `project_phone`, `project_whatsapp`, `project_location`, `project_address` (pre-cargan widgets al crear; si vacíos, usan los del perfil del tenant) | Global |
| Tabla nueva `units` | `id`, `publication_id`, `page_id`, `name`, `status` (available/reserved/sold), `price`, `area_m2`, `bedrooms`, `description` | Específico de vertical |
| Acción `popup_banner` | Sumarla al menú de acciones de zona clicable (ya existe como widget de delay; ahora también disponible al hacer clic en una zona) — opcional `unit_id` para vincular a una unidad | Global |
| Acción `popup_audio` | Nueva, mismo patrón que `popup_video`/`popup_image` | Global |
| Acción `gallery_images` | Modal/carrusel de imágenes — incluye campo de portada de la galería | Global |
| Acción `gallery_videos` | Modal/carrusel de varios videos (distinto de `popup_video`, que es uno solo) | Global |

---

## 3. Plantilla vertical + carga de contenido (Fase 3)

1. **Categoría + plantilla "Inmobiliaria/Construcción"**: páginas tipo predefinidas (portada de proyecto, ubicación/mapa, fachada, plantas/unidades, amenidades, financiamiento, contacto final)
2. **Modelo CMS-céntrico** (en vez de solo carga inicial por lote): la plantilla define zonas/campos editables (imágenes, galerías, datos de descripción/precio) en un panel central; al cargar/actualizar datos ahí, las páginas del flip se actualizan automáticamente — sin edición manual página por página
3. **Categorización de imágenes al subir**: cada imagen se etiqueta (fachada/planta/amenidad/unidad/ubicación) y, si pertenece a una galería, se marca cuál es la portada
4. **Auto-colocación por reglas** (v1 sin IA): cada categoría de imagen va a su página tipo correspondiente; si sobran imágenes de una categoría, se agregan páginas adicionales del mismo tipo automáticamente
5. **Revisión final antes de publicar**: vista de borrador donde el tenant ajusta lo que la auto-colocación dejó listo (80-90% del trabajo ya hecho)

---

## 4. Funcionalidades globales nuevas (catálogo completo)

| # | Característica | Mecanismo propuesto | Prioridad sugerida |
|---|---|---|---|
| A | Acción `zone_click` para pop-ups | *(resuelto: se reutiliza el sistema de zona clicable existente, ver sección 2)* | — |
| B | Logo/branding del tenant | Campo `logo_url` en `users`, insertable en portada/contacto del flip | Vertical / alta |
| C | Pre-carga de datos al crear proyecto | Formulario inicial → pre-llena widgets whatsapp/map/contact | Vertical / alta |
| D | Contacto empresarial por defecto en perfil | Fallback automático si el proyecto no define los suyos | Vertical / alta |
| E | Multiusuario + permisos por plan | Tabla de miembros de equipo + roles, límite según plan | **Backlog** |
| F | Feed/galería pública de flipbooks por tenant | Nueva ruta pública en el viewer, listando por `users.slug` | Media |
| G | Tenant crea sus propias plantillas | Estado `pending` → aprobación admin obligatoria (mismo patrón que `plan_requests`) antes de publicarse en catálogo | Media |
| H | Portada por galería | Campo dentro del config JSON de cada galería | Junto con A/galerías |
| I | Edición CMS-céntrica | Ver sección 3, punto 2 | Vertical / alta |
| J | Moderación de contenido público | Reactivo: botón "reportar" + cola de revisión admin + `publications.status = 'suspended'` | Media |
| — | IA de moderación automática al subir imagen | **Backlog** — capa futura sobre J | Backlog |
| K | **Bug crítico de eliminación** | Ver sección 5 — corregir antes de cualquier feature nueva | **Urgente** |
| L | Estadísticas individuales por flipbook (clic en listado → abre vista dedicada) | Ya existe filtro `selectedPub`; falta confirmar/completar la vista dedicada | Media |
| M | Estadísticas con metadata completa (páginas, tiempo, clics, dispositivo, geolocalización) | Geolocalización vía IP usando `request.cf` de Cloudflare (sin pedir permiso al visitante) | Media |
| N | **Bug: flip perdió flexibilidad** | Causa probable: `size: 'fixed'` en config de PageFlip → cambiar a `'stretch'` | **Alta** (afecta mobile-first) |
| O | Backup/exportación de datos del tenant | **Admin-only primero** (genera backup manualmente desde panel admin); ruta de autoservicio queda planteada para después, reusando la misma lógica de empaquetado | Media |

---

## 5. Bug crítico — Eliminación de flipbooks (Punto K)

**Diagnóstico confirmado en código:**

1. El botón "eliminar" en el listado pregunta "¿Mover a papelera?"
2. Al confirmar, el frontend llama al endpoint real `DELETE /api/publications/:id`, que **borra permanentemente** de la base de datos (páginas + publicación) — sin posibilidad de recuperación
3. El frontend solo **simula** una papelera guardando una copia en memoria (`setTrash`) — no en el servidor
4. "Restaurar" y "Eliminar definitivamente" en la papelera **no llaman a ningún endpoint** — son decorativos; el contenido ya fue destruido en el paso 2

**Riesgo:** cualquier tenant que use "eliminar" pensando que es reversible pierde su flipbook (y sus imágenes referenciadas) para siempre, sin aviso real de que es definitivo.

**Corrección necesaria:**
- Backend: implementar borrado suave real (`status = 'trashed'` + `deleted_at` en `publications`), el `DELETE` físico solo se ejecuta al confirmar "eliminar definitivamente" desde la papelera
- Conectar `handleRestore` y `handlePermanentDelete` a endpoints reales
- Revisar limpieza de imágenes huérfanas en R2 al eliminar definitivamente

**Prioridad: corregir antes de construir cualquier feature nueva de esta lista.**

---

## 6. Próximos pasos

1. Confirmar este documento como fuente de verdad
2. Redactar la Fase 4 (interactividad: galerías, audio emergente — ya con base en lo que existe)
3. Convertir cada bloque aprobado en tareas/prompts concretos para Claude Code, respetando el flujo de trabajo ya establecido en el `CLAUDE.md` del repo: modo aprendiz, español, máximo 4 pasos por fase, confirmación antes de avanzar, sin deploys sin aprobación explícita

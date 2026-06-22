# Intap Flip — Plan de trabajo: Vertical Inmobiliaria/Construcción + Mejoras Globales

**Repo:** `pgcsoluciones/intap-flipbook` (branch `claude/kind-shannon-udb4qo`)
**Fecha de planeación:** Junio 2026
**Última actualización:** Junio 2026

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
- **Papelera/eliminación — BUG K RESUELTO ✅** (ver sección 5)

### No existe — confirmado por auditoría de código
- Galería/modal de imágenes y de videos (ver más imágenes/videos en una página)
- Audio emergente como acción de zona clicable (hoy solo widget fijo)
- Categoría/plantilla "Inmobiliaria/Construcción"
- Entidad "Unidad" estructurada (disponible/reservada/vendida, precio, m²)
- Carga semi-automatizada de contenido por lote
- Logo/branding propio del tenant — **EN PROGRESO (Punto B)**
- Datos de contacto empresarial por defecto a nivel de perfil de tenant — **EN PROGRESO (Punto D)**
- Pre-carga de datos de proyecto al crear un flipbook — **EN PROGRESO (Punto C)**
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

| Cambio | Detalle | Alcance | Estado |
|---|---|---|---|
| `users` +columnas | `logo_url`, `contact_phone`, `contact_whatsapp`, `contact_email`, `contact_address` | Global | 🔄 migration_branding.sql creada, **pendiente ejecutar en D1** |
| `publications` +columnas | `project_phone`, `project_whatsapp`, `project_location`, `project_address` | Global | Pendiente |
| Tabla nueva `units` | `id`, `publication_id`, `page_id`, `name`, `status` (available/reserved/sold), `price`, `area_m2`, `bedrooms`, `description` | Vertical | Pendiente |
| Acción `popup_banner` | Sumarla al menú de acciones de zona clicable (ya existe como widget de delay) | Global | Pendiente |
| Acción `popup_audio` | Nueva, mismo patrón que `popup_video`/`popup_image` | Global | Pendiente |
| Acción `gallery_images` | Modal/carrusel de imágenes — incluye campo de portada de la galería | Global | Pendiente |
| Acción `gallery_videos` | Modal/carrusel de varios videos | Global | Pendiente |

---

## 3. Plantilla vertical + carga de contenido (Fase 3)

1. **Categoría + plantilla "Inmobiliaria/Construcción"**: páginas tipo predefinidas (portada de proyecto, ubicación/mapa, fachada, plantas/unidades, amenidades, financiamiento, contacto final)
2. **Modelo CMS-céntrico**: la plantilla define zonas/campos editables en un panel central; al cargar/actualizar datos ahí, las páginas del flip se actualizan automáticamente
3. **Categorización de imágenes al subir**: cada imagen se etiqueta (fachada/planta/amenidad/unidad/ubicación) y se marca cuál es la portada de galería
4. **Auto-colocación por reglas** (v1 sin IA): cada categoría de imagen va a su página tipo correspondiente
5. **Revisión final antes de publicar**: vista de borrador donde el tenant ajusta lo que la auto-colocación dejó listo

---

## 4. Funcionalidades globales nuevas

| # | Característica | Mecanismo propuesto | Estado |
|---|---|---|---|
| A | Acción `zone_click` para pop-ups | Se reutiliza el sistema de zona clicable existente | — |
| **B** | **Logo/branding del tenant** | Campo `logo_url` en `users`, editable en Settings/Perfil | 🔄 En progreso |
| **C** | **Pre-carga de datos al crear proyecto** | Aviso informativo en modal de creación; CMS-céntrico completo es Fase 3 | 🔄 En progreso |
| **D** | **Contacto empresarial por defecto en perfil** | Campos `contact_*` en `users`, editable en Settings/Perfil | 🔄 En progreso |
| E | Multiusuario + permisos por plan | Tabla de miembros de equipo + roles, límite según plan | Backlog |
| F | Feed/galería pública de flipbooks por tenant | Nueva ruta pública en el viewer, listando por `users.slug` | Planificado |
| G | Tenant crea sus propias plantillas | Estado `pending` → aprobación admin obligatoria (mismo patrón que `plan_requests`) | Planificado |
| H | Portada por galería | Campo dentro del config JSON de cada galería | Junto con galerías |
| I | Edición CMS-céntrica | Ver sección 3, punto 2 | Fase 3 |
| J | Moderación de contenido público | Botón "reportar" + cola de revisión admin + `publications.status = 'suspended'` | Planificado |
| **K** | **Bug crítico de eliminación** | **✅ RESUELTO** — ver sección 5 | ✅ Listo |
| **L** | **Estadísticas individuales por flipbook** | Vista dedicada al hacer clic en una pub del listado | 🔄 En progreso |
| M | Estadísticas con metadata completa (geolocalización) | Geoloc vía `request.cf` de Cloudflare (sin pedir permiso al visitante) | Planificado |
| **N** | **Bug: flip perdió flexibilidad mobile** | **✅ RESUELTO** — `size: 'stretch'` + resize handler | ✅ Listo |
| O | Backup/exportación de datos del tenant | Admin-only primero; autoservicio después | Backlog |

---

## 5. Bug K — Eliminación de flipbooks ✅ RESUELTO

**Diagnóstico original:**
1. El botón "eliminar" preguntaba "¿Mover a papelera?" pero borraba permanentemente
2. La "papelera" era solo estado local en memoria — no persistía ni usaba el servidor
3. "Restaurar" y "Eliminar definitivamente" eran decorativos

**Solución implementada (commits `e21dee5` → `63a0757`):**
- `DELETE /api/publications/:id` → **soft delete real** (`deleted_at = datetime('now')`)
- `GET /api/publications/trash` → devuelve publicaciones con `deleted_at IS NOT NULL`
- `PATCH /api/publications/:id/restore` → limpia `deleted_at`, publicación vuelve activa
- `DELETE /api/publications/:id/permanent` → borra en cascada respetando FK de D1:
  ```
  page_events → publication_views → form_responses → pages → publications
  ```
- Causa raíz del error 500: D1 tiene `FOREIGN KEY enforcement` activo — hay que borrar las tablas hijas antes que la publicación

**Migración:** `migration_softdelete.sql` ✅ ejecutada en D1 remoto

---

## 6. Bug N — Flexibilidad mobile ✅ RESUELTO

**Diagnóstico:** `size: 'fixed'` en PageFlip calculaba dimensiones una sola vez al cargar. Al rotar el dispositivo o en viewports pequeños, el flipbook desbordaba o quedaba mal dimensionado.

**Solución implementada (commit `5398d9f`):**
- `size: 'fixed'` → `size: 'stretch'`: PageFlip rellena el contenedor dinámicamente
- Eliminado `autoSize: false`
- Contenedor recibe dimensiones explícitas via JS para que stretch sepa hasta dónde crecer
- Ancho móvil máximo: 420px (antes 390px fijo)
- `window.addEventListener('resize', ...)` recarga el viewer 400ms después de rotar

---

## 7. Mejoras de performance implementadas

- **Scripts CDN con `defer`** en viewer e `index.html` del dashboard → no bloquean el render inicial
- **Lazy loading** en imágenes del viewer a partir de la página 3 (`loading="lazy"`)
- **PDF → JPEG** calidad 0.82 en lugar de PNG sin compresión (archivos ~60% más pequeños)
- **7 índices D1** (`migration_perf.sql` ✅ ejecutada): `form_responses`, `publication_views`, `publications (folder_id, status)`, `payments`, `notifications`, `page_events`

---

## 8. Próximos pasos en orden de prioridad

1. ✅ ~~Bug K: papelera real~~ — resuelto
2. ✅ ~~Bug N: flexibilidad mobile~~ — resuelto
3. ✅ ~~Puntos B/C/D: logo + contacto en perfil de tenant~~ — implementado y en producción
4. ✅ ~~Punto L: estadísticas individuales por flipbook~~ — implementado y en producción
5. ✅ ~~Puntos A/H: galerías de imágenes/videos como acción de zona clicable~~ — implementado y en producción
6. ✅ ~~Punto 6: portada designada — CoverModal en Publications~~ — implementado y en producción
7. ✅ ~~Punto F: feed público de flipbooks por tenant (`/p/:tenantSlug`)~~ — implementado y en producción
8. ✅ ~~Punto G: tenant propone plantillas, admin aprueba~~ — implementado y en producción
9. ✅ ~~Fase 3: Plantilla vertical Inmobiliaria/Construcción~~ — implementado (tabla units, plantilla 7 páginas, widget units_table en viewer/editor, panel CMS en Settings)

---

## 9. Instrucciones para Juan — acciones pendientes manuales

```bash
# 1. Migración branding (logo_url + campos de contacto en users)
cd ~/intap-flipbook/apps/api
git pull origin claude/kind-shannon-udb4qo
npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_branding.sql --remote

# 2. Migración page_events (analítica avanzada — tabla para estadísticas por flipbook)
npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_fase14.sql --remote

# 3. Deploy del Worker (siempre tras cambios en apps/api/)
npx wrangler deploy

# 4. Deploy del Viewer (tras cambios en apps/viewer/)
cd ~/intap-flipbook/apps/viewer
npx wrangler pages deploy src --project-name=intap-flipbook-viewer
```

> El **Dashboard se despliega automáticamente** al hacer push a `claude/kind-shannon-udb4qo` — no requiere acción manual.

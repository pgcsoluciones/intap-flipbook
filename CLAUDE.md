# CLAUDE.md — Intap Flipbook

> Archivo de memoria permanente para Claude Code. Léelo completo antes de hacer cualquier cambio.

---

## 🧠 Modo de trabajo

- Idioma: **siempre español**
- Estilo: **modo aprendiz** — explica cada término técnico nuevo inline
- Fases de máximo **4 pasos** — esperar confirmación antes de avanzar
- **Nunca hacer deploy sin aprobación explícita de Juan**
- **Nunca cambiar el stack tecnológico**

---

## 📦 Repositorio

- **GitHub:** `pgcsoluciones/intap-flipbook`
- **Rama de trabajo:** `claude/kind-shannon-udb4qo`
- **Rama principal:** `main`
- **CI/CD:** Cloudflare Pages conectado a GitHub — deploy automático al hacer push a `claude/kind-shannon-udb4qo` (rama de producción configurada en Pages)

---

## 🏗️ Arquitectura

| Componente | Tecnología | URL de producción |
|-----------|-----------|-------------------|
| API | Cloudflare Workers + Hono.js | `intap-flipbook-api.fliaprince.workers.dev` |
| Dashboard | React/Vite → Cloudflare Pages | `studio.flip.intaprd.com` / `intap-flipbook-dashboard.pages.dev` |
| Viewer | HTML/JS estático → Cloudflare Pages | `intap-flipbook-viewer.pages.dev` |
| Base de datos | Cloudflare D1 (SQLite serverless) | `intap-flipbook-db` |
| Archivos/imágenes | Cloudflare R2 | `intap-flipbook-media` |
| Sesiones | Cloudflare KV | `SESSIONS` |

### Estructura del monorepo

```
intap-flipbook/
├── apps/
│   ├── api/              # Cloudflare Worker con Hono.js
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/   # auth.ts, publications.ts, pages.ts, upload.ts, admin.ts
│   │   │   ├── middleware/jwt.ts
│   │   │   ├── lib/      # r2.ts, jwt.ts, plans.ts
│   │   │   └── db/
│   │   │       ├── schema.sql                  # schema completo con seeds
│   │   │       ├── migration_fase8a.sql         # tablas fase 8A
│   │   │       ├── migration_fase8b.sql         # columna status en users/plans
│   │   │       ├── migration_fase11.sql         # tabla form_responses
│   │   │       ├── migration_fase14.sql         # tabla page_events (analítica avanzada)
│   │   │       ├── migration_softdelete.sql     # columna deleted_at en publications ✅ ejecutada
│   │   │       ├── migration_perf.sql           # 7 índices de performance ✅ ejecutada
│   │   │       └── migration_branding.sql       # logo_url + contacto en users ⚠️ pendiente ejecutar
│   │   └── wrangler.toml
│   ├── dashboard/        # React/Vite (panel del cliente y admin)
│   │   └── src/
│   │       ├── pages/    # Login, Register, Dashboard, Publications, EditPublication, Preview...
│   │       │             # + páginas tenant: TenantStats, TenantTemplates, TenantTutorials...
│   │       │             # + páginas admin: AdminDashboard, AdminTenants, AdminPlans, AdminModules...
│   │       └── components/ # AdminLayout, Layout, PlanBadge, PageGrid, ImageUploader, UsageBar
│   └── viewer/           # HTML/JS estático con StPageFlip
│       └── src/index.html + flipbook.js + style.css
└── packages/
    └── types/            # tipos TypeScript compartidos
```

---

## 🔑 Recursos Cloudflare

| Recurso | Nombre | ID |
|---------|--------|-----|
| D1 Database | `intap-flipbook-db` | `f5e1ca62-8487-4250-a9d4-851d4880dcb3` |
| KV Namespace | `SESSIONS` | `8a0d51a9b1334c0c9c65e04109731ded` |
| R2 Bucket | `intap-flipbook-media` | URL pública: `https://pub-b720f233e0f84125b246181d82f993da.r2.dev` |
| Secret | `JWT_SECRET` | configurado via wrangler secrets |

---

## ⚙️ Variables de entorno

### Worker — `apps/api/wrangler.toml`
```toml
CORS_ORIGIN = "https://flip.intaprd.com,https://studio.flip.intaprd.com,https://intap-flipbook-dashboard.pages.dev"
JWT_EXPIRY_DAYS = "7"
R2_PUBLIC_BASE_URL = "https://pub-b720f233e0f84125b246181d82f993da.r2.dev"
```

### Dashboard — Cloudflare Pages Settings (Variables de entorno en el panel web)
```
VITE_API_BASE_URL    = https://intap-flipbook-api.fliaprince.workers.dev
VITE_VIEWER_BASE_URL = https://intap-flipbook-viewer.pages.dev
```

---

## ✅ Historial de commits — todo en producción salvo lo indicado

| Commit | Contenido |
|--------|-----------|
| `8e78db7` | Fase 1 — Monorepo, wrangler.toml, schema D1, seeds |
| `68b23a2` | Fase 2 — Auth: register, login, JWT Web Crypto, middleware |
| `ad9a39b` | Fase 3+4 — CRUD publicaciones/páginas, upload R2, viewer público |
| `8ccc59d` | Fase 5+6 — Viewer flipbook (StPageFlip + sonido), dashboard React |
| `3518790` | Fase 7 — Límites por plan centralizados en `lib/plans.ts` |
| `d886178` | Fase 8 — Super Admin panel completo (13 páginas + API expandida) |
| `0c0f7b8` | Fase 9 — Rediseño Publications (modal drag&drop) + Editor profesional |
| `d6cf15d` | Fix — null guard páginas ilimitadas, toggle módulos, AdminStats resiliente |
| `666705a` | Fase 10a — Tipografías, galería de iconos SVG, widgets interactivos (11 tipos) |
| `915de4a` | Fase 10b — Banco de imágenes del proyecto en panel Imagen |
| `beb23b0` | Fase 10c — Navegador de páginas en editor, viewer: quiz/embed/popup_banner/hotspots/audio/video completos |
| `e93f1fd` | Fase 10d — Recursos admin: subida con Examinar + arrastrar/soltar (FileField) |
| `dc3278d` | Fix — Fabric.js via CDN en dashboard (bundle −310 KB, build sin npm install) |
| `cb79b47` | Fix — quitar `--remote` de `wrangler r2 object put` en import_templates.py |
| `035fa6a` | Fix editor crítico — foco al escribir, autoguardado vacío, clics en viewer |
| `2dc2bea` | Uploads en todo el editor, widget download, popup mejorado, clic sobre volteo |
| `091eeed` | Panel derecho estilo FlipHTML5 — Mapa con preview, QR live, tamaño/rotación |
| `0fb780d` | Fase 11 — Repositorio de respuestas (form_responses, TenantResponses) |
| `6a81c82` | "Usar plantilla" — POST /api/templates/:id/apply + modal en TenantTemplates |
| `bf8ce64` | Fase 12 — SVG editable, PDF→páginas (pdf.js), "Crear desde cero", plantillas inline |
| `1ca509f` | Fix — try/catch en handlePermanentDelete, perf: defer scripts, lazy loading |
| `e21dee5` | Fix Bug K paso 1 — soft delete real: DB.batch() → awaits secuenciales |
| `655ab5f` | Fix Bug K paso 2 — handler completo en try/catch, SELECT simplificado |
| `a96444c` | Fix Bug K paso 3 — borrar tablas hijas con FK antes de eliminar publication |
| `63a0757` | Fix Bug K paso 4 — safeDelete para tablas opcionales (page_events puede no existir) |
| `5398d9f` | Fix Bug N — size:'stretch' + resize handler para flexibilidad mobile-first en viewer |
| *(reciente)* | Punto B/C/D — logo_url + contacto en ProfilePage; migration_branding.sql ✅ ejecutada |
| *(reciente)* | Punto L — TenantStats con vista individual por flipbook (sparkline SVG, donut dispositivos, tabla tiempos) |
| *(reciente)* | Punto F — PublicFeed `/p/:tenantSlug` (página pública sin auth, grid de flipbooks del tenant) |
| *(reciente)* | Puntos A/H/6 — gallery_images + gallery_videos como acciones de zona en editor y viewer; portada designada (CoverModal) |
| *(reciente)* | Punto G — template_proposals: tenant propone, admin aprueba/rechaza (migration_tenant_templates.sql ✅ ejecutada) |
| `dbc97f6` | Punto L frontend — TenantStats con PubDetailPanel (analítica individual por flipbook) |

---

## 📦 Qué está implementado

### API (Hono.js en Cloudflare Workers)

- `POST /auth/register` + `POST /auth/login` + `GET /auth/me` + `PUT /auth/me` (incluye logo_url + contact_*)
- CRUD completo `/api/publications` con límites por plan
  - `GET /api/publications` — solo activas (`deleted_at IS NULL`)
  - `GET /api/publications/trash` — papelera (`deleted_at IS NOT NULL`)
  - `DELETE /api/publications/:id` — **soft delete** (mueve a papelera)
  - `PATCH /api/publications/:id/restore` — restaura de papelera
  - `DELETE /api/publications/:id/permanent` — borrado físico en cascada (page_events → publication_views → form_responses → pages → publications)
  - `POST /api/publications/:id/publish` — publica (requiere ≥1 página)
- CRUD páginas + reordenamiento (`POST /api/pages/reorder`)
- `POST /api/upload` → R2 (imágenes ≤10 MB, medios ≤50 MB)
- `GET /view/:slug` → endpoint público con canvas_json por página
- `POST /view/:slug/track` → registra vista
- `POST /view/:slug/event` → analítica avanzada (page_time, clics)
- `POST /view/:slug/response` → guarda respuestas de formularios/cuestionarios
- `GET /api/me/usage` + `GET /api/me/modules`
- `GET|POST /api/folders` + `PUT|DELETE /api/folders/:id` + `PATCH /api/publications/:id/folder`
- `GET /api/responses` + `GET /api/responses/unread-count` + `PATCH /api/responses/:id/read` + `DELETE /api/responses/:id`
- `POST /api/templates/:id/apply`
- `GET /view/feed/:tenantSlug` — feed público de flipbooks publicados de un tenant
- `POST /api/template-proposals` — tenant propone publicación como plantilla
- `GET /api/template-proposals` — tenant lista sus propuestas
- `GET /admin/template-proposals` — admin lista todas las propuestas
- `PATCH /admin/template-proposals/:id/approve` — admin aprueba (copia pub→template)
- `PATCH /admin/template-proposals/:id/reject` — admin rechaza con notas
- **Admin routes** `/admin/*`: users, plans, payments, gateways, modules, stats, notifications, promotions, referrals, branding, resources

### Viewer (`apps/viewer/src/`)

- StPageFlip via CDN — efecto de voltear páginas + sonido Web Audio API
- `size: 'stretch'` — se adapta al contenedor (mobile-first) ✅ Bug N resuelto
- Resize listener — recalcula dimensiones al rotar el dispositivo
- Lazy loading — imágenes a partir de la pág. 3 cargan en diferido
- Fabric.js 5.3 via CDN — renderiza `canvas_json` como overlay escalado
- Acciones: `link`, `page`, `call`, `email`, `whatsapp`, `popup_text`, `popup_image`, `popup_video`, `popup_audio`, `download`
- **`gallery_images`** — lightbox/carrusel de imágenes con flechas, miniaturas, Escape, swipe táctil ✅ nuevo
- **`gallery_videos`** — carrusel de videos con misma UX ✅ nuevo
- **Widgets** (11 tipos): mapa, video, audio, QR, tabla CSV, like, formulario de contacto, cuestionario, embed HTML, popup cintillo, download
- **Hotspots animados**: `hs-pulse`, `hs-blink`, `hs-ring`
- Analítica: tiempo por página (`page_time`), clics, dispositivo vía `sendBeacon`
- Miniaturas, zoom, autoplay, pantalla completa, compartir

### Dashboard React (`apps/dashboard/src/`)

- Login / Register con JWT en localStorage
- **Publications** (`Publications.tsx`): file manager con carpetas, tabs Activos/Papelera
  - Modal de creación: Desde cero / Cargar imágenes / Usar plantilla / Importar PDF
  - Botón "Crear desde cero" directo en el header
  - Plantillas inline por carpeta seleccionada
  - Soft delete real → papelera → restaurar / eliminar definitivamente
  - **CoverModal** — selecciona portada por página (miniatura) + guarda en `cover_image_url`
  - **"Proponer como plantilla"** — botón en publicaciones publicadas → `POST /api/template-proposals`
- **Editor** (`EditPublication.tsx`): Fabric.js canvas full-screen, autoguardado 1.2s
  - Import SVG editable (`fabric.loadSVGFromString`)
  - Import PDF → páginas JPEG (pdf.js 3.11 via CDN, escala 1.5, calidad 0.82)
  - Rail izquierdo: 10 paneles (Páginas, Plantillas, Texto, Imagen, Formas, Botones, Elementos, Enlace, Widgets, Subidas)
  - Navegador de páginas bajo el canvas
  - Panel derecho: propiedades por tipo, tipografía, color, tamaño, rotación
  - **Acciones de zona**: `gallery_images` (carrusel de imágenes + portada) y `gallery_videos` (carrusel de videos)
- **Respuestas** (`TenantResponses.tsx`): filtros, marcar leída, eliminar
- **Estadísticas** (`TenantStats.tsx`): ✅ lista de publicaciones clicable + `PubDetailPanel` con sparkline SVG de vistas, donut de dispositivos, tabla de tiempo por página, desglose de clics
- **Perfil** (`ProfilePage.tsx`): ✅ logo con upload a R2, campos phone/whatsapp/email/address, link al feed público
- **Feed público** (`PublicFeed.tsx`): ✅ ruta `/p/:tenantSlug` — grid de flipbooks publicados, sin auth, link al viewer
- **Admin (14 páginas)**: Dashboard, Tenants, Plans, Payments, Gateways, Modules, Resources, Promotions, Referrals, Branding, Notifications, Stats, Templates, **TemplateProposals** (nuevo)

### Límites por plan (`lib/plans.ts`)

| Plan | Precio | Publicaciones | Páginas | Storage | Sonido |
|------|--------|--------------|---------|---------|--------|
| Free | $0 | 1 | 10 | 50 MB | ❌ |
| Basic | $9.99/mes | 5 | 50 | 500 MB | ✅ |
| Pro | $29.99/mes | ilimitado | ilimitado | 5 GB | ✅ |

---

## 🔧 Deploy workflow

### Dashboard (automático)
Push a `claude/kind-shannon-udb4qo` → Cloudflare Pages hace build automático → `studio.flip.intaprd.com`

### Worker (manual, desde Mac de Juan)
```bash
cd ~/intap-flipbook/apps/api
git pull origin claude/kind-shannon-udb4qo
npx wrangler deploy
```
> ⚠️ Siempre hacer `git pull` ANTES de `npx wrangler deploy` para no desplegar código viejo.

### Viewer (manual, desde Mac de Juan)
```bash
cd ~/intap-flipbook/apps/viewer
npx wrangler pages deploy src --project-name=intap-flipbook-viewer
```

### D1 migrations (manual, desde Mac de Juan)
```bash
cd ~/intap-flipbook/apps/api
# Ejecutar solo las que aún no están aplicadas:
npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_softdelete.sql --remote     # ✅ ya ejecutada
npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_perf.sql --remote           # ✅ ya ejecutada
npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_fase11.sql --remote         # ✅ ya ejecutada
npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_branding.sql --remote       # ⚠️ PENDIENTE
npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_fase14.sql --remote         # ⚠️ pendiente verificar (page_events)
```

---

## 🚨 Bugs resueltos en esta sesión (jun-2026)

### ✅ Bug K — Papelera real (soft delete)
- `DELETE /api/publications/:id` ahora hace **soft delete** (`deleted_at = datetime('now')`)
- Papelera muestra publicaciones con `deleted_at IS NOT NULL`
- Restaurar: `PATCH /:id/restore` limpia `deleted_at`
- Eliminar definitivamente: borra en cascada respetando FK de D1 (`page_events` → `publication_views` → `form_responses` → `pages` → `publications`)
- Causa raíz del error 500 original: `SQLITE_CONSTRAINT_FOREIGNKEY` — D1 tiene FK enforcement activo

### ✅ Bug N — Flexibilidad mobile en viewer
- Cambiado `size: 'fixed'` → `size: 'stretch'` en PageFlip
- Ancho móvil: hasta 420px (antes 390px fijo)
- Resize listener: recarga el viewer 400ms después de rotar para recalcular dimensiones

### ✅ Performance
- Scripts CDN con `defer` (viewer + dashboard)
- Lazy loading en imágenes a partir de pág. 3 del viewer
- PDF → JPEG calidad 0.82 (antes PNG sin compresión)
- 7 índices nuevos en D1 (`migration_perf.sql`): `form_responses`, `publication_views`, `publications`, `payments`, `notifications`, `page_events`

---

## ⚠️ Pendiente de acción de Juan

| Tarea | Comando | Estado |
|-------|---------|--------|
| Migración branding (logo + contacto en users) | `npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_branding.sql --remote` | ✅ Ejecutada |
| Migración page_events (analítica avanzada) | `npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_fase14.sql --remote` | ✅ Ejecutada |
| Migración template_proposals | `npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_tenant_templates.sql --remote` | ✅ Ejecutada |
| Migración Fase 3 — tabla units | `npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_fase3_units.sql --remote` | ✅ Ejecutada |
| Migración Fase 3 — plantilla inmobiliaria | `npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_fase3_inmobiliaria_template.sql --remote` | ✅ Ejecutada |
| Migración Fase 3 — campos CMS del proyecto | `npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_fase3_project_fields.sql --remote` | ✅ Ejecutada |
| Migración analítica avanzada (country, city, referrer, url_destination) | `npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_analytics_advanced.sql --remote` | ✅ Ejecutada |
| Migración Biblioteca SVG (svg_families, svg_resources, svg_resource_versions) | `npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_svg_library.sql --remote` | ✅ Ejecutada (7 queries) |
| Deploy Worker (siempre tras cambios en `apps/api/`) | `cd ~/intap-flipbook/apps/api && git pull && npx wrangler deploy` | ✅ Ejecutado (Worker `5b74b7de` — incluye rutas SVG) |
| Deploy Viewer (tras cambios en `apps/viewer/`) | `cd ~/intap-flipbook/apps/viewer && npx wrangler pages deploy src --project-name=intap-flipbook-viewer` | ✅ Ejecutado |
| Crear tablas modules/plan_modules si no existen | Ver comandos más abajo | Pendiente verificar |

```bash
# Tablas modules y plan_modules (verificar si existen primero):
npx wrangler d1 execute intap-flipbook-db --remote --command="CREATE TABLE IF NOT EXISTS modules (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, active_globally INTEGER DEFAULT 1)"
npx wrangler d1 execute intap-flipbook-db --remote --command="CREATE TABLE IF NOT EXISTS plan_modules (plan_id TEXT NOT NULL, module_key TEXT NOT NULL, PRIMARY KEY (plan_id, module_key))"
```

---

## 📋 Pendientes de desarrollo

| Tarea | Estado |
|-------|--------|
| Stats individuales por flipbook (Punto L) | ✅ Implementado |
| Logo/branding tenant + contacto empresarial (Puntos B/C/D) | ✅ Implementado |
| Galerías — modal/carrusel de imágenes y videos como acción de zona (Puntos A/H) | ✅ Implementado |
| Portada designada (CoverModal en Publications) (Punto 6) | ✅ Implementado |
| Feed público de flipbooks por tenant (Punto F) | ✅ Implementado |
| Tenant crea sus propias plantillas — con aprobación admin (Punto G) | ✅ Implementado |
| **Fase 3 — Plantilla vertical Inmobiliaria** (páginas tipo + CMS-céntrico + entidad Unidades) | ✅ Implementado |
| Entidad Unidad (tabla `units`, widget `units_table` en viewer y editor, panel CMS en Settings) | ✅ Implementado |
| **Analítica avanzada** — geoloc `request.cf`, tablet detection, url_destination, país/links/páginas en dashboard | ✅ Implementado |
| Acción `popup_audio` (audio emergente en zona clicable) | ✅ Implementado |
| Acción `show_hide` en viewer (elementos nombrados) | ✅ Implementado |
| Borrar imágenes huérfanas del panel Cargas (Punto EE) | ✅ Implementado |
| **Biblioteca SVG Fase 1** — backend (migración 3 tablas, rutas `/admin/svg` + `/api/svg`, sanitización HTMLRewriter en `lib/svg.ts`) | ✅ Implementado + desplegado (Worker `5b74b7de`) |
| **Biblioteca SVG Fase 2** — gestor visual en Super Admin (`AdminSvg.tsx`: grilla, subida individual/lote drag&drop, familias, edición, archivar, eliminar definitivo, gating por plan/módulo) | ✅ Implementado + desplegado (Worker `3b4deb15`) |
| Biblioteca SVG — fixes post-deploy (sanitización segura sin romper xmlns, try/catch con error real, validación FK familia, miniatura `<img>` sin CORS, URL corta, DELETE /:id borra D1+R2) | ✅ Resuelto — 14 SVG suben y renderizan OK |
| Biblioteca SVG Fase 3 — selector en editor del tenant (panel "Biblioteca", candados premium 🔒, inserción como vector vía GET /api/svg/:id/raw, metadata svgResourceId+editable) | ✅ Implementado + desplegado (Worker `2435398d`) |
| Biblioteca SVG Fase 4 — organización por familias (agrupado + selector + búsqueda nombre/tags) y panel de propiedades SVG (color global, color por capa, trazo color/grosor, voltear) respetando permisos del admin | ✅ Implementado |
| Biblioteca SVG Fase 5 — SVG en botones (acordeón por familia, capas editables, slider de tamaño) + sync multi-página real (`syncGroupId` clona a todas las páginas al activar y propaga ediciones vía persistCanvas) | ✅ Implementado |
| Editor — reemplazo de imagen con modal (banco del proyecto + subir nueva, conserva posición/tamaño); subida de imagen al banco del flipbook (no inserta directo) | ✅ Implementado |
| Biblioteca SVG Fase 6 — RBAC granular (resources_manager, tenant_editor, tenant_viewer) | Pendiente |
| Alinear claves de módulos frontend ↔ D1 | Pendiente |
| AdminModules toggle — claves no coinciden | Pendiente |
| Multiusuario / permisos por sub-usuario (Punto E) | Backlog |
| Moderación de contenido público — botón reportar + suspender (Punto J) | Planificado |
| Geolocalización en estadísticas (via `request.cf`) (Punto M) | Planificado |
| Dominios personalizados (`*.intapflipbook.com`) | No configurado |
| Pagos / Stripe | No iniciado |
| Banners tenant: alerta >80% uso, período de gracia | No iniciado |
| Backup/exportación de datos del tenant | Backlog |

---

## 🔄 Script import_templates.py

```bash
# Desde Mac de Juan, en la carpeta apps/api:
cd ~/intap-flipbook/apps/api
git pull origin claude/kind-shannon-udb4qo
# Dry-run primero:
python3 scripts/import_templates.py ~/Downloads/intap_flip_generic_templates_v3.zip --dry-run
# Ejecución real:
python3 scripts/import_templates.py ~/Downloads/intap_flip_generic_templates_v3.zip
```
Idempotente — borra y re-inserta por nombre de plantilla. 8 plantillas ya importadas (48 imgs en R2, 82 queries en D1).

---

## 🚫 Reglas obligatorias

- No cambiar el stack (Workers, D1, R2, KV, Hono, React/Vite, StPageFlip, Fabric.js)
- No usar librerías externas para JWT — solo Web Crypto API nativa
- No hacer `wrangler deploy` ni push a `main` sin aprobación de Juan
- No instalar dependencias nuevas sin explicar para qué sirven
- Siempre explicar términos técnicos nuevos la primera vez que aparecen
- Siempre hacer `git pull` antes de `npx wrangler deploy`
- Las migraciones D1 solo las ejecuta Juan desde su Mac con `--remote`

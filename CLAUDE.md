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
│   │   │       ├── schema.sql             # schema completo con seeds
│   │   │       ├── migration_fase8a.sql   # tablas fase 8A (modules, publication_views, etc.)
│   │   │       └── migration_fase8b.sql   # columna status en users y plans
│   │   └── wrangler.toml
│   ├── dashboard/        # React/Vite (panel del cliente y admin)
│   │   └── src/
│   │       ├── pages/    # Login, Register, Dashboard, Publications, EditPublication, Preview...
│   │       │             # + páginas tenant: TenantStats, TenantTemplates, TenantTutorials...
│   │       │             # + páginas admin: AdminDashboard, AdminTenants, AdminPlans, AdminModules...
│   │       └── components/ # AdminLayout, Layout, PlanBadge, PageGrid, ImageUploader, UsageBar
│   └── viewer/           # HTML/JS estático con StPageFlip
│       └── src/index.html + flipbook.js
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

## ✅ Estado actual — Fases 1–10 completadas y en producción

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

### Qué está implementado

**API (Hono.js en Cloudflare Workers):**
- `POST /auth/register` + `POST /auth/login` + `GET /auth/me`
- CRUD completo `/api/publications` con límites por plan
- CRUD páginas + reordenamiento por batch (`PUT /api/publications/:id/pages/reorder`)
- `POST /api/upload` → R2 (valida JPG/PNG/WEBP, máx. 10 MB, tracking de `size_bytes`)
- `GET /view/:slug` → endpoint público, devuelve `canvas_json` por página
- `GET /api/me/usage` → estadísticas de uso del usuario autenticado
- **Admin routes** `/admin/*`: users, plans, payments, gateways, modules, stats, notifications, promotions, referrals, branding, resources (templates, elements, tutorials)

**Viewer (`apps/viewer`):**
- StPageFlip via CDN — efecto de voltear páginas + sonido
- Fabric.js 5.3 via CDN — renderiza `canvas_json` como overlay escalado sobre cada página
- Acciones al clic: `link`, `page`, `call`, `email`, `whatsapp`, `popup_text`, `popup_image`, `popup_video`, `download`
- **Widgets completos** (11 tipos): mapa (dirección o URL directa), video (YouTube/Vimeo/MP4 con autoplay/controls/muted/loop/poster), audio (con color de reproductor), QR, tabla CSV, like (localStorage), formulario de contacto (nombre/email/teléfono/comentario/campos obligatorios), cuestionario interactivo, embed HTML, popup cintillo (posición/delay/colores/imagen/botón/auto-dismiss)
- **Hotspots animados**: div CSS con clases `hs-pulse`, `hs-blink`, `hs-ring`
- Responsive: portrait móvil, landscape desktop

**Dashboard React (`apps/dashboard`):**
- Login / Register con JWT guardado en localStorage
- **Publications**: file manager, modal drag & drop multi-imagen
- **Editor** (`EditPublication.tsx`): Fabric.js canvas, autoguardado 1.2s
  - Rail izquierdo: Páginas, Plantillas, Texto (14 fuentes Google), Imagen (+ banco de imágenes del proyecto), Formas, Botones, Elementos (galería SVG categorizada + hotspots animados), Enlace (10 tipos de acción), Widgets (11 tipos), Subidas
  - **Navegador de páginas** bajo el canvas: ⟸ Primera / ◀ Anterior / Pág N/Total / ▶ Siguiente / ⟹ Última
  - Panel derecho: propiedades por tipo (texto/forma/botón/enlace/hotspot/widget), selector de tipografía, control de color
  - Tecla Delete/Backspace elimina el elemento seleccionado
  - Fix: `rightPanelRef` evita que el selector de color nativo cierre el panel
- **Recursos Admin**: Templates/Elements/Tutorials con `FileField` (Examinar + arrastar/soltar + URL)
- **Páginas tenant y Super Admin (13 páginas)** sin cambios

**Límites por plan (`lib/plans.ts`):**

| Plan | Precio | Publicaciones | Páginas | Storage | Sonido |
|------|--------|--------------|---------|---------|--------|
| Free | $0 | 1 | 10 | 50 MB | ❌ |
| Basic | $9.99/mes | 5 | 50 | 500 MB | ✅ |
| Pro | $29.99/mes | ilimitado | ilimitado | 5 GB | ✅ |

---

## 🚨 Estado de bugs / pendientes

### ✅ Resueltos
- `checkPageLimit()` retorna null para planes ilimitados (Pro)
- AdminStats resiliente (cada fetch independiente)
- Toggle módulos acepta `active` y `active_globally`
- Selector de color nativo no cierra el panel de propiedades
- Tecla Delete elimina elemento del canvas
- `fabric` externalizado en Vite → build sin `npm install` previo
- Tabla `publication_views` creada en D1 ✅
- Script `import_templates.py`: flag `--remote` eliminado de `wrangler r2 object put` (solo es necesario en `d1 execute`) ✅

### 🔄 Script import_templates.py — cómo usarlo
```bash
# Desde Mac de Juan, en la carpeta apps/api:
cd ~/intap-flipbook/apps/api
git pull origin claude/kind-shannon-udb4qo   # obtener el fix
# Dry-run primero (no sube nada, muestra lo que haría):
python3 scripts/import_templates.py ~/Downloads/intap_flip_generic_templates_v3.zip --dry-run
# Ejecución real:
python3 scripts/import_templates.py ~/Downloads/intap_flip_generic_templates_v3.zip
```
El script es **idempotente** (se puede volver a correr sin duplicar datos — borra y re-inserta por nombre de plantilla).

### ⚠️ Pendiente verificar
- **AdminModules toggle**: claves en D1 (`sound`, `editor`, `links`...) no coinciden con frontend (`editor_canvas`, `active_links`, `page_sound`...). El toggle no persiste.
- **Tablas `modules` y `plan_modules`**: ejecutar si aún no existen:
```bash
cd ~/intap-flipbook/apps/api
npx wrangler d1 execute intap-flipbook-db --remote --command="CREATE TABLE IF NOT EXISTS modules (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, active_globally INTEGER DEFAULT 1)"
npx wrangler d1 execute intap-flipbook-db --remote --command="CREATE TABLE IF NOT EXISTS plan_modules (plan_id TEXT NOT NULL, module_key TEXT NOT NULL, PRIMARY KEY (plan_id, module_key))"
```

---

## 🔧 Deploy workflow

### Dashboard (automático)
Push a `claude/kind-shannon-udb4qo` → Cloudflare Pages hace build automático → `studio.flip.intaprd.com`

### Worker (manual, desde Mac de Juan)
```bash
cd ~/intap-flipbook/apps/api && npx wrangler deploy
```

### D1 migrations (manual, desde Mac de Juan)
```bash
cd ~/intap-flipbook/apps/api
npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_fase8a.sql --remote
npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_fase8b.sql --remote
```

---

## 🆕 Editor FlipHTML5 + Viewer interactivo (commits 91b57b4 → f68f692)

- **Editor reescrito** (`EditPublication.tsx`): iconos SVG de línea consistentes, **autoguardado** (1.2s tras cada cambio + al cambiar de página + al cerrar pestaña), barra de herramientas (eliminar, duplicar, traer al frente/fondo).
- **Acciones por tipo de botón**: cada botón/zona de enlace guarda `data.action` con tipo: `link`, `page`, `call`, `email`, `popup_text`, `popup_image`, `show_hide`. Panel de propiedades cambia según el tipo de elemento (texto/forma/botón/enlace/imagen).
- **Responsive móvil**: `Layout` ahora usa sidebar tipo cajón con hamburguesa (`hooks/useIsMobile.ts`); catálogo (`Publications`) con header apilado, grid 150px y botones táctiles Editar/Vista previa.
- **Viewer** (`apps/viewer/flipbook.js`): carga Fabric.js 5.3 por CDN, renderiza `canvas_json` como overlay escalado sobre cada página y ejecuta las acciones al hacer clic. `show_hide` queda como no-op (requiere elementos nombrados, fase futura).
- **API** (`index.ts`): el endpoint público `/view/:slug` ahora devuelve `canvas_json` por página.

> ⚠️ **REQUIERE DEPLOY MANUAL DEL WORKER**: `cd ~/intap-flipbook/apps/api && npx wrangler deploy` — sin esto, el viewer no recibe `canvas_json` y los elementos/acciones no aparecen en publicaciones.

---

## 🆕 Tipografías + galería de iconos + widgets interactivos

- **Texto — librería de tipografías**: panel "Texto" con 14 fuentes (Inter, Poppins, Montserrat, Oswald, Bebas Neue, Roboto Slab, Merriweather, Playfair, Lobster, Pacifico, Dancing Script, Caveat, Georgia, Courier). Se elige una fuente y el texto nuevo la usa; el panel derecho tiene un selector "Tipografía" para cambiar la fuente del texto seleccionado. Las fuentes se cargan por Google Fonts en `apps/dashboard/index.html` **y** en `apps/viewer/src/index.html` (para que el visor las renderice igual).
- **Elementos — galería vectorial**: `ICON_LIBRARY` categorizada (Flechas, Negocio, Señales, Decorativos, Redes). Cada icono es SVG insertado con `fabric.loadSVGFromString` → objeto editable (`data.kind='icon'`), con control de color en el panel derecho.
- **Widgets interactivos**: Mapa, WhatsApp, Formulario de contacto, Video (YouTube/Vimeo/MP4), Audio, Código QR, Tabla, Me gusta (+ Incrustar/Cuestionario premium). En el editor se insertan como placeholder (`data.kind='widget'`, `data.widget={type,config}`) y se configuran en el panel derecho (`WidgetProps`). El visor (`flipbook.js → buildWidget`) reemplaza el placeholder por el componente real (iframe de mapa/video, form con `mailto`, enlace `wa.me`, QR vía `api.qrserver.com`, tabla HTML, contador de likes en localStorage).

> ⚠️ **REQUIERE REDEPLOY DEL VISOR** para que los widgets y las tipografías se vean en publicaciones:
> `cd ~/intap-flipbook/apps/viewer && npx wrangler pages deploy src --project-name=intap-flipbook-viewer`
> El Worker no necesita cambios (los widgets viajan dentro de `canvas_json`).

---

## 📋 Pendiente

| Tarea | Estado |
|-------|--------|
| Deploy Worker para `/view` con canvas_json | **Pendiente (Juan)** |
| Importar plantillas ZIP a R2 + D1 (re-correr script) | **Pendiente (Juan)** — hacer `git pull` y volver a ejecutar |
| Acción `show_hide` en viewer (elementos nombrados) | Pendiente |
| Alinear claves de módulos (frontend ↔ DB) | Pendiente |
| Migración D1 tablas nuevas (modules, publication_views) | `publication_views` ✅, `modules`/`plan_modules` pendiente verificar |
| Editor: mejorar visual al estilo FlipHTML5 (puntos activos, biblioteca elementos) | Planificado |
| Dominios personalizados (`*.intapflipbook.com`) | No configurado |
| Pagos / Stripe | No iniciado |
| Banners tenant: alerta >80% uso, período de gracia | No iniciado |

---

## 🚫 Reglas obligatorias

- No cambiar el stack (Workers, D1, R2, KV, Hono, React/Vite, StPageFlip, Fabric.js)
- No usar librerías externas para JWT — solo Web Crypto API nativa
- No hacer `wrangler deploy` ni push a `main` sin aprobación de Juan
- No instalar dependencias nuevas sin explicar para qué sirven
- Siempre explicar términos técnicos nuevos la primera vez que aparecen

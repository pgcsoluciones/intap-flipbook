# Bitácora — Intap Flipbook

**Fecha:** 16 de junio de 2026

---

## 2026-06-27 — Rama `feature/live-preview-image-adjustments`

- **Fix fondo A4 en editor:** `canvas_json` se sanitiza para no guardar ni cargar `backgroundImage`; el fondo visible se reinstala desde `image_url + cover_json` y `bgImgRef.current` queda sincronizado con `canvas.backgroundImage`.
- **Fix preview de pop-up en lienzo:** `buildPopupPreview(cfg, imageObj?)` queda como renderer único para creación y refresh. Las imágenes de preview usan caché por URL, se clonan para aplicar `imageZoom/imagePosX/imagePosY`, y el refresh reemplaza solo hijos del mismo `fabric.Group` del `popup_banner`.
- **Alcance:** no se tocó viewer, galería ni otros widgets. Sin commit, push ni deploy.

---

## ¿Qué es Intap Flipbook?

SaaS para crear revistas digitales interactivas (flipbooks) con efecto de paso de página. Stack 100% Cloudflare.

---

## Arquitectura

| Componente | Tecnología | URL |
|-----------|-----------|-----|
| API | Cloudflare Workers + Hono.js | `intap-flipbook-api.fliaprince.workers.dev` |
| Dashboard | React/Vite → Cloudflare Pages | `intap-flipbook-dashboard.pages.dev` |
| Viewer | HTML/JS estático → Cloudflare Pages | `intap-flipbook-viewer.pages.dev` |
| Base de datos | Cloudflare D1 (SQLite) | `intap-flipbook-db` |
| Archivos | Cloudflare R2 | `intap-flipbook-media` |
| Sesiones | Cloudflare KV | `SESSIONS` |

---

## Fases completadas

### ✅ Fase 1 — Estructura del repo
- Monorepo con npm workspaces
- `apps/api/`, `apps/dashboard/`, `apps/viewer/`, `packages/types/`
- `wrangler.toml` con IDs reales de Cloudflare
- `CLAUDE.md` con guía del proyecto

### ✅ Fase 2 — Autenticación
- Register / Login con hash PBKDF2 (100,000 iteraciones)
- JWT firmado con Web Crypto API HMAC-SHA256 (sin librerías externas)
- Middleware de autenticación para rutas protegidas

### ✅ Fase 3 — CRUD Publicaciones y Páginas
- Crear, editar, eliminar publicaciones
- Agregar, editar, eliminar, reordenar páginas
- Endpoint `/view/:slug` público para el viewer

### ✅ Fase 4 — Upload de imágenes a R2
- Multipart form upload validado (tipo + tamaño máx. 10 MB)
- Almacena `size_bytes` por página para tracking de storage
- Retorna URL pública construida con `R2_PUBLIC_BASE_URL`

### ✅ Fase 5 — Viewer público
- `apps/viewer/src/index.html` + `flipbook.js`
- StPageFlip via CDN para efecto de paso de página
- Sonido de hoja al girar (toggle 🔊/🔇)
- Responsive: portrait en móvil, landscape en desktop

### ✅ Fase 6 — Dashboard React/Vite
- Login/Register → Dashboard → Editor → Preview
- `ImageUploader` con drag & drop
- `PageGrid` con reorden ↑↓ y eliminación
- `PlanBadge` coloreado (Free / Basic / Pro)
- `UsageBar` con barras de uso por límite del plan

### ✅ Fase 7 — Límites por plan

| Plan | Precio | Publicaciones | Páginas | Storage | Sonido |
|------|--------|--------------|---------|---------|--------|
| Free | $0 | 1 | 10 | 50 MB | ❌ |
| Basic | $9.99/mes | 5 | 50 | 500 MB | ✅ |
| Pro | $29.99/mes | ilimitado | ilimitado | 5 GB | ✅ |

- `lib/plans.ts` centraliza toda la lógica de límites
- API rechaza con error descriptivo cuando se supera un límite

---

## Problemas resueltos

| Problema | Solución |
|----------|----------|
| TypeScript error `ImportMeta.env` | Creado `vite-env.d.ts` con tipos correctos |
| "Failed to fetch" en producción | Variables `VITE_API_BASE_URL` en Cloudflare Pages Settings |
| CORS con múltiples origins | `CORS_ORIGIN` comma-separated, matching en middleware |
| Solo se podía subir 1 imagen | `ImageUploader` actualizado con multi-upload + barra de progreso |
| D1 limit reached | Usuario eliminó una DB no usada |

---

## Pendiente

| Tarea | Estado |
|-------|--------|
| ⚠️ R2 URL pública | **Bloqueado** — necesita `Enable Public Development URL` en Cloudflare → R2 → intap-flipbook-media → Settings |
| Super Admin panel | No iniciado |
| Dominios personalizados (`*.intapflipbook.com`) | No configurados |
| Pagos / Stripe | No iniciado |

---

## Próximo paso inmediato

Ir a **Cloudflare Dashboard → R2 → intap-flipbook-media → Settings → Public Development URL → Enable**, copiar la URL generada (`https://pub-xxx.r2.dev`) y pasarla aquí para actualizar el Worker.

---

## Recursos Cloudflare

| Recurso | Nombre | ID / Binding |
|---------|--------|-------------|
| D1 Database | `intap-flipbook-db` | `f5e1ca62-8487-4250-a9d4-851d4880dcb3` |
| KV Namespace | `SESSIONS` | `8a0d51a9b1334c0c9c65e04109731ded` |
| R2 Bucket | `intap-flipbook-media` | — |
| Secret | `JWT_SECRET` | configurado via wrangler |

---

## Variables de entorno

### Worker (apps/api)
```toml
CORS_ORIGIN = "https://intap-flipbook-dashboard.pages.dev,https://f9ade95a.intap-flipbook-dashboard.pages.dev"
JWT_EXPIRY_DAYS = "7"
R2_PUBLIC_BASE_URL = "https://media.intapflipbook.com"  ← ACTUALIZAR con URL real de R2
```

### Dashboard (Cloudflare Pages Settings)
```
VITE_API_BASE_URL = https://intap-flipbook-api.fliaprince.workers.dev
VITE_VIEWER_BASE_URL = https://intap-flipbook-viewer.pages.dev
```

---

## Repositorio

- **GitHub:** `pgcsoluciones/intap-flipbook`
- **Rama de desarrollo:** `claude/kind-shannon-udb4qo`
- **Rama principal:** `main`
- **CI/CD:** Cloudflare Pages conectado a GitHub — deploy automático en cada push a `main`

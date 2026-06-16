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
- **CI/CD:** Cloudflare Pages conectado a GitHub — deploy automático al hacer push a `main`

---

## 🏗️ Arquitectura

| Componente | Tecnología | URL de producción |
|-----------|-----------|-------------------|
| API | Cloudflare Workers + Hono.js | `intap-flipbook-api.fliaprince.workers.dev` |
| Dashboard | React/Vite → Cloudflare Pages | `intap-flipbook-dashboard.pages.dev` |
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
│   │   │   ├── routes/   # auth.ts, publications.ts, pages.ts, upload.ts
│   │   │   ├── middleware/jwt.ts
│   │   │   ├── lib/      # r2.ts, jwt.ts, plans.ts
│   │   │   └── db/schema.sql
│   │   └── wrangler.toml
│   ├── dashboard/        # React/Vite (panel del cliente)
│   │   └── src/
│   │       ├── pages/    # Login, Register, Dashboard, Editor, Preview
│   │       └── components/ # ImageUploader, PageGrid, PlanBadge, UsageBar
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
| R2 Bucket | `intap-flipbook-media` | (sin ID asignado aún) |
| Secret | `JWT_SECRET` | configurado via wrangler secrets |

---

## ⚙️ Variables de entorno

### Worker — `apps/api/wrangler.toml`
```toml
CORS_ORIGIN = "https://intap-flipbook-dashboard.pages.dev,https://f9ade95a.intap-flipbook-dashboard.pages.dev"
JWT_EXPIRY_DAYS = "7"
R2_PUBLIC_BASE_URL = "https://pub-XXX.r2.dev"   # ⚠️ ACTUALIZAR con URL real del bucket público
```

### Dashboard — Cloudflare Pages Settings (Variables de entorno en el panel web)
```
VITE_API_BASE_URL    = https://intap-flipbook-api.fliaprince.workers.dev
VITE_VIEWER_BASE_URL = https://intap-flipbook-viewer.pages.dev
```

---

## ✅ Estado actual — 7 fases completadas

| Commit | Contenido |
|--------|-----------|
| `8e78db7` | Fase 1 — Monorepo, wrangler.toml, schema D1, seeds |
| `68b23a2` | Fase 2 — Auth: register, login, JWT Web Crypto, middleware |
| `ad9a39b` | Fase 3+4 — CRUD publicaciones/páginas, upload R2, viewer público |
| `8ccc59d` | Fase 5+6 — Viewer flipbook (StPageFlip + sonido), dashboard React |
| `3518790` | Fase 7 — Límites por plan centralizados en `lib/plans.ts` |

### Qué está implementado

**API (Hono.js en Cloudflare Workers):**
- `POST /auth/register` + `POST /auth/login` + `GET /auth/me`
- CRUD completo `/api/publications` con límites por plan
- CRUD páginas + reordenamiento por batch (`PUT /api/publications/:id/pages/reorder`)
- `POST /api/upload` → R2 (valida JPG/PNG/WEBP, máx. 10 MB, tracking de `size_bytes`)
- `GET /view/:slug` → endpoint público sin auth (para el viewer)
- `GET /api/me/usage` → estadísticas de uso del usuario autenticado

**Viewer (`apps/viewer`):**
- StPageFlip via CDN — efecto de voltear páginas
- Toggle de sonido 🔊/🔇
- Responsive: portrait en móvil, landscape en desktop

**Dashboard React (`apps/dashboard`):**
- Login / Register con JWT guardado en localStorage
- Lista de publicaciones con estado (borrador / publicado)
- Editor: subida de imágenes drag & drop con barra de progreso
- PageGrid con reordenamiento ↑↓ y eliminación
- Vista previa con iframe + link público copiable
- PlanBadge coloreado (Free / Basic / Pro)
- UsageBar: barra de uso de publicaciones, storage (MB), páginas

**Límites por plan (`lib/plans.ts`):**

| Plan | Precio | Publicaciones | Páginas | Storage | Sonido |
|------|--------|--------------|---------|---------|--------|
| Free | $0 | 1 | 10 | 50 MB | ❌ |
| Basic | $9.99/mes | 5 | 50 | 500 MB | ✅ |
| Pro | $29.99/mes | ilimitado | ilimitado | 5 GB | ✅ |

---

## 🐛 Problema activo — Vista previa y URL pública de R2

### Diagnóstico

El viewer y la vista previa del dashboard muestran imágenes rotas porque **R2 no tiene URL pública activada aún**.

El Worker construye las URLs de imágenes con la variable `R2_PUBLIC_BASE_URL`, que actualmente contiene un valor placeholder (`https://media.intapflipbook.com`) en lugar de la URL real del bucket.

### Pasos para resolverlo

1. Ir a **Cloudflare Dashboard → R2 → `intap-flipbook-media` → Settings → Public Development URL → Enable**
2. Copiar la URL generada (formato: `https://pub-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX.r2.dev`)
3. Actualizar `wrangler.toml` en `apps/api`:
   ```toml
   R2_PUBLIC_BASE_URL = "https://pub-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX.r2.dev"
   ```
4. Hacer deploy del Worker: `wrangler deploy` desde `apps/api/`
5. Verificar que las imágenes ya sucias en R2 tengan acceso público (pueden requerir re-upload)

### Cómo se usa R2_PUBLIC_BASE_URL en el código

En `apps/api/src/lib/r2.ts`, la URL pública se construye así:
```typescript
const publicUrl = `${env.R2_PUBLIC_BASE_URL}/${key}`;
```
Donde `key` es la ruta del archivo dentro del bucket (ej. `users/123/publications/456/page-1.jpg`).

---

## 📋 Pendiente

| Tarea | Estado |
|-------|--------|
| ⚠️ Activar R2 Public URL y actualizar Worker | **EN PROGRESO** |
| Verificar vista previa en dashboard tras fix de R2 | Pendiente |
| Verificar viewer público (`/view/:slug`) tras fix | Pendiente |
| Super Admin panel | No iniciado |
| Dominios personalizados (`*.intapflipbook.com`) | No configurado |
| Pagos / Stripe | No iniciado |

---

## 🚫 Reglas obligatorias

- No cambiar el stack (Workers, D1, R2, KV, Hono, React/Vite, StPageFlip)
- No usar librerías externas para JWT — solo Web Crypto API nativa
- No hacer `wrangler deploy` ni push a `main` sin aprobación de Juan
- No instalar dependencias nuevas sin explicar para qué sirven
- Siempre explicar términos técnicos nuevos la primera vez que aparecen

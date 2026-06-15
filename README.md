# Intap Flipbook

SaaS para crear revistas digitales interactivas con efecto flipbook.

## Stack

- **API**: Cloudflare Workers + Hono.js
- **DB**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2
- **Cache**: Cloudflare KV
- **Dashboard**: React + Vite (Cloudflare Pages)
- **Viewer**: HTML/JS con StPageFlip (Cloudflare Pages)

## Estructura

```
Apps:
  apps/api/        → Worker API (Hono)
  apps/dashboard/  → Panel cliente (React/Vite)
  apps/viewer/     → Flipbook público (HTML/JS)
Packages:
  packages/types/  → TypeScript types compartidos
```

## Setup inicial

```bash
# Crear recursos en Cloudflare
wrangler d1 create intap-flipbook-db
wrangler kv:namespace create SESSIONS
wrangler r2 bucket create intap-flipbook-media

# Aplicar schema
wrangler d1 execute intap-flipbook-db --file=apps/api/src/db/schema.sql

# Instalar dependencias
npm install
```

## Fases

- [x] Fase 1: Setup repo + wrangler.toml + schema D1 + seeds
- [ ] Fase 2: Auth Worker (register, login, JWT middleware)
- [ ] Fase 3: CRUD publicaciones + páginas
- [ ] Fase 4: Upload de imágenes a R2
- [ ] Fase 5: Viewer público con StPageFlip + sonido
- [ ] Fase 6: Dashboard React/Vite
- [ ] Fase 7: Límites por plan
- [ ] Fase 8: Deploy a producción

# Intap Flipbook — Guía para Claude Code

## Estructura del repositorio

```
apps/api/        → Worker API (Cloudflare Workers + Hono.js)
apps/dashboard/  → Panel cliente (React/Vite → Cloudflare Pages)
apps/viewer/     → Flipbook público (HTML/JS → Cloudflare Pages)
packages/types/  → TypeScript types compartidos
```

## Recursos Cloudflare necesarios

| Recurso | Nombre | Binding |
|---------|--------|---------|
| D1 Database | `intap-flipbook-db` | `DB` |
| KV Namespace | `SESSIONS` | `SESSIONS` |
| R2 Bucket | `intap-flipbook-media` | `MEDIA` |
| Secret | `JWT_SECRET` | — |

## Comandos de deploy

### Primera vez — crear recursos
```bash
wrangler d1 create intap-flipbook-db
wrangler kv namespace create SESSIONS
wrangler r2 bucket create intap-flipbook-media
```
Luego actualizar `apps/api/wrangler.toml` con los IDs que devuelve cada comando.

### Aplicar schema + seeds
```bash
wrangler d1 execute intap-flipbook-db --file=apps/api/src/db/schema.sql --remote
```

### Configurar secret JWT
```bash
wrangler secret put JWT_SECRET --name intap-flipbook-api
# Ingresa una cadena aleatoria larga cuando lo pida
```

### Deploy API
```bash
cd apps/api && wrangler deploy
```

### Deploy Dashboard
```bash
cd apps/dashboard && npm run build
npx wrangler pages deploy dist --project-name=intap-flipbook-dashboard
```

### Deploy Viewer
```bash
cd apps/viewer
npx wrangler pages deploy src --project-name=intap-flipbook-viewer
```

### Script todo-en-uno
```bash
bash scripts/deploy.sh all
```

## Dominios de producción

| Subdominio | Servicio Cloudflare |
|------------|-------------------|
| `api.intapflipbook.com` | Worker `intap-flipbook-api` |
| `app.intapflipbook.com` | Pages `intap-flipbook-dashboard` |
| `view.intapflipbook.com` | Pages `intap-flipbook-viewer` |

## Variables de entorno por app

### apps/api/wrangler.toml
```toml
[vars]
CORS_ORIGIN = "https://app.intapflipbook.com"
JWT_EXPIRY_DAYS = "7"
R2_PUBLIC_BASE_URL = "https://media.intapflipbook.com"
```

### apps/dashboard — variable de build
```
VITE_API_BASE_URL = https://api.intapflipbook.com
VITE_VIEWER_BASE_URL = https://view.intapflipbook.com
```

## Fases completadas

- [x] Fase 1: Estructura repo + wrangler.toml + schema D1 + seeds
- [x] Fase 2: Auth Worker (register, login, JWT Web Crypto API)
- [x] Fase 3: CRUD publicaciones + páginas
- [x] Fase 4: Upload imágenes a R2
- [x] Fase 5: Viewer público con StPageFlip + sonido
- [x] Fase 6: Dashboard React/Vite completo
- [x] Fase 7: Límites por plan (publicaciones, páginas, storage, sonido)
- [ ] Fase 8: Deploy a producción (dominios reales)

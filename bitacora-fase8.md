# Bitácora — Intap Flipbook (desde fix R2 en adelante)

## 📍 Rutas locales (Mac de Juan)

| Proyecto | Ruta |
|----------|------|
| Repo completo | `/Users/juanluis/intap-flipbook` |
| Viewer | `/Users/juanluis/intap-flipbook/apps/viewer` |
| Dashboard | `/Users/juanluis/intap-flipbook/apps/dashboard` |
| API | `/Users/juanluis/intap-flipbook/apps/api` |

**Comando de deploy del viewer:**
```bash
cd /Users/juanluis/intap-flipbook && git pull origin claude/kind-shannon-udb4qo && cd apps/viewer && npx wrangler pages deploy src --project-name=intap-flipbook-viewer
```

> Si wrangler pide autenticación, agregá `CLOUDFLARE_API_TOKEN=<tu-token>` al inicio del comando.

---

## ✅ Fix R2 Public URL

**Problema:** Las imágenes en el viewer y el dashboard se veían rotas porque `R2_PUBLIC_BASE_URL` apuntaba a `https://media.intapflipbook.com` (dominio inexistente).

**Solución:**
1. Juan activó la **Public Development URL** en Cloudflare Dashboard → R2 → `intap-flipbook-media` → Settings
2. URL real del bucket: `https://pub-b720f233e0f84125b246181d82f993da.r2.dev`
3. Se actualizó `apps/api/wrangler.toml` con esa URL
4. Se hizo deploy del Worker desde Mac local (`wrangler deploy`)

**Resultado:** Dashboard muestra thumbnails correctamente ✅

---

## ✅ Fix CORS del viewer

**Problema:** El viewer (`intap-flipbook-viewer.pages.dev`) recibía error CORS al llamar a la API porque su dominio no estaba en la lista de orígenes permitidos.

**Solución:** Se agregó `https://intap-flipbook-viewer.pages.dev` a `CORS_ORIGIN` en `wrangler.toml` y se redesplegó el Worker.

---

## ✅ Fix rutas absolutas en viewer

**Problema:** `style.css` y `flipbook.js` usaban rutas relativas. Como el viewer sirve en `/slug-del-catalogo`, el browser buscaba `/slug-del-catalogo/style.css` → 404.

**Solución:** Cambiar a rutas absolutas `/style.css` y `/flipbook.js` en `index.html`.

---

## ✅ Efecto de página flexible (tipo revista)

**Problema:** StPageFlip con `showCover: true` hace las cubiertas rígidas (no se doblan al pasar).

**Solución adoptada:** `showCover: false` + **páginas en blanco invisibles** (color `#1a1a2e` = fondo) al inicio y al final.

- Índice 0: blank → portada queda sola a la derecha del primer spread
- Índices 1..N: páginas reales
- Índice N+1: blank → contraportada queda sola a la izquierda del último spread
- Todas las páginas son flexibles (incluidas portada y contraportada)

---

## ✅ Centrado dinámico

**Problema:** El libro siempre ocupa 2×`pageWidth`, pero cuando muestra portada o contraportada solos, quedaba desplazado a un lado.

**Solución:** `transform: translateX()` sobre el contenedor del flipbook:

| Situación | Desplazamiento |
|-----------|---------------|
| Portada (primer spread) | `−pageWidth/2` — centra la portada (está a la derecha) |
| Contraportada (último spread) | `+pageWidth/2` — centra la contraportada (está a la izquierda) |
| Spreads interiores | Sin desplazamiento |

Se aplica en eventos `flip` y `changeState` de StPageFlip.

---

## ✅ Multi-upload con barra de progreso

**Mejora en `ImageUploader.tsx`:** El input `<file>` ahora acepta `multiple`. Las imágenes se suben secuencialmente mostrando "Subiendo X de Y imágenes..." con barra de progreso animada.

---

## ✅ PageGrid con portada/contraportada + drag & drop

**Mejora en `PageGrid.tsx`:** Rediseño completo con:

- Dos slots superiores destacados: **📖 Portada** (borde azul) y **📕 Contraportada** (borde gris)
- Grid de páginas interiores con drag & drop nativo HTML5 (sin librerías externas)
- Botones "↑ Portada" y "↓ Contra" en cada página interior
- Feedback visual mientras se arrastra (opacidad + borde punteado)

---

## ✅ Fix: página extra al final

**Commit:** `beed6f0`

**Problema:** Al pasar la contraportada aparecía una página más (el blank final se volvía visible).

**Solución:** Los botones Prev/Next ahora verifican el índice antes de ejecutar el flip:

- `btn-prev` deshabilitado cuando `idx <= 1`
- `btn-next` deshabilitado cuando `idx >= realCount`

CSS agrega estilo visual a los botones deshabilitados (`opacity: 0.3`).

---

## ✅ Sonido universal

**Commit:** `beed6f0`

**Cambio:** El sonido de página ahora se habilita para **todos los planes** por defecto. La lógica anterior condicionaba el sonido al campo `sound_enabled` de la API (que era `false` en el plan Free). Ahora `soundEnabled = data.sound_enabled !== false`, lo que deja la puerta abierta para desactivarlo desde la API en el futuro si se necesita, pero por defecto siempre está activo.

---

## ✅ Panel de miniaturas

**Commit:** `beed6f0`

**Nueva función:** Botón ⊟ en la barra de controles que despliega un panel horizontal con miniaturas de todas las páginas.

- Clic en una miniatura → el flipbook salta directamente a esa página
- El panel se cierra automáticamente al seleccionar una página
- También se cierra al hacer clic fuera del panel
- La miniatura activa se resalta con borde violeta
- Las imágenes se cargan con `loading="lazy"` para no afectar la carga inicial

---

## ✅ Botón pantalla completa

**Commit:** `beed6f0`

**Nueva función:** Botón ⛶ al final de los controles (después del botón de imprimir). Usa la API nativa del browser `requestFullscreen()` / `exitFullscreen()`. No requiere librerías externas.

---

## 📋 Estado actual

| Componente | Estado |
|-----------|--------|
| API Worker | ✅ Desplegado con R2 URL real + CORS correcto |
| Dashboard | ✅ Auto-deploy en Cloudflare Pages (rama conectada) |
| Viewer | ⚠️ Cambios en rama `claude/kind-shannon-udb4qo` — requiere deploy manual |

**Commit más reciente:** `beed6f0` en rama `claude/kind-shannon-udb4qo`

### Deploy pendiente del viewer

```bash
cd /ruta/local/intap-flipbook/apps/viewer
npx wrangler pages deploy src --project-name=intap-flipbook-viewer
```

---

## 📋 Próximas tareas

| Tarea | Estado |
|-------|--------|
| Super Admin panel | No iniciado |
| Dominios personalizados (`*.intapflipbook.com`) | No configurado |
| Pagos / Stripe | No iniciado |
| PDF → páginas automático | No iniciado |
| Analytics de vistas | No iniciado |
| Password protection por publicación | No iniciado |
| Embed code (iframe) | No iniciado |

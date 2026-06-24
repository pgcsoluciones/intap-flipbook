# 📋 Pliego de tareas — Intap Flipbook

> Pliego vivo de prioridades. Se va tildando a medida que avanzamos.

## ✅ Resueltas (sesión actual)
- Recorte/encuadre de hoja desbordado en el viewer → `background-image` (sin transform 3D).
- Última página suelta/rígida → paridad de páginas par en escritorio.
- Preview en vivo del ajuste de hoja/imagen en el editor (`dirty = true`).
- Mapa "estanco" → try/catch por widget en el render del viewer.
- Logos sociales gigantes → Iconify con tamaño fijo + escalado robusto.
- Widgets previsualizados en el lienzo (formulario, mapa, WhatsApp, etc.).
- QR + Código de barras como imagen real.
- Redes sociales con logos de marca.
- Audio/Video con biblioteca de botones de reproducción.
- Pop-up con ubicación "Personalizado".
- **C1 — Widget Galería / Slider** (auto-avance, flechas, puntos, swipe, transición).

## 🟢 Solicitudes nuevas (en cola)
- **C2 — Animaciones de entrada (estilo PowerPoint)**: dar animación de entrada a
  cualquier elemento/imagen/**texto** del lienzo. Tipo de transición, dirección de
  entrada, velocidad, retardo/orden. Configurable desde propiedades; se reproduce en
  el viewer al aparecer la página.
- **A3 — Preview vivo de widgets en el lienzo** (rehacer robusto): capa DOM real anclada
  a cada widget (mapa real, reproductor, formulario) con render perezoso.

## 🟡 Pendientes previos
- **B1** — Mapa rico: localizar punto exacto / enlace directo.
- **B2** — Formulario y Cuestionario editables visualmente (colores, tamaños, campos).
- **B3** — Inspector: acciones diferidas zoom-a-zona y abrir-cuestionario.
- **B4** — Biblioteca SVG Fase 6 (RBAC / permisos por sub-usuario).
- **B5** — Alinear claves de módulos frontend ↔ D1 (toggle AdminModules).
- **B6** — Backlog mayor: multiusuario, moderación de contenido público, dominios
  personalizados, pagos/Stripe.

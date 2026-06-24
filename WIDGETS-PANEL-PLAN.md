# Plan — Profesionalización del panel de Widgets + propiedades del panel derecho

**Repo:** `pgcsoluciones/intap-flipbook` · rama `claude/kind-shannon-udb4qo`
**Archivo principal:** `apps/dashboard/src/pages/EditPublication.tsx` (editor) · `apps/viewer/src/flipbook.js` (viewer)
**Fecha:** Junio 2026

---

## 0. Problema actual (verificado en código)

- **`addWidget()`** inserta **el mismo rectángulo punteado genérico** para todos los widgets: un `fabric.Group` con `rect` + texto del nombre + "Configura en el panel derecho →". No hay representación visual propia por tipo.
- El **visual real del widget solo existe en el viewer** (`buildOverlay` convierte el placeholder en mapa/iframe/botón/etc.). En el editor el usuario no ve lo que está creando.
- Los **elementos emergentes** (`popup_image`, `popup_video`, `popup_audio`, `popup_text`, mensaje, comentario) **siempre salen como modal centrado**; no se puede elegir **dónde** aparecen en la página.
- El **widget de Audio** no tiene botón/disparador personalizable: muestra el `<audio controls>` nativo.
- **QR** se ve solo en el viewer; **código de barras** no existe.
- Falta **edición visual en el lienzo** de Formulario y Cuestionario (color/tamaño).
- Faltan **iconos/logos** de redes sociales y comunicación como widgets.

---

## 1. Requisitos recogidos (de Juan)

1. Cada widget debe **representarse y previsualizarse en el lienzo con su icono/visual correspondiente**, no como rectángulo.
2. **Mapa**: traer el cuadro/embebido de mapa precargado; opción de **localizar el punto exacto** (búsqueda de lugar) **o por enlace** en el panel derecho.
3. **Redes sociales y comunicación**: widgets con sus **iconos/logos sociales** (de las librerías correspondientes), configurados con sus datos (número, usuario, URL) en el panel derecho.
4. **Cuestionario**: debe tener su **cuadro**, editable y configurable en **color y tamaño** visualmente en el lienzo.
5. **Formulario**: igual, **editarlo visualmente** en el lienzo.
6. **Elementos emergentes / pop-up** (texto, imagen, video, audio, mensaje, comentario): deben **salir en el área de la página que el usuario señale** — igual que se marca una zona clicable para un enlace, marcar **dónde aparece** el emergente.
7. **Audio**: opción de **seleccionar un estilo o botón de reproducir personalizable** como disparador.
8. **Código de barras**: debe estar **en el lienzo** para colocarlo con **tamaño y lugar** visualmente (igual que QR).
9. **Panel derecho**: edición más completa de propiedades, **global** (común a todos) y **por tipo de widget**.

---

## 2. Decisión de arquitectura (a confirmar con Juan)

El lienzo del editor es **Fabric.js puro** (canvas 2D). Fabric **no puede renderizar HTML vivo** (iframes de mapa/video, formularios reales). Hay dos caminos:

| Opción | Qué es | Pro | Contra |
|---|---|---|---|
| **A — Previews ricos en Fabric** (recomendado para empezar) | Cada widget se dibuja con su **icono/logo + tarjeta estilizada** (y QR/código de barras como imagen real) en el lienzo, colocable y redimensionable. La config va al panel derecho. | Incremental, bajo riesgo, no cambia la arquitectura. Resuelve el 80 % del pedido ("representado con su icono"). | El mapa/video/form no se ven "vivos" en el editor (sí en el viewer); se ven como tarjeta representativa. |
| **B — Overlays HTML sobre el lienzo** | Capa DOM encima del canvas con el widget **vivo** (iframe de mapa, formulario real), arrastrable/redimensionable, sincronizada con un ancla Fabric. | Editor nivel Canva/FlipHTML5 (lo más fiel). | Refactor grande del editor, mayor riesgo, más tiempo. |

**Recomendación:** empezar con **A** (previews ricos en Fabric) para todos los widgets, y dejar **B** (overlays HTML vivos para mapa/video/form) como fase avanzada opcional si después se quiere. La mayoría de lo que pides ("cada widget representado con su icono/logo, colocable y dimensionable") se logra con A.

---

## 3. Plan de ejecución ordenado (fases de máx. 4 pasos, con confirmación)

> Cada fase: dashboard (auto-deploy) + viewer (deploy de Juan) cuando aplique. Se verifica con checklist visual.

### Fase 1 — Representación visual en el lienzo (fundación)
- Reemplazar el placeholder genérico de `addWidget()` por una **tarjeta visual por tipo**: icono representativo + nombre + color de acento, dibujada con Fabric (icono SVG/glyph + rect). Tamaño por defecto adecuado a cada widget.
- Mapa, video, formulario, cuestionario, embed → tarjeta con su icono + etiqueta del dato principal (ej. "Mapa: Washington DC").
- Resultado: el editor "se ve" como lo que es. Base para las fases siguientes.

### Fase 2 — QR y Código de barras en el lienzo (imagen real)
- QR: renderizar la **imagen real del QR** en el lienzo (colocable/dimensionable), no solo en el viewer.
- **Nuevo widget Código de barras** (Code128/EAN) con su imagen en el lienzo. Config (valor, formato) en el panel.

### Fase 3 — Widgets de redes sociales y comunicación (iconos/logos)
- Nuevos widgets: WhatsApp (ya), Instagram, Facebook, TikTok, X/Twitter, YouTube, Telegram, Teléfono, Email, Web.
- Se insertan como **botón con el logo de la marca** (de la biblioteca SVG/iconos), color de marca por defecto, colocable/dimensionable.
- Panel derecho: dato propio (número, usuario, URL) + estilo (color, forma, tamaño) + Tracking.

### Fase 4 — Audio con botón/disparador personalizable
- Audio: elegir **estilo de botón de reproducir** (icono play, color, tamaño, forma) que se muestra en el lienzo como disparador.
- Viewer: al tocar el botón, reproduce el audio (inline o emergente). Mantener opción de barra nativa como alternativa.

### Fase 5 — Mapa rico (localizar punto + enlace)
- Panel derecho del mapa: **buscar y fijar el punto exacto** (búsqueda de lugar → dirección/coordenadas) **o** pegar enlace embebido. Vista previa en vivo (ya existe).
- Lienzo: tarjeta de mapa con la dirección fijada. Viewer: embed + botón "Abrir en Maps" (ya existe).

### Fase 6 — Formulario y Cuestionario editables visualmente
- Lienzo: tarjeta representativa con **color y tamaño editables** (fondo, color de texto, color de botón, radio).
- Panel derecho: campos del formulario / preguntas del cuestionario + estilo visual.
- Viewer: respeta el estilo configurado.

### Fase 7 — Emergentes posicionables (pop-up / audio / video / imagen / mensaje / comentario)
- Permitir que el contenido emergente **aparezca en una zona señalada de la página** (ancla/zona destino) en vez de siempre modal centrado.
- Modelo: la acción guarda un destino `{ mode: 'modal' | 'inline', anchor?: {x,y,w,h} }`. En modo `inline`, el usuario dibuja/posiciona la zona donde sale el emergente.
- Viewer: renderiza el emergente en la zona indicada (o modal si así se eligió).

### Fase 8 — Panel de propiedades: global + por tipo (cierre)
- **Global (todos los widgets):** posición, tamaño, rotación, opacidad, sombra, radio, **animación** (ya), nombre, visibilidad inicial, sincronización multipágina, **Tracking** (ya).
- **Por tipo:** completar el patrón de panel rico (secciones colapsables) para **todos** los widgets — extendiendo lo ya hecho en Mapa y WhatsApp (Inspector Fase 3) a video, audio, QR, código de barras, formulario, cuestionario, tabla, embed, redes sociales, like, download.

---

## 4. Especificación de propiedades del panel derecho

### 4.1 Globales (comunes a todo elemento/widget)
Posición (X/Y) · Tamaño (Ancho/Alto) · Rotación · Opacidad · Sombra · Radio de bordes · **Animación continua** (pulse/float/spin/shake/bounce/blink + velocidad) · Nombre del elemento · Visibilidad inicial · Sincronización multipágina · **Seguimiento (Tracking)**.

### 4.2 Por tipo de widget (resumen)
| Widget | Propiedades clave |
|---|---|
| Mapa | Localizar punto / enlace embebido · zoom · pin (color) · botón "Abrir en Maps" · Tracking |
| WhatsApp / Redes / Comunicación | Dato (número/usuario/URL) · logo de marca · color · forma/tamaño del botón · texto · Tracking |
| Audio | Fuente · **estilo de botón reproducir** (icono/color/tamaño/forma) · autoplay/loop · Tracking |
| Video | Fuente (YouTube/Vimeo/archivo) · autoplay/controles/mute/loop · póster · Tracking |
| QR | Contenido (URL/texto) · color · margen · caption · Tracking |
| Código de barras | Valor · formato (Code128/EAN-13…) · mostrar texto · color · Tracking |
| Formulario | Campos (nombre/email/teléfono/mensaje + obligatorios) · email destino · **estilo (color fondo/texto/botón, radio)** · Tracking |
| Cuestionario | Preguntas/opciones · modo (single/multi) · **estilo (color/tamaño)** · Tracking |
| Tabla / Tabla de unidades | Fuente de datos · columnas · colores por estado · Tracking |
| Embed | HTML/iframe · Tracking |
| Like / Download | Config propia + Tracking |

---

## 5. Notas explícitas a recordar (de Juan)
- **Audio:** botón de reproducir **personalizable** como disparador (no solo barra nativa).
- **Código de barras:** colocarlo **visualmente en el lienzo** (tamaño/lugar), igual que QR.
- **Emergentes:** poder **señalar la zona** de la página donde salen (no siempre modal centrado).
- **Mapa:** localizar **punto exacto** o por **enlace**.
- **Redes/comunicación:** **logos de marca** desde las librerías correspondientes.
- **Formulario y Cuestionario:** edición **visual** (color/tamaño) en el lienzo.

---

## 6. Orden recomendado de arranque
1. **Confirmar arquitectura** (A previews ricos en Fabric — recomendado — vs B overlays HTML vivos).
2. **Fase 1** (representación visual base) — desbloquea la percepción profesional de inmediato.
3. Luego Fases 2→8 según prioridad comercial de Juan.

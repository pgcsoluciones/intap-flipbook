# Mockup vs. Realidad — Informe de brecha (10 páginas, mockup completo)

**Propósito:** Comparar el mockup "FlipBook Studio" (objetivo de producto) contra el código real del repo `intap-flipbook`, para instruir a Claude Code con precisión. Este informe cubre la totalidad del mockup compartido.

**Cómo leer las tablas:** Estado = lo que existe HOY en el código, verificado directamente (no por memoria). Brecha = qué falta para llegar al mockup.

---

## 0. Hallazgo transversal — el más importante de todo el informe

El **panel de propiedades (derecha)** del mockup es consistentemente rico y estructurado en TODAS las páginas: secciones colapsables (Nombre, Tipo, Fuente, Estilo, Tracking), con campos específicos por widget.

**Hoy, en el código real**, cada widget tiene una configuración mínima. Ejemplo verificado — el widget de Mapa:
```
map: { address: '', mapsUrl: '', zoom: 14 }
```
Eso es TODO lo que existe. El mockup pide, solo para el Mapa: proveedor, tipo de pin (personalizado + imagen), zoom inicial, acción al clic, URL/geolink, tipo de modal, y una sección de Tracking completa (evento, categoría, etiqueta, habilitar/deshabilitar).

**Esto se repite en los 13 widgets existentes.** No es un widget el que está pobre — es el **patrón de panel de propiedades completo** el que no existe todavía. Por eso lo marco como la tarea #1, antes que cualquier widget nuevo: construir el patrón de panel (secciones colapsables + sección de Tracking reutilizable) y aplicarlo de forma consistente.

---

## 1. Inventario de widgets — qué pide el mockup vs. qué existe

| Widget (mockup) | ¿Existe hoy? | Estado real | Brecha |
|---|---|---|---|
| Texto | ✅ Existe | Básico (texto libre en canvas) | Falta confirmar si soporta "data bind" (texto vinculado a un dato dinámico) |
| Imagen | ✅ Existe | Básico | Falta: opciones de recorte/foco automático que muestra el mockup |
| Botón | ✅ Existe | Básico (`BUTTON_PRESETS`) | Falta panel de propiedades rico (estilo, hover, tracking) |
| Formulario | ✅ Existe (`contact`) | Funcional | Falta verificar si soporta repetir tarjeta de contacto con varios campos como en pág. 10 |
| Mapa | ✅ Existe (`map`) | Muy básico (3 campos) | Grande — ver sección 0 |
| Video | ✅ Existe | Básico | Falta panel completo |
| **Modal** | ❌ No existe como widget propio | — | Hoy "modal" solo aparece como acción (`popup_image`/`popup_video`) ligada a una zona clicable, no como widget independiente configurable |
| **Hotspot** (sobre imagen/plano) | ⚠️ Existe un concepto distinto | "Puntos activos animados" (pulso/parpadeo/onda) — son decorativos, no editor de zonas con tooltip+modal por punto | El mockup pide hotspots **editables con lista** ("Editar hotspots (7)"), cada uno con su propio tooltip/modal — esto es nuevo |
| QR | ✅ Existe (`qr`) | Básico | Falta: "QR dinámico" con tracking y generación de URL parametrizada |
| **Galería** (de fotos/videos) | ❌ No existe | — | Completamente nuevo — layout grid, lightbox, lazy load, número de items visibles. Esto es justo el punto **A** que ya teníamos anotado, pero el mockup confirma que necesita ser mucho más robusto de lo que habíamos planeado (no solo "modal simple") |
| Tabla | ✅ Existe (`table`) | Básico — recibe CSV plano | El mockup pide una **"Tabla dinámica"** distinta: conectada a una fuente de datos, columnas configurables, colores por estado, editable, formato de moneda — ver sección 2 |
| **Timeline** | ❌ No existe | — | Nuevo — usado dos veces en el mockup (plan de pagos y avance de obra), debe ser genérico y reutilizable |
| **Dynamic Data** | ❌ No existe el concepto | — | El más estructural de todos — ver sección 2 |
| **CTA** | ⚠️ Se resuelve hoy con "Botón" | Funcional pero sin distinción | El mockup lo trata como tipo de widget separado, con tracking propio — podría ser solo una variante de Botón con tracking obligatorio, no necesariamente widget nuevo |
| **Calculadora** | ❌ No existe | — | Nuevo, con motor de fórmulas — ver sección 2 |
| **Ficha técnica** (repetidor de datos) | ❌ No existe | — | Nuevo — repetidor de ícono+título+valor, vinculado a una fuente de datos nombrada |
| **Tarjetas KPI** | ❌ No existe | — | Nuevo — mismo patrón de repetidor que Ficha técnica, aplicado a números destacados |
| **Plano editable** (zoom + hotspots sobre imagen) | ❌ No existe | — | Nuevo — combina imagen con zoom configurable + lista de hotspots editables + modal por hotspot |

---

## 2. Las 3 piezas estructurales nuevas (lo más importante a decidir primero)

Estas tres no son "un widget más" — son **conceptos de arquitectura** que varios widgets del mockup reutilizan. Conviene construirlas una sola vez, bien, antes de construir los widgets que dependen de ellas.

### 2.1 "Fuente de datos" / Dynamic Data
En el mockup, varios widgets (Ficha técnica, Tarjetas KPI, Tabla dinámica) no llevan los datos escritos directamente — los **leen de una fuente nombrada** (ej. `Atributos_apartamento`, `Inventario_Mirador_Este`, `kpi_resumen`). Esto significa:
- Necesitas un lugar donde se define cada "fuente de datos" por publicación (una lista de registros con campos — en el fondo, muy similar a lo que ya es la tabla `units`, pero generalizado a cualquier tipo de dato, no solo unidades)
- Cada widget que use "Dynamic Data" simplemente apunta a una fuente + define qué campos mostrar y cómo
- **Esto no existe en el código hoy ni remotamente.** Es la pieza más grande de todo el informe.

### 2.1.1 Relación entre `units` (ya construida) y `data_sources` (nueva) — aclaración necesaria antes de codificar
Ya existe la tabla `units`, específica para inventario inmobiliario (nombre, estado, precio, m², habitaciones, etc. — ver VERTICAL-INMOBILIARIA-PLAN.md sección 2). El módulo nuevo "Fuente de Datos" (`data_sources`) es **genérico**, para cualquier otro tipo de información que el tenant quiera mostrar con datos dinámicos (ej. atributos de un modelo de apartamento, hitos de avance de obra, tarjetas KPI).

**Para que Code no construya dos sistemas que se pisen entre sí, la regla es:**
- `units` sigue siendo la fuente para todo lo relacionado a unidades/inventario (el widget Tabla dinámica de la página 7 del mockup, y el widget `units_table` que ya existe, leen de `units` — no se duplica en `data_sources`)
- `data_sources` se usa para todo lo demás que no tenga ya una tabla propia: Ficha técnica de un modelo, Tarjetas KPI, hitos de Timeline, etc.
- Si en el futuro se necesita una fuente de datos para algo que hoy es "genérico" pero se vuelve un caso de uso recurrente y estructurado (como pasó con unidades), se puede "graduar" a su propia tabla — pero no antes de tener evidencia de que vale la pena


La página 7 del mockup mostraba "Conexión a inventario: Google Sheets / CMS / API → tiempo real". **Esa idea queda descartada** — nos mantenemos 100% dentro de tu ecosistema actual (Cloudflare D1), sin depender de servicios externos de terceros (Google, APIs de CMS ajenos, etc.).

En su lugar, construimos un **módulo nuevo llamado "Fuente de Datos"**, en el mismo nivel que el módulo "Respuestas" que ya existe en el dashboard (`TenantResponses.tsx` / `form_responses`). Funciona así:

- El tenant **sube un archivo Excel** (formato confirmado — único formato de carga automática, ver justificación abajo) con su información real — ej. el inventario de unidades de un proyecto, o la ficha técnica de un modelo
- El sistema **interpreta ese archivo** y lo convierte en registros estructurados, guardados en D1 (en la misma lógica que ya usamos para `units`, pero generalizada — esto es exactamente la "Fuente de Datos" de la sección 2.1)
- Esos registros pasan a ser la **fuente de verdad** que los widgets de Dynamic Data (Ficha técnica, Tarjetas KPI, Tabla dinámica) leen y muestran
- Si el tenant actualiza el archivo (ej. sube un Excel nuevo con precios actualizados) y lo vuelve a cargar, los datos se reemplazan y los widgets que apuntan a esa fuente se actualizan solos — sin tocar el diseño de las páginas

**Por qué solo Excel, y no Word/PDF (decisión confirmada):**
Excel/CSV son datos en columnas — perfectamente interpretables por el sistema sin ambigüedad (cada columna es un campo, cada fila es un registro). Word y PDF son texto libre o maquetado visual; "adivinar" cuál línea es un precio y cuál es una descripción es mucho menos confiable y generaría errores difíciles de depurar para el tenant. Excel resuelve el caso de uso real (inventario de unidades, fichas técnicas) sin ese riesgo.

**Plantilla descargable — pieza clave para que esto funcione bien:**
Para que el tenant no tenga que "adivinar" cómo debe estructurar su Excel, el sistema le ofrece un **archivo modelo descargable** antes de subir el suyo:
- Botón "Descargar plantilla" dentro del módulo Fuente de Datos
- El archivo `.xlsx` ya viene con las columnas correctas como encabezado (ej. para unidades: `nombre`, `estado`, `precio`, `area_m2`, `habitaciones`, `banos`, `piso`, `numero_unidad`, `descripcion` — los mismos campos que ya definimos en la tabla `units` en la Fase 2) y 1-2 filas de ejemplo ya llenas, para que el tenant entienda el formato esperado por simple imitación
- El tenant llena su propia información debajo de esas filas de ejemplo (o las borra) y sube el archivo de vuelta
- Si en el futuro agregamos más "fuentes de datos" genéricas (no solo unidades — ej. atributos de modelo, hitos de avance de obra), cada una tendría su propia plantilla descargable con las columnas que le correspondan

**Validación al subir (necesario, evita frustración):**
- Si el Excel no tiene las columnas esperadas (encabezados distintos, columnas faltantes), el sistema debe rechazar la carga con un mensaje claro indicando qué columna falta o está mal escrita — no fallar en silencio ni guardar datos a medias
- Mostrar una vista previa de "vamos a importar estos 12 registros" antes de confirmar, para que el tenant pueda revisar antes de que se reemplacen los datos existentes

**Vínculo a proyecto + ID único (decisión confirmada — evita mezclar datos entre proyectos):**
Cada fuente de datos pertenece a **una sola publicación** (`publication_id`), igual que ya hace la tabla `units`. Al subir un Excel se crea un registro "ficha" con su propio ID único (ej. `data_sources.id`), con nombre descriptivo (ej. `Inventario_Mirador_Este`), fecha de carga, y a qué proyecto pertenece.

Los widgets de Dynamic Data (Ficha técnica, KPI, Tabla dinámica) **no apuntan al archivo Excel directamente** — apuntan a ese ID de fuente. Así, si el tenant reemplaza el archivo después, el widget no se desconecta: sigue apuntando a la misma fuente, solo que con datos actualizados.

Estructura propuesta (en papel, no codificada):
```
data_sources
  id              (único)
  publication_id  (a qué proyecto pertenece — obligatorio)
  name            (ej. "Inventario_Mirador_Este")
  original_file_url (el .xlsx original, guardado en R2 como respaldo)
  created_at / updated_at

data_source_records
  id
  data_source_id  (a qué fuente pertenece este registro/fila)
  data            (los campos de esa fila, ej. nombre/precio/m²/estado)
```

**Edición de una fuente ya cargada — dos métodos, en este orden de prioridad:**

| Método | Cuándo se usa | Prioridad |
|---|---|---|
| **Reemplazar archivo completo** (subir un Excel nuevo sobre la misma fuente) | Cambios grandes — varios registros a la vez | **Primero** — reutiliza el mismo flujo de carga/validación ya construido, solo que sustituye los `data_source_records` existentes en vez de crear una fuente nueva |
| **Edición en línea de un registro puntual** (cambiar un precio sin re-subir todo) | Corrección rápida de 1-2 datos | **Después del lanzamiento** — extiende el mismo patrón que ya existe en el panel de Unidades (editar un registro individual), aplicado de forma genérica a cualquier fuente de datos |

No es necesario construir ambos desde el día uno — lanzar con "reemplazar archivo completo" cubre el caso de uso real sin bloquear el resto del trabajo.

### 2.3 Motor de fórmulas (Calculadora)
La página 8 muestra un campo `Fórmula` con texto tipo `financiamiento = precio_base - pagos_previos`, y una lista de "Campos de entrada" que el tenant puede agregar dinámicamente. Esto requiere:
- Una forma seguro de evaluar una fórmula escrita por el tenant (sin permitir que ejecute código arbitrario — riesgo de seguridad si se hace mal)
- Una UI para que el tenant defina los campos de entrada (nombre, tipo, valor por defecto) y vea el resultado en vivo

---

## 3. Repaso página por página (resumen ejecutivo)

| Pág. | Tema | Pieza nueva más relevante |
|---|---|---|
| 1 | Portada | Logo editable del tenant (ya es nuestro punto **B**), badges repetibles |
| 2 | Bienvenida/inversión | Tarjetas KPI (repetidor + Dynamic Data) |
| 3 | Ubicación | Mapa con proveedor/pin/modal — upgrade del widget existente; hotspot de zona en mapa |
| 4 | Amenidades | Galería de fotos completa (grid, lightbox, lazy load) |
| 5 | Modelo (plano) | Plano editable con hotspots + Ficha técnica |
| 6 | Modelo (plano 2) | Ficha técnica con **fuente de datos nombrada** explícita — la pieza clave de la 2.1 |
| 7 | Disponibilidad/precios | Tabla dinámica con estado por color + módulo "Fuente de Datos" (Excel/Word/PDF) en vez de integración externa |
| 8 | Financiamiento | Calculadora con motor de fórmulas |
| 9 | Constructora/avance | Timeline genérico + contador animado |
| 10 | Contacto | Botón WhatsApp con panel rico (ejemplo perfecto del patrón de panel que falta en todos lados) |

---

## 4. Orden de ejecución recomendado

No se puede construir todo en paralelo — hay dependencias reales:

1. **Patrón de panel de propiedades** — ahora con especificación completa en la sección 8 (Inspector: pestañas Configuraciones/Acciones, sincronización entre páginas, 15 acciones, etc.) — base de todo lo demás, sin esto cada widget nuevo se vería pobre igual que los actuales. Aplicar primero al piloto (sección 7) antes de los 13 widgets completos
2. **"Fuente de datos" / Dynamic Data** (sección 2.1) — varios widgets nuevos dependen de esto
3. Widgets que consumen Dynamic Data: **Ficha técnica**, **Tarjetas KPI**, **Tabla dinámica** (ésta también necesita el sistema de colores por estado)
4. **Galería de fotos/videos** (no depende de Dynamic Data, se puede hacer en paralelo a los anteriores)
5. **Plano editable con hotspots**
6. **Timeline genérico**
7. **Calculadora con motor de fórmulas** — la más delicada por el tema de seguridad al evaluar fórmulas, dejarla para cuando el resto esté estable
8. **Módulo "Fuente de Datos"** (subida de Excel + plantilla descargable, sección 2.2) — depende de que el modelo de Dynamic Data (punto 2) ya esté definido, así que va después

---

## 5. Recordatorio mobile-first aplicado a estos widgets específicamente
El principio rector ya definido (VERTICAL-INMOBILIARIA-PLAN.md, sección 0) aplica con fuerza extra a varios de los widgets nuevos de este informe, porque son los que más interacción táctil concentran:

- **Plano editable con hotspots**: el zoom y el toque sobre un hotspot deben probarse primero con gestos táctiles (pinch-to-zoom, tap), no con mouse — un hotspot pensado para un cursor preciso puede ser imposible de tocar con el dedo en una pantalla pequeña
- **Calculadora**: los campos de entrada (porcentajes, montos) deben usar teclados numéricos nativos en móvil, no el teclado de texto genérico
- **Galería**: el lightbox/modal debe soportar swipe para pasar de imagen, no solo flechas de clic
- **Timeline**: si tiene muchos hitos, debe poder desplazarse horizontalmente con el dedo en pantallas angostas, sin que los elementos se encimen

## 6. Cómo verificar cada fase una vez Code la complete (aprendido de esta misma sesión)
Ya tuvimos confusión real con la Fase de Unidades (creías que no existía nada, cuando el backend estaba listo pero el dashboard/viewer no se habían desplegado). Para no repetirlo:

- Después de cada fase, pídele a Code un **checklist de verificación visual** específico (qué pantalla abrir, qué botón tocar, qué deberías ver) — no asumas que "está hecho" solo porque el commit existe
- Recuerda que son **3 piezas separadas** (API, dashboard, viewer) y que el dashboard se despliega automático al hacer push, pero el viewer necesita `npm run deploy` manual — confírmaselo a Code en cada fase: "¿esto requiere deploy manual del viewer, o ya quedó incluido?"
- Si algo no se ve, antes de asumir que está mal hecho, pide el informe de despliegue (como hicimos con K y N) en vez de desplegar a ciegas

## 7. Sugerencia de alcance para la primera fase del "patrón de panel de propiedades" (punto 1 del orden de ejecución)
Aplicar el patrón nuevo a los 13 widgets existentes de una sola vez es mucho riesgo (un cambio grande, difícil de revisar). Recomiendo pedirle a Code que lo construya como **plantilla reutilizable** y lo aplique primero a 2 widgets como piloto (sugiero Mapa y Botón WhatsApp, porque el mockup los detalla a fondo en las páginas 3 y 10) — una vez confirmes que el patrón se ve y funciona bien en esos dos, se replica al resto en una fase siguiente, no en la misma.

---

## 8. Especificación detallada — Panel de Propiedades / Inspector (sustituye y amplía la sección 0)

Esta especificación fue redactada con mucho detalle y reemplaza la versión breve de la sección 0 como la definición oficial de esta pieza. Aplica primero al piloto (Mapa + WhatsApp, sección 7) y después al resto.

**Regla explícita para Code:** no rehacer el editor completo ni modificar la lógica actual del canvas — integrar este panel respetando la arquitectura, componentes, estado y estilos existentes del proyecto.

### 8.1 Interfaz general
- Panel lateral derecho, ancho desktop ~280–320px, con scroll vertical interno
- En móvil: drawer o panel inferior expandible (no el mismo layout que desktop)
- Solo aparece cuando hay un elemento seleccionado; si no hay selección, estado vacío: *"Selecciona un elemento para editar sus propiedades"*
- Encabezado con dos pestañas: **Configuraciones** (default) y **Acciones**

### 8.2 Sección común a todos los elementos (Configuraciones)
- Barra de alineación: izquierda/centro/derecha horizontal, arriba/centro/abajo vertical, distribuir horizontal/vertical
- Campos numéricos editables: X, Y, Ancho, Alto — cambios en tiempo real en el canvas
- Opacidad (slider 0–100), Rotación (slider + campo 0–360°), Sombra (on/off), Radio de bordes (on/off cuando aplique)
- **Sincronización de múltiples páginas** (on/off) — ver 8.3

### 8.3 Sincronización entre páginas (`syncGroupId`) — concepto nuevo, no existe hoy
Cuando se activa en un elemento:
- Se le asigna un `syncGroupId` único
- Cambios de estilo/color/tipografía/tamaño/radio/opacidad/acciones en ese elemento se reflejan automáticamente en todos los elementos con el mismo `syncGroupId` en otras páginas
- **No sincroniza posición X/Y** entre páginas (a propósito — cada página puede necesitar el elemento en otro lugar), salvo que se active una opción explícita futura para eso
- Antes de activarlo por primera vez, mostrar confirmación: *"Los cambios de este elemento se reflejarán en las páginas vinculadas. ¿Deseas continuar?"*

### 8.4 Propiedades específicas por tipo

**Imagen:**
- Acciones: Reemplazar, Subir imagen, Recortar, Eliminar fondo, Restablecer transformación
- Configuración: Establecer como fondo, Azulejos/repetición, "mantener presionado para escanear QR/guardar imagen", ajuste (contener/cubrir/estirar/tamaño original), posición (centro/arriba/abajo/izq/der)
- Bordes y máscara: radio uniforme o por esquina individual (con vínculo/desvínculo de las 4 esquinas), máscara de capa (ninguna/rectángulo redondeado/círculo/óvalo/personalizada futura)

**Forma:**
- Color de fondo, tipo de borde (ninguno/sólido/punteado/discontinuo), color y grosor de borde, radio de esquinas (uniforme o independiente)
- Debe funcionar para: rectángulo, rectángulo redondeado, círculo, línea, flecha, polígono, forma personalizada futura

**Botón:**
- Contenido: texto, ícono (reemplazable, selector visual en cuadrícula — librería sugerida: Lucide Icons), posición del ícono (izq/der/arriba/abajo), opción de ocultar ícono manteniendo texto
- Tipografía: familia, tamaño, color, negrita/cursiva/subrayado, alineación
- **Estados de color independientes**: predeterminado, hover, clic (active), deshabilitado — esto es nuevo, hoy los botones no tienen estados diferenciados
- Borde, radio, opacidad, sombra

### 8.5 Pestaña "Acciones" — 15 acciones a implementar
Selector de evento disparador (clic / hover / mantener presionado / al cargar la página — solo donde aplique), y una cuadrícula de tarjetas de acción:

1. Abrir enlace (URL, misma/nueva pestaña, UTM opcionales)
2. Ir a página (selector de página + transición opcional)
3. Reproducir efectos (animación, duración, repetición, retraso)
4. Ventana emergente (título, contenido, tamaño, imagen, CTA)
5. Imagen emergente (imagen, alt, modo galería, fondo oscuro/claro)
6. Mensaje emergente (mensaje, estilo: info/éxito/advertencia/promoción, duración)
7. Mostrar/Ocultar (elemento objetivo + acción: mostrar/ocultar/alternar) — **ya existe parcialmente** (`show_hide`, ver VERTICAL-INMOBILIARIA-PLAN.md, pendiente confirmar implementación en viewer)
8. Video emergente (URL YouTube/Vimeo/alojado, autoplay, controles) — parcialmente cubierto por `popup_video` existente
9. Reproducir audio (archivo, volumen, repetir, autoplay condicionado por navegador) — nuevo (distinto del widget `audio` fijo que ya existe)
10. **Ejecutar JavaScript — con restricción de seguridad explícita:** nunca permitir JS libre a clientes finales. En su lugar, un catálogo cerrado de acciones registradas: `triggerWebhook`, `copyToClipboard`, `updateVariable`, `sendAnalyticsEvent`, `openWhatsApp`, `customDeveloperAction` — disponibles solo para admin/desarrollador, nunca para el tenant final
11. Descargar archivo (archivo, nombre de descarga, texto de botón opcional) — ya existe parcialmente (`download`)
12. Mostrar comentario (texto, autor, fecha opcionales)
13. Acercar área / zoom (zona o coordenadas, nivel de zoom, duración) — relacionado con el "Plano editable" de MOCKUP-GAP-ANALYSIS sección 1
14. Abrir cuestionario (selector de formulario/quiz, modal o pantalla completa, texto CTA) — ya existe el widget `quiz`, esto sería exponerlo como acción también
15. Colapsar (elemento/panel objetivo, estado inicial, animación)

### 8.6 Modelo de datos sugerido (estructura de referencia, no código final)
Cada elemento del canvas tendría esta forma general: `id`, `type`, `pageId`, bloque `frame` (x/y/width/height/rotation/opacity), bloque `style` (color de fondo, borde, `borderRadius` por esquina con `linked`, `shadow`), bloque específico según tipo (`image`/`button`/etc.), bloque `interactions` (evento → tipo de acción → configuración), y `syncGroupId`. Code debe adaptar esto a la estructura real ya existente en `canvas_json` (Fabric.js) — esto es una referencia de qué campos deben existir, no una estructura a copiar literalmente si choca con lo ya construido.

### 8.7 Reglas de comportamiento
- Todo cambio se refleja en vivo en el canvas, y se registra en el historial (deshacer/rehacer)
- Actualización inmutable del estado
- **No guardar en servidor en cada movimiento de slider — usar debounce** (esperar una pausa corta antes de persistir)
- Selección múltiple: mostrar solo propiedades comunes; si los valores difieren entre elementos, mostrar estado "mixto"
- Deshabilitar controles que no correspondan al tipo de elemento seleccionado
- Validaciones antes de guardar una acción: no URL vacía en "Abrir enlace", no "Ir a página" sin página seleccionada, no archivo vacío en video/audio/descarga

### 8.8 Estructura de componentes sugerida
`PropertiesPanel` (con `PropertiesTabs`, `AlignmentToolbar`, `ElementTransformControls`, `OpacityControl`, `RotationControl`, `ShadowControl`, `SyncPagesControl`) + `ImageProperties`, `ShapeProperties`, `ButtonProperties` (cada uno con sus sub-controles) + `ActionsPanel` (`TriggerSelector`, `ActionGrid`, `ActionConfigurationForm`).

### 8.9 Criterios de aceptación
1. Seleccionar imagen/forma/botón y editar sus propiedades desde el panel
2. Cambios reflejados de inmediato en el canvas
3. El panel muestra solo las propiedades correctas según el tipo de elemento
4. Acciones interactivas configurables por elemento, guardadas en el modelo del flipbook
5. Elementos sincronizados reflejan cambios de estilo en páginas vinculadas
6. Funciona en desktop y móvil (ver principio mobile-first, sección 5)
7. Diseño limpio, compacto, moderno, consistente con la interfaz actual
8. No rompe ninguna funcionalidad actual del editor ni del flipbook publicado

---

## 9. Gestión de recursos — puntos nuevos (no cubiertos hasta ahora)

**Punto DD (definición formal — corrige un descuido del informe anterior, donde se referenciaba sin definirse):** El panel "Elementos" del editor (y también "Formas"/"Botones") hoy **no leen del sistema real de Recursos** que administra el superadmin — están conectados a una lista fija escrita directamente en el código (`ICON_LIBRARY`, `BUTTON_PRESETS`, en `EditPublication.tsx`). La única pestaña que sí lee de la base de datos es "Plantillas". Por eso, cualquier SVG/icono que un superadmin suba en el panel de Recursos **no tiene ningún camino para llegar al editor** — la conexión no existe. La corrección es construir esa conexión real: que "Elementos" (y los demás paneles relevantes) pidan los recursos al backend igual que ya hace "Plantillas", en vez de usar la lista fija del código.

| # | Característica | Detalle | Tipo |
|---|---|---|---|
| DD | Conectar panel "Elementos" (y Formas/Botones) al sistema real de Recursos, en vez de lista fija en código | Ver definición completa arriba — bloquea que cualquier SVG/icono subido por el superadmin llegue al editor | Global — prioridad alta, varios otros puntos (GG, II, JJ) dependen de esto |
| EE | **Bug:** imágenes subidas en "Cargas" no se pueden eliminar | Si se sube una imagen y luego se quita de una página, el archivo queda huérfano en el depósito (R2) sin forma de borrarlo desde la interfaz — ocupa espacio indefinidamente | Bug — relacionado con punto O (backup/limpieza) |
| FF | Conexión a banco de imágenes libres de derecho — **decisión confirmada: integrar ahora, empezar con Pexels** | Ver detalle completo abajo | Feature nueva — lista para pasar a Code |
| GG | Asignar cada recurso cargado a un módulo específico (Formas/Widgets/Elementos) | Amplía directamente el punto **DD** ya anotado (conectar "Elementos" al sistema real de Recursos) — agrega la necesidad de elegir el destino al subir | Extiende DD |
| GG.1 | Edición avanzada de formas: degradados, edición de líneas/puntos, deformar, fusionar, vincular | Mucho más allá de lo que cubre la sección 8.4 (Forma) — esto es edición vectorial real, nivel Canva/Figma. Es la pieza de mayor esfuerzo de todo este informe — recomiendo dejarla en backlog hasta tener el resto del panel funcionando | Backlog (alto esfuerzo) |
| HH | Carga de recursos por lote (varios archivos a la vez) | Hoy se sube de uno en uno (a confirmar con Code) | Feature nueva |
| II | Botón "Agregar recursos" en el panel de edición (solo superadmin), que instala el recurso de inmediato en el módulo correspondiente de la barra de edición | Es una vía rápida para ti como superadmin, alternativa/complementaria al flujo normal de Recursos → Elementos (punto DD) | Feature nueva |
| JJ | Biblioteca de iconos SVG completa, editables dentro del canvas (no solo insertados como imagen estática) | Un ícono SVG "editable" significa que sus propiedades (color, trazo, tamaño) se pueden cambiar después de insertado, no que sea una imagen congelada — esto se resuelve naturalmente si el ícono se inserta como elemento "Forma"/"Botón con ícono" del panel de la sección 8, en vez de como imagen importada | Conecta directo con 8.4 |

**Detalle completo del punto FF (verificado en junio 2026, antes de pasar a Code):**

**Proveedor elegido: Pexels.** Razones — términos más simples que Unsplash, mejor límite gratuito (200 solicitudes/hora, 20,000/mes vs. el modo demo de Unsplash de 50/hora), y soporta fotos **y videos** en la misma API (relevante porque el mockup también pide galerías de video).

**Requisitos técnicos/legales que Code debe respetar:**
- Necesita una cuenta de desarrollador en Pexels para obtener una API Key — esto lo gestionas tú (no Code), y la clave se guarda como variable de entorno secreta en el Worker (nunca expuesta en el frontend)
- Mostrar atribución (nombre del fotógrafo + enlace) es recomendado por Pexels, aunque menos estricto que Unsplash — de todas formas, conviene implementarlo desde el inicio, ya que si más adelante se agrega Unsplash como segunda fuente, ahí sí es **obligatorio por contrato** mostrar "Foto de [nombre] en Unsplash" con enlace al perfil en cada imagen visible
- El buscador de stock se integra como una pestaña nueva dentro del panel de Imágenes del editor (junto a "Subir imagen" y, eventualmente, "Elementos" del punto DD) — el tenant busca por palabra clave, ve resultados, y al elegir uno se inserta en el canvas igual que cualquier imagen
- **No se debe descargar y almacenar la imagen en R2 de forma permanente al insertarla** (correcto para Pexels, y evita además ocupar tu propio almacenamiento con contenido de terceros) — se referencia la URL externa del proveedor
- Si más adelante se agrega Unsplash, no se puede usar para entrenar modelos de IA ni para construir un servicio que compita con Unsplash/Pexels — no aplica a tu caso de uso, pero queda anotado por completitud

**Nota sobre EE (bug de eliminación huérfana):** es el tercer bug de este tipo que encontramos en la sesión (junto a K y N) — vale la pena que, cuando le pidamos a Code el informe de K/N, le agreguemos también este.


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

### 2.2 Módulo "Fuente de Datos" (en D1, sin integraciones externas) — decisión confirmada
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

1. **Patrón de panel de propiedades** (sección 0) — base de todo lo demás, sin esto cada widget nuevo se vería pobre igual que los actuales
2. **"Fuente de datos" / Dynamic Data** (sección 2.1) — varios widgets nuevos dependen de esto
3. Widgets que consumen Dynamic Data: **Ficha técnica**, **Tarjetas KPI**, **Tabla dinámica** (ésta también necesita el sistema de colores por estado)
4. **Galería de fotos/videos** (no depende de Dynamic Data, se puede hacer en paralelo a los anteriores)
5. **Plano editable con hotspots**
6. **Timeline genérico**
7. **Calculadora con motor de fórmulas** — la más delicada por el tema de seguridad al evaluar fórmulas, dejarla para cuando el resto esté estable
8. **Módulo "Fuente de Datos"** (subida de Excel + plantilla descargable, sección 2.2) — depende de que el modelo de Dynamic Data (punto 2) ya esté definido, así que va después


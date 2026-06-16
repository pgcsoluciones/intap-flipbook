# INTAP FLIPBOOK — Especificación Definitiva de UI/UX y Funcionalidad
> Documento para Claude Code. Lee esto completo antes de tocar cualquier archivo.
> No inventes funciones. No cambies el stack. Todo lo descrito aquí es lo que se construye, nada más.

---

## 🎨 SISTEMA DE DISEÑO

### Paleta de colores
```css
--color-primary:     #4F46E5;   /* índigo — acción principal */
--color-primary-dark:#3730A3;   /* hover de botones primarios */
--color-accent:      #06B6D4;   /* cyan — destacados, badges activos */
--color-success:     #10B981;   /* verde — publicado, activo, pagado */
--color-warning:     #F59E0B;   /* ámbar — límite próximo, pendiente */
--color-danger:      #EF4444;   /* rojo — degradado, suspendido, error */
--color-surface:     #F8FAFC;   /* fondo general de páginas */
--color-card:        #FFFFFF;   /* fondo de tarjetas y modales */
--color-border:      #E2E8F0;   /* bordes suaves */
--color-text:        #0F172A;   /* texto principal */
--color-muted:       #64748B;   /* texto secundario, labels */
```

### Tipografía
```css
--font-display: 'Inter', sans-serif;   /* títulos, headings */
--font-body:    'Inter', sans-serif;   /* cuerpo de texto */
--text-xs:   11px;
--text-sm:   13px;
--text-base: 15px;
--text-lg:   18px;
--text-xl:   22px;
--text-2xl:  28px;
```

### Componentes base
- **Botón primario:** `bg-primary text-white rounded-lg px-4 py-2 font-medium`
- **Botón secundario:** `border border-border text-text rounded-lg px-4 py-2`
- **Botón peligro:** `bg-danger text-white rounded-lg px-4 py-2`
- **Card:** `bg-card border border-border rounded-xl p-5 shadow-sm`
- **Badge activo:** `bg-accent/10 text-accent text-xs font-semibold rounded-full px-2 py-0.5`
- **Badge degradado:** `bg-danger/10 text-danger text-xs font-semibold rounded-full px-2 py-0.5`
- **Input:** `border border-border rounded-lg px-3 py-2 text-sm w-full focus:ring-2 focus:ring-primary`
- **Sidebar:** fondo `#1E1B4B` (índigo oscuro), texto blanco, íconos con labels

---

## 🗂️ ESTRUCTURA DE RUTAS — Dashboard Tenant

```
/login
/register
/dashboard                    ← Home con resumen
/publications                 ← Lista de flipbooks
/publications/new             ← Crear nuevo
/publications/:id/editor      ← Editor de páginas
/publications/:id/preview     ← Vista previa responsive
/publications/:id/settings    ← Configuración y enlaces activos
/templates                    ← Galería de plantillas disponibles por plan
/resources                    ← Elementos del editor disponibles por plan
/tutorials                    ← Tutoriales y guías
/promotions                   ← Ofertas y promociones activas
/referrals                    ← Mi link de referido y estado de recompensas
/profile                      ← Perfil del negocio y marca
/plan                         ← Mi plan actual + solicitud de cambio
/stats                        ← Estadísticas propias
```

## 🗂️ ESTRUCTURA DE RUTAS — Super Admin

```
/admin                        ← Dashboard global
/admin/tenants                ← Lista de todos los clientes
/admin/tenants/:id            ← Perfil completo del tenant
/admin/plans                  ← Gestión de planes y límites
/admin/payments               ← Registro de pagos
/admin/gateways               ← Configuración de pasarelas
/admin/modules                ← Módulos activables por plan/tenant
/admin/resources              ← Gestión de recursos (plantillas, elementos, tutoriales)
/admin/resources/templates    ← Plantillas prediseñadas
/admin/resources/elements     ← Elementos del editor (íconos, fondos, formas)
/admin/resources/tutorials    ← Tutoriales y guías
/admin/promotions             ← Ofertas y promociones por plan
/admin/referrals              ← Configuración y gestión del programa de referidos
/admin/branding               ← Configuración de marca de agua global
/admin/notifications          ← Enviar notificaciones a tenants
/admin/stats                  ← Estadísticas globales
```

---

## 👤 PANEL TENANT — Pantallas

### 1. Home (`/dashboard`)
**Layout:** sidebar izquierdo fijo + área principal scrollable

**Sidebar (fondo índigo oscuro #1E1B4B):**
- Logo Intap Flipbook arriba
- Ítems: Inicio, Mis Flipbooks, Plantillas, Recursos, Tutoriales, Estadísticas, Promociones, Referidos, Mi Plan, Perfil
- Abajo: nombre del usuario + plan badge + cerrar sesión

**Área principal:**
- Banner de promoción activa (si existe) — card destacada con fondo accent, texto de la oferta y botón CTA
- Banner de advertencia de límite (si uso > 80%) — fondo warning con link a /plan
- Banner de período de gracia (si aplica) — fondo danger con días restantes
- Saludo: `Buenos días, [nombre]!`
- 3 accesos rápidos en cards horizontales:
  - `+ Subir imágenes` → va a /publications/new
  - `+ Crear desde plantilla` → va a /templates
  - `Ver mi plan` → va a /plan
- Sección `Mis flipbooks recientes` — grid de 3 columnas con thumbnail de portada, nombre, estado badge (Borrador/Publicado), cantidad de páginas, vistas
- Sección `Uso del plan` — UsageBar con 3 barras: publicaciones, páginas (máx del plan), storage en MB

---

### 2. Lista de flipbooks (`/publications`)
- Barra superior: buscador + filtro por categoría + filtro por estado
- Grid de tarjetas: thumbnail portada, nombre, categoría badge, estado badge, fecha, botones: Editar / Vista previa / Configuración / Eliminar
- Carpetas/colecciones en panel lateral izquierdo dentro del área (no el sidebar)
- Papelera: tab separado con restaurar/eliminar definitivo
- Botón flotante `+ Nuevo flipbook`

---

### 3. Crear nuevo (`/publications/new`)
- Dos opciones visibles:
  - `Subir imágenes` — drag & drop múltiple con barra de progreso por imagen
  - `Elegir plantilla` — redirige a /templates
- Campo: Nombre del flipbook
- Selector: Categoría (catálogo, menú, portafolio, revista, folleto, otro)
- Al completar upload → redirige automáticamente al editor

---

### 4. Editor de páginas (`/publications/:id/editor`)

**Layout en 3 columnas:**

**Columna izquierda — Panel de páginas (240px):**
- Lista vertical de miniaturas de páginas con número
- Drag & drop para reordenar
- Botón `+ Nueva página` al final
- Click en miniatura → activa esa página en el canvas

**Columna central — Canvas (flexible):**
- La página activa renderizada a escala
- Elementos arrastrables sobre el canvas: texto, imagen, botón/enlace, formulario de contacto, QR
- Elemento seleccionado muestra handles de resize en esquinas
- Toolbar flotante sobre canvas: seleccionar / texto / imagen / enlace / formulario / QR

**Columna derecha — Propiedades (280px):**
- Aparece cuando hay un elemento seleccionado
- Campos: X, Y, Ancho, Alto, Opacidad, Rotación
- Para texto: fuente, tamaño, color, negrita, itálica, alineación
- Para imagen: reemplazar imagen, recortar, radio de borde
- Para enlace/botón: URL destino, texto del botón, color
- Para formulario: campos a mostrar (nombre, email, teléfono, mensaje), email destino
- Botones: Guardar página / Previsualizar

**Barra inferior:**
- Controles de zoom (50% / 75% / 100% / 125%)
- Indicador de página actual `3 / 12`
- Botón `Previsualizar flipbook completo`
- Botón `Guardar y publicar`

**Persistencia:** El estado del canvas de cada página se guarda como JSON en D1, columna `canvas_json` en tabla `pages`. El viewer lo lee y renderiza los elementos encima de la imagen base.

---

### 5. Vista previa (`/publications/:id/preview`)
- Toggle de dispositivo: Desktop / Tablet / Móvil (cambia el ancho del iframe)
- iframe que carga el viewer público del flipbook
- Botón `Copiar link público`
- Botón `Generar QR` — muestra QR descargable como PNG
- Botón `Publicar` / `Despublicar`

---

### 6. Configuración del flipbook (`/publications/:id/settings`)
- Nombre, descripción, categoría
- Slug personalizable (URL pública)
- Toggle: sonido al voltear página (bloqueado en Free)
- Toggle: mostrar formulario de contacto flotante en viewer
- Toggle: mostrar botones de compartir en viewer
- Sección `Zona de peligro`: Eliminar publicación

---

### 7. Galería de plantillas (`/templates`)
- Grid de tarjetas con thumbnail de portada de la plantilla
- Filtro por categoría (catálogo, menú, portafolio, revista, folleto, otro)
- Badge de plan requerido en cada plantilla (Free / Basic / Pro)
- Plantillas bloqueadas para el plan actual aparecen con candado y tooltip "Disponible en plan Basic"
- Click en plantilla libre → modal de preview con navegación entre páginas + botón `Usar esta plantilla`
- Click en plantilla bloqueada → modal de upgrade con comparativa de planes
- Al usar plantilla → crea nueva publicación con las páginas precargadas y redirige al editor

---

### 8. Recursos del editor (`/resources`)
- Biblioteca de elementos disponibles según el plan
- Tabs: Íconos / Fondos / Formas / Botones prediseñados
- Buscador por nombre dentro de cada tab
- Badge de plan en elementos premium
- Los elementos se pueden arrastrar directamente al editor (integración futura) o descargar como PNG

---

### 9. Tutoriales (`/tutorials`)
- Grid de cards con thumbnail del video/guía, título, duración/páginas
- Categorías: Primeros pasos / Editor / Publicar y compartir / Planes y pagos
- Click → modal con video embebido (YouTube/Vimeo) o guía paso a paso en texto
- Marcados como vistos con check verde

---

### 10. Promociones (`/promotions`)
- Lista de promociones activas dirigidas al plan del tenant
- Cada card muestra: título, descripción, descuento o beneficio, fecha de vencimiento, botón CTA
- Promociones vencidas aparecen en sección separada con estilo gris
- Si no hay promociones activas: mensaje `No hay promociones disponibles en este momento`

---

### 11. Programa de referidos (`/referrals`)
- Card con link único de referido del tenant (copiable con un click)
- Botones de compartir: WhatsApp, email, copiar link
- Estadísticas: referidos registrados / referidos activos / recompensas ganadas
- Tabla de referidos: nombre, fecha de registro, estado (registrado / plan activo / recompensa aplicada)
- Card de recompensa actual configurada por el Admin (ej: "Gana 15 días gratis por cada referido que active un plan")
- Estado de recompensas pendientes de aprobación por el Admin

---

### 12. Mi Plan (`/plan`)
- Card con plan actual: nombre, precio, fecha de renovación
- Barras de uso: publicaciones usadas / total, páginas, storage
- Lista de funciones incluidas en el plan actual (con ✅ y ❌)
- Sección `Cambiar plan`:
  - Cards comparativas de los 3 planes (Free, Basic, Pro)
  - Botón `Solicitar upgrade` → crea una solicitud en el sistema (no procesa pago automáticamente)
  - Botón `Solicitar downgrade` → igual, crea solicitud
  - Nota visible: "Tu solicitud será procesada por nuestro equipo en menos de 24 horas"
- Historial de pagos: tabla con fecha, monto, método, estado (Pagado / Pendiente)

---

### 13. Estadísticas del tenant (`/stats`)
- Total de vistas por flipbook (tabla + gráfico de barras con Recharts)
- Vistas por día en los últimos 30 días (gráfico de línea)
- Páginas más vistas dentro de cada flipbook
- Dispositivos: % desktop / tablet / móvil (gráfico de dona)

---

## 👑 PANEL SUPER ADMIN — Pantallas

> El Super Admin es el único que gestiona planes, pagos, límites y estado de los tenants.
> Los tenants solo ven su estado y pueden solicitar cambios.

### Layout Super Admin
- Sidebar fondo negro `#09090B` con acento índigo
- Ítems: Dashboard, Tenants, Planes, Pagos, Pasarelas, Módulos, Recursos, Promociones, Referidos, Marca de agua, Notificaciones, Estadísticas
- Badge con conteo en ítems con alertas pendientes

---

### 1. Dashboard global (`/admin`)
- 4 KPI cards en fila: Total tenants activos / MRR (ingresos mensuales) / Storage total usado / Solicitudes pendientes
- Gráfico de línea: nuevos tenants por mes
- Gráfico de barras: ingresos por mes
- Tabla `Actividad reciente`: últimas 10 acciones (nuevo registro, pago recibido, solicitud de upgrade, etc.)
- Tabla `Solicitudes pendientes`: tenants que pidieron cambio de plan — botón de aprobar/rechazar directo

---

### 2. Gestión de tenants (`/admin/tenants`)
- Tabla con columnas: Nombre, Email, Plan, Estado, Storage usado, Publicaciones, Fecha registro, Acciones
- Filtros: por plan, por estado (Activo / Degradado / Suspendido), por fecha
- Buscador por nombre o email
- Click en fila → perfil completo del tenant

**Perfil del tenant (`/admin/tenants/:id`):**
- Info básica: nombre, email, fecha registro, último login
- Plan actual + botón `Cambiar plan` (modal con selector de plan + fecha efectiva)
- Estado: Activo / Degradado / Suspendido + botón para cambiar estado manualmente
- Límites actuales editables inline: publicaciones máx, páginas máx, storage máx, sonido, dominio custom
- Historial de cambios de plan
- Historial de pagos del tenant
- Botón `Registrar pago manual`
- Botón `Enviar notificación`
- Botón `Ver como tenant` (impersonation — acceso de solo lectura)
- Zona peligro: Suspender cuenta / Eliminar cuenta

---

### 3. Gestión de planes (`/admin/plans`)
- Tabla de planes existentes: nombre, precio, límites, tenants en este plan
- Botón `+ Nuevo plan`
- Click en plan → modal de edición:
  - Nombre, precio mensual, precio anual
  - Límites: publicaciones máx (número o "ilimitado"), páginas máx, storage en MB, sonido (sí/no), dominio custom (sí/no)
  - Módulos incluidos (checkboxes de módulos registrados)
  - Estado: Activo / Oculto (no aparece a nuevos tenants pero sí a los que ya lo tienen)
- Cambios de límites aplican inmediatamente a todos los tenants en ese plan

---

### 4. Registro de pagos (`/admin/payments`)
- Tabla: Tenant, Monto, Moneda, Método, Estado, Fecha, Referencia, Notas
- Filtros: por método, por estado, por rango de fechas, por tenant
- Botón `+ Registrar pago manual`:
  - Modal: seleccionar tenant, plan pagado, monto, moneda (RD$ / USD), método (transferencia / depósito / PayPal / Readdy / otro), referencia, fecha, notas opcionales
  - Al guardar → actualiza automáticamente el plan y fecha de vencimiento del tenant
- Estados de pago: Pagado / Pendiente / Vencido / Reembolsado
- Exportar a CSV

---

### 5. Pasarelas de pago (`/admin/gateways`)
- Lista de pasarelas configuradas con toggle activo/inactivo
- Pasarelas soportadas (cada una con su formulario de configuración):
  - **Transferencia bancaria** — campos: banco, titular, cuenta, instrucciones
  - **Depósito en efectivo** — campos: banco, titular, cuenta, instrucciones
  - **PayPal** — campos: Client ID, Secret, modo (sandbox/producción)
  - **Readdy (CardNet)** — campos: API Key, Merchant ID, modo
  - **Otro / Custom** — campos: nombre, instrucciones en texto libre
- Las pasarelas activas aparecen en la página `/plan` del tenant como métodos de pago disponibles

---

### 6. Módulos (`/admin/modules`)
- Lista de módulos del sistema con toggle global y toggle por plan
- Módulos iniciales:
  - Editor en línea de páginas
  - Links activos en páginas
  - Formulario de contacto en viewer
  - QR en viewer
  - Botones de compartir
  - Estadísticas avanzadas
  - Dominio personalizado
  - Sonido al voltear
  - Plantillas premium
- Cada módulo tiene: nombre, descripción, planes que lo incluyen, toggle para activar/desactivar globalmente
- Super Admin puede activar un módulo para un tenant específico aunque su plan no lo incluya (excepción manual)

---

### 7. Recursos (`/admin/resources`)

**Sub-sección Plantillas (`/admin/resources/templates`):**
- Tabla de plantillas: thumbnail, nombre, categoría, plan requerido, fecha de carga, estado (activa/inactiva)
- Botón `+ Nueva plantilla`:
  - Modal: nombre, categoría, plan requerido (Free/Basic/Pro), subir imágenes de las páginas (se guardan en R2), estado
  - Las páginas de la plantilla se guardan como páginas base sin canvas_json
- Toggle activo/inactivo por plantilla
- Eliminar plantilla (con confirmación)

**Sub-sección Elementos del editor (`/admin/resources/elements`):**
- Tabs: Íconos / Fondos / Formas / Botones
- Botón `+ Subir elemento`: nombre, categoría, plan requerido, archivo PNG/SVG
- Toggle activo/inactivo, eliminar

**Sub-sección Tutoriales (`/admin/resources/tutorials`):**
- Lista de tutoriales: título, categoría, tipo (video/guía), URL o contenido, orden de aparición, estado
- Botón `+ Nuevo tutorial`: título, categoría (primeros pasos/editor/publicar/planes), tipo, URL de video o texto de guía, thumbnail, orden
- Toggle activo/inactivo, reordenar drag & drop

---

### 8. Promociones (`/admin/promotions`)
- Tabla de promociones: título, tipo de beneficio, planes objetivo, fechas, estado (activa/vencida/programada)
- Botón `+ Nueva promoción`:
  - Título y descripción visible al tenant
  - Tipo de beneficio: descuento % en próximo pago / días gratis / upgrade temporal
  - Planes objetivo: todos / Free / Basic / Pro (multiselect)
  - Fecha de inicio y fecha de fin
  - Código promocional opcional (para uso futuro con Stripe)
  - CTA: texto del botón y URL destino (puede ser /plan o una URL externa)
  - Estado: activa / programada / pausada
- Toggle activo/inactivo por promoción
- Las promociones activas aparecen automáticamente en el dashboard y `/promotions` del tenant según su plan

---

### 9. Programa de referidos (`/admin/referrals`)
- Configuración global del programa:
  - Toggle: programa activo/inactivo
  - Tipo de recompensa: días gratis (número configurable) / descuento % en próximo pago
  - Condición de activación: referido solo se registra / referido activa plan pagado
  - Período de validez del link de referido (días, 0 = sin límite)
- Tabla de referidos registrados: tenant referidor, tenant referido, fecha, estado, recompensa aplicada
- Botón `Aprobar recompensa` por fila — al aprobar aplica automáticamente los días/descuento al tenant referidor
- Botón `Rechazar` con campo de motivo
- Exportar a CSV

---

### 10. Marca de agua (`/admin/branding`)
- Preview en vivo de cómo se ve la marca de agua en un flipbook de ejemplo
- Configuración:
  - Texto de la marca de agua (default: `Creado con Intap Flipbook`)
  - Logo opcional (upload PNG, se muestra junto al texto)
  - URL destino al hacer click en la marca
  - Posición: esquina inferior derecha / inferior izquierda / inferior centro
  - Opacidad (slider 10% a 100%)
- Reglas por plan:
  - **Free** — marca de agua fija, no removible por el tenant
  - **Basic** — visible por defecto, el tenant puede ocultarla desde configuración del flipbook
  - **Pro** — oculta por defecto, el tenant puede mostrar su propio logo en su lugar
- Override manual por tenant: el Admin puede forzar o remover la marca de agua a cualquier tenant independientemente de su plan

---

### 11. Notificaciones (`/admin/notifications`)
- Formulario para enviar notificación:
  - Destinatario: todos los tenants / por plan / tenant específico
  - Canal: in-app (banner en dashboard) / email
  - Asunto y mensaje
  - Programar envío: inmediato o fecha/hora específica
- Historial de notificaciones enviadas con estado de lectura

---

### 12. Estadísticas globales (`/admin/stats`)
- MRR y ARR con tendencia mes a mes
- Churn rate (tenants que bajaron de plan o cancelaron)
- Storage total consumido vs capacidad
- Distribución de tenants por plan (gráfico de dona)
- Top 10 tenants por vistas generadas
- Top 10 flipbooks más vistos globalmente

---

## ⚙️ LÓGICA DE DEGRADADO AUTOMÁTICO

En `apps/api/src/lib/plans.ts` agregar función `checkAndDegradeExpiredTenants()`:
- Se ejecuta via Cloudflare Workers Cron Trigger (diariamente a las 2am)
- Busca en D1 todos los usuarios donde `plan_expires_at < NOW()` y `plan != 'free'`
- Los cambia a plan Free automáticamente
- Registra el evento en tabla `plan_history`
- Envía notificación in-app al tenant: "Tu plan ha vencido. Contacta al equipo para renovar."
- El Super Admin ve estos casos destacados en el dashboard global

**Período de gracia:** configurable por el Super Admin (default: 3 días). Durante la gracia el tenant sigue activo pero ve un banner de advertencia.

---

## 🗄️ CAMBIOS AL SCHEMA D1

```sql
-- Categorías de flipbook
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Carpetas/colecciones del tenant
CREATE TABLE folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Agregar a publications
ALTER TABLE publications ADD COLUMN category_id INTEGER REFERENCES categories(id);
ALTER TABLE publications ADD COLUMN folder_id INTEGER REFERENCES folders(id);
ALTER TABLE publications ADD COLUMN description TEXT;
ALTER TABLE publications ADD COLUMN cover_url TEXT;
ALTER TABLE publications ADD COLUMN views_count INTEGER DEFAULT 0;
ALTER TABLE publications ADD COLUMN sound_enabled INTEGER DEFAULT 0;
ALTER TABLE publications ADD COLUMN contact_form_enabled INTEGER DEFAULT 0;
ALTER TABLE publications ADD COLUMN share_buttons_enabled INTEGER DEFAULT 1;

-- Agregar a pages (para el editor en línea)
ALTER TABLE pages ADD COLUMN canvas_json TEXT; -- estado del canvas como JSON

-- Historial de cambios de plan
CREATE TABLE plan_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  from_plan TEXT,
  to_plan TEXT NOT NULL,
  changed_by TEXT NOT NULL, -- 'admin' | 'system' | 'user'
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Solicitudes de cambio de plan (del tenant)
CREATE TABLE plan_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  requested_plan TEXT NOT NULL,
  direction TEXT NOT NULL, -- 'upgrade' | 'downgrade'
  status TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  resolved_by INTEGER
);

-- Registro de pagos
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD', -- 'USD' | 'DOP'
  method TEXT NOT NULL, -- 'transfer' | 'deposit' | 'paypal' | 'readdy' | 'other'
  gateway TEXT,
  reference TEXT,
  status TEXT DEFAULT 'paid', -- 'paid' | 'pending' | 'expired' | 'refunded'
  plan_paid TEXT NOT NULL,
  period_days INTEGER DEFAULT 30,
  notes TEXT,
  registered_by INTEGER, -- admin que lo registró
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Pasarelas de pago
CREATE TABLE payment_gateways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'transfer' | 'deposit' | 'paypal' | 'readdy' | 'custom'
  config_json TEXT, -- credenciales y configuración como JSON
  instructions TEXT, -- instrucciones visibles al tenant
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

-- Módulos del sistema
CREATE TABLE modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  active_globally INTEGER DEFAULT 1
);

-- Módulos por plan
CREATE TABLE plan_modules (
  plan TEXT NOT NULL,
  module_key TEXT NOT NULL,
  PRIMARY KEY (plan, module_key)
);

-- Módulos por tenant (excepciones manuales)
CREATE TABLE tenant_modules (
  user_id INTEGER NOT NULL,
  module_key TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  PRIMARY KEY (user_id, module_key)
);

-- Notificaciones
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, -- NULL = todos
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Estadísticas de vistas por flipbook
CREATE TABLE publication_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id INTEGER NOT NULL,
  page_number INTEGER,
  device TEXT, -- 'desktop' | 'tablet' | 'mobile'
  viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Plantillas prediseñadas (Admin las sube)
CREATE TABLE templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  plan_required TEXT DEFAULT 'free', -- 'free' | 'basic' | 'pro'
  cover_url TEXT,
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Páginas de plantilla
CREATE TABLE template_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id),
  image_url TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  canvas_json TEXT
);

-- Elementos del editor (íconos, fondos, formas, botones)
CREATE TABLE editor_elements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'icon' | 'background' | 'shape' | 'button'
  file_url TEXT NOT NULL,
  plan_required TEXT DEFAULT 'free',
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tutoriales
CREATE TABLE tutorials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL, -- 'getting_started' | 'editor' | 'publish' | 'plans'
  type TEXT NOT NULL, -- 'video' | 'guide'
  url TEXT, -- URL de video (YouTube/Vimeo)
  content TEXT, -- texto de guía si type = 'guide'
  thumbnail_url TEXT,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seguimiento de tutoriales vistos por tenant
CREATE TABLE tutorial_views (
  user_id INTEGER NOT NULL,
  tutorial_id INTEGER NOT NULL,
  viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tutorial_id)
);

-- Promociones
CREATE TABLE promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  benefit_type TEXT NOT NULL, -- 'discount_percent' | 'free_days' | 'temp_upgrade'
  benefit_value TEXT NOT NULL, -- número de días, % de descuento, o plan temporal
  target_plans TEXT NOT NULL, -- 'all' o JSON array: '["free","basic"]'
  cta_text TEXT,
  cta_url TEXT,
  promo_code TEXT,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  status TEXT DEFAULT 'active', -- 'active' | 'paused' | 'scheduled'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Programa de referidos — configuración global
CREATE TABLE referral_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  active INTEGER DEFAULT 1,
  reward_type TEXT DEFAULT 'free_days', -- 'free_days' | 'discount_percent'
  reward_value INTEGER DEFAULT 15, -- días o %
  activation_condition TEXT DEFAULT 'paid_plan', -- 'registered' | 'paid_plan'
  link_validity_days INTEGER DEFAULT 0 -- 0 = sin límite
);

-- Referidos
CREATE TABLE referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL, -- tenant que refirió
  referred_id INTEGER NOT NULL, -- tenant referido
  status TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  reward_applied INTEGER DEFAULT 0,
  reject_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  resolved_by INTEGER
);

-- Configuración de marca de agua
CREATE TABLE watermark_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  text TEXT DEFAULT 'Creado con Intap Flipbook',
  logo_url TEXT,
  link_url TEXT DEFAULT 'https://intapflipbook.com',
  position TEXT DEFAULT 'bottom-right', -- 'bottom-right' | 'bottom-left' | 'bottom-center'
  opacity INTEGER DEFAULT 80 -- 10 a 100
);

-- Override de marca de agua por tenant
ALTER TABLE users ADD COLUMN watermark_override TEXT DEFAULT 'plan'; -- 'plan' | 'force_show' | 'force_hide'
ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE; -- código único de referido
ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN plan_expires_at DATETIME;
ALTER TABLE users ADD COLUMN grace_period_days INTEGER DEFAULT 3;
```

---

## 📋 REGLAS ABSOLUTAS PARA CODE

1. No inventar funciones que no estén descritas en este documento
2. No cambiar el stack (Workers + Hono + D1 + R2 + KV + React/Vite)
3. No hacer deploy ni push sin aprobación de Juan
4. Esperar confirmación entre fases (máx 4 pasos por fase)
5. Siempre en español con explicación de términos técnicos nuevos
6. El Super Admin gestiona todo lo que sea plan, pago, límite y estado
7. El tenant solo solicita cambios, nunca los ejecuta directamente
8. Los pagos manuales los registra el Super Admin, no hay checkout automático en v1
9. Usar Recharts para todos los gráficos (ya está en el proyecto)
10. Fabric.js para el canvas del editor en línea
11. Mailchannels para envío de emails desde el Worker (gratuito, nativo en Cloudflare)
12. Las plantillas, elementos, tutoriales, promociones y marca de agua los gestiona exclusivamente el Super Admin
13. La marca de agua se renderiza en el viewer según la regla del plan; el override del Admin tiene prioridad absoluta
14. El programa de referidos requiere aprobación manual del Admin antes de aplicar cualquier recompensa
15. Las promociones activas se muestran automáticamente al tenant según su plan sin acción del tenant

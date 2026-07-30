-- Catálogo inicial de funciones y límites.
-- Requiere migration_entitlements_foundation.sql.

-- Clasificación de módulos legacy existentes.
UPDATE modules
SET category = 'viewer',
    value_type = 'boolean',
    default_value_json = 'false',
    updated_at = datetime('now')
WHERE key IN (
  'sound',
  'links',
  'contact_form',
  'qr',
  'share_buttons'
);

UPDATE modules
SET category = 'editor',
    value_type = 'boolean',
    default_value_json = 'false',
    updated_at = datetime('now')
WHERE key = 'editor';

UPDATE modules
SET category = 'analytics',
    value_type = 'boolean',
    default_value_json = 'false',
    updated_at = datetime('now')
WHERE key = 'stats_advanced';

UPDATE modules
SET category = 'branding',
    value_type = 'boolean',
    default_value_json = 'false',
    updated_at = datetime('now')
WHERE key IN (
  'custom_domain',
  'watermark_hide'
);

UPDATE modules
SET category = 'templates',
    value_type = 'boolean',
    default_value_json = 'false',
    updated_at = datetime('now')
WHERE key IN (
  'templates_basic',
  'templates_pro'
);

-- Límites centrales.
INSERT OR IGNORE INTO modules (
  key,
  name,
  description,
  active_globally,
  category,
  value_type,
  default_value_json,
  sort_order,
  updated_at
) VALUES
  (
    'publications.max_count',
    'Cantidad máxima de publicaciones',
    'Límite total de publicaciones permitidas al tenant.',
    1,
    'limits',
    'integer',
    '0',
    10,
    datetime('now')
  ),
  (
    'pages.max_per_publication',
    'Páginas por publicación',
    'Cantidad máxima de páginas permitidas por publicación.',
    1,
    'limits',
    'integer',
    '0',
    20,
    datetime('now')
  ),
  (
    'storage.max_mb',
    'Almacenamiento máximo',
    'Cantidad máxima de almacenamiento físico permitida en MB.',
    1,
    'limits',
    'integer',
    '0',
    30,
    datetime('now')
  );

-- Marca de agua.
INSERT OR IGNORE INTO modules (
  key,
  name,
  description,
  active_globally,
  category,
  value_type,
  default_value_json,
  sort_order,
  updated_at
) VALUES
  (
    'watermark.enabled',
    'Mostrar marca de agua',
    'Determina si el plan muestra la marca de agua de INTAP.',
    1,
    'branding',
    'boolean',
    'true',
    100,
    datetime('now')
  ),
  (
    'watermark.custom_text',
    'Texto personalizado de marca de agua',
    'Permite personalizar el texto de la marca de agua.',
    1,
    'branding',
    'boolean',
    'false',
    110,
    datetime('now')
  ),
  (
    'watermark.custom_link',
    'Enlace personalizado de marca de agua',
    'Permite personalizar el destino del enlace de la marca de agua.',
    1,
    'branding',
    'boolean',
    'false',
    120,
    datetime('now')
  ),
  (
    'watermark.custom_logo',
    'Logo personalizado de marca de agua',
    'Permite utilizar un logo personalizado en la marca de agua.',
    1,
    'branding',
    'boolean',
    'false',
    130,
    datetime('now')
  );

-- Funciones previstas en el mapa de ruta.
INSERT OR IGNORE INTO modules (
  key,
  name,
  description,
  active_globally,
  category,
  value_type,
  default_value_json,
  sort_order,
  updated_at
) VALUES
  (
    'interactive_cards.enabled',
    'Fichas interactivas',
    'Permite crear y utilizar fichas interactivas.',
    1,
    'interactive',
    'boolean',
    'false',
    200,
    datetime('now')
  ),
  (
    'interactive_cards.max_count',
    'Cantidad de fichas interactivas',
    'Cantidad máxima de fichas interactivas del tenant.',
    1,
    'interactive',
    'integer',
    '0',
    210,
    datetime('now')
  ),
  (
    'interactive_card_button.enabled',
    'Botón de ficha',
    'Permite utilizar el botón visual para abrir fichas.',
    1,
    'interactive',
    'boolean',
    'false',
    220,
    datetime('now')
  ),
  (
    'product_details.enabled',
    'Detalles de producto',
    'Permite utilizar fichas de Detalles de producto.',
    1,
    'commerce',
    'boolean',
    'false',
    230,
    datetime('now')
  ),
  (
    'dynamic_data.enabled',
    'Data Dinámica',
    'Permite utilizar registros de Data Dinámica.',
    1,
    'commerce',
    'boolean',
    'false',
    240,
    datetime('now')
  ),
  (
    'agenda.enabled',
    'Agenda',
    'Permite utilizar el módulo central de Agenda.',
    1,
    'operations',
    'boolean',
    'false',
    250,
    datetime('now')
  ),
  (
    'requests.enabled',
    'Solicitudes',
    'Permite gestionar solicitudes comerciales.',
    1,
    'operations',
    'boolean',
    'false',
    260,
    datetime('now')
  ),
  (
    'private_attachments.enabled',
    'Adjuntos privados',
    'Permite adjuntar documentos privados en solicitudes.',
    1,
    'operations',
    'boolean',
    'false',
    270,
    datetime('now')
  ),
  (
    'team.max_users',
    'Usuarios del equipo',
    'Cantidad máxima de usuarios permitidos en el equipo.',
    1,
    'team',
    'integer',
    '1',
    300,
    datetime('now')
  ),
  (
    'roles.enabled',
    'Roles y permisos',
    'Permite administrar roles y permisos del equipo.',
    1,
    'team',
    'boolean',
    'false',
    310,
    datetime('now')
  ),
  (
    'pdf_export.enabled',
    'Exportación PDF',
    'Permite exportar publicaciones en formato PDF.',
    1,
    'export',
    'boolean',
    'false',
    400,
    datetime('now')
  ),
  (
    'portable_file_export.enabled',
    'Archivo portable INTAP',
    'Permite exportar una publicación en formato portable.',
    1,
    'export',
    'boolean',
    'false',
    410,
    datetime('now')
  ),
  (
    'safe_cloning.enabled',
    'Clonación segura',
    'Permite clonar publicaciones y sus dependencias de forma controlada.',
    1,
    'publishing',
    'boolean',
    'false',
    420,
    datetime('now')
  );

-- Backfill de límites actuales desde plans.
INSERT OR REPLACE INTO plan_modules (
  plan_id,
  module_key,
  value_json,
  updated_at
)
SELECT
  id,
  'publications.max_count',
  CASE
    WHEN max_publications IS NULL THEN 'null'
    ELSE CAST(max_publications AS TEXT)
  END,
  datetime('now')
FROM plans;

INSERT OR REPLACE INTO plan_modules (
  plan_id,
  module_key,
  value_json,
  updated_at
)
SELECT
  id,
  'pages.max_per_publication',
  CASE
    WHEN max_pages_per_pub IS NULL THEN 'null'
    ELSE CAST(max_pages_per_pub AS TEXT)
  END,
  datetime('now')
FROM plans;

INSERT OR REPLACE INTO plan_modules (
  plan_id,
  module_key,
  value_json,
  updated_at
)
SELECT
  id,
  'storage.max_mb',
  CASE
    WHEN max_storage_mb IS NULL THEN 'null'
    ELSE CAST(max_storage_mb AS TEXT)
  END,
  datetime('now')
FROM plans;

-- Comportamiento actual de la marca de agua.
INSERT OR REPLACE INTO plan_modules (
  plan_id,
  module_key,
  value_json,
  updated_at
)
SELECT
  id,
  'watermark.enabled',
  CASE
    WHEN id IN ('free', 'basic') THEN 'true'
    ELSE 'false'
  END,
  datetime('now')
FROM plans;

-- Conserva el derecho legacy de ocultar marca para planes pagados.
INSERT OR IGNORE INTO plan_modules (
  plan_id,
  module_key,
  value_json,
  updated_at
)
SELECT
  id,
  'watermark_hide',
  'true',
  datetime('now')
FROM plans
WHERE id <> 'free';

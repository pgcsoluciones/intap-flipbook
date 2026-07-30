-- Evolución del sistema existente de módulos hacia entitlements tipados.
--
-- Se reutilizan:
--   modules         -> catálogo central de funciones
--   plan_modules    -> valores por plan
--   tenant_modules  -> excepciones por tenant
--
-- No se crea un segundo sistema paralelo.

-- Catálogo central.
ALTER TABLE modules ADD COLUMN category TEXT;
ALTER TABLE modules ADD COLUMN value_type TEXT NOT NULL DEFAULT 'boolean';
ALTER TABLE modules ADD COLUMN default_value_json TEXT NOT NULL DEFAULT 'false';
ALTER TABLE modules ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE modules ADD COLUMN updated_at TEXT;

-- Valor efectivo asignado a cada plan.
-- Las filas existentes representan módulos habilitados, por eso reciben true.
ALTER TABLE plan_modules ADD COLUMN value_json TEXT NOT NULL DEFAULT 'true';
ALTER TABLE plan_modules ADD COLUMN updated_at TEXT;

-- Excepciones controladas por tenant.
-- enabled se conserva temporalmente para compatibilidad legacy.
ALTER TABLE tenant_modules ADD COLUMN value_json TEXT;
ALTER TABLE tenant_modules ADD COLUMN reason TEXT;
ALTER TABLE tenant_modules ADD COLUMN changed_by TEXT;
ALTER TABLE tenant_modules ADD COLUMN expires_at TEXT;
ALTER TABLE tenant_modules ADD COLUMN updated_at TEXT;

UPDATE modules
SET category = COALESCE(category, 'legacy'),
    value_type = COALESCE(value_type, 'boolean'),
    default_value_json = COALESCE(default_value_json, 'false'),
    sort_order = CASE
      WHEN sort_order IS NULL OR sort_order = 0 THEN id
      ELSE sort_order
    END,
    updated_at = COALESCE(updated_at, datetime('now'));

UPDATE plan_modules
SET value_json = COALESCE(value_json, 'true'),
    updated_at = COALESCE(updated_at, datetime('now'));

UPDATE tenant_modules
SET value_json = COALESCE(
      value_json,
      CASE
        WHEN enabled = 1 THEN 'true'
        ELSE 'false'
      END
    ),
    updated_at = COALESCE(updated_at, datetime('now'));

CREATE INDEX IF NOT EXISTS idx_modules_category_order
  ON modules (
    category,
    sort_order,
    key
  );

CREATE INDEX IF NOT EXISTS idx_plan_modules_plan
  ON plan_modules (
    plan_id,
    module_key
  );

CREATE INDEX IF NOT EXISTS idx_tenant_modules_expiry
  ON tenant_modules (
    user_id,
    expires_at
  );

-- Historial reutilizable por Super Admin, auditoría y soporte.
CREATE TABLE IF NOT EXISTS entitlement_audit_log (
  id TEXT PRIMARY KEY,

  actor_user_id TEXT,
  tenant_id TEXT,
  plan_id TEXT,

  feature_key TEXT NOT NULL,

  scope TEXT NOT NULL
    CHECK (
      scope IN (
        'global',
        'plan',
        'tenant'
      )
    ),

  previous_value_json TEXT,
  new_value_json TEXT,
  reason TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entitlement_audit_feature
  ON entitlement_audit_log (
    feature_key,
    created_at
  );

CREATE INDEX IF NOT EXISTS idx_entitlement_audit_tenant
  ON entitlement_audit_log (
    tenant_id,
    created_at
  );

CREATE INDEX IF NOT EXISTS idx_entitlement_audit_plan
  ON entitlement_audit_log (
    plan_id,
    created_at
  );

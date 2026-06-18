-- Fase 16 — Frecuencia de facturación por plan
--   billing_period: 'monthly' | 'quarterly' | 'annual' | 'custom'
--   (period_days ya existe desde fase12 y define los días de vigencia que otorga un pago)
ALTER TABLE plans ADD COLUMN billing_period TEXT DEFAULT 'monthly';
UPDATE plans SET billing_period = 'monthly' WHERE billing_period IS NULL;

-- Migración: branding y contacto empresarial del tenant
-- Ejecutar desde Mac de Juan:
--   npx wrangler d1 execute intap-flipbook-db --file=src/db/migration_branding.sql --remote

ALTER TABLE users ADD COLUMN logo_url TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN contact_phone TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN contact_whatsapp TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN contact_email TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN contact_address TEXT DEFAULT NULL;

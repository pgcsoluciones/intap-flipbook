-- Social preview metadata per publication
-- Ejecutar: wrangler d1 execute intap-flipbook-db --file=apps/api/src/db/migration_social_preview.sql --remote

ALTER TABLE publications ADD COLUMN social_title TEXT;
ALTER TABLE publications ADD COLUMN social_description TEXT;
ALTER TABLE publications ADD COLUMN social_image_url TEXT;
ALTER TABLE publications ADD COLUMN social_image_source_url TEXT;
ALTER TABLE publications ADD COLUMN social_image_crop_json TEXT;
ALTER TABLE publications ADD COLUMN social_updated_at TEXT;

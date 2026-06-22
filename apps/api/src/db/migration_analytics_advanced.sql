-- Geolocalización y metadata en page_events
ALTER TABLE page_events ADD COLUMN country TEXT DEFAULT NULL;
ALTER TABLE page_events ADD COLUMN city TEXT DEFAULT NULL;
ALTER TABLE page_events ADD COLUMN referrer TEXT DEFAULT NULL;
ALTER TABLE page_events ADD COLUMN url_destination TEXT DEFAULT NULL;

-- Geolocalización en publication_views
ALTER TABLE publication_views ADD COLUMN country TEXT DEFAULT NULL;
ALTER TABLE publication_views ADD COLUMN city TEXT DEFAULT NULL;
ALTER TABLE publication_views ADD COLUMN referrer TEXT DEFAULT NULL;

-- Índice para consultas por país
CREATE INDEX IF NOT EXISTS idx_page_events_country ON page_events(publication_id, country);
CREATE INDEX IF NOT EXISTS idx_pub_views_country ON publication_views(publication_id, country);

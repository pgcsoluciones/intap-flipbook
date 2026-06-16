-- Migration 001: add size_bytes to pages for storage quota tracking
-- Run: wrangler d1 execute intap-flipbook-db --file=apps/api/src/db/migrations/001_add_size_bytes.sql
ALTER TABLE pages ADD COLUMN size_bytes INTEGER DEFAULT 0;

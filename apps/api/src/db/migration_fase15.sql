-- Fase 15 — Fixes: notificaciones (canal + programación) + imagen en promociones
--
-- La tabla notifications no tenía las columnas que el panel admin intenta guardar,
-- por eso "Enviar notificación" devolvía error 500 (Internal Server Error).
ALTER TABLE notifications ADD COLUMN channel TEXT DEFAULT 'in_app';   -- 'in_app' | 'email'
ALTER TABLE notifications ADD COLUMN scheduled_at TEXT;               -- fecha/hora programada (NULL = inmediato)

-- Imagen opcional para las promociones (banner mostrado al tenant).
ALTER TABLE promotions ADD COLUMN image_url TEXT;

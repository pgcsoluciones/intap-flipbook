-- Fase 5.1 · Datos operativos por tipo de cita.
-- Migración aditiva de una sola ejecución, posterior a migration_appointment_calendars.sql.
-- No ejecutar dos veces manualmente.

ALTER TABLE appointment_calendar_types
  ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'in_person'
  CHECK (delivery_mode IN ('in_person', 'video_call', 'phone_call', 'other'));

ALTER TABLE appointment_calendar_types
  ADD COLUMN location_text TEXT;

ALTER TABLE appointment_calendar_types
  ADD COLUMN meeting_url TEXT;

ALTER TABLE appointment_calendar_types
  ADD COLUMN customer_instructions TEXT;

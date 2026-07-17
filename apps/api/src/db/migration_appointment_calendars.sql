-- Fase Agenda — Disponibilidad real para Agendar.
-- Migracion aditiva para crear Agendas y reservas independientes.
-- Aplicar una sola vez.

CREATE TABLE IF NOT EXISTS appointment_calendars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Santo_Domingo',
  slot_interval_minutes INTEGER NOT NULL DEFAULT 30,
  default_duration_minutes INTEGER NOT NULL DEFAULT 60,
  default_buffer_minutes INTEGER NOT NULL DEFAULT 0,
  max_per_slot INTEGER NOT NULL DEFAULT 1,
  max_per_day INTEGER NOT NULL DEFAULT 8,
  min_notice_minutes INTEGER NOT NULL DEFAULT 120,
  booking_horizon_days INTEGER NOT NULL DEFAULT 30,
  hold_expires_after_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (slot_interval_minutes BETWEEN 5 AND 240),
  CHECK (default_duration_minutes BETWEEN 5 AND 1440),
  CHECK (default_buffer_minutes BETWEEN 0 AND 1440),
  CHECK (max_per_slot BETWEEN 1 AND 999),
  CHECK (max_per_day BETWEEN 1 AND 999),
  CHECK (min_notice_minutes BETWEEN 0 AND 525600),
  CHECK (booking_horizon_days BETWEEN 1 AND 730),
  CHECK (hold_expires_after_minutes BETWEEN 1 AND 10080)
);

ALTER TABLE dynamic_markers ADD COLUMN booking_calendar_id TEXT REFERENCES appointment_calendars(id);

CREATE TABLE IF NOT EXISTS appointment_calendar_weekly_windows (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES appointment_calendars(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (weekday BETWEEN 0 AND 6),
  CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]')
);

CREATE TABLE IF NOT EXISTS appointment_calendar_exceptions (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES appointment_calendars(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('blocked_full', 'blocked_partial', 'extra')),
  start_time TEXT,
  end_time TEXT,
  max_per_slot_override INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  CHECK (start_time IS NULL OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  CHECK (end_time IS NULL OR end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  CHECK (max_per_slot_override IS NULL OR max_per_slot_override BETWEEN 1 AND 999)
);

CREATE TABLE IF NOT EXISTS appointment_calendar_types (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES appointment_calendars(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  duration_minutes INTEGER,
  buffer_minutes INTEGER,
  max_per_slot INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 1440),
  CHECK (buffer_minutes IS NULL OR buffer_minutes BETWEEN 0 AND 1440),
  CHECK (max_per_slot IS NULL OR max_per_slot BETWEEN 1 AND 999)
);

CREATE TABLE IF NOT EXISTS appointment_calendar_bookings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  marker_id TEXT NOT NULL REFERENCES dynamic_markers(id),
  calendar_id TEXT NOT NULL REFERENCES appointment_calendars(id),
  appointment_type TEXT NOT NULL,
  starts_at_utc TEXT NOT NULL,
  ends_at_utc TEXT NOT NULL,
  local_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  delivery_mode_snapshot TEXT,
  location_snapshot TEXT,
  customer_instructions_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'rejected', 'expired')),
  hold_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointment_slot_allocations (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES appointment_calendar_bookings(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES appointment_calendars(id),
  slot_start_utc TEXT NOT NULL,
  capacity_unit INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(calendar_id, slot_start_utc, capacity_unit)
);

CREATE INDEX IF NOT EXISTS idx_dynamic_markers_booking_calendar ON dynamic_markers(booking_calendar_id);
CREATE INDEX IF NOT EXISTS idx_appointment_calendars_user ON appointment_calendars(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointment_windows_calendar ON appointment_calendar_weekly_windows(calendar_id, weekday, sort_order);
CREATE INDEX IF NOT EXISTS idx_appointment_exceptions_calendar ON appointment_calendar_exceptions(calendar_id, date);
CREATE INDEX IF NOT EXISTS idx_appointment_types_calendar ON appointment_calendar_types(calendar_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_appointment_calendar_bookings_calendar_time ON appointment_calendar_bookings(calendar_id, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_appointment_calendar_bookings_calendar_local_date ON appointment_calendar_bookings(calendar_id, local_date, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_appointment_calendar_bookings_user_local_date ON appointment_calendar_bookings(user_id, local_date, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_appointment_calendar_bookings_marker ON appointment_calendar_bookings(marker_id, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_appointment_calendar_bookings_status ON appointment_calendar_bookings(calendar_id, status, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_appointment_allocations_booking ON appointment_slot_allocations(booking_id);

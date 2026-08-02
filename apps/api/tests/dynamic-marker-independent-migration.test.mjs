import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, test } from 'node:test'

const dir = await mkdtemp(join(tmpdir(), 'dynamic-marker-independent-migration-'))
after(() => rm(dir, { recursive: true, force: true }))

function sqlite(dbPath, sql) {
  const result = spawnSync('sqlite3', ['-batch', dbPath], {
    input: sql,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `sqlite3 exited with ${result.status}`)
  }
  return result.stdout
}

function sqliteMayFail(dbPath, sql) {
  return spawnSync('sqlite3', ['-batch', dbPath], {
    input: sql,
    encoding: 'utf8',
  })
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const previousPreviewSchema = `
PRAGMA foreign_keys=ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY
);

CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  deleted_at TEXT
);

CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  page_number INTEGER,
  canvas_json TEXT
);

CREATE TABLE appointment_calendars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id)
);

CREATE TABLE dynamic_markers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  page_id TEXT NOT NULL REFERENCES pages(id),
  target_object_id TEXT NOT NULL,
  target_kind TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive')),
  name TEXT,
  reference TEXT,
  category TEXT,
  description TEXT,
  price_minor INTEGER,
  previous_price_minor INTEGER,
  currency TEXT,
  availability TEXT,
  promotion_text TEXT,
  custom_fields_json TEXT NOT NULL DEFAULT '[]',
  cloned_from_marker_id TEXT REFERENCES dynamic_markers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  colors_json TEXT NOT NULL DEFAULT '[]',
  materials_json TEXT NOT NULL DEFAULT '[]',
  sizes_json TEXT NOT NULL DEFAULT '[]',
  measurements_json TEXT NOT NULL DEFAULT '[]',
  media_json TEXT NOT NULL DEFAULT '[]',
  actions_json TEXT NOT NULL DEFAULT '{}',
  accent_color TEXT NOT NULL DEFAULT '#F59E0B',
  badge_text TEXT,
  promotion_ends_at TEXT,
  post_promotion_price_minor INTEGER,
  booking_calendar_id TEXT REFERENCES appointment_calendars(id),
  UNIQUE(publication_id, page_id, target_object_id),
  CHECK (status <> 'active' OR (name IS NOT NULL AND length(trim(name)) > 0)),
  CHECK (
    price_minor IS NULL OR
    (typeof(price_minor) = 'integer' AND price_minor >= 0)
  ),
  CHECK (
    previous_price_minor IS NULL OR
    (typeof(previous_price_minor) = 'integer' AND previous_price_minor >= 0)
  ),
  CHECK (currency IS NULL OR length(currency) = 3)
);

CREATE INDEX idx_dynamic_markers_booking_calendar ON dynamic_markers(booking_calendar_id);
CREATE INDEX idx_dynamic_markers_page ON dynamic_markers(page_id, updated_at DESC);
CREATE INDEX idx_dynamic_markers_publication ON dynamic_markers(publication_id, updated_at DESC);
CREATE INDEX idx_dynamic_markers_status ON dynamic_markers(publication_id, status, updated_at DESC);
CREATE INDEX idx_dynamic_markers_user_publication_updated
ON dynamic_markers(user_id, publication_id, updated_at DESC, id DESC);
CREATE INDEX idx_dynamic_markers_user_status_updated
ON dynamic_markers(user_id, status, updated_at DESC, id DESC);
CREATE INDEX idx_dynamic_markers_user_updated
ON dynamic_markers(user_id, updated_at DESC, id DESC);

CREATE TABLE lead_intakes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES users(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  marker_id TEXT NOT NULL REFERENCES dynamic_markers(id),
  request_type TEXT NOT NULL DEFAULT 'quote',
  status TEXT NOT NULL DEFAULT 'new',
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  customer_message TEXT,
  marker_snapshot_json TEXT NOT NULL,
  source_url TEXT,
  internal_note TEXT,
  crm_contact_id TEXT,
  crm_lead_id TEXT,
  booking_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  handled_at TEXT,
  selection_json TEXT,
  read_at TEXT
);

CREATE TABLE appointment_calendar_bookings (
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
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'rejected', 'expired')),
  hold_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivery_mode_snapshot TEXT,
  location_snapshot TEXT,
  customer_instructions_snapshot TEXT
);

CREATE TABLE appointment_slot_allocations (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES appointment_calendar_bookings(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES appointment_calendars(id),
  slot_start_utc TEXT NOT NULL,
  capacity_unit INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(calendar_id, slot_start_utc, capacity_unit)
);

INSERT INTO users (id) VALUES ('user-1');
INSERT INTO publications (id, user_id) VALUES ('pub-1', 'user-1');
INSERT INTO pages (id, publication_id, page_number) VALUES ('page-1', 'pub-1', 1);
INSERT INTO appointment_calendars (id, user_id) VALUES ('calendar-1', 'user-1');

INSERT INTO dynamic_markers (
  id,
  user_id,
  publication_id,
  page_id,
  target_object_id,
  target_kind,
  status,
  name,
  reference,
  category,
  description,
  price_minor,
  previous_price_minor,
  currency,
  availability,
  promotion_text,
  custom_fields_json,
  cloned_from_marker_id,
  created_at,
  updated_at,
  colors_json,
  materials_json,
  sizes_json,
  measurements_json,
  media_json,
  actions_json,
  accent_color,
  badge_text,
  promotion_ends_at,
  post_promotion_price_minor,
  booking_calendar_id
) VALUES (
  'marker-1',
  'user-1',
  'pub-1',
  'page-1',
  'object-1',
  'button',
  'active',
  'Ficha original',
  'REF-1',
  'Categoria',
  'Descripcion',
  1000,
  1200,
  'DOP',
  'Disponible',
  'Promo',
  '[{"id":"field-1"}]',
  NULL,
  '2026-08-01 00:00:00',
  '2026-08-01 00:00:00',
  '[{"id":"color-1"}]',
  '[{"id":"material-1"}]',
  '[{"id":"size-1"}]',
  '[{"id":"measurement-1"}]',
  '[{"id":"media-1"}]',
  '{"share":{"enabled":true}}',
  '#F59E0B',
  'Nuevo',
  '2026-08-01T00:00:00.000Z',
  900,
  'calendar-1'
);

INSERT INTO dynamic_markers (
  id,
  user_id,
  publication_id,
  page_id,
  target_object_id,
  target_kind,
  status,
  name,
  cloned_from_marker_id
) VALUES (
  'marker-clone',
  'user-1',
  'pub-1',
  'page-1',
  'object-clone',
  'button',
  'draft',
  'Ficha clonada',
  'marker-1'
);

INSERT INTO lead_intakes (
  id,
  tenant_id,
  publication_id,
  marker_id,
  customer_name,
  customer_phone,
  marker_snapshot_json
) VALUES (
  'lead-1',
  'user-1',
  'pub-1',
  'marker-1',
  'Cliente',
  '8090000000',
  '{}'
);

INSERT INTO appointment_calendar_bookings (
  id,
  user_id,
  publication_id,
  marker_id,
  calendar_id,
  appointment_type,
  starts_at_utc,
  ends_at_utc,
  local_date,
  local_time,
  timezone
) VALUES (
  'booking-1',
  'user-1',
  'pub-1',
  'marker-1',
  'calendar-1',
  'Visita',
  '2026-08-01T12:00:00Z',
  '2026-08-01T13:00:00Z',
  '2026-08-01',
  '08:00',
  'America/Santo_Domingo'
);

INSERT INTO appointment_slot_allocations (
  id,
  booking_id,
  calendar_id,
  slot_start_utc,
  capacity_unit
) VALUES (
  'allocation-1',
  'booking-1',
  'calendar-1',
  '2026-08-01T12:00:00Z',
  1
);
`

test('wrangler-recognized migration directory has one managed 002 and leaves legacy 001 in place', async () => {
  assert.equal(await exists('apps/api/migrations/002_allow_unlinked_dynamic_markers.sql'), true)
  assert.equal(await exists('apps/api/src/db/migrations/002_allow_unlinked_dynamic_markers.sql'), false)
  assert.equal(await exists('apps/api/src/db/migrations/001_add_size_bytes.sql'), true)

  const wranglerToml = await readFile('apps/api/wrangler.toml', 'utf8')
  assert.equal(/migrations_dir\s*=/.test(wranglerToml), false)

  const migrationFiles = spawnSync('find', ['apps/api/migrations', '-type', 'f'], { encoding: 'utf8' })
  assert.equal(migrationFiles.status, 0)
  assert.deepEqual(
    migrationFiles.stdout.trim().split('\n').filter(Boolean).sort(),
    ['apps/api/migrations/002_allow_unlinked_dynamic_markers.sql'],
  )
})

test('migracion conserva datos, dependencias, indices y checks reales de Preview', async () => {
  const dbPath = join(dir, 'migration.sqlite')
  const migration = await readFile('apps/api/migrations/002_allow_unlinked_dynamic_markers.sql', 'utf8')

  sqlite(dbPath, previousPreviewSchema)
  sqlite(dbPath, `BEGIN;\n${migration}\nCOMMIT;`)

  const nullability = sqlite(dbPath, `
.mode tabs
SELECT name, "notnull" FROM pragma_table_info('dynamic_markers') WHERE name IN ('publication_id', 'page_id', 'target_object_id');
`)
  assert.match(nullability, /publication_id\s+1/)
  assert.match(nullability, /page_id\s+0/)
  assert.match(nullability, /target_object_id\s+0/)

  const preserved = sqlite(dbPath, `
.mode tabs
SELECT id, user_id, publication_id, page_id, target_object_id, booking_calendar_id, colors_json, actions_json FROM dynamic_markers WHERE id = 'marker-1';
`)
  assert.match(preserved, /marker-1\s+user-1\s+pub-1\s+page-1\s+object-1\s+calendar-1/)
  assert.match(preserved, /\[\{"id":"color-1"\}\]/)
  assert.match(preserved, /\{"share":\{"enabled":true\}\}/)

  const cloned = sqlite(dbPath, `
.mode tabs
SELECT id, cloned_from_marker_id FROM dynamic_markers WHERE id = 'marker-clone';
`)
  assert.match(cloned, /marker-clone\s+marker-1/)

  const dependents = sqlite(dbPath, `
.mode tabs
SELECT id, marker_id FROM lead_intakes WHERE id = 'lead-1';
SELECT id, marker_id FROM appointment_calendar_bookings WHERE id = 'booking-1';
SELECT id, booking_id FROM appointment_slot_allocations WHERE id = 'allocation-1';
`)
  assert.match(dependents, /lead-1\s+marker-1/)
  assert.match(dependents, /booking-1\s+marker-1/)
  assert.match(dependents, /allocation-1\s+booking-1/)

  sqlite(dbPath, `
INSERT INTO dynamic_markers (id, user_id, publication_id, page_id, target_object_id, status, name)
VALUES ('independent-1', 'user-1', 'pub-1', NULL, NULL, 'draft', 'Ficha sin uso');
INSERT INTO dynamic_markers (id, user_id, publication_id, page_id, target_object_id, status, name)
VALUES ('independent-2', 'user-1', 'pub-1', NULL, NULL, 'draft', 'Otra ficha sin uso');
INSERT INTO dynamic_markers (id, user_id, publication_id, page_id, target_object_id, status, name)
VALUES ('direct-1', 'user-1', 'pub-1', 'page-1', 'object-2', 'draft', 'Directa');
`)

  const duplicate = sqliteMayFail(dbPath, `
INSERT INTO dynamic_markers (id, user_id, publication_id, page_id, target_object_id, status, name)
VALUES ('direct-2', 'user-1', 'pub-1', 'page-1', 'object-2', 'draft', 'Duplicada');
`)
  assert.notEqual(duplicate.status, 0)
  assert.match(duplicate.stderr, /UNIQUE constraint failed/)

  const missingPublication = sqliteMayFail(dbPath, `
INSERT INTO dynamic_markers (id, user_id, publication_id, page_id, target_object_id, status, name)
VALUES ('bad-pub', 'user-1', NULL, NULL, NULL, 'draft', 'Sin publicacion');
`)
  assert.notEqual(missingPublication.status, 0)
  assert.match(missingPublication.stderr, /NOT NULL constraint failed/)

  for (const statement of [
    `INSERT INTO dynamic_markers (id, user_id, publication_id, page_id, target_object_id, status, name) VALUES ('bad-active', 'user-1', 'pub-1', NULL, NULL, 'active', ' ')`,
    `INSERT INTO dynamic_markers (id, user_id, publication_id, page_id, target_object_id, status, name, price_minor) VALUES ('bad-price', 'user-1', 'pub-1', NULL, NULL, 'draft', 'Precio malo', -1)`,
    `INSERT INTO dynamic_markers (id, user_id, publication_id, page_id, target_object_id, status, name, previous_price_minor) VALUES ('bad-prev-price', 'user-1', 'pub-1', NULL, NULL, 'draft', 'Precio anterior malo', -1)`,
    `INSERT INTO dynamic_markers (id, user_id, publication_id, page_id, target_object_id, status, name, currency) VALUES ('bad-currency', 'user-1', 'pub-1', NULL, NULL, 'draft', 'Moneda mala', 'DO')`,
  ]) {
    const result = sqliteMayFail(dbPath, statement)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /CHECK constraint failed/)
  }

  const indexes = sqlite(dbPath, `
.mode tabs
SELECT name FROM pragma_index_list('dynamic_markers') ORDER BY name;
`)
  for (const indexName of [
    'idx_dynamic_markers_booking_calendar',
    'idx_dynamic_markers_page',
    'idx_dynamic_markers_publication',
    'idx_dynamic_markers_status',
    'idx_dynamic_markers_user_publication_updated',
    'idx_dynamic_markers_user_status_updated',
    'idx_dynamic_markers_user_updated',
    'sqlite_autoindex_dynamic_markers_2',
  ]) {
    assert.match(indexes, new RegExp(indexName))
  }

  const indexColumns = sqlite(dbPath, `
.mode tabs
SELECT name FROM pragma_index_info('idx_dynamic_markers_user_publication_updated') ORDER BY seqno;
SELECT name FROM pragma_index_info('sqlite_autoindex_dynamic_markers_2') ORDER BY seqno;
`)
  assert.match(indexColumns, /user_id/)
  assert.match(indexColumns, /publication_id/)
  assert.match(indexColumns, /updated_at/)
  assert.match(indexColumns, /target_object_id/)

  const fkActions = sqlite(dbPath, `
.mode tabs
SELECT "from", "table", on_delete FROM pragma_foreign_key_list('dynamic_markers') ORDER BY "from", "table";
SELECT "from", "table", on_delete FROM pragma_foreign_key_list('lead_intakes') ORDER BY "from", "table";
SELECT "from", "table", on_delete FROM pragma_foreign_key_list('appointment_calendar_bookings') ORDER BY "from", "table";
`)
  assert.match(fkActions, /cloned_from_marker_id\s+dynamic_markers\s+NO ACTION/)
  assert.match(fkActions, /booking_calendar_id\s+appointment_calendars\s+NO ACTION/)
  assert.match(fkActions, /page_id\s+pages\s+NO ACTION/)
  assert.match(fkActions, /marker_id\s+dynamic_markers\s+NO ACTION/)

  const tableSql = sqlite(dbPath, `
.mode tabs
SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'dynamic_markers';
`)
  assert.match(tableSql, /CHECK \(status <> 'active'/)
  assert.match(tableSql, /typeof\(price_minor\) = 'integer'/)
  assert.match(tableSql, /typeof\(previous_price_minor\) = 'integer'/)
  assert.match(tableSql, /CHECK \(currency IS NULL OR length\(currency\) = 3\)/)
  assert.doesNotMatch(tableSql, /ON DELETE CASCADE/i)

  const deleteReferenced = sqliteMayFail(dbPath, `PRAGMA foreign_keys=ON; DELETE FROM dynamic_markers WHERE id = 'marker-1';`)
  assert.notEqual(deleteReferenced.status, 0)
  assert.match(deleteReferenced.stderr, /FOREIGN KEY constraint failed/)

  const fkCheck = sqlite(dbPath, 'PRAGMA foreign_key_check;')
  assert.equal(fkCheck.trim(), '')

  const deferState = sqlite(dbPath, 'PRAGMA defer_foreign_keys;')
  assert.match(deferState, /0/)
})

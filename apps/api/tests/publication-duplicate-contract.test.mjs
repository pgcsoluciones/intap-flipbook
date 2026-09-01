import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../src/routes/publications.ts', import.meta.url), 'utf8')

test('duplicate endpoint is tenant-authenticated and plan-limited', () => {
  assert.match(source, /publications\.post\('\/:id\/duplicate'/)
  assert.match(source, /const userId = c\.get\('user'\)\.sub/)
  assert.match(source, /checkPublicationLimit\(c\.env\.DB, userId, plan, customLimits\)/)
  assert.match(source, /sourcePages\.length > effectiveMaxPages/)
})

test('duplicate is atomic and always creates a draft with fresh identity', () => {
  assert.match(source, /await c\.env\.DB\.batch\(statements\)/)
  assert.match(source, /case 'status':[\s\S]*return "'draft'"/)
  assert.match(source, /const newPublicationId = crypto\.randomUUID\(\)/)
  assert.match(source, /views_count'[\s\S]*return '0'/)
})

test('duplicate remaps linked data and reuses physical media safely', () => {
  assert.match(source, /remapPublicationCanvasJson\(page\.canvas_json, markerIdMap\)/)
  assert.match(source, /buildMappedStorageReferenceStatement/)
  assert.match(source, /reused_physical_media: true/)
  assert.match(source, /legacy_product_details_reused: true/)
  assert.match(source, /cloned_from_marker_id: \{ sql: 'source\.id' \}/)
})

test('duplicate does not copy analytics or transactional history', () => {
  const duplicateBlock = source.slice(
    source.indexOf("publications.post('/:id/duplicate'"),
    source.indexOf('// GET /api/publications/:id/preview-access'),
  )
  assert.doesNotMatch(duplicateBlock, /INSERT INTO publication_views/)
  assert.doesNotMatch(duplicateBlock, /INSERT INTO page_events/)
  assert.doesNotMatch(duplicateBlock, /INSERT INTO form_responses/)
  assert.doesNotMatch(duplicateBlock, /INSERT INTO lead_intakes/)
  assert.doesNotMatch(duplicateBlock, /INSERT INTO appointment_calendar_bookings/)
})

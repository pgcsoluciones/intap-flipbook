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
  assert.match(source, /remapPublicationCanvasJson\(page\.canvas_json, markerIdMap, productDetailIdMap\)/)
  assert.match(source, /buildMappedStorageReferenceStatement/)
  assert.match(source, /reused_physical_media: true/)
  assert.match(source, /product_details: sourceProductDetails\.length/)
  assert.match(source, /legacy_product_details_reused: false/)
  assert.match(source, /cloned_from_marker_id: \{ sql: 'source\.id' \}/)
})

test('publication slug update uses a nullable direct binding compatible with D1', () => {
  assert.match(source, /public_slug = COALESCE\(\?, public_slug\)/)
  assert.doesNotMatch(source, /public_slug = CASE WHEN \? THEN \? ELSE public_slug END/)
  assert.match(source, /No se pudo actualizar la publicación en Preview/)
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


test('legacy product details referenced by the catalog are cloned and cleaned if the catalog transaction fails', () => {
  assert.match(source, /countOpenProductDetailReferences\(parseCanvasJson\(page\.canvas_json\)\)/)
  assert.match(source, /INSERT INTO product_details/)
  assert.match(source, /result\.meta\.last_row_id/)
  assert.match(source, /cleanupStagedProductDetails\(c\.env\.DB, userId, stagedProductDetailIds\)/)
  assert.match(source, /sourceProductDetails\.length !== usedProductDetailIds\.size/)
})

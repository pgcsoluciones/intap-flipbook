from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'No se encontró anchor de finalización: {label}')
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Harden remapping: legacy product detail ids are only remapped inside the
# explicit open_product_detail action object, never in unrelated metadata.
# ---------------------------------------------------------------------------
p = Path('apps/api/src/lib/publicationClone.ts')
s = p.read_text()
s = replace_once(
    s,
    "  const next: Record<string, unknown> = {}\n  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {",
    "  const record = value as Record<string, unknown>\n"
    "  const isProductDetailAction = record.type === 'open_product_detail'\n"
    "  const next: Record<string, unknown> = {}\n"
    "  for (const [key, child] of Object.entries(record)) {",
    'product detail action scope',
)
s = replace_once(
    s,
    "    if (PRODUCT_DETAIL_REFERENCE_KEYS.has(key)) {",
    "    if (isProductDetailAction && PRODUCT_DETAIL_REFERENCE_KEYS.has(key)) {",
    'product detail id only inside action',
)
p.write_text(s)


# ---------------------------------------------------------------------------
# Publications duplicate route: clone only legacy product details actually
# referenced by the source catalog, get their AUTOINCREMENT ids from D1, remap
# the copied canvas, and clean staged rows if the publication batch fails.
# ---------------------------------------------------------------------------
p = Path('apps/api/src/routes/publications.ts')
s = p.read_text()
s = replace_once(
    s,
    "import { slugify, uniqueSlug } from './auth'\nimport {\n",
    "import { slugify, uniqueSlug } from './auth'\n"
    "import { countOpenProductDetailReferences, parseCanvasJson } from '../lib/productDetailsCanvas'\n"
    "import {\n",
    'product details canvas import',
)

helpers = r'''
function cloneProductInternalName(value: unknown, publicationId: string): string {
  const base = String(value ?? '').trim() || 'Producto'
  const suffix = ` · copia ${publicationId.slice(0, 12)}`
  return `${base.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`
}

async function cleanupStagedProductDetails(
  db: D1Database,
  tenantId: string,
  ids: number[],
): Promise<void> {
  if (!ids.length) return
  await db.prepare(
    `DELETE FROM product_details
     WHERE tenant_id = ?
       AND id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`,
  ).bind(tenantId, JSON.stringify(ids)).run()
}
'''

s = replace_once(
    s,
    "}\n\n// GET /api/publications — solo las activas (deleted_at IS NULL)",
    "}\n\n" + helpers + "\n// GET /api/publications — solo las activas (deleted_at IS NULL)",
    'product detail clone helpers insertion',
)

product_discovery = r'''
  const usedProductDetailIds = new Set<number>()
  sourcePages.forEach((page) => {
    const refs = countOpenProductDetailReferences(parseCanvasJson(page.canvas_json))
    refs.forEach((_count, detailId) => usedProductDetailIds.add(detailId))
  })

  const sourceProductDetails = usedProductDetailIds.size
    ? await optionalCloneRows<Record<string, any>>(
        c.env.DB,
        `SELECT * FROM product_details
         WHERE tenant_id = ?
           AND id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
         ORDER BY id ASC`,
        [userId, JSON.stringify(Array.from(usedProductDetailIds))],
      )
    : []

  if (sourceProductDetails.length !== usedProductDetailIds.size) {
    return c.json({
      success: false,
      error: 'El catálogo contiene detalles de producto heredados que ya no están disponibles. Corrige esos vínculos antes de duplicar.',
    }, 409)
  }
'''

s = replace_once(
    s,
    "  const unitIdMap = new Map<string, string>()\n"
    "  sourceUnits.forEach((unit) => unitIdMap.set(String(unit.id), crypto.randomUUID()))\n\n"
    "  const [",
    "  const unitIdMap = new Map<string, string>()\n"
    "  sourceUnits.forEach((unit) => unitIdMap.set(String(unit.id), crypto.randomUUID()))\n\n"
    + product_discovery + "\n  const [",
    'legacy product detail discovery',
)

old_tail = r'''  if (pageColumns.includes('canvas_json')) {
    addStatement(buildJsonColumnUpdateStatement({
      table: 'pages',
      valueColumn: 'canvas_json',
      rows: sourcePages.map((page) => ({
        id: pageIdMap.get(String(page.id))!,
        value: remapPublicationCanvasJson(page.canvas_json, markerIdMap),
      })),
    }))
  }

  if (storageReferenceColumns.length) {
    const storageMaps = [
      [{ old_id: sourcePublicationId, new_id: newPublicationId }],
      cloneMapPairs(pageIdMap),
      cloneMapPairs(markerIdMap),
      cloneMapPairs(mediaFolderIdMap),
      cloneMapPairs(mediaAssetIdMap),
      cloneMapPairs(unitIdMap),
    ]
    storageMaps.forEach((mapRows) => {
      addStatement(buildMappedStorageReferenceStatement(mapRows, newPublicationId, sourcePublicationId))
    })
  }

  try {
    // D1 batch es atómico: si una copia dependiente falla, no queda una publicación parcial.
    await c.env.DB.batch(statements)
  } catch (error) {
    console.error('[publications.duplicate] transaction failed', {
      source_publication_id: sourcePublicationId,
      target_publication_id: newPublicationId,
      user_id: userId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json({ success: false, error: 'No se pudo completar la duplicación. El original no fue modificado.' }, 500)
  }
'''

new_tail = r'''  const productDetailIdMap = new Map<number, number>()
  const stagedProductDetailIds: number[] = []

  try {
    if (sourceProductDetails.length) {
      const productResults = await c.env.DB.batch(sourceProductDetails.map((detail) => c.env.DB.prepare(
        `INSERT INTO product_details (
          tenant_id,
          internal_name,
          title,
          description,
          price,
          image_url,
          accent_color,
          cta_type,
          cta_label,
          cta_target,
          status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        userId,
        cloneProductInternalName(detail.internal_name, newPublicationId),
        detail.title,
        detail.description ?? null,
        detail.price ?? null,
        detail.image_url ?? null,
        detail.accent_color ?? '#4F46E5',
        detail.cta_type ?? null,
        detail.cta_label ?? null,
        detail.cta_target ?? null,
        detail.status === 'active' ? 'active' : 'inactive',
      )))

      productResults.forEach((result, index) => {
        const newId = Number(result.meta.last_row_id)
        const oldId = Number(sourceProductDetails[index]?.id)
        if (!Number.isInteger(newId) || newId <= 0 || !Number.isInteger(oldId) || oldId <= 0) {
          throw new Error('D1 no devolvió un id válido al clonar un detalle de producto')
        }
        stagedProductDetailIds.push(newId)
        productDetailIdMap.set(oldId, newId)
      })

      if (productDetailIdMap.size !== sourceProductDetails.length) {
        throw new Error('No se pudo completar el mapa de detalles de producto')
      }
    }

    if (pageColumns.includes('canvas_json')) {
      addStatement(buildJsonColumnUpdateStatement({
        table: 'pages',
        valueColumn: 'canvas_json',
        rows: sourcePages.map((page) => ({
          id: pageIdMap.get(String(page.id))!,
          value: remapPublicationCanvasJson(page.canvas_json, markerIdMap, productDetailIdMap),
        })),
      }))
    }

    if (storageReferenceColumns.length) {
      const storageMaps = [
        [{ old_id: sourcePublicationId, new_id: newPublicationId }],
        cloneMapPairs(pageIdMap),
        cloneMapPairs(markerIdMap),
        cloneMapPairs(mediaFolderIdMap),
        cloneMapPairs(mediaAssetIdMap),
        cloneMapPairs(unitIdMap),
      ]
      storageMaps.forEach((mapRows) => {
        addStatement(buildMappedStorageReferenceStatement(mapRows, newPublicationId, sourcePublicationId))
      })
    }

    // El catálogo y sus dependencias propias se escriben atómicamente. Los
    // product_details heredados son tenant-global y se preparan antes solo para
    // obtener sus IDs AUTOINCREMENT; si este batch falla, se eliminan abajo.
    await c.env.DB.batch(statements)
  } catch (error) {
    if (stagedProductDetailIds.length) {
      try {
        await cleanupStagedProductDetails(c.env.DB, userId, stagedProductDetailIds)
      } catch (cleanupError) {
        console.error('[publications.duplicate] staged product detail cleanup failed', {
          source_publication_id: sourcePublicationId,
          target_publication_id: newPublicationId,
          user_id: userId,
          staged_product_detail_ids: stagedProductDetailIds,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        })
      }
    }

    console.error('[publications.duplicate] transaction failed', {
      source_publication_id: sourcePublicationId,
      target_publication_id: newPublicationId,
      user_id: userId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json({ success: false, error: 'No se pudo completar la duplicación. El original no fue modificado.' }, 500)
  }
'''

s = replace_once(s, old_tail, new_tail, 'staged product details + remap + cleanup')
s = replace_once(
    s,
    "      legacy_product_details_reused: true,\n      units: sourceUnits.length,",
    "      product_details: sourceProductDetails.length,\n"
    "      legacy_product_details_reused: false,\n"
    "      units: sourceUnits.length,",
    'clone summary independent product details',
)
p.write_text(s)


# ---------------------------------------------------------------------------
# Tests: prove product detail remapping is action-scoped and the catalog route
# stages independent rows, remaps them, and cleans them on clone failure.
# ---------------------------------------------------------------------------
p = Path('apps/api/tests/publication-clone-helpers.test.mjs')
s = p.read_text()
s = replace_once(
    s,
    "          { type: 'rect', action: { type: 'open_product_detail', detail_id: '41' } },\n",
    "          { type: 'rect', action: { type: 'open_product_detail', detail_id: '41' } },\n"
    "          { type: 'rect', data: { detail_id: 41, label: 'dato no enlazado' } },\n",
    'unrelated detail id fixture',
)
s = replace_once(
    s,
    "  assert.equal(result.objects[0].objects[2].action.detail_id, '8041')\n",
    "  assert.equal(result.objects[0].objects[2].action.detail_id, '8041')\n"
    "  assert.equal(result.objects[0].objects[3].data.detail_id, 41)\n",
    'unrelated detail id assertion',
)
p.write_text(s)

p = Path('apps/api/tests/publication-duplicate-contract.test.mjs')
s = p.read_text()
s = replace_once(
    s,
    "  assert.match(source, /remapPublicationCanvasJson\\(page\\.canvas_json, markerIdMap\\)/)\n"
    "  assert.match(source, /buildMappedStorageReferenceStatement/)\n"
    "  assert.match(source, /reused_physical_media: true/)\n"
    "  assert.match(source, /legacy_product_details_reused: true/)\n",
    "  assert.match(source, /remapPublicationCanvasJson\\(page\\.canvas_json, markerIdMap, productDetailIdMap\\)/)\n"
    "  assert.match(source, /buildMappedStorageReferenceStatement/)\n"
    "  assert.match(source, /reused_physical_media: true/)\n"
    "  assert.match(source, /product_details: sourceProductDetails\\.length/)\n"
    "  assert.match(source, /legacy_product_details_reused: false/)\n",
    'contract independent product details',
)
extra_test = r'''

test('legacy product details referenced by the catalog are cloned and cleaned if the catalog transaction fails', () => {
  assert.match(source, /countOpenProductDetailReferences\(parseCanvasJson\(page\.canvas_json\)\)/)
  assert.match(source, /INSERT INTO product_details/)
  assert.match(source, /result\.meta\.last_row_id/)
  assert.match(source, /cleanupStagedProductDetails\(c\.env\.DB, userId, stagedProductDetailIds\)/)
  assert.match(source, /sourceProductDetails\.length !== usedProductDetailIds\.size/)
})
'''
s += extra_test
p.write_text(s)

print('Independent legacy product detail finalization applied successfully')

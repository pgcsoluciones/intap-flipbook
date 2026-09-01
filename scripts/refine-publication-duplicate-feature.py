from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'No se encontró anchor de refinamiento: {label}')
    return text.replace(old, new, 1)


p = Path('apps/api/src/routes/publications.ts')
s = p.read_text()

s = replace_once(
    s,
    "import { countOpenProductDetailReferences, parseCanvasJson } from '../lib/productDetailsCanvas'\n",
    '',
    'remove product detail parser import',
)
s = replace_once(
    s,
    "  cloneNumericMapPairs,\n",
    '',
    'remove numeric map import',
)

start = s.index('function randomSqlitePositiveInteger(')
end = s.index('// GET /api/publications — solo las activas', start)
s = s[:start] + s[end:]

start = s.index('  const usedProductDetailIds = new Set<number>()')
end = s.index('  const [\n    publicationColumns,', start)
s = s[:start] + s[end:]

s = replace_once(
    s,
    "    unitColumns,\n    productDetailColumns,\n    storageReferenceColumns,",
    "    unitColumns,\n    storageReferenceColumns,",
    'promise destructuring product details',
)
s = replace_once(
    s,
    "    cloneTableColumns(c.env.DB, 'units'),\n    cloneTableColumns(c.env.DB, 'product_details'),\n    cloneTableColumns(c.env.DB, 'storage_object_references'),",
    "    cloneTableColumns(c.env.DB, 'units'),\n    cloneTableColumns(c.env.DB, 'storage_object_references'),",
    'promise product detail table lookup',
)

start = s.index('  if (productDetailColumns.length) {')
end = s.index("  if (pageColumns.includes('canvas_json')) {", start)
s = s[:start] + s[end:]

s = replace_once(
    s,
    '        value: remapPublicationCanvasJson(page.canvas_json, markerIdMap, productDetailIdMap),',
    '        value: remapPublicationCanvasJson(page.canvas_json, markerIdMap),',
    'canvas remap only publication markers',
)
s = replace_once(
    s,
    "      cloneMapPairs(unitIdMap),\n      storageReferencePairsFromNumericMap(productDetailIdMap),",
    "      cloneMapPairs(unitIdMap),",
    'storage refs product detail map',
)
s = replace_once(
    s,
    "      product_details: sourceProductDetails.length,\n      units: sourceUnits.length,",
    "      legacy_product_details_reused: true,\n      units: sourceUnits.length,",
    'clone summary product resources',
)

p.write_text(s)

p = Path('apps/api/tests/publication-duplicate-contract.test.mjs')
s = p.read_text()
s = replace_once(
    s,
    r"  assert.match(source, /remapPublicationCanvasJson\(page\.canvas_json, markerIdMap, productDetailIdMap\)/)",
    r"  assert.match(source, /remapPublicationCanvasJson\(page\.canvas_json, markerIdMap\)/)",
    'contract marker remap',
)
s = replace_once(
    s,
    "  assert.match(source, /reused_physical_media: true/)",
    "  assert.match(source, /reused_physical_media: true/)\n  assert.match(source, /legacy_product_details_reused: true/)",
    'contract shared legacy products',
)
p.write_text(s)

print('Publication duplicate refinement applied successfully')

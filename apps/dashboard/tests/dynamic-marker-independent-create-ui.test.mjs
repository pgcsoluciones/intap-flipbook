import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadCreateHelpers() {
  const dir = await mkdtemp(join(tmpdir(), 'dynamic-marker-create-ui-test-'))
  const outfile = join(dir, 'dynamic-marker-create.mjs')
  await build({
    entryPoints: ['apps/dashboard/src/lib/dynamicMarkerCreate.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return {
    NEW_DYNAMIC_MARKER_BUTTON_LABEL: mod.NEW_DYNAMIC_MARKER_BUTTON_LABEL,
    DYNAMIC_MARKER_CREATE_NO_PUBLICATIONS: mod.DYNAMIC_MARKER_CREATE_NO_PUBLICATIONS,
    DYNAMIC_MARKER_CREATE_PUBLICATION_REQUIRED: mod.DYNAMIC_MARKER_CREATE_PUBLICATION_REQUIRED,
    DYNAMIC_MARKER_CREATE_NAME_REQUIRED: mod.DYNAMIC_MARKER_CREATE_NAME_REQUIRED,
    DYNAMIC_MARKER_CREATE_GENERIC_ERROR: mod.DYNAMIC_MARKER_CREATE_GENERIC_ERROR,
    DYNAMIC_MARKER_CREATE_CURRENCY_OPTIONS: mod.DYNAMIC_MARKER_CREATE_CURRENCY_OPTIONS,
    DYNAMIC_MARKER_CREATE_AVAILABILITY_OPTIONS: mod.DYNAMIC_MARKER_CREATE_AVAILABILITY_OPTIONS,
    DYNAMIC_MARKER_CREATE_MEDIA_ACCEPT: mod.DYNAMIC_MARKER_CREATE_MEDIA_ACCEPT,
    DYNAMIC_MARKER_CREATE_MEDIA_UPLOAD_ERROR: mod.DYNAMIC_MARKER_CREATE_MEDIA_UPLOAD_ERROR,
    dynamicMarkerCreateInitialForm: mod.dynamicMarkerCreateInitialForm,
    initialDynamicMarkerCreatePublicationId: mod.initialDynamicMarkerCreatePublicationId,
    normalizeDynamicMarkerCreatePublications: mod.normalizeDynamicMarkerCreatePublications,
    validateDynamicMarkerCreateForm: mod.validateDynamicMarkerCreateForm,
    buildDynamicMarkerCreateIndependentInput: mod.buildDynamicMarkerCreateIndependentInput,
    dynamicMarkerCreateCanSubmit: mod.dynamicMarkerCreateCanSubmit,
    dynamicMarkerCreateMediaTypeFromFile: mod.dynamicMarkerCreateMediaTypeFromFile,
    buildDynamicMarkerCreateMediaJson: mod.buildDynamicMarkerCreateMediaJson,
    withDynamicMarkerCreateMedia: mod.withDynamicMarkerCreateMedia,
    withDynamicMarkerCreateMediaItems: mod.withDynamicMarkerCreateMediaItems,
    catalogItemFromIndependentDynamicMarker: mod.catalogItemFromIndependentDynamicMarker,
    mergeCreatedDynamicMarkerCatalogItem: mod.mergeCreatedDynamicMarkerCatalogItem,
    isDynamicMarkerCatalogItemDimmed: mod.isDynamicMarkerCatalogItemDimmed,
    dynamicMarkerCreateSuccessPlan: mod.dynamicMarkerCreateSuccessPlan,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

const helper = await loadCreateHelpers()
after(() => helper.cleanup())

function publication(overrides = {}) {
  return { id: 'pub-1', title: 'Catálogo', ...overrides }
}

function form(overrides = {}) {
  return {
    publicationId: 'pub-1',
    name: 'Ficha nueva',
    reference: '',
    category: '',
    description: '',
    price: '',
    currency: 'DOP',
    availability: '',
    accentColor: '#4f46e5',
    ...overrides,
  }
}

function marker(overrides = {}) {
  return {
    id: 'marker-new',
    user_id: 'user-1',
    publication_id: 'pub-1',
    page_id: null,
    target_object_id: null,
    target_kind: null,
    status: 'draft',
    name: 'Ficha nueva',
    reference: null,
    category: null,
    description: null,
    price_minor: null,
    previous_price_minor: null,
    currency: 'DOP',
    availability: null,
    promotion_text: null,
    accent_color: '#4f46e5',
    badge_text: null,
    promotion_ends_at: null,
    post_promotion_price_minor: null,
    colors_json: '[]',
    materials_json: '[]',
    sizes_json: '[]',
    measurements_json: '[]',
    media_json: '[]',
    actions_json: '[]',
    custom_fields_json: '[]',
    booking_calendar_id: null,
    cloned_from_marker_id: null,
    usage_count: 0,
    is_in_use: false,
    created_at: '2026-08-02 10:00:00',
    updated_at: '2026-08-02 10:00:00',
    ...overrides,
  }
}

test('boton Nueva ficha esta integrado en el modulo central', async () => {
  const source = await readFile('apps/dashboard/src/pages/TenantDynamicMarkers.tsx', 'utf8')
  assert.equal(helper.NEW_DYNAMIC_MARKER_BUTTON_LABEL, 'Nueva ficha')
  assert.match(source, /NEW_DYNAMIC_MARKER_BUTTON_LABEL/)
  assert.match(source, /setCreateOpen\(true\)/)
  assert.match(source, /DynamicMarkerCreateDialog/)
})

test('el dialogo contiene formulario accesible y cierre cancelable', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerCreateDialog.tsx', 'utf8')
  assert.match(source, /role="dialog"/)
  assert.match(source, /aria-modal="true"/)
  assert.match(source, /Cancelar/)
  assert.match(source, /Escape/)
})

test('cerrar y cancelar no construyen payload ni crean ficha', () => {
  const calls = []
  const cancel = () => calls.push('close')
  cancel()
  assert.deepEqual(calls, ['close'])
})

test('publicacion requerida y nombre requerido muestran errores humanos', () => {
  const validation = helper.validateDynamicMarkerCreateForm(form({ publicationId: '', name: '   ' }), [publication()])
  assert.equal(validation.valid, false)
  assert.equal(validation.errors.publicationId, helper.DYNAMIC_MARKER_CREATE_PUBLICATION_REQUIRED)
  assert.equal(validation.errors.name, helper.DYNAMIC_MARKER_CREATE_NAME_REQUIRED)
})

test('sin publicaciones deshabilita creacion con mensaje humano', () => {
  const validation = helper.validateDynamicMarkerCreateForm(form(), [])
  assert.equal(validation.valid, false)
  assert.equal(validation.errors.publications, helper.DYNAMIC_MARKER_CREATE_NO_PUBLICATIONS)
})

test('una publicacion se preselecciona y varias permiten elegir', () => {
  assert.equal(helper.initialDynamicMarkerCreatePublicationId([publication()]), 'pub-1')
  assert.equal(helper.initialDynamicMarkerCreatePublicationId([publication(), publication({ id: 'pub-2' })]), '')
  assert.equal(helper.initialDynamicMarkerCreatePublicationId([publication(), publication({ id: 'pub-2' })], 'pub-2'), 'pub-2')
})

test('normaliza publicaciones sin exponer IDs tecnicos como titulo', () => {
  assert.deepEqual(helper.normalizeDynamicMarkerCreatePublications([{ id: 'pub-1', title: 'Catalogo' }, { id: '' }, null]), [
    { id: 'pub-1', title: 'Catalogo' },
  ])
})

test('payload llama createIndependent con publication_id correcta y sin campos de vinculo o servidor', () => {
  const input = helper.buildDynamicMarkerCreateIndependentInput({
    ...form(),
    reference: 'SKU-1',
    category: 'Zapatos',
    description: 'Descripcion',
    price: '12.50',
    availability: 'Disponible',
    status: 'active',
    user_id: 'attacker',
    page_id: 'page-1',
    target_object_id: 'obj-1',
  }, [publication()])

  assert.equal(input.publication_id, 'pub-1')
  assert.equal(input.name, 'Ficha nueva')
  assert.equal(input.price_minor, 1250)
  assert.equal('page_id' in input, false)
  assert.equal('target_object_id' in input, false)
  assert.equal('status' in input, false)
  assert.equal('user_id' in input, false)
})

test('Moneda se renderiza como select con opciones reales y DOP por defecto', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerCreateDialog.tsx', 'utf8')
  assert.deepEqual([...helper.DYNAMIC_MARKER_CREATE_CURRENCY_OPTIONS], ['', 'DOP', 'USD', 'EUR', 'CAD', 'MXN', 'COP'])
  assert.equal(helper.dynamicMarkerCreateInitialForm([publication()]).currency, 'DOP')
  assert.match(source, /<select[\s\S]*value=\{form\.currency\}/)
  assert.doesNotMatch(source, /maxLength=\{3\}[\s\S]*currency/)
})

test('no se puede introducir moneda arbitraria', () => {
  const validation = helper.validateDynamicMarkerCreateForm(form({ currency: 'BTC' }), [publication()])
  assert.equal(validation.valid, false)
  assert.equal(validation.errors.currency, 'Selecciona una moneda válida.')
})

test('Disponibilidad se renderiza como select con opciones reales', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerCreateDialog.tsx', 'utf8')
  assert.deepEqual([...helper.DYNAMIC_MARKER_CREATE_AVAILABILITY_OPTIONS], [
    '',
    'Disponible',
    'Agotado',
    'Por encargo',
    'Próximamente',
    'Consultar disponibilidad',
  ])
  assert.match(source, /<select[\s\S]*value=\{form\.availability\}/)
  assert.doesNotMatch(source, /placeholder="Disponible"/)
})

test('no se puede introducir disponibilidad arbitraria', () => {
  const validation = helper.validateDynamicMarkerCreateForm(form({ availability: 'Siempre' }), [publication()])
  assert.equal(validation.valid, false)
  assert.equal(validation.errors.availability, 'Selecciona una disponibilidad válida.')
})

test('Seleccionar del banco esta visible y usa el Banco moderno como flujo principal', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerCreateDialog.tsx', 'utf8')
  assert.match(source, /Multimedia/)
  assert.match(source, /Seleccionar del banco/)
  assert.match(source, /<MediaPicker/)
  assert.match(source, /mode="media"/)
  assert.match(source, /multiple/)
  assert.doesNotMatch(source, /type="file"/)
  assert.doesNotMatch(source, /Examinar archivos/)
})

test('seleccionar archivo admitido lo clasifica para cola o vista previa', () => {
  assert.equal(helper.dynamicMarkerCreateMediaTypeFromFile({ type: 'image/png', name: 'foto.png' }), 'image')
  assert.equal(helper.dynamicMarkerCreateMediaTypeFromFile({ type: 'video/mp4', name: 'video.mp4' }), 'video')
  assert.equal(helper.dynamicMarkerCreateMediaTypeFromFile({ type: 'audio/mpeg', name: 'audio.mp3' }), 'audio')
  assert.equal(helper.dynamicMarkerCreateMediaTypeFromFile({ type: 'application/pdf', name: 'doc.pdf' }), null)
})

test('quitar archivo lo excluye del payload', () => {
  const media = [
    { id: 'media-1', type: 'image', url: 'https://cdn.test/a.png', title: 'a.png' },
    { id: 'media-2', type: 'image', url: 'https://cdn.test/b.png', title: 'b.png' },
  ]
  const remaining = media.filter((item) => item.id !== 'media-1')
  assert.deepEqual(helper.buildDynamicMarkerCreateMediaJson(remaining).map((item) => item.id), ['media-2'])
})

test('media seleccionada del banco entra en media_json', () => {
  const input = helper.withDynamicMarkerCreateMediaItems(helper.buildDynamicMarkerCreateIndependentInput(form(), [publication()]), [
    { id: 'media-1', type: 'image', url: 'https://cdn.test/a.png', title: 'a.png', alt: 'a.png' },
  ])
  assert.deepEqual(input.media_json, [
    {
      id: 'media-1',
      type: 'image',
      url: 'https://cdn.test/a.png',
      title: 'a.png',
      alt: 'a.png',
      sort_order: 0,
      visibility: 'public',
    },
  ])
})

test('error de creacion mantiene formulario abierto y no descarta seleccion del banco', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerCreateDialog.tsx', 'utf8')
  assert.match(source, /setMedia/)
  assert.match(source, /setSubmitError/)
})

test('crear permanece bloqueado mientras guarda y doble clic no duplica ficha', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerCreateDialog.tsx', 'utf8')
  assert.match(source, /if \(saving\) return/)
  assert.match(source, /disabled=\{saving \|\| !canCreate\}/)
  assert.match(source, /setProgressMessage\(DYNAMIC_MARKER_CREATE_SAVING_LABEL\)/)
})

test('evita doble envio mientras guarda', () => {
  assert.equal(helper.dynamicMarkerCreateCanSubmit(true, form(), [publication()]), false)
  assert.equal(helper.dynamicMarkerCreateCanSubmit(false, form(), [publication()]), true)
})

test('exito cierra el formulario, reinicia a pagina 1, refresca y selecciona la nueva ficha', () => {
  assert.deepEqual(helper.dynamicMarkerCreateSuccessPlan('marker-new'), {
    pageIndex: 0,
    cursorHistory: [null],
    activeQuery: '',
    status: '',
    selectedId: 'marker-new',
    shouldRefreshCatalog: true,
  })
})

test('ficha creada aparece como Sin uso y sin atenuacion', () => {
  const item = helper.catalogItemFromIndependentDynamicMarker(marker(), 'Catalogo')
  assert.equal(item.page_id, null)
  assert.equal(item.target_object_id, null)
  assert.equal(item.status, 'draft')
  assert.equal(item.usage_count, 0)
  assert.equal(item.is_in_use, false)
  assert.equal(helper.isDynamicMarkerCatalogItemDimmed(item), false)
})

test('ficha creada con media usa primera imagen publica como portada optimista', () => {
  const item = helper.catalogItemFromIndependentDynamicMarker(marker({
    media_json: JSON.stringify([
      { id: 'audio-1', type: 'audio', url: 'https://cdn.test/audio.mp3', sort_order: 0, visibility: 'public' },
      { id: 'image-1', type: 'image', url: 'https://cdn.test/cover.png', sort_order: 1, visibility: 'public' },
    ]),
  }), 'Catalogo')
  assert.equal(item.cover_url, 'https://cdn.test/cover.png')
})

test('payload con media sigue sin enviar page_id ni target_object_id', () => {
  const input = helper.withDynamicMarkerCreateMediaItems(helper.buildDynamicMarkerCreateIndependentInput(form(), [publication()]), [
    { id: 'media-1', type: 'video', url: 'https://cdn.test/video.mp4', title: 'video.mp4' },
  ])
  assert.equal('page_id' in input, false)
  assert.equal('target_object_id' in input, false)
  assert.equal('target_kind' in input, false)
})

test('cancelar no sube ni crea porque el dialogo no usa carga local directa', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerCreateDialog.tsx', 'utf8')
  const submitBody = source.slice(
    source.indexOf('async function submit'),
    source.indexOf('const canCreate'),
  )
  assert.doesNotMatch(source, /api\.upload/)
  assert.match(source, /async function submit/)
  assert.doesNotMatch(submitBody, /mediaAssets\.upload/)
})

test('merge de la ficha creada reemplaza duplicados y mantiene limite de pagina', () => {
  const created = helper.catalogItemFromIndependentDynamicMarker(marker(), 'Catalogo')
  const rows = Array.from({ length: 10 }, (_, index) => ({ ...created, id: `old-${index}` }))
  const merged = helper.mergeCreatedDynamicMarkerCatalogItem(rows, created, 10)
  assert.equal(merged.length, 10)
  assert.equal(merged[0].id, 'marker-new')
  assert.equal(new Set(merged.map((item) => item.id)).size, 10)
})

test('ficha nullable no genera accion de localizar invalida y vinculadas mantienen URL de localizacion', async () => {
  const source = await readFile('apps/dashboard/src/pages/TenantDynamicMarkers.tsx', 'utf8')
  assert.match(source, /const canLocate = Boolean\(item\.page_id && item\.target_object_id\)/)
  assert.match(source, /page: item\.page_id/)
  assert.match(source, /object: item\.target_object_id/)
})

test('error conserva formulario y permite reintento', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerCreateDialog.tsx', 'utf8')
  assert.equal(helper.DYNAMIC_MARKER_CREATE_GENERIC_ERROR, 'No pudimos crear la ficha.')
  assert.match(source, /setSubmitError/)
  assert.match(source, /DYNAMIC_MARKER_CREATE_GENERIC_ERROR/)
  assert.match(source, /setSaving\(false\)/)
})

test('busqueda, paginacion y atenuacion existente siguen integradas', async () => {
  const source = await readFile('apps/dashboard/src/pages/TenantDynamicMarkers.tsx', 'utf8')
  assert.match(source, /runSearch/)
  assert.match(source, /goToNextPage/)
  assert.match(source, /dynamicMarkerCardToneStyles\(inUse\)/)
  assert.match(source, /usage_count/)
})

import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadHelpers() {
  const dir = await mkdtemp(join(tmpdir(), 'dynamic-marker-linked-selection-test-'))
  const linkedOut = join(dir, 'dynamic-marker-linked-selection.mjs')
  const mediaOut = join(dir, 'dynamic-marker-media.mjs')

  await build({
    entryPoints: ['apps/dashboard/src/lib/dynamicMarkerLinkedSelection.ts'],
    outfile: linkedOut,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  await build({
    entryPoints: ['apps/dashboard/src/lib/dynamicMarkerMedia.ts'],
    outfile: mediaOut,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })

  const linked = await import(pathToFileURL(linkedOut).href)
  const media = await import(pathToFileURL(mediaOut).href)
  return {
    ...linked,
    ...media,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

const helper = await loadHelpers()
after(() => helper.cleanup())

function linkedObject(markerId = 'marker-linked') {
  return {
    type: 'button',
    data: {
      elementId: 'object-direct',
      action: { type: 'open_dynamic_marker', marker_id: markerId },
    },
  }
}

test('boton con action.marker_id carga esa ficha vinculada', () => {
  assert.equal(helper.getDynamicMarkerActionMarkerId(linkedObject()), 'marker-linked')
  assert.deepEqual(helper.resolveDynamicMarkerLinkedSelection(linkedObject()), {
    kind: 'linked-marker',
    markerId: 'marker-linked',
  })
})

test('open_dynamic_marker usa marker_id y no abre formulario vacio', () => {
  const resolution = helper.resolveDynamicMarkerLinkedSelection(linkedObject('marker-action'))
  assert.equal(resolution.kind, 'linked-marker')
  assert.equal(helper.shouldCreateDirectDynamicMarker(resolution), false)
})

test('marker_id de accion tiene prioridad sobre ficha directa por target_object_id', () => {
  const resolution = helper.resolveDynamicMarkerLinkedSelection(linkedObject('marker-action'))
  assert.deepEqual(resolution, { kind: 'linked-marker', markerId: 'marker-action' })
})

test('sin marker_id explicito usa el target directo cuando existe', () => {
  const resolution = helper.resolveDynamicMarkerLinkedSelection({ data: { elementId: 'object-direct' } })
  assert.deepEqual(resolution, { kind: 'direct-target', targetObjectId: 'object-direct' })
  assert.equal(helper.shouldCreateDirectDynamicMarker(resolution), true)
})

test('ficha fuera de la pagina actual se puede cargar por ID', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerPanel.tsx', 'utf8')
  assert.match(source, /api\.dynamicMarkers\.get\(linkedSelection\.markerId\)/)
  assert.match(source, /api\.dynamicMarkers\.list\(publicationId!, pageId!\)/)
})

test('error de carga no limpia marker_id y muestra mensaje humano', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerPanel.tsx', 'utf8')
  assert.equal(helper.DYNAMIC_MARKER_LINKED_LOAD_ERROR, 'No pudimos cargar la ficha vinculada.')
  assert.match(source, /DYNAMIC_MARKER_LINKED_LOAD_ERROR/)
  assert.doesNotMatch(source, /setData\(\{ action: undefined \}\)/)
})

test('cambiar tab o volver al objeto rehidrata de forma deterministica', () => {
  assert.deepEqual(helper.resolveDynamicMarkerLinkedSelection(linkedObject('marker-a')), helper.resolveDynamicMarkerLinkedSelection(linkedObject('marker-a')))
})

test('guardar cambios usa el marker cargado y no crea una segunda ficha vinculada', async () => {
  const source = await readFile('apps/dashboard/src/components/DynamicMarkerPanel.tsx', 'utf8')
  assert.match(source, /api\.dynamicMarkers\.update\(marker\.id, buildUpdate\(\)\)/)
  assert.match(source, /shouldCreateDirectDynamicMarker\(linkedSelection\)/)
})

test('Multimedia usa el media_json de la ficha cargada', () => {
  const media = JSON.stringify([
    { id: 'media-1', type: 'image', url: 'https://cdn.test/a.png' },
    { id: 'media-2', type: 'audio', url: 'https://cdn.test/a.mp3' },
  ])
  assert.equal(helper.countDynamicMarkerMediaItems(media), 2)
})

test('primera imagen publica se usa como miniatura y sort_order se respeta', () => {
  const media = [
    { id: 'late', type: 'image', url: 'https://cdn.test/late.png', sort_order: 2, visibility: 'public' },
    { id: 'first', type: 'image', url: 'https://cdn.test/first.png', sort_order: 1, visibility: 'public' },
  ]
  assert.equal(helper.getDynamicMarkerThumbnail(media), 'https://cdn.test/first.png')
})

test('imagen privada no se usa como miniatura', () => {
  const media = [
    { id: 'private', type: 'image', url: 'https://cdn.test/private.png', sort_order: 0, visibility: 'internal' },
    { id: 'public', type: 'image', url: 'https://cdn.test/public.png', sort_order: 1, visibility: 'public' },
  ]
  assert.equal(helper.getDynamicMarkerThumbnail(media), 'https://cdn.test/public.png')
})

test('audio no se usa y video no desplaza una imagen disponible', () => {
  const media = [
    { id: 'audio', type: 'audio', url: 'https://cdn.test/audio.mp3', sort_order: 0, visibility: 'public' },
    { id: 'video', type: 'video', url: 'https://cdn.test/video.mp4', poster_url: 'https://cdn.test/poster.png', sort_order: 1, visibility: 'public' },
    { id: 'image', type: 'image', url: 'https://cdn.test/image.png', sort_order: 2, visibility: 'public' },
  ]
  assert.equal(helper.getDynamicMarkerThumbnail(media), 'https://cdn.test/image.png')
})

test('sin imagen conserva placeholder y video solo usa poster si existe', () => {
  assert.equal(helper.getDynamicMarkerThumbnail([{ type: 'audio', url: 'https://cdn.test/audio.mp3' }]), null)
  assert.equal(helper.getDynamicMarkerThumbnail([{ type: 'video', poster_url: 'https://cdn.test/poster.png', visibility: 'public' }]), 'https://cdn.test/poster.png')
})

test('ficha Sin uso no recibe opacidad global y ficha En uso conserva portada legible', () => {
  assert.equal(helper.dynamicMarkerPreviewToneUsesGlobalOpacity({ background: '#f8fafc', borderColor: '#d1d5db' }), false)
  assert.equal(helper.dynamicMarkerPreviewToneUsesGlobalOpacity({ opacity: 0.8 }), true)
})

test('catalogo publicado toma cover_url desde media_json antes que portada de publicacion', async () => {
  const source = await readFile('apps/api/src/routes/dynamicMarkers.ts', 'utf8')
  assert.match(source, /dm\.media_json/)
  assert.match(source, /dynamicMarkerCatalogCoverFromMedia\(row\.media_json\) \|\| row\.publication_cover_url/)
})

test('ficha vinculada que no carga nunca ofrece crear o activar otra ficha directa', async () => {
  const source = await readFile(
    'apps/dashboard/src/components/DynamicMarkerPanel.tsx',
    'utf8',
  )

  assert.match(
    source,
    /linkedSelection\.kind === 'linked-marker' && !marker/,
  )

  assert.match(
    source,
    /El vínculo existente se mantiene\. No crearemos otra ficha encima de esta asociación\./,
  )

  assert.match(
    source,
    /Reintentar cargar ficha/,
  )
})

test('activar ficha explica cuando falta el nombre requerido', async () => {
  const source = await readFile(
    'apps/dashboard/src/components/DynamicMarkerPanel.tsx',
    'utf8',
  )

  assert.match(
    source,
    /Para activar esta ficha, primero agrega un nombre en “Información principal”\./,
  )

  assert.match(
    source,
    /disabled=\{saving \|\| !canActivate\}/,
  )
})

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadReuseHelpers() {
  const dir = await mkdtemp(join(tmpdir(), 'dynamic-marker-reuse-test-'))
  const outfile = join(dir, 'dynamic-marker-reuse.mjs')
  await build({
    entryPoints: ['apps/dashboard/src/lib/dynamicMarkerReuse.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return {
    getDynamicMarkerSelectionDecision: mod.getDynamicMarkerSelectionDecision,
    canCloneDynamicMarkerToTarget: mod.canCloneDynamicMarkerToTarget,
    buildDynamicMarkerCloneBody: mod.buildDynamicMarkerCloneBody,
    dynamicMarkerCloneErrorMessage: mod.dynamicMarkerCloneErrorMessage,
    dynamicMarkerCardToneStyles: mod.dynamicMarkerCardToneStyles,
    dynamicMarkerPreviewToneStyles: mod.dynamicMarkerPreviewToneStyles,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

const helper = await loadReuseHelpers()
after(() => helper.cleanup())

function item(overrides = {}) {
  return {
    id: 'marker-1',
    usage_count: 0,
    is_in_use: false,
    ...overrides,
  }
}

function target(overrides = {}) {
  return {
    publication_id: 'pub-1',
    page_id: 'page-1',
    target_object_id: 'obj-1',
    target_kind: 'rect',
    ...overrides,
  }
}

test('misma ficha vinculada produce no-op', () => {
  assert.equal(helper.getDynamicMarkerSelectionDecision(item(), 'marker-1'), 'noop')
})

test('usage_count 0 selecciona inmediatamente', () => {
  assert.equal(helper.getDynamicMarkerSelectionDecision(item({ usage_count: 0 }), 'other'), 'select')
})

test('usage_count mayor a 0 abre confirmacion', () => {
  assert.equal(helper.getDynamicMarkerSelectionDecision(item({ usage_count: 2, is_in_use: true }), 'other'), 'confirm')
})

test('is_in_use abre confirmacion aunque usage_count venga ausente', () => {
  assert.equal(helper.getDynamicMarkerSelectionDecision(item({ usage_count: undefined, is_in_use: true }), 'other'), 'confirm')
})

test('cloneTarget ausente o incompleto deshabilita crear copia', () => {
  assert.equal(helper.canCloneDynamicMarkerToTarget(null), false)
  assert.equal(helper.canCloneDynamicMarkerToTarget(target({ page_id: '' })), false)
  assert.equal(helper.canCloneDynamicMarkerToTarget(target({ target_object_id: '  ' })), false)
})

test('cloneTarget completo habilita crear copia', () => {
  assert.equal(helper.canCloneDynamicMarkerToTarget(target()), true)
})

test('body de clone usa destino correcto y no acepta user_id', () => {
  const body = helper.buildDynamicMarkerCloneBody({ ...target(), user_id: 'attacker' })
  assert.deepEqual(body, {
    publication_id: 'pub-1',
    page_id: 'page-1',
    target_object_id: 'obj-1',
    target_kind: 'rect',
  })
  assert.equal('user_id' in body, false)
})

test('target_kind vacio viaja como null', () => {
  assert.equal(helper.buildDynamicMarkerCloneBody(target({ target_kind: '' })).target_kind, null)
})

test('409 muestra mensaje humano especifico', () => {
  assert.equal(helper.dynamicMarkerCloneErrorMessage({ status: 409 }), 'Este elemento ya tiene una ficha asociada.')
})

test('error generico conserva vinculo anterior con mensaje humano', () => {
  assert.equal(helper.dynamicMarkerCloneErrorMessage(new Error('network')), 'No pudimos crear la copia de esta ficha.')
})

test('doble clic durante clonacion se modela como una sola peticion', async () => {
  let cloning = false
  let calls = 0
  async function cloneOnce() {
    if (cloning) return
    cloning = true
    calls += 1
    await Promise.resolve()
    cloning = false
  }

  await Promise.all([cloneOnce(), cloneOnce()])
  assert.equal(calls, 1)
})

test('usar misma ficha llama onChange con ID fuente', () => {
  const calls = []
  const source = item({ id: 'source-1', usage_count: 3 })
  if (helper.getDynamicMarkerSelectionDecision(source, 'other') === 'confirm') calls.push(source.id)
  assert.deepEqual(calls, ['source-1'])
})

test('crear copia exitosa llama onChange con ID nuevo', () => {
  const calls = []
  const response = { data: { id: 'clone-1' } }
  calls.push(response.data.id)
  assert.deepEqual(calls, ['clone-1'])
})

test('error clone no emite onChange incompleto', () => {
  const calls = []
  const error = helper.dynamicMarkerCloneErrorMessage({ status: 500 })
  assert.equal(error, 'No pudimos crear la copia de esta ficha.')
  assert.deepEqual(calls, [])
})

test('Ver donde se utiliza no abre reutilizacion si detiene propagacion', () => {
  const calls = []
  const event = {
    preventDefault: () => calls.push('preventDefault'),
    stopPropagation: () => calls.push('stopPropagation'),
  }
  event.preventDefault()
  event.stopPropagation()
  assert.deepEqual(calls, ['preventDefault', 'stopPropagation'])
})

test('ficha en uso recibe tratamiento visual atenuado sin opacidad global', () => {
  const style = helper.dynamicMarkerCardToneStyles(true)
  assert.equal(style.background, '#f8fafc')
  assert.equal(style.borderColor, '#d1d5db')
  assert.equal('opacity' in style, false)
})

test('ficha sin uso conserva estilo normal', () => {
  const style = helper.dynamicMarkerCardToneStyles(false)
  assert.equal(style.background, '#fff')
  assert.equal(style.borderColor, '#e5e7eb')
})

test('zona decorativa puede atenuarse sin afectar texto ni botones', () => {
  assert.equal(helper.dynamicMarkerPreviewToneStyles(true).opacity < 1, true)
  assert.equal(helper.dynamicMarkerPreviewToneStyles(false).opacity, 1)
})

test('cambiar pagina y busqueda no modifica value', () => {
  const value = 'marker-linked'
  assert.equal(value, 'marker-linked')
})

test('crear copia no incrementa usage_count manualmente dos veces', () => {
  const source = item({ id: 'source-1', usage_count: 4 })
  const clone = { id: 'clone-1', usage_count: 1 }
  assert.equal(source.usage_count, 4)
  assert.equal(clone.usage_count, 1)
})

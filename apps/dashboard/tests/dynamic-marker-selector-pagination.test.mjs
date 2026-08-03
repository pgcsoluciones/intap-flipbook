import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadSelectorHelpers() {
  const dir = await mkdtemp(join(tmpdir(), 'dynamic-marker-selector-pagination-test-'))
  const outfile = join(dir, 'dynamic-marker-selector.mjs')
  const stub = {
    name: 'dynamic-marker-selector-test-stubs',
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }))
      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'react-jsx-runtime', namespace: 'stub' }))
      build.onResolve({ filter: /\/DynamicMarkerUsageDialog$/ }, () => ({ path: 'usage-dialog', namespace: 'stub' }))
      build.onResolve({ filter: /\/DynamicMarkerCreateDialog$/ }, () => ({ path: 'create-dialog', namespace: 'stub' }))
      build.onResolve({ filter: /\/lib\/dynamicMarkerUsageDisplay$/ }, () => ({ path: 'usage-display', namespace: 'stub' }))
      build.onResolve({ filter: /\/lib\/api$/ }, () => ({ path: 'api', namespace: 'stub' }))

      build.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => {
        if (path === 'react') {
          return {
            contents: `
              export function useEffect() {}
              export function useRef(value) { return { current: value } }
              export function useState(value) { return [typeof value === 'function' ? value() : value, () => {}] }
            `,
            loader: 'js',
          }
        }
        if (path === 'react-jsx-runtime') {
          return {
            contents: `
              export function jsx(type, props) { return { type, props } }
              export function jsxs(type, props) { return { type, props } }
              export const Fragment = Symbol.for('react.fragment')
            `,
            loader: 'js',
          }
        }
        if (path === 'usage-dialog') {
          return { contents: 'export default function DynamicMarkerUsageDialog() { return null }', loader: 'js' }
        }
        if (path === 'create-dialog') {
          return { contents: 'export default function DynamicMarkerCreateDialog() { return null }', loader: 'js' }
        }
        if (path === 'usage-display') {
          return {
            contents: `
              export function canOpenDynamicMarkerUsage(count) { return count > 0 }
              export function dynamicMarkerUsageBadgeLabel(count) { return count > 0 ? 'En uso' : 'Sin uso' }
            `,
            loader: 'js',
          }
        }
        return {
          contents: `
            export const api = {
              dynamicMarkers: {
                catalog: async () => ({ data: [], page: { has_more: false, next_cursor: null } }),
              },
            }
          `,
          loader: 'js',
        }
      })
    },
  }

  await build({
    entryPoints: ['apps/dashboard/src/components/DynamicMarkerSelector.tsx'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    plugins: [stub],
  })
  const mod = await import(pathToFileURL(outfile).href)
  return {
    DYNAMIC_MARKER_SELECTOR_PAGE_SIZE: mod.DYNAMIC_MARKER_SELECTOR_PAGE_SIZE,
    getDynamicMarkerSelectorCursor: mod.getDynamicMarkerSelectorCursor,
    rememberDynamicMarkerSelectorCursor: mod.rememberDynamicMarkerSelectorCursor,
    resetDynamicMarkerSelectorCursorHistory: mod.resetDynamicMarkerSelectorCursorHistory,
    replaceDynamicMarkerSelectorResults: mod.replaceDynamicMarkerSelectorResults,
    isDynamicMarkerSelectorPreviousDisabled: mod.isDynamicMarkerSelectorPreviousDisabled,
    isDynamicMarkerSelectorNextDisabled: mod.isDynamicMarkerSelectorNextDisabled,
    shouldOpenDynamicMarkerUsage: mod.shouldOpenDynamicMarkerUsage,
    keepDynamicMarkerSelectorValueOnPageChange: mod.keepDynamicMarkerSelectorValueOnPageChange,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

const helper = await loadSelectorHelpers()
after(() => helper.cleanup())

test('PAGE_SIZE del selector es 5', () => {
  assert.equal(helper.DYNAMIC_MARKER_SELECTOR_PAGE_SIZE, 5)
})

test('Pagina 1 usa cursor null', () => {
  assert.equal(helper.getDynamicMarkerSelectorCursor([null], 0), null)
})

test('Anterior esta deshabilitado en Pagina 1', () => {
  assert.equal(helper.isDynamicMarkerSelectorPreviousDisabled(0), true)
})

test('has_more con next_cursor habilita Siguiente', () => {
  assert.equal(helper.isDynamicMarkerSelectorNextDisabled({ has_more: true, next_cursor: 'cursor-2' }), false)
})

test('Siguiente reemplaza resultados y no los acumula', () => {
  const current = [{ id: 'old-a' }, { id: 'old-b' }]
  const incoming = [{ id: 'new-a' }]
  assert.deepEqual(helper.replaceDynamicMarkerSelectorResults(current, incoming), incoming)
})

test('Anterior recupera el cursor previo', () => {
  const history = [null, 'cursor-2', 'cursor-3']
  assert.equal(helper.getDynamicMarkerSelectorCursor(history, 1), 'cursor-2')
})

test('una nueva busqueda reinicia a Pagina 1', () => {
  assert.deepEqual(helper.resetDynamicMarkerSelectorCursorHistory(), [null])
  assert.equal(helper.getDynamicMarkerSelectorCursor(helper.resetDynamicMarkerSelectorCursorHistory(), 0), null)
})

test('un cambio de publication_id reinicia a Pagina 1', () => {
  assert.deepEqual(helper.resetDynamicMarkerSelectorCursorHistory(), [null])
})

test('pulsar Ver donde se utiliza no selecciona la ficha', () => {
  const calls = []
  const event = {
    preventDefault: () => calls.push('preventDefault'),
    stopPropagation: () => calls.push('stopPropagation'),
  }
  assert.equal(helper.shouldOpenDynamicMarkerUsage(event), true)
  assert.deepEqual(calls, ['preventDefault', 'stopPropagation'])
})

test('cambiar pagina no modifica la ficha vinculada actual', () => {
  assert.equal(helper.keepDynamicMarkerSelectorValueOnPageChange('marker-1'), 'marker-1')
  assert.equal(helper.keepDynamicMarkerSelectorValueOnPageChange(null), null)
})

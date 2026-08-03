import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function loadPaginationHelpers() {
  const dir = await mkdtemp(join(tmpdir(), 'dynamic-marker-pagination-test-'))
  const outfile = join(dir, 'tenant-dynamic-markers.mjs')
  const stub = {
    name: 'tenant-dynamic-markers-test-stubs',
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }))
      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'react-jsx-runtime', namespace: 'stub' }))
      build.onResolve({ filter: /^react-router-dom$/ }, () => ({ path: 'react-router-dom', namespace: 'stub' }))
      build.onResolve({ filter: /\/components\/DynamicMarkerCommercialEditor$/ }, () => ({ path: 'commercial-editor', namespace: 'stub' }))
      build.onResolve({ filter: /\/components\/DynamicMarkerMediaEditor$/ }, () => ({ path: 'media-editor', namespace: 'stub' }))
      build.onResolve({ filter: /\/components\/DynamicMarkerCreateDialog$/ }, () => ({ path: 'create-dialog', namespace: 'stub' }))
      build.onResolve({ filter: /\/components\/DynamicMarkerUsageDialog$/ }, () => ({ path: 'usage-dialog', namespace: 'stub' }))
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
        if (path === 'react-router-dom') {
          return { contents: 'export function Link(props) { return props }', loader: 'js' }
        }
        if (path === 'commercial-editor') {
          return { contents: 'export default function DynamicMarkerCommercialEditor() { return null }', loader: 'js' }
        }
        if (path === 'media-editor') {
          return { contents: 'export default function DynamicMarkerMediaEditor() { return null }', loader: 'js' }
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
                catalog: async () => ({ data: [], page: { limit: 10, has_more: false, next_cursor: null } }),
                get: async () => ({ data: null }),
                setStatus: async () => ({ data: null }),
                updateCommercial: async () => ({ data: null }),
                reuseCommercialInfo: async () => ({ data: null }),
              },
            }
          `,
          loader: 'js',
        }
      })
    },
  }

  await build({
    entryPoints: ['apps/dashboard/src/pages/TenantDynamicMarkers.tsx'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    plugins: [stub],
  })
  const mod = await import(pathToFileURL(outfile).href)
  return {
    DYNAMIC_MARKER_CATALOG_PAGE_SIZE: mod.DYNAMIC_MARKER_CATALOG_PAGE_SIZE,
    getDynamicMarkerCatalogCursor: mod.getDynamicMarkerCatalogCursor,
    rememberDynamicMarkerCatalogCursor: mod.rememberDynamicMarkerCatalogCursor,
    resetDynamicMarkerCatalogCursorHistory: mod.resetDynamicMarkerCatalogCursorHistory,
    replaceDynamicMarkerCatalogResults: mod.replaceDynamicMarkerCatalogResults,
    isDynamicMarkerCatalogPreviousDisabled: mod.isDynamicMarkerCatalogPreviousDisabled,
    isDynamicMarkerCatalogNextDisabled: mod.isDynamicMarkerCatalogNextDisabled,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

const helper = await loadPaginationHelpers()
after(() => helper.cleanup())

test('primera pagina obtiene cursor null', () => {
  assert.equal(helper.getDynamicMarkerCatalogCursor([null], 0), null)
})

test('Siguiente recuerda el next_cursor para la pagina siguiente', () => {
  const history = helper.rememberDynamicMarkerCatalogCursor([null], 1, 'cursor-page-2')
  assert.deepEqual(history, [null, 'cursor-page-2'])
  assert.equal(helper.getDynamicMarkerCatalogCursor(history, 1), 'cursor-page-2')
})

test('Anterior recupera el cursor anterior', () => {
  const history = [null, 'cursor-page-2', 'cursor-page-3']
  assert.equal(helper.getDynamicMarkerCatalogCursor(history, 1), 'cursor-page-2')
  assert.equal(helper.getDynamicMarkerCatalogCursor(history, 0), null)
})

test('cambiar busqueda reinicia el historial a null', () => {
  assert.deepEqual(helper.resetDynamicMarkerCatalogCursorHistory(), [null])
})

test('cambiar filtro reinicia el historial a null', () => {
  assert.deepEqual(helper.resetDynamicMarkerCatalogCursorHistory(), [null])
})

test('una pagina nueva reemplaza resultados y no los acumula', () => {
  const current = [{ id: 'old-a' }, { id: 'old-b' }]
  const incoming = [{ id: 'new-a' }]
  assert.deepEqual(helper.replaceDynamicMarkerCatalogResults(current, incoming), incoming)
})

test('has_more false deshabilita Siguiente', () => {
  assert.equal(helper.isDynamicMarkerCatalogNextDisabled({ has_more: false, next_cursor: null, limit: 10 }), true)
})

test('pageIndex 0 deshabilita Anterior', () => {
  assert.equal(helper.isDynamicMarkerCatalogPreviousDisabled(0), true)
})

test('cursores posteriores se eliminan al iniciar nueva navegacion desde una pagina previa', () => {
  const history = helper.rememberDynamicMarkerCatalogCursor([null, 'cursor-page-2', 'cursor-page-3'], 1, 'cursor-page-2b')
  assert.deepEqual(history, [null, 'cursor-page-2b'])
})

test('el limite utilizado es 10', () => {
  assert.equal(helper.DYNAMIC_MARKER_CATALOG_PAGE_SIZE, 10)
})

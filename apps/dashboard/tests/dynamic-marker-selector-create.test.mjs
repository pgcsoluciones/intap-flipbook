import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const selectorPath = new URL(
  '../src/components/DynamicMarkerSelector.tsx',
  import.meta.url,
)

async function selectorSource() {
  return readFile(selectorPath, 'utf8')
}

test('selector integra Nueva ficha reutilizando el diálogo central', async () => {
  const source = await selectorSource()

  assert.match(source, /import DynamicMarkerCreateDialog/)
  assert.match(source, />\s*\+ Nueva ficha\s*</)
  assert.match(source, /<DynamicMarkerCreateDialog/)
  assert.match(source, /preferredPublicationId=\{publicationId\}/)
})

test('creación desde selector vincula solamente después de respuesta exitosa', async () => {
  const source = await selectorSource()

  const createCall = source.indexOf('api.dynamicMarkers.createIndependent(input)')
  const onChangeCall = source.indexOf('onChange(marker.id)', createCall)

  assert.ok(createCall >= 0)
  assert.ok(onChangeCall > createCall)
})

test('cancelar creación no altera el vínculo actual', async () => {
  const source = await selectorSource()

  assert.match(source, /onClose=\{\(\) => setCreateOpen\(false\)\}/)
  assert.doesNotMatch(
    source,
    /onClose=\{\(\) => \{\s*onChange\(null\)/,
  )
})

test('ficha creada refresca el selector desde la primera página', async () => {
  const source = await selectorSource()

  assert.match(source, /setCursorHistory\(resetDynamicMarkerSelectorCursorHistory\(\)\)/)
  assert.match(source, /term: ''/)
  assert.match(source, /cursor: null/)
  assert.match(source, /nextPageIndex: 0/)
})

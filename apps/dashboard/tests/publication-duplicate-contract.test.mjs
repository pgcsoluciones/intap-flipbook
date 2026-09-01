import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const publications = fs.readFileSync(new URL('../src/pages/Publications.tsx', import.meta.url), 'utf8')
const settings = fs.readFileSync(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8')
const api = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8')

test('panel exposes duplicate flow and opens the copy in editor', () => {
  assert.match(publications, /Duplicar flipbook/)
  assert.match(publications, /Duplicar y editar/)
  assert.match(publications, /api\.publications\.duplicate/)
  assert.match(publications, /navigate\(`\/publications\/\$\{copy\.id\}\/editor`\)/)
})

test('duplicate dialog explains isolation from history', () => {
  assert.match(publications, /El original, sus vistas, solicitudes, respuestas y reservas no se modifican ni se copian/)
})

test('slug is editable in duplicate dialog and settings', () => {
  assert.match(publications, /Slug público/)
  assert.match(settings, /Enlace público \(slug\)/)
  assert.match(settings, /public_slug: publicationSlugDraft\(publicSlug\)/)
  assert.match(api, /\/duplicate`/)
})

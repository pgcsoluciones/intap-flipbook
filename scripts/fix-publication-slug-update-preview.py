from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'No se encontró anchor: {label}')
    return text.replace(old, new, 1)


p = Path('apps/api/src/routes/publications.ts')
s = p.read_text()

s = replace_once(
    s,
    "         public_slug = CASE WHEN ? THEN ? ELSE public_slug END,\n",
    "         public_slug = COALESCE(?, public_slug),\n",
    'public slug SQL assignment',
)

s = replace_once(
    s,
    "      body.category ?? null,\n      publicSlugPresent ? 1 : 0,\n      publicSlugValue,\n      soundValue,",
    "      body.category ?? null,\n      publicSlugValue,\n      soundValue,",
    'public slug SQL bindings',
)

old_run = """  await c.env.DB.prepare(
    `UPDATE publications
"""
new_run = """  try {
    await c.env.DB.prepare(
    `UPDATE publications
"""
s = replace_once(s, old_run, new_run, 'wrap publication update')

old_tail = """    )
    .run()

  const updated = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ?')
"""
new_tail = """    )
    .run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[publications.update] failed', {
      publication_id: c.req.param('id'),
      user_id: userId,
      public_slug_present: publicSlugPresent,
      error: message,
    })
    return c.json({
      success: false,
      error: (c.env.APP_ENV ?? 'production') === 'preview'
        ? `No se pudo actualizar la publicación en Preview: ${message}`
        : 'No se pudo actualizar la publicación',
    }, 500)
  }

  const updated = await c.env.DB.prepare('SELECT * FROM publications WHERE id = ?')
"""
s = replace_once(s, old_tail, new_tail, 'publication update error handling')

p.write_text(s)

p = Path('apps/api/tests/publication-duplicate-contract.test.mjs')
s = p.read_text()
needle = """test('duplicate does not copy analytics or transactional history', () => {
"""
insert = """test('publication slug update uses a nullable direct binding compatible with D1', () => {
  assert.match(source, /public_slug = COALESCE\\(\\?, public_slug\\)/)
  assert.doesNotMatch(source, /public_slug = CASE WHEN \\? THEN \\? ELSE public_slug END/)
  assert.match(source, /No se pudo actualizar la publicación en Preview/)
})

"""
if insert not in s:
    s = replace_once(s, needle, insert + needle, 'slug compatibility contract')
p.write_text(s)

print('Publication slug update compatibility fix applied')

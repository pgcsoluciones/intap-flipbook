export function duplicatePublicationTitle(title: unknown): string {
  const base = typeof title === 'string' ? title.trim() : ''
  return base ? `${base} (copia)` : 'Copia de flipbook'
}

export function publicationSlugDraft(value: unknown): string {
  return String(value ?? '')
    .replace(/ñ/gi, 'n')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function duplicatePublicationSlug(title: unknown): string {
  return publicationSlugDraft(duplicatePublicationTitle(title)) || 'flipbook-copia'
}

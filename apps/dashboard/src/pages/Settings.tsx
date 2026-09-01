import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api, toCanvasSafeAssetUrl } from '../lib/api'
import { publicationSlugDraft } from '../lib/publicationDuplicate'
import UnitsPanel from './UnitsPanel'

const CATEGORIES = [
  { value: 'catalogo',   label: 'Catálogo de productos' },
  { value: 'menu',       label: 'Menú de restaurante' },
  { value: 'portafolio', label: 'Portafolio' },
  { value: 'revista',    label: 'Revista / Magazine' },
  { value: 'folleto',    label: 'Folleto / Brochure' },
  { value: 'otro',       label: 'Otro' },
]

const SOCIAL_IMAGE_WIDTH = 1200
const SOCIAL_IMAGE_HEIGHT = 630
const SOCIAL_IMAGE_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_SOCIAL_DESCRIPTION = 'Mirá este catálogo interactivo en Intap Flipbook'
const DEFAULT_SOCIAL_CROP = { zoom: 1, offsetX: 0, offsetY: 0 }

type SocialCrop = {
  zoom: number
  offsetX: number
  offsetY: number
}

function normalizeSocialText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeCrop(crop: SocialCrop): SocialCrop {
  return {
    zoom: Math.min(5, Math.max(1, Number.isFinite(crop.zoom) ? crop.zoom : 1)),
    offsetX: Number.isFinite(crop.offsetX) ? crop.offsetX : 0,
    offsetY: Number.isFinite(crop.offsetY) ? crop.offsetY : 0,
  }
}

function parseSocialCrop(value: unknown): SocialCrop {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_SOCIAL_CROP
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULT_SOCIAL_CROP
    return normalizeCrop({
      zoom: Number((parsed as any).zoom),
      offsetX: Number((parsed as any).offsetX),
      offsetY: Number((parsed as any).offsetY),
    })
  } catch {
    return DEFAULT_SOCIAL_CROP
  }
}

function getImageDrawState(image: HTMLImageElement, crop: SocialCrop) {
  const baseScale = Math.max(
    SOCIAL_IMAGE_WIDTH / image.naturalWidth,
    SOCIAL_IMAGE_HEIGHT / image.naturalHeight,
  )
  const scale = baseScale * crop.zoom
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  const maxX = Math.max(0, (width - SOCIAL_IMAGE_WIDTH) / 2)
  const maxY = Math.max(0, (height - SOCIAL_IMAGE_HEIGHT) / 2)
  const offsetX = Math.min(maxX, Math.max(-maxX, crop.offsetX))
  const offsetY = Math.min(maxY, Math.max(-maxY, crop.offsetY))

  return {
    width,
    height,
    offsetX,
    offsetY,
    x: (SOCIAL_IMAGE_WIDTH - width) / 2 + offsetX,
    y: (SOCIAL_IMAGE_HEIGHT - height) / 2 + offsetY,
  }
}

function loadCropImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    if (!src.startsWith('blob:') && !src.startsWith('data:')) image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('No se pudo cargar la imagen para compartir.'))
    image.src = src
  })
}

async function renderSocialImageBlob(src: string, crop: SocialCrop) {
  const image = await loadCropImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = SOCIAL_IMAGE_WIDTH
  canvas.height = SOCIAL_IMAGE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo preparar el recorte de imagen.')
  const draw = getImageDrawState(image, normalizeCrop(crop))
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, SOCIAL_IMAGE_WIDTH, SOCIAL_IMAGE_HEIGHT)
  ctx.drawImage(image, draw.x, draw.y, draw.width, draw.height)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('No se pudo generar la imagen final para compartir.'))
    }, 'image/jpeg', 0.86)
  })
}

function SocialCropEditor({
  imageSrc,
  crop,
  onCropChange,
  onPreview,
  onError,
}: {
  imageSrc: string
  crop: SocialCrop
  onCropChange: (crop: SocialCrop, meta: { userInteraction: boolean }) => void
  onPreview: (url: string) => void
  onError: (message: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; crop: SocialCrop } | null>(null)

  useEffect(() => {
    let cancelled = false
    imageRef.current = null
    onError(null)
    loadCropImage(toCanvasSafeAssetUrl(imageSrc))
      .then((image) => {
        if (cancelled) return
        imageRef.current = image
        draw()
      })
      .catch((err) => {
        if (cancelled) return
        onError(err?.message ?? 'No se pudo cargar la imagen para compartir.')
      })
    return () => {
      cancelled = true
    }
  }, [imageSrc])

  useEffect(() => {
    draw()
  }, [crop])

  function draw() {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const safeCrop = normalizeCrop(crop)
    const drawState = getImageDrawState(image, safeCrop)
    if (drawState.offsetX !== safeCrop.offsetX || drawState.offsetY !== safeCrop.offsetY) {
      onCropChange({ ...safeCrop, offsetX: drawState.offsetX, offsetY: drawState.offsetY }, { userInteraction: false })
      return
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, SOCIAL_IMAGE_WIDTH, SOCIAL_IMAGE_HEIGHT)
    ctx.drawImage(image, drawState.x, drawState.y, drawState.width, drawState.height)
    try {
      onPreview(canvas.toDataURL('image/jpeg', 0.82))
    } catch {
      onPreview('')
    }
  }

  function updateOffset(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    const start = dragRef.current
    const image = imageRef.current
    if (!canvas || !start || !image) return
    const rect = canvas.getBoundingClientRect()
    const dx = (clientX - start.x) * (SOCIAL_IMAGE_WIDTH / rect.width)
    const dy = (clientY - start.y) * (SOCIAL_IMAGE_HEIGHT / rect.height)
    const next = normalizeCrop({
      ...start.crop,
      offsetX: start.crop.offsetX + dx,
      offsetY: start.crop.offsetY + dy,
    })
    const clamped = getImageDrawState(image, next)
    onCropChange({ ...next, offsetX: clamped.offsetX, offsetY: clamped.offsetY }, { userInteraction: true })
  }

  return (
    <div style={styles.cropShell}>
      <canvas
        ref={canvasRef}
        width={SOCIAL_IMAGE_WIDTH}
        height={SOCIAL_IMAGE_HEIGHT}
        style={styles.cropCanvas}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          dragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, crop }
        }}
        onPointerMove={(e) => {
          if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return
          e.preventDefault()
          updateOffset(e.clientX, e.clientY)
        }}
        onPointerUp={(e) => {
          if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null
        }}
        onPointerCancel={(e) => {
          if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null
        }}
      />
      <label style={styles.label}>
        Zoom
        <input
          type="range"
          min={1}
          max={5}
          step={0.01}
          value={crop.zoom}
          onChange={(e) => onCropChange(normalizeCrop({ ...crop, zoom: Number(e.target.value) }), { userInteraction: true })}
        />
      </label>
    </div>
  )
}

export default function Settings() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [pub, setPub]               = useState<any>(null)
  const [title, setTitle]           = useState('')
  const [publicSlug, setPublicSlug] = useState('')
  const [description, setDesc]      = useState('')
  const [category, setCategory]     = useState('')
  const [soundEnabled, setSound]    = useState(false)
  const [saving, setSaving]         = useState(false)
  const [deleting, setDeleting]     = useState(false)
  const [msg, setMsg]               = useState<{ text: string; ok: boolean } | null>(null)
  const [confirmDelete, setConfirm] = useState(false)
  const [usage, setUsage]           = useState<any>(null)

  // Campos CMS del proyecto inmobiliario
  const [projectDeveloper, setProjectDeveloper] = useState('')
  const [projectPhone, setProjectPhone]         = useState('')
  const [projectWhatsapp, setProjectWhatsapp]   = useState('')
  const [projectLocation, setProjectLocation]   = useState('')
  const [projectAddress, setProjectAddress]     = useState('')
  const [projectWebsite, setProjectWebsite]     = useState('')
  const [savingProject, setSavingProject]       = useState(false)
  const [socialTitle, setSocialTitle]           = useState('')
  const [socialDescription, setSocialDescription] = useState('')
  const [socialImageUrl, setSocialImageUrl]     = useState('')
  const [socialSourceUrl, setSocialSourceUrl]   = useState('')
  const [socialSourceFile, setSocialSourceFile] = useState<File | null>(null)
  const [socialSourceObjectUrl, setSocialSourceObjectUrl] = useState('')
  const [socialCrop, setSocialCrop]             = useState<SocialCrop>(DEFAULT_SOCIAL_CROP)
  const [socialCropDirty, setSocialCropDirty]   = useState(false)
  const [socialPreviewUrl, setSocialPreviewUrl] = useState('')
  const [socialPlatform, setSocialPlatform]     = useState<'WhatsApp' | 'Facebook' | 'X'>('WhatsApp')
  const [socialError, setSocialError]           = useState('')

  useEffect(() => {
    if (!id) return
    api.publications.get(id).then((r) => {
      const p = r.data
      setPub(p)
      setTitle(p.title ?? '')
      setPublicSlug(p.public_slug ?? '')
      setDesc(p.description ?? '')
      setCategory(p.category ?? '')
      setSound(!!p.sound_enabled)
      setProjectDeveloper(p.project_developer ?? '')
      setProjectPhone(p.project_phone ?? '')
      setProjectWhatsapp(p.project_whatsapp ?? '')
      setProjectLocation(p.project_location ?? '')
      setProjectAddress(p.project_address ?? '')
      setProjectWebsite(p.project_website ?? '')
      setSocialTitle(p.social_title ?? '')
      setSocialDescription(p.social_description ?? '')
      setSocialImageUrl(p.social_image_url ?? '')
      setSocialSourceUrl(p.social_image_source_url ?? '')
      setSocialCrop(parseSocialCrop(p.social_image_crop_json))
      setSocialCropDirty(false)
      setSocialPreviewUrl('')
      setSocialError('')
    })
    api.plan.usage().then((r) => setUsage(r.data))
  }, [id])

  useEffect(() => {
    const objectUrl = socialSourceObjectUrl
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [socialSourceObjectUrl])

  async function saveSettings() {
    if (!id) return
    if (saving) return
    setSaving(true)
    setSocialError('')
    try {
      const body: Record<string, unknown> = {
        title,
        public_slug: publicationSlugDraft(publicSlug),
        description,
        category,
        sound_enabled: soundEnabled,
      }

      const nextSocialTitle = normalizeSocialText(socialTitle)
      const nextSocialDescription = normalizeSocialText(socialDescription)
      if (nextSocialTitle !== (pub.social_title ?? null)) body.social_title = nextSocialTitle
      if (nextSocialDescription !== (pub.social_description ?? null)) body.social_description = nextSocialDescription

      let savedSourceUrl = socialSourceUrl
      let savedImageUrl = socialImageUrl
      const cropJson = JSON.stringify(normalizeCrop(socialCrop))
      const currentCropJson = pub.social_image_crop_json ? JSON.stringify(parseSocialCrop(pub.social_image_crop_json)) : JSON.stringify(DEFAULT_SOCIAL_CROP)
      const shouldRenderCrop = !!socialSourceFile || (!!socialSourceUrl && socialCropDirty && cropJson !== currentCropJson)

      if (socialSourceFile) {
        const sourceUpload = await api.upload(socialSourceFile)
        savedSourceUrl = sourceUpload.data.url
        const finalBlob = await renderSocialImageBlob(socialSourceObjectUrl, socialCrop)
        const finalFile = new File([finalBlob], `social-preview-${Date.now()}.jpg`, { type: 'image/jpeg' })
        const finalUpload = await api.upload(finalFile)
        savedImageUrl = finalUpload.data.url
        body.social_image_source_url = savedSourceUrl
        body.social_image_url = savedImageUrl
        body.social_image_crop_json = cropJson
      } else if (shouldRenderCrop) {
        const finalBlob = await renderSocialImageBlob(toCanvasSafeAssetUrl(socialSourceUrl), socialCrop)
        const finalFile = new File([finalBlob], `social-preview-${Date.now()}.jpg`, { type: 'image/jpeg' })
        const finalUpload = await api.upload(finalFile)
        savedImageUrl = finalUpload.data.url
        body.social_image_url = savedImageUrl
        body.social_image_crop_json = cropJson
      }

      const res = await api.publications.update(id, body)
      setPub(res.data)
      setPublicSlug(res.data.public_slug ?? '')
      setSocialTitle(res.data.social_title ?? '')
      setSocialDescription(res.data.social_description ?? '')
      setSocialImageUrl(res.data.social_image_url ?? savedImageUrl ?? '')
      setSocialSourceUrl(res.data.social_image_source_url ?? savedSourceUrl ?? '')
      setSocialCrop(parseSocialCrop(res.data.social_image_crop_json ?? cropJson))
      setSocialCropDirty(false)
      setSocialSourceFile(null)
      setSocialSourceObjectUrl('')
      setMsg({ text: 'Cambios guardados correctamente.', ok: true })
      if ((res as any).warning) setMsg({ text: (res as any).warning, ok: false })
    } catch (e: any) {
      setMsg({ text: e.message ?? 'Error al guardar', ok: false })
      setSocialError(e.message ?? 'Error al guardar la vista previa.')
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(null), 4000)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    await saveSettings()
  }

  function handleSocialImageFile(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/') || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setSocialError('Subí una imagen JPG, PNG o WebP.')
      return
    }
    if (file.size > SOCIAL_IMAGE_MAX_BYTES) {
      setSocialError('La imagen no puede superar 10 MB.')
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setSocialSourceFile(file)
    setSocialSourceObjectUrl(objectUrl)
    setSocialSourceUrl(objectUrl)
    setSocialCrop(DEFAULT_SOCIAL_CROP)
    setSocialCropDirty(true)
    setSocialPreviewUrl('')
    setSocialError('')
  }

  async function handleDelete() {
    if (!id) return
    setDeleting(true)
    try {
      await api.publications.delete(id)
      navigate('/publications')
    } catch (e: any) {
      setMsg({ text: e.message ?? 'Error al eliminar', ok: false })
      setDeleting(false)
    }
  }

  async function handleSaveProject(e: React.FormEvent) {
    e.preventDefault()
    if (!id) return
    setSavingProject(true)
    try {
      const res = await api.publications.update(id, {
        project_developer: projectDeveloper || undefined,
        project_phone:     projectPhone || undefined,
        project_whatsapp:  projectWhatsapp || undefined,
        project_location:  projectLocation || undefined,
        project_address:   projectAddress || undefined,
        project_website:   projectWebsite || undefined,
      })
      setPub(res.data)
      setMsg({ text: 'Datos del proyecto guardados correctamente.', ok: true })
    } catch (e: any) {
      setMsg({ text: e.message ?? 'Error al guardar', ok: false })
    } finally {
      setSavingProject(false)
      setTimeout(() => setMsg(null), 4000)
    }
  }

  if (!pub) return <div style={{ padding: '3rem', color: '#666' }}>Cargando...</div>

  const soundAllowed = usage?.features?.sound_enabled ?? false
  const socialEditorSrc = socialSourceObjectUrl || socialSourceUrl
  const socialPreviewTitle = socialTitle.trim() || title
  const socialPreviewDescription = socialDescription.trim() || description || DEFAULT_SOCIAL_DESCRIPTION
  const socialPreviewImage = socialPreviewUrl || socialImageUrl || pub.cover_image_url || ''
  const canEditSocialImage = !!socialEditorSrc
  const hasSocialImageWithoutSource = !!socialImageUrl && !socialEditorSrc

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.breadcrumb}>
          <Link to="/publications" style={styles.crumbLink}>Publicaciones</Link>
          <span style={styles.sep}>/</span>
          <Link to={`/publications/${id}/editor`} style={styles.crumbLink}>{pub.title}</Link>
          <span style={styles.sep}>/</span>
          <span style={{ color: '#111827' }}>Configuración</span>
        </div>
        <div style={styles.tabBar}>
          <Link to={`/publications/${id}/editor`}   style={styles.tab}>Editor</Link>
          <Link to={`/publications/${id}/preview`}  style={styles.tab}>Vista previa</Link>
          <span style={{ ...styles.tab, ...styles.tabActive }}>Configuración</span>
        </div>
      </div>

      {msg && (
        <div style={{ ...styles.toast, background: msg.ok ? '#059669' : '#dc2626' }}>
          {msg.text}
        </div>
      )}

      <div style={styles.body}>
        {/* Información general */}
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Información general</h2>
          <form onSubmit={handleSave} style={styles.form}>
            <label style={styles.label}>
              Título <span style={styles.required}>*</span>
              <input
                style={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={120}
              />
            </label>

            <label style={styles.label}>
              Enlace público (slug) <span style={styles.required}>*</span>
              <input
                style={styles.input}
                value={publicSlug}
                onChange={(e) => setPublicSlug(publicationSlugDraft(e.target.value))}
                required
                maxLength={60}
                placeholder="catalogo-para-hombres"
              />
              <span style={styles.helpText}>flip.intaprd.com/{publicSlug || 'slug-del-flipbook'}</span>
              {pub.status === 'published' && publicSlug !== (pub.public_slug ?? '') && (
                <span style={styles.warnText}>Cambiar el slug modifica el enlace público de esta publicación.</span>
              )}
            </label>

            <label style={styles.label}>
              Descripción
              <textarea
                style={{ ...styles.input, height: 90, resize: 'vertical' }}
                value={description}
                onChange={(e) => setDesc(e.target.value)}
                maxLength={500}
              />
            </label>

            <label style={styles.label}>
              Categoría
              <select
                style={styles.input}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Sin categoría</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>

            <button type="submit" disabled={saving} style={styles.btnPrimary}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </form>
        </section>

        {/* Vista previa al compartir */}
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Vista previa al compartir</h2>
          <p style={styles.helpText}>
            Personaliza la tarjeta que verán las personas al compartir este catálogo por WhatsApp, Facebook, LinkedIn o X.
          </p>

          <div style={styles.form}>
            <label style={styles.label}>
              Título para compartir
              <input
                style={styles.input}
                value={socialTitle}
                onChange={(e) => setSocialTitle(e.target.value.slice(0, 120))}
                maxLength={120}
                placeholder="Usar título del catálogo"
              />
            </label>

            <label style={styles.label}>
              Descripción para compartir
              <textarea
                style={{ ...styles.input, height: 86, resize: 'vertical' }}
                value={socialDescription}
                onChange={(e) => setSocialDescription(e.target.value.slice(0, 300))}
                maxLength={300}
                placeholder="Usar descripción del catálogo"
              />
              <span style={styles.counter}>{socialDescription.length}/300</span>
            </label>

            <button
              type="button"
              style={styles.btnSecondary}
              onClick={() => {
                setSocialTitle(title)
                setSocialDescription(description)
              }}
            >
              Restaurar título y descripción del catálogo
            </button>

            <div style={styles.socialImageBox}>
              <h3 style={styles.subTitle}>Imagen para compartir</h3>
              <p style={styles.helpText}>
                Recomendado: 1200 × 630 px. Esta imagen se usará en la tarjeta de enlace compartida.
              </p>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => handleSocialImageFile(e.target.files?.[0] ?? null)}
                style={styles.fileInput}
              />
              {hasSocialImageWithoutSource && (
                <p style={styles.warnText}>
                  Esta publicación ya tiene una imagen social guardada. Para reencuadrarla, cargá una nueva imagen fuente.
                </p>
              )}
              {socialError && <p style={styles.errorText}>{socialError}</p>}

              {canEditSocialImage ? (
                <>
                  <SocialCropEditor
                    imageSrc={socialEditorSrc}
                    crop={socialCrop}
                    onCropChange={(next, meta) => {
                      setSocialCrop(next)
                      if (meta.userInteraction) setSocialCropDirty(true)
                    }}
                    onPreview={setSocialPreviewUrl}
                    onError={(message) => setSocialError(message ?? '')}
                  />
                  <button
                    type="button"
                    style={styles.btnSecondary}
                    onClick={() => {
                      setSocialCrop(DEFAULT_SOCIAL_CROP)
                      setSocialCropDirty(true)
                    }}
                  >
                    Restablecer encuadre
                  </button>
                </>
              ) : socialPreviewImage ? (
                <img src={toCanvasSafeAssetUrl(socialPreviewImage)} alt="" style={styles.socialSavedImage} />
              ) : null}
            </div>

            <div>
              <div style={styles.platformTabs}>
                {(['WhatsApp', 'Facebook', 'X'] as const).map((platform) => (
                  <button
                    key={platform}
                    type="button"
                    onClick={() => setSocialPlatform(platform)}
                    style={{
                      ...styles.platformTab,
                      ...(socialPlatform === platform ? styles.platformTabActive : {}),
                    }}
                  >
                    {platform}
                  </button>
                ))}
              </div>
              <div style={{
                ...styles.linkPreview,
                ...(socialPlatform === 'X' ? styles.linkPreviewX : {}),
              }}>
                {socialPreviewImage && (
                  <img src={toCanvasSafeAssetUrl(socialPreviewImage)} alt="" style={styles.linkPreviewImage} />
                )}
                <div style={styles.linkPreviewBody}>
                  <p style={styles.linkPreviewHost}>flip.intaprd.com</p>
                  <p style={styles.linkPreviewTitle}>{socialPreviewTitle}</p>
                  <p style={styles.linkPreviewDescription}>{socialPreviewDescription}</p>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={saving}
              style={styles.btnPrimary}
              onClick={() => void saveSettings()}
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </section>

        {/* Opciones del flipbook */}
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Opciones del flipbook</h2>

          <div style={styles.toggleRow}>
            <div>
              <p style={styles.toggleLabel}>Sonido al voltear páginas</p>
              <p style={styles.toggleHint}>
                {soundAllowed
                  ? 'Activa el efecto de sonido al pasar páginas.'
                  : 'Disponible en plan Basic y Pro.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!soundAllowed) return
                setSound(!soundEnabled)
              }}
              disabled={!soundAllowed}
              style={{
                ...styles.toggle,
                background: soundEnabled && soundAllowed ? '#4f46e5' : '#d1d5db',
                opacity: soundAllowed ? 1 : 0.5,
              }}
            >
              <span style={{
                ...styles.toggleThumb,
                transform: soundEnabled && soundAllowed ? 'translateX(20px)' : 'translateX(2px)',
              }} />
            </button>
          </div>

          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Slug público</span>
            <code style={styles.infoValue}>{pub.public_slug ?? '—'}</code>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Estado</span>
            <span style={{
              ...styles.badge,
              background: pub.status === 'published' ? '#059669' : '#6b7280',
            }}>
              {pub.status === 'published' ? 'Publicado' : 'Borrador'}
            </span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Creado</span>
            <span style={styles.infoValue}>{new Date(pub.created_at).toLocaleDateString('es-AR')}</span>
          </div>

          {soundEnabled !== !!pub.sound_enabled && (
            <button
              onClick={handleSave as any}
              disabled={saving}
              style={{ ...styles.btnPrimary, marginTop: '1rem' }}
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          )}
        </section>

        {/* Datos del Proyecto */}
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Datos del Proyecto</h2>
          <p style={{ color: '#6b7280', fontSize: '0.8rem', marginBottom: '1rem', marginTop: 0 }}>
            Información de contacto y ubicación que puede mostrarse en el flipbook.
          </p>
          <form onSubmit={handleSaveProject} style={styles.form}>
            <label style={styles.label}>
              Desarrolladora / Empresa
              <input
                style={styles.input}
                value={projectDeveloper}
                onChange={(e) => setProjectDeveloper(e.target.value)}
                maxLength={120}
                placeholder="Nombre de la empresa o desarrolladora"
              />
            </label>

            <label style={styles.label}>
              Teléfono del proyecto
              <input
                style={styles.input}
                value={projectPhone}
                onChange={(e) => setProjectPhone(e.target.value)}
                maxLength={40}
                placeholder="+54 11 1234-5678"
              />
            </label>

            <label style={styles.label}>
              WhatsApp del proyecto
              <input
                style={styles.input}
                value={projectWhatsapp}
                onChange={(e) => setProjectWhatsapp(e.target.value)}
                maxLength={40}
                placeholder="+54 9 11 1234-5678"
              />
            </label>

            <label style={styles.label}>
              Ubicación / Barrio
              <input
                style={styles.input}
                value={projectLocation}
                onChange={(e) => setProjectLocation(e.target.value)}
                maxLength={120}
                placeholder="Palermo, Buenos Aires"
              />
            </label>

            <label style={styles.label}>
              Dirección completa
              <input
                style={styles.input}
                value={projectAddress}
                onChange={(e) => setProjectAddress(e.target.value)}
                maxLength={200}
                placeholder="Av. Corrientes 1234, CABA"
              />
            </label>

            <label style={styles.label}>
              Sitio web
              <input
                style={styles.input}
                value={projectWebsite}
                onChange={(e) => setProjectWebsite(e.target.value)}
                maxLength={200}
                placeholder="https://www.miproyecto.com"
                type="url"
              />
            </label>

            <button type="submit" disabled={savingProject} style={styles.btnPrimary}>
              {savingProject ? 'Guardando...' : 'Guardar datos del proyecto'}
            </button>
          </form>
        </section>

        {/* Gestión de Unidades — disponible para cualquier publicación */}
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Gestión de Unidades</h2>
          <p style={{ color: '#6b7280', fontSize: '0.8rem', marginBottom: '1rem', marginTop: 0 }}>
            Registrá los departamentos, locales u otras unidades de este proyecto. Podés cambiar
            su estado (Disponible / Reservada / Vendida) con un solo clic.
          </p>
          <UnitsPanel publicationId={id!} />
        </section>

        {/* Zona peligrosa */}
        <section style={{ ...styles.card, borderColor: '#fca5a5' }}>
          <h2 style={{ ...styles.sectionTitle, color: '#dc2626' }}>Zona peligrosa</h2>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Eliminar esta publicación borrará también todas sus páginas. Esta acción no se puede deshacer.
          </p>
          {!confirmDelete ? (
            <button onClick={() => setConfirm(true)} style={styles.btnDanger}>
              Eliminar publicación
            </button>
          ) : (
            <div style={styles.confirmBox}>
              <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 0.75rem' }}>
                ¿Estás seguro? Esta acción es irreversible.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={handleDelete} disabled={deleting} style={styles.btnDanger}>
                  {deleting ? 'Eliminando...' : 'Sí, eliminar'}
                </button>
                <button onClick={() => setConfirm(false)} style={styles.btnSecondary}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page:         { fontFamily: 'Inter, system-ui, sans-serif', minHeight: '100vh', background: '#f8fafc' },
  header:       { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0.75rem 1.5rem 0' },
  breadcrumb:   { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', marginBottom: '0.75rem' },
  crumbLink:    { color: '#4f46e5', textDecoration: 'none' },
  sep:          { color: '#d1d5db' },
  tabBar:       { display: 'flex', gap: 0 },
  tab:          { padding: '0.5rem 1rem', fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none', borderBottom: '2px solid transparent' },
  tabActive:    { color: '#4f46e5', borderBottom: '2px solid #4f46e5', fontWeight: 600 },
  toast:        { position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', color: '#fff', padding: '0.6rem 1.25rem', borderRadius: 8, fontSize: '0.875rem', zIndex: 100 },
  body:         { maxWidth: 680, margin: '0 auto', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  card:         { background: '#fff', borderRadius: 12, padding: '1.5rem', border: '1px solid #e5e7eb' },
  sectionTitle: { fontSize: '1rem', fontWeight: 700, color: '#111827', margin: '0 0 1.25rem' },
  subTitle:      { fontSize: '0.9rem', fontWeight: 700, color: '#111827', margin: '0 0 0.35rem' },
  helpText:      { color: '#6b7280', fontSize: '0.82rem', lineHeight: 1.45, margin: '0 0 1rem' },
  form:         { display: 'flex', flexDirection: 'column', gap: '1rem' },
  label:        { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', fontWeight: 500, color: '#374151' },
  counter:      { alignSelf: 'flex-end', color: '#6b7280', fontSize: '0.75rem', fontWeight: 400 },
  required:     { color: '#dc2626' },
  input:        { border: '1px solid #d1d5db', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit', background: '#fff' },
  btnPrimary:   { background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1.25rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', alignSelf: 'flex-start' },
  btnDanger:    { background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1.25rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' },
  btnSecondary: { background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, padding: '0.6rem 1.25rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' },
  toggleRow:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' },
  toggleLabel:  { fontWeight: 600, fontSize: '0.9rem', color: '#111827', margin: '0 0 0.25rem' },
  toggleHint:   { fontSize: '0.8rem', color: '#9ca3af', margin: 0 },
  toggle:       { width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 },
  toggleThumb:  { position: 'absolute', top: 2, width: 20, height: 20, background: '#fff', borderRadius: '50%', transition: 'transform .2s', display: 'block' },
  infoRow:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderTop: '1px solid #f3f4f6' },
  infoLabel:    { fontSize: '0.875rem', color: '#6b7280' },
  infoValue:    { fontSize: '0.875rem', color: '#374151', background: '#f9fafb', padding: '2px 8px', borderRadius: 4 },
  badge:        { fontSize: '0.7rem', color: '#fff', borderRadius: 12, padding: '2px 8px', fontWeight: 600 },
  confirmBox:   { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '1rem' },
  socialImageBox: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', background: '#f9fafb' },
  fileInput:    { fontSize: '0.85rem', color: '#374151', marginBottom: '0.75rem' },
  warnText:     { color: '#92400e', fontSize: '0.8rem', lineHeight: 1.4, margin: '0.25rem 0 0.75rem' },
  errorText:    { color: '#dc2626', fontSize: '0.8rem', lineHeight: 1.4, margin: '0.25rem 0 0.75rem' },
  cropShell:    { display: 'flex', flexDirection: 'column', gap: '0.75rem', margin: '0.75rem 0' },
  cropCanvas:   { width: '100%', aspectRatio: '1200 / 630', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'grab', touchAction: 'none', display: 'block' },
  socialSavedImage: { width: '100%', aspectRatio: '1200 / 630', objectFit: 'cover', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', display: 'block' },
  platformTabs: { display: 'flex', gap: 6, marginBottom: 8 },
  platformTab:  { border: '1px solid #d1d5db', background: '#fff', color: '#374151', borderRadius: 8, padding: '0.4rem 0.7rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' },
  platformTabActive: { borderColor: '#4f46e5', color: '#4f46e5', background: '#eef2ff' },
  linkPreview:  { border: '1px solid #d1d5db', borderRadius: 8, overflow: 'hidden', background: '#fff' },
  linkPreviewX: { borderRadius: 12, background: '#ffffff' },
  linkPreviewImage: { width: '100%', aspectRatio: '1200 / 630', objectFit: 'cover', display: 'block', background: '#f3f4f6' },
  linkPreviewBody: { padding: '0.75rem' },
  linkPreviewHost: { margin: '0 0 0.25rem', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase' },
  linkPreviewTitle: { margin: '0 0 0.25rem', color: '#111827', fontSize: '0.92rem', fontWeight: 700, lineHeight: 1.3 },
  linkPreviewDescription: { margin: 0, color: '#4b5563', fontSize: '0.82rem', lineHeight: 1.35 },
}

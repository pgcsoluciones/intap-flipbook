import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import { getUserPlan, checkStorageLimit } from '../lib/plans'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

type Variables = AuthVariables

const upload = new Hono<{ Bindings: Env; Variables: Variables }>()

upload.use('*', jwtMiddleware)

// Tipos MIME permitidos y su extensión de archivo asociada.
// Imágenes, audio, video y documentos descargables (cupones, catálogos PDF, etc.).
const EXT_BY_TYPE: Record<string, string> = {
  // Imágenes
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
  // Audio
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  // Video
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  // Documentos descargables
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}
const IMAGE_MAX_BYTES = 10 * 1024 * 1024  // 10 MB para imágenes
const MEDIA_MAX_BYTES = 50 * 1024 * 1024  // 50 MB para audio/video/documentos

upload.post('/', async (c) => {
  const userId = c.get('user').sub

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ success: false, error: 'file field is required' }, 400)

  const ext = EXT_BY_TYPE[file.type]
  if (!ext) {
    return c.json({ success: false, error: 'Tipo de archivo no permitido. Se aceptan imágenes, audio, video y documentos (PDF, ZIP, Office).' }, 415)
  }
  const isImage = file.type.startsWith('image/')
  const maxBytes = isImage ? IMAGE_MAX_BYTES : MEDIA_MAX_BYTES
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / 1024 / 1024)
    return c.json({ success: false, error: `El archivo supera el tamaño máximo de ${mb} MB` }, 413)
  }

  const { plan } = await getUserPlan(c.env.DB, userId)
  const storageError = await checkStorageLimit(c.env.DB, userId, plan, file.size)
  if (storageError) return c.json({ success: false, error: storageError }, 403)

  const key = `uploads/${userId}/${crypto.randomUUID()}.${ext}`

  await c.env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  })

  const url = `${c.env.R2_PUBLIC_BASE_URL}/${key}`
  return c.json({ success: true, data: { url, key, size_bytes: file.size } }, 201)
})

// Borra un archivo de R2. Acepta el `key` directo o una `url` pública (de la que se
// deriva el key). Guarda de propiedad: solo se permite borrar archivos dentro de
// `uploads/<userId>/` del usuario autenticado — nadie puede borrar archivos de otro.
upload.delete('/', async (c) => {
  const userId = c.get('user').sub

  const body = await c.req.json<{ key?: string; url?: string }>().catch(() => ({}))
  let key = body.key?.trim()

  // Si llega una URL pública, derivamos el key quitando el prefijo R2.
  if (!key && body.url) {
    const base = c.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')
    key = body.url.trim().replace(`${base}/`, '')
  }

  if (!key) return c.json({ success: false, error: 'key o url es requerido' }, 400)

  const prefix = `uploads/${userId}/`
  if (!key.startsWith(prefix)) {
    return c.json({ success: false, error: 'No autorizado para borrar este archivo' }, 403)
  }

  await c.env.MEDIA.delete(key)
  return c.json({ success: true })
})

export default upload

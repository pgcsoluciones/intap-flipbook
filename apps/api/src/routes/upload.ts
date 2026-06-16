import { Hono } from 'hono'
import { jwtMiddleware } from '../middleware/jwt'
import { getUserPlan, checkStorageLimit } from '../lib/plans'
import type { Env } from '../index'
import type { AuthVariables } from '../middleware/jwt'

type Variables = AuthVariables

const upload = new Hono<{ Bindings: Env; Variables: Variables }>()

upload.use('*', jwtMiddleware)

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const HARD_MAX_BYTES = 10 * 1024 * 1024 // 10 MB absolute cap per file

upload.post('/', async (c) => {
  const userId = c.get('user').sub

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ success: false, error: 'file field is required' }, 400)

  if (!ALLOWED_TYPES.includes(file.type)) {
    return c.json({ success: false, error: 'Solo se permiten imágenes JPG, PNG o WEBP' }, 415)
  }
  if (file.size > HARD_MAX_BYTES) {
    return c.json({ success: false, error: 'El archivo supera el tamaño máximo de 10 MB' }, 413)
  }

  const { plan } = await getUserPlan(c.env.DB, userId)
  const storageError = await checkStorageLimit(c.env.DB, userId, plan, file.size)
  if (storageError) return c.json({ success: false, error: storageError }, 403)

  const ext = file.type.split('/')[1].replace('jpeg', 'jpg')
  const key = `uploads/${userId}/${crypto.randomUUID()}.${ext}`

  await c.env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  })

  const url = `${c.env.R2_PUBLIC_BASE_URL}/${key}`
  return c.json({ success: true, data: { url, key, size_bytes: file.size } }, 201)
})

export default upload

import { createMiddleware } from 'hono/factory'
import { verifyJwt, type JwtPayload } from '../lib/jwt'
import type { Env } from '../index'

export type AuthVariables = { user: JwtPayload }

export const jwtMiddleware = createMiddleware<{ Bindings: Env; Variables: AuthVariables }>(
  async (c, next) => {
    const auth = c.req.header('Authorization')
    if (!auth?.startsWith('Bearer ')) {
      return c.json({ success: false, error: 'Missing or invalid Authorization header' }, 401)
    }

    try {
      const payload = await verifyJwt(auth.slice(7), c.env.JWT_SECRET)
      c.set('user', payload)
      await next()
    } catch {
      return c.json({ success: false, error: 'Invalid or expired token' }, 401)
    }
  },
)

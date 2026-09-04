const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' }
const MAX_CLOCK_SKEW_SECONDS = 60

async function getKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error('JWT secret is required')
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    ALGORITHM,
    false,
    ['sign', 'verify'],
  )
}

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function decodeBase64url(str: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(str)) throw new Error('Invalid base64url')
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

export interface JwtPayload {
  sub: string
  email: string
  iat: number
  exp: number
  kind?: string
  publication_id?: string
  [key: string]: unknown
}

export async function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  expiryDays: number,
): Promise<string> {
  if (!payload.sub || !payload.email) throw new Error('Invalid JWT subject')
  if (!Number.isFinite(expiryDays) || expiryDays <= 0) throw new Error('Invalid JWT expiry')

  const now = Math.floor(Date.now() / 1000)
  const full: JwtPayload = { ...payload, iat: now, exp: now + Math.floor(expiryDays * 86400) }

  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = base64url(new TextEncoder().encode(JSON.stringify(full)))
  const input = `${header}.${body}`

  const key = await getKey(secret)
  const sig = await crypto.subtle.sign(ALGORITHM, key, new TextEncoder().encode(input))

  return `${input}.${base64url(sig)}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
  if (!token || token.length > 8192) throw new Error('Invalid token length')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid token format')

  const [headerPart, body, sig] = parts
  const header = JSON.parse(new TextDecoder().decode(decodeBase64url(headerPart)))
  if (header?.alg !== 'HS256' || header?.typ !== 'JWT') throw new Error('Invalid token header')

  const input = `${headerPart}.${body}`
  const key = await getKey(secret)
  const valid = await crypto.subtle.verify(
    ALGORITHM,
    key,
    decodeBase64url(sig),
    new TextEncoder().encode(input),
  )
  if (!valid) throw new Error('Invalid signature')

  const payload: JwtPayload = JSON.parse(new TextDecoder().decode(decodeBase64url(body)))
  const now = Math.floor(Date.now() / 1000)

  if (!payload || typeof payload !== 'object') throw new Error('Invalid payload')
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Invalid subject')
  if (typeof payload.email !== 'string' || !payload.email) throw new Error('Invalid email')
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) throw new Error('Invalid timestamps')
  if (payload.iat > now + MAX_CLOCK_SKEW_SECONDS) throw new Error('Token issued in the future')
  if (payload.exp <= now) throw new Error('Token expired')
  if (payload.exp <= payload.iat) throw new Error('Invalid token lifetime')

  return payload
}

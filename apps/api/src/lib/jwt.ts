const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' }

async function getKey(secret: string): Promise<CryptoKey> {
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
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

export interface JwtPayload {
  sub: string
  email: string
  iat: number
  exp: number
}

export async function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  expiryDays: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const full: JwtPayload = { ...payload, iat: now, exp: now + expiryDays * 86400 }

  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = base64url(new TextEncoder().encode(JSON.stringify(full)))
  const input = `${header}.${body}`

  const key = await getKey(secret)
  const sig = await crypto.subtle.sign(ALGORITHM, key, new TextEncoder().encode(input))

  return `${input}.${base64url(sig)}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid token format')

  const [header, body, sig] = parts
  const input = `${header}.${body}`

  const key = await getKey(secret)
  const valid = await crypto.subtle.verify(
    ALGORITHM,
    key,
    decodeBase64url(sig),
    new TextEncoder().encode(input),
  )
  if (!valid) throw new Error('Invalid signature')

  const payload: JwtPayload = JSON.parse(new TextDecoder().decode(decodeBase64url(body)))
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired')

  return payload
}

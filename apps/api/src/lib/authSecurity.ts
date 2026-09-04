const LOGIN_WINDOW_SECONDS = 15 * 60
const LOGIN_BLOCK_SECONDS = 15 * 60
const LOGIN_MAX_FAILURES = 5
const SESSION_REVOCATION_TTL_SECONDS = 60 * 60 * 24 * 90

function normalizeEmail(value: string) {
  return value.trim().toLowerCase().slice(0, 320)
}

function clientIp(headers: Headers) {
  return (
    headers.get('CF-Connecting-IP')
    || headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown'
  ).slice(0, 120)
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function loginScopeKey(headers: Headers, email: string) {
  const emailHash = await sha256(normalizeEmail(email))
  const ipHash = await sha256(clientIp(headers))
  return `auth:login:${ipHash.slice(0, 24)}:${emailHash.slice(0, 24)}`
}

type LoginAttemptState = {
  failures: number
  blocked_until: number
}

async function readLoginState(kv: KVNamespace, key: string): Promise<LoginAttemptState> {
  const state = await kv.get<LoginAttemptState>(key, 'json')
  if (!state || !Number.isFinite(state.failures) || !Number.isFinite(state.blocked_until)) {
    return { failures: 0, blocked_until: 0 }
  }
  return {
    failures: Math.max(0, Math.floor(state.failures)),
    blocked_until: Math.max(0, Math.floor(state.blocked_until)),
  }
}

export async function checkLoginThrottle(
  kv: KVNamespace,
  headers: Headers,
  email: string,
) {
  const key = await loginScopeKey(headers, email)
  const state = await readLoginState(kv, key)
  const now = Math.floor(Date.now() / 1000)

  if (state.blocked_until > now) {
    return {
      allowed: false as const,
      key,
      retryAfterSeconds: state.blocked_until - now,
    }
  }

  return { allowed: true as const, key, retryAfterSeconds: 0 }
}

export async function recordFailedLogin(kv: KVNamespace, key: string) {
  const state = await readLoginState(kv, key)
  const failures = state.failures + 1
  const now = Math.floor(Date.now() / 1000)
  const blockedUntil = failures >= LOGIN_MAX_FAILURES
    ? now + LOGIN_BLOCK_SECONDS
    : 0

  await kv.put(
    key,
    JSON.stringify({ failures, blocked_until: blockedUntil }),
    { expirationTtl: LOGIN_WINDOW_SECONDS },
  )

  return {
    failures,
    blockedUntil,
    retryAfterSeconds: blockedUntil ? LOGIN_BLOCK_SECONDS : 0,
  }
}

export async function clearLoginFailures(kv: KVNamespace, key: string) {
  await kv.delete(key)
}

export function accessTokenExpiryDays(configuredDays: string | undefined) {
  const parsed = Number(configuredDays)
  if (!Number.isFinite(parsed) || parsed <= 0) return 1
  return Math.min(Math.max(Math.floor(parsed), 1), 7)
}

export async function revokeUserSessions(kv: KVNamespace, userId: string) {
  const revokedBefore = Math.floor(Date.now() / 1000)
  await kv.put(
    `auth:revoked-before:${userId}`,
    String(revokedBefore),
    { expirationTtl: SESSION_REVOCATION_TTL_SECONDS },
  )
  return revokedBefore
}

export async function isSessionRevoked(
  kv: KVNamespace,
  userId: string,
  issuedAt: number,
) {
  const raw = await kv.get(`auth:revoked-before:${userId}`)
  if (!raw) return false
  const revokedBefore = Number(raw)
  if (!Number.isFinite(revokedBefore)) return false
  return issuedAt <= revokedBefore
}

export function passwordPolicyError(password: string) {
  if (password.length < 12) return 'La contraseña debe tener al menos 12 caracteres'
  if (password.length > 200) return 'La contraseña es demasiado larga'
  return ''
}

export const AUTH_SECURITY_LIMITS = {
  loginWindowSeconds: LOGIN_WINDOW_SECONDS,
  loginBlockSeconds: LOGIN_BLOCK_SECONDS,
  loginMaxFailures: LOGIN_MAX_FAILURES,
}

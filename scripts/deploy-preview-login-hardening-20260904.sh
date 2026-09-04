#!/usr/bin/env bash
set -euo pipefail

SOURCE_SHA="d2221c5d988c00a819c966c5c49c7cac9f1f5482"
BASE_SHA="f46e66c4153edbbfd7a5a6754f2bf90ff04aa165"
REPO="https://github.com/pgcsoluciones/intap-flipbook.git"
API_URL="https://intap-flipbook-api-preview.fliaprince.workers.dev"
VIEWER_URL="https://f144363d.intap-flipbook-viewer.pages.dev"
QA_ORIGIN="https://studio.flip.intaprd.com"
DASHBOARD_PROJECT="intap-flipbook-dashboard"
DASHBOARD_BRANCH="qa-login-hardening-20260904"
WRANGLER="${WRANGLER:-$HOME/intap-flipbook-dynamic-markers/node_modules/.bin/wrangler}"
TMP_DIR="$(mktemp -d /tmp/intap-login-hardening.XXXXXX)"
QA_EMAIL="qa-login-security-$(date +%s)-$RANDOM@example.test"
QA_PASSWORD="Kawvo-QA-$(date +%s)-Aa9!"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -x "$WRANGLER" ] || fail "No se encontró Wrangler en $WRANGLER"

printf '\n======================================================\n'
printf ' INTAP · PREVIEW · LOGIN HARDENING\n'
printf '======================================================\n\n'

printf '=== 1. CLON AISLADO DEL CANDIDATO ===\n'
git clone --no-checkout "$REPO" "$TMP_DIR/repo"
cd "$TMP_DIR/repo"
git checkout --detach "$SOURCE_SHA"
ACTUAL_SHA="$(git rev-parse HEAD)"
printf 'Commit esperado: %s\n' "$SOURCE_SHA"
printf 'Commit usado:    %s\n' "$ACTUAL_SHA"
[ "$ACTUAL_SHA" = "$SOURCE_SHA" ] || fail "Commit inesperado. Se cancela."

printf '\n=== 2. DEPENDENCIAS TEMPORALES ===\n'
npm ci --ignore-scripts

printf '\n=== 3. QA TYPESCRIPT COMPARADO CONTRA BASE ===\n'
BASE_DIR="$TMP_DIR/base"
git worktree add --detach "$BASE_DIR" "$BASE_SHA" >/dev/null
ln -s "$TMP_DIR/repo/node_modules" "$BASE_DIR/node_modules"

BASE_TSC="$TMP_DIR/tsc-base.txt"
CANDIDATE_TSC="$TMP_DIR/tsc-candidate.txt"

set +e
(
  cd "$BASE_DIR"
  "$TMP_DIR/repo/node_modules/.bin/tsc" --noEmit -p apps/api/tsconfig.json >"$BASE_TSC" 2>&1
)
BASE_TSC_STATUS=$?
(
  cd "$TMP_DIR/repo"
  ./node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json >"$CANDIDATE_TSC" 2>&1
)
CANDIDATE_TSC_STATUS=$?
set -e

BASE_ERRORS="$(grep -c ' - error TS' "$BASE_TSC" || true)"
CANDIDATE_ERRORS="$(grep -c ' - error TS' "$CANDIDATE_TSC" || true)"
printf 'Errores TypeScript conocidos en base: %s\n' "$BASE_ERRORS"
printf 'Errores TypeScript en candidato:      %s\n' "$CANDIDATE_ERRORS"

if grep -Eq '^apps/api/src/(lib/authSecurity|lib/jwt|middleware/jwt|routes/auth)\.ts.* - error TS' "$CANDIDATE_TSC"; then
  cat "$CANDIDATE_TSC"
  fail "El candidato introduce errores TypeScript en archivos de seguridad."
fi

if [ "$CANDIDATE_ERRORS" -gt "$BASE_ERRORS" ]; then
  cat "$CANDIDATE_TSC"
  fail "El candidato agrega errores TypeScript sobre la base conocida."
fi

if [ "$CANDIDATE_TSC_STATUS" -eq 0 ]; then
  printf '✓ TypeScript API completamente limpio\n'
else
  printf '✓ El candidato no agrega deuda TypeScript; persisten %s errores preexistentes de la base\n' "$CANDIDATE_ERRORS"
fi

printf '\n=== 4. BUILD DASHBOARD Y GUARDRAILS ===\n'
VITE_API_BASE_URL="$API_URL" \
VITE_VIEWER_BASE_URL="$VIEWER_URL" \
VITE_VIEWER_PREVIEW="1" \
npm --prefix apps/dashboard run build

grep -q "LOGIN_MAX_FAILURES = 5" apps/api/src/lib/authSecurity.ts || fail "Falta límite de intentos."
grep -q "revokeUserSessions" apps/api/src/routes/auth.ts || fail "Falta revocación de sesiones."
grep -Fq 'return `v2$${PASSWORD_HASH_ITERATIONS}$${bytesToHex(salt)}$${hashHex}`' apps/api/src/routes/auth.ts || fail "Falta hash versionado."
grep -q "payload.kind && payload.kind !== 'access'" apps/api/src/middleware/jwt.ts || fail "Falta validación de tipo de token."
grep -q 'minLength={mode === .register. ? 12' apps/dashboard/src/pages/Login.tsx || fail "Falta política de 12 caracteres en UI."
printf '✓ Dashboard build aprobado\n'
printf '✓ Guardrails de login presentes\n'

printf '\n=== 5. BUNDLE API PREVIEW SIN DESPLEGAR ===\n'
"$WRANGLER" deploy --config apps/api/wrangler.toml --env preview --dry-run --outdir "$TMP_DIR/api-dry-run" >/dev/null
printf '✓ Worker Preview compila y empaqueta\n'

printf '\n=== 6. DEPLOY SOLO API PREVIEW ===\n'
"$WRANGLER" deploy --config apps/api/wrangler.toml --env preview

printf '\n=== 7. QA E2E DE AUTENTICACIÓN EN PREVIEW ===\n'
printf 'Origen QA permitido: %s\n' "$QA_ORIGIN"
register_body="$(printf '{"email":"%s","password":"%s","name":"QA Login Security"}' "$QA_EMAIL" "$QA_PASSWORD")"
register_json="$(curl -fsS -X POST "$API_URL/auth/register" -H "Origin: $QA_ORIGIN" -H 'Content-Type: application/json' --data "$register_body")"
QA_TOKEN="$(printf '%s' "$register_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s); if(!j.success||!j.data?.token) process.exit(2); process.stdout.write(j.data.token)})')"
[ -n "$QA_TOKEN" ] || fail "Registro QA no devolvió token."
printf '✓ Registro con contraseña fuerte\n'

WEAK_EMAIL="qa-weak-password-$(date +%s)-$RANDOM@example.test"
weak_status="$(curl -sS -o "$TMP_DIR/weak.json" -w '%{http_code}' -X POST "$API_URL/auth/register" -H "Origin: $QA_ORIGIN" -H 'Content-Type: application/json' --data "{\"email\":\"$WEAK_EMAIL\",\"password\":\"12345678\"}")"
[ "$weak_status" = "400" ] || fail "La contraseña débil no fue rechazada: HTTP $weak_status"
printf '✓ Contraseña débil rechazada\n'

me_status="$(curl -sS -o "$TMP_DIR/me-before.json" -w '%{http_code}' "$API_URL/auth/me" -H "Authorization: Bearer $QA_TOKEN")"
[ "$me_status" = "200" ] || fail "Token recién emitido no accede a /auth/me: HTTP $me_status"
printf '✓ Token de acceso válido\n'

logout_status="$(curl -sS -o "$TMP_DIR/logout-all.json" -w '%{http_code}' -X POST "$API_URL/auth/logout-all" -H "Origin: $QA_ORIGIN" -H "Authorization: Bearer $QA_TOKEN")"
[ "$logout_status" = "200" ] || fail "logout-all falló: HTTP $logout_status"
revoked_status="$(curl -sS -o "$TMP_DIR/me-after.json" -w '%{http_code}' "$API_URL/auth/me" -H "Authorization: Bearer $QA_TOKEN")"
[ "$revoked_status" = "401" ] || fail "El token revocado siguió funcionando: HTTP $revoked_status"
printf '✓ Revocación de sesiones confirmada\n'

RATE_EMAIL="qa-rate-limit-$(date +%s)-$RANDOM@example.test"
for n in 1 2 3 4 5; do
  status="$(curl -sS -o "$TMP_DIR/rate-$n.json" -w '%{http_code}' -X POST "$API_URL/auth/login" -H "Origin: $QA_ORIGIN" -H 'Content-Type: application/json' --data "{\"email\":\"$RATE_EMAIL\",\"password\":\"incorrecta-$n\"}")"
  [ "$status" = "401" ] || fail "Intento $n esperaba 401 y devolvió $status"
done
rate_status="$(curl -sS -o "$TMP_DIR/rate-blocked.json" -w '%{http_code}' -X POST "$API_URL/auth/login" -H "Origin: $QA_ORIGIN" -H 'Content-Type: application/json' --data "{\"email\":\"$RATE_EMAIL\",\"password\":\"incorrecta-6\"}")"
[ "$rate_status" = "429" ] || fail "No se activó rate limit: HTTP $rate_status"
grep -q 'LOGIN_RATE_LIMITED' "$TMP_DIR/rate-blocked.json" || fail "Respuesta 429 sin código LOGIN_RATE_LIMITED."
printf '✓ Fuerza bruta limitada después de 5 fallos\n'

printf '\n=== 8. LIMPIEZA DEL USUARIO QA EN D1 PREVIEW ===\n'
"$WRANGLER" d1 execute pgc-landing-saas-db \
  --config apps/api/wrangler.toml --env preview --remote \
  --command "DELETE FROM users WHERE email = '$QA_EMAIL';" >/dev/null
printf '✓ Usuario QA eliminado\n'

printf '\n=== 9. DEPLOY SOLO DASHBOARD PREVIEW ===\n'
"$WRANGLER" pages deploy apps/dashboard/dist \
  --project-name="$DASHBOARD_PROJECT" \
  --branch="$DASHBOARD_BRANCH"

printf '\n======================================================\n'
printf ' LOGIN HARDENING PREVIEW LISTO PARA QA FÍSICO\n'
printf '======================================================\n'
printf 'API: %s\n' "$API_URL"
printf 'Viewer conservado: %s\n' "$VIEWER_URL"
printf 'Producción no fue modificada.\n\n'

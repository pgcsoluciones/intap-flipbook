#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/pgcsoluciones/intap-flipbook.git"
SOURCE_SHA="f01031d760aa099ce32d0f23e04526c5ac422d9d"
API_URL="https://intap-flipbook-api-preview.fliaprince.workers.dev"
QA_ORIGIN="https://studio.flip.intaprd.com"
WRANGLER="${WRANGLER:-$HOME/intap-flipbook-dynamic-markers/node_modules/.bin/wrangler}"
TMP_DIR="$(mktemp -d /tmp/intap-login-diag-v3.XXXXXX)"
TAIL_PID=""

cleanup() {
  if [ -n "$TAIL_PID" ]; then
    kill "$TAIL_PID" >/dev/null 2>&1 || true
    wait "$TAIL_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() { echo "ERROR: $*" >&2; exit 1; }
[ -x "$WRANGLER" ] || fail "No se encontró Wrangler en $WRANGLER"

printf '\n======================================================\n'
printf ' INTAP · DIAGNÓSTICO LOGIN PREVIEW · V3\n'
printf '======================================================\n\n'

git clone --no-checkout "$REPO" "$TMP_DIR/repo" >/dev/null 2>&1
cd "$TMP_DIR/repo"
git checkout --detach "$SOURCE_SHA" >/dev/null 2>&1
ACTUAL_SHA="$(git rev-parse HEAD)"
printf 'Commit esperado: %s\n' "$SOURCE_SHA"
printf 'Commit usado:    %s\n' "$ACTUAL_SHA"
[ "$ACTUAL_SHA" = "$SOURCE_SHA" ] || fail "Commit inesperado"

grep -q 'PASSWORD_HASH_ITERATIONS = 100_000' apps/api/src/routes/auth.ts || fail "El candidato no contiene PBKDF2=100000"
printf '✓ Candidato confirmado con PBKDF2=100000\n'

QA_EMAIL="qa-login-diag3-$(date +%s)-$RANDOM@example.test"
QA_PASSWORD="Kawvo-QA-$(date +%s)-Aa9!"
BODY="$(printf '{\"email\":\"%s\",\"password\":\"%s\",\"name\":\"QA Login Diagnostics V3\"}' "$QA_EMAIL" "$QA_PASSWORD")"

printf '\n=== 1. INICIAR TAIL DEL WORKER PREVIEW ===\n'
"$WRANGLER" tail --config apps/api/wrangler.toml --env preview --format pretty >"$TMP_DIR/tail.log" 2>&1 &
TAIL_PID=$!
for _ in $(seq 1 20); do
  if grep -q 'Connected to intap-flipbook-api-preview' "$TMP_DIR/tail.log" 2>/dev/null; then break; fi
  sleep 1
done
cat "$TMP_DIR/tail.log" || true

printf '\n=== 2. SANIDAD DEL API Y POLÍTICA DE PASSWORD ===\n'
ROOT_STATUS="$(curl -sS -o "$TMP_DIR/root.txt" -w '%{http_code}' "$API_URL/" || true)"
printf 'GET / -> HTTP %s\n' "$ROOT_STATUS"
WEAK_EMAIL="qa-login-diag3-weak-$(date +%s)-$RANDOM@example.test"
WEAK_STATUS="$(curl -sS -o "$TMP_DIR/weak.txt" -w '%{http_code}' \
  -X POST "$API_URL/auth/register" \
  -H "Origin: $QA_ORIGIN" \
  -H 'Content-Type: application/json' \
  --data "{\"email\":\"$WEAK_EMAIL\",\"password\":\"12345678\"}" || true)"
printf 'POST password débil -> HTTP %s\n' "$WEAK_STATUS"
cat "$TMP_DIR/weak.txt" || true; printf '\n'

printf '\n=== 3. REGISTRO FUERTE SOBRE CANDIDATO 100000 ===\n'
STATUS="$(curl -sS -o "$TMP_DIR/register.txt" -D "$TMP_DIR/register.headers" -w '%{http_code}' \
  -X POST "$API_URL/auth/register" \
  -H "Origin: $QA_ORIGIN" \
  -H 'Content-Type: application/json' \
  --data "$BODY" || true)"
printf 'HTTP %s\n' "$STATUS"
printf '%s\n' '--- RESPUESTA ---'
cat "$TMP_DIR/register.txt" || true
printf '\n%s\n' '--- HEADERS ---'
cat "$TMP_DIR/register.headers" || true

sleep 10
kill "$TAIL_PID" >/dev/null 2>&1 || true
wait "$TAIL_PID" >/dev/null 2>&1 || true
TAIL_PID=""

printf '\n=== 4. TAIL COMPLETO ===\n'
cat "$TMP_DIR/tail.log" || true

printf '\n=== 5. ESTADO DEL USUARIO QA EN D1 PREVIEW ===\n'
"$WRANGLER" d1 execute pgc-landing-saas-db \
  --config apps/api/wrangler.toml --env preview --remote \
  --command "SELECT id,email,length(password_hash) AS hash_len,substr(password_hash,1,12) AS hash_prefix,slug FROM users WHERE email = '$QA_EMAIL';" \
  | tee "$TMP_DIR/user.txt"

printf '\n=== 6. LIMPIEZA QA ===\n'
"$WRANGLER" d1 execute pgc-landing-saas-db \
  --config apps/api/wrangler.toml --env preview --remote \
  --command "DELETE FROM users WHERE email = '$QA_EMAIL' OR email = '$WEAK_EMAIL';" >/dev/null 2>&1 || true
printf '✓ Diagnóstico V3 terminado. Producción no fue modificada.\n'

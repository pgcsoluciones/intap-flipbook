#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/pgcsoluciones/intap-flipbook.git"
SOURCE_SHA="d2221c5d988c00a819c966c5c49c7cac9f1f5482"
API_URL="https://intap-flipbook-api-preview.fliaprince.workers.dev"
QA_ORIGIN="https://studio.flip.intaprd.com"
WRANGLER="${WRANGLER:-$HOME/intap-flipbook-dynamic-markers/node_modules/.bin/wrangler}"
TMP_DIR="$(mktemp -d /tmp/intap-login-diag.XXXXXX)"
TAIL_PID=""
cleanup() {
  if [ -n "$TAIL_PID" ]; then kill "$TAIL_PID" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() { echo "ERROR: $*" >&2; exit 1; }
[ -x "$WRANGLER" ] || fail "No se encontró Wrangler en $WRANGLER"

printf '\n======================================================\n'
printf ' INTAP · DIAGNÓSTICO 500 LOGIN PREVIEW\n'
printf '======================================================\n\n'

git clone --no-checkout "$REPO" "$TMP_DIR/repo" >/dev/null 2>&1
cd "$TMP_DIR/repo"
git checkout --detach "$SOURCE_SHA" >/dev/null 2>&1
[ "$(git rev-parse HEAD)" = "$SOURCE_SHA" ] || fail "Commit inesperado"

QA_EMAIL="qa-login-diag-$(date +%s)-$RANDOM@example.test"
QA_PASSWORD="Kawvo-QA-$(date +%s)-Aa9!"
BODY="$(printf '{\"email\":\"%s\",\"password\":\"%s\",\"name\":\"QA Login Diagnostics\"}' "$QA_EMAIL" "$QA_PASSWORD")"

printf '=== 1. INICIAR TAIL DE API PREVIEW ===\n'
"$WRANGLER" tail --config apps/api/wrangler.toml --env preview --format json >"$TMP_DIR/tail.log" 2>&1 &
TAIL_PID=$!
sleep 4

printf '=== 2. REPRODUCIR /auth/register ===\n'
STATUS="$(curl -sS -o "$TMP_DIR/response.txt" -D "$TMP_DIR/headers.txt" -w '%{http_code}' \
  -X POST "$API_URL/auth/register" \
  -H "Origin: $QA_ORIGIN" \
  -H 'Content-Type: application/json' \
  --data "$BODY" || true)"
printf 'HTTP %s\n' "$STATUS"
printf '\n--- RESPUESTA ---\n'
cat "$TMP_DIR/response.txt" || true
printf '\n\n--- HEADERS ---\n'
cat "$TMP_DIR/headers.txt" || true
sleep 3

kill "$TAIL_PID" >/dev/null 2>&1 || true
wait "$TAIL_PID" >/dev/null 2>&1 || true
TAIL_PID=""

printf '\n--- WRANGLER TAIL ---\n'
cat "$TMP_DIR/tail.log" || true

printf '\n=== 3. LIMPIEZA DEFENSIVA QA ===\n'
"$WRANGLER" d1 execute pgc-landing-saas-db \
  --config apps/api/wrangler.toml --env preview --remote \
  --command "DELETE FROM users WHERE email = '$QA_EMAIL';" >/dev/null 2>&1 || true
printf '✓ Diagnóstico terminado. Producción no fue modificada.\n'

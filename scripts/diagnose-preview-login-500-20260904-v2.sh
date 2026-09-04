#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/pgcsoluciones/intap-flipbook.git"
SOURCE_SHA="d2221c5d988c00a819c966c5c49c7cac9f1f5482"
API_URL="https://intap-flipbook-api-preview.fliaprince.workers.dev"
QA_ORIGIN="https://studio.flip.intaprd.com"
WRANGLER="${WRANGLER:-$HOME/intap-flipbook-dynamic-markers/node_modules/.bin/wrangler}"
TMP_DIR="$(mktemp -d /tmp/intap-login-diag-v2.XXXXXX)"
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
printf ' INTAP · DIAGNÓSTICO 500 LOGIN PREVIEW · V2\n'
printf '======================================================\n\n'

git clone --no-checkout "$REPO" "$TMP_DIR/repo" >/dev/null 2>&1
cd "$TMP_DIR/repo"
git checkout --detach "$SOURCE_SHA" >/dev/null 2>&1
[ "$(git rev-parse HEAD)" = "$SOURCE_SHA" ] || fail "Commit inesperado"

printf '=== 1. VERIFICAR ESQUEMA USERS EN D1 PREVIEW ===\n'
"$WRANGLER" d1 execute pgc-landing-saas-db \
  --config apps/api/wrangler.toml --env preview --remote \
  --command "PRAGMA table_info(users);" | tee "$TMP_DIR/users-schema.txt"

for col in id email password_hash name slug; do
  grep -Eq "[\"']name[\"']:[[:space:]]*[\"']$col[\"']|\b$col\b" "$TMP_DIR/users-schema.txt" \
    || fail "La columna users.$col no aparece en D1 Preview"
done
printf '✓ Columnas mínimas de registro presentes\n'

QA_EMAIL="qa-login-diag2-$(date +%s)-$RANDOM@example.test"
QA_PASSWORD="Kawvo-QA-$(date +%s)-Aa9!"
BODY="$(printf '{\"email\":\"%s\",\"password\":\"%s\",\"name\":\"QA Login Diagnostics V2\"}' "$QA_EMAIL" "$QA_PASSWORD")"

printf '\n=== 2. INICIAR TAIL Y ESPERAR CONEXIÓN ===\n'
"$WRANGLER" tail --config apps/api/wrangler.toml --env preview --format pretty >"$TMP_DIR/tail.log" 2>&1 &
TAIL_PID=$!

TAIL_READY=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if ! kill -0 "$TAIL_PID" >/dev/null 2>&1; then
    break
  fi
  if grep -Eqi 'Successfully created tail|Connected to|Listening|tail created|Waiting for logs' "$TMP_DIR/tail.log"; then
    TAIL_READY=1
    break
  fi
  sleep 1
done

printf '%s\n' '--- Estado inicial del tail ---'
cat "$TMP_DIR/tail.log" || true
if [ "$TAIL_READY" -eq 0 ]; then
  printf 'AVISO: no apareció confirmación explícita del tail; se esperarán 5 segundos adicionales.\n'
  sleep 5
fi

printf '\n=== 3. PROBAR ENDPOINTS PREVIOS AL HASH ===\n'
ROOT_STATUS="$(curl -sS -o "$TMP_DIR/root.txt" -w '%{http_code}' "$API_URL/" || true)"
printf 'GET / -> HTTP %s\n' "$ROOT_STATUS"

WEAK_EMAIL="qa-login-diag-weak-$(date +%s)-$RANDOM@example.test"
WEAK_STATUS="$(curl -sS -o "$TMP_DIR/weak.txt" -w '%{http_code}' \
  -X POST "$API_URL/auth/register" \
  -H "Origin: $QA_ORIGIN" \
  -H 'Content-Type: application/json' \
  --data "{\"email\":\"$WEAK_EMAIL\",\"password\":\"12345678\"}" || true)"
printf 'POST /auth/register contraseña débil -> HTTP %s\n' "$WEAK_STATUS"
printf 'Respuesta débil: '; cat "$TMP_DIR/weak.txt" || true; printf '\n'
[ "$WEAK_STATUS" = "400" ] || printf 'AVISO: la ruta falla incluso antes de ejecutar el hash.\n'

printf '\n=== 4. REPRODUCIR REGISTRO FUERTE ===\n'
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

printf '\nEsperando eventos del Worker...\n'
sleep 12

if [ -n "$TAIL_PID" ]; then
  kill "$TAIL_PID" >/dev/null 2>&1 || true
  wait "$TAIL_PID" >/dev/null 2>&1 || true
  TAIL_PID=""
fi

printf '\n--- WRANGLER TAIL COMPLETO ---\n'
cat "$TMP_DIR/tail.log" || true

printf '\n=== 5. COMPROBAR SI D1 LLEGÓ A CREAR EL USUARIO ===\n'
ESCAPED_EMAIL="${QA_EMAIL//\'/\'\'}"
"$WRANGLER" d1 execute pgc-landing-saas-db \
  --config apps/api/wrangler.toml --env preview --remote \
  --command "SELECT id,email,length(password_hash) AS hash_len,substr(password_hash,1,8) AS hash_prefix,slug FROM users WHERE email = '$ESCAPED_EMAIL';" \
  | tee "$TMP_DIR/user-after.txt"

printf '\n=== 6. LIMPIEZA DEFENSIVA QA ===\n'
"$WRANGLER" d1 execute pgc-landing-saas-db \
  --config apps/api/wrangler.toml --env preview --remote \
  --command "DELETE FROM users WHERE email = '$ESCAPED_EMAIL' OR email = '$WEAK_EMAIL';" >/dev/null 2>&1 || true
printf '✓ Diagnóstico terminado. Producción no fue modificada.\n'

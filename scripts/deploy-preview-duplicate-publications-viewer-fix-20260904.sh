#!/usr/bin/env bash
set -euo pipefail

SOURCE_SHA="f46e66c4153edbbfd7a5a6754f2bf90ff04aa165"
SOURCE_BRANCH="deploy/preview-duplicate-publications-20260901"
API_URL="https://intap-flipbook-api-preview.fliaprince.workers.dev"
VIEWER_URL="https://37f0263c.intap-flipbook-viewer.pages.dev"
DASHBOARD_PROJECT="intap-flipbook-dashboard"
DASHBOARD_BRANCH="qa-duplicate-publications-20260901"
WRANGLER="${WRANGLER:-$HOME/intap-flipbook-dynamic-markers/node_modules/.bin/wrangler}"
TMP_DIR="$(mktemp -d /tmp/intap-preview-viewer-fix.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -x "$WRANGLER" ] || fail "No se encontró Wrangler en $WRANGLER"

printf '\n======================================================\n'
printf ' INTAP · PREVIEW DUPLICACIÓN · VIEWER FIX\n'
printf '======================================================\n\n'

printf '=== 1. CLON AISLADO DEL CANDIDATO YA VALIDADO ===\n'
git clone --depth 1 --branch "$SOURCE_BRANCH" \
  https://github.com/pgcsoluciones/intap-flipbook.git "$TMP_DIR/repo"
cd "$TMP_DIR/repo"
ACTUAL_SHA="$(git rev-parse HEAD)"
printf 'Commit esperado: %s\n' "$SOURCE_SHA"
printf 'Commit clonado:  %s\n' "$ACTUAL_SHA"
[ "$ACTUAL_SHA" = "$SOURCE_SHA" ] || fail "La rama de Preview cambió; se cancela para no desplegar código distinto."

printf '\n=== 2. DEPENDENCIAS TEMPORALES ===\n'
npm ci --ignore-scripts

printf '\n=== 3. BUILD DASHBOARD EN MODO PREVIEW REAL ===\n'
VITE_API_BASE_URL="$API_URL" \
VITE_VIEWER_BASE_URL="$VIEWER_URL" \
VITE_VIEWER_PREVIEW="1" \
npm --prefix apps/dashboard run build

printf '\n=== 4. AUDITAR BUILD ===\n'
ASSETS="apps/dashboard/dist/assets"
grep -Rqs "$API_URL" "$ASSETS" || fail "El build no contiene API Preview."
grep -Rqs "$VIEWER_URL" "$ASSETS" || fail "El build no contiene el Viewer Preview inmutable."
grep -Rqs "preview_token" "$ASSETS" || fail "El build no contiene el flujo de preview_token."
grep -Rqs "api_base" "$ASSETS" || fail "El build no contiene el api_base del Viewer Preview."
if grep -Rqs "http://localhost:8787" "$ASSETS"; then
  fail "El build contiene localhost:8787."
fi
printf '✓ API Preview fijada\n'
printf '✓ Viewer Preview inmutable fijado\n'
printf '✓ Modo preview con token habilitado\n'
printf '✓ Sin localhost\n'

printf '\n=== 5. DEPLOY SOLO DASHBOARD PREVIEW ===\n'
"$WRANGLER" pages deploy apps/dashboard/dist \
  --project-name="$DASHBOARD_PROJECT" \
  --branch="$DASHBOARD_BRANCH"

printf '\n======================================================\n'
printf ' DASHBOARD PREVIEW CORREGIDO\n'
printf '======================================================\n'
printf 'API:    %s\n' "$API_URL"
printf 'Viewer: %s\n' "$VIEWER_URL"
printf 'Producción no fue modificada.\n\n'

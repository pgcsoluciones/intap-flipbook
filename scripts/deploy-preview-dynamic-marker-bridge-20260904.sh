#!/usr/bin/env bash
set -euo pipefail

SOURCE_SHA="3628507f4353424fb5be7c2435e94ae6cef76567"
REPO="https://github.com/pgcsoluciones/intap-flipbook.git"
API_URL="https://intap-flipbook-api-preview.fliaprince.workers.dev"
VIEWER_PROJECT="intap-flipbook-viewer"
VIEWER_BRANCH="qa-duplicate-publications-viewer-20260904"
DASHBOARD_PROJECT="intap-flipbook-dashboard"
DASHBOARD_BRANCH="qa-duplicate-publications-20260901"
WRANGLER="${WRANGLER:-$HOME/intap-flipbook-dynamic-markers/node_modules/.bin/wrangler}"
TMP_DIR="$(mktemp -d /tmp/intap-preview-marker-bridge.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -x "$WRANGLER" ] || fail "No se encontró Wrangler en $WRANGLER"

printf '\n======================================================\n'
printf ' INTAP · PREVIEW · FICHAS DINÁMICAS EN BORRADOR\n'
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

printf '\n=== 3. QA LOCAL DEL VIEWER ===\n'
node --check apps/viewer/src/previewDynamicMarkerFetchBridge.js
node --test apps/viewer/tests/*.test.mjs

grep -q 'previewDynamicMarkerFetchBridge.js' apps/viewer/src/index.html \
  || fail "index.html no carga el bridge Preview."
grep -q '/view/preview/' apps/viewer/src/previewDynamicMarkerFetchBridge.js \
  || fail "El bridge no usa el payload autenticado de Preview."

printf '✓ Sintaxis del bridge válida\n'
printf '✓ Tests del Viewer aprobados\n'
printf '✓ Bridge read-only de fichas Preview confirmado\n'

printf '\n=== 4. DEPLOY SOLO VIEWER PREVIEW ===\n'
DEPLOY_OUTPUT="$TMP_DIR/viewer-deploy.txt"
"$WRANGLER" pages deploy apps/viewer/src \
  --project-name="$VIEWER_PROJECT" \
  --branch="$VIEWER_BRANCH" | tee "$DEPLOY_OUTPUT"

VIEWER_URL="$(grep -Eo 'https://[a-f0-9]+\.intap-flipbook-viewer\.pages\.dev' "$DEPLOY_OUTPUT" | tail -n 1)"
[ -n "$VIEWER_URL" ] || fail "No pude detectar la URL inmutable del Viewer Preview."
printf 'Viewer Preview nuevo: %s\n' "$VIEWER_URL"

printf '\n=== 5. VERIFICAR VIEWER REMOTO ===\n'
curl -fsSL "$VIEWER_URL/previewDynamicMarkerFetchBridge.js?v=preview-dynamic-markers-20260904" \
  | grep -q '/view/preview/' \
  || fail "El Viewer remoto no expone el bridge esperado."
curl -fsSL "$VIEWER_URL/" \
  | grep -q 'previewDynamicMarkerFetchBridge.js' \
  || fail "El HTML remoto no carga el bridge."
printf '✓ Viewer Preview remoto confirmado\n'

printf '\n=== 6. BUILD DASHBOARD CONTRA VIEWER NUEVO ===\n'
VITE_API_BASE_URL="$API_URL" \
VITE_VIEWER_BASE_URL="$VIEWER_URL" \
VITE_VIEWER_PREVIEW="1" \
npm --prefix apps/dashboard run build

printf '\n=== 7. AUDITAR BUILD DASHBOARD ===\n'
ASSETS="apps/dashboard/dist/assets"
grep -Rqs "$API_URL" "$ASSETS" || fail "El build no contiene API Preview."
grep -Rqs "$VIEWER_URL" "$ASSETS" || fail "El build no contiene el Viewer Preview nuevo."
grep -Rqs 'preview_token' "$ASSETS" || fail "Falta preview_token."
grep -Rqs 'api_base' "$ASSETS" || fail "Falta api_base."
if grep -Rqs 'http://localhost:8787' "$ASSETS"; then
  fail "El build contiene localhost:8787."
fi
printf '✓ API Preview fijada\n'
printf '✓ Viewer Preview nuevo fijado\n'
printf '✓ Token de borrador habilitado\n'
printf '✓ Sin localhost\n'

printf '\n=== 8. DEPLOY SOLO DASHBOARD PREVIEW ===\n'
"$WRANGLER" pages deploy apps/dashboard/dist \
  --project-name="$DASHBOARD_PROJECT" \
  --branch="$DASHBOARD_BRANCH"

printf '\n======================================================\n'
printf ' PREVIEW LISTO PARA REQA DE FICHAS DINÁMICAS\n'
printf '======================================================\n'
printf 'API:    %s\n' "$API_URL"
printf 'Viewer: %s\n' "$VIEWER_URL"
printf 'Producción no fue modificada.\n\n'

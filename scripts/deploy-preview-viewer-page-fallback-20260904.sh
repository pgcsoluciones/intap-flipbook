#!/usr/bin/env bash
set -euo pipefail

SOURCE_SHA="228b10a2aba7867cfec12d97261c74270f2fa01d"
SOURCE_BRANCH="fix/preview-viewer-routing-20260904"
API_URL="https://intap-flipbook-api-preview.fliaprince.workers.dev"
VIEWER_PROJECT="intap-flipbook-viewer"
VIEWER_BRANCH="qa-duplicate-publications-viewer-20260904"
DASHBOARD_PROJECT="intap-flipbook-dashboard"
DASHBOARD_BRANCH="qa-duplicate-publications-20260901"
WRANGLER="${WRANGLER:-$HOME/intap-flipbook-dynamic-markers/node_modules/.bin/wrangler}"
TMP_DIR="$(mktemp -d /tmp/intap-preview-page-fallback.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -x "$WRANGLER" ] || fail "No se encontró Wrangler en $WRANGLER"

printf '\n======================================================\n'
printf ' INTAP · PREVIEW · FALLBACK DE PÁGINAS DEL VIEWER\n'
printf '======================================================\n\n'

printf '=== 1. CLON AISLADO DEL CANDIDATO ===\n'
git clone --depth 20 --branch "$SOURCE_BRANCH" \
  https://github.com/pgcsoluciones/intap-flipbook.git "$TMP_DIR/repo"
cd "$TMP_DIR/repo"
git checkout --detach "$SOURCE_SHA"
ACTUAL_SHA="$(git rev-parse HEAD)"
printf 'Commit esperado: %s\n' "$SOURCE_SHA"
printf 'Commit usado:     %s\n' "$ACTUAL_SHA"
[ "$ACTUAL_SHA" = "$SOURCE_SHA" ] || fail "El commit no coincide; se cancela."

printf '\n=== 2. DEPENDENCIAS TEMPORALES ===\n'
npm ci --ignore-scripts

printf '\n=== 3. QA LOCAL DEL VIEWER ANTES DE DESPLEGAR ===\n'
node --check apps/viewer/src/viewerRuntime.js
node --test apps/viewer/tests/*.test.mjs

grep -q "en Preview privilegiamos el archivo fuente" apps/viewer/src/viewerRuntime.js \
  || fail "No está presente el fallback de imagen fuente para Preview."
grep -q "preview-page-source-fallback-20260904" apps/viewer/src/index.html \
  || fail "No está presente el cache-bust del runtime corregido."
printf '✓ Runtime válido\n'
printf '✓ Tests del Viewer aprobados\n'
printf '✓ Fallback Preview confirmado\n'

printf '\n=== 4. DEPLOY SOLO VIEWER PREVIEW ===\n'
VIEWER_LOG="$TMP_DIR/viewer-deploy.log"
"$WRANGLER" pages deploy apps/viewer/src \
  --project-name="$VIEWER_PROJECT" \
  --branch="$VIEWER_BRANCH" 2>&1 | tee "$VIEWER_LOG"

VIEWER_URL="$(grep -Eo 'https://[0-9a-f]{8,}\.intap-flipbook-viewer\.pages\.dev' "$VIEWER_LOG" | tail -1)"
[ -n "$VIEWER_URL" ] || fail "No pude identificar la URL inmutable del Viewer Preview."
printf 'Viewer Preview nuevo: %s\n' "$VIEWER_URL"

printf '\n=== 5. VERIFICAR VIEWER DESPLEGADO ===\n'
RUNTIME_REMOTE="$TMP_DIR/viewerRuntime.remote.js"
for i in $(seq 1 20); do
  if curl -fsSL "$VIEWER_URL/viewerRuntime.js?v=preview-page-source-fallback-20260904" -o "$RUNTIME_REMOTE"; then
    if grep -q "en Preview privilegiamos el archivo fuente" "$RUNTIME_REMOTE"; then
      break
    fi
  fi
  sleep 2
done
grep -q "en Preview privilegiamos el archivo fuente" "$RUNTIME_REMOTE" \
  || fail "El Viewer remoto no contiene el runtime corregido."
printf '✓ Viewer Preview remoto confirmado\n'

printf '\n=== 6. BUILD DASHBOARD APUNTANDO AL NUEVO VIEWER ===\n'
VITE_API_BASE_URL="$API_URL" \
VITE_VIEWER_BASE_URL="$VIEWER_URL" \
VITE_VIEWER_PREVIEW="1" \
npm --prefix apps/dashboard run build

printf '\n=== 7. AUDITAR BUILD DEL DASHBOARD ===\n'
ASSETS="apps/dashboard/dist/assets"
grep -Rqs "$API_URL" "$ASSETS" || fail "El Dashboard no contiene API Preview."
grep -Rqs "$VIEWER_URL" "$ASSETS" || fail "El Dashboard no contiene el Viewer Preview nuevo."
grep -Rqs "preview_token" "$ASSETS" || fail "Falta preview_token en el build."
grep -Rqs "api_base" "$ASSETS" || fail "Falta api_base en el build."
if grep -Rqs "http://localhost:8787" "$ASSETS"; then
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
printf ' PREVIEW CORREGIDO PARA REQA DE NAVEGACIÓN\n'
printf '======================================================\n'
printf 'API:    %s\n' "$API_URL"
printf 'Viewer: %s\n' "$VIEWER_URL"
printf 'Producción no fue modificada.\n\n'

#!/usr/bin/env bash
set -euo pipefail

EXPECTED_BRANCH="audit/viewer-load-resilience-20260831"
PREVIEW_BRANCH="qa-viewer-resilience-20260831"
PROJECT_NAME="intap-flipbook-viewer"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]; then
  echo "ERROR: rama actual: $CURRENT_BRANCH"
  echo "Este script solo puede ejecutarse desde: $EXPECTED_BRANCH"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: el worktree tiene cambios sin commit. No se desplegara Preview."
  git status --short
  exit 1
fi

echo "Rama verificada: $CURRENT_BRANCH"
echo "Commit: $(git rev-parse HEAD)"
echo "Destino: Cloudflare Pages Preview branch $PREVIEW_BRANCH"
echo

echo "=== VALIDACION VIEWER ==="
node --check apps/viewer/src/flipbook.js
node --check apps/viewer/src/viewerRuntime.js
node --test apps/viewer/tests/*.test.mjs

echo
echo "=== VERIFICAR SESION CLOUDFLARE ==="
(
  cd apps/viewer
  npx --yes wrangler@3.65.0 whoami
)

echo
echo "=== DEPLOY PREVIEW AISLADO ==="
(
  cd apps/viewer
  npx --yes wrangler@3.65.0 pages deploy src \
    --project-name="$PROJECT_NAME" \
    --branch="$PREVIEW_BRANCH" \
    --commit-dirty=true
)

echo
echo "Preview desplegado. Produccion no fue modificada."

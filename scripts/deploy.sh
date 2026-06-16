#!/bin/bash
# =============================================================================
# Intap Flipbook — Script de Deploy a Producción
# Ejecutar desde la raíz del proyecto: bash scripts/deploy.sh
# Requiere: wrangler autenticado (wrangler login)
# =============================================================================

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ─── PASO 1: Crear recursos Cloudflare (solo primera vez) ────────────────────
setup_cloudflare_resources() {
  info "Creando recursos Cloudflare..."

  # D1
  info "Creando base de datos D1..."
  D1_OUTPUT=$(wrangler d1 create intap-flipbook-db 2>&1 || true)
  D1_ID=$(echo "$D1_OUTPUT" | grep -oP 'database_id = "\K[^"]+' || true)
  if [ -z "$D1_ID" ]; then
    warn "D1 ya existe o no se pudo crear. Obteniendo ID existente..."
    D1_ID=$(wrangler d1 list --json 2>/dev/null | python3 -c "import sys,json; dbs=json.load(sys.stdin); [print(d['uuid']) for d in dbs if d['name']=='intap-flipbook-db']" 2>/dev/null || true)
  fi
  echo "D1_ID=$D1_ID"

  # KV
  info "Creando KV namespace..."
  KV_OUTPUT=$(wrangler kv namespace create SESSIONS 2>&1 || true)
  KV_ID=$(echo "$KV_OUTPUT" | grep -oP 'id = "\K[^"]+' || true)
  if [ -z "$KV_ID" ]; then
    warn "KV ya existe. Obteniendo ID existente..."
    KV_ID=$(wrangler kv namespace list --json 2>/dev/null | python3 -c "import sys,json; ns=json.load(sys.stdin); [print(n['id']) for n in ns if 'SESSIONS' in n['title']]" 2>/dev/null || true)
  fi
  echo "KV_ID=$KV_ID"

  # R2
  info "Creando R2 bucket..."
  wrangler r2 bucket create intap-flipbook-media 2>&1 || warn "R2 bucket ya existe."

  # Actualizar wrangler.toml con IDs reales
  if [ -n "$D1_ID" ] && [ -n "$KV_ID" ]; then
    info "Actualizando wrangler.toml con IDs reales..."
    sed -i "s/REPLACE_WITH_YOUR_D1_DATABASE_ID/$D1_ID/" "$ROOT/apps/api/wrangler.toml"
    sed -i "s/REPLACE_WITH_YOUR_KV_NAMESPACE_ID/$KV_ID/" "$ROOT/apps/api/wrangler.toml"
    info "wrangler.toml actualizado."
  else
    error "No se pudieron obtener los IDs. Actualiza manualmente apps/api/wrangler.toml"
  fi
}

# ─── PASO 2: Aplicar schema D1 ───────────────────────────────────────────────
apply_schema() {
  info "Aplicando schema D1..."
  wrangler d1 execute intap-flipbook-db \
    --file="$ROOT/apps/api/src/db/schema.sql" \
    --remote
  info "Schema aplicado."

  # Migración size_bytes si ya existía la DB
  if [ -f "$ROOT/apps/api/src/db/migrations/001_add_size_bytes.sql" ]; then
    warn "Aplicando migración 001_add_size_bytes (ignorar error si ya existe la columna)..."
    wrangler d1 execute intap-flipbook-db \
      --file="$ROOT/apps/api/src/db/migrations/001_add_size_bytes.sql" \
      --remote 2>/dev/null || true
  fi
}

# ─── PASO 3: Configurar secrets ──────────────────────────────────────────────
configure_secrets() {
  info "Configurando JWT_SECRET..."
  JWT_SECRET=$(openssl rand -hex 32)
  echo "$JWT_SECRET" | wrangler secret put JWT_SECRET --name intap-flipbook-api
  info "JWT_SECRET configurado."
}

# ─── PASO 4: Deploy API Worker ───────────────────────────────────────────────
deploy_api() {
  info "Desplegando API Worker..."
  cd "$ROOT/apps/api"
  npm install --silent
  wrangler deploy
  info "API desplegada en: https://intap-flipbook-api.YOUR_SUBDOMAIN.workers.dev"
}

# ─── PASO 5: Deploy Dashboard ────────────────────────────────────────────────
deploy_dashboard() {
  info "Desplegando Dashboard (React/Vite)..."
  cd "$ROOT/apps/dashboard"
  npm install --silent
  npm run build
  wrangler pages deploy dist \
    --project-name=intap-flipbook-dashboard \
    --commit-dirty=true
  info "Dashboard desplegado."
}

# ─── PASO 6: Deploy Viewer ───────────────────────────────────────────────────
deploy_viewer() {
  info "Desplegando Viewer público..."
  cd "$ROOT/apps/viewer"
  wrangler pages deploy src \
    --project-name=intap-flipbook-viewer \
    --commit-dirty=true
  info "Viewer desplegado."
}

# ─── MAIN ────────────────────────────────────────────────────────────────────
case "${1:-all}" in
  resources) setup_cloudflare_resources ;;
  schema)    apply_schema ;;
  secrets)   configure_secrets ;;
  api)       deploy_api ;;
  dashboard) deploy_dashboard ;;
  viewer)    deploy_viewer ;;
  all)
    setup_cloudflare_resources
    apply_schema
    configure_secrets
    deploy_api
    deploy_dashboard
    deploy_viewer
    echo ""
    info "✅ Deploy completo. Próximos pasos:"
    echo "   1. Configura dominios en Cloudflare Dashboard:"
    echo "      api.intapflipbook.com  → Worker intap-flipbook-api"
    echo "      app.intapflipbook.com  → Pages intap-flipbook-dashboard"
    echo "      view.intapflipbook.com → Pages intap-flipbook-viewer"
    echo "   2. Actualiza CORS_ORIGIN en wrangler.toml con el dominio real del dashboard"
    echo "   3. Actualiza VITE_API_BASE_URL en apps/dashboard/wrangler.toml"
    ;;
  *) error "Uso: bash scripts/deploy.sh [resources|schema|secrets|api|dashboard|viewer|all]" ;;
esac

#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$HOME/intap-flipbook-dynamic-markers}"
WRANGLER="${WRANGLER:-$REPO_ROOT/node_modules/.bin/wrangler}"
CONFIG="$REPO_ROOT/apps/api/wrangler.toml"
DB_NAME="pgc-landing-saas-db"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -x "$WRANGLER" ] || fail "No se encontró Wrangler en $WRANGLER"
[ -f "$CONFIG" ] || fail "No se encontró $CONFIG"

printf '\n======================================================\n'
printf ' INTAP FLIPBOOK · TENANTS PREVIEW → PRO\n'
printf '======================================================\n\n'

printf '=== 1. CONFIRMAR PLAN PRO EN D1 PREVIEW ===\n'
PLAN_CHECK="$($WRANGLER d1 execute "$DB_NAME" \
  --config "$CONFIG" \
  --env preview \
  --remote \
  --command "SELECT id, name, max_publications FROM plans WHERE id = 'pro';")"
printf '%s\n' "$PLAN_CHECK"
printf '%s\n' "$PLAN_CHECK" | grep -qE '(^|[^[:alnum:]_])pro([^[:alnum:]_]|$)' || fail "El plan pro no existe en Preview; no se modificó ningún usuario."

printf '\n=== 2. AUDITORÍA PREVIA ===\n'
$WRANGLER d1 execute "$DB_NAME" \
  --config "$CONFIG" \
  --env preview \
  --remote \
  --command "
    SELECT plan_id, COUNT(*) AS tenants
    FROM users
    WHERE COALESCE(is_admin, 0) = 0
    GROUP BY plan_id
    ORDER BY plan_id;
  "

printf '\n=== 3. ELEVAR TODOS LOS TENANTS DE PREVIEW A PRO ===\n'
$WRANGLER d1 execute "$DB_NAME" \
  --config "$CONFIG" \
  --env preview \
  --remote \
  --command "
    UPDATE users
    SET plan_id = 'pro',
        plan_expires_at = NULL
    WHERE COALESCE(is_admin, 0) = 0;
  "

printf '\n=== 4. VERIFICACIÓN ESTRICTA ===\n'
VERIFY="$($WRANGLER d1 execute "$DB_NAME" \
  --config "$CONFIG" \
  --env preview \
  --remote \
  --command "
    SELECT plan_id, COUNT(*) AS tenants
    FROM users
    WHERE COALESCE(is_admin, 0) = 0
    GROUP BY plan_id
    ORDER BY plan_id;

    SELECT COUNT(*) AS non_pro_tenants
    FROM users
    WHERE COALESCE(is_admin, 0) = 0
      AND COALESCE(plan_id, '') <> 'pro';
  ")"
printf '%s\n' "$VERIFY"

NON_PRO="$(printf '%s\n' "$VERIFY" | awk '/non_pro_tenants/{getline; print}' | tr -dc '0-9' | head -c 20)"
if [ -z "$NON_PRO" ]; then
  # Wrangler table formatting can vary; use a second scalar-friendly guard.
  SCALAR="$($WRANGLER d1 execute "$DB_NAME" \
    --config "$CONFIG" \
    --env preview \
    --remote \
    --json \
    --command "SELECT COUNT(*) AS non_pro_tenants FROM users WHERE COALESCE(is_admin,0)=0 AND COALESCE(plan_id,'') <> 'pro';")"
  NON_PRO="$(printf '%s' "$SCALAR" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const rows=j?.[0]?.results||j?.results||[];process.stdout.write(String(rows?.[0]?.non_pro_tenants ?? ''));});")"
fi

[ "$NON_PRO" = "0" ] || fail "La verificación detectó $NON_PRO tenant(s) que no quedaron en pro."

printf '\n✓ Todos los tenants no-admin de D1 Preview están en plan pro.\n'
printf '✓ plan_expires_at quedó sin vencimiento para este QA.\n'
printf '✓ Producción no fue modificada.\n'
printf '\n======================================================\n'
printf ' PREVIEW LISTO PARA QA DE DUPLICACIÓN\n'
printf '======================================================\n\n'

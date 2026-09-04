#!/usr/bin/env bash
set -euo pipefail
TMP_SCRIPT="$(mktemp /tmp/intap-login-hardening-run.XXXXXX.sh)"
trap 'rm -f "$TMP_SCRIPT"' EXIT
curl -fsSL "https://raw.githubusercontent.com/pgcsoluciones/intap-flipbook/875df972fedc7347009b76ba3fcfb12d41a1db27/scripts/deploy-preview-login-hardening-20260904.sh" > "$TMP_SCRIPT"
sed -i.bak 's/d2221c5d988c00a819c966c5c49c7cac9f1f5482/f01031d760aa099ce32d0f23e04526c5ac422d9d/g' "$TMP_SCRIPT"
rm -f "$TMP_SCRIPT.bak"
grep -q 'f01031d760aa099ce32d0f23e04526c5ac422d9d' "$TMP_SCRIPT"
bash "$TMP_SCRIPT"

#!/usr/bin/env bash
# Borra datos operativos vía API admin (conserva users y clientes).
# Uso:
#   ./scripts/reset-operacional.sh http://127.0.0.1:8001 admin admin123
#   ./scripts/reset-operacional.sh https://agropack-api.onrender.com USUARIO CLAVE
set -euo pipefail

API="${1:-http://127.0.0.1:8001}"
USER="${2:-admin}"
PASS="${3:-admin123}"
API="${API%/}"

echo "API: $API"
echo "Usuario: $USER"
echo ""
echo "⚠  Esto BORRA recepciones, desverdizado, empaques, inventarios y embarques."
echo "   Conserva: usuarios y clientes."
read -r -p "Escribe RESET_OPERACIONAL para continuar: " CONF
if [[ "$CONF" != "RESET_OPERACIONAL" ]]; then
  echo "Cancelado."
  exit 1
fi

TOKEN=$(curl -sS -X POST "$API/api/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=${USER}&password=${PASS}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")

if [[ -z "$TOKEN" ]]; then
  echo "❌ No se pudo obtener token (usuario/clave o API incorrectos)."
  exit 1
fi

echo "→ Ejecutando reset..."
curl -sS -X POST "$API/api/correcciones/reset-operacional" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirm":"RESET_OPERACIONAL"}' | python3 -m json.tool

echo ""
echo "Listo."

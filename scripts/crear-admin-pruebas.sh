#!/usr/bin/env bash
# Crea el primer usuario admin en la API LOCAL (BD de pruebas vacía).
set -euo pipefail
API="${1:-http://127.0.0.1:8001}"

echo "Creando admin en $API ..."
curl -sS -X POST "$API/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123",
    "nombre_completo": "Admin Pruebas",
    "rol": "admin"
  }' | python3 -m json.tool 2>/dev/null || true

echo ""
echo "Login: usuario=admin  contraseña=admin123"
echo "Solo funciona si la BD de pruebas no tenía usuarios aún."

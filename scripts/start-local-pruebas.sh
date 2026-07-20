#!/usr/bin/env bash
# Arranca AgroPack en LOCAL con BD de pruebas (no toca Render/producción).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "════════════════════════════════════════════"
echo "  AgroPack LOCAL — pruebas (SQLite)"
echo "  BD: backend/agropack_pruebas.db"
echo "  API: http://127.0.0.1:8001"
echo "  Web: http://127.0.0.1:5173"
echo "════════════════════════════════════════════"

# Backend
if [[ ! -d backend/.venv ]]; then
  echo "→ Creando venv backend..."
  python3 -m venv backend/.venv
  # shellcheck disable=SC1091
  source backend/.venv/bin/activate
  pip install -r backend/requirements.txt
else
  # shellcheck disable=SC1091
  source backend/.venv/bin/activate
fi

# Asegurar .env de pruebas
if [[ ! -f backend/.env ]]; then
  cat > backend/.env <<'EOF'
SECRET_KEY=local-pruebas-agropack-no-usar-en-prod
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
DEBUG=true
DATABASE_URL=sqlite:///./agropack_pruebas.db
EOF
  echo "→ Creado backend/.env (SQLite pruebas)"
fi

# Frontend .env.local
if [[ ! -f frontend/.env.local ]]; then
  echo "VITE_API_URL=http://127.0.0.1:8001" > frontend/.env.local
  echo "→ Creado frontend/.env.local"
fi

if [[ ! -d frontend/node_modules ]]; then
  echo "→ npm install frontend..."
  (cd frontend && npm install)
fi

cleanup() {
  echo ""
  echo "Deteniendo servicios locales..."
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

echo "→ API (puerto 8001)..."
(
  cd backend
  # shellcheck disable=SC1091
  source .venv/bin/activate
  uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
) &
API_PID=$!

echo "→ Web (puerto 5173)..."
(
  cd frontend
  npm run dev -- --host 127.0.0.1 --port 5173
) &
WEB_PID=$!

echo ""
echo "Listo. Abre: http://127.0.0.1:5173"
echo ""
echo "Primer uso (BD vacía):"
echo "  1. En la app no hay usuarios → usa el registro o:"
echo "     curl -s -X POST http://127.0.0.1:8001/api/auth/register \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"username\":\"admin\",\"password\":\"admin123\",\"nombre_completo\":\"Admin Pruebas\",\"rol\":\"admin\"}'"
echo "  2. Login: admin / admin123"
echo ""
echo "Borrar datos de prueba:  rm backend/agropack_pruebas.db"
echo "Ctrl+C para detener."
echo ""

wait

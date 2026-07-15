# 🌱 AgroPack Llano

Sistema de control de inventarios para empaque y embarques de uva.

## Descripción

Plataforma full-stack para la gestión de operaciones de un centro de empaque de uva de mesa:

- **Recepción**: Registro de ingreso de fruta desde el campo (cajas de campo) o recepciones directas en cartón.
- **Empaque**: Control del proceso de empaque, consumo de cajas de campo y generación de cajas de cartón listas para embarque.
- **Parrillas**: Gestión de configuración de parrillas/pallets.
- **Embarques**: Creación de embarques (contenedores) con soporte para **múltiples variedades y tipos de cultivo** por embarque, con validación de stock.
- **Reportes e Inventario**: Dashboard con inventario actual (campo y cartón final) y historial reciente de embarques.

## Stack

**Backend**
- FastAPI + SQLAlchemy + Alembic
- SQLite (desarrollo) / PostgreSQL (producción futura)
- Pydantic schemas + JWT auth

**Frontend**
- React 18 + TypeScript + Vite
- Axios para API calls
- UI simple con tabs (sin framework UI por ahora)

## Estructura

```
AgroPack-Llano/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── core/          # config, db, security
│   │   ├── models/        # SQLAlchemy models (user, inventory, embarque...)
│   │   ├── routers/       # recepcion, empaque, embarques, reports...
│   │   └── schemas/       # Pydantic models
│   ├── migrations/        # Alembic
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   └── App.tsx        # App monolítica actual (tabs por módulo)
│   └── package.json
├── docker-compose.yml
└── README.md
```

## Desarrollo (Inicio Rápido)

### 1. Backend (FastAPI)

```bash
cd backend

# Create virtual environment (recommended)
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the server (default port 8001 as used in frontend config)
uvicorn app.main:app --reload --port 8001
```

The backend is available at **http://127.0.0.1:8001**

> **Note on Python version**: The project currently pins older Pydantic/SQLAlchemy versions. Python 3.12 or 3.13 is recommended for easiest dependency installation. Python 3.14 may require using an existing working `.venv` from previous development or building from source.

### 2. Frontend (Vite + React + TypeScript)

```bash
cd frontend

# Install dependencies (first time)
npm install

# Start development server
npm run dev
```

The frontend runs at **http://localhost:5173**

#### Environment & Proxy

- `frontend/.env` contains `VITE_API_URL=http://127.0.0.1:8001`
- All axios calls use this variable.
- Vite is configured with a dev proxy (`/api` → backend) to avoid CORS issues during development.

You can change `VITE_API_URL` in `frontend/.env` (or `frontend/.env.local`) to point to a different backend (Docker, remote, etc.).

### 3. Typical Workflow

1. Start the backend on port 8001 (in its own terminal)
2. Start the frontend with `npm run dev`
3. Open http://localhost:5173
4. Register a user via the UI or call the `/api/auth/register` endpoint directly

The application should now be fully functional with proper environment-based configuration.

## Estado actual

- Módulos de Recepción, Empaque y Embarques funcionales.
- Soporte para embarques multi-variedad (última mejora).
- Autenticación JWT básica.
- Inventario en memoria / DB con triggers manuales de stock.

## Próximos pasos sugeridos

- Extraer componentes React (formularios por módulo).
- Mejorar validaciones y UX del formulario de Embarques.
- Añadir edición / anulación de embarques.
- Reportes PDF / Excel.
- Roles de usuario (empacador vs supervisor).
- Migrar a PostgreSQL + Docker completo.

## Contribuir

Este es un proyecto interno en desarrollo activo.

---

Desarrollado con ❤️ para la operación de empaque Llano.

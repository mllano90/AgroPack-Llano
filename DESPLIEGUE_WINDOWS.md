# Despliegue en Windows Server + PostgreSQL (sin Docker)

Guía paso a paso para poner **AgroPack Llano** en el servidor físico usando solo:

- **PostgreSQL** (ya instalado en Windows)
- **Python 3.12 o 3.13** (backend FastAPI)
- **Node.js 20 LTS** (solo para compilar el frontend una vez)
- **IIS** o servidor estático (para la UI)

---

## Arquitectura en el servidor

```
Navegadores (PCs de la planta)
        │
        ▼
  http://IP_SERVIDOR/          ← Frontend (IIS o carpeta dist)
  http://IP_SERVIDOR:8000/api  ← Backend FastAPI
        │
        ▼
  PostgreSQL :5432             ← Base de datos local
```

| Servicio   | Puerto | Cómo corre                          |
|-----------|--------|-------------------------------------|
| PostgreSQL| 5432   | Servicio de Windows                 |
| Backend   | 8000   | `uvicorn` (PowerShell o servicio)   |
| Frontend  | 80     | IIS (recomendado) o `npx serve`     |

---

## Datos a anotar antes de empezar

| Dato | Valor |
|------|--------|
| Contraseña usuario `postgres` (instalación) | _______________ |
| Puerto PostgreSQL | 5432 (u otro: ___) |
| Usuario app | `agro` (recomendado) |
| Contraseña app | _______________ (fuerte) |
| IP del servidor en la red | _______________ |
| Carpeta del proyecto | `C:\AgroPack-Llano` |

---

## 1. PostgreSQL: base de datos y usuario

Abrir **SQL Shell (psql)** o pgAdmin.

```sql
-- Conectado como postgres
CREATE DATABASE agropack_llano;

CREATE USER agro WITH PASSWORD 'TU_PASSWORD_FUERTE';

GRANT ALL PRIVILEGES ON DATABASE agropack_llano TO agro;

-- Postgres 15 / 16 / 18:
\c agropack_llano
GRANT ALL ON SCHEMA public TO agro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO agro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO agro;
```

Comprobar:

```sql
\c agropack_llano agro
-- debe conectar sin error
```

- [ ] Base `agropack_llano` creada  
- [ ] Usuario `agro` con permisos  

---

## 2. Copiar el proyecto al servidor

Copiar **todo** el proyecto a:

```
C:\AgroPack-Llano\
├── backend\
├── frontend\
├── DESPLIEGUE_WINDOWS.md
└── ...
```

(USB, red compartida, zip, etc.)

---

## 3. Backend (Python + FastAPI)

### 3.1 Instalar Python

- Descargar **Python 3.12 o 3.13** de python.org  
- Marcar **“Add python.exe to PATH”**  
- Comprobar en PowerShell:

```powershell
python --version
```

### 3.2 Entorno virtual e dependencias

```powershell
cd C:\AgroPack-Llano\backend

python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Si falla la política de ejecución:
# Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 3.3 Archivo `.env`

Crear `C:\AgroPack-Llano\backend\.env`:

```env
SECRET_KEY=CAMBIAR_POR_CLAVE_LARGA_MINIMO_32_CARACTERES
DATABASE_URL=postgresql://agro:TU_PASSWORD_FUERTE@localhost:5432/agropack_llano
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
DEBUG=false
```

Generar una `SECRET_KEY` (en PowerShell):

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
```

### 3.4 Probar el backend

```powershell
cd C:\AgroPack-Llano\backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Abrir en el servidor:

- API: http://localhost:8000/  
- Docs: http://localhost:8000/docs  

Al arrancar, FastAPI crea las tablas con `create_all` (BD vacía = esquema limpio).

### 3.5 Crear el primer usuario admin

Con el backend corriendo, en **otra** ventana PowerShell:

```powershell
curl.exe -X POST "http://localhost:8000/api/auth/register" `
  -H "Content-Type: application/json" `
  -d "{\"username\":\"admin\",\"nombre_completo\":\"Administrador\",\"rol\":\"admin\",\"password\":\"CambiaEstaClave123\"}"
```

O usar Postman / el navegador en `/docs` → `POST /api/auth/register`.

> Si ya hay usuarios, el registro exige token de admin.

### 3.6 Dejar el backend siempre activo (producción)

**Opción simple (pruebas):** dejar la ventana de PowerShell abierta con `uvicorn`.

**Opción recomendada (servicio Windows):** usar [NSSM](https://nssm.cc/):

```text
Path:        C:\AgroPack-Llano\backend\.venv\Scripts\python.exe
Arguments:   -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
Startup dir: C:\AgroPack-Llano\backend
```

O Programador de tareas de Windows al inicio del sistema con el script:

```
C:\AgroPack-Llano\scripts\windows\start-backend.ps1
```

---

## 4. Frontend (build estático)

### 4.1 Instalar Node.js

- **Node.js 20 LTS** desde nodejs.org  
- Comprobar:

```powershell
node --version
npm --version
```

### 4.2 Compilar para producción

**Importante:** la URL de la API debe ser la que verán los navegadores de la planta (IP del servidor + puerto del backend).

```powershell
cd C:\AgroPack-Llano\frontend
npm ci

# Si los usuarios abren el servidor por IP (ejemplo 192.168.1.50):
$env:VITE_API_URL="http://192.168.1.50:8000"

# Si solo se usa en la misma máquina del servidor:
# $env:VITE_API_URL="http://localhost:8000"

npm run build
```

Se genera la carpeta:

```
C:\AgroPack-Llano\frontend\dist\
```

Si cambias la IP del servidor, **hay que volver a hacer `npm run build`** con el nuevo `VITE_API_URL`.

### 4.3 Publicar la UI

#### Opción A — IIS (recomendada en Windows Server)

1. Activar **IIS** + **URL Rewrite** (módulo de Microsoft).  
2. Crear sitio web apuntando a:  
   `C:\AgroPack-Llano\frontend\dist`  
3. Binding: puerto **80**, IP del servidor.  
4. Para SPA (React), regla de reescritura: si no es archivo, ir a `index.html`.  
5. Firewall de Windows: permitir **TCP 80** y **TCP 8000** en red privada.

#### Opción B — Servidor estático rápido (pruebas)

```powershell
cd C:\AgroPack-Llano\frontend
npx --yes serve -s dist -l 80
```

(Abre como Administrador si el puerto 80 está reservado; o usa `-l 5173`.)

Los PCs de la planta abren:

```
http://IP_SERVIDOR/
```

y el frontend llama a:

```
http://IP_SERVIDOR:8000/api/...
```

---

## 5. Firewall de Windows

En **Firewall de Windows con seguridad avanzada**:

| Regla entrada | Puerto | Uso |
|---------------|--------|-----|
| AgroPack-UI   | 80     | Frontend |
| AgroPack-API  | 8000   | Backend |

Perfil: **Privado** (red de planta). No abrir a Internet público sin VPN/HTTPS.

---

## 6. Checklist de prueba en el servidor

Con backend y frontend arriba:

1. [ ] http://IP:8000/ responde  
2. [ ] http://IP/ (o :5173) carga la UI  
3. [ ] Login con `admin`  
4. [ ] Crear usuario de recepción / empacador  
5. [ ] **Recepción** limón: lote + bins + fecha  
6. [ ] **Dashboard** → Limón: se ve desverdizado (fecha `DD MES AÑO`)  
7. [ ] **Empaque** limón: consumir bins + líneas (RPC 12 #talla…)  
8. [ ] Inventario final limón actualizado  
9. [ ] **Embarques**: cliente + producto limón → stock baja  

---

## 7. Comandos diarios

### Arrancar backend

```powershell
cd C:\AgroPack-Llano\backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

O ejecutar:

```powershell
C:\AgroPack-Llano\scripts\windows\start-backend.ps1
```

### Actualizar código (nueva versión)

1. Copiar archivos nuevos (sin borrar `.env` ni `.venv`).  
2. Backend:

```powershell
cd C:\AgroPack-Llano\backend
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# reiniciar uvicorn / servicio NSSM
```

3. Frontend (si hubo cambios de UI):

```powershell
cd C:\AgroPack-Llano\frontend
npm ci
$env:VITE_API_URL="http://IP_SERVIDOR:8000"
npm run build
# IIS ya sirve dist\; no hace falta reconfigurar si la ruta es la misma
```

---

## 8. Problemas frecuentes

| Síntoma | Causa / solución |
|---------|------------------|
| Network Error en la UI | `VITE_API_URL` mal (localhost en build visto desde otro PC). Recompilar con `http://IP:8000` |
| `password authentication failed` | Usuario/clave en `DATABASE_URL` incorrectos |
| `connection refused` Postgres | Servicio PostgreSQL detenido o puerto distinto |
| Backend no arranca | Falta `SECRET_KEY` o `.env` mal ubicado (debe estar en `backend\.env`) |
| Tablas no existen | Arrancar backend una vez: `create_all` las crea |
| CORS / bloqueo | Backend con `allow_origins=["*"]` ya configurado; si falla, revisar firewall y URL exacta |
| PowerShell no ejecuta scripts | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

---

## 9. Resumen rápido (copiar/pegar)

```powershell
# --- Postgres (una vez, en psql) ---
# CREATE DATABASE agropack_llano;
# CREATE USER agro WITH PASSWORD '...';
# GRANT ALL PRIVILEGES ON DATABASE agropack_llano TO agro;

# --- Backend ---
cd C:\AgroPack-Llano\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# Crear backend\.env con SECRET_KEY y DATABASE_URL
uvicorn app.main:app --host 0.0.0.0 --port 8000

# --- Frontend (otra ventana) ---
cd C:\AgroPack-Llano\frontend
npm ci
$env:VITE_API_URL="http://IP_DEL_SERVIDOR:8000"
npm run build
# Publicar dist\ en IIS puerto 80
```

---

## 10. Qué NO hace falta

- Docker  
- Migrar SQLite (si empiezan limpio en el servidor)  
- Puerto 5173 de desarrollo en producción  

Si más adelante quieren un solo puerto (80) con proxy `/api` → IIS con reverse proxy a `localhost:8000` o instalar nginx en Windows; avísame y lo dejamos documentado.

---

**Siguiente paso:** cuando el técnico tenga Postgres listo y la carpeta en `C:\AgroPack-Llano`, ejecutar las secciones 3 y 4 y mandar si el `/docs` y el login funcionan.

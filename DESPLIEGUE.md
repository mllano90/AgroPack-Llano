# Despliegue AgroPack Llano (servidor)

Guía para poner el sistema en el servidor físico y empezar pruebas reales (limón amarillo).

> **Publicar en internet (recomendado ahora):** **`DESPLIEGUE_NUBE.md`** (Render / Railway).  
> **Windows + Postgres local (sin Docker):** **`DESPLIEGUE_WINDOWS.md`**.  
> Este archivo documenta Docker en un VPS Linux.

---

## Arquitectura de producción (recomendada)

```
Navegador  →  http://IP_SERVIDOR/     (nginx + frontend estático)
                 └── /api/*  proxy → backend FastAPI :8000
                                       └── PostgreSQL (contenedor o servidor Windows)
```

| Componente | Puerto | Notas |
|------------|--------|--------|
| Frontend (nginx) | **80** (o el de `HTTP_PORT`) | UI + proxy `/api` |
| Backend | solo interno Docker | No exponer a internet si no hace falta |
| Postgres | solo interno Docker | No abrir 5432 a internet |

---

## Opción A — Todo con Docker (recomendada)

### Requisitos en el servidor

- Docker Engine + Docker Compose plugin
- Linux (Ubuntu/Debian recomendado) **o** Docker Desktop en Windows
- Al menos 2 GB RAM libre, 10 GB disco
- Puerto 80 libre (o el que elijas)

### 1. Copiar el proyecto

```bash
# En el servidor
cd /opt   # o la ruta que uses
# subir AgroPack-Llano (git clone / scp / zip)
cd AgroPack-Llano
```

### 2. Crear archivo de entorno de producción

```bash
cp .env.prod.example .env.prod
nano .env.prod   # o notepad en Windows
```

**Obligatorio cambiar:**

```env
SECRET_KEY=...          # openssl rand -hex 32
POSTGRES_PASSWORD=...   # contraseña fuerte
```

Ejemplo de generación de `SECRET_KEY`:

```bash
openssl rand -hex 32
```

### 3. Construir y levantar

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

### 4. Verificar

```bash
docker compose -f docker-compose.prod.yml ps
curl -s http://localhost/health
curl -s http://localhost/api/   # o http://localhost/  (root del backend vía /health)
```

Abrir en el navegador: `http://IP_DEL_SERVIDOR/`

### 5. Primer usuario (admin)

Si la base está vacía, el endpoint de registro permite el **primer usuario sin token**:

```bash
curl -s -X POST http://localhost/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "nombre_completo": "Administrador",
    "rol": "admin",
    "password": "CambiaEstaClave123"
  }'
```

Luego inicia sesión en la UI con ese usuario.

### 6. Logs y reinicio

```bash
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml restart
docker compose -f docker-compose.prod.yml down
```

### 7. Actualizar el sistema (nueva versión del código)

```bash
cd /opt/AgroPack-Llano
# git pull  o copiar archivos nuevos
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Los datos de Postgres se conservan en el volumen `postgres_data_prod`.

---

## Opción B — Postgres en Windows Server + backend/frontend en Docker

Si el técnico ya instaló **PostgreSQL en Windows** (ver `CHECKLIST_TECNICO_POSTGRES.md` / `INSTRUCCIONES_POSTGRES.md`):

### 1. En Windows: crear BD y usuario

```sql
CREATE DATABASE agropack_llano;
CREATE USER agro WITH PASSWORD 'Agr0.26';
GRANT ALL PRIVILEGES ON DATABASE agropack_llano TO agro;
-- En Postgres 15+:
\c agropack_llano
GRANT ALL ON SCHEMA public TO agro;
```

### 2. Ajustar `DATABASE_URL` hacia el host

En `.env.prod` (o un `docker-compose.override` sin servicio `db`):

```env
# Desde Docker en Windows, el host suele ser host.docker.internal
DATABASE_URL=postgresql://agro:Agr0.26@host.docker.internal:5432/agropack_llano
SECRET_KEY=...
```

Y en `docker-compose.prod.yml` usar solo `backend` + `frontend` (sin servicio `db`), con:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

### 3. Backend nativo en Windows (sin Docker)

```powershell
cd C:\AgroPack-Llano\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# .env
# SECRET_KEY=...
# DATABASE_URL=postgresql://agro:Agr0.26@localhost:5432/agropack_llano

uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 4. Frontend nativo (build estático)

```powershell
cd C:\AgroPack-Llano\frontend
npm ci
# Si el backend está en la misma máquina y expondrás nginx/IIS con proxy:
$env:VITE_API_URL=""
# Si el backend es http://IP:8000 sin proxy:
# $env:VITE_API_URL="http://IP_SERVIDOR:8000"
npm run build
# Servir carpeta dist/ con IIS o nginx
```

---

## Checklist pre-producción

### Seguridad

- [ ] `SECRET_KEY` aleatorio (no el de desarrollo)
- [ ] Contraseña de Postgres distinta a `postgres/postgres`
- [ ] Puerto 5432 **no** expuesto a internet
- [ ] Firewall: solo 80 (y 443 si usas HTTPS)
- [ ] Usuario admin con contraseña fuerte
- [ ] No usar `DEBUG=true` en producción

### Funcional (pruebas en el servidor)

- [ ] Login admin
- [ ] Crear usuarios por rol (recepción, empacador, embarques…)
- [ ] **Recepción limón**: lote + bins + fecha de corte
- [ ] Dashboard → pestaña Limón → desverdizado con fechas `DD MES AÑO`
- [ ] **Empaque limón**: consumir bins + líneas (RPC 12 #talla, etc.)
- [ ] Inventario final limón actualizado (RPC / Cajas / Bins)
- [ ] **Embarque**: cliente + líneas de limón + descuento de stock
- [ ] (Opcional) flujo uva si se va a usar

### Datos

- [ ] Empezar con BD limpia en el servidor (recomendado)
- [ ] O migrar solo usuarios/clientes si hace falta

---

## Desarrollo vs producción (no mezclar)

| | Desarrollo (`docker-compose.yml`) | Producción (`docker-compose.prod.yml`) |
|--|-----------------------------------|----------------------------------------|
| Frontend | Vite dev `:5173` | nginx estático `:80` |
| Backend | `--reload` + volume | workers, sin volume de código |
| API URL | `http://localhost:8000` | `""` (proxy `/api`) |
| SECRET_KEY | dev | fuerte en `.env.prod` |

En tu Mac/local sigue usando:

```bash
docker compose up
# UI: http://localhost:5173
```

En el servidor:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# UI: http://IP_SERVIDOR/
```

---

## Problemas frecuentes

### “Network Error” en el navegador

- Confirma que abres por el puerto de **nginx (80)**, no 5173.
- Si pusiste `VITE_API_URL=http://localhost:8000` en el build de producción, el navegador del cliente buscará “localhost” **en su PC** → falla. Usa `VITE_API_URL=""` con el proxy nginx.

### Backend no arranca

```bash
docker compose -f docker-compose.prod.yml logs backend
```

Suele ser `SECRET_KEY` faltante o Postgres aún no healthy.

### Tablas / enums limón

Al arrancar, `Base.metadata.create_all` crea tablas nuevas.  
Si reutilizas una BD vieja incompleta, puede faltar columnas/enums: en ese caso conviene **BD limpia** en el servidor o ejecutar los `ALTER` que ya usamos en desarrollo.

### CORS

Con nginx y `VITE_API_URL=""` no hace falta CORS (mismo origen).  
Si llamas al backend en otro puerto/host, hay que configurar orígenes en FastAPI.

---

## HTTPS (recomendado después de las primeras pruebas)

Cuando el flujo esté estable:

- Poner **Caddy** o **nginx + Let’s Encrypt** delante del puerto 80.
- O un reverse proxy corporativo / IIS con certificado.

---

## Resumen rápido (copiar/pegar en el servidor)

```bash
cd /ruta/AgroPack-Llano
cp .env.prod.example .env.prod
# editar SECRET_KEY y POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
curl -s http://localhost/health
# Abrir http://IP_SERVIDOR/ y crear primer admin vía /api/auth/register o UI
```

---

## Contacto / siguiente paso

Cuando el servidor tenga Docker (o Postgres listo):

1. Subir el código  
2. Crear `.env.prod`  
3. `up -d --build`  
4. Ejecutar el checklist funcional de arriba  

Si me das: **SO del servidor** (Windows/Linux), **si usarán Docker o solo Postgres Windows**, y la **IP/hostname**, adapto el compose y el comando exacto a tu caso.

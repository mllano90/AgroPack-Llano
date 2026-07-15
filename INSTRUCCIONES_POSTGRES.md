# Instrucciones para Probar la Aplicación contra PostgreSQL

Este documento explica paso a paso cómo configurar y probar el backend de AgroPack-Llano contra una base de datos **PostgreSQL** (ya sea local o en el servidor físico).

---

## 1. Requisitos Previos

- Tener PostgreSQL instalado y corriendo.
- Tener acceso a un usuario con permisos para crear bases de datos.
- Tener el código del proyecto clonado.

---

## 2. Crear la Base de Datos en PostgreSQL

Abre tu cliente de PostgreSQL (psql, pgAdmin, DBeaver, etc.) y ejecuta:

```sql
CREATE DATABASE agropack_llano;
```

> **Nota:** Puedes usar otro nombre de base de datos si lo prefieres, pero tendrás que ajustarlo en el `DATABASE_URL`.

---

## 3. Configurar el Backend

### 3.1 Crear archivo `.env`

En la carpeta `backend/`, crea un archivo llamado `.env` (puedes copiar el `.env.example`):

```bash
cp backend/.env.example backend/.env
```

### 3.2 Editar el archivo `.env`

Abre el archivo `backend/.env` y configura al menos estas variables:

```env
SECRET_KEY=tu-clave-secreta-muy-larga-y-segura-aqui
DATABASE_URL=postgresql://postgres:tu_contraseña@localhost:5432/agropack_llano
ALGORITHM=HS256
```

**Ejemplo con contraseña `postgres`:**

```env
SECRET_KEY=test-secret-key-para-desarrollo
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agropack_llano
ALGORITHM=HS256
```

> **Importante:** Si tu PostgreSQL usa otro puerto, cámbialo en la URL (ej: `localhost:5433`).

---

## 4. Instalar Dependencias del Backend

```bash
cd backend
source .venv/bin/activate          # o el comando que uses para activar tu entorno virtual
pip install -r requirements.txt
```

---

## 5. Ejecutar la Migración (si aún no lo hiciste)

Si la base de datos PostgreSQL está vacía, ejecuta el script de migración:

```bash
# Asegúrate de tener las variables de entorno cargadas
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/agropack_llano"

python scripts/migrate_sqlite_to_postgres.py --reset-seq
```

> Si ya migraron los datos anteriormente, puedes saltar este paso.

---

## 6. Levantar el Backend

```bash
cd backend
source .venv/bin/activate

export SECRET_KEY="tu-clave-secreta"
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/agropack_llano"

uvicorn app.main:app --reload --port 8000
```

El backend debería estar disponible en: **http://localhost:8000**

---

## 7. Crear el Usuario Administrador (primera vez)

Si es la primera vez que levantas contra Postgres y no tienes usuarios, puedes crear el primer usuario admin directamente con curl:

```bash
curl -X POST "http://localhost:8000/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "nombre_completo": "Administrador",
    "rol": "admin",
    "password": "admin123"
  }'
```

> **Recomendación:** Cambia la contraseña después del primer login.

---

## 8. Levantar el Frontend (opcional pero recomendado)

```bash
cd frontend
npm run dev
```

El frontend estará disponible en: **http://localhost:5173**

---

## 9. Verificar que todo funciona

1. Abre el frontend en el navegador.
2. Inicia sesión con el usuario admin que creaste.
3. Verifica que puedas navegar por las pestañas según tu rol.
4. Prueba crear una recepción, empaque o embarque.

---

## Comandos Útiles

### Verificar conexión a la base de datos

```bash
docker exec -it nombre-del-contenedor psql -U postgres -d agropack_llano
# o si es Postgres local:
psql -U postgres -d agropack_llano
```

### Correr la migración de nuevo (por si acaso)

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/agropack_llano"
python backend/scripts/migrate_sqlite_to_postgres.py --reset-seq
```

---

## Notas Importantes

- El backend soporta tanto **SQLite** como **PostgreSQL** mediante la variable `DATABASE_URL`.
- Para volver a usar SQLite (útil para desarrollo rápido), simplemente comenta o cambia la `DATABASE_URL` en el `.env`.
- Recuerda que cada vez que cambies la base de datos, es posible que necesites volver a correr la migración.

---

**Última actualización:** Mayo 2026

---

## Sección para el Técnico: Instalación en Servidor Windows Físico

Esta sección está pensada específicamente para el escenario actual:

- **PostgreSQL 14** instalado con el **Windows Installer oficial**
- Usando **Stack Builder** pero **sin instalar componentes adicionales**
- Servidor físico Windows (producción de pruebas / piloto)

### A. Durante la instalación de PostgreSQL (ya en progreso)

El instalador oficial de PostgreSQL para Windows (versión 14) normalmente pregunta:

1. **Installation Directory** → dejar por defecto o anotar la ruta elegida.
2. **Data Directory** → dejar por defecto.
3. **Password for the database superuser (postgres)** → **elegir una contraseña fuerte y anotarla**. Este será el usuario administrador.
4. **Port** → dejar **5432** (recomendado). Si por alguna razón se cambia, anotarlo.
5. **Locale** → dejar por defecto.
6. **Stack Builder** → se puede ejecutar al final, pero **NO instalar ningún componente adicional** (sin PostGIS, sin pgAgent, etc.). Solo el servidor base es suficiente.

Al terminar la instalación, el sistema tendrá:
- El servicio de PostgreSQL corriendo (se ve en Servicios de Windows).
- La herramienta **SQL Shell (psql)** accesible desde el menú inicio.
- pgAdmin 4 (generalmente se instala por defecto con el instalador oficial).

### B. Crear la base de datos y usuario (después de instalar)

#### Opción recomendada (usar usuario dedicado)

Abre **SQL Shell (psql)** desde el menú de Windows.

Cuando pida:
- Server: dejar `localhost`
- Database: dejar `postgres`
- Port: `5432`
- Username: `postgres`
- Password: la que elegiste durante la instalación

Ejecuta estos comandos uno por uno:

```sql
-- 1. Crear la base de datos
CREATE DATABASE agropack_llano;

-- 2. Crear un usuario dedicado para la aplicación (recomendado)
CREATE USER agro WITH PASSWORD 'Agr0.26';

-- 3. Darle permisos sobre la base de datos
GRANT ALL PRIVILEGES ON DATABASE agropack_llano TO agro;
```

> **Importante:** Usuario: `agro` | Contraseña: `Agr0.26` (ya definida)

#### Opción simple (usar directamente el usuario postgres)

Si prefieres no crear usuario nuevo por ahora:

```sql
CREATE DATABASE agropack_llano;
```

Luego usarás `postgres` + su contraseña en la cadena de conexión.

### C. Copiar los archivos necesarios al servidor

Necesitas llevar al servidor:

1. La carpeta completa `backend/` del proyecto (o al menos):
   - `backend/agropack_llano.db` (la base SQLite actual con los datos reales)
   - `backend/requirements.txt`
   - `backend/scripts/migrate_sqlite_to_postgres.py`
   - `backend/app/` (todo el código)

2. La base de datos SQLite actual tiene ~116 KB. Es muy pequeña y fácil de copiar.

**Recomendación de estructura en el servidor:**
```
C:\AgroPack-Llano\
    backend\
        agropack_llano.db
        requirements.txt
        scripts\
            migrate_sqlite_to_postgres.py
        app\...
```

### D. Preparar el entorno Python en el servidor Windows

1. Instala **Python 3.12 o 3.13** (evitar Python 3.14 por problemas de compatibilidad conocidos con algunas librerías).
2. Abre **PowerShell** o **Símbolo del sistema** como Administrador.
3. Ve a la carpeta del backend:

```powershell
cd C:\AgroPack-Llano\backend
```

4. Crea un entorno virtual (recomendado):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

5. Instala las dependencias (incluye psycopg2-binary para conectar con PostgreSQL):

```powershell
pip install -r requirements.txt
```

### E. Ejecutar la migración de datos (SQLite → PostgreSQL)

Este es el paso clave.

En PowerShell (con el entorno virtual activado):

```powershell
# 1. Definir las variables de conexión (AJUSTA LOS VALORES)

# Si creaste el usuario "agro":
$env:SQLITE_URL="sqlite:///./agropack_llano.db"
$env:DATABASE_URL="postgresql://agro:Agr0.26@localhost:5432/agropack_llano"

# Si usas el usuario postgres:
# $env:DATABASE_URL="postgresql://postgres:TU_CONTRASEÑA_AQUI@localhost:5432/agropack_llano"

# 2. Ejecutar la migración con reset de secuencias (recomendado)
python scripts/migrate_sqlite_to_postgres.py --reset-seq
```

El script:
- Creará las tablas en PostgreSQL si no existen.
- Copiará todos los datos respetando el orden de las foreign keys.
- Reseteará las secuencias de IDs (para que los próximos registros sigan la numeración correcta).

Al terminar verás un mensaje de éxito y la cantidad de registros migrados.

### F. Verificar que la migración fue exitosa

En psql ejecuta:

```sql
\c agropack_llano

\dt

SELECT COUNT(*) FROM "user";
SELECT COUNT(*) FROM recepcion;
SELECT COUNT(*) FROM empaque;
SELECT COUNT(*) FROM embarque;
```

Deberías ver las mismas cantidades que tenía la base SQLite.

### G. Probar que el backend funcione contra PostgreSQL

Con el entorno virtual activado:

```powershell
$env:SECRET_KEY="cualquier-clave-larga-para-pruebas"
$env:DATABASE_URL="postgresql://agro:Agr0.26@localhost:5432/agropack_llano"

uvicorn app.main:app --reload --port 8000
```

Abre en el navegador del servidor: `http://localhost:8000/docs`

Debería cargar la documentación de la API sin errores.

### H. Configuración permanente (.env)

Crea el archivo `backend/.env` con este contenido (ajusta según lo que hayas usado):

```env
SECRET_KEY=pon-una-clave-muy-larga-y-segura-aqui-minimo-32-caracteres
DATABASE_URL=postgresql://agro:Agr0.26@localhost:5432/agropack_llano
ALGORITHM=HS256
```

Nunca subas este archivo a git.

---

## Resumen de Cadena de Conexión Recomendada

```
postgresql://agro:Agr0.26@localhost:5432/agropack_llano
```

---

**Última actualización:** Mayo 2026

Si necesitas ayuda con alguno de estos pasos, avísame.
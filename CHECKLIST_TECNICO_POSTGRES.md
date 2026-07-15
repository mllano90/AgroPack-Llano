# CHECKLIST TÉCNICO - PostgreSQL + Migración AgroPack Llano

**Versión para WhatsApp**  
**PostgreSQL 14** | Windows Server (Instalador oficial + Stack Builder sin componentes extra)

---

## DATOS IMPORTANTES (anotar antes de empezar)

- Contraseña del usuario `postgres`: _______________________________
- Puerto de PostgreSQL: ________ (normalmente 5432)
- Usuario que usaremos para la aplicación: `agro` / contraseña: `Agr0.26`
- Ruta donde pondremos los archivos: `C:\AgroPack-Llano\backend`

---

## PASOS (en orden)

### 1. Finalizar instalación de PostgreSQL 14
- [ ] Usar el instalador oficial de Windows
- [ ] **NO instalar componentes adicionales** por Stack Builder
- [ ] Anotar la contraseña de `postgres`
- [ ] Dejar puerto 5432 (o anotar si se cambió)

### 2. Crear base de datos y usuario (después de instalar)

Abrir **SQL Shell (psql)** desde el menú de Windows.

Ejecutar estos comandos uno por uno:

```sql
CREATE DATABASE agropack_llano;

CREATE USER agro WITH PASSWORD 'Agr0.26';

GRANT ALL PRIVILEGES ON DATABASE agropack_llano TO agro;
```

- [ ] Base de datos `agropack_llano` creada
- [ ] Usuario `agro` creado con contraseña fuerte
- [ ] Permisos otorgados

### 3. Copiar archivos al servidor

Copiar la carpeta `backend` completa del proyecto a:
`C:\AgroPack-Llano\backend`

Debe contener al menos:
- `agropack_llano.db`
- `requirements.txt`
- `scripts/migrate_sqlite_to_postgres.py`
- carpeta `app/`

- [ ] Archivos copiados correctamente

### 4. Preparar Python en el servidor

Abrir **PowerShell como Administrador** y ejecutar:

```powershell
cd C:\AgroPack-Llano\backend

python -m venv .venv
.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

- [ ] Python 3.12 o 3.13 instalado
- [ ] Entorno virtual creado
- [ ] Dependencias instaladas sin errores

### 5. Ejecutar la migración (PASO MÁS IMPORTANTE)

Con el entorno virtual activado, ejecutar:

```powershell
$env:SQLITE_URL="sqlite:///./agropack_llano.db"
$env:DATABASE_URL="postgresql://agro:Agr0.26@localhost:5432/agropack_llano"

python scripts/migrate_sqlite_to_postgres.py --reset-seq
```

- [ ] Migración completada sin errores
- [ ] Aparece mensaje "Migración completada" + cantidad de registros

### 6. Verificar que los datos migraron bien

En **SQL Shell (psql)** ejecutar:

```sql
\c agropack_llano

SELECT COUNT(*) FROM "user";
SELECT COUNT(*) FROM recepcion;
SELECT COUNT(*) FROM empaque;
SELECT COUNT(*) FROM embarque;
```

- [ ] Conteos coinciden con los datos originales

### 7. Probar que el backend funcione con PostgreSQL

```powershell
$env:SECRET_KEY="clave-larga-para-pruebas-123456789"
$env:DATABASE_URL="postgresql://agro:Agr0.26@localhost:5432/agropack_llano"

uvicorn app.main:app --reload --port 8000
```

Abrir en el navegador del servidor:
`http://localhost:8000/docs`

- [ ] La documentación de la API carga sin errores

### 8. Crear archivo .env permanente (para después)

Crear el archivo `C:\AgroPack-Llano\backend\.env` con este contenido:

```env
SECRET_KEY=pon-una-clave-muy-larga-y-segura-aqui-minimo-32-caracteres
DATABASE_URL=postgresql://agro:Agr0.26@localhost:5432/agropack_llano
ALGORITHM=HS256
```

- [ ] Archivo .env creado

---

## REPORTAR AL FINAL (importante)

Cuando termines, envíame por favor:

1. **Resultado de la migración** (captura o texto completo)
2. Los 4 conteos de las tablas:
   - users: ___
   - recepcion: ___
   - empaque: ___
   - embarque: ___
3. ¿Hubo algún error? (si sí, copia el mensaje completo)
4. ¿El backend levantó correctamente en http://localhost:8000/docs ?

---

**Checklist listo para usar.**  
Cualquier duda en cualquier paso, mándame mensaje o captura.

**Fecha:** Mayo 2026

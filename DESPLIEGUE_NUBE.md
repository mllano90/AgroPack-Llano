# Publicar AgroPack en Internet (sin Windows Server)

Dejamos de lado la instalación en Windows 2012.  
Objetivo: **URL pública** para pruebas reales (recepción → desverdizado → empaque → embarques).

---

## Lovable vs tu código actual

| | **Lovable** (u similar) | **Tu AgroPack actual en la nube** |
|--|-------------------------|-------------------------------------|
| Qué es | Genera UI/apps nuevas con IA | Ya tienes FastAPI + React + Postgres |
| Tiempo | Semanas rehaciendo lógica de limón | **1–2 horas** a URL pública |
| Riesgo | Pierdes empaque, tallas, desverdizado, roles | Conservas todo lo ya probado |
| Cuándo usarlo | Landing, demo comercial, rediseño UI | **Producción / pruebas operativas** |

**Recomendación:**  
1. **Ahora:** subir **este proyecto** a internet (Render / Railway).  
2. **Después (opcional):** Lovable solo si quieres una UI más “bonita” conectada a la misma API.

---

## Opción recomendada: Render.com (gratis para empezar)

### Qué vas a tener

```
https://agropack-web.onrender.com     ← UI (React)
https://agropack-api.onrender.com     ← API (FastAPI)
         └── Postgres administrado en Render
```

### Requisitos

- Cuenta en [GitHub](https://github.com) (gratis)
- Cuenta en [Render](https://render.com) (gratis)
- El código de AgroPack-Llano en un repo GitHub

### Paso a paso

#### 1. Subir el código a GitHub

En tu Mac (carpeta del proyecto):

```bash
cd ~/AgroPack-Llano

# Si aún no es repo git:
git init
git add .
git commit -m "AgroPack listo para nube"

# Crea un repo vacío en GitHub y:
git remote add origin https://github.com/TU_USUARIO/AgroPack-Llano.git
git branch -M main
git push -u origin main
```

**No subas** secretos: asegúrate de que `.env` y `.env.prod` estén en `.gitignore`.

#### 2. Crear el stack en Render

1. Entra a https://dashboard.render.com  
2. **New** → **Blueprint**  
3. Conecta el repo `AgroPack-Llano`  
4. Render detecta `render.yaml`  
5. **Apply** / crear servicios  

Se crean:

- `agropack-db` (Postgres)
- `agropack-api` (backend Docker)
- `agropack-web` (frontend estático)

#### 3. Configurar la URL de la API en el frontend

1. Abre el servicio **agropack-api** → copia la URL (ej. `https://agropack-api.onrender.com`)  
2. Abre **agropack-web** → **Environment**  
3. Variable:

```text
VITE_API_URL = https://agropack-api.onrender.com
```

(sin `/` al final)

4. **Manual Deploy** → Clear build cache & deploy  

#### 4. Crear el usuario admin

Con la API en línea (espera 1–2 min en plan free; el primer cold start es lento):

En tu Mac:

```bash
curl -X POST "https://agropack-api.onrender.com/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "nombre_completo": "Administrador",
    "rol": "admin",
    "password": "Admin2026!"
  }'
```

O abre: `https://agropack-api.onrender.com/docs` → `POST /api/auth/register`.

#### 5. Entrar

1. Abre la URL de **agropack-web**  
2. Login: `admin` / `Admin2026!`  
3. Prueba recepción limón → dashboard → empaque → embarque  

---

## Alternativa: Railway.app

Similar a Render, a veces más simple con Docker:

1. https://railway.app → New Project  
2. Deploy from GitHub  
3. Añadir **Postgres**  
4. Servicio **backend** (Dockerfile en `/backend`)  
   - `DATABASE_URL` = variable de Postgres (Railway la inyecta)  
   - `SECRET_KEY` = string largo aleatorio  
5. Servicio **frontend** (Dockerfile.prod o static build)  
   - `VITE_API_URL` = URL pública del backend  

---

## Alternativa: un VPS barato (DigitalOcean / Hetzner)

Si prefieres un servidor Linux “de verdad”:

```bash
# En el VPS (Ubuntu)
git clone ... AgroPack-Llano
cd AgroPack-Llano
cp .env.prod.example .env.prod
# editar SECRET_KEY y POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

URL: `http://IP_DEL_VPS/`  
Detalle: ver `DESPLIEGUE.md` (opción Docker).

---

## Plan free: limitaciones a conocer

| Tema | Render free |
|------|-------------|
| Cold start | La API se “duerme”; el 1er request puede tardar 30–60 s |
| Postgres free | Se borra tras ~90 días de inactividad (plan free) |
| Uso real en planta | Mejor plan de pago o VPS cuando pasen a producción diaria |

Para **pruebas y demos por internet** el free alcanza.  
Para **operación diaria** de empaque: plan de pago (~$7–25/mes) o VPS.

---

## Checklist post-deploy

- [ ] `/` del API responde  
- [ ] `/docs` abre Swagger  
- [ ] Register del primer admin OK  
- [ ] Login en la UI  
- [ ] Recepción limón  
- [ ] Dashboard limón (fechas y desverdizado)  
- [ ] Empaque + inventario final  
- [ ] Embarque y descuento de stock  
- [ ] Cambiar contraseña de admin  

---

## ¿Y Lovable entonces?

Úsalo **solo si** quieres:

- Landing comercial del producto  
- Mockups de UI nueva  
- Un front “bonito” que consuma la API ya desplegada  

No lo uses para reescribir recepción/empaque/embarques desde cero: **ya lo tienes**.

Flujo futuro opcional:

```
API en Render (este repo)  ←──  UI nueva hecha en Lovable (fetch a /api)
```

---

## Qué necesito de ti para seguir contigo el deploy

1. ¿Tienes (o puedes crear) cuenta **GitHub**?  
2. ¿Prefieres **Render** (recomendado) o **Railway**?  
3. ¿El código ya está en un repo remoto o solo en tu Mac?

Cuando digas “vamos con Render”, te guío click a click (o preparamos el push del repo desde aquí).

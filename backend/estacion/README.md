# Estación climática (módulo aparte)

Se monta desde `app/main.py` con `registrar_estacion(app)`. Si falla, AgroPack sigue empacando.

Usa la misma `DATABASE_URL` (driver **psycopg2**, el que ya tiene AgroPack) o `ESTACION_DATABASE_URL`. Crea solo tablas `estacion_*` con su propio `MetaData`. No importa modelos de AgroPack.

## Variables (no van secretos en el repo)

| Variable | Si falta |
|---|---|
| `ESTACION_HABILITADA` | Por defecto encendida. `0`, `false` o `no` no monta rutas ni abre la base. |
| `ESTACION_INGEST_TOKEN` | La ingesta responde 503 y no acepta datos. |
| `ESTACION_SECRET` | Se inventa uno al arrancar; las sesiones de la estación se pierden al reiniciar. |
| `ESTACION_ADMIN_USER` | Por defecto `admin`. No es una contraseña. |
| `ESTACION_ADMIN_PASS` | No hay valor por defecto y el repo no trae una. Sin esta variable no se crea usuario y el login no entra. En producción tiene que ser larga y distinta de `admin` / `clave123`. |
| `ESTACION_MAX_MB` | Tope de disco, 150 MB si no se define. |
| `ESTACION_DATABASE_URL` | Si no está, usa `DATABASE_URL`. |

En local, para probar la pantalla: definir las cuatro primeras (token, secret, user, pass) y dejar `ESTACION_HABILITADA` sin poner o en `1`.

## Tablas que crea al desplegar

`estacion_lecturas`, `estacion_agregados_hora`, `estacion_estado_receptora`, `estacion_alertas`, `estacion_comandos`, `estacion_config`, `estacion_nodo_eval`, `estacion_trabajos`, `estacion_usuarios`.

Sin claves foráneas hacia el resto de AgroPack.

## Contrato de la receptora

`POST /api/estacion/v1/ingesta` con `Authorization: Bearer <ESTACION_INGEST_TOKEN>`.

El CSV acepta 23 campos (sin epoch), 24 (v4.2, epoch al final) o 27. Los 27 son el de 24 más `eInt,Tint,Hint` al final; el epoch sigue en el campo 24. Aire, PIR y suelo quedan en las mismas posiciones. La caja no entra al promedio de aire. Otro largo, o la caja en medio, se rechaza y no se guarda.

## Pruebas

```bash
cd backend && python -m pytest -q estacion/tests
```

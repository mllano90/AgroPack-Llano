# Estación climática (módulo aparte)

Se monta desde `app/main.py` con `registrar_estacion(app)`. Si falla, AgroPack sigue empacando.

Usa la misma `DATABASE_URL` (driver **psycopg2**, el que ya tiene AgroPack) o `ESTACION_DATABASE_URL`. Crea solo tablas `estacion_*` con su propio `MetaData`. No importa modelos de AgroPack.

## Variables (no van secretos en el repo)

| Variable | Si falta |
|---|---|
| `ESTACION_HABILITADA` | Por defecto encendida. `0`, `false` o `no` no monta rutas ni abre la base. |
| `ESTACION_INGEST_TOKEN` | La ingesta responde 503 y no acepta datos. |
| `ESTACION_SECRET` | Se inventa uno al arrancar; las sesiones de la estación se pierden al reiniciar. |
| `ESTACION_ADMIN_USER` | Por defecto `admin`. |
| `ESTACION_ADMIN_PASS` | No se crea usuario; el login de la estación no entra. |
| `ESTACION_MAX_MB` | Tope de disco, 150 MB si no se define. |
| `ESTACION_DATABASE_URL` | Si no está, usa `DATABASE_URL`. |

En local, para probar la pantalla: definir las cuatro primeras (token, secret, user, pass) y dejar `ESTACION_HABILITADA` sin poner o en `1`.

## Tablas que crea al desplegar

`estacion_lecturas`, `estacion_agregados_hora`, `estacion_estado_receptora`, `estacion_alertas`, `estacion_comandos`, `estacion_config`, `estacion_nodo_eval`, `estacion_trabajos`, `estacion_usuarios`.

Sin claves foráneas hacia el resto de AgroPack.

## Pruebas

```bash
cd backend && python -m pytest -q estacion/tests
```

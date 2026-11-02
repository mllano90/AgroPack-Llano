import os
import sys
from pathlib import Path

import pytest

# tests viven en backend/estacion/tests; el paquete se importa desde backend/
TESTS = Path(__file__).resolve().parent
PAQUETE = TESTS.parent
BACKEND = PAQUETE.parent
sys.path.insert(0, str(TESTS))             # principal.py de las pruebas
sys.path.insert(0, str(PAQUETE / "sim"))   # simulador.py
sys.path.insert(0, str(BACKEND))
TOKEN = "token-de-prueba"
TABLAS = ["estacion_lecturas", "estacion_alertas", "estacion_config", "estacion_nodo_eval", "estacion_estado_receptora",
          "estacion_comandos", "estacion_agregados_hora", "estacion_trabajos", "estacion_usuarios"]


@pytest.fixture()
def cliente(tmp_path):
    """App standalone limpia. SQLite temporal por defecto; con TEST_DATABASE_URL usa Postgres (vacía tablas)."""
    url = os.environ.get("TEST_DATABASE_URL", "")
    os.environ["DATABASE_URL"] = url or f"sqlite:///{tmp_path / 'prueba.db'}"
    os.environ.update(ESTACION_INGEST_TOKEN=TOKEN, ESTACION_ADMIN_USER="admin", ESTACION_ADMIN_PASS="clave123",
                      ESTACION_SECRET="x" * 32, ESTACION_INTERVALO_TRABAJO_S="3600")
    from estacion.ajustes import ajustes
    ajustes.recargar()
    from estacion import router as rmod
    rmod._ventana.clear()
    rmod._fallos.clear()
    from estacion import db
    from estacion.modelos import crear_tablas
    if url:
        from sqlalchemy import text
        motor = db.crear_motor(db.url_desde_entorno())
        crear_tablas(motor)
        with motor.begin() as c:
            for t in TABLAS:
                c.execute(text(f"DELETE FROM {t}"))
        motor.dispose()
    import importlib
    import principal
    importlib.reload(principal)
    from fastapi.testclient import TestClient
    with TestClient(principal.app) as c:
        c.db = db
        yield c
    from estacion.integracion import detener_hilo_trabajo
    detener_hilo_trabajo()
    db._motor.dispose()


def auth():
    return {"Authorization": f"Bearer {TOKEN}"}


def login(c):
    r = c.post("/api/estacion/auth/login", json={"usuario": "admin", "clave": "clave123"})
    assert r.status_code == 200, r.text
    c.headers["Authorization"] = "Bearer " + r.json()["token"]


def procesar(c, t=None):
    """Corre el trabajo en segundo plano (alertas, marcas suelo/NPK, agregados) como lo hace el bucle."""
    from estacion import servicio
    from estacion.db import Cx
    s = c.db.fabrica()()
    try:
        return servicio.ciclo_mantenimiento(Cx(s), t)
    finally:
        s.close()


def cx(c):
    from estacion.db import Cx
    return Cx(c.db.fabrica()())

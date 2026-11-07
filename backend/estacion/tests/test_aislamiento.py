"""El módulo no puede tumbar ni tocar la app anfitriona."""
import os

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _anfitrion():
    app = FastAPI()

    @app.get("/api/empaque/ping")
    def ping():
        return {"ok": True}
    return app


def test_fallo_al_registrar_no_tumba_anfitrion(tmp_path, monkeypatch):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'a.db'}"
    os.environ["ESTACION_HABILITADA"] = "1"
    import estacion.modelos as m

    def roto(_):
        raise RuntimeError("fallo simulado creando tablas")
    monkeypatch.setattr(m, "crear_tablas", roto)
    from estacion.integracion import registrar_estacion
    app = _anfitrion()
    assert registrar_estacion(app, iniciar_trabajo=False) is False
    c = TestClient(app)
    assert c.get("/api/empaque/ping").json() == {"ok": True}
    assert c.post("/api/estacion/v1/ingesta", json={}).status_code == 404


def test_fallo_de_import_no_tumba_anfitrion(tmp_path, monkeypatch):
    import builtins
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'b.db'}"
    real = builtins.__import__

    def falso(name, *a, **k):
        if name.endswith("router") and a and a[0] and a[0].get("__package__") == "estacion":
            raise ImportError("dependencia faltante simulada")
        return real(name, *a, **k)
    import sys
    sys.modules.pop("estacion.router", None)
    monkeypatch.setattr(builtins, "__import__", falso)
    from estacion.integracion import registrar_estacion
    app = _anfitrion()
    assert registrar_estacion(app, iniciar_trabajo=False) is False
    monkeypatch.setattr(builtins, "__import__", real)
    assert TestClient(app).get("/api/empaque/ping").status_code == 200


def test_flag_deshabilitada(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'c.db'}"
    os.environ["ESTACION_HABILITADA"] = "0"
    try:
        from estacion.integracion import registrar_estacion
        app = _anfitrion()
        assert registrar_estacion(app, iniciar_trabajo=False) is False
        c = TestClient(app)
        assert c.get("/api/estacion/salud").status_code == 404
        assert c.get("/api/empaque/ping").status_code == 200
        assert not (tmp_path / "c.db").exists()           # ni siquiera crea la BD
    finally:
        os.environ["ESTACION_HABILITADA"] = "1"


def test_solo_tablas_prefijadas_y_sin_fk():
    from estacion.modelos import Base
    for t in Base.metadata.sorted_tables:
        assert t.name.startswith("estacion_"), t.name
        assert not t.foreign_keys, t.name


def test_tabla_vieja_recibe_columnas_de_caja(tmp_path):
    """Una estacion_lecturas del PR 9 (sin caja) gana las columnas al volver a arrancar."""
    from sqlalchemy import create_engine, inspect, text
    from estacion.modelos import crear_tablas
    motor = create_engine(f"sqlite:///{tmp_path / 'vieja.db'}")
    with motor.begin() as c:
        c.execute(text("CREATE TABLE estacion_lecturas (id INTEGER PRIMARY KEY, csv VARCHAR(128) NOT NULL)"))
    crear_tablas(motor)
    cols = {c["name"] for c in inspect(motor).get_columns("estacion_lecturas")}
    assert {"e_int", "t_int", "h_int"} <= cols


def test_sin_variables_ingesta_cerrada_y_proceso_sigue(tmp_path, monkeypatch):
    for k in ("ESTACION_INGEST_TOKEN", "INGEST_TOKEN", "ESTACION_ADMIN_PASS", "ADMIN_PASS",
              "ESTACION_ADMIN_USER", "ADMIN_USER", "ESTACION_SECRET", "SECRET"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'd.db'}")
    monkeypatch.setenv("ESTACION_HABILITADA", "1")
    from estacion.integracion import registrar_estacion
    app = _anfitrion()
    assert registrar_estacion(app, iniciar_trabajo=False) is True
    c = TestClient(app)
    assert c.get("/api/empaque/ping").status_code == 200
    assert c.get("/api/estacion/salud").status_code == 200
    r = c.post("/api/estacion/v1/ingesta", json={"nodo": "nodo1", "registros": [{"csv": "D,1"}]})
    assert r.status_code == 503
    login = c.post("/api/estacion/auth/login", json={"usuario": "admin", "clave": "admin"})
    assert login.status_code == 401


def test_no_importa_modulos_ajenos():
    import ast
    import pathlib
    base = pathlib.Path(__file__).resolve().parent.parent
    permitidos = {"fastapi", "sqlalchemy", "starlette", "base64", "hashlib", "hmac", "json", "secrets", "time", "os",
                  "re", "csv", "io", "logging", "asyncio", "threading", "argparse", "datetime", "concurrent", "pathlib",
                  "psycopg"}
    archivos = list(base.glob("*.py"))
    assert len(archivos) >= 8, archivos
    for f in archivos:
        for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if isinstance(n, ast.Import):
                mods = [a.name.split(".")[0] for a in n.names]
            elif isinstance(n, ast.ImportFrom) and n.level == 0:
                mods = [n.module.split(".")[0]]
            else:
                continue
            for m in mods:
                assert m in permitidos, f"{f.name} importa {m}"


def test_css_sin_selectores_globales():
    import pathlib
    import re
    css_path = None
    for base in pathlib.Path(__file__).resolve().parents:
        candidato = base / "frontend" / "src" / "estacion" / "estacion.css"
        if candidato.is_file():
            css_path = candidato
            break
    assert css_path is not None, "no está frontend/src/estacion/estacion.css"
    css = css_path.read_text(encoding="utf-8")
    sin_media = re.sub(r"@media[^{]+\{", "", css)
    for sel in re.findall(r"(?:^|})\s*([^{}@]+)\{", sin_media):
        for s in sel.split(","):
            assert s.strip().startswith(".estacion-root"), s

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


def test_no_importa_modulos_ajenos():
    import ast
    import pathlib
    base = pathlib.Path(__file__).resolve().parent.parent / "estacion"
    permitidos = {"fastapi", "sqlalchemy", "starlette", "base64", "hashlib", "hmac", "json", "secrets", "time", "os",
                  "re", "csv", "io", "logging", "asyncio", "threading", "argparse", "datetime", "concurrent", "pathlib",
                  "psycopg"}
    for f in base.glob("*.py"):
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

#!/usr/bin/env python3
"""
Productos nuevos (catálogo) + el esquema viejo no se altera.

Levanta el API dos veces:
  1. SQLite con el esquema anterior (scripts/fixtures/schema_existente.sql) y filas
     de uva, limón y melón. Al arrancar, esas tablas y esas filas siguen igual.
  2. SQLite vacío. create_all crea las tablas nuevas y deja las viejas como el fixture.

Después, en los dos casos:
  - un usuario que no es admin recibe 403 al registrar productos o tipos de caja
  - el admin registra un producto, lo configura (bins, kg, 1ra y 2da) y recorre
    recepción → empaque desde bins → inventario → embarque → reportes
  - el inventario de uva/limón/melón del dashboard no absorbe esas cajas

Uso:
  python3 scripts/test_productos_nuevos.py
"""

from __future__ import annotations

import json
import os
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FIXTURE = ROOT / "scripts" / "fixtures" / "schema_existente.sql"

NEW_TABLES = [
    "catalogo_tipos_cosecha",
    "catalogo_tipos_caja",
    "productos_catalogo",
    "producto_parametros",
    "catalogo_recepciones",
    "catalogo_inventario_campo",
    "catalogo_empaques",
    "catalogo_inventario_final",
    "catalogo_embarques",
    "catalogo_embarque_lineas",
]
# El seed de hectáreas melón reescribe esta tabla al arrancar (comportamiento previo).
ROW_EXACT = [
    "recepcion_campo",
    "empaque",
    "inventario_campo",
    "inventario_final",
    "inventario_desverdizado",
    "embarque",
    "embarque_detalle",
    "parrilla",
    "productos",
]
ROW_KEEP_IDS = ["users", "clientes"]

FAILS: list[str] = []


def check(cond: bool, msg: str) -> None:
    print(("OK  " if cond else "FAIL") + " " + msg, flush=True)
    if not cond:
        FAILS.append(msg)


def req(base: str, method: str, path: str, token: str | None = None, body=None, form=None):
    url = base.rstrip("/") + path
    headers = {}
    data = None
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            raw = resp.read().decode() or "null"
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = raw
            return resp.status, parsed
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"detail": raw}
        return e.code, parsed


def known_tables(sql: str) -> list[str]:
    import re

    return re.findall(r"CREATE TABLE (\w+)", sql)


def schema_snapshot(path: str, tables: list[str]) -> dict:
    con = sqlite3.connect(path)
    out = {}
    for table in tables:
        sqls = [
            row[0]
            for row in con.execute(
                "SELECT sql FROM sqlite_master WHERE tbl_name = ? AND sql IS NOT NULL ORDER BY sql",
                (table,),
            )
        ]
        cols = [(r[1], r[2]) for r in con.execute(f"PRAGMA table_info('{table}')")]
        out[table] = {"sql": sqls, "cols": cols}
    con.close()
    return out


def dump_rows(path: str, table: str) -> list[tuple]:
    con = sqlite3.connect(path)
    rows = con.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
    con.close()
    return [tuple(r) for r in rows]


def table_names(path: str) -> set[str]:
    con = sqlite3.connect(path)
    names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    con.close()
    return names


def count_rows(path: str, table: str) -> int:
    con = sqlite3.connect(path)
    n = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    con.close()
    return int(n)


def build_existing(path: str) -> None:
    if os.path.exists(path):
        os.remove(path)
    sql = FIXTURE.read_text()
    con = sqlite3.connect(path)
    con.executescript(sql)
    from passlib.context import CryptContext

    pwd = CryptContext(schemes=["sha256_crypt"], deprecated="auto")
    admin_hash = pwd.hash("admin123")
    other_hash = pwd.hash("sentinel")
    con.execute(
        "INSERT INTO users (id, username, nombre_completo, rol, hashed_password) VALUES (?,?,?,?,?)",
        (1, "admin", "Admin Sentinel", "ADMIN", admin_hash),
    )
    con.execute(
        "INSERT INTO users (id, username, nombre_completo, rol, hashed_password) VALUES (?,?,?,?,?)",
        (2, "sentinel", "Usuario Sentinel", "OBSERVADOR", other_hash),
    )
    con.execute(
        "INSERT INTO clientes (id, nombre, activo) VALUES (?,?,?)",
        (1, "Cliente Sentinel", 1),
    )
    con.execute(
        """INSERT INTO recepcion_campo
           (id, producto, variedad, cantidad_cajas_campo, mercado, lote, cantidad_bins, fecha)
           VALUES (?,?,?,?,?,?,?,?)""",
        (1, "UVA", "EARLY_SWEET", 10, "NACIONAL", None, 0, "2026-01-15"),
    )
    con.execute(
        """INSERT INTO recepcion_campo
           (id, producto, cantidad_cajas_campo, mercado, lote, cantidad_bins, fecha)
           VALUES (?,?,?,?,?,?,?)""",
        (2, "LIMON_AMARILLO", 0, "NACIONAL", "8503 S1C1", 4, "2026-01-15"),
    )
    con.execute(
        """INSERT INTO recepcion_campo
           (id, producto, cantidad_cajas_campo, mercado, lote, cantidad_bins, fecha)
           VALUES (?,?,?,?,?,?,?)""",
        (3, "MELON", 0, "NACIONAL", "Rancho S5 Diputado", 6, "2026-01-15"),
    )
    con.execute(
        """INSERT INTO empaque
           (id, producto, mercado, cantidad_cajas_campo_usadas, cantidad_cajas_carton_producidas,
            numero_empacador, presentacion, talla, calidad, cantidad_producida)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (1, "LIMON_AMARILLO", "NACIONAL", 0, 0, "EMP-S", "rpc_18", "140", "primera", 10),
    )
    con.execute(
        """INSERT INTO empaque
           (id, producto, mercado, cantidad_cajas_campo_usadas, cantidad_cajas_carton_producidas,
            numero_empacador, presentacion, talla, calidad, cantidad_producida)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (2, "MELON", "NACIONAL", 0, 0, "EMP-S", "caja_normal_b", "9", "llano", 5),
    )
    con.execute(
        """INSERT INTO empaque
           (id, producto, mercado, cantidad_cajas_campo_usadas, cantidad_cajas_carton_producidas,
            numero_empacador)
           VALUES (?,?,?,?,?,?)""",
        (3, "UVA", "NACIONAL", 3, 3, "EMP-S"),
    )
    con.execute(
        "INSERT INTO inventario_campo (id, variedad, mercado, cantidad_disponible) VALUES (?,?,?,?)",
        (1, "EARLY_SWEET", "NACIONAL", 10),
    )
    con.execute(
        "INSERT INTO inventario_final (id, producto, mercado, cantidad_stock) VALUES (?,?,?,?)",
        (1, "UVA", "NACIONAL", 7),
    )
    con.execute(
        "INSERT INTO inventario_final (id, producto, mercado, cantidad_stock) VALUES (?,?,?,?)",
        (2, "LIMON_AMARILLO", "NACIONAL", 10),
    )
    con.execute(
        "INSERT INTO inventario_final (id, producto, mercado, cantidad_stock) VALUES (?,?,?,?)",
        (3, "MELON", "NACIONAL", 5),
    )
    con.execute(
        """INSERT INTO inventario_desverdizado
           (id, producto, cantidad_bins, lote, fecha_recepcion, fecha_tentativa_salida, estado)
           VALUES (?,?,?,?,?,?,?)""",
        (1, "LIMON_AMARILLO", 4, "8503 S1C1", "2026-01-15", "2026-01-22", "en_desverdizado"),
    )
    con.execute(
        "INSERT INTO embarque (id, cliente_id, estado, notas) VALUES (?,?,?,?)",
        (1, 1, "en_transito", "sentinel"),
    )
    con.execute(
        """INSERT INTO embarque_detalle
           (id, embarque_id, producto, mercado, cantidad_cajas, presentacion, talla, calidad)
           VALUES (?,?,?,?,?,?,?,?)""",
        (1, 1, "LIMON_AMARILLO", "NACIONAL", 2, "rpc_18", "140", "primera"),
    )
    con.execute(
        "INSERT INTO parrilla (id, nombre, estado, cantidad) VALUES (?,?,?,?)",
        (1, "sentinel", "disponible", 1),
    )
    con.execute(
        "INSERT INTO productos (id, nombre, codigo, activo) VALUES (?,?,?,?)",
        (1, "Sentinel", "sentinel", 1),
    )
    con.commit()
    con.close()


def start_server(db_path: str, port: int) -> subprocess.Popen:
    env = os.environ.copy()
    env["SECRET_KEY"] = "test-productos-nuevos"
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    env["DEBUG"] = "0"
    log_path = os.path.join(tempfile.gettempdir(), f"agropack_catalogo_{port}.log")
    log = open(log_path, "w")
    kwargs: dict = dict(
        cwd=str(BACKEND),
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    if os.name == "nt":
        # Grupo propio: terminate/taskkill no arrastra la consola del test.
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
        **kwargs,
    )
    proc._log_path = log_path  # type: ignore[attr-defined]
    return proc


def wait_server(proc: subprocess.Popen, port: int) -> str:
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 40
    last = ""
    while time.time() < deadline:
        if proc.poll() is not None:
            log = Path(proc._log_path).read_text()[-2000:]  # type: ignore[attr-defined]
            raise SystemExit(f"el API en {port} terminó\n{log}")
        try:
            code, body = req(base, "GET", "/api/health/db")
            if code == 200 and isinstance(body, dict) and body.get("status") == "ok":
                return base
            last = str(body)
        except Exception as exc:
            last = str(exc)
        time.sleep(0.4)
    log = Path(proc._log_path).read_text()[-2000:]  # type: ignore[attr-defined]
    raise SystemExit(f"timeout {port}: {last}\n{log}")


def _kill_windows_tree(pid: int) -> None:
    """taskkill /T mata el proceso y los hijos (uvicorn no se queda en el puerto)."""
    subprocess.run(
        ["taskkill", "/F", "/T", "/PID", str(pid)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def stop_server(proc: subprocess.Popen | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    if os.name == "nt":
        pid = proc.pid
        try:
            proc.terminate()
        except OSError:
            pass
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            pass
        _kill_windows_tree(pid)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
            except OSError:
                pass
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError:
        proc.terminate()
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, OSError):
            proc.kill()


def login(base: str, username: str, password: str) -> str:
    code, body = req(base, "POST", "/api/auth/login", form={"username": username, "password": password})
    ok = code == 200 and isinstance(body, dict) and body.get("access_token")
    check(ok, f"login {username} {code} {body}")
    if not ok:
        return ""
    return body["access_token"]


def register(base: str, token: str | None, username: str, rol: str, password: str = "secret123") -> int:
    code, body = req(
        base,
        "POST",
        "/api/auth/register",
        token=token,
        body={
            "username": username,
            "nombre_completo": username,
            "rol": rol,
            "password": password,
        },
    )
    return code


def ejercitar(base: str, admin: str, tag: str, tocar_legacy: bool) -> None:
    code, _ = req(base, "POST", "/api/auth/register", token=admin, body={
        "username": f"recep_{tag}",
        "nombre_completo": "Recepcion",
        "rol": "recepcion",
        "password": "secret123",
    })
    check(code == 200, f"{tag} alta usuario recepción {code}")
    recep = login(base, f"recep_{tag}", "secret123")
    if not admin or not recep:
        return

    code, body = req(base, "POST", "/api/catalogo/productos", token=recep, body={"nombre": "No Debo"})
    check(code == 403, f"{tag} no-admin no crea producto ({code})")
    code, _ = req(base, "POST", "/api/catalogo/tipos-caja", token=recep, body={"nombre": "Caja prohibida"})
    check(code == 403, f"{tag} no-admin no crea tipo de caja ({code})")
    code, _ = req(base, "POST", "/api/catalogo/tipos-cosecha", token=recep, body={"nombre": "Arpilla prohibida"})
    check(code == 403, f"{tag} no-admin no crea tipo de cosecha ({code})")

    code, cosechas = req(base, "GET", "/api/catalogo/tipos-cosecha", token=admin)
    codigos = {c.get("codigo") for c in cosechas} if isinstance(cosechas, list) else set()
    check(code == 200 and {"bins", "cajas_campo"} <= codigos, f"{tag} cosechas fijas sin seed {codigos}")

    code, caja1 = req(base, "POST", "/api/catalogo/tipos-caja", token=admin, body={"nombre": f"Caja export {tag}"})
    check(code == 200 and caja1.get("id"), f"{tag} alta tipo caja 1ra {code} {caja1}")
    code, caja2 = req(base, "POST", "/api/catalogo/tipos-caja", token=admin, body={"nombre": f"Caja nacional {tag}"})
    check(code == 200 and caja2.get("id"), f"{tag} alta tipo caja 2da {code} {caja2}")
    code, tipos = req(base, "GET", "/api/catalogo/tipos-caja", token=recep)
    ids = {t.get("id") for t in tipos} if isinstance(tipos, list) else set()
    check(caja1.get("id") in ids and caja2.get("id") in ids, f"{tag} los tipos de caja se reutilizan en el listado")

    code, prod = req(base, "POST", "/api/catalogo/productos", token=admin, body={"nombre": f"Mango {tag}"})
    check(code == 200 and prod.get("codigo"), f"{tag} admin crea producto {code} {prod}")
    check(prod.get("configurado") is False, f"{tag} el alta solo guarda el nombre")
    code, _ = req(base, "PUT", f"/api/catalogo/productos/{prod['id']}", token=recep, body={
        "tipo_cosecha": "bins",
        "peso_contenedor_kg": 1,
        "parametros": [{"calidad": "primera", "tipo_caja_id": caja1["id"], "kg": 1, "cajas_por_parrilla": 10}],
    })
    check(code == 403, f"{tag} no-admin no configura ({code})")

    code, conf = req(base, "PUT", f"/api/catalogo/productos/{prod['id']}", token=admin, body={
        "tipo_cosecha": "bins",
        "peso_contenedor_kg": 200,
        "hectareas": 10,
        "parametros": [
            {"calidad": "primera", "tipo_caja_id": caja1["id"], "kg": 10, "cajas_por_parrilla": 40},
            {"calidad": "segunda", "tipo_caja_id": caja2["id"], "kg": 15, "cajas_por_parrilla": 30},
        ],
    })
    check(code == 200 and conf.get("configurado") is True, f"{tag} configuración {code}")
    params = {p["calidad"]: p for p in conf.get("parametros") or []}
    check(set(params) == {"primera", "segunda"}, f"{tag} 1ra y 2da quedan por separado {params.keys()}")

    # Otro producto reutiliza el mismo tipo de caja.
    code, otro = req(base, "POST", "/api/catalogo/productos", token=admin, body={"nombre": f"Sandia {tag}"})
    code2, _ = req(base, "PUT", f"/api/catalogo/productos/{otro['id']}", token=admin, body={
        "tipo_cosecha": "cajas_campo",
        "peso_contenedor_kg": 18,
        "parametros": [
            {"calidad": "primera", "tipo_caja_id": caja1["id"], "kg": 8, "cajas_por_parrilla": 20},
        ],
    })
    check(code == 200 and code2 == 200, f"{tag} segundo producto reutiliza el tipo de caja {code} {code2}")
    code, _ = req(base, "DELETE", f"/api/catalogo/productos/{otro['id']}", token=admin)
    check(code == 200, f"{tag} se borra un producto sin movimientos {code}")

    code, rec = req(base, "POST", "/api/catalogo/recepciones", token=admin, body={
        "producto_id": prod["id"],
        "cantidad": 20,
        "lote": "Norte",
    })
    check(code == 200 and rec.get("cantidad_disponible") == 20, f"{tag} recepción 20 bins {code} {rec}")

    code, malo = req(base, "POST", "/api/catalogo/empaques", token=recep, body={
        "producto_id": prod["id"],
        "lote": "Norte",
        "cantidad_campo": 1,
        "lineas": [{"parametro_id": params["primera"]["id"], "cantidad": 1}],
    })
    check(code == 403, f"{tag} recepción no empaca ({code})")

    code, emp = req(base, "POST", "/api/catalogo/empaques", token=admin, body={
        "producto_id": prod["id"],
        "lote": "Norte",
        "cantidad_campo": 8,
        "lineas": [
            {"parametro_id": params["primera"]["id"], "cantidad": 20},
            {"parametro_id": params["segunda"]["id"], "cantidad": 10},
        ],
    })
    check(code == 200 and emp.get("campo_restante") == 12, f"{tag} empaque desde bins {code} {emp}")

    code, sobra = req(base, "POST", "/api/catalogo/empaques", token=admin, body={
        "producto_id": prod["id"],
        "lote": "Norte",
        "cantidad_campo": 100,
        "lineas": [{"parametro_id": params["primera"]["id"], "cantidad": 1}],
    })
    check(code == 400, f"{tag} no empaca más bins de los que hay ({code})")

    code, inv = req(base, "GET", f"/api/catalogo/inventario?producto_id={prod['id']}", token=admin)
    por_cal = {i["calidad"]: i for i in inv} if isinstance(inv, list) else {}
    check(
        code == 200 and por_cal.get("primera", {}).get("cantidad_stock") == 20 and por_cal.get("segunda", {}).get("cantidad_stock") == 10,
        f"{tag} inventario final {code} {inv}",
    )

    code, cli = req(base, "POST", "/api/clientes/", token=admin, body={"nombre": f"Cliente {tag}"})
    check(code in (200, 201) and cli.get("id"), f"{tag} cliente {code} {cli}")
    code, emb = req(base, "POST", "/api/catalogo/embarques", token=admin, body={
        "cliente_id": cli["id"],
        "lineas": [{"inventario_id": por_cal["primera"]["id"], "cantidad": 5}],
    })
    check(code == 200, f"{tag} embarque {code} {emb}")
    code, inv2 = req(base, "GET", f"/api/catalogo/inventario?producto_id={prod['id']}", token=admin)
    prima = next((i for i in inv2 if i["calidad"] == "primera"), {})
    check(prima.get("cantidad_stock") == 15, f"{tag} el embarque descuenta inventario ({prima})")

    code, rep = req(base, "GET", f"/api/catalogo/reportes/{prod['id']}", token=recep)
    kg_campo = 20 * 200
    kg1 = 20 * 10
    kg2 = 10 * 15
    parrillas = 20 / 40
    check(code == 200, f"{tag} reporte {code}")
    if isinstance(rep, dict):
        check(abs(rep["kg_campo"] - kg_campo) < 1e-6, f"{tag} kg campo {rep.get('kg_campo')}")
        check(abs(rep["kg_primera"] - kg1) < 1e-6, f"{tag} kg 1ra {rep.get('kg_primera')}")
        check(abs(rep["kg_segunda"] - kg2) < 1e-6, f"{tag} kg 2da {rep.get('kg_segunda')}")
        check(abs(rep["pct_primera"] - round(kg1 / kg_campo * 100, 2)) < 1e-6, f"{tag} % 1ra {rep.get('pct_primera')}")
        check(abs(rep["pct_segunda"] - round(kg2 / kg_campo * 100, 2)) < 1e-6, f"{tag} % 2da {rep.get('pct_segunda')}")
        check(abs(rep["parrillas_primera"] - round(parrillas, 4)) < 1e-6, f"{tag} parrillas {rep.get('parrillas_primera')}")
        check(
            abs(rep["contenedores_por_parrilla"] - round(20 / parrillas, 4)) < 1e-6,
            f"{tag} bins/parrilla {rep.get('contenedores_por_parrilla')}",
        )
        check(abs((rep.get("ton_por_ha") or 0) - round((kg1 + kg2) / 1000 / 10, 4)) < 1e-6, f"{tag} ton/ha {rep.get('ton_por_ha')}")
        check(abs((rep.get("kg_primera_por_ha") or 0) - round(kg1 / 10, 2)) < 1e-6, f"{tag} kg/ha 1ra")
        pres = rep.get("por_presentacion_primera") or []
        check(len(pres) == 1 and abs(pres[0]["pct"] - 100) < 1e-6 and pres[0]["cajas"] == 20, f"{tag} % 1ra en la caja {pres}")
        check(rep.get("contenedores") == 20, f"{tag} contenedores recibidos {rep.get('contenedores')}")
        emb_rep = rep.get("embarques") or []
        check(emb_rep and emb_rep[0]["lineas"][0]["cantidad"] == 5, f"{tag} el reporte lista el embarque")

    code, listed = req(base, "GET", "/api/catalogo/productos", token=recep)
    nombres = {p.get("nombre") for p in listed} if isinstance(listed, list) else set()
    check(f"Mango {tag}" in nombres, f"{tag} el producto aparece en el listado")

    # Lo empacado del catálogo no entra al inventario de uva/limón/melón.
    code, dash = req(base, "GET", "/api/reports/dashboard")
    finales = dash.get("inventario_final") if isinstance(dash, dict) else None
    check(code == 200 and isinstance(finales, list), f"{tag} dashboard {code}")
    if isinstance(finales, list):
        marcas = " ".join(json.dumps(i, default=str) for i in finales)
        check("Caja export" not in marcas and f"Mango {tag}" not in marcas, f"{tag} el dashboard no mezcla el catálogo")

    if not tocar_legacy:
        code, _ = req(base, "DELETE", f"/api/catalogo/productos/{prod['id']}", token=admin)
        check(code == 409, f"{tag} no se borra un producto con movimientos ({code})")
        return

    antes = req(base, "GET", f"/api/catalogo/reportes/{prod['id']}", token=admin)[1]
    code, lim = req(base, "POST", "/api/recepcion/", token=admin, body={
        "producto": "limon_amarillo",
        "lote": f"Lote limon {tag}",
        "cantidad_bins": 3,
        "fecha_corte": "2026-03-01",
    })
    check(code == 200, f"{tag} recepción limón sigue viva {code} {lim}")
    code, uva = req(base, "POST", "/api/recepcion/", token=admin, body={
        "producto": "uva",
        "variedad": "early_sweet",
        "cantidad_cajas_campo": 4,
        "cantidad_cajas_carton": 0,
        "mercado": "nacional",
    })
    check(code == 200, f"{tag} recepción uva sigue viva {code} {uva}")
    code, melon = req(base, "POST", "/api/recepcion/", token=admin, body={
        "producto": "melon",
        "lote": "Rancho S5 Diputado",
        "cantidad_bins": 2,
        "fecha_corte": "2026-03-02",
    })
    check(code == 200, f"{tag} recepción melón sigue viva {code} {melon}")
    despues = req(base, "GET", f"/api/catalogo/reportes/{prod['id']}", token=admin)[1]
    check(
        isinstance(antes, dict) and isinstance(despues, dict) and antes.get("kg_primera") == despues.get("kg_primera") and antes.get("contenedores") == despues.get("contenedores"),
        f"{tag} limón/uva/melón no mueven los indicadores del producto nuevo",
    )
    code, dash2 = req(base, "GET", "/api/reports/dashboard")
    desv = dash2.get("desverdizado") if isinstance(dash2, dict) else []
    check(
        any(str(d.get("lote")) == f"Lote limon {tag}" and int(d.get("cantidad_bins_disponibles") or 0) == 3 for d in desv or []),
        f"{tag} el bin de limón quedó en desverdizado",
    )
    campo = dash2.get("inventario_campo") if isinstance(dash2, dict) else []
    check(
        any(d.get("variedad") == "early_sweet" and int(d.get("cantidad") or 0) >= 4 for d in campo or []),
        f"{tag} la uva sumó cajas de campo",
    )

    code, rend = req(base, "GET", "/api/reports/rendimientos-limon", token=admin)
    check(code == 200, f"{tag} reporte limón responde {code}")
    code, _ = req(base, "DELETE", f"/api/catalogo/productos/{prod['id']}", token=admin)
    check(code == 409, f"{tag} no se borra un producto con movimientos ({code})")


def assert_schema(path: str, before: dict, label: str) -> None:
    after = schema_snapshot(path, list(before))
    for table, snap in before.items():
        check(after[table]["sql"] == snap["sql"], f"{label} SQL de {table} intacto")
        check(after[table]["cols"] == snap["cols"], f"{label} columnas de {table} intactas")


def assert_rows(path: str, before_rows: dict, label: str) -> None:
    for table, rows in before_rows.items():
        check(dump_rows(path, table) == rows, f"{label} filas de {table} intactas")


def assert_kept_ids(path: str, before_rows: dict, label: str) -> None:
    for table, rows in before_rows.items():
        now = dump_rows(path, table)
        # La primera columna es el id.
        previos = {r[0]: r for r in rows}
        actuales = {r[0]: r for r in now}
        ok = all(actuales.get(i) == row for i, row in previos.items())
        check(ok, f"{label} filas previas de {table} intactas")


def main() -> int:
    if not FIXTURE.exists():
        print("Falta", FIXTURE)
        return 1
    sql = FIXTURE.read_text()
    tables = known_tables(sql)
    check(len(tables) >= 12, f"fixture con {len(tables)} tablas")

    existing = "/tmp/agropack_catalogo_existente.db"
    fresh = "/tmp/agropack_catalogo_fresco.db"
    for p in (existing, fresh):
        if os.path.exists(p):
            os.remove(p)

    print("\n=== Esquema existente ===", flush=True)
    build_existing(existing)
    schema_before = schema_snapshot(existing, tables)
    rows_exact = {t: dump_rows(existing, t) for t in ROW_EXACT}
    rows_ids = {t: dump_rows(existing, t) for t in ROW_KEEP_IDS}
    proc = start_server(existing, 8765)
    try:
        base = wait_server(proc, 8765)
        names = table_names(existing)
        check(all(t in names for t in NEW_TABLES), "arranque en BD existente crea solo tablas nuevas")
        check(count_rows(existing, "catalogo_tipos_caja") == 0, "no siembra tipos de caja")
        check(count_rows(existing, "catalogo_tipos_cosecha") == 0, "no siembra tipos de cosecha")
        check(count_rows(existing, "productos_catalogo") == 0, "no siembra productos")
        assert_schema(existing, schema_before, "arranque")
        assert_rows(existing, rows_exact, "arranque")
        admin = login(base, "admin", "admin123")
        ejercitar(base, admin, "existente", tocar_legacy=False)
        assert_schema(existing, schema_before, "después del flujo")
        assert_rows(existing, rows_exact, "después del flujo")
        assert_kept_ids(existing, rows_ids, "después del flujo")
    finally:
        stop_server(proc)

    print("\n=== SQLite nuevo ===", flush=True)
    proc = start_server(fresh, 8766)
    try:
        base = wait_server(proc, 8766)
        names = table_names(fresh)
        check(all(t in names for t in NEW_TABLES), "BD nueva tiene las tablas del catálogo")
        # El fixture describe las tablas viejas; create_all debe reproducirlas.
        fresco = schema_snapshot(fresh, tables)
        for table, snap in schema_before.items():
            check(fresco[table]["cols"] == snap["cols"], f"BD nueva columnas de {table}")
            check(fresco[table]["sql"] == snap["sql"], f"BD nueva SQL de {table}")
        check(count_rows(fresh, "recepcion_campo") == 0, "BD nueva no trae recepciones")
        code = register(base, None, "admin", "admin", "admin123")
        check(code == 200, f"primer admin en BD nueva {code}")
        admin = login(base, "admin", "admin123")
        ejercitar(base, admin, "fresco", tocar_legacy=True)
        despues = schema_snapshot(fresh, tables)
        for table, snap in schema_before.items():
            check(despues[table]["sql"] == snap["sql"], f"el flujo no altera el SQL de {table}")
            check(despues[table]["cols"] == snap["cols"], f"el flujo no altera columnas de {table}")
    finally:
        stop_server(proc)

    print("\nFALLOS", len(FAILS))
    for msg in FAILS:
        print(" -", msg)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())

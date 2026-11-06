"""
La talla #18 de melón se acepta en primera LLANO y se rechaza en segunda Wallys.

SQLite en /tmp. No toca la base del proyecto ni el esquema.

    python3 scripts/test_melon_talla_18.py
"""
import os
import sys
from pathlib import Path

os.environ["SECRET_KEY"] = "test-secret-melon-talla-18"
os.environ["DATABASE_URL"] = "sqlite:////tmp/test_melon_talla_18.db"
os.environ["DEBUG"] = "0"

try:
    os.remove("/tmp/test_melon_talla_18.db")
except FileNotFoundError:
    pass

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient
from app.main import app
from app.utils.melon_tallas import (
    MENSAJE_TALLA_18_WALLYS,
    TALLAS_POR_PRESENTACION_MELON,
    norm_talla_melon,
    talla_18_prohibida_en_calidad,
)

client = TestClient(app)
FAILS = []
LOTE = "Rancho S5 Diputado"


def check(cond, msg):
    print(("OK  " if cond else "FAIL") + " " + msg)
    if not cond:
        FAILS.append(msg)


def detail_of(r):
    try:
        d = r.json().get("detail")
    except Exception:
        return r.text
    if isinstance(d, list):
        return " ".join(str(x) for x in d)
    return str(d or r.text)


def auth():
    r = client.post(
        "/api/auth/register",
        json={
            "username": "admin",
            "password": "admin123",
            "nombre_completo": "Admin",
            "rol": "admin",
        },
    )
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/login", data={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def recepcion(h, bins=40):
    r = client.post(
        "/api/recepcion/",
        headers=h,
        json={
            "producto": "melon",
            "mercado": "nacional",
            "lote": LOTE,
            "cantidad_bins": bins,
            "fecha_corte": "2026-10-20",
            "cantidad_cajas_campo": 0,
        },
    )
    check(r.status_code == 200, f"recepcion {r.status_code} {r.text[:160]}")


def bins_disponibles(h):
    r = client.get("/api/recepcion/bins-melon", headers=h)
    check(r.status_code == 200, f"bins {r.status_code}")
    total = 0
    for row in r.json():
        if row.get("lote") == LOTE:
            total += int(row.get("cantidad_bins_disponibles") or 0)
    return total


def empaque(h, produccion, bins=2):
    return client.post(
        "/api/empaque/",
        headers=h,
        json={
            "producto": "melon",
            "mercado": "nacional",
            "fecha": "2026-10-21",
            "numero_empacador": "EMP-01",
            "bins_desverdizado_usados": bins,
            "consumos_desverdizado": [
                {"lote": LOTE, "bins": bins, "fecha_recepcion": "2026-10-20"}
            ],
            "produccion": produccion,
        },
    )


def linea(talla, calidad, cantidad=10, presentacion="caja_normal_b"):
    return {
        "presentacion": presentacion,
        "talla": talla,
        "cantidad": cantidad,
        "calidad": calidad,
        "lote": LOTE,
    }


def cajas_talla(h, talla, calidad):
    r = client.get("/api/correcciones/inventario/final", headers=h)
    check(r.status_code == 200, f"inventario {r.status_code}")
    total = 0
    for row in r.json():
        if str(row.get("producto") or "").lower() != "melon":
            continue
        if norm_talla_melon(row.get("talla")) != norm_talla_melon(talla):
            continue
        if str(row.get("calidad") or "").lower() != calidad:
            continue
        total += int(row.get("cantidad_stock") or 0)
    return total


def main():
    check(
        TALLAS_POR_PRESENTACION_MELON["caja_chica_a"] == ("9", "12", "15", "18"),
        "chica orden 9,12,15,18",
    )
    check(
        TALLAS_POR_PRESENTACION_MELON["caja_normal_b"] == ("9", "12", "15", "18"),
        "normal orden 9,12,15,18",
    )
    check(
        TALLAS_POR_PRESENTACION_MELON["caja_jumbo_c"] == ("6", "9", "12", "18"),
        "jumbo orden 6,9,12,18",
    )
    check(norm_talla_melon("#18s") == "18", "normaliza #18s")
    check(talla_18_prohibida_en_calidad("18", "wallys"), "18 wallys prohibida")
    check(talla_18_prohibida_en_calidad("18s", "2da"), "18s 2da prohibida")
    check(not talla_18_prohibida_en_calidad("18", "llano"), "18 llano permitida")
    check(not talla_18_prohibida_en_calidad("18", "1ra LLANO"), "1ra LLANO permitida")
    check(not talla_18_prohibida_en_calidad("15", "wallys"), "15 wallys sigue válida")
    check(not talla_18_prohibida_en_calidad("9", "llano"), "9 llano sigue válida")

    h = auth()
    recepcion(h, 40)
    bins0 = bins_disponibles(h)
    check(bins0 == 40, f"bins iniciales {bins0}")

    ok18 = empaque(h, [linea("18", "llano", 12)], bins=2)
    check(ok18.status_code == 200, f"empaque #18 llano {ok18.status_code} {ok18.text[:200]}")
    emp18 = ok18.json()["id"] if ok18.status_code == 200 else None
    check(cajas_talla(h, "18", "llano") == 12, "stock #18 llano = 12")
    check(cajas_talla(h, "18", "wallys") == 0, "no hay stock #18 wallys")

    bad = empaque(h, [linea("18", "wallys", 5)], bins=2)
    check(bad.status_code == 400, f"rechaza #18 wallys {bad.status_code} {detail_of(bad)[:180]}")
    check(MENSAJE_TALLA_18_WALLYS in detail_of(bad), f"mensaje español: {detail_of(bad)[:180]}")
    check(cajas_talla(h, "18", "wallys") == 0, "el rechazo no creó stock wallys")
    check(cajas_talla(h, "18", "llano") == 12, "el rechazo no movió el stock llano")

    bad_alias = empaque(h, [linea("#18s", "2da", 4)], bins=1)
    check(bad_alias.status_code == 400, f"rechaza #18s / 2da {bad_alias.status_code}")
    check(MENSAJE_TALLA_18_WALLYS in detail_of(bad_alias), "mismo mensaje para #18s")

    # Tallas que ya existían, en LLANO y en Wallys.
    previas = empaque(
        h,
        [
            linea("6", "llano", 8, "caja_jumbo_c"),
            linea("9", "wallys", 7, "caja_chica_a"),
            linea("12", "llano", 6, "caja_normal_b"),
            linea("15", "wallys", 5, "caja_chica_a"),
        ],
        bins=3,
    )
    check(previas.status_code == 200, f"tallas 6/9/12/15 {previas.status_code} {previas.text[:220]}")
    check(cajas_talla(h, "6", "llano") == 8, "stock #6 llano")
    check(cajas_talla(h, "9", "wallys") == 7, "stock #9 wallys")
    check(cajas_talla(h, "12", "llano") == 6, "stock #12 llano")
    check(cajas_talla(h, "15", "wallys") == 5, "stock #15 wallys")

    otras = empaque(
        h,
        [
            linea("18", "llano", 4, "caja_chica_a"),
            linea("18", "llano", 3, "caja_jumbo_c"),
        ],
        bins=2,
    )
    check(otras.status_code == 200, f"#18 en chica y jumbo {otras.status_code} {otras.text[:200]}")
    check(cajas_talla(h, "18", "llano") == 19, "stock #18 llano suma las tres cajas")

    bins_antes_edit = bins_disponibles(h)
    ed = client.put(
        f"/api/empaque/{emp18}/editar",
        headers=h,
        json={
            "produccion": [linea("18", "wallys", 12)],
            "fecha": "2026-10-21",
        },
    )
    check(ed.status_code == 400, f"editar a wallys {ed.status_code} {detail_of(ed)[:160]}")
    check(MENSAJE_TALLA_18_WALLYS in detail_of(ed), "editar explica que #18 es solo LLANO")
    check(cajas_talla(h, "18", "llano") == 19, "editar rechazado no quitó LLANO")
    check(cajas_talla(h, "18", "wallys") == 0, "editar rechazado no creó Wallys")
    check(bins_disponibles(h) == bins_antes_edit, "editar rechazado no movió bins")

    # Reempaque: el resultado #18 Wallys no se guarda; #18 LLANO sí.
    re_bad = client.post(
        "/api/correcciones/reempaque-melon",
        headers=h,
        json={
            "fecha_origen": "2026-10-21",
            "fecha_reempaque": "2026-10-22",
            "salidas": [
                {
                    "empaque_id": emp18,
                    "presentacion": "caja_normal_b",
                    "talla": "18",
                    "calidad": "llano",
                    "lote": LOTE,
                    "cantidad": 4,
                }
            ],
            "resultados": [
                {
                    "presentacion": "caja_normal_b",
                    "talla": "18",
                    "calidad": "wallys",
                    "cantidad": 3,
                }
            ],
        },
    )
    check(re_bad.status_code == 400, f"reempaque wallys {re_bad.status_code} {detail_of(re_bad)[:160]}")
    check(MENSAJE_TALLA_18_WALLYS in detail_of(re_bad), "reempaque usa el mismo mensaje")
    check(cajas_talla(h, "18", "llano") == 19, "reempaque rechazado no descontó cajas")

    re_ok = client.post(
        "/api/correcciones/reempaque-melon",
        headers=h,
        json={
            "fecha_origen": "2026-10-21",
            "fecha_reempaque": "2026-10-22",
            "salidas": [
                {
                    "empaque_id": emp18,
                    "presentacion": "caja_normal_b",
                    "talla": "18",
                    "calidad": "llano",
                    "lote": LOTE,
                    "cantidad": 4,
                }
            ],
            "resultados": [
                {
                    "presentacion": "caja_chica_a",
                    "talla": "18",
                    "calidad": "llano",
                    "cantidad": 3,
                }
            ],
        },
    )
    check(re_ok.status_code == 200, f"reempaque #18 llano {re_ok.status_code} {re_ok.text[:220]}")
    # 19 - 4 salidas + 3 resultado = 18, todo LLANO
    check(cajas_talla(h, "18", "llano") == 18, f"tras reempaque llano quedan 18, hay {cajas_talla(h, '18', 'llano')}")
    check(cajas_talla(h, "18", "wallys") == 0, "reempaque no creó #18 wallys")

    inv_bad = client.post(
        "/api/correcciones/inventario/final",
        headers=h,
        json={
            "producto": "melon",
            "mercado": "nacional",
            "cantidad_stock": 9,
            "presentacion": "caja_normal_b",
            "talla": "18",
            "calidad": "wallys",
        },
    )
    check(inv_bad.status_code == 400, f"alta inventario wallys {inv_bad.status_code}")
    check(MENSAJE_TALLA_18_WALLYS in detail_of(inv_bad), "alta inventario explica el rechazo")

    inv_ok = client.post(
        "/api/correcciones/inventario/final",
        headers=h,
        json={
            "producto": "melon",
            "mercado": "nacional",
            "cantidad_stock": 2,
            "presentacion": "caja_normal_b",
            "talla": "#18s",
            "calidad": "llano",
        },
    )
    check(inv_ok.status_code == 200, f"alta inventario llano {inv_ok.status_code} {inv_ok.text[:180]}")
    if inv_ok.status_code == 200:
        body = inv_ok.json()
        check(body.get("producto") == "melon", f"el alta queda como melón ({body.get('producto')})")
        check(body.get("talla") == "18", f"talla normalizada {body.get('talla')}")
        check(str(body.get("calidad")).lower() == "llano", f"calidad {body.get('calidad')}")

    inv9 = client.post(
        "/api/correcciones/inventario/final",
        headers=h,
        json={
            "producto": "melon",
            "mercado": "nacional",
            "cantidad_stock": 4,
            "presentacion": "caja_normal_b",
            "talla": "9",
            "calidad": "wallys",
        },
    )
    check(inv9.status_code == 200, f"alta #9 wallys {inv9.status_code} {inv9.text[:160]}")
    check(cajas_talla(h, "18", "wallys") == 0, "sigue sin haber #18 wallys")

    # Limón no entra en esta regla: una talla 140 de limón se sigue guardando.
    rlim = client.post(
        "/api/correcciones/inventario/final",
        headers=h,
        json={
            "producto": "limon_amarillo",
            "mercado": "nacional",
            "cantidad_stock": 11,
            "presentacion": "caja_40lbs",
            "talla": "140",
            "calidad": "primera",
        },
    )
    check(rlim.status_code == 200, f"limón 140 sigue {rlim.status_code} {rlim.text[:160]}")
    if rlim.status_code == 200:
        check(rlim.json().get("producto") == "limon_amarillo", "limón no se reclasifica")
        check(rlim.json().get("talla") == "140", "talla limón intacta")

    print("\nFALLOS", len(FAILS))
    for f in FAILS:
        print(" -", f)
    if FAILS:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

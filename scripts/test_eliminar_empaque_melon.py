"""
Verifica el borrado de un proceso de empaque de melón contra un SQLite vacío en /tmp.

No toca la base de producción ni la base local del proyecto.
Requiere las dependencias del backend y el paquete httpx.

    python3 scripts/test_eliminar_empaque_melon.py
"""
import os
import sys
from datetime import date
from pathlib import Path

os.environ["SECRET_KEY"] = "test-secret-key-repro"
os.environ["DATABASE_URL"] = "sqlite:////tmp/test_eliminar_empaque_melon.db"
os.environ["DEBUG"] = "0"

try:
    os.remove("/tmp/test_eliminar_empaque_melon.db")
except FileNotFoundError:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi.testclient import TestClient
from app.main import app
from app.core.database import SessionLocal
from app.models.inventory import (
    Embarque,
    Empaque,
    InventarioDesverdizado,
    InventarioFinal,
    RecepcionCampo,
)

client = TestClient(app)
FAILS = []


def check(cond, msg):
    print(("OK  " if cond else "FAIL") + " " + msg)
    if not cond:
        FAILS.append(msg)


def snap():
    db = SessionLocal()
    bins = [
        {
            "id": d.id,
            "lote": d.lote,
            "bins": int(d.cantidad_bins or 0),
            "fecha": str(d.fecha_recepcion),
            "estado": d.estado,
            "rec": d.recepcion_id,
        }
        for d in db.query(InventarioDesverdizado)
        .filter(InventarioDesverdizado.producto == "MELON")
        .order_by(InventarioDesverdizado.id)
        .all()
    ]
    # enum may be Producto.MELON not string
    if not bins:
        bins = [
            {
                "id": d.id,
                "lote": d.lote,
                "bins": int(d.cantidad_bins or 0),
                "fecha": str(d.fecha_recepcion),
                "estado": d.estado,
                "prod": str(d.producto),
            }
            for d in db.query(InventarioDesverdizado).order_by(InventarioDesverdizado.id).all()
        ]
    emps = []
    for e in db.query(Empaque).order_by(Empaque.id).all():
        det = e.detalle_corrida if isinstance(e.detalle_corrida, dict) else {}
        emps.append(
            {
                "id": e.id,
                "fecha": str(e.fecha),
                "prod": str(e.producto),
                "tipo": (det or {}).get("tipo"),
                "anulado": (det or {}).get("anulado"),
                "consumos": (det or {}).get("consumos"),
                "produccion": (det or {}).get("produccion"),
            }
        )
    inv = [
        {
            "id": i.id,
            "stock": int(i.cantidad_stock or 0),
            "prod": str(i.producto),
            "extra": i.atributos_extra,
        }
        for i in db.query(InventarioFinal).order_by(InventarioFinal.id).all()
    ]
    recs = db.query(RecepcionCampo).count()
    db.close()
    return {"bins": bins, "emps": emps, "inv": inv, "recs": recs}


def auth():
    r = client.post(
        "/api/auth/register",
        json={
            "username": "admin",
            "password": "admin123",
            "nombre_completo": "Admin Test",
            "rol": "admin",
        },
    )
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/login", data={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def recepcion(h, lote, bins, fecha):
    r = client.post(
        "/api/recepcion/",
        headers=h,
        json={
            "producto": "melon",
            "mercado": "nacional",
            "lote": lote,
            "cantidad_bins": bins,
            "fecha_corte": fecha,
            "cantidad_cajas_campo": 0,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def empacar(h, fecha, lote, fecha_corte, bins, lineas):
    r = client.post(
        "/api/empaque/",
        headers=h,
        json={
            "producto": "melon",
            "mercado": "nacional",
            "fecha": fecha,
            "numero_empacador": "EMP-01",
            "bins_desverdizado_usados": bins,
            "consumos_desverdizado": [
                {"lote": lote, "bins": bins, "fecha_recepcion": fecha_corte}
            ],
            "produccion": lineas,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def linea(fecha, lote, cant, cal, talla="9"):
    return {
        "presentacion": "caja_normal_b",
        "talla": talla,
        "cantidad": cant,
        "calidad": cal,
        "fecha_empaque": fecha,
        "lote": lote,
        "cajas_por_parrilla": 56,
    }


def main():
    h = auth()
    lote = "Rancho S5 Diputado"
    recepcion(h, lote, 10, "2026-10-01")
    recepcion(h, lote, 8, "2026-10-05")
    recepcion(h, "Bajio S2 Krypto", 6, "2026-10-02")

    a = empacar(
        h,
        "2026-10-20",
        lote,
        "2026-10-01",
        4,
        [linea("2026-10-20", lote, 56, "llano"), linea("2026-10-20", lote, 20, "wallys")],
    )
    b = empacar(
        h,
        "2026-10-21",
        lote,
        "2026-10-05",
        3,
        [linea("2026-10-21", lote, 40, "llano")],
    )
    c = empacar(
        h,
        "2026-10-20",
        "Bajio S2 Krypto",
        "2026-10-02",
        2,
        [linea("2026-10-20", "Bajio S2 Krypto", 15, "llano", talla="12")],
    )
    s = snap()
    print("AFTER CREATE", s["inv"])
    llano_rows = [i for i in s["inv"] if (i["extra"] or {}).get("calidad") == "llano" and (i["extra"] or {}).get("talla") == "9"]
    check(len(llano_rows) == 2, f"dos filas llano #9 (días distintos), hay {len(llano_rows)}")
    fechas = sorted((i["extra"] or {}).get("fecha_empaque") for i in llano_rows)
    check(fechas == ["2026-10-20", "2026-10-21"], f"fechas inventario {fechas}")
    stocks = sorted(i["stock"] for i in llano_rows)
    check(stocks == [40, 56], f"stocks llano {stocks}")

    # Lemon must still refuse delete of active empaque — create a tiny lemon flow
    rl = client.post(
        "/api/recepcion/",
        headers=h,
        json={
            "producto": "limon_amarillo",
            "mercado": "nacional",
            "lote": "8502 S2C3",
            "cantidad_bins": 5,
            "fecha_corte": "2026-08-01",
            "cantidad_cajas_campo": 0,
        },
    )
    check(rl.status_code == 200, f"recepcion limon {rl.status_code}")
    el = client.post(
        "/api/empaque/",
        headers=h,
        json={
            "producto": "limon_amarillo",
            "mercado": "nacional",
            "fecha": "2026-08-10",
            "numero_empacador": "EMP-01",
            "bins_desverdizado_usados": 2,
            "lote_desverdizado": "8502 S2C3",
            "consumos_desverdizado": [
                {"lote": "8502 S2C3", "bins": 2, "fecha_recepcion": "2026-08-01"}
            ],
            "produccion": [
                {
                    "presentacion": "rpc_granel",
                    "talla": "140",
                    "cantidad": 10,
                    "lote": "8502 S2C3",
                    "fecha_empaque": "2026-08-10",
                }
            ],
        },
    )
    check(el.status_code == 200, f"empaque limon {el.status_code} {el.text[:200]}")
    limon_id = el.json()["id"]
    bad = client.delete(f"/api/empaque/{limon_id}", headers=h)
    check(bad.status_code == 400, f"limon activo no se borra directo ({bad.status_code})")
    an = client.post(f"/api/empaque/{limon_id}/anular", headers=h)
    check(an.status_code == 200, f"anular limon {an.status_code} {an.text[:180]}")
    # limon record still there
    s2 = snap()
    check(any(e["id"] == limon_id and e["anulado"] for e in s2["emps"]), "limon anulado sigue en historial")

    before_del = snap()
    bins_before = {(b["lote"], b["fecha"]): b["bins"] for b in before_del["bins"] if "Rancho" in b["lote"] or "Bajio" in b["lote"]}
    # delete A
    d = client.delete(f"/api/empaque/{a['id']}", headers=h)
    check(d.status_code == 200, f"delete A {d.status_code} {d.text[:250]}")
    d2 = client.delete(f"/api/empaque/{a['id']}", headers=h)
    check(d2.status_code == 404, f"segundo delete A es 404 ({d2.status_code}) {d2.text[:120]}")

    after = snap()
    check(all(e["id"] != a["id"] for e in after["emps"]), "proceso A ya no existe")
    b_left = next(e for e in after["emps"] if e["id"] == b["id"])
    c_left = next(e for e in after["emps"] if e["id"] == c["id"])
    check(b_left["anulado"] in (None, False), "proceso B sigue activo")
    check(c_left["anulado"] in (None, False), "proceso C (otro lote) sigue activo")
    check(
        sum(int(p["cantidad"]) for p in b_left["produccion"]) == 40,
        "cajas de B no cambiaron",
    )
    check(
        sum(int(p["cantidad"]) for p in c_left["produccion"]) == 15,
        "cajas de C no cambiaron",
    )

    inv_pos = [i for i in after["inv"] if i["stock"] > 0 and "MELON" in i["prod"].upper()]
    # B 40 llano fecha 21, C 15 talla 12, no A's 56/20
    llano9 = [
        i
        for i in inv_pos
        if (i["extra"] or {}).get("talla") == "9" and (i["extra"] or {}).get("calidad") == "llano"
    ]
    check(len(llano9) == 1, f"una sola fila llano #9 viva, hay {len(llano9)} {llano9}")
    if llano9:
        check(llano9[0]["stock"] == 40, f"stock llano #9 = 40 (solo B), hay {llano9[0]['stock']}")
        check(
            (llano9[0]["extra"] or {}).get("fecha_empaque") == "2026-10-21",
            f"fecha de la fila viva es la de B, hay {(llano9[0]['extra'] or {}).get('fecha_empaque')}",
        )
    wallys = [
        i
        for i in after["inv"]
        if (i["extra"] or {}).get("calidad") == "wallys" and i["stock"] > 0
    ]
    check(wallys == [], f"wallys de A desapareció, quedan {wallys}")
    cero = [i for i in after["inv"] if i["stock"] == 0 and "MELON" in i["prod"].upper()]
    check(cero == [], f"no quedan filas de melón en cero {cero}")

    bins_after = {(b["lote"], b["fecha"]): b["bins"] for b in after["bins"]}
    # A used 4 of 10 on 2026-10-01 → back to 10. B used 3 of 8 on 10-05 → stays 5. C used 2 of 6 → stays 4.
    print("BINS AFTER", bins_after)
    check(bins_after.get((lote, "2026-10-01")) == 10, "bins corte 10-01 devueltos a 10")
    check(bins_after.get((lote, "2026-10-05")) == 5, "bins corte 10-05 de B siguen en 5")
    check(bins_after.get(("Bajio S2 Krypto", "2026-10-02")) == 4, "bins de C siguen en 4")
    # no duplicate bin rows
    keys = [(b["lote"], b["fecha"]) for b in after["bins"]]
    check(len(keys) == len(set(keys)), f"no hay filas de bins duplicadas {keys}")

    # reempaque then delete blocked
    re = client.post(
        "/api/correcciones/reempaque-melon",
        headers=h,
        json={
            "fecha_origen": "2026-10-21",
            "fecha_reempaque": "2026-10-22",
            "salidas": [
                {
                    "empaque_id": b["id"],
                    "presentacion": "caja_normal_b",
                    "talla": "9",
                    "calidad": "llano",
                    "lote": lote,
                    "cantidad": 10,
                }
            ],
            "resultados": [
                {
                    "presentacion": "caja_normal_b",
                    "talla": "12",
                    "calidad": "llano",
                    "lote": lote,
                    "cantidad": 8,
                }
            ],
        },
    )
    check(re.status_code == 200, f"reempaque {re.status_code} {re.text[:250]}")
    blocked = client.delete(f"/api/empaque/{b['id']}", headers=h)
    check(blocked.status_code == 409, f"delete con reempaque pide confirmación {blocked.status_code} {blocked.text[:300]}")
    try:
        body_b = blocked.json().get("detail")
    except Exception:
        body_b = None
    check(
        isinstance(body_b, dict) and body_b.get("code") == "confirmar_reempaques",
        f"409 trae code confirmar_reempaques ({body_b})",
    )
    still = snap()
    check(any(e["id"] == b["id"] for e in still["emps"]), "B sigue después del bloqueo")
    # cajas de B: 40-10+8 = 38 on the process? salida 10, resultado 8 added. 30 remaining original + 8 new = 38
    bnow = next(e for e in still["emps"] if e["id"] == b["id"])
    cajas_b = sum(int(p["cantidad"]) for p in bnow["produccion"])
    check(cajas_b == 38, f"producción de B no se tocó al bloquear el delete ({cajas_b})")

    # edit C then delete
    ed = client.put(
        f"/api/empaque/{c['id']}/editar",
        headers=h,
        json={
            "consumos": [
                {"lote": "Bajio S2 Krypto", "bins": 1, "fecha_recepcion": "2026-10-02"}
            ],
            "produccion": [linea("2026-10-20", "Bajio S2 Krypto", 7, "llano", talla="12")],
            "fecha": "2026-10-20",
        },
    )
    check(ed.status_code == 200, f"editar C {ed.status_code} {ed.text[:200]}")
    bins_mid = snap()
    bajio_mid = next(x["bins"] for x in bins_mid["bins"] if x["lote"] == "Bajio S2 Krypto")
    # started 6, used 2, edit returns 1 (2→1) so available 5
    check(bajio_mid == 5, f"tras editar C quedan 5 bins bajio, hay {bajio_mid}")
    dc = client.delete(f"/api/empaque/{c['id']}", headers=h)
    check(dc.status_code == 200, f"delete C editado {dc.status_code} {dc.text[:200]}")
    end = snap()
    bajio = next(x["bins"] for x in end["bins"] if x["lote"] == "Bajio S2 Krypto")
    check(bajio == 6, f"delete C devolvió el bin que aún tenía (6), hay {bajio}")
    t12 = [
        i
        for i in end["inv"]
        if (i["extra"] or {}).get("talla") == "12" and i["stock"] > 0 and "MELON" in i["prod"].upper()
        and (i["extra"] or {}).get("lote") == "Bajio S2 Krypto"
    ]
    # reempaque added talla 12 on Rancho, not Bajio. Bajio talla 12 should be gone.
    check(t12 == [], f"cajas editadas de C desaparecieron {t12}")
    check(all(e["id"] != c["id"] for e in end["emps"]), "C borrado")

    # shipment blocks delete of a fresh process
    dlt = "Lomas S1 Diputado"
    recepcion(h, dlt, 5, "2026-10-03")
    ship_emp = empacar(
        h,
        "2026-10-23",
        dlt,
        "2026-10-03",
        2,
        [linea("2026-10-23", dlt, 30, "llano", talla="15")],
    )
    cli = client.post(
        "/api/clientes/",
        headers=h,
        json={"nombre": "Cliente QA", "activo": 1},
    )
    check(cli.status_code in (200, 201), f"cliente {cli.status_code} {cli.text[:160]}")
    emb = client.post(
        "/api/embarques/",
        headers=h,
        json={
            "cliente_id": cli.json()["id"],
            "notas": "qa",
            "detalles": [
                {
                    "producto": "melon",
                    "mercado": "nacional",
                    "cantidad_cajas": 10,
                    "presentacion": "caja_normal_b",
                    "talla": "15",
                    "calidad": "llano",
                }
            ],
        },
    )
    check(emb.status_code == 200, f"embarque {emb.status_code} {emb.text[:200]}")
    before_ship_del = snap()
    t15 = [
        i
        for i in before_ship_del["inv"]
        if (i["extra"] or {}).get("talla") == "15" and "MELON" in i["prod"].upper()
    ]
    check(
        len(t15) == 1 and t15[0]["stock"] == 20,
        f"embarque descontó 10 de las 30 cajas #15, hay {t15}",
    )
    blocked2 = client.delete(f"/api/empaque/{ship_emp['id']}", headers=h)
    check(
        blocked2.status_code == 409,
        f"delete con cajas embarcadas bloqueado {blocked2.status_code} {blocked2.text[:240]}",
    )
    after_block = snap()
    check(
        any(e["id"] == ship_emp["id"] and not e["anulado"] for e in after_block["emps"]),
        "proceso embarcado sigue",
    )
    # bins of that lote unchanged by the blocked delete
    def bins_lote(s, name):
        return sum(x["bins"] for x in s["bins"] if x["lote"] == name)

    check(
        bins_lote(before_ship_del, dlt) == bins_lote(after_block, dlt),
        "bins no se movieron al bloquear por embarque",
    )

    # reempaque date list of other day still lists B, not A
    disp = client.get(
        "/api/correcciones/reempaque-melon/disponibles?fecha=2026-10-21", headers=h
    )
    check(disp.status_code == 200, "disponibles 10-21")
    ids = [p["empaque_id"] for p in disp.json().get("procesos") or []]
    check(b["id"] in ids and a["id"] not in ids, f"lista reempaque 10-21 = {ids}")
    disp20 = client.get(
        "/api/correcciones/reempaque-melon/disponibles?fecha=2026-10-20", headers=h
    )
    ids20 = [p["empaque_id"] for p in disp20.json().get("procesos") or []]
    check(a["id"] not in ids20 and c["id"] not in ids20, f"10-20 sin A ni C {ids20}")

    hist = client.get("/api/correcciones/reempaque-melon/historial", headers=h)
    items = hist.json().get("items") or []
    check(len(items) == 1, f"sigue un reempaque (el de B), hay {len(items)}")

    # Escenario del usuario: 10 bins, empacar, reempacar.
    def bins_de(nombre):
        return sum(x["bins"] for x in snap()["bins"] if x["lote"] == nombre)

    def cajas_inv(talla, lote_n, fecha):
        return [
            i
            for i in snap()["inv"]
            if "MELON" in i["prod"].upper()
            and (i["extra"] or {}).get("talla") == talla
            and (i["extra"] or {}).get("lote") == lote_n
            and (i["extra"] or {}).get("fecha_empaque") == fecha
            and i["stock"] > 0
        ]

    lote10 = "Rancho S1 Krypto"
    recepcion(h, lote10, 10, "2026-10-08")
    proc = empacar(
        h,
        "2026-10-25",
        lote10,
        "2026-10-08",
        10,
        [linea("2026-10-25", lote10, 40, "llano", talla="9")],
    )
    check(bins_de(lote10) == 0, f"los 10 bins quedaron empacados, piso={bins_de(lote10)}")
    re1 = client.post(
        "/api/correcciones/reempaque-melon",
        headers=h,
        json={
            "fecha_origen": "2026-10-25",
            "fecha_reempaque": "2026-10-26",
            "salidas": [
                {
                    "empaque_id": proc["id"],
                    "presentacion": "caja_normal_b",
                    "talla": "9",
                    "calidad": "llano",
                    "lote": lote10,
                    "cantidad": 10,
                }
            ],
            "resultados": [
                {
                    "presentacion": "caja_normal_b",
                    "talla": "12",
                    "calidad": "llano",
                    "lote": lote10,
                    "cantidad": 7,
                }
            ],
        },
    )
    check(re1.status_code == 200, f"reempaque escenario A {re1.status_code} {re1.text[:200]}")
    re1_id = re1.json()["id"]
    # (a) borrar solo el reempaque
    del_re = client.delete(f"/api/empaque/{re1_id}", headers=h)
    check(del_re.status_code == 200, f"delete reempaque {del_re.status_code} {del_re.text[:240]}")
    check(bins_de(lote10) == 0, f"bins no se movieron al borrar reempaque ({bins_de(lote10)})")
    vivo = next(e for e in snap()["emps"] if e["id"] == proc["id"])
    check(
        sum(int(p["cantidad"]) for p in vivo["produccion"] if str(p.get("talla")) == "9") == 40,
        f"volvieron las 40 cajas #9 al proceso {vivo['produccion']}",
    )
    check(
        sum(int(p["cantidad"]) for p in vivo["produccion"] if str(p.get("talla")) == "12") == 0,
        "ya no hay cajas #12 del reempaque en el proceso",
    )
    inv9 = cajas_inv("9", lote10, "2026-10-25")
    inv12 = cajas_inv("12", lote10, "2026-10-25")
    check(len(inv9) == 1 and inv9[0]["stock"] == 40, f"inventario #9 del día original = 40 {inv9}")
    check(inv12 == [], f"inventario #12 del reempaque desapareció {inv12}")
    hist_a = client.get("/api/correcciones/reempaque-melon/historial", headers=h).json()
    check(
        all(it["id"] != re1_id for it in hist_a.get("items") or []),
        "el reempaque ya no está en el historial",
    )
    del_re2 = client.delete(f"/api/empaque/{re1_id}", headers=h)
    check(del_re2.status_code == 404, f"segundo delete del reempaque es 404 ({del_re2.status_code})")
    check(bins_de(lote10) == 0, "el segundo clic no devolvió bins")
    # luego borrar el proceso original: los 10 bins vuelven una vez
    del_p = client.delete(f"/api/empaque/{proc['id']}", headers=h)
    check(del_p.status_code == 200, f"delete proceso tras reempaque {del_p.status_code} {del_p.text[:200]}")
    check(bins_de(lote10) == 10, f"volvieron exactamente 10 bins ({bins_de(lote10)})")
    check(cajas_inv("9", lote10, "2026-10-25") == [], "no quedan cajas del proceso")
    check(all(e["id"] != proc["id"] for e in snap()["emps"]), "el proceso ya no existe")
    del_p2 = client.delete(f"/api/empaque/{proc['id']}", headers=h)
    check(del_p2.status_code == 404, "segundo delete del proceso es 404")
    check(bins_de(lote10) == 10, f"los bins siguen en 10, no se duplicaron ({bins_de(lote10)})")
    filas_lote = [(b["lote"], b["fecha"], b["bins"]) for b in snap()["bins"] if b["lote"] == lote10]
    check(len(filas_lote) == 1 and filas_lote[0][2] == 10, f"una sola fila de bins {filas_lote}")

    # (b) borrar el día original directo, confirmando que se lleva el reempaque
    lote_b = "Bajio S3 Diputado"
    recepcion(h, lote_b, 10, "2026-10-09")
    proc_b = empacar(
        h,
        "2026-10-27",
        lote_b,
        "2026-10-09",
        10,
        [linea("2026-10-27", lote_b, 40, "llano", talla="9")],
    )
    re_b = client.post(
        "/api/correcciones/reempaque-melon",
        headers=h,
        json={
            "fecha_origen": "2026-10-27",
            "fecha_reempaque": "2026-10-28",
            "salidas": [
                {
                    "empaque_id": proc_b["id"],
                    "presentacion": "caja_normal_b",
                    "talla": "9",
                    "calidad": "llano",
                    "lote": lote_b,
                    "cantidad": 12,
                }
            ],
            "resultados": [
                {
                    "presentacion": "caja_normal_b",
                    "talla": "15",
                    "calidad": "wallys",
                    "lote": lote_b,
                    "cantidad": 9,
                }
            ],
        },
    )
    check(re_b.status_code == 200, f"reempaque escenario B {re_b.status_code} {re_b.text[:180]}")
    re_b_id = re_b.json()["id"]
    sin_flag = client.delete(f"/api/empaque/{proc_b['id']}", headers=h)
    check(sin_flag.status_code == 409, "sin confirmación no borra el proceso con reempaque")
    check(bins_de(lote_b) == 0, "sin confirmación los bins no se mueven")
    con_flag = client.delete(
        f"/api/empaque/{proc_b['id']}?confirmar_reempaques=true", headers=h
    )
    check(con_flag.status_code == 200, f"delete confirmado {con_flag.status_code} {con_flag.text[:260]}")
    check(bins_de(lote_b) == 10, f"escenario B devolvió 10 bins ({bins_de(lote_b)})")
    sfin = snap()
    check(all(e["id"] not in (proc_b["id"], re_b_id) for e in sfin["emps"]), "proceso y reempaque borrados")
    check(
        cajas_inv("9", lote_b, "2026-10-27") == [] and cajas_inv("15", lote_b, "2026-10-27") == [],
        "no quedan cajas del día ni del reempaque",
    )
    ceros = [i for i in sfin["inv"] if i["stock"] == 0 and "MELON" in i["prod"].upper() and (i["extra"] or {}).get("lote") == lote_b]
    check(ceros == [], f"sin filas en cero de ese lote {ceros}")
    filas_b = [b for b in sfin["bins"] if b["lote"] == lote_b]
    check(len(filas_b) == 1 and filas_b[0]["bins"] == 10, f"sin bins duplicados {filas_b}")
    hist_b = client.get("/api/correcciones/reempaque-melon/historial", headers=h).json()
    check(all(it["id"] != re_b_id for it in hist_b.get("items") or []), "historial sin ese reempaque")

    # Cadena: el reempaque nuevo bloquea borrar el viejo; borrar el proceso deshace los dos
    lote_c = "Lomas S4 Krypto"
    recepcion(h, lote_c, 10, "2026-10-11")
    proc_c = empacar(
        h,
        "2026-10-29",
        lote_c,
        "2026-10-11",
        10,
        [linea("2026-10-29", lote_c, 30, "llano", talla="6")],
    )
    r_old = client.post(
        "/api/correcciones/reempaque-melon",
        headers=h,
        json={
            "fecha_origen": "2026-10-29",
            "fecha_reempaque": "2026-10-30",
            "salidas": [
                {
                    "empaque_id": proc_c["id"],
                    "presentacion": "caja_normal_b",
                    "talla": "6",
                    "calidad": "llano",
                    "lote": lote_c,
                    "cantidad": 10,
                }
            ],
            "resultados": [
                {
                    "presentacion": "caja_normal_b",
                    "talla": "18",
                    "calidad": "llano",
                    "lote": lote_c,
                    "cantidad": 8,
                }
            ],
        },
    )
    r_new = client.post(
        "/api/correcciones/reempaque-melon",
        headers=h,
        json={
            "fecha_origen": "2026-10-29",
            "fecha_reempaque": "2026-10-31",
            "salidas": [
                {
                    "empaque_id": proc_c["id"],
                    "presentacion": "caja_normal_b",
                    "talla": "18",
                    "calidad": "llano",
                    "lote": lote_c,
                    "cantidad": 8,
                }
            ],
            "resultados": [
                {
                    "presentacion": "caja_jumbo_c",
                    "talla": "6",
                    "calidad": "wallys",
                    "lote": lote_c,
                    "cantidad": 5,
                }
            ],
        },
    )
    check(r_old.status_code == 200 and r_new.status_code == 200, f"cadena {r_old.status_code} {r_new.status_code} {r_new.text[:180]}")
    blk_chain = client.delete(f"/api/empaque/{r_old.json()['id']}", headers=h)
    check(blk_chain.status_code == 409, f"no borra el reempaque viejo si hay uno nuevo {blk_chain.status_code} {blk_chain.text[:200]}")
    check(bins_de(lote_c) == 0, "la cadena bloqueada no movió bins")
    # embarcar el resultado del reempaque más nuevo y bloquear su borrado
    cli2 = client.post("/api/clientes/", headers=h, json={"nombre": "Cliente QA 2", "activo": 1})
    emb2 = client.post(
        "/api/embarques/",
        headers=h,
        json={
            "cliente_id": cli2.json()["id"],
            "notas": "resultado reempaque",
            "detalles": [
                {
                    "producto": "melon",
                    "mercado": "nacional",
                    "cantidad_cajas": 2,
                    "presentacion": "caja_jumbo_c",
                    "talla": "6",
                    "calidad": "wallys",
                }
            ],
        },
    )
    check(emb2.status_code == 200, f"embarque resultado {emb2.status_code} {emb2.text[:160]}")
    db = SessionLocal()
    emb2_row = db.query(Embarque).filter(Embarque.id == emb2.json()["id"]).first()
    emb2_row.fecha_salida = date(2026, 11, 2)
    db.commit()
    db.close()
    blk_ship = client.delete(f"/api/empaque/{r_new.json()['id']}", headers=h)
    check(blk_ship.status_code == 409, f"reempaque embarcado no se borra {blk_ship.status_code} {blk_ship.text[:220]}")
    blk_proc = client.delete(
        f"/api/empaque/{proc_c['id']}?confirmar_reempaques=true", headers=h
    )
    check(blk_proc.status_code == 409, f"el proceso tampoco se borra si el resultado ya se embarcó {blk_proc.status_code} {blk_proc.text[:220]}")
    check(any(e["id"] == proc_c["id"] for e in snap()["emps"]), "el proceso de la cadena sigue")
    check(bins_de(lote_c) == 0, f"bins de la cadena siguen empacados ({bins_de(lote_c)})")
    # forzar no salta el embarque
    blk_force = client.delete(
        f"/api/empaque/{r_new.json()['id']}?forzar_faltantes=true", headers=h
    )
    check(
        blk_force.status_code == 409 and "embarque" in blk_force.text.lower(),
        f"forzar no borra si hay embarque {blk_force.status_code} {blk_force.text[:220]}",
    )
    check(bins_de(lote_c) == 0, "forzar con embarque no movió bins")

    # Como el reempaque #98: el resultado quedó en 0 sin embarque (corrección vieja).
    lote_f = "Rancho S4 Krypto"
    recepcion(h, lote_f, 10, "2026-10-15")
    proc_f = empacar(
        h,
        "2026-10-22",
        lote_f,
        "2026-10-15",
        10,
        [linea("2026-10-22", lote_f, 80, "llano", talla="9")],
    )
    re_f = client.post(
        "/api/correcciones/reempaque-melon",
        headers=h,
        json={
            "fecha_origen": "2026-10-22",
            "fecha_reempaque": "2026-10-24",
            "salidas": [
                {
                    "empaque_id": proc_f["id"],
                    "presentacion": "caja_normal_b",
                    "talla": "9",
                    "calidad": "llano",
                    "lote": lote_f,
                    "cantidad": 80,
                }
            ],
            "resultados": [
                {
                    "presentacion": "caja_normal_b",
                    "talla": "9",
                    "calidad": "llano",
                    "lote": lote_f,
                    "cantidad": 20,
                },
                {
                    "presentacion": "caja_chica_a",
                    "talla": "9",
                    "calidad": "llano",
                    "lote": lote_f,
                    "cantidad": 56,
                },
            ],
        },
    )
    check(re_f.status_code == 200, f"reempaque faltantes {re_f.status_code} {re_f.text[:180]}")
    re_f_id = re_f.json()["id"]
    db = SessionLocal()
    tocadas = 0
    for inv in db.query(InventarioFinal).all():
        extra = inv.atributos_extra or {}
        if (
            extra.get("presentacion") == "caja_chica_a"
            and str(extra.get("talla")) == "9"
            and extra.get("lote") == lote_f
        ):
            inv.cantidad_stock = 0
            tocadas += 1
    db.commit()
    db.close()
    check(tocadas == 1, f"se puso en 0 la fila chica, filas={tocadas}")
    bins_antes = bins_de(lote_f)
    aviso = client.delete(f"/api/empaque/{re_f_id}", headers=h)
    check(aviso.status_code == 409, f"avisa faltantes {aviso.status_code} {aviso.text[:280]}")
    det_aviso = aviso.json().get("detail")
    check(
        isinstance(det_aviso, dict) and det_aviso.get("code") == "confirmar_faltantes",
        f"code confirmar_faltantes {det_aviso}",
    )
    check(
        "56" in str(det_aviso) and "cajas chica" in str(det_aviso).lower(),
        "el aviso dice que faltan 56 cajas chica",
    )
    check(bins_de(lote_f) == bins_antes == 0, "el aviso no movió bins")
    sigue = next(e for e in snap()["emps"] if e["id"] == proc_f["id"])
    cajas9 = sum(int(p["cantidad"]) for p in sigue["produccion"] if str(p.get("talla")) == "9" and p.get("presentacion") == "caja_normal_b")
    check(cajas9 == 20, f"sin confirmar, el proceso sigue en 20 normal (80-80+20), hay {cajas9}")
    hecho = client.delete(f"/api/empaque/{re_f_id}?forzar_faltantes=true", headers=h)
    check(hecho.status_code == 200, f"forzar faltantes {hecho.status_code} {hecho.text[:300]}")
    check(bins_de(lote_f) == 0, f"reempaque forzado no movió bins ({bins_de(lote_f)})")
    restaurado = next(e for e in snap()["emps"] if e["id"] == proc_f["id"])
    cajas9b = sum(
        int(p["cantidad"])
        for p in restaurado["produccion"]
        if str(p.get("talla")) == "9" and p.get("presentacion") == "caja_normal_b"
    )
    chica = sum(
        int(p["cantidad"])
        for p in restaurado["produccion"]
        if p.get("presentacion") == "caja_chica_a"
    )
    check(cajas9b == 80, f"volvieron las 80 cajas originales #9, hay {cajas9b}")
    check(chica == 0, f"el proceso ya no lista la caja chica, hay {chica}")
    inv_chica = [
        i
        for i in snap()["inv"]
        if (i["extra"] or {}).get("presentacion") == "caja_chica_a"
        and (i["extra"] or {}).get("lote") == lote_f
    ]
    check(
        all(i["stock"] >= 0 for i in snap()["inv"]) and all(i["stock"] == 0 for i in inv_chica),
        f"caja chica no quedó negativa {inv_chica}",
    )
    inv_norm = cajas_inv("9", lote_f, "2026-10-22")
    # normal: 80 - 80 + 20 = 20 antes de deshacer; al deshacer se quitan 20 y vuelven 80 → 80
    check(
        len(inv_norm) == 1 and inv_norm[0]["stock"] == 80,
        f"inventario del día original volvió a 80 {inv_norm}",
    )
    check(all(e["id"] != re_f_id for e in snap()["emps"]), "reempaque faltante borrado")

    # Cascada: borrar el proceso pide el aviso de faltantes y, al confirmar, devuelve los bins una vez.
    lote_g = "Bajio S8 Krypto"
    recepcion(h, lote_g, 10, "2026-10-18")
    proc_g = empacar(
        h,
        "2026-10-22",
        lote_g,
        "2026-10-18",
        10,
        [linea("2026-10-22", lote_g, 50, "llano", talla="9")],
    )
    re_g = client.post(
        "/api/correcciones/reempaque-melon",
        headers=h,
        json={
            "fecha_origen": "2026-10-22",
            "fecha_reempaque": "2026-10-24",
            "salidas": [
                {
                    "empaque_id": proc_g["id"],
                    "presentacion": "caja_normal_b",
                    "talla": "9",
                    "calidad": "llano",
                    "lote": lote_g,
                    "cantidad": 20,
                }
            ],
            "resultados": [
                {
                    "presentacion": "caja_chica_a",
                    "talla": "9",
                    "calidad": "llano",
                    "lote": lote_g,
                    "cantidad": 15,
                }
            ],
        },
    )
    check(re_g.status_code == 200, f"reempaque cascada {re_g.status_code}")
    db = SessionLocal()
    for inv in db.query(InventarioFinal).all():
        extra = inv.atributos_extra or {}
        if extra.get("lote") == lote_g and extra.get("presentacion") == "caja_chica_a":
            inv.cantidad_stock = 0
    db.commit()
    db.close()
    solo_re = client.delete(
        f"/api/empaque/{proc_g['id']}?confirmar_reempaques=true", headers=h
    )
    check(
        solo_re.status_code == 409
        and solo_re.json().get("detail", {}).get("code") == "confirmar_faltantes",
        f"cascada avisa faltantes {solo_re.status_code} {solo_re.text[:240]}",
    )
    check(bins_de(lote_g) == 0, "el aviso de cascada no movió bins")
    check(any(e["id"] == re_g.json()["id"] for e in snap()["emps"]), "el reempaque sigue hasta confirmar faltantes")
    ambos = client.delete(
        f"/api/empaque/{proc_g['id']}?confirmar_reempaques=true&forzar_faltantes=true",
        headers=h,
    )
    check(ambos.status_code == 200, f"cascada forzada {ambos.status_code} {ambos.text[:240]}")
    check(bins_de(lote_g) == 10, f"cascada devolvió 10 bins una vez ({bins_de(lote_g)})")
    check(
        all(e["id"] not in (proc_g["id"], re_g.json()["id"]) for e in snap()["emps"]),
        "proceso y reempaque de la cascada borrados",
    )
    check(all(i["stock"] >= 0 for i in snap()["inv"]), "ningún inventario quedó negativo")

    # Mismo faltante, pero con embarque posterior de esa caja: se bloquea aunque se fuerce.
    lote_e = "Rancho S4 Krypto B"
    recepcion(h, lote_e, 4, "2026-10-16")
    proc_e = empacar(
        h,
        "2026-10-22",
        lote_e,
        "2026-10-16",
        4,
        [linea("2026-10-22", lote_e, 40, "llano", talla="12")],
    )
    re_e = client.post(
        "/api/correcciones/reempaque-melon",
        headers=h,
        json={
            "fecha_origen": "2026-10-22",
            "fecha_reempaque": "2026-10-23",
            "salidas": [
                {
                    "empaque_id": proc_e["id"],
                    "presentacion": "caja_normal_b",
                    "talla": "12",
                    "calidad": "llano",
                    "lote": lote_e,
                    "cantidad": 10,
                }
            ],
            "resultados": [
                {
                    "presentacion": "caja_chica_a",
                    "talla": "15",
                    "calidad": "llano",
                    "lote": lote_e,
                    "cantidad": 8,
                }
            ],
        },
    )
    check(re_e.status_code == 200, f"reempaque embarcable {re_e.status_code} {re_e.text[:160]}")
    cli_e = client.post("/api/clientes/", headers=h, json={"nombre": "Cliente Faltante", "activo": 1})
    emb_e = client.post(
        "/api/embarques/",
        headers=h,
        json={
            "cliente_id": cli_e.json()["id"],
            "notas": "despues del reempaque",
            "detalles": [
                {
                    "producto": "melon",
                    "mercado": "nacional",
                    "cantidad_cajas": 3,
                    "presentacion": "caja_chica_a",
                    "talla": "15",
                    "calidad": "llano",
                }
            ],
        },
    )
    check(emb_e.status_code == 200, f"embarque chica {emb_e.status_code} {emb_e.text[:160]}")
    db = SessionLocal()
    emb_row = db.query(Embarque).filter(Embarque.id == emb_e.json()["id"]).first()
    emb_row.fecha_salida = date(2026, 10, 25)
    db.commit()
    db.close()
    no_force = client.delete(f"/api/empaque/{re_e.json()['id']}", headers=h)
    si_force = client.delete(
        f"/api/empaque/{re_e.json()['id']}?forzar_faltantes=true", headers=h
    )
    check(no_force.status_code == 409 and "embarque" in no_force.text.lower(), f"bloquea por embarque {no_force.text[:220]}")
    check(si_force.status_code == 409 and "embarque" in si_force.text.lower(), f"forzar no salta embarque {si_force.text[:220]}")
    check(any(e["id"] == re_e.json()["id"] for e in snap()["emps"]), "el reempaque embarcado sigue")
    check(bins_de(lote_e) == 0, "bins del caso embarque no se movieron")

    # Proceso original con cajas faltantes (sin embarque): aviso y, al confirmar, borra.
    lote_p = "Rancho S4 Krypto Proc"
    recepcion(h, lote_p, 10, "2026-10-22")
    proc_p = empacar(
        h,
        "2026-10-22",
        lote_p,
        "2026-10-22",
        10,
        [linea("2026-10-22", lote_p, 392, "llano", talla="21")],
    )
    db = SessionLocal()
    for inv in db.query(InventarioFinal).all():
        extra = inv.atributos_extra or {}
        if extra.get("lote") == lote_p and str(extra.get("talla")) == "21":
            inv.cantidad_stock = 168
    db.commit()
    db.close()
    av_p = client.delete(f"/api/empaque/{proc_p['id']}", headers=h)
    det_p = av_p.json().get("detail")
    check(av_p.status_code == 409 and isinstance(det_p, dict) and det_p.get("code") == "confirmar_faltantes", f"proceso avisa faltantes {av_p.text[:300]}")
    falt_p = (det_p or {}).get("faltantes") or []
    check(
        any(f.get("pedido") == 392 and f.get("hay") == 168 and f.get("faltan") == 224 for f in falt_p),
        f"pedido/hay/faltan {falt_p}",
    )
    check(bins_de(lote_p) == 0, "el aviso del proceso no movió bins")
    ok_p = client.delete(f"/api/empaque/{proc_p['id']}?forzar_faltantes=true", headers=h)
    check(ok_p.status_code == 200, f"proceso forzado {ok_p.status_code} {ok_p.text[:260]}")
    check(bins_de(lote_p) == 10, f"devolvió los 10 bins ({bins_de(lote_p)})")
    check(
        all(i["stock"] >= 0 for i in snap()["inv"] if (i["extra"] or {}).get("lote") == lote_p),
        "cajas del proceso no quedaron negativas",
    )
    check(cajas_inv("21", lote_p, "2026-10-22") == [], "se quitaron las 168 cajas que existían")

    # Dos procesos con los mismos bins: el alta real descontó una vez; el duplicado no.
    # Al borrar, el piso no puede pasar de lo recibido.
    lote_dup = "Rancho S4 Krypto Dup"
    recepcion(h, lote_dup, 10, "2026-10-20")
    real = empacar(
        h,
        "2026-10-20",
        lote_dup,
        "2026-10-20",
        10,
        [linea("2026-10-20", lote_dup, 40, "llano", talla="21")],
    )
    check(bins_de(lote_dup) == 0, "el proceso real dejó el piso en 0")
    db = SessionLocal()
    src = db.query(Empaque).filter(Empaque.id == real["id"]).one()
    import json as _json
    clon = Empaque(
        producto=src.producto,
        fecha=src.fecha,
        mercado=src.mercado,
        numero_empacador=src.numero_empacador,
        cantidad_cajas_campo_usadas=0,
        cantidad_cajas_carton_producidas=0,
        bins_desverdizado_usados=src.bins_desverdizado_usados,
        lote_desverdizado=src.lote_desverdizado,
        detalle_corrida=_json.loads(_json.dumps(src.detalle_corrida)),
        usuario_id=src.usuario_id,
    )
    db.add(clon)
    db.commit()
    clon_id = clon.id
    db.close()
    check(bins_de(lote_dup) == 0, "el duplicado no volvió a descontar bins")
    del_real = client.delete(f"/api/empaque/{real['id']}", headers=h)
    check(del_real.status_code == 200, f"borra el real {del_real.status_code} {del_real.text[:200]}")
    check(bins_de(lote_dup) == 10, f"el real devolvió 10 ({bins_de(lote_dup)})")
    av_dup = client.delete(f"/api/empaque/{clon_id}", headers=h)
    det_dup = av_dup.json().get("detail") if av_dup.headers.get("content-type", "").startswith("application/json") else None
    check(av_dup.status_code == 409, f"duplicado avisa {av_dup.status_code} {av_dup.text[:300]}")
    check(bins_de(lote_dup) == 10, "el aviso del duplicado no infló bins")
    ok_dup = client.delete(f"/api/empaque/{clon_id}?forzar_faltantes=true", headers=h)
    check(ok_dup.status_code == 200, f"duplicado forzado {ok_dup.status_code} {ok_dup.text[:300]}")
    check("0 bins de 10" in ok_dup.text or "se devolvieron 0" in ok_dup.text.lower(), f"texto de tope {ok_dup.text[:300]}")
    check(bins_de(lote_dup) == 10, f"el duplicado no pasó de lo recibido ({bins_de(lote_dup)})")
    filas_dup = [b for b in snap()["bins"] if b["lote"] == lote_dup]
    check(len(filas_dup) == 1 and filas_dup[0]["bins"] == 10, f"una fila de 10 bins {filas_dup}")

    # Embarque posterior de las cajas del proceso: ni forzando se borra.
    lote_s = "Lomas S9 Krypto"
    recepcion(h, lote_s, 6, "2026-10-21")
    proc_s = empacar(
        h,
        "2026-10-21",
        lote_s,
        "2026-10-21",
        6,
        [linea("2026-10-21", lote_s, 24, "llano", talla="18")],
    )
    cli_s = client.post("/api/clientes/", headers=h, json={"nombre": "Cliente Proc Ship", "activo": 1})
    emb_s = client.post(
        "/api/embarques/",
        headers=h,
        json={
            "cliente_id": cli_s.json()["id"],
            "notas": "proceso",
            "detalles": [
                {
                    "producto": "melon",
                    "mercado": "nacional",
                    "cantidad_cajas": 4,
                    "presentacion": "caja_normal_b",
                    "talla": "18",
                    "calidad": "llano",
                }
            ],
        },
    )
    check(emb_s.status_code == 200, f"embarque proceso {emb_s.status_code} {emb_s.text[:140]}")
    db = SessionLocal()
    emb_s_row = db.query(Embarque).filter(Embarque.id == emb_s.json()["id"]).first()
    emb_s_row.fecha_salida = date(2026, 10, 28)
    db.commit()
    db.close()
    b1 = client.delete(f"/api/empaque/{proc_s['id']}", headers=h)
    b2 = client.delete(f"/api/empaque/{proc_s['id']}?forzar_faltantes=true", headers=h)
    check(b1.status_code == 409 and "embarque" in b1.text.lower(), f"proceso embarcado bloqueado {b1.text[:200]}")
    check(b2.status_code == 409 and "embarque" in b2.text.lower(), f"forzar no borra proceso embarcado {b2.text[:200]}")
    check(bins_de(lote_s) == 0, "bins del proceso embarcado no se movieron")
    check(any(e["id"] == proc_s["id"] for e in snap()["emps"]), "el proceso embarcado sigue")

    print("\nFALLOS", len(FAILS))
    for f in FAILS:
        print(" -", f)
    if FAILS:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

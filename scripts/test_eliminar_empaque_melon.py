"""
Verifica el borrado de un proceso de empaque de melón contra un SQLite vacío en /tmp.

No toca la base de producción ni la base local del proyecto.
Requiere las dependencias del backend y el paquete httpx.

    python3 scripts/test_eliminar_empaque_melon.py
"""
import os
import sys
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
    check(blocked.status_code == 409, f"delete con reempaque bloqueado {blocked.status_code} {blocked.text[:220]}")
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

    print("\nFALLOS", len(FAILS))
    for f in FAILS:
        print(" -", f)
    if FAILS:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

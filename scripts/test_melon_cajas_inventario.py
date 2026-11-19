"""
Las tarjetas de melón suman el inventario final + lo embarcado.

Siembra un SQLite en /tmp (no toca la base del proyecto) con empaques
normales y las fuentes que el acumulado viejo no veía: alta manual sin
lote, ajuste con lote, talla #18, proceso sin bins, reempaque, proceso
huérfano y corridas que el listado de 100 dejaría fuera.

    python3 scripts/test_melon_cajas_inventario.py
"""
import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

os.environ["SECRET_KEY"] = "test-secret-melon-cajas"
os.environ["DATABASE_URL"] = "sqlite:////tmp/test_melon_cajas_inventario.db"
os.environ["DEBUG"] = "0"

try:
    os.remove("/tmp/test_melon_cajas_inventario.db")
except FileNotFoundError:
    pass

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient
from app.main import app
from app.core.database import SessionLocal
from app.models.enums import Producto, TipoMercado
from app.models.inventory import Embarque, EmbarqueDetalle, Empaque, InventarioFinal

client = TestClient(app)
FAILS = []
PRESENTACIONES_MELON = {"caja_chica_a", "caja_normal_b", "caja_jumbo_c"}


def check(cond, msg):
    print(("OK  " if cond else "FAIL") + " " + msg)
    if not cond:
        FAILS.append(msg)


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


def recepcion(h, lote, bins):
    r = client.post(
        "/api/recepcion/",
        headers=h,
        json={
            "producto": "melon",
            "mercado": "nacional",
            "lote": lote,
            "cantidad_bins": bins,
            "fecha_corte": "2026-10-20",
            "cantidad_cajas_campo": 0,
        },
    )
    check(r.status_code == 200, f"recepcion {lote} {r.status_code} {r.text[:160]}")


def empaque(h, lote, bins, produccion):
    r = client.post(
        "/api/empaque/",
        headers=h,
        json={
            "producto": "melon",
            "mercado": "nacional",
            "fecha": "2026-10-21",
            "numero_empacador": "EMP-01",
            "bins_desverdizado_usados": bins,
            "consumos_desverdizado": [
                {"lote": lote, "bins": bins, "fecha_recepcion": "2026-10-20"}
            ],
            "produccion": produccion,
        },
    )
    check(r.status_code == 200, f"empaque {lote} {r.status_code} {r.text[:200]}")
    return r.json().get("id") if r.status_code == 200 else None


def es_caja_melon(det):
    prod = str(det.get("producto") or "").lower()
    pres = str(det.get("presentacion") or "")
    if prod == "melon":
        return True
    if prod in ("limon_amarillo", "uva", ""):
        return pres in PRESENTACIONES_MELON
    return False


def main():
    h = auth()
    recepcion(h, "Rancho S5 Diputado", 30)
    recepcion(h, "Rancho S4 Krypto", 20)

    # Empaque normal: 1ra y 2da, con lote y bins.
    empaque(
        h,
        "Rancho S5 Diputado",
        8,
        [
            {
                "presentacion": "caja_normal_b",
                "talla": "9",
                "cantidad": 100,
                "calidad": "llano",
                "lote": "Rancho S5 Diputado",
            },
            {
                "presentacion": "caja_chica_a",
                "talla": "12",
                "cantidad": 10,
                "calidad": "wallys",
                "lote": "Rancho S5 Diputado",
            },
        ],
    )
    # Talla #18, solo LLANO. Entra al inventario y a las tarjetas.
    empaque(
        h,
        "Rancho S4 Krypto",
        4,
        [
            {
                "presentacion": "caja_chica_a",
                "talla": "18",
                "cantidad": 20,
                "calidad": "llano",
                "lote": "Rancho S4 Krypto",
            }
        ],
    )

    # Alta manual sin lote: el API de inventario no guarda lote.
    r = client.post(
        "/api/correcciones/inventario/final",
        headers=h,
        json={
            "producto": "melon",
            "mercado": "nacional",
            "cantidad_stock": 40,
            "presentacion": "caja_jumbo_c",
            "talla": "6",
            "calidad": "wallys",
        },
    )
    check(r.status_code == 200, f"alta sin lote {r.status_code} {r.text[:180]}")

    r = client.post(
        "/api/clientes/",
        headers=h,
        json={"nombre": "Cliente Melon"},
    )
    check(r.status_code in (200, 201), f"cliente {r.status_code} {r.text[:140]}")
    cliente_id = r.json()["id"]

    db = SessionLocal()
    # Ajuste con lote: está en inventario y no en una corrida.
    db.add(
        InventarioFinal(
            producto=Producto.MELON,
            mercado=TipoMercado.NACIONAL,
            cantidad_stock=25,
            atributos_extra={
                "presentacion": "caja_normal_b",
                "talla": "9",
                "calidad": "llano",
                "lote": "Rancho S5 Diputado",
                "fecha_empaque": "2026-10-21",
            },
        )
    )
    # Proceso sin lote y sin consumos. Sus 7 cajas sí están en inventario.
    db.add(
        Empaque(
            fecha=date(2026, 10, 22),
            producto=Producto.MELON,
            mercado=TipoMercado.NACIONAL,
            cantidad_cajas_campo_usadas=0,
            cantidad_cajas_carton_producidas=7,
            porcentaje_merma=0.0,
            numero_empacador="EMP-SL",
            bins_desverdizado_usados=2,
            detalle_corrida={
                "consumos": [],
                "produccion": [
                    {
                        "presentacion": "caja_normal_b",
                        "talla": "12",
                        "cantidad": 7,
                        "calidad": "llano",
                    }
                ],
            },
        )
    )
    db.add(
        InventarioFinal(
            producto=Producto.MELON,
            mercado=TipoMercado.NACIONAL,
            cantidad_stock=7,
            atributos_extra={
                "presentacion": "caja_normal_b",
                "talla": "12",
                "calidad": "llano",
            },
        )
    )
    # Reempaque: no se suma otra vez. El resultado real ya estaría en inventario.
    db.add(
        Empaque(
            fecha=date(2026, 10, 23),
            producto=Producto.MELON,
            mercado=TipoMercado.NACIONAL,
            cantidad_cajas_campo_usadas=0,
            cantidad_cajas_carton_producidas=0,
            porcentaje_merma=0.0,
            numero_empacador="EMP-R",
            bins_desverdizado_usados=9,
            detalle_corrida={
                "tipo": "reempaque_melon",
                "consumos": [{"lote": "Rancho S5 Diputado", "bins": 9}],
                "produccion": [
                    {
                        "presentacion": "caja_normal_b",
                        "talla": "9",
                        "cantidad": 1000,
                        "calidad": "llano",
                        "lote": "Rancho S5 Diputado",
                    }
                ],
            },
        )
    )
    # Proceso con cajas que no están en inventario: las tarjetas no lo inventan.
    db.add(
        Empaque(
            fecha=date(2026, 10, 24),
            producto=Producto.MELON,
            mercado=TipoMercado.NACIONAL,
            cantidad_cajas_campo_usadas=0,
            cantidad_cajas_carton_producidas=500,
            porcentaje_merma=0.0,
            numero_empacador="EMP-H",
            bins_desverdizado_usados=3,
            lote_desverdizado="Rancho S8 Diputado",
            detalle_corrida={
                "consumos": [{"lote": "Rancho S8 Diputado", "bins": 3}],
                "produccion": [
                    {
                        "presentacion": "caja_jumbo_c",
                        "talla": "9",
                        "cantidad": 500,
                        "calidad": "llano",
                        "lote": "Rancho S8 Diputado",
                    }
                ],
            },
        )
    )
    # El listado general solo devuelve 100. Estas filas tapan las corridas de melón.
    for i in range(100):
        db.add(
            Empaque(
                fecha=date(2026, 11, 1),
                producto=Producto.LIMON_AMARILLO,
                mercado=TipoMercado.NACIONAL,
                cantidad_cajas_campo_usadas=0,
                cantidad_cajas_carton_producidas=1,
                porcentaje_merma=0.0,
                numero_empacador=f"LIM-{i}",
                detalle_corrida={"produccion": [], "consumos": []},
            )
        )
    # Embarque anulado y otro de limón: no entran a las tarjetas de melón.
    anulado = Embarque(cliente_id=cliente_id, estado="anulado", notas="anulado")
    db.add(anulado)
    db.flush()
    db.add(
        EmbarqueDetalle(
            embarque_id=anulado.id,
            producto=Producto.MELON,
            mercado=TipoMercado.NACIONAL,
            cantidad_cajas=999,
        )
    )
    limon = Embarque(cliente_id=cliente_id, estado="en_transito", notas="limon")
    db.add(limon)
    db.flush()
    db.add(
        EmbarqueDetalle(
            embarque_id=limon.id,
            producto=Producto.LIMON_AMARILLO,
            mercado=TipoMercado.NACIONAL,
            presentacion="rpc_12",
            talla="165",
            calidad="primera",
            cantidad_cajas=80,
        )
    )
    # Caja de melón guardada con producto limón (la captura manda la presentación).
    mal = Embarque(cliente_id=cliente_id, estado="en_transito", notas="caja melon")
    db.add(mal)
    db.flush()
    db.add(
        EmbarqueDetalle(
            embarque_id=mal.id,
            producto=Producto.LIMON_AMARILLO,
            mercado=TipoMercado.NACIONAL,
            presentacion="caja_normal_b",
            talla="9",
            calidad="llano",
            cantidad_cajas=3,
        )
    )
    db.commit()
    db.close()

    r = client.post(
        "/api/embarques/",
        headers=h,
        json={
            "cliente_id": cliente_id,
            "notas": "salida melon",
            "detalles": [
                {
                    "producto": "melon",
                    "mercado": "nacional",
                    "cantidad_cajas": 5,
                }
            ],
        },
    )
    check(r.status_code == 200, f"embarque melon {r.status_code} {r.text[:200]}")

    plain = client.get("/api/empaque/", headers=h)
    check(plain.status_code == 200, f"listado general {plain.status_code}")
    melon_en_100 = [
        e for e in plain.json() if str(e.get("producto") or "").lower() == "melon"
    ]
    check(len(melon_en_100) == 0, f"el corte de 100 esconde el melón ({len(melon_en_100)})")

    full = client.get("/api/empaque/", headers=h, params={"producto": "melon"})
    check(full.status_code == 200, f"listado melon {full.status_code}")
    empaques = full.json()
    check(len(empaques) >= 4, f"corridas de melón completas {len(empaques)}")
    check(
        all(str(e.get("producto") or "").lower() == "melon" for e in empaques),
        "el listado de melón no mezcla limón",
    )

    dash = client.get("/api/reports/dashboard", headers=h)
    check(dash.status_code == 200, f"dashboard {dash.status_code}")
    inventario = dash.json().get("inventario_final") or []
    stock = sum(
        int(i.get("cantidad_stock") or 0)
        for i in inventario
        if str(i.get("producto") or "").lower() == "melon" and int(i.get("cantidad_stock") or 0) > 0
    )

    embs = client.get("/api/embarques/", headers=h)
    check(embs.status_code == 200, f"embarques {embs.status_code}")
    embarques = embs.json()
    embarcado = 0
    for emb in embarques:
        if str(emb.get("estado") or "").lower() == "anulado":
            continue
        for det in emb.get("detalles") or []:
            if es_caja_melon(det):
                embarcado += int(det.get("cantidad_cajas") or 0)
    check(embarcado == 8, f"embarcado melon vigente {embarcado} (5 + 3 de caja, sin el anulado ni el rpc)")

    proc = subprocess.run(
        ["node", "--experimental-strip-types", str(ROOT / "scripts" / "check_melon_cajas_inventario.ts")],
        input=json.dumps(
            {
                "inventario": inventario,
                "embarques": embarques,
                "empaques": empaques,
                "ha": 10,
            }
        ),
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    check(proc.returncode == 0, f"node {proc.returncode} {proc.stderr[-400:]}")
    if proc.returncode != 0:
        print("\nFALLOS", len(FAILS))
        raise SystemExit(1)
    data = json.loads(proc.stdout)

    check(data["cajasTotal"] == stock + embarcado, f"tarjetas {data['cajasTotal']} = inventario {stock} + embarcado {embarcado}")
    check(data["cajasLlano"] + data["cajasWallys"] == data["cajasTotal"], "1ra + 2da = total")
    check(data["tallasCajas"] == data["cajasTotal"], f"tallas {data['tallasCajas']} = tarjetas")
    check(data["pctSuma"] == 100, f"% 1ra + 2da = {data['pctSuma']}")
    check(sum(data["porVariedad"].values()) == data["cajasTotal"], "variedades suman el total")
    check(data["bins"] == 17, f"bins de campo {data['bins']} (8+4+2+3, sin el reempaque)")

    sin_lote_inv = sum(
        int(i.get("cantidad_stock") or 0)
        for i in inventario
        if str(i.get("producto") or "").lower() == "melon"
        and int(i.get("cantidad_stock") or 0) > 0
        and not str(i.get("lote") or "").strip()
    )
    # Lo embarcado no trae lote: se suma en "sin lote", no en la variedad.
    check(
        data["porVariedad"].get("sin lote", 0) == sin_lote_inv + embarcado,
        f"sin lote {data['porVariedad'].get('sin lote')} = {sin_lote_inv} + {embarcado}",
    )
    dip = sum(
        int(i.get("cantidad_stock") or 0)
        for i in inventario
        if str(i.get("producto") or "").lower() == "melon"
        and str(i.get("lote") or "").endswith("Diputado")
    )
    kry = sum(
        int(i.get("cantidad_stock") or 0)
        for i in inventario
        if str(i.get("producto") or "").lower() == "melon"
        and str(i.get("lote") or "").endswith("Krypto")
    )
    check(data["porVariedad"].get("Diputado", 0) == dip, f"Diputado {data['porVariedad'].get('Diputado')} = inventario {dip}")
    check(data["porVariedad"].get("Krypto", 0) == kry, f"Krypto {data['porVariedad'].get('Krypto')} = inventario {kry}")
    check("Rancho S8 Diputado" not in json.dumps(data["porVariedad"]) or data["porVariedad"].get("Diputado", 0) == dip, "el huérfano de 500 no se suma a Diputado")
    # 500 del proceso huérfano y 1000 del reempaque no están en el inventario.
    check(data["cajasTotal"] < stock + embarcado + 500, "no suma las 500 cajas que solo están en la corrida")
    check(data["cajasTotal"] < stock + embarcado + 1000, "no duplica el reempaque")

    print("\nFALLOS", len(FAILS))
    for f in FAILS:
        print(" -", f)
    if FAILS:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

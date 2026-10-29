"""
La distribución por tallas del reporte de melón sigue el filtro del acumulado.

Siembra un SQLite en /tmp (no toca la base del proyecto), lee los empaques
por el API y corre la misma función del frontend.

    python3 scripts/test_melon_tallas_filtro.py
"""
import json
import os
import subprocess
import sys
from pathlib import Path

os.environ["SECRET_KEY"] = "test-secret-melon-tallas"
os.environ["DATABASE_URL"] = "sqlite:////tmp/test_melon_tallas_filtro.db"
os.environ["DEBUG"] = "0"

try:
    os.remove("/tmp/test_melon_tallas_filtro.db")
except FileNotFoundError:
    pass

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from datetime import date

from fastapi.testclient import TestClient
from app.main import app
from app.core.database import SessionLocal
from app.models.enums import Producto, TipoMercado
from app.models.inventory import Empaque

client = TestClient(app)
FAILS = []


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
    check(r.status_code == 200, f"recepcion {lote} {r.status_code} {r.text[:140]}")
    return r


def empaque(h, lote_bins, produccion):
    consumos = [
        {"lote": lote, "bins": bins, "fecha_recepcion": "2026-10-20"}
        for lote, bins in lote_bins
    ]
    r = client.post(
        "/api/empaque/",
        headers=h,
        json={
            "producto": "melon",
            "mercado": "nacional",
            "fecha": "2026-10-21",
            "numero_empacador": "EMP-01",
            "bins_desverdizado_usados": sum(b for _, b in lote_bins),
            "consumos_desverdizado": consumos,
            "produccion": produccion,
        },
    )
    check(r.status_code == 200, f"empaque {r.status_code} {r.text[:180]}")
    return r.json()["id"] if r.status_code == 200 else None


def main():
    h = auth()
    recepcion(h, "Rancho S5 Diputado", 30)
    recepcion(h, "Rancho S8 Diputado", 20)
    recepcion(h, "Rancho S4 Krypto", 30)

    # Pesos de catálogo: chica 15, normal 18, jumbo 21.
    # En melón cada corrida es un solo lote, así que la variedad no mezcla ni duplica.
    id_dip = empaque(
        h,
        [("Rancho S5 Diputado", 8)],
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
    id_dip2 = empaque(
        h,
        [("Rancho S8 Diputado", 6)],
        [
            {
                "presentacion": "caja_normal_b",
                "talla": "15",
                "cantidad": 30,
                "calidad": "llano",
                "lote": "Rancho S8 Diputado",
            }
        ],
    )
    id_kry = empaque(
        h,
        [("Rancho S4 Krypto", 8)],
        [
            {
                "presentacion": "caja_jumbo_c",
                "talla": "6",
                "cantidad": 40,
                "calidad": "llano",
                "lote": "Rancho S4 Krypto",
            }
        ],
    )

    # Un reempaque no debe sumarse: el resultado ya está en la corrida de origen.
    db = SessionLocal()
    db.add(
        Empaque(
            fecha=date(2026, 10, 22),
            producto=Producto.MELON,
            mercado=TipoMercado.NACIONAL,
            cantidad_cajas_campo_usadas=0,
            cantidad_cajas_carton_producidas=0,
            numero_empacador="EMP-R",
            detalle_corrida={
                "tipo": "reempaque_melon",
                "consumos": [
                    {
                        "lote": "Rancho S5 Diputado",
                        "bins": 1,
                        "fecha_recepcion": "2026-10-20",
                    }
                ],
                "produccion": [
                    {
                        "presentacion": "caja_normal_b",
                        "talla": "9",
                        "cantidad": 1000,
                        "calidad": "llano",
                    }
                ],
            },
        )
    )
    db.commit()
    db.close()

    lista = client.get("/api/empaque/", headers=h)
    check(lista.status_code == 200, f"lista {lista.status_code}")
    raw = lista.json()
    path = "/tmp/test_melon_tallas_empaques.json"
    Path(path).write_text(json.dumps(raw), encoding="utf-8")

    proc = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            str(ROOT / "scripts" / "check_melon_tallas_filtro.ts"),
            path,
            str(id_dip or 0),
        ],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    check(proc.returncode == 0, f"node {proc.returncode} {proc.stderr[-400:]}")
    if proc.returncode != 0:
        print("\nFALLOS", len(FAILS))
        raise SystemExit(1)
    data = json.loads(proc.stdout)

    # 100*18 + 10*15 + 30*18 + 40*21 = 1800+150+540+840
    check(data["todo"]["suma"]["kg"] == 3330, f"todo kg {data['todo']['suma']}")
    check(data["todo"]["suma"]["llano"] == 3180, f"todo llano {data['todo']['suma']}")
    check(data["todo"]["suma"]["wallys"] == 150, f"todo wallys {data['todo']['suma']}")
    check(
        data["todo"]["suma"]["kg"] == data["todo"]["suma"]["llano"] + data["todo"]["suma"]["wallys"],
        "todo = llano + wallys",
    )
    check(data["todoCaja"]["suma"]["kg"] == data["todo"]["suma"]["kg"], "tipos de caja = simple")
    check(
        id_dip in data["incluidos"] and id_dip2 in data["incluidos"] and id_kry in data["incluidos"],
        f"campo {data['incluidos']}",
    )
    check(all(i not in data["incluidos"] for i in data["excluidos"]), "el reempaque queda fuera")
    check(data["todo"]["suma"]["kg"] != 3330 + 18000, "no sumó las 1000 cajas del reempaque")

    # Diputado: las dos corridas de esa variedad. Igual que las tarjetas (LLANO + Wallys).
    check(data["diputado"]["suma"]["kg"] == 2490, f"diputado kg {data['diputado']['suma']}")
    check(data["diputado"]["suma"]["llano"] == 2340, f"diputado llano {data['diputado']['suma']}")
    check(data["diputado"]["suma"]["wallys"] == 150, f"diputado wallys {data['diputado']['suma']}")
    check(data["diputado"]["n"] == 2, f"diputado corridas {data['diputado']['ids']}")
    check(id_kry not in data["diputado"]["ids"], "krypto no entra en Diputado")
    check(
        data["diputadoCaja"]["suma"]["kg"] == data["diputado"]["suma"]["kg"],
        "diputado simple = tipos de caja",
    )
    labels = {r["label"]: r["kg"] for r in data["diputado"]["rows"]}
    check(
        labels.get("#9s") == 1800 and labels.get("#12s") == 150 and labels.get("#15s") == 540,
        f"tallas {labels}",
    )
    check(sum(labels.values()) == data["diputado"]["suma"]["kg"], "las rebanadas suman el total")

    check(data["krypto"]["suma"]["kg"] == 840, f"krypto kg {data['krypto']['suma']}")
    check(data["krypto"]["n"] == 1 and id_kry in data["krypto"]["ids"], f"krypto ids {data['krypto']['ids']}")
    check(
        data["diputado"]["suma"]["kg"] + data["krypto"]["suma"]["kg"] == data["todo"]["suma"]["kg"],
        "variedades juntas = total general",
    )

    check(data["corrida"]["ids"] == [id_dip], f"corrida ids {data['corrida']['ids']}")
    check(data["corrida"]["suma"]["kg"] == 1950, f"corrida kg {data['corrida']['suma']}")
    check(data["corrida"]["suma"]["llano"] == 1800 and data["corrida"]["suma"]["wallys"] == 150, "corrida llano+wallys")

    print("\nFALLOS", len(FAILS))
    for f in FAILS:
        print(" -", f)
    if FAILS:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

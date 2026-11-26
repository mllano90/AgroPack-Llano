"""
Bins devueltos sin recepción: se listan en Correcciones y se pueden quitar
sin tocar otras filas, procesos ni recepciones.

Usa un SQLite vacío en /tmp. No toca la base del proyecto.

    python3 scripts/test_bins_devueltos.py
"""
import os
import sys
from pathlib import Path

os.environ["SECRET_KEY"] = "test-secret-bins-devueltos"
os.environ["DATABASE_URL"] = "sqlite:////tmp/test_bins_devueltos.db"
os.environ["DEBUG"] = "0"

try:
    os.remove("/tmp/test_bins_devueltos.db")
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


def filas():
    db = SessionLocal()
    rows = []
    for d in db.query(InventarioDesverdizado).order_by(InventarioDesverdizado.id).all():
        rows.append(
            {
                "id": d.id,
                "lote": d.lote,
                "bins": int(d.cantidad_bins or 0),
                "fecha": str(d.fecha_recepcion),
                "rec": d.recepcion_id,
                "prod": str(d.producto),
                "estado": d.estado,
            }
        )
    n_rec = db.query(RecepcionCampo).count()
    n_emp = db.query(Empaque).count()
    n_inv = db.query(InventarioFinal).count()
    db.close()
    return rows, n_rec, n_emp, n_inv


def main():
    h = auth()
    # Recepción + empaque de los 10 bins. Luego se borra la recepción
    # (el piso está en 0) y después el proceso: la devolución no encuentra
    # recepción y crea una fila con recepcion_id vacío.
    rec = client.post(
        "/api/recepcion/",
        headers=h,
        json={
            "producto": "melon",
            "mercado": "nacional",
            "lote": "Rancho S4 Krypto",
            "cantidad_bins": 10,
            "fecha_corte": "2026-10-22",
            "cantidad_cajas_campo": 0,
        },
    )
    check(rec.status_code == 200, f"recepcion {rec.status_code} {rec.text[:160]}")
    emp = client.post(
        "/api/empaque/",
        headers=h,
        json={
            "producto": "melon",
            "mercado": "nacional",
            "fecha": "2026-10-24",
            "numero_empacador": "EMP-01",
            "bins_desverdizado_usados": 10,
            "consumos_desverdizado": [
                {"lote": "Rancho S4 Krypto", "bins": 10, "fecha_recepcion": "2026-10-22"}
            ],
            "produccion": [
                {
                    "presentacion": "caja_normal_b",
                    "talla": "9",
                    "cantidad": 20,
                    "calidad": "llano",
                    "fecha_empaque": "2026-10-24",
                    "lote": "Rancho S4 Krypto",
                }
            ],
        },
    )
    check(emp.status_code == 200, f"empaque {emp.status_code} {emp.text[:160]}")
    emp_id = emp.json()["id"]
    borrar_rec = client.delete(f"/api/correcciones/recepcion/{rec.json()['id']}", headers=h)
    check(borrar_rec.status_code == 200, f"borra recepcion en cero {borrar_rec.status_code} {borrar_rec.text[:180]}")
    borrar_emp = client.delete(f"/api/empaque/{emp_id}", headers=h)
    check(borrar_emp.status_code == 200, f"borra proceso {borrar_emp.status_code} {borrar_emp.text[:200]}")

    rows, n_rec, n_emp, n_inv = filas()
    huerfanos = [r for r in rows if r["rec"] is None and r["bins"] > 0 and "Rancho S4" in r["lote"]]
    check(len(huerfanos) == 1 and huerfanos[0]["bins"] == 10, f"fila huerfana de 10 bins {huerfanos}")
    hid = huerfanos[0]["id"]

    # Otra fila del mismo lote, ligada, que no se debe tocar.
    # Un segundo huérfano de melón (borrado de a uno, como el masivo).
    # Y un huérfano de limón: el mismo camino de devolución puede dejarlo,
    # pero el historial de limón ya le crea una recepción al abrirse.
    db = SessionLocal()
    from datetime import date

    otra_rec = RecepcionCampo(
        producto="MELON",
        lote="Rancho S4 Krypto",
        cantidad_bins=5,
        fecha_corte=date(2026, 10, 12),
        fecha=date(2026, 10, 12),
        cantidad_cajas_campo=0,
        cantidad_cajas_carton=0,
    )
    db.add(otra_rec)
    db.flush()
    ligada = InventarioDesverdizado(
        producto="MELON",
        lote="Rancho S4 Krypto",
        cantidad_bins=5,
        fecha_recepcion=date(2026, 10, 12),
        fecha_tentativa_salida=date(2026, 10, 12),
        estado="listo_empaque",
        recepcion_id=otra_rec.id,
    )
    otro = InventarioDesverdizado(
        producto="MELON",
        lote="Lomas S2 Pruebas Lms",
        cantidad_bins=4,
        fecha_recepcion=date(2026, 10, 1),
        fecha_tentativa_salida=date(2026, 10, 1),
        estado="listo_empaque",
        recepcion_id=None,
    )
    limon = InventarioDesverdizado(
        producto="LIMON_AMARILLO",
        lote="8502 S2C3",
        cantidad_bins=3,
        fecha_recepcion=date(2026, 8, 1),
        fecha_tentativa_salida=date(2026, 8, 8),
        estado="listo_empaque",
        recepcion_id=None,
    )
    db.add(ligada)
    db.add(otro)
    db.add(limon)
    db.commit()
    ligada_id = ligada.id
    otro_id = otro.id
    limon_id = limon.id
    rec_id = otra_rec.id
    db.close()

    # El listado de bins (pestaña Bins de campo) no corre el enlace de limón.
    admin = client.get("/api/recepcion/admin/desverdizado", headers=h)
    admin_h = [d for d in admin.json() if d.get("huerfano")]
    admin_ids = {d["id"] for d in admin_h}
    check(hid in admin_ids and otro_id in admin_ids and limon_id in admin_ids, f"admin marca huerfanos {admin_ids}")
    check(
        all(d.get("recepcion_id") is None for d in admin_h if d["id"] in (hid, otro_id, limon_id)),
        "admin deja recepcion_id vacio",
    )

    # Borrar la fila ligada por este endpoint se rechaza y no cambia sus bins.
    mal = client.delete(f"/api/correcciones/bins-devueltos/{ligada_id}", headers=h)
    check(mal.status_code == 400, f"no borra fila ligada {mal.status_code} {mal.text[:160]}")

    # Limón huérfano se puede quitar mientras siga sin recepción.
    # No se toca el otro huérfano ni la fila ligada.
    ok_l = client.delete(f"/api/correcciones/bins-devueltos/{limon_id}", headers=h)
    check(ok_l.status_code == 200 and "3 bins" in ok_l.text, f"borra limon huerfano {ok_l.text[:180]}")
    rows_l, _, _, _ = filas()
    check(all(r["id"] != limon_id for r in rows_l), "la fila de limón ya no está")
    check(next(r for r in rows_l if r["id"] == otro_id)["bins"] == 4, "el otro huerfano de melon sigue")
    check(next(r for r in rows_l if r["id"] == ligada_id)["bins"] == 5, "la ligada sigue tras borrar limon")

    # Abrir historial de limón sigue creando la recepción espejo (no lo cambiamos).
    db = SessionLocal()
    limon2 = InventarioDesverdizado(
        producto="LIMON_AMARILLO",
        lote="8502 S2C4",
        cantidad_bins=7,
        fecha_recepcion=date(2026, 8, 2),
        fecha_tentativa_salida=date(2026, 8, 9),
        estado="listo_empaque",
        recepcion_id=None,
    )
    db.add(limon2)
    db.commit()
    limon2_id = limon2.id
    db.close()

    hist = client.get("/api/correcciones/historial?modulo=recepcion&limit=1", headers=h)
    check(hist.status_code == 200, f"historial {hist.status_code}")
    items = hist.json().get("items") or []
    marcados = [i for i in items if i.get("modulo") == "bins_devueltos"]
    ids = {i["id"] for i in marcados}
    check(hid in ids and otro_id in ids, f"historial lista huerfanos melon aunque el limite sea 1 {ids}")
    check(limon2_id not in ids, f"el limon ya no sale como huerfano tras el enlace {ids}")
    titulo = next(i["titulo"] for i in marcados if i["id"] == hid)
    check(
        titulo == "Bins devueltos por cancelación (sin recepción ligada)",
        f"titulo {titulo}",
    )
    resumen = next(i["resumen"] for i in marcados if i["id"] == hid)
    check("Rancho S4 Krypto" in resumen and "10 bins" in resumen and "2026-10-22" in resumen, f"resumen {resumen}")

    rows_sync, _, _, _ = filas()
    limon_sync = next(r for r in rows_sync if r["id"] == limon2_id)
    check(
        limon_sync["rec"] is not None and limon_sync["bins"] == 7,
        f"el sync de limon le creo recepcion y no le quito bins {limon_sync}",
    )
    rechaza = client.delete(f"/api/correcciones/bins-devueltos/{limon2_id}", headers=h)
    check(rechaza.status_code == 400, f"no borra limon ya ligado {rechaza.status_code} {rechaza.text[:140]}")

    rows_antes, n_rec_a, n_emp_a, n_inv_a = filas()
    ok = client.delete(f"/api/correcciones/bins-devueltos/{hid}", headers=h)
    check(ok.status_code == 200 and "10 bins" in ok.text, f"borra huerfano {ok.status_code} {ok.text[:200]}")
    rows2, n_rec2, n_emp2, n_inv2 = filas()
    check(all(r["id"] != hid for r in rows2), "la fila huerfana ya no está")
    ligada_ahora = next(r for r in rows2 if r["id"] == ligada_id)
    check(ligada_ahora["bins"] == 5 and ligada_ahora["rec"] == rec_id, f"la otra fila sigue {ligada_ahora}")
    otro_ahora = next(r for r in rows2 if r["id"] == otro_id)
    check(otro_ahora["bins"] == 4 and otro_ahora["rec"] is None, f"el segundo huerfano no se toco {otro_ahora}")
    check(next(r for r in rows2 if r["id"] == limon2_id)["bins"] == 7, "el limon ligado no se toco")
    check(
        n_rec2 == n_rec_a and n_emp2 == n_emp_a and n_inv2 == n_inv_a,
        f"recepciones empaques y cajas no cambiaron ({n_rec_a},{n_emp_a},{n_inv_a}) -> ({n_rec2},{n_emp2},{n_inv2})",
    )
    check(n_rec_a == n_rec + 2, f"solo se agregaron la recepcion de prueba y la espejo de limon ({n_rec} -> {n_rec_a})")
    check(n_emp_a == n_emp and n_inv_a == n_inv, f"empaque y cajas siguen como antes del borrado {n_emp_a}/{n_emp} {n_inv_a}/{n_inv}")

    ok2 = client.delete(f"/api/correcciones/bins-devueltos/{otro_id}", headers=h)
    check(ok2.status_code == 200 and "4 bins" in ok2.text, f"borra el segundo {ok2.text[:160]}")
    otra = client.delete(f"/api/correcciones/bins-devueltos/{hid}", headers=h)
    check(otra.status_code == 404, f"segunda vez 404 {otra.status_code}")
    rows3, n_rec3, n_emp3, n_inv3 = filas()
    check(next(r for r in rows3 if r["id"] == ligada_id)["bins"] == 5, "seguir intacta la fila ligada")
    check(n_rec3 == n_rec2 and n_emp3 == n_emp2 and n_inv3 == n_inv2, "el segundo borrado tampoco toca recepciones ni cajas")

    bins = client.get("/api/recepcion/bins-melon", headers=h)
    check(
        all(
            not (
                b.get("lote") == "Rancho S4 Krypto" and b.get("fecha_recepcion") == "2026-10-22"
            )
            and b.get("lote") != "Lomas S2 Pruebas Lms"
            for b in bins.json()
        ),
        "el piso de melon ya no muestra los cortes devueltos",
    )
    # La fila ligada del 12-oct sigue en piso (5 bins) porque no la borramos.
    check(
        any(
            b.get("lote") == "Rancho S4 Krypto" and b.get("fecha_recepcion") == "2026-10-12" and b.get("cantidad_bins_disponibles") == 5
            for b in bins.json()
        ),
        "el corte ligado sigue en piso",
    )

    print("\nFALLOS", len(FAILS))
    for f in FAILS:
        print(" -", f)
    if FAILS:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

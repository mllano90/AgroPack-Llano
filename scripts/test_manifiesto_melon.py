#!/usr/bin/env python3
"""
Manifiesto de melón sobre un SQLite temporal (no toca la base del proyecto).

    python3 scripts/test_manifiesto_melon.py

Comprueba:
  - un PDF válido crea el embarque y descuenta cajas de esa caja/talla/calidad
  - si no alcanzan las cajas, se rechaza y no cambia inventario ni embarques
  - el manifiesto de limón sigue parseando y descontando igual
  - un embarque de uva sigue descontando por variedad/cultivo/mercado
"""
from __future__ import annotations

import os
import sys
from io import BytesIO
from pathlib import Path

os.environ["SECRET_KEY"] = "test-secret-manifiesto-melon"
os.environ["DATABASE_URL"] = "sqlite:////tmp/test_manifiesto_melon.db"
os.environ["DEBUG"] = "0"

try:
    os.remove("/tmp/test_manifiesto_melon.db")
except FileNotFoundError:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi.testclient import TestClient

from app.main import app
from app.core.database import SessionLocal
from app.models.enums import Producto, TipoCultivo, TipoMercado, VariedadUva
from app.models.inventory import Embarque, InventarioFinal
from app.utils.manifiesto_melon import parse_manifiesto_melon_text
from app.utils.manifiesto_parser import parse_manifiesto_text

client = TestClient(app)
FAILS: list[str] = []


def check(cond: bool, msg: str) -> None:
    print(("OK  " if cond else "FAIL") + " " + msg)
    if not cond:
        FAILS.append(msg)


def pdf_con_texto(texto: str) -> bytes:
    """PDF mínimo de una página. pypdf recupera cada renglón."""

    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    lines = texto.replace("\r", "").split("\n")
    cmds = ["BT", "/F1 9 Tf", "36 780 Td"]
    for i, line in enumerate(lines):
        if i:
            cmds.append("0 -12 Td")
        cmds.append(f"({esc(line)}) Tj")
    cmds.append("ET")
    stream = "\n".join(cmds).encode("latin-1", errors="replace")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode()
        out += obj
        out += b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer << /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    ).encode()
    return bytes(out)


LIMON_TEXTO = """Fecha Embarque:
15/03/2026
Hora Salida:
08:30
Manifiesto N°
42
Embarcador: EMPRESA LLANO
Distribuidor: GAME CITRUS
Lugar: NOGALES
Mercado: Extranjero
Factura: 9001
1 63 0602 05 LEMON ORGANIC 40LB63 115s WHP US1 8507 ORG LLANO BRAND 10000014
2 45 0613 05 LEMONS ORGANIC RPC6423 BAG18/2 140 STO COM8507 ORG LLANO BRAND 10000015
108 Bultos Manifestados
"""

MELON_TEXTO = """Fecha Embarque: 02/11/2026
Hora Salida: 06:40
Manifiesto N° 18
Embarcador: AGRICOLA LLANO
Distribuidor: GAME CITRUS
Lugar: NOGALES
Mercado: Extranjero
Factura: 4410
1 50 0801 05 MELON 1RA LLANO CAJA NORMAL B 9S ORG LLANO BRAND 10000021
2 49 0804 05 MELON 1RA LLANO JUMBO C 6S ORG LLANO BRAND 10000024
99 Bultos Manifestados
"""

MELON_EJEMPLO = """Fecha Embarque: 02/11/2026
Hora Salida: 06:40
Manifiesto N° 18
Distribuidor: GAME CITRUS
Mercado: Extranjero
Factura: 4410
1 56 0801 05 MELON 1RA LLANO CAJA NORMAL B 9S ORG LLANO BRAND 10000021
2 56 0802 05 MELON 1RA LLANO CAJA NORMAL B 12S ORG LLANO BRAND 10000022
3 28 0803 05 MELON 2DA WALLY'S CAJA CHICA A 15S ORG LLANO BRAND 10000023
4 49 0804 05 MELON 1RA LLANO JUMBO C 6S ORG LLANO BRAND 10000024
189 Bultos Manifestados
"""


def test_parsers() -> None:
    lim = parse_manifiesto_text(LIMON_TEXTO)
    check(lim.fecha_embarque == "15/03/2026", f"limón fecha {lim.fecha_embarque}")
    check(lim.hora_salida == "08:30", f"limón hora {lim.hora_salida}")
    check(lim.numero_manifiesto == "42", f"limón manifiesto {lim.numero_manifiesto}")
    check(lim.embarcador == "EMPRESA LLANO", f"limón embarcador {lim.embarcador}")
    check(lim.distribuidor == "GAME CITRUS", f"limón distribuidor {lim.distribuidor}")
    check(lim.lugar == "NOGALES", f"limón lugar {lim.lugar}")
    check(lim.mercado == "exportacion", f"limón mercado {lim.mercado}")
    check(lim.factura == "9001", f"limón factura {lim.factura}")
    check(lim.total_bultos_manifiesto == 108, f"limón total {lim.total_bultos_manifiesto}")
    check(lim.warnings == [], f"limón warnings {lim.warnings}")
    check(
        [(ln.presentacion, ln.talla, ln.calidad, ln.cajas_por_parrilla, ln.bultos) for ln in lim.lineas_raw]
        == [
            ("caja_40lbs", "115", "primera", 63, 63),
            ("rpc_18", "140", "primera", 45, 45),
        ],
        f"limón líneas {lim.lineas_raw}",
    )
    check(
        lim.detalles
        == [
            {
                "producto": "limon_amarillo",
                "mercado": "exportacion",
                "cantidad_cajas": 63,
                "presentacion": "caja_40lbs",
                "talla": "115",
                "calidad": "primera",
                "cajas_por_parrilla": 63,
            },
            {
                "producto": "limon_amarillo",
                "mercado": "exportacion",
                "cantidad_cajas": 45,
                "presentacion": "rpc_18",
                "talla": "140",
                "calidad": "primera",
                "cajas_por_parrilla": 45,
            },
        ],
        f"limón detalles {lim.detalles}",
    )

    mel = parse_manifiesto_melon_text(MELON_EJEMPLO)
    check(mel.numero_manifiesto == "18", f"melón manifiesto {mel.numero_manifiesto}")
    check(mel.total_bultos_manifiesto == 189, f"melón total {mel.total_bultos_manifiesto}")
    check(mel.warnings == [], f"melón warnings {mel.warnings}")
    check(
        [(d["presentacion"], d["talla"], d["calidad"], d["cantidad_cajas"], d["cajas_por_parrilla"]) for d in mel.detalles]
        == [
            ("caja_chica_a", "15", "wallys", 28, 56),
            ("caja_jumbo_c", "6", "llano", 49, 49),
            ("caja_normal_b", "9", "llano", 56, 56),
            ("caja_normal_b", "12", "llano", 56, 56),
        ],
        f"melón detalles {mel.detalles}",
    )
    check(all(d["producto"] == "melon" for d in mel.detalles), "melón producto")

    marca = parse_manifiesto_melon_text(
        "1 56 0801 05 MELON CAJA NORMAL B 9S ORG LLANO BRAND 10000021\n"
    )
    check(marca.detalles == [], "LLANO BRAND sola no es calidad 1ra")
    check(any("calidad" in w for w in marca.warnings), f"avisa calidad {marca.warnings}")

    cruzada = parse_manifiesto_melon_text(
        "1 10 0801 05 MELON 1RA LLANO CAJA NORMAL B 6S ORG LLANO BRAND 10000021\n"
    )
    check(cruzada.detalles == [], "talla 6 no entra en caja normal")


def auth() -> dict:
    r = client.post(
        "/api/auth/register",
        json={
            "username": "admin",
            "password": "admin123",
            "nombre_completo": "Admin",
            "rol": "admin",
        },
    )
    check(r.status_code == 200, f"register {r.status_code} {r.text[:160]}")
    r = client.post("/api/auth/login", data={"username": "admin", "password": "admin123"})
    check(r.status_code == 200, f"login {r.status_code} {r.text[:160]}")
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def agregar_stock(**kwargs) -> None:
    db = SessionLocal()
    try:
        db.add(InventarioFinal(**kwargs))
        db.commit()
    finally:
        db.close()


def foto() -> dict:
    """SKU -> cajas. Melón separa calidad; limón y uva no."""
    db = SessionLocal()
    try:
        out: dict[tuple, int] = {}
        n_emb = db.query(Embarque).count()
        for inv in db.query(InventarioFinal).all():
            extra = inv.atributos_extra if isinstance(inv.atributos_extra, dict) else {}
            prod = str(getattr(inv.producto, "value", inv.producto) or "")
            key = (
                prod,
                extra.get("presentacion"),
                None if extra.get("talla") is None else str(extra.get("talla")),
                extra.get("calidad") if prod == "melon" else None,
                str(getattr(inv.variedad, "value", inv.variedad) or ""),
                str(getattr(inv.tipo_cultivo, "value", inv.tipo_cultivo) or ""),
                str(getattr(inv.mercado, "value", inv.mercado) or ""),
            )
            out[key] = out.get(key, 0) + int(inv.cantidad_stock or 0)
        return {"stock": out, "embarques": n_emb}
    finally:
        db.close()


def stock_de(snap: dict, **busca) -> int:
    total = 0
    for key, cant in snap["stock"].items():
        prod, pres, talla, cal, variedad, cultivo, mercado = key
        if busca.get("producto") and prod != busca["producto"]:
            continue
        if "presentacion" in busca and pres != busca["presentacion"]:
            continue
        if "talla" in busca and talla != busca["talla"]:
            continue
        if "calidad" in busca and cal != busca["calidad"]:
            continue
        if "variedad" in busca and variedad != busca["variedad"]:
            continue
        total += cant
    return total


def main() -> int:
    print("=== Manifiesto melón (SQLite temporal) ===\n")
    test_parsers()

    h = auth()
    r = client.post(
        "/api/clientes/",
        headers=h,
        json={"nombre": "Game", "empresa": "GAME CITRUS LLC"},
    )
    check(r.status_code == 201, f"cliente {r.status_code} {r.text[:160]}")
    cliente_id = r.json()["id"]

    agregar_stock(
        producto=Producto.MELON,
        mercado=TipoMercado.EXPORTACION,
        cantidad_stock=40,
        atributos_extra={
            "presentacion": "caja_normal_b",
            "talla": "9",
            "calidad": "llano",
            "lote": "Rancho S5 Diputado",
            "fecha_empaque": "2026-10-21",
        },
    )
    agregar_stock(
        producto=Producto.MELON,
        mercado=TipoMercado.EXPORTACION,
        cantidad_stock=30,
        atributos_extra={
            "presentacion": "caja_normal_b",
            "talla": "9",
            "calidad": "llano",
            "lote": "Rancho S8 Diputado",
            "fecha_empaque": "2026-10-22",
        },
    )
    agregar_stock(
        producto=Producto.MELON,
        mercado=TipoMercado.EXPORTACION,
        cantidad_stock=8,
        atributos_extra={
            "presentacion": "caja_chica_a",
            "talla": "12",
            "calidad": "wallys",
            "lote": "Rancho S5 Diputado",
            "fecha_empaque": "2026-10-21",
        },
    )
    agregar_stock(
        producto=Producto.MELON,
        mercado=TipoMercado.EXPORTACION,
        cantidad_stock=49,
        atributos_extra={
            "presentacion": "caja_jumbo_c",
            "talla": "6",
            "calidad": "llano",
            "lote": "Rancho S4 Krypto",
            "fecha_empaque": "2026-10-21",
        },
    )
    agregar_stock(
        producto=Producto.LIMON_AMARILLO,
        mercado=TipoMercado.EXPORTACION,
        cantidad_stock=100,
        atributos_extra={"presentacion": "caja_40lbs", "talla": "115", "calidad": "primera"},
    )
    agregar_stock(
        producto=Producto.LIMON_AMARILLO,
        mercado=TipoMercado.EXPORTACION,
        cantidad_stock=80,
        atributos_extra={"presentacion": "rpc_18", "talla": "140", "calidad": "primera"},
    )
    agregar_stock(
        producto=Producto.UVA,
        variedad=VariedadUva.EARLY_SWEET,
        tipo_cultivo=TipoCultivo.CONVENCIONAL,
        mercado=TipoMercado.NACIONAL,
        cantidad_stock=20,
    )

    base = foto()
    check(stock_de(base, producto="melon", presentacion="caja_normal_b", talla="9", calidad="llano") == 70, "seed normal #9 llano 70")
    check(stock_de(base, producto="melon", presentacion="caja_chica_a", talla="12", calidad="wallys") == 8, "seed chica #12 wallys 8")
    check(stock_de(base, producto="limon_amarillo", presentacion="rpc_18", talla="140") == 80, "seed limón rpc 80")
    check(stock_de(base, producto="uva", variedad="early_sweet") == 20, "seed uva 20")

    # Uva: el embarque manual sigue igual.
    r = client.post(
        "/api/embarques/",
        headers=h,
        json={
            "cliente_id": cliente_id,
            "notas": "TEST uva",
            "detalles": [
                {
                    "producto": "uva",
                    "variedad": "early_sweet",
                    "tipo_cultivo": "convencional",
                    "mercado": "nacional",
                    "cantidad_cajas": 3,
                }
            ],
        },
    )
    check(r.status_code == 200, f"embarque uva {r.status_code} {r.text[:200]}")
    tras_uva = foto()
    check(stock_de(tras_uva, producto="uva", variedad="early_sweet") == 17, "uva descontó 3")
    check(
        stock_de(tras_uva, producto="melon", presentacion="caja_normal_b", talla="9", calidad="llano") == 70,
        "uva no tocó melón",
    )
    check(
        stock_de(tras_uva, producto="limon_amarillo", presentacion="rpc_18", talla="140") == 80,
        "uva no tocó limón",
    )

    # Carga con faltante: una línea cabría, la otra no. No debe mover nada.
    antes = foto()
    r = client.post(
        "/api/embarques/desde-manifiesto",
        headers=h,
        json={
            "cliente_id": cliente_id,
            "notas": "TEST insuficiente",
            "fecha_embarque": "02/11/2026",
            "detalles": [
                {
                    "producto": "melon",
                    "mercado": "exportacion",
                    "presentacion": "caja_normal_b",
                    "talla": "9",
                    "calidad": "llano",
                    "cantidad_cajas": 10,
                    "cajas_por_parrilla": 56,
                },
                {
                    "producto": "melon",
                    "mercado": "exportacion",
                    "presentacion": "caja_chica_a",
                    "talla": "12",
                    "calidad": "wallys",
                    "cantidad_cajas": 100,
                    "cajas_por_parrilla": 56,
                },
            ],
        },
    )
    check(r.status_code == 400, f"insuficiente status {r.status_code} {r.text[:220]}")
    check("Wallys" in r.text or "wallys" in r.text or "chica" in r.text, f"mensaje {r.text[:220]}")
    despues = foto()
    check(
        despues == antes,
        "insuficiente no tocó nada"
        if despues == antes
        else f"insuficiente movió datos\n antes={antes}\n despues={despues}",
    )

    # Vista previa del PDF: no descuenta.
    pdf = pdf_con_texto(MELON_TEXTO)
    r = client.post(
        "/api/embarques/parse-manifiesto",
        headers=h,
        files={"file": ("manifiesto-melon.pdf", BytesIO(pdf), "application/pdf")},
        data={"producto": "melon"},
    )
    check(r.status_code == 200, f"parse melón {r.status_code} {r.text[:300]}")
    body = r.json() if r.status_code == 200 else {}
    dets = body.get("detalles") or []
    check(body.get("puede_confirmar") is True, f"puede confirmar {body.get('puede_confirmar')} {body.get('warnings')}")
    check(body.get("cliente_sugerido_id") == cliente_id, f"cliente sugerido {body.get('cliente_sugerido_nombre')}")
    por_sku = {(d.get("presentacion"), d.get("talla"), d.get("calidad")): d for d in dets}
    n9 = por_sku.get(("caja_normal_b", "9", "llano")) or {}
    jum = por_sku.get(("caja_jumbo_c", "6", "llano")) or {}
    check(n9.get("cantidad_cajas") == 50 and n9.get("stock_disponible") == 70, f"preview normal {n9}")
    check(n9.get("producto") == "melon" and n9.get("cajas_por_parrilla") == 56, f"preview meta {n9}")
    check(jum.get("cantidad_cajas") == 49 and jum.get("stock_disponible") == 49, f"preview jumbo {jum}")
    check(foto() == antes, "parse no descuenta")

    r = client.post(
        "/api/embarques/desde-manifiesto",
        headers=h,
        json={
            "cliente_id": cliente_id,
            "notas": f"Manifiesto N° {body.get('numero_manifiesto')}",
            "fecha_embarque": body.get("fecha_embarque"),
            "detalles": [
                {
                    "producto": "melon",
                    "mercado": d.get("mercado") or "exportacion",
                    "presentacion": d.get("presentacion"),
                    "talla": d.get("talla"),
                    "calidad": d.get("calidad"),
                    "cantidad_cajas": d.get("cantidad_cajas"),
                    "cajas_por_parrilla": d.get("cajas_por_parrilla"),
                }
                for d in dets
            ],
        },
    )
    check(r.status_code == 200, f"confirma melón {r.status_code} {r.text[:300]}")
    emb = r.json() if r.status_code == 200 else {}
    melon_id = emb.get("id")
    lineas = emb.get("detalles") or []
    check(len(lineas) == 2, f"dos líneas {lineas}")
    check(all(str(x.get("producto")) == "melon" for x in lineas), f"producto melon {lineas}")
    check(emb.get("fecha_salida") == "2026-11-02", f"fecha {emb.get('fecha_salida')}")
    check("Origen: manifiesto PDF" in (emb.get("notas") or ""), f"notas {emb.get('notas')}")
    tras = foto()
    check(
        stock_de(tras, producto="melon", presentacion="caja_normal_b", talla="9", calidad="llano") == 20,
        "normal #9 llano 70-50=20",
    )
    check(
        stock_de(tras, producto="melon", presentacion="caja_jumbo_c", talla="6", calidad="llano") == 0,
        "jumbo #6 quedó en 0",
    )
    check(
        stock_de(tras, producto="melon", presentacion="caja_chica_a", talla="12", calidad="wallys") == 8,
        "wallys no se mezcló",
    )
    check(stock_de(tras, producto="limon_amarillo", presentacion="caja_40lbs", talla="115") == 100, "limón cartón intacto")
    check(stock_de(tras, producto="limon_amarillo", presentacion="rpc_18", talla="140") == 80, "limón rpc intacto")
    check(stock_de(tras, producto="uva", variedad="early_sweet") == 17, "uva intacta tras melón")
    check(tras["embarques"] == antes["embarques"] + 1, "se creó un embarque")

    # Limón: mismo PDF de siempre, sin campo producto.
    pdf_l = pdf_con_texto(LIMON_TEXTO)
    r = client.post(
        "/api/embarques/parse-manifiesto",
        headers=h,
        files={"file": ("manifiesto-limon.pdf", BytesIO(pdf_l), "application/pdf")},
    )
    check(r.status_code == 200, f"parse limón {r.status_code} {r.text[:250]}")
    bl = r.json() if r.status_code == 200 else {}
    check(bl.get("numero_manifiesto") == "42", f"limón num {bl.get('numero_manifiesto')}")
    check(bl.get("total_bultos_manifiesto") == 108, f"limón bultos {bl.get('total_bultos_manifiesto')}")
    ld = {(d.get("presentacion"), d.get("talla")): d for d in bl.get("detalles") or []}
    cart = ld.get(("caja_40lbs", "115")) or {}
    rpc = ld.get(("rpc_18", "140")) or {}
    check(cart.get("producto") == "limon_amarillo" and cart.get("cantidad_cajas") == 63, f"limón cartón {cart}")
    check(cart.get("stock_disponible") == 100 and cart.get("cajas_por_parrilla") == 63, f"stock cartón {cart}")
    check(rpc.get("cantidad_cajas") == 45 and rpc.get("stock_disponible") == 80, f"limón rpc {rpc}")
    check(rpc.get("calidad") == "primera", f"calidad limón {rpc.get('calidad')}")
    antes_l = foto()
    r = client.post(
        "/api/embarques/desde-manifiesto",
        headers=h,
        json={
            "cliente_id": cliente_id,
            "notas": "Manifiesto N° 42",
            "fecha_embarque": "15/03/2026",
            "detalles": [
                {
                    "producto": "limon_amarillo",
                    "mercado": "exportacion",
                    "presentacion": "caja_40lbs",
                    "talla": "115",
                    "calidad": "primera",
                    "cantidad_cajas": 63,
                    "cajas_por_parrilla": 63,
                },
                {
                    "producto": "limon_amarillo",
                    "mercado": "exportacion",
                    "presentacion": "rpc_18",
                    "talla": "140",
                    "calidad": "primera",
                    "cantidad_cajas": 45,
                    "cajas_por_parrilla": 45,
                },
            ],
        },
    )
    check(r.status_code == 200, f"confirma limón {r.status_code} {r.text[:250]}")
    le = r.json() if r.status_code == 200 else {}
    check(
        all(str(x.get("producto")) == "limon_amarillo" for x in le.get("detalles") or []),
        f"líneas limón {le.get('detalles')}",
    )
    fin = foto()
    check(stock_de(fin, producto="limon_amarillo", presentacion="caja_40lbs", talla="115") == 37, "limón cartón 100-63")
    check(stock_de(fin, producto="limon_amarillo", presentacion="rpc_18", talla="140") == 35, "limón rpc 80-45")
    check(
        stock_de(fin, producto="melon", presentacion="caja_normal_b", talla="9", calidad="llano")
        == stock_de(antes_l, producto="melon", presentacion="caja_normal_b", talla="9", calidad="llano"),
        "limón no tocó melón",
    )
    check(stock_de(fin, producto="uva", variedad="early_sweet") == 17, "limón no tocó uva")

    # Borrar el embarque de melón devuelve las cajas a su calidad, no a otra.
    if melon_id:
        r = client.delete(f"/api/correcciones/embarque/{melon_id}", headers=h)
        check(r.status_code == 200, f"borrar melón {r.status_code} {r.text[:220]}")
        dev = foto()
        check(
            stock_de(dev, producto="melon", presentacion="caja_normal_b", talla="9", calidad="llano") == 70,
            "devolvió normal #9 llano",
        )
        check(
            stock_de(dev, producto="melon", presentacion="caja_jumbo_c", talla="6", calidad="llano") == 49,
            "devolvió jumbo",
        )
        check(
            stock_de(dev, producto="melon", presentacion="caja_chica_a", talla="12", calidad="wallys") == 8,
            "borrar no infló wallys",
        )
        check(stock_de(dev, producto="limon_amarillo", presentacion="rpc_18", talla="140") == 35, "borrar melón no tocó limón")

    print()
    if FAILS:
        print(f"{len(FAILS)} FAIL")
        for f in FAILS:
            print(" -", f)
        return 1
    print("TODO OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

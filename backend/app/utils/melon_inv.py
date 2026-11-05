"""
Inventario final de cajas de melón.

La fila vive en inventario_final con producto=melon y, en atributos_extra:
presentacion (caja_chica_a | caja_normal_b | caja_jumbo_c), talla y calidad
(llano = 1ra LLANO, wallys = 2da Wallys). Lote y día de empaque distinguen
el proceso de empaque, pero un embarque —igual que el de limón— descuenta
por caja + talla + calidad, repartiendo entre esas filas.
"""
from __future__ import annotations

import re

from app.models.enums import Producto
from app.models.inventory import InventarioFinal
from app.utils.limon_inv import extra_dict

PRESENTACIONES_MELON = ("caja_chica_a", "caja_normal_b", "caja_jumbo_c")

CAJAS_POR_PARRILLA_MELON = {
    "caja_chica_a": 56,
    "caja_normal_b": 56,
    "caja_jumbo_c": 49,
}

TALLAS_POR_PRESENTACION_MELON = {
    "caja_chica_a": ("9", "12", "15"),
    "caja_normal_b": ("9", "12", "15"),
    "caja_jumbo_c": ("6", "9", "12"),
}

_NOMBRE_CAJA = {
    "caja_chica_a": "Caja chica A",
    "caja_normal_b": "Caja normal B",
    "caja_jumbo_c": "Talla jumbo C",
}

_ALIAS_PRES = {
    "caja_chica_a": "caja_chica_a",
    "chica": "caja_chica_a",
    "caja_a": "caja_chica_a",
    "caja_normal_b": "caja_normal_b",
    "normal": "caja_normal_b",
    "caja_b": "caja_normal_b",
    "caja_jumbo_c": "caja_jumbo_c",
    "jumbo": "caja_jumbo_c",
    "caja_c": "caja_jumbo_c",
}


def norm_presentacion_melon(presentacion) -> str | None:
    if presentacion is None:
        return None
    s = str(presentacion).strip().lower().replace(" ", "_")
    return _ALIAS_PRES.get(s)


def norm_talla_melon(talla) -> str | None:
    if talla is None:
        return None
    s = str(talla).strip().lower()
    if not s or s in ("none", "null"):
        return None
    s = s.lstrip("#").strip()
    s = re.sub(r"s$", "", s).strip()
    return s or None


def norm_calidad_melon(calidad) -> str | None:
    """llano = 1ra LLANO, wallys = 2da Wallys. None si no se reconoce."""
    if calidad is None:
        return None
    s = str(calidad).strip().lower()
    if not s or s in ("none", "null"):
        return None
    s = (
        s.replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
        .replace("'", "")
        .replace("’", "")
        .replace("`", "")
    )
    s = " ".join(s.split())
    if s in {"llano", "1ra", "1a", "primera", "primera llano", "1ra llano"}:
        return "llano"
    if s in {
        "wallys",
        "wally",
        "2da",
        "2a",
        "segunda",
        "segunda wallys",
        "2da wallys",
    }:
        return "wallys"
    if "wally" in s:
        return "wallys"
    if s == "llano" or s.endswith(" llano"):
        return "llano"
    return None


def talla_valida_melon(presentacion: str | None, talla: str | None) -> bool:
    pres = norm_presentacion_melon(presentacion)
    tal = norm_talla_melon(talla)
    if not pres or not tal:
        return False
    return tal in TALLAS_POR_PRESENTACION_MELON.get(pres, ())


def etiqueta_sku_melon(presentacion, talla, calidad) -> str:
    pres = norm_presentacion_melon(presentacion) or str(presentacion or "")
    tal = norm_talla_melon(talla) or ""
    cal = norm_calidad_melon(calidad)
    cal_txt = "1ra LLANO" if cal == "llano" else "2da Wallys" if cal == "wallys" else (cal or "")
    nombre = _NOMBRE_CAJA.get(pres, pres)
    return f"{nombre} #{tal} {cal_txt}".strip()


def _es_fila_melon(inv: InventarioFinal) -> bool:
    p = str(getattr(inv.producto, "value", inv.producto) or "").lower()
    return p == "melon" or inv.producto == Producto.MELON


def rows_inv_melon(
    db,
    presentacion,
    talla,
    calidad,
    mercado=None,
) -> list[InventarioFinal]:
    """
    Filas de cajas de melón de esa caja + talla + calidad.
    No incluye limón ni uva. Si hay mercado, esas filas van primero
    (el descuento las consume antes, igual que el limón).
    """
    pres = norm_presentacion_melon(presentacion)
    talla_n = norm_talla_melon(talla)
    cal = norm_calidad_melon(calidad)
    if not pres or not talla_n or not cal:
        return []

    rows: list[InventarioFinal] = []
    for inv in db.query(InventarioFinal).all():
        if not _es_fila_melon(inv):
            continue
        extra = extra_dict(inv)
        if norm_presentacion_melon(extra.get("presentacion")) != pres:
            continue
        if norm_talla_melon(extra.get("talla")) != talla_n:
            continue
        if norm_calidad_melon(extra.get("calidad")) != cal:
            continue
        rows.append(inv)

    if mercado is not None:
        mval = str(getattr(mercado, "value", mercado) or "")
        rows.sort(
            key=lambda r: (
                0 if str(getattr(r.mercado, "value", r.mercado) or "") == mval else 1,
                r.id or 0,
            )
        )
    else:
        rows.sort(key=lambda r: r.id or 0)
    return rows


def stock_melon(db, presentacion, talla, calidad, mercado=None) -> int:
    rows = rows_inv_melon(db, presentacion, talla, calidad, mercado=mercado)
    return sum(int(r.cantidad_stock or 0) for r in rows)

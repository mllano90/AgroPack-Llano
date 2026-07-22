"""
Utilidades compartidas de inventario limón (presentación + talla + mercado).

Unifica el matching que antes estaba duplicado en empaque.py y embarques.py.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.inventory import InventarioFinal


def extra_dict(inv: InventarioFinal) -> dict:
    extra = inv.atributos_extra
    return extra if isinstance(extra, dict) else {}


def norm_pres(presentacion: str | None) -> str | None:
    if presentacion is None:
        return None
    s = str(presentacion).strip()
    return s or None


def norm_lote(lote: Any) -> str | None:
    if lote is None:
        return None
    s = str(lote).strip()
    return s or None


def norm_fecha_empaque(fecha: Any) -> str | None:
    """Normaliza fecha de empaque a YYYY-MM-DD (clave de inventario granel por día)."""
    if fecha is None:
        return None
    if hasattr(fecha, "isoformat"):
        try:
            return fecha.isoformat()[:10]
        except Exception:
            pass
    s = str(fecha).strip()
    if not s or s.lower() in ("none", "null"):
        return None
    # YYYY-MM-DD...
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    # DD/MM/YYYY
    import re

    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{y:04d}-{mo:02d}-{d:02d}"
    return s or None


def norm_talla(presentacion: str | None, talla: Any) -> str | None:
    """
    Normaliza talla a str o None.
    bins_jugo no usa talla. Evita fallar match int vs str en JSON.
    """
    pres = norm_pres(presentacion) or ""
    if not pres or pres == "bins_jugo":
        return None
    if talla is None:
        return None
    s = str(talla).strip()
    if not s or s.lower() in ("none", "null"):
        return None
    if s.startswith("#"):
        s = s[1:].strip()
    return s or None


def calidad_pres(pres: str | None) -> str:
    if pres == "bins_jugo":
        return "segunda"
    if pres == "rpc_granel":
        return "primera"  # 1ra en proceso (pre-embolse)
    return "primera"


def rows_inv_limon(
    db: Session,
    presentacion: str | None,
    talla: str | None,
    mercado=None,
    lote: str | None = None,
    fecha_empaque: str | None = None,
) -> list[InventarioFinal]:
    """
    Filas de inventario final limón por presentación + talla.
    rpc_granel: filtra por lote de origen y fecha de empaque (día en que se empacó).
    Así no se mezcla granel de distintos días.
    """
    pres = norm_pres(presentacion)
    talla_n = norm_talla(pres, talla)
    lote_n = norm_lote(lote)
    fecha_n = norm_fecha_empaque(fecha_empaque)
    if not pres:
        return []

    rows: list[InventarioFinal] = []
    for inv in db.query(InventarioFinal).all():
        extra = extra_dict(inv)
        if norm_pres(extra.get("presentacion")) != pres:
            continue
        if norm_talla(pres, extra.get("talla")) != talla_n:
            continue
        inv_lote = norm_lote(extra.get("lote"))
        inv_fecha = norm_fecha_empaque(extra.get("fecha_empaque"))
        if pres == "rpc_granel":
            if lote_n is not None and inv_lote != lote_n:
                continue
            if fecha_n is not None and inv_fecha != fecha_n:
                continue
        else:
            if lote_n is not None and inv_lote is not None and inv_lote != lote_n:
                continue
        pval = str(getattr(inv.producto, "value", inv.producto) or "").lower()
        if pval and pval not in ("limon_amarillo",) and not extra.get("presentacion"):
            continue
        rows.append(inv)

    if mercado is not None:
        mval = str(getattr(mercado, "value", mercado))
        rows.sort(
            key=lambda r: (
                0 if str(getattr(r.mercado, "value", r.mercado)) == mval else 1,
                r.id or 0,
            )
        )
    else:
        rows.sort(key=lambda r: r.id or 0)
    return rows


def find_inv_final_limon(
    db: Session,
    presentacion: str | None,
    talla: Any,
    mercado=None,
    lote: str | None = None,
    fecha_empaque: str | None = None,
) -> InventarioFinal | None:
    """Primera fila preferida: mismo mercado, con stock > 0, o cualquier match."""
    pres = norm_pres(presentacion)
    if not pres:
        return None
    talla_n = norm_talla(pres, talla)
    lote_n = norm_lote(lote)
    fecha_n = norm_fecha_empaque(fecha_empaque)
    rows = rows_inv_limon(
        db, pres, talla_n, mercado=mercado, lote=lote_n, fecha_empaque=fecha_n
    )
    if pres == "rpc_granel":
        if lote_n is not None:
            rows = [r for r in rows if norm_lote(extra_dict(r).get("lote")) == lote_n]
        if fecha_n is not None:
            rows = [
                r
                for r in rows
                if norm_fecha_empaque(extra_dict(r).get("fecha_empaque")) == fecha_n
            ]
    if not rows:
        return None
    if mercado is not None:
        mval = str(getattr(mercado, "value", mercado))
        same = [r for r in rows if str(getattr(r.mercado, "value", r.mercado)) == mval]
        for r in same:
            if (r.cantidad_stock or 0) > 0:
                return r
        if same:
            return same[0]
    for r in rows:
        if (r.cantidad_stock or 0) > 0:
            return r
    return rows[0]


def stock_limon(
    db: Session,
    presentacion: str | None,
    talla: Any,
    mercado=None,
    lote: str | None = None,
    fecha_empaque: str | None = None,
) -> int:
    rows = rows_inv_limon(
        db,
        presentacion,
        norm_talla(presentacion, talla),
        mercado=mercado,
        lote=norm_lote(lote),
        fecha_empaque=norm_fecha_empaque(fecha_empaque),
    )
    return sum(int(r.cantidad_stock or 0) for r in rows)


def parse_detalle_corrida(raw) -> dict:
    """detalle_corrida puede venir como dict, JSON string o basura legacy."""
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return dict(raw)  # copia superficial mutable
    if isinstance(raw, str):
        import json

        s = raw.strip()
        if not s:
            return {}
        try:
            parsed = json.loads(s)
            return dict(parsed) if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def is_limon_producto(prod) -> bool:
    p = str(getattr(prod, "value", prod) or "").lower()
    return p == "limon_amarillo" or "limon" in p

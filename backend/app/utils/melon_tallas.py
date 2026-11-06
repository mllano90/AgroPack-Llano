"""
Tallas de melón (calibre, piezas por caja).

No hay catálogo en base de datos: la lista vive aquí y en el frontend
(`TALLAS_MELON_CAJA_*`). No sembrar filas al arrancar.

La talla #18 es solo de primera calidad LLANO. Segunda Wallys no la usa.
"""
from __future__ import annotations

from fastapi import HTTPException

# Orden numérico (menor calibre = número más chico). #18 va al final.
TALLAS_POR_PRESENTACION_MELON: dict[str, tuple[str, ...]] = {
    "caja_chica_a": ("9", "12", "15", "18"),
    "caja_normal_b": ("9", "12", "15", "18"),
    "caja_jumbo_c": ("6", "9", "12", "18"),
}

# Tallas que no existen en 2da Wallys.
TALLAS_MELON_SOLO_LLANO = frozenset({"18"})

MENSAJE_TALLA_18_WALLYS = (
    "La talla #18 solo está disponible para primera calidad LLANO, "
    "no para segunda Wallys."
)


def norm_talla_melon(talla) -> str | None:
    """' #18s ' → '18'. No toca limón: solo la usan las validaciones de melón."""
    if talla is None:
        return None
    s = str(talla).strip()
    if not s or s.lower() in ("none", "null"):
        return None
    if s.startswith("#"):
        s = s[1:].strip()
    if len(s) > 1 and s[-1] in ("s", "S") and s[:-1].isdigit():
        s = s[:-1]
    return s or None


def es_calidad_llano(calidad) -> bool:
    """True solo si la calidad es primera LLANO (1ra / llano / primera)."""
    if calidad is None:
        return False
    s = str(calidad).strip().lower()
    if not s or s in ("none", "null"):
        return False
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
    if "wally" in s:
        return False
    if s in {"2da", "2a", "segunda"}:
        return False
    return s in {"llano", "1ra", "1a", "primera", "primera llano", "1ra llano"}


def talla_18_prohibida_en_calidad(talla, calidad) -> bool:
    tal = norm_talla_melon(talla)
    if tal not in TALLAS_MELON_SOLO_LLANO:
        return False
    return not es_calidad_llano(calidad)


def rechazar_talla_18_si_no_es_llano(talla, calidad) -> None:
    """HTTP 400 si se intenta guardar #18 con una calidad que no es LLANO."""
    if talla_18_prohibida_en_calidad(talla, calidad):
        raise HTTPException(status_code=400, detail=MENSAJE_TALLA_18_WALLYS)


def rechazar_lineas_talla_18(lineas) -> None:
    for ln in lineas or []:
        if not isinstance(ln, dict):
            continue
        rechazar_talla_18_si_no_es_llano(ln.get("talla"), ln.get("calidad"))

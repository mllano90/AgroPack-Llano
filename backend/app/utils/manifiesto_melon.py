"""
Parser de manifiestos de embarque de melón.

Mismo archivo que el de limón (Llano Brand: encabezado + líneas
No. / Bultos / códigos / Descripción / pallet). Lo que cambia es la
descripción: tipo de caja, talla y calidad.

Ejemplo (texto; en el PDF cada renglón es una línea):

    Fecha Embarque: 02/11/2026
    Hora Salida: 06:40
    Manifiesto N° 18
    Embarcador: AGRICOLA LLANO
    Distribuidor: GAME CITRUS
    Lugar: NOGALES
    Mercado: Extranjero
    Factura: 4410
    1 56 0801 05 MELON 1RA LLANO CAJA NORMAL B 9S ORG LLANO BRAND 10000021
    2 56 0802 05 MELON 1RA LLANO CAJA NORMAL B 12S ORG LLANO BRAND 10000022
    3 28 0803 05 MELON 2DA WALLY'S CAJA CHICA A 15S ORG LLANO BRAND 10000023
    4 49 0804 05 MELON 1RA LLANO JUMBO C 6S ORG LLANO BRAND 10000024
    189 Bultos Manifestados

Caja:
    CAJA CHICA / TIPO A / CAJA A     → caja_chica_a   (tallas 9, 12, 15, 18; 56 cajas/parrilla)
    CAJA NORMAL / TIPO B / CAJA B    → caja_normal_b  (tallas 9, 12, 15, 18; 56 cajas/parrilla)
    JUMBO / TIPO C / CAJA C          → caja_jumbo_c   (tallas 6, 9, 12, 18; 49 cajas/parrilla)

La talla #18 es solo 1ra LLANO. En 2da Wallys se rechaza el manifiesto entero.

Calidad (la marca "LLANO BRAND" no cuenta como calidad):
    1RA / PRIMERA / LLANO            → llano   (1ra LLANO)
    2DA / SEGUNDA / WALLY'S          → wallys  (2da Wallys)

Talla: 18S, 9S, #12, TALLA 15, etc. #18 solo con 1ra LLANO.
Los bultos de la línea son cajas a embarcar (igual que en limón).
"""
from __future__ import annotations

import re
from collections import defaultdict

from app.utils.manifiesto_parser import (
    LineaManifiestoRaw,
    ManifiestoParseResult,
    _norm_mercado,
    _parse_int_miles,
)
from app.utils.melon_inv import (
    CAJAS_POR_PARRILLA_MELON,
    MENSAJE_TALLA_18_WALLYS,
    TALLAS_POR_PRESENTACION_MELON,
    norm_talla_melon,
    talla_18_prohibida_en_calidad,
)

# 18 va primero para que 18S / #18 / TALLA 18 no se partan en un calibre más corto.
_TALLA_MELON = r"(18|6|9|12|15)"

_LINE_RE = re.compile(
    r"^\s*(\d{1,3})\s+(\d+)\s+(\d{4})\s+(\d{2})\s+(.+?)\s+(\d{7,})\s*$"
)
_LINE_RE_LOOSE = re.compile(
    r"^\s*(\d{1,3})\s+(\d+)\s+(\d{4})\s+(\d{2})\s+(.+)$"
)


def _fold(text: str) -> str:
    u = text.upper()
    for src, dst in (
        ("Á", "A"),
        ("É", "E"),
        ("Í", "I"),
        ("Ó", "O"),
        ("Ú", "U"),
        ("Ñ", "N"),
        ("'", ""),
        ("’", ""),
        ("`", ""),
    ):
        u = u.replace(src, dst)
    return u


def _extract_talla(u: str) -> str | None:
    m = re.search(rf"#\s*{_TALLA_MELON}\s*S?\b", u)
    if m:
        return m.group(1)
    m = re.search(rf"\b{_TALLA_MELON}\s*S\b", u)
    if m:
        return m.group(1)
    m = re.search(rf"\bTALLA\s*{_TALLA_MELON}\b", u)
    if m:
        return m.group(1)
    return None


def _extract_caja(u: str) -> str | None:
    # CHICA / NORMAL / JUMBO antes que "CAJA C", porque "CAJA CHICA" empieza igual.
    if "CAJA_JUMBO_C" in u or re.search(r"\bJUMBO\b", u):
        return "caja_jumbo_c"
    if (
        "CAJA_CHICA_A" in u
        or re.search(r"\bCHICA\b", u)
        or re.search(r"\bTIPO\s+A\b", u)
        or re.search(r"\bCAJA\s+A\b", u)
    ):
        return "caja_chica_a"
    if (
        "CAJA_NORMAL_B" in u
        or re.search(r"\bNORMAL\b", u)
        or re.search(r"\bTIPO\s+B\b", u)
        or re.search(r"\bCAJA\s+B\b", u)
    ):
        return "caja_normal_b"
    if re.search(r"\bCAJA\s+C\b", u) or re.search(r"\bTIPO\s+C\b", u):
        return "caja_jumbo_c"
    return None


def _extract_calidad(u: str) -> str | None:
    """
    Wallys gana si la línea lo dice, aunque también traiga la marca LLANO BRAND.
    """
    sin_marca = re.sub(r"LLANO\s+BRAND", " ", u)
    if "WALLY" in u:
        return "wallys"
    if re.search(r"\b(2DA|SEGUNDA|2A)\b", sin_marca):
        return "wallys"
    if re.search(r"\b(1RA|PRIMERA|1A)\b", sin_marca) or re.search(r"\bLLANO\b", sin_marca):
        return "llano"
    return None


def _map_descripcion(desc: str) -> tuple[str | None, str | None, str | None, str | None, int | None]:
    """presentacion, talla, calidad, note, cajas_por_parrilla."""
    u = _fold(desc)
    parece_melon = "MELON" in u or any(
        k in u for k in ("CHICA", "JUMBO", "NORMAL", "CAJA_CHICA", "CAJA_NORMAL", "CAJA_JUMBO")
    )
    if not parece_melon:
        return None, None, None, f"Línea no es melón o no mapeable: {desc[:80]}", None

    pres = _extract_caja(u)
    if not pres:
        return None, None, None, f"No se reconoció el tipo de caja: {desc[:80]}", None

    talla = norm_talla_melon(_extract_talla(u))
    if not talla:
        return None, None, None, f"No se reconoció la talla: {desc[:80]}", None
    if talla not in TALLAS_POR_PRESENTACION_MELON[pres]:
        validas = ", ".join(TALLAS_POR_PRESENTACION_MELON[pres])
        return (
            None,
            None,
            None,
            f"Talla {talla} no corresponde a {pres} (válidas: {validas})",
            None,
        )

    calidad = _extract_calidad(u)
    if not calidad:
        return (
            None,
            None,
            None,
            f"No se reconoció la calidad (1ra LLANO o 2da Wallys): {desc[:80]}",
            None,
        )
    if talla_18_prohibida_en_calidad(talla, calidad):
        return None, None, None, MENSAJE_TALLA_18_WALLYS, None

    return pres, talla, calidad, None, CAJAS_POR_PARRILLA_MELON[pres]


def parse_manifiesto_melon_text(text: str) -> ManifiestoParseResult:
    """Misma forma de resultado que el parser de limón, con producto melon."""
    result = ManifiestoParseResult(raw_text_preview=text[:2500])
    lines = text.replace("\r", "").split("\n")
    full = "\n".join(lines)

    m = re.search(r"Fecha\s*Embarque:\s*\n?\s*(\d{1,2}/\d{1,2}/\d{4})", full, re.I)
    if m:
        result.fecha_embarque = m.group(1)
    m = re.search(r"Hora\s*Salida:\s*\n?\s*(\d{1,2}:\d{2})", full, re.I)
    if m:
        result.hora_salida = m.group(1)
    m = re.search(r"Manifiesto\s*N[°ºo.]?\s*\n?\s*(\d+)", full, re.I)
    if not m:
        m = re.search(r"Manifiesto\s*N[°ºo.]?\s*(\d+)", full, re.I)
    if m:
        result.numero_manifiesto = m.group(1)

    m = re.search(r"Embarcador:\s*(.+?)(?:Distribuidor:|$)", full, re.I | re.S)
    if m:
        result.embarcador = re.sub(r"\s+", " ", m.group(1)).strip()[:200]
    m = re.search(r"Distribuidor:\s*(.+?)(?:\n|Domic)", full, re.I)
    if m:
        result.distribuidor = re.sub(r"\s+", " ", m.group(1)).strip()[:200]
    m = re.search(r"Lugar:\s*([A-ZÁÉÍÓÚÑ ]+)", full, re.I)
    if m:
        result.lugar = m.group(1).strip()[:80]
    m = re.search(r"Mercado:\s*(\w+)", full, re.I)
    if m:
        result.mercado = _norm_mercado(m.group(1)) or "exportacion"
    else:
        result.mercado = "exportacion"
    m = re.search(r"Factura:\s*(\d+)", full, re.I)
    if m:
        result.factura = m.group(1)
    m = re.search(
        r"([\d]{1,3}(?:[,. ]\d{3})+|\d+)\s*Bultos\s*Manifestados",
        full,
        re.I,
    )
    if m:
        result.total_bultos_manifiesto = _parse_int_miles(m.group(1))

    # caja + talla + calidad + parrilla. No se mezclan LLANO y Wallys.
    agg: dict[tuple[str, str, str, int], int] = defaultdict(int)
    sum_bultos = 0

    for line in lines:
        line_s = line.strip()
        if not line_s or not re.match(r"^\d{1,3}\s+\d+", line_s):
            continue
        if "manifestados" in line_s.lower():
            continue

        m = _LINE_RE.match(line_s)
        pallet = None
        if m:
            no, bultos, _c1, _c2, rest, pallet = m.groups()
            desc_full = rest.strip()
        else:
            m2 = _LINE_RE_LOOSE.match(line_s)
            if not m2:
                continue
            no, bultos, _c1, _c2, rest = m2.groups()
            desc_full = rest.strip()
            mp = re.search(r"(\d{7,})\s*$", desc_full)
            if mp:
                pallet = mp.group(1)
                desc_full = desc_full[: mp.start()].strip()

        bultos_i = int(bultos)
        no_i = int(no)
        sum_bultos += bultos_i

        lote = None
        ml = re.search(r"(?:COM)?(85\d{2})\b", desc_full)
        if ml:
            lote = ml.group(1)

        etiqueta = None
        if "ORG LLANO" in desc_full.upper():
            etiqueta = "ORG LLANO BRAND"

        presentacion, talla, calidad, note, cpp = _map_descripcion(desc_full)
        ok = presentacion is not None and talla is not None and calidad is not None
        raw = LineaManifiestoRaw(
            no=no_i,
            bultos=bultos_i,
            descripcion=desc_full,
            lote=lote,
            etiqueta=etiqueta,
            pallet=pallet,
            presentacion=presentacion,
            talla=talla,
            calidad=calidad,
            cajas_por_parrilla=cpp,
            parse_ok=ok,
            parse_note=note,
        )
        result.lineas_raw.append(raw)
        if ok and presentacion and talla and calidad and cpp is not None:
            agg[(presentacion, talla, calidad, int(cpp))] += bultos_i
        elif note:
            result.warnings.append(f"Línea {no_i}: {note}")

    if result.total_bultos_manifiesto and sum_bultos != result.total_bultos_manifiesto:
        result.warnings.append(
            f"Suma de bultos parseados ({sum_bultos}) ≠ total manifiesto "
            f"({result.total_bultos_manifiesto})"
        )

    mercado = result.mercado or "exportacion"
    for (pres, talla, calidad, cpp), cant in sorted(
        agg.items(),
        key=lambda x: (x[0][0], int(x[0][1]) if str(x[0][1]).isdigit() else 0, x[0][2], x[0][3]),
    ):
        result.detalles.append(
            {
                "producto": "melon",
                "mercado": mercado,
                "cantidad_cajas": cant,
                "presentacion": pres,
                "talla": talla,
                "calidad": calidad,
                "cajas_por_parrilla": cpp,
            }
        )

    if not result.lineas_raw:
        result.warnings.append(
            "No se encontraron líneas de producto. Revisa que sea un manifiesto "
            "Llano Brand de melón (No. / Bultos / Descripción con caja, talla y calidad)."
        )
    elif not result.detalles:
        result.warnings.append(
            "Se leyeron líneas pero no se pudo mapear ninguna a caja de melón "
            "(chica A, normal B o jumbo C), talla y calidad 1ra LLANO o 2da Wallys."
        )

    return result

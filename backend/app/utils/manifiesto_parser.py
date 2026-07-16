"""
Parser de manifiestos de embarque (formato Llano Brand / export limón).
Extrae líneas de producto y las normaliza a presentacion + talla + cantidad.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field


@dataclass
class LineaManifiestoRaw:
    no: int
    bultos: int
    descripcion: str
    lote: str | None
    etiqueta: str | None
    pallet: str | None
    presentacion: str | None = None
    talla: str | None = None
    calidad: str | None = None
    parse_ok: bool = False
    parse_note: str | None = None


@dataclass
class ManifiestoParseResult:
    fecha_embarque: str | None = None
    hora_salida: str | None = None
    numero_manifiesto: str | None = None
    embarcador: str | None = None
    distribuidor: str | None = None
    lugar: str | None = None
    mercado: str | None = None  # nacional | exportacion
    factura: str | None = None
    total_bultos_manifiesto: int | None = None
    lineas_raw: list[LineaManifiestoRaw] = field(default_factory=list)
    # Agregado para inventario: presentacion+talla -> cantidad
    detalles: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    raw_text_preview: str = ""


# Línea de detalle: No. Bultos codigo codigo DESCRIPCIÓN ... LOTE/etiqueta pallet
# Ej: 1 63 0602 05 LEMON ORGANIC 40LB63 115s WHP US1 8507 ORG LLANO BRAND 10000014
# Ej: 9 45 0613 05 LEMONS ORGANIC RPC6423 BAG18/2 140 STO COM8507 ORG LLANO BRAND 10000015
_LINE_RE = re.compile(
    r"^\s*(\d{1,3})\s+(\d+)\s+(\d{4})\s+(\d{2})\s+(.+?)\s+(\d{7,})\s*$"
)
# Variante si el pallet no está al final
_LINE_RE_LOOSE = re.compile(
    r"^\s*(\d{1,3})\s+(\d+)\s+(\d{4})\s+(\d{2})\s+(.+)$"
)

_TALLAS = ("75", "95", "115", "140", "165", "200", "235")


def _norm_mercado(text: str | None) -> str | None:
    if not text:
        return None
    t = text.lower()
    if "extranj" in t or "export" in t:
        return "exportacion"
    if "nacion" in t:
        return "nacional"
    return None


def _map_descripcion(desc: str) -> tuple[str | None, str | None, str | None, str | None]:
    """
    Returns presentacion, talla, calidad, note
    """
    u = desc.upper()
    calidad = "primera"
    if "ORGANIC" in u or "ORG " in u or " ORGANIC" in u:
        # calidad de inventario actual usa primera/segunda; orgánico se anota en note
        pass

    # Bins jugo / 2da
    if "BIN" in u and ("JUC" in u or "JUGO" in u or "JUICE" in u or "GEN JUC" in u):
        return "bins_jugo", None, "segunda", None

    # Caja 40 lb
    if "40LB" in u or "40 LB" in u or "40LBS" in u:
        talla = None
        m = re.search(r"\b(75|95|115|140|165|200|235)\s*S\b", u)
        if not m:
            m = re.search(r"\b(75|95|115|140|165|200|235)\b", u)
        if m:
            talla = m.group(1)
        return "caja_40lbs", talla, "primera", None

    # RPC 18 / 12
    if "RPC" in u or "BAG18" in u or "BAG12" in u or "BAG 18" in u or "BAG 12" in u:
        if "BAG12" in u or "BAG 12" in u or "RPC12" in u or "RPC 12" in u:
            pres = "rpc_12"
        else:
            # default RPC del manifiesto Llano es BAG18/2
            pres = "rpc_18"
        talla = None
        # talla suele ir como "140 STO" o "165 STO"
        m = re.search(r"\b(75|95|115|140|165|200|235)\s*STO\b", u)
        if not m:
            m = re.search(r"\b(75|95|115|140|165|200|235)\b", u)
        if m:
            talla = m.group(1)
        return pres, talla, "primera", None

    if "LEMON" in u or "LIMON" in u or "LIMÓN" in u:
        return None, None, None, f"No se reconoció presentación: {desc[:80]}"

    return None, None, None, f"Línea no es limón o no mapeable: {desc[:80]}"


def _extract_lote(desc_tail: str) -> tuple[str, str | None]:
    """
    Separa lote (ej. 8507 o COM8507) del resto de la descripción.
    """
    # COM8507 pegado al STO
    m = re.search(r"(?:COM)?(85\d{2})\b", desc_tail)
    lote = m.group(1) if m else None
    return desc_tail, lote


def parse_manifiesto_text(text: str) -> ManifiestoParseResult:
    result = ManifiestoParseResult(raw_text_preview=text[:2500])
    lines = text.replace("\r", "").split("\n")

    full = "\n".join(lines)

    # Header fields
    m = re.search(r"Fecha\s*Embarque:\s*\n?\s*(\d{1,2}/\d{1,2}/\d{4})", full, re.I)
    if m:
        result.fecha_embarque = m.group(1)
    m = re.search(r"Hora\s*Salida:\s*\n?\s*(\d{1,2}:\d{2})", full, re.I)
    if m:
        result.hora_salida = m.group(1)
    m = re.search(r"Manifiesto\s*N[°ºo.]?\s*\n?\s*(\d+)", full, re.I)
    if not m:
        # a veces el número viene en otra línea "01"
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
    m = re.search(r"(\d+)\s*Bultos\s*Manifestados", full, re.I)
    if m:
        result.total_bultos_manifiesto = int(m.group(1))

    agg: dict[tuple[str, str | None], int] = defaultdict(int)
    sum_bultos = 0

    for line in lines:
        line_s = line.strip()
        if not line_s or not re.match(r"^\d{1,3}\s+\d+", line_s):
            continue
        # skip total line
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
            # try pull trailing long number as pallet
            mp = re.search(r"(\d{7,})\s*$", desc_full)
            if mp:
                pallet = mp.group(1)
                desc_full = desc_full[: mp.start()].strip()

        bultos_i = int(bultos)
        no_i = int(no)
        sum_bultos += bultos_i

        # Lote: 850x al final o COM850x
        lote = None
        ml = re.search(r"(?:COM)?(85\d{2})\b", desc_full)
        if ml:
            lote = ml.group(1)

        # Etiqueta: ORG LLANO BRAND / BINS LEMONS
        etiqueta = None
        if "ORG LLANO" in desc_full.upper():
            etiqueta = "ORG LLANO BRAND"
        elif "BINS LEMON" in desc_full.upper():
            etiqueta = "BINS LEMONS"

        presentacion, talla, calidad, note = _map_descripcion(desc_full)
        ok = presentacion is not None
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
            parse_ok=ok,
            parse_note=note,
        )
        result.lineas_raw.append(raw)
        if ok and presentacion:
            key = (presentacion, talla)
            agg[key] += bultos_i
        elif note:
            result.warnings.append(f"Línea {no_i}: {note}")

    if result.total_bultos_manifiesto and sum_bultos != result.total_bultos_manifiesto:
        result.warnings.append(
            f"Suma de bultos parseados ({sum_bultos}) ≠ total manifiesto "
            f"({result.total_bultos_manifiesto})"
        )
    if not result.lineas_raw:
        result.warnings.append(
            "No se encontraron líneas de producto. ¿Es el formato Llano Brand de manifiesto?"
        )

    mercado = result.mercado or "exportacion"
    for (pres, talla), cant in sorted(agg.items(), key=lambda x: (x[0][0], x[0][1] or "")):
        result.detalles.append(
            {
                "producto": "limon_amarillo",
                "mercado": mercado,
                "cantidad_cajas": cant,
                "presentacion": pres,
                "talla": talla,
                "calidad": "segunda" if pres == "bins_jugo" else "primera",
            }
        )

    return result


def extract_pdf_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader
        from io import BytesIO

        reader = PdfReader(BytesIO(data))
        parts: list[str] = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
        return "\n".join(parts)
    except Exception as e:
        raise ValueError(f"No se pudo leer el PDF: {e}") from e

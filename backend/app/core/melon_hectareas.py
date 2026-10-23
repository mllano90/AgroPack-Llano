"""Catálogo de hectáreas por lote melón (área × sección × variedad)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.inventory import LoteMelonHectareas

# Etiquetas canónicas (mismo formato que recepción / empaque)
_AREA_LABEL = {
    "rancho": "Rancho",
    "bajio": "Bajío",
    "lomas": "Lomas",
}
_VARIEDAD_LABEL = {
    "krypto": "Krypto",
    "diputado": "Diputado",
    "ultra_jelly": "Ultra Jelly",
    "heidi": "Heidi",
    "pruebas": "Pruebas",
    # Lomas: variedades independientes (sufijo lms)
    "krypto_lms": "Krypto Lms",
    "diputado_lms": "Diputado Lms",
    "pruebas_lms": "Pruebas Lms",
}

# Datos oficiales de hectáreas plantadas
SEED_LOTES_MELON: list[dict] = [
    {"area": "rancho", "seccion": 4, "variedad": "krypto", "hectareas": 35.6},
    {"area": "rancho", "seccion": 5, "variedad": "diputado", "hectareas": 15.0},
    {"area": "rancho", "seccion": 6, "variedad": "diputado", "hectareas": 30.0},
    {"area": "rancho", "seccion": 7, "variedad": "diputado", "hectareas": 30.0},
    {"area": "rancho", "seccion": 8, "variedad": "diputado", "hectareas": 54.0},
    {"area": "bajio", "seccion": 5, "variedad": "diputado", "hectareas": 4.0},
    {"area": "bajio", "seccion": 5, "variedad": "heidi", "hectareas": 16.0},
    {"area": "bajio", "seccion": 5, "variedad": "ultra_jelly", "hectareas": 1.0},
    {"area": "bajio", "seccion": 6, "variedad": "ultra_jelly", "hectareas": 6.0},
    {"area": "bajio", "seccion": 7, "variedad": "ultra_jelly", "hectareas": 15.0},
    {"area": "lomas", "seccion": 2, "variedad": "krypto_lms", "hectareas": 1.8},
    {"area": "lomas", "seccion": 2, "variedad": "diputado_lms", "hectareas": 8.0},
    {"area": "lomas", "seccion": 2, "variedad": "pruebas_lms", "hectareas": 1.3},
]


def lote_melon_compuesto(area: str, seccion: int, variedad: str) -> str:
    area_l = _AREA_LABEL.get(area, area.title())
    var_l = _VARIEDAD_LABEL.get(variedad, variedad.replace("_", " ").title())
    return f"{area_l} S{seccion} {var_l}"


def seed_lote_melon_hectareas(db: Session, *, overwrite: bool = True) -> int:
    """
    Inserta/actualiza hectáreas oficiales.
    overwrite=True: siempre sincroniza hectareas/lote con el seed (fuente de verdad)
    y elimina filas del catálogo que ya no están en el seed.
    """
    n = 0
    seed_keys: set[tuple[str, int, str]] = set()
    for row in SEED_LOTES_MELON:
        area = row["area"]
        seccion = int(row["seccion"])
        variedad = row["variedad"]
        ha = float(row["hectareas"])
        lote = lote_melon_compuesto(area, seccion, variedad)
        seed_keys.add((area, seccion, variedad))
        existing = (
            db.query(LoteMelonHectareas)
            .filter(
                LoteMelonHectareas.area == area,
                LoteMelonHectareas.seccion == seccion,
                LoteMelonHectareas.variedad == variedad,
            )
            .first()
        )
        if existing:
            if overwrite:
                existing.hectareas = ha
                existing.lote = lote
                n += 1
        else:
            db.add(
                LoteMelonHectareas(
                    area=area,
                    seccion=seccion,
                    variedad=variedad,
                    lote=lote,
                    hectareas=ha,
                )
            )
            n += 1

    if overwrite:
        for old in db.query(LoteMelonHectareas).all():
            key = (old.area, int(old.seccion or 0), old.variedad or "")
            if key not in seed_keys:
                db.delete(old)
                n += 1

    db.commit()
    return n


def listar_hectareas_melon(db: Session) -> tuple[list[dict], float]:
    rows = (
        db.query(LoteMelonHectareas)
        .order_by(LoteMelonHectareas.area, LoteMelonHectareas.seccion, LoteMelonHectareas.variedad)
        .all()
    )
    items = [
        {
            "id": r.id,
            "area": r.area,
            "seccion": r.seccion,
            "variedad": r.variedad,
            "lote": r.lote,
            "hectareas": float(r.hectareas or 0),
        }
        for r in rows
    ]
    total = sum(i["hectareas"] for i in items)
    return items, total

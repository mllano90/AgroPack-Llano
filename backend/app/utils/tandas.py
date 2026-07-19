"""
Numeración de tandas de desverdizado.

Reglas:
- numero_tanda es estable: no se renumeran al empacar (aunque queden 0 bins).
- Al crear una tanda nueva: se asigna max(existentes)+1 sin tocar las demás.
- Solo se reasignan 1..N al ELIMINAR una tanda (correcciones / recepción / inventarios).
- Orden de reasignación (solo en delete): fecha de corte ASC, luego id ASC.
"""
from __future__ import annotations

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.inventory import InventarioDesverdizado


def filas_activas_desverdizado(db: Session) -> list:
    rows = (
        db.query(InventarioDesverdizado)
        .filter(InventarioDesverdizado.cantidad_bins > 0)
        .order_by(
            InventarioDesverdizado.fecha_recepcion.asc(),
            InventarioDesverdizado.id.asc(),
        )
        .all()
    )
    return [
        r
        for r in rows
        if (r.cantidad_bins or 0) > 0 and (r.estado or "") not in ("eliminado",)
    ]


def siguiente_numero_tanda(db: Session) -> int:
    """Siguiente número sin reordenar las tandas existentes."""
    m = db.query(func.max(InventarioDesverdizado.numero_tanda)).scalar()
    return int(m or 0) + 1


def asignar_numero_tanda_nueva(db: Session, row: InventarioDesverdizado) -> int | None:
    """
    Asigna numero_tanda a una fila nueva/sin número (si tiene stock).
    No renumeran las demás tandas.
    """
    if row is None:
        return None
    if (row.cantidad_bins or 0) <= 0 or (row.estado or "") == "eliminado":
        return row.numero_tanda
    if row.numero_tanda is not None:
        return row.numero_tanda
    n = siguiente_numero_tanda(db)
    row.numero_tanda = n
    db.flush()
    return n


def reasignar_numeros_tanda(db: Session, *, commit: bool = False) -> int:
    """
    Recalcula numero_tanda 1..N solo para tandas activas (bins > 0).
    Usar ÚNICAMENTE al eliminar tandas (correcciones / recepción / inventarios).
    No llamar desde empaque.
    """
    activas = filas_activas_desverdizado(db)
    # Limpiar números de filas inactivas (0 bins / eliminadas)
    inactivas = (
        db.query(InventarioDesverdizado)
        .filter(
            (InventarioDesverdizado.cantidad_bins <= 0)
            | (InventarioDesverdizado.estado == "eliminado")
        )
        .all()
    )
    for r in inactivas:
        if r.numero_tanda is not None:
            r.numero_tanda = None

    for i, r in enumerate(activas, start=1):
        r.numero_tanda = i

    if commit:
        db.commit()
    else:
        db.flush()
    return len(activas)

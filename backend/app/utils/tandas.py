"""
Numeración de tandas de desverdizado.

Reglas:
- Solo tandas con bins > 0 y estado no eliminado.
- Orden: fecha de corte (recepción) ASC, luego id ASC (orden de captura el mismo día).
- numero_tanda = 1, 2, 3... se reasigna siempre que cambie el conjunto.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

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


def reasignar_numeros_tanda(db: Session, *, commit: bool = False) -> int:
    """
    Recalcula numero_tanda para todas las tandas activas.
    Returns cantidad de tandas numeradas.
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

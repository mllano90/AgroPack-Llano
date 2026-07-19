"""
Legacy: la numeración de tandas fue desactivada.
El desverdizado se ordena solo por fecha de corte (recepción) ASC, luego id.

Las funciones quedan como no-op por si algún import residual las llama.
"""
from __future__ import annotations

from sqlalchemy.orm import Session


def filas_activas_desverdizado(db: Session) -> list:
    from app.models.inventory import InventarioDesverdizado

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
    return 0


def asignar_numero_tanda_nueva(db: Session, row) -> None:
    return None


def reasignar_numeros_tanda(db: Session, *, commit: bool = False) -> int:
    """No-op: las tandas ya no se numeran."""
    return 0

"""
Numeración de tandas de desverdizado.

Reglas de negocio:
1) Al EMPACAR: no se toca numero_tanda (aunque quede en 0 bins / empaquetado).
2) Al REHABILITAR (devolver bins por anular/editar empaque): se conserva el
   numero_tanda original de esa fila; NO se asigna uno nuevo.
3) Al ELIMINAR una tanda (correcciones / recepción): se renumeran 1..N las
   tandas que aún tienen bins > 0 (orden: fecha corte ASC, id ASC).
4) Al CREAR recepción nueva: solo a esa fila se le da max(existentes)+1.
"""
from __future__ import annotations

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.inventory import InventarioDesverdizado


def filas_activas_desverdizado(db: Session) -> list:
    """Tandas con stock que se listan en empaque / dashboard."""
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
    """Siguiente número libre sin reordenar (solo para tandas NUEVAS de recepción)."""
    m = db.query(func.max(InventarioDesverdizado.numero_tanda)).scalar()
    return int(m or 0) + 1


def asignar_numero_tanda_nueva(db: Session, row: InventarioDesverdizado) -> int | None:
    """
    Asigna numero_tanda SOLO si la fila es nueva y aún no tiene número.
    Nunca pisa un numero_tanda existente (p.ej. tanda rehabilitada tras empaque).
    """
    if row is None:
        return None
    if row.numero_tanda is not None:
        return row.numero_tanda
    if (row.estado or "") == "eliminado":
        return None
    # Solo filas nuevas con stock (o recién creadas)
    n = siguiente_numero_tanda(db)
    row.numero_tanda = n
    db.flush()
    return n


def reasignar_numeros_tanda(db: Session, *, commit: bool = False) -> int:
    """
    Renumerar 1..N las tandas CON stock (bins > 0).

    Usar ÚNICAMENTE al ELIMINAR tandas desde correcciones/recepción.

    Importante: las filas en 0 bins (empaquetadas) CONSERVAN su numero_tanda
    para que, si se rehabilitan (anular empaque), sigan con la tanda original.
    Solo se limpia numero_tanda en estado 'eliminado'.
    """
    # Limpiar solo eliminadas definitivas
    eliminadas = (
        db.query(InventarioDesverdizado)
        .filter(InventarioDesverdizado.estado == "eliminado")
        .all()
    )
    for r in eliminadas:
        if r.numero_tanda is not None:
            r.numero_tanda = None

    activas = filas_activas_desverdizado(db)
    for i, r in enumerate(activas, start=1):
        r.numero_tanda = i

    if commit:
        db.commit()
    else:
        db.flush()
    return len(activas)

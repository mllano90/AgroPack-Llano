from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import require_roles
from app.models.enums import Rol
from app.schemas.recepcion import RecepcionCampoCreate, RecepcionCampoResponse
from app.models.inventory import RecepcionCampo, InventarioCampo, InventarioFinal, InventarioDesverdizado
from app.models.enums import Producto
from app.core.constants import DIAS_DESVERDIZADO
from app.utils.tandas import reasignar_numeros_tanda
from datetime import datetime, timedelta, date

router = APIRouter(tags=["Recepción"])


class DesverdizadoUpdate(BaseModel):
    """Edición admin de un registro de desverdizado."""
    lote: str | None = None
    cantidad_bins: int | None = Field(default=None, ge=0)
    fecha_recepcion: str | None = None  # YYYY-MM-DD o DD/MM/YYYY
    fecha_tentativa_salida: str | None = None
    estado: str | None = None  # en_desverdizado | listo_empaque
    recalcular_tentativa: bool = True  # si cambia fecha_recepcion y no mandan tentativa


def _parse_date_flex(s: str | None) -> date | None:
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise HTTPException(status_code=400, detail=f"Fecha inválida: {s}")

@router.post("/", response_model=RecepcionCampoResponse)
def crear_recepcion(
    recepcion: RecepcionCampoCreate, 
    db: Session = Depends(get_db),
    current_user = Depends(require_roles([Rol.ADMIN, Rol.RECEPCION, Rol.RECEPCION_EMPACADOR]))
):
    
    # Crear registro de recepción
    fecha_corte = recepcion.fecha_corte
    if isinstance(fecha_corte, str):
        fecha_corte = date.fromisoformat(fecha_corte)
    fecha_corte = fecha_corte or date.today()
    
    nueva_recepcion = RecepcionCampo(
        producto=recepcion.producto,
        variedad=recepcion.variedad,
        cantidad_cajas_campo=recepcion.cantidad_cajas_campo,
        cantidad_cajas_carton=recepcion.cantidad_cajas_carton,
        tipo_cultivo_carton=recepcion.tipo_cultivo_carton,
        mercado=recepcion.mercado,
        # Limón: persistir para historial / cruce con desverdizado
        lote=recepcion.lote,
        cantidad_bins=recepcion.cantidad_bins or 0,
        fecha_corte=fecha_corte if recepcion.producto == Producto.LIMON_AMARILLO else None,
        fecha=fecha_corte if recepcion.producto == Producto.LIMON_AMARILLO else date.today(),
        usuario_id=current_user.id if hasattr(current_user, 'id') else None,
    )
    db.add(nueva_recepcion)
    db.flush()  # to assign id before using it

    # ======================================================
    # LÓGICA PARA UVA (mantener compatibilidad)
    # ======================================================

    if recepcion.producto == Producto.UVA:
        # Caso 1: Recepción de Caja de Campo
        if recepcion.cantidad_cajas_campo > 0:
            inv_campo = db.query(InventarioCampo).filter(
                InventarioCampo.variedad == recepcion.variedad,
                InventarioCampo.mercado == recepcion.mercado,
            ).first()

            if inv_campo:
                inv_campo.cantidad_disponible += recepcion.cantidad_cajas_campo
            else:
                inv_campo = InventarioCampo(
                    variedad=recepcion.variedad,
                    mercado=recepcion.mercado,
                    cantidad_disponible=recepcion.cantidad_cajas_campo
                )
                db.add(inv_campo)

        # Caso 2: Recepción de Caja de Cartón Lista
        if recepcion.cantidad_cajas_carton and recepcion.cantidad_cajas_carton > 0:
            if not recepcion.tipo_cultivo_carton:
                raise HTTPException(status_code=400, detail="Debe seleccionar el tipo de cultivo para Caja de Cartón Lista")

            inv_final = db.query(InventarioFinal).filter(
                InventarioFinal.producto == recepcion.producto,
                InventarioFinal.variedad == recepcion.variedad,
                InventarioFinal.tipo_cultivo == recepcion.tipo_cultivo_carton,
                InventarioFinal.mercado == recepcion.mercado,
            ).first()

            if inv_final:
                inv_final.cantidad_stock += recepcion.cantidad_cajas_carton
            else:
                inv_final = InventarioFinal(
                    producto=recepcion.producto,
                    variedad=recepcion.variedad,
                    tipo_cultivo=recepcion.tipo_cultivo_carton,
                    mercado=recepcion.mercado,
                    cantidad_stock=recepcion.cantidad_cajas_carton
                )
                db.add(inv_final)
    
    # ======================================================
    # LÓGICA PARA LIMÓN
    # ======================================================
    if recepcion.producto == Producto.LIMON_AMARILLO:
        if recepcion.cantidad_bins <= 0 or not recepcion.lote:
            raise HTTPException(status_code=400, detail="Para Limón se requiere cantidad_bins > 0 y lote")
        
        # Fecha de recepción/corte; salida tentativa = + DIAS_DESVERDIZADO
        fecha_recepcion = fecha_corte
        fecha_tentativa = fecha_recepcion + timedelta(days=DIAS_DESVERDIZADO)
        
        # Crear entrada en inventario de desverdizado (ligada a esta recepción)
        inv_desv = InventarioDesverdizado(
            producto=Producto.LIMON_AMARILLO,
            cantidad_bins=recepcion.cantidad_bins,
            lote=recepcion.lote,
            fecha_recepcion=fecha_recepcion,
            fecha_tentativa_salida=fecha_tentativa,
            estado="en_desverdizado",
            recepcion_id=nueva_recepcion.id,
            usuario_id=current_user.id if hasattr(current_user, 'id') else None
        )
        db.add(inv_desv)
        db.flush()
        reasignar_numeros_tanda(db)
    
    db.commit()
    db.refresh(nueva_recepcion)
    return nueva_recepcion


@router.get("/", response_model=list[RecepcionCampoResponse])
def listar_recepciones(db: Session = Depends(get_db)):
    return db.query(RecepcionCampo).all()

@router.get("/desverdizado", response_model=list[dict])
def listar_desverdizado(db: Session = Depends(get_db)):
    """Lista el inventario actual en desverdizado para selección en empaque.
    Orden: fecha de corte/recepción (más antiguo primero), luego id.
    """
    # Asegurar numeración coherente (p.ej. tras deploy o datos viejos)
    reasignar_numeros_tanda(db, commit=True)

    items = (
        db.query(InventarioDesverdizado)
        .filter(
            InventarioDesverdizado.estado.in_(["en_desverdizado", "listo_empaque"]),
            InventarioDesverdizado.cantidad_bins > 0,
        )
        .order_by(
            InventarioDesverdizado.fecha_recepcion.asc(),
            InventarioDesverdizado.id.asc(),
        )
        .all()
    )
    # Excluir eliminados por si quedó estado raro
    items = [d for d in items if (d.estado or "") != "eliminado" and (d.cantidad_bins or 0) > 0]
    return [
        {
            "id": d.id,
            "lote": d.lote,
            "cantidad_bins_disponibles": d.cantidad_bins,
            "fecha_recepcion": str(d.fecha_recepcion),
            "fecha_tentativa_salida": str(d.fecha_tentativa_salida),
            "estado": d.estado,
            "numero_tanda": d.numero_tanda,
        }
        for d in items
    ]

@router.post("/desverdizado/{desverdizado_id}/salir")
def marcar_salida_desverdizado(
    desverdizado_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_roles([Rol.ADMIN, Rol.RECEPCION_EMPACADOR, Rol.EMPACADOR]))
):
    """Usuario marca manualmente que el lote sale de desverdizado."""
    des = db.query(InventarioDesverdizado).filter(InventarioDesverdizado.id == desverdizado_id).first()
    if not des:
        raise HTTPException(status_code=404, detail="Lote de desverdizado no encontrado")
    
    if des.estado == "empaquetado":
        raise HTTPException(status_code=400, detail="Ya fue empaquetado")
    
    des.fecha_real_salida = date.today()
    des.estado = "listo_empaque"
    db.commit()
    db.refresh(des)
    return {"message": "Salida de desverdizado registrada", "fecha": des.fecha_real_salida}


@router.get("/admin/desverdizado", response_model=list[dict])
def listar_desverdizado_admin(
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """Lista lotes en desverdizado (con stock) para correcciones admin."""
    reasignar_numeros_tanda(db, commit=True)

    items = (
        db.query(InventarioDesverdizado)
        .filter(InventarioDesverdizado.cantidad_bins > 0)
        .order_by(
            InventarioDesverdizado.fecha_recepcion.asc(),
            InventarioDesverdizado.id.asc(),
        )
        .limit(200)
        .all()
    )
    return [
        {
            "id": d.id,
            "lote": d.lote,
            "cantidad_bins_disponibles": d.cantidad_bins,
            "fecha_recepcion": str(d.fecha_recepcion) if d.fecha_recepcion else None,
            "fecha_tentativa_salida": str(d.fecha_tentativa_salida) if d.fecha_tentativa_salida else None,
            "estado": d.estado,
            "numero_tanda": d.numero_tanda,
        }
        for d in items
    ]


def _purge_desverdizado_rows(db: Session, rows: list) -> tuple[int, int, list[int]]:
    """Pone bins en 0, marca eliminado y borra filas. Returns (n_rows, bins, ids)."""
    if not rows:
        return 0, 0, []
    ids = [r.id for r in rows]
    bins_total = sum(int(r.cantidad_bins or 0) for r in rows)
    for r in rows:
        r.cantidad_bins = 0
        r.estado = "eliminado"
        r.numero_tanda = None
    db.flush()
    for r in rows:
        db.delete(r)
    db.flush()
    reasignar_numeros_tanda(db)
    db.commit()
    return len(ids), bins_total, ids


@router.patch("/admin/desverdizado/{desverdizado_id}")
def editar_desverdizado_admin(
    desverdizado_id: int,
    body: DesverdizadoUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Edita un registro de desverdizado (lote, bins, fechas, estado).
    Solo admin. Si cambia fecha de corte/recepción y recalcular_tentativa=True,
    actualiza salida tentativa = recepción + DIAS_DESVERDIZADO.
    """
    des = db.query(InventarioDesverdizado).filter(InventarioDesverdizado.id == desverdizado_id).first()
    if not des:
        raise HTTPException(status_code=404, detail="Lote de desverdizado no encontrado")
    if (des.estado or "") == "eliminado":
        raise HTTPException(status_code=400, detail="Este registro ya fue eliminado")

    if body.lote is not None:
        lote_new = body.lote.strip()
        if not lote_new:
            raise HTTPException(status_code=400, detail="El lote no puede quedar vacío")
        des.lote = lote_new

    if body.cantidad_bins is not None:
        des.cantidad_bins = int(body.cantidad_bins)

    fecha_rec_changed = False
    if body.fecha_recepcion is not None:
        fr = _parse_date_flex(body.fecha_recepcion)
        if fr:
            des.fecha_recepcion = fr
            fecha_rec_changed = True

    if body.fecha_tentativa_salida is not None:
        ft = _parse_date_flex(body.fecha_tentativa_salida)
        if ft:
            des.fecha_tentativa_salida = ft
    elif fecha_rec_changed and body.recalcular_tentativa and des.fecha_recepcion:
        des.fecha_tentativa_salida = des.fecha_recepcion + timedelta(days=DIAS_DESVERDIZADO)

    if body.estado is not None:
        est = body.estado.strip().lower()
        allowed = {"en_desverdizado", "listo_empaque", "empaquetado"}
        if est not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Estado inválido. Use: {', '.join(sorted(allowed))}",
            )
        des.estado = est

    if des.cantidad_bins == 0 and des.estado not in ("empaquetado", "eliminado"):
        # 0 bins: no debe listarse en empaque
        des.estado = "empaquetado"
        des.numero_tanda = None

    reasignar_numeros_tanda(db)
    db.commit()
    db.refresh(des)
    return {
        "message": f"Desverdizado #{des.id} actualizado (tandas renumeradas)",
        "id": des.id,
        "lote": des.lote,
        "cantidad_bins_disponibles": des.cantidad_bins,
        "fecha_recepcion": str(des.fecha_recepcion) if des.fecha_recepcion else None,
        "fecha_tentativa_salida": str(des.fecha_tentativa_salida) if des.fecha_tentativa_salida else None,
        "estado": des.estado,
        "numero_tanda": des.numero_tanda,
    }


@router.delete("/admin/desverdizado/{desverdizado_id}")
def eliminar_desverdizado_admin(
    desverdizado_id: int,
    todo_el_lote: bool = True,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Elimina registro(s) de desverdizado mal dados de alta.
    Por defecto borra TODAS las filas con el mismo nombre de lote (puede haber
    varias recepciones del mismo lote). Empaque y dashboard dejan de verlas.
    """
    des = db.query(InventarioDesverdizado).filter(InventarioDesverdizado.id == desverdizado_id).first()
    if not des:
        raise HTTPException(status_code=404, detail="Lote de desverdizado no encontrado")

    lote = (des.lote or "").strip()
    if todo_el_lote and lote:
        # Todas las filas del mismo lote (puede haber varias recepciones)
        all_rows = db.query(InventarioDesverdizado).all()
        rows = [r for r in all_rows if (r.lote or "").strip() == lote]
        if not rows:
            rows = [des]
    else:
        rows = [des]

    n, bins_total, ids = _purge_desverdizado_rows(db, rows)
    return {
        "message": (
            f"Eliminado lote '{lote}': {n} registro(s), {bins_total} bins. "
            f"Ya no aparece en empaque ni inventarios."
        ),
        "id": desverdizado_id,
        "ids_eliminados": ids,
        "lote": lote,
        "bins_eliminados": bins_total,
        "registros_eliminados": n,
    }


@router.delete("/admin/desverdizado-por-lote")
def eliminar_desverdizado_por_lote(
    lote: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """Elimina por nombre de lote (todas las filas con ese lote)."""
    lote_clean = (lote or "").strip()
    if not lote_clean:
        raise HTTPException(status_code=400, detail="Indica el nombre del lote")

    all_rows = db.query(InventarioDesverdizado).all()
    rows = [r for r in all_rows if (r.lote or "").strip() == lote_clean]
    if not rows:
        raise HTTPException(status_code=404, detail=f"No hay desverdizado para lote '{lote_clean}'")

    n, bins_total, ids = _purge_desverdizado_rows(db, rows)
    return {
        "message": f"Eliminado lote '{lote_clean}': {n} registro(s), {bins_total} bins",
        "ids_eliminados": ids,
        "lote": lote_clean,
        "bins_eliminados": bins_total,
        "registros_eliminados": n,
    }

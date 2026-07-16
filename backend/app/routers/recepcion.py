from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import require_roles
from app.models.enums import Rol
from app.schemas.recepcion import RecepcionCampoCreate, RecepcionCampoResponse
from app.models.inventory import RecepcionCampo, InventarioCampo, InventarioFinal, InventarioDesverdizado
from app.models.enums import Producto
from app.core.constants import DIAS_DESVERDIZADO
from datetime import datetime, timedelta, date

router = APIRouter(tags=["Recepción"])

@router.post("/", response_model=RecepcionCampoResponse)
def crear_recepcion(
    recepcion: RecepcionCampoCreate, 
    db: Session = Depends(get_db),
    current_user = Depends(require_roles([Rol.ADMIN, Rol.RECEPCION, Rol.RECEPCION_EMPACADOR]))
):
    
    # Crear registro de recepción
    fecha_recepcion = recepcion.fecha_corte
    if isinstance(fecha_recepcion, str):
        fecha_recepcion = date.fromisoformat(fecha_recepcion)
    fecha_recepcion = fecha_recepcion or date.today()
    
    nueva_recepcion = RecepcionCampo(
        producto=recepcion.producto,
        variedad=recepcion.variedad,
        cantidad_cajas_campo=recepcion.cantidad_cajas_campo,
        cantidad_cajas_carton=recepcion.cantidad_cajas_carton,
        tipo_cultivo_carton=recepcion.tipo_cultivo_carton,
        mercado=recepcion.mercado,
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
        
        # Fecha de recepción = fecha de corte; salida tentativa = + DIAS_DESVERDIZADO
        fecha_recepcion = recepcion.fecha_corte or date.today()
        fecha_tentativa = fecha_recepcion + timedelta(days=DIAS_DESVERDIZADO)
        
        # Crear entrada en inventario de desverdizado (automático)
        inv_desv = InventarioDesverdizado(
            producto=Producto.LIMON_AMARILLO,
            cantidad_bins=recepcion.cantidad_bins,
            lote=recepcion.lote,
            fecha_recepcion=fecha_recepcion,
            fecha_tentativa_salida=fecha_tentativa,
            estado="en_desverdizado",
            # recepcion_id not set to avoid potential relationship issues
            usuario_id=current_user.id if hasattr(current_user, 'id') else None
        )
        db.add(inv_desv)
    
    db.commit()
    db.refresh(nueva_recepcion)
    return nueva_recepcion


@router.get("/", response_model=list[RecepcionCampoResponse])
def listar_recepciones(db: Session = Depends(get_db)):
    return db.query(RecepcionCampo).all()

@router.get("/desverdizado", response_model=list[dict])
def listar_desverdizado(db: Session = Depends(get_db)):
    """Lista el inventario actual en desverdizado para selección en empaque."""
    items = db.query(InventarioDesverdizado).filter(
        InventarioDesverdizado.estado.in_(["en_desverdizado", "listo_empaque"]),
        InventarioDesverdizado.cantidad_bins > 0
    ).all()
    return [
        {
            "id": d.id,
            "lote": d.lote,
            "cantidad_bins_disponibles": d.cantidad_bins,
            "fecha_recepcion": str(d.fecha_recepcion),
            "fecha_tentativa_salida": str(d.fecha_tentativa_salida),
            "estado": d.estado
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
    items = (
        db.query(InventarioDesverdizado)
        .filter(InventarioDesverdizado.cantidad_bins > 0)
        .order_by(InventarioDesverdizado.fecha_recepcion.desc(), InventarioDesverdizado.id.desc())
        .limit(100)
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
        }
        for d in items
    ]


@router.delete("/admin/desverdizado/{desverdizado_id}")
def eliminar_desverdizado_admin(
    desverdizado_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Elimina un lote de desverdizado mal dado de alta.
    Solo admin. No revierte recepción de campo (solo quita el stock de desverdizado).
    """
    des = db.query(InventarioDesverdizado).filter(InventarioDesverdizado.id == desverdizado_id).first()
    if not des:
        raise HTTPException(status_code=404, detail="Lote de desverdizado no encontrado")

    lote = des.lote
    bins = des.cantidad_bins
    db.delete(des)
    db.commit()
    return {
        "message": f"Lote {lote} eliminado de desverdizado ({bins} bins)",
        "id": desverdizado_id,
        "lote": lote,
        "bins_eliminados": bins,
    }

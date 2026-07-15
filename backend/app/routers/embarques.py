from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from app.core.database import get_db
from app.core.security import require_roles
from app.models.enums import Rol
from app.schemas.embarques import EmbarqueCreate, EmbarqueResponse
from app.models.inventory import Embarque, EmbarqueDetalle, InventarioFinal, Cliente
from app.models.enums import Producto

router = APIRouter(tags=["Embarques"])


@router.post("/", response_model=EmbarqueResponse)
def crear_embarque(
    embarque: EmbarqueCreate, 
    db: Session = Depends(get_db),
    current_user = Depends(require_roles([Rol.ADMIN]))
):
    
    # Validar que el cliente exista
    cliente = db.query(Cliente).filter(Cliente.id == embarque.cliente_id, Cliente.activo == 1).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado o inactivo")

    # Crear el embarque principal
    nuevo_embarque = Embarque(
        cliente_id=embarque.cliente_id,
        notas=embarque.notas,
        estado="en_transito"
    )
    db.add(nuevo_embarque)
    db.flush()

    # Procesar cada detalle y restar del inventario
    for detalle in embarque.detalles:
        if detalle.producto == Producto.LIMON_AMARILLO:
            # For limón, safe match on product + presentacion + talla
            all_inv = db.query(InventarioFinal).filter(
                InventarioFinal.producto == detalle.producto
            ).all()
            inv_final = next(
                (i for i in all_inv 
                 if (i.atributos_extra or {}).get("presentacion") == detalle.presentacion
                 and (i.atributos_extra or {}).get("talla") == detalle.talla),
                None
            )

            if not inv_final or inv_final.cantidad_stock < detalle.cantidad_cajas:
                pres_label = f"{detalle.presentacion or ''} T{detalle.talla or ''}".strip()
                raise HTTPException(
                    status_code=400,
                    detail=f"No hay suficiente stock de Limón - {pres_label}. Disponible: {inv_final.cantidad_stock if inv_final else 0}"
                )

            inv_final.cantidad_stock -= detalle.cantidad_cajas

            detalle_embarque = EmbarqueDetalle(
                embarque_id=nuevo_embarque.id,
                producto=detalle.producto,
                variedad=None,
                tipo_cultivo=None,
                mercado=detalle.mercado,
                cantidad_cajas=detalle.cantidad_cajas,
                presentacion=detalle.presentacion,
                talla=detalle.talla,
                calidad=detalle.calidad
            )
            db.add(detalle_embarque)
        else:
            # Original logic for Uva
            inv_final = db.query(InventarioFinal).filter(
                InventarioFinal.producto == detalle.producto,
                InventarioFinal.variedad == detalle.variedad,
                InventarioFinal.tipo_cultivo == detalle.tipo_cultivo,
                InventarioFinal.mercado == detalle.mercado,
            ).first()

            if not inv_final or inv_final.cantidad_stock < detalle.cantidad_cajas:
                raise HTTPException(
                    status_code=400,
                    detail=f"No hay suficiente stock de {detalle.producto.value} - {detalle.variedad.value} - {detalle.tipo_cultivo.value} - {detalle.mercado.value}. "
                           f"Disponible: {inv_final.cantidad_stock if inv_final else 0}"
                )

            inv_final.cantidad_stock -= detalle.cantidad_cajas

            detalle_embarque = EmbarqueDetalle(
                embarque_id=nuevo_embarque.id,
                producto=detalle.producto,
                variedad=detalle.variedad,
                tipo_cultivo=detalle.tipo_cultivo,
                mercado=detalle.mercado,
                cantidad_cajas=detalle.cantidad_cajas
            )
            db.add(detalle_embarque)

    db.commit()
    
    # Recargar con detalles
    embarque_completo = db.query(Embarque).options(
        joinedload(Embarque.detalles)
    ).filter(Embarque.id == nuevo_embarque.id).first()

    return embarque_completo


@router.get("/", response_model=list[EmbarqueResponse])
def listar_embarques(db: Session = Depends(get_db)):
    return db.query(Embarque).options(
        joinedload(Embarque.detalles)
    ).all()

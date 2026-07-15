from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.inventory import InventarioFinal, InventarioCampo, Embarque, InventarioDesverdizado
from app.schemas.reports import DashboardResponse, InventarioFinalItem, InventarioCampoItem, DesverdizadoItem

router = APIRouter(tags=["Reportes"])

@router.get("/dashboard", response_model=DashboardResponse)
def obtener_dashboard(db: Session = Depends(get_db)):
    
    # Inventario Final (soporta uva + limón con presentaciones)
    inventario_final = db.query(InventarioFinal).all()
    
    final_list = []
    for item in inventario_final:
        extra = item.atributos_extra or {}
        if not isinstance(extra, dict):
            extra = {}
        final_list.append(
            InventarioFinalItem(
                producto=item.producto,
                variedad=item.variedad,
                tipo_cultivo=item.tipo_cultivo,
                mercado=item.mercado,
                cantidad_stock=item.cantidad_stock,
                presentacion=extra.get("presentacion"),
                calidad=extra.get("calidad"),
                talla=extra.get("talla"),
            )
        )
    
    # Inventario de Campo ahora separado por mercado
    inventario_campo = db.query(InventarioCampo).all()
    campo_list = [
        InventarioCampoItem(
            variedad=item.variedad,
            mercado=item.mercado,
            cantidad=item.cantidad_disponible
        ) for item in inventario_campo
    ]
    
    # Embarques recientes (últimos 10)
    embarques_recientes = db.query(Embarque).order_by(Embarque.fecha_salida.desc()).limit(10).all()

    # Inventario en Desverdizado (bins de limón en proceso)
    desverdizado_raw = db.query(InventarioDesverdizado).filter(
        InventarioDesverdizado.cantidad_bins > 0
    ).order_by(InventarioDesverdizado.fecha_recepcion.desc()).all()

    desverdizado_list = [
        DesverdizadoItem(
            lote=d.lote,
            cantidad_bins_disponibles=d.cantidad_bins,
            fecha_recepcion=str(d.fecha_recepcion),
            fecha_tentativa_salida=str(d.fecha_tentativa_salida),
            estado=d.estado
        )
        for d in desverdizado_raw
    ]
    
    return DashboardResponse(
        inventario_final=final_list,
        inventario_campo=campo_list,
        desverdizado=desverdizado_list,
        embarques_recientes=[{
            "id": e.id,
            "cliente": getattr(e.cliente, 'nombre', str(e.cliente_id)) if e.cliente else str(e.cliente_id),
            "fecha_salida": e.fecha_salida,
            "estado": e.estado
        } for e in embarques_recientes]
    )

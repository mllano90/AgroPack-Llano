from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import require_roles
from app.models.enums import Rol
from app.schemas.empaque import EmpaqueCreate, EmpaqueResponse, AgregarConsumoRequest, AnularEmpaqueResponse
from app.models.inventory import Empaque, InventarioCampo, InventarioFinal, InventarioDesverdizado
from app.models.enums import Producto
from app.models.enums import Producto as ProductoEnum

router = APIRouter(tags=["Empaque"])


def _consumir_bins_lote(db: Session, lote: str, bins: int) -> None:
    """Descuenta bins de un lote en desverdizado."""
    if bins <= 0 or not lote:
        raise HTTPException(status_code=400, detail="lote y bins > 0 son requeridos")
    query = (
        db.query(InventarioDesverdizado)
        .filter(
            InventarioDesverdizado.producto == Producto.LIMON_AMARILLO,
            InventarioDesverdizado.lote == lote,
            InventarioDesverdizado.cantidad_bins > 0,
        )
        .order_by(InventarioDesverdizado.fecha_recepcion)
    )
    desvs = query.all()
    restante = bins
    for d in desvs:
        if restante <= 0:
            break
        usar = min(restante, d.cantidad_bins)
        d.cantidad_bins -= usar
        restante -= usar
        if d.cantidad_bins == 0:
            d.estado = "empaquetado"
        elif d.estado == "en_desverdizado":
            d.estado = "listo_empaque"
    if restante > 0:
        raise HTTPException(
            status_code=400,
            detail=f"No hay suficientes bins en desverdizado para lote {lote}. Faltan {restante}",
        )


def _devolver_bins_lote(db: Session, lote: str, bins: int) -> None:
    """Devuelve bins a un lote (anular empaque)."""
    if bins <= 0 or not lote:
        return
    des = (
        db.query(InventarioDesverdizado)
        .filter(
            InventarioDesverdizado.producto == Producto.LIMON_AMARILLO,
            InventarioDesverdizado.lote == lote,
        )
        .order_by(InventarioDesverdizado.id.desc())
        .first()
    )
    if des:
        des.cantidad_bins = (des.cantidad_bins or 0) + bins
        if des.estado == "empaquetado":
            des.estado = "listo_empaque"
    else:
        from datetime import date, timedelta
        from app.core.constants import DIAS_DESVERDIZADO

        hoy = date.today()
        db.add(
            InventarioDesverdizado(
                producto=Producto.LIMON_AMARILLO,
                cantidad_bins=bins,
                lote=lote,
                fecha_recepcion=hoy,
                fecha_tentativa_salida=hoy + timedelta(days=DIAS_DESVERDIZADO),
                estado="listo_empaque",
            )
        )


def _ajustar_inventario_final(db: Session, producto: Producto, mercado, produccion: list, signo: int) -> None:
    """suma (signo=+1) o resta (signo=-1) producción en inventario final."""
    for linea in produccion or []:
        pres = linea.get("presentacion")
        cant = int(linea.get("cantidad") or 0)
        talla_val = linea.get("talla") if pres != "bins_jugo" else None
        if not pres or cant <= 0:
            continue
        delta = cant * signo
        all_for_product = db.query(InventarioFinal).filter(InventarioFinal.producto == producto).all()
        inv_final = next(
            (
                i
                for i in all_for_product
                if (i.atributos_extra or {}).get("presentacion") == pres
                and (i.atributos_extra or {}).get("talla") == talla_val
            ),
            None,
        )
        if inv_final:
            nuevo = (inv_final.cantidad_stock or 0) + delta
            if nuevo < 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"No se puede anular: stock insuficiente de {pres} talla {talla_val} (hay {inv_final.cantidad_stock})",
                )
            inv_final.cantidad_stock = nuevo
        elif signo > 0:
            calidad = "segunda" if pres == "bins_jugo" else "primera"
            extra = {"presentacion": pres, "calidad": calidad}
            if talla_val:
                extra["talla"] = talla_val
            db.add(
                InventarioFinal(
                    producto=producto,
                    variedad=None,
                    tipo_cultivo=None,
                    mercado=mercado,
                    cantidad_stock=delta,
                    atributos_extra=extra,
                )
            )
        else:
            raise HTTPException(
                status_code=400,
                detail=f"No se puede anular: no existe inventario final de {pres} talla {talla_val}",
            )

@router.post("/", response_model=EmpaqueResponse)
def crear_empaque(
    empaque: EmpaqueCreate, 
    db: Session = Depends(get_db),
    current_user = Depends(require_roles([Rol.ADMIN, Rol.RECEPCION_EMPACADOR, Rol.EMPACADOR]))
):
    
    if empaque.producto == Producto.UVA:
        # 1. Verificar inventario de campo por variedad + mercado
        inv_campo = db.query(InventarioCampo).filter(
            InventarioCampo.variedad == empaque.variedad,
            InventarioCampo.mercado == empaque.mercado,
        ).first()
        
        if not inv_campo or inv_campo.cantidad_disponible < empaque.cantidad_cajas_campo_usadas:
            raise HTTPException(
                status_code=400, 
                detail=f"No hay suficiente inventario de cajas de campo de {empaque.variedad} ({empaque.mercado}). Disponible: {inv_campo.cantidad_disponible if inv_campo else 0}"
            )
        
        # 2. Restar del inventario de campo correcto (por mercado)
        inv_campo.cantidad_disponible -= empaque.cantidad_cajas_campo_usadas
    
    if empaque.producto == Producto.LIMON_AMARILLO:
        # Consumir de inventario de desverdizado (soporta múltiples lotes)
        consumos = empaque.consumos_desverdizado or []
        if empaque.bins_desverdizado_usados > 0 and not consumos:
            # legacy single lote
            consumos = [{"lote": empaque.lote_desverdizado, "bins": empaque.bins_desverdizado_usados}]
        
        for consumo in consumos:
            lote = consumo.get("lote")
            bins = consumo.get("bins", 0)
            if bins <= 0:
                continue
            query = db.query(InventarioDesverdizado).filter(
                InventarioDesverdizado.producto == Producto.LIMON_AMARILLO,
                InventarioDesverdizado.cantidad_bins > 0
            )
            if lote:
                query = query.filter(InventarioDesverdizado.lote == lote)
            else:
                query = query.order_by(InventarioDesverdizado.fecha_recepcion)
            desvs = query.all()
            restante = bins
            for d in desvs:
                if restante <= 0:
                    break
                usar = min(restante, d.cantidad_bins)
                d.cantidad_bins -= usar
                restante -= usar
                if d.cantidad_bins == 0:
                    d.estado = "empaquetado"
                elif d.estado == "en_desverdizado":
                    d.estado = "listo_empaque"
            if restante > 0:
                raise HTTPException(status_code=400, detail=f"No hay suficientes bins en desverdizado para lote {lote or 'cualquiera'}")
        
        # Producir a inventario final por presentación (cantidades separadas) + talla para 1ra
        # Use structured produccion if provided (new line-based UI), else legacy flat counts + single talla
        lineas = empaque.produccion or []
        if lineas:
            for linea in lineas:
                pres = linea.get("presentacion")
                cant = linea.get("cantidad", 0)
                talla_val = linea.get("talla") if pres != "bins_jugo" else None
                if cant <= 0 or not pres:
                    continue
                calidad = "segunda" if pres == "bins_jugo" else "primera"
                all_for_product = db.query(InventarioFinal).filter(
                    InventarioFinal.producto == empaque.producto
                ).all()
                inv_final = next(
                    (i for i in all_for_product 
                     if (i.atributos_extra or {}).get("presentacion") == pres 
                     and (i.atributos_extra or {}).get("talla") == talla_val),
                    None
                )
                if inv_final:
                    inv_final.cantidad_stock += cant
                    extra = dict(inv_final.atributos_extra or {})
                    extra["calidad"] = calidad
                    if talla_val:
                        extra["talla"] = talla_val
                    inv_final.atributos_extra = extra
                else:
                    extra = {"presentacion": pres, "calidad": calidad}
                    if talla_val:
                        extra["talla"] = talla_val
                    inv_final = InventarioFinal(
                        producto=empaque.producto,
                        variedad=None,
                        tipo_cultivo=None,
                        mercado=empaque.mercado,
                        cantidad_stock=cant,
                        atributos_extra=extra
                    )
                    db.add(inv_final)
        else:
            # legacy path
            talla = getattr(empaque, 'talla', None)
            presentaciones = [
                ("rpc_12", empaque.cantidad_rpc12),
                ("rpc_18", empaque.cantidad_rpc18),
                ("caja_40lbs", empaque.cantidad_caja40lbs),
                ("bins_jugo", empaque.cantidad_bins_jugo),
            ]
            for pres, cant in presentaciones:
                if cant <= 0:
                    continue
                calidad = "segunda" if pres == "bins_jugo" else "primera"
                talla_val = None if pres == "bins_jugo" else talla
                all_for_product = db.query(InventarioFinal).filter(
                    InventarioFinal.producto == empaque.producto
                ).all()
                inv_final = next(
                    (i for i in all_for_product 
                     if (i.atributos_extra or {}).get("presentacion") == pres 
                     and (i.atributos_extra or {}).get("talla") == talla_val),
                    None
                )
                if inv_final:
                    inv_final.cantidad_stock += cant
                    extra = dict(inv_final.atributos_extra or {})
                    extra["calidad"] = calidad
                    if talla_val:
                        extra["talla"] = talla_val
                    inv_final.atributos_extra = extra
                else:
                    extra = {"presentacion": pres, "calidad": calidad}
                    if talla_val:
                        extra["talla"] = talla_val
                    inv_final = InventarioFinal(
                        producto=empaque.producto,
                        variedad=None,
                        tipo_cultivo=None,
                        mercado=empaque.mercado,
                        cantidad_stock=cant,
                        atributos_extra=extra
                    )
                    db.add(inv_final)
    
    # 3. Crear el registro de empaque (auditoría)
    detalle_corrida = None
    bins_usados = empaque.bins_desverdizado_usados or 0
    if empaque.producto == Producto.LIMON_AMARILLO:
        consumos = empaque.consumos_desverdizado or []
        if empaque.bins_desverdizado_usados > 0 and not consumos:
            consumos = [{"lote": empaque.lote_desverdizado, "bins": empaque.bins_desverdizado_usados}]
        lineas = empaque.produccion or []
        if not lineas:
            talla = getattr(empaque, "talla", None)
            lineas = []
            for pres, cant in [
                ("rpc_12", empaque.cantidad_rpc12),
                ("rpc_18", empaque.cantidad_rpc18),
                ("caja_40lbs", empaque.cantidad_caja40lbs),
                ("bins_jugo", empaque.cantidad_bins_jugo),
            ]:
                if cant and cant > 0:
                    lineas.append({
                        "presentacion": pres,
                        "talla": None if pres == "bins_jugo" else talla,
                        "cantidad": cant,
                    })
        bins_usados = sum(int(c.get("bins") or 0) for c in consumos)
        lotes = ", ".join(
            f"{c.get('lote')}:{c.get('bins')}" for c in consumos if c.get("lote")
        ) or empaque.lote_desverdizado
        detalle_corrida = {
            "consumos": consumos,
            "produccion": lineas,
            "bins_campo": bins_usados,
            "lotes_resumen": lotes,
        }

    nuevo_empaque = Empaque(
        producto=empaque.producto,
        variedad=empaque.variedad,
        tipo_cultivo=empaque.tipo_cultivo,
        mercado=empaque.mercado,
        cantidad_cajas_campo_usadas=empaque.cantidad_cajas_campo_usadas,
        cantidad_cajas_carton_producidas=empaque.cantidad_cajas_carton_producidas,
        porcentaje_merma=empaque.porcentaje_merma,
        notas_merma=empaque.notas_merma,
        numero_empacador=empaque.numero_empacador,
        bins_desverdizado_usados=bins_usados,
        lote_desverdizado=empaque.lote_desverdizado,
        presentacion=empaque.presentacion,
        talla=empaque.talla,
        calidad=empaque.calidad,
        cantidad_producida=empaque.cantidad_producida,
        detalle_corrida=detalle_corrida,
        usuario_id=current_user.id if hasattr(current_user, 'id') else None
    )
    db.add(nuevo_empaque)
    
    # 4. Actualizar inventario final para uva
    if empaque.producto == Producto.UVA:
        inv_final = db.query(InventarioFinal).filter(
            InventarioFinal.producto == empaque.producto,
            InventarioFinal.variedad == empaque.variedad,
            InventarioFinal.tipo_cultivo == empaque.tipo_cultivo,
            InventarioFinal.mercado == empaque.mercado,
        ).first()
        
        if inv_final:
            inv_final.cantidad_stock += empaque.cantidad_cajas_carton_producidas
        else:
            inv_final = InventarioFinal(
                producto=empaque.producto,
                variedad=empaque.variedad,
                tipo_cultivo=empaque.tipo_cultivo,
                mercado=empaque.mercado,
                cantidad_stock=empaque.cantidad_cajas_carton_producidas
            )
            db.add(inv_final)
    
    db.commit()
    db.refresh(nuevo_empaque)
    return nuevo_empaque


@router.get("/", response_model=list[EmpaqueResponse])
def listar_empaques(db: Session = Depends(get_db)):
    return db.query(Empaque).order_by(Empaque.id.desc()).limit(100).all()


@router.get("/admin/recientes", response_model=list[EmpaqueResponse])
def listar_empaques_admin(
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """Lista empaques recientes (solo admin) para correcciones."""
    return (
        db.query(Empaque)
        .order_by(Empaque.id.desc())
        .limit(50)
        .all()
    )


@router.post("/{empaque_id}/agregar-consumo", response_model=EmpaqueResponse)
def agregar_consumo_lote(
    empaque_id: int,
    body: AgregarConsumoRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Corrige un empaque de limón al que le faltó descontar bins de un lote.
    Solo descuenta desverdizado y actualiza detalle_corrida (no cambia producción).
    """
    emp = db.query(Empaque).filter(Empaque.id == empaque_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Empaque no encontrado")
    if emp.producto != Producto.LIMON_AMARILLO:
        raise HTTPException(status_code=400, detail="Solo aplica a empaques de limón")

    detalle = emp.detalle_corrida if isinstance(emp.detalle_corrida, dict) else {}
    if detalle.get("anulado"):
        raise HTTPException(status_code=400, detail="El empaque está anulado")

    _consumir_bins_lote(db, body.lote.strip(), body.bins)

    consumos = list(detalle.get("consumos") or [])
    consumos.append({"lote": body.lote.strip(), "bins": body.bins})
    bins_total = sum(int(c.get("bins") or 0) for c in consumos)
    lotes = ", ".join(f"{c.get('lote')}:{c.get('bins')}" for c in consumos if c.get("lote"))
    detalle = {
        **detalle,
        "consumos": consumos,
        "produccion": detalle.get("produccion") or [],
        "bins_campo": bins_total,
        "lotes_resumen": lotes,
    }
    emp.detalle_corrida = detalle
    emp.bins_desverdizado_usados = bins_total
    # SQLAlchemy JSON mutability
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(emp, "detalle_corrida")
    db.commit()
    db.refresh(emp)
    return emp


@router.post("/{empaque_id}/anular", response_model=AnularEmpaqueResponse)
def anular_empaque(
    empaque_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Anula un empaque de limón: devuelve bins a desverdizado y resta producción del inventario final.
    """
    emp = db.query(Empaque).filter(Empaque.id == empaque_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Empaque no encontrado")
    if emp.producto != Producto.LIMON_AMARILLO:
        raise HTTPException(status_code=400, detail="Anular automático solo para limón por ahora")

    detalle = emp.detalle_corrida if isinstance(emp.detalle_corrida, dict) else {}
    if detalle.get("anulado"):
        raise HTTPException(status_code=400, detail="Este empaque ya está anulado")

    consumos = detalle.get("consumos") or []
    produccion = detalle.get("produccion") or []
    if not consumos and emp.bins_desverdizado_usados:
        consumos = [{"lote": emp.lote_desverdizado or "SIN_LOTE", "bins": emp.bins_desverdizado_usados}]
    if not produccion and emp.presentacion and emp.cantidad_producida:
        produccion = [{
            "presentacion": emp.presentacion,
            "talla": emp.talla,
            "cantidad": emp.cantidad_producida,
        }]

    for c in consumos:
        _devolver_bins_lote(db, str(c.get("lote") or "SIN_LOTE"), int(c.get("bins") or 0))

    _ajustar_inventario_final(db, emp.producto, emp.mercado, produccion, signo=-1)

    detalle = {
        **detalle,
        "consumos": consumos,
        "produccion": produccion,
        "anulado": True,
        "anulado_por": getattr(current_user, "username", None),
    }
    emp.detalle_corrida = detalle
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(emp, "detalle_corrida")
    db.commit()
    return AnularEmpaqueResponse(message="Empaque anulado; inventario revertido", id=empaque_id)

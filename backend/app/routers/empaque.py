from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import require_roles
from app.models.enums import Rol
from datetime import datetime, date as date_cls
from app.schemas.empaque import (
    EmpaqueCreate,
    EmpaqueResponse,
    AgregarConsumoRequest,
    AnularEmpaqueResponse,
    EliminarEmpaqueResponse,
    EmpaqueEditRequest,
    ConvertirGranelRequest,
    ConvertirGranelResponse,
)
from app.models.enums import TipoMercado
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
            # Conservar numero_tanda original (no limpiar ni renumerar)
            d.estado = "empaquetado"
        elif d.estado == "en_desverdizado":
            d.estado = "listo_empaque"
    if restante > 0:
        raise HTTPException(
            status_code=400,
            detail=f"No hay suficientes bins en desverdizado para lote {lote}. Faltan {restante}",
        )


def _norm_lote(lote: str | None) -> str:
    return (lote or "").strip()


def _match_desverdizado_por_lote(db: Session, lote: str) -> list:
    """Filas de desverdizado del lote (match exacto o sin distinguir espacios/mayúsculas)."""
    lote_n = _norm_lote(lote)
    if not lote_n:
        return []
    rows = (
        db.query(InventarioDesverdizado)
        .filter(InventarioDesverdizado.producto == Producto.LIMON_AMARILLO)
        .order_by(
            InventarioDesverdizado.fecha_recepcion.asc(),
            InventarioDesverdizado.id.asc(),
        )
        .all()
    )
    exact = [r for r in rows if _norm_lote(r.lote) == lote_n]
    if exact:
        return exact
    # fallback: comparación casefold
    ln = lote_n.casefold()
    return [r for r in rows if _norm_lote(r.lote).casefold() == ln]


def _devolver_bins_lote(db: Session, lote: str, bins: int) -> None:
    """
    Devuelve bins a desverdizado al anular/editar empaque.
    Prefiere la fila empaquetada del mismo lote (conserva numero_tanda original).
    NUNCA reasigna un número nuevo a una tanda que ya tenía numero_tanda.
    """
    bins = int(bins or 0)
    lote_n = _norm_lote(lote)
    if bins <= 0 or not lote_n:
        return

    from app.utils.tandas import asignar_numero_tanda_nueva

    candidatos = _match_desverdizado_por_lote(db, lote_n)
    # Preferir: empaquetado con número (tanda original) → empaquetado → con stock → resto
    def sort_key(r):
        est = (r.estado or "").lower()
        tiene_num = 0 if r.numero_tanda is not None else 1
        if est == "empaquetado":
            prio = 0
        elif est == "eliminado":
            prio = 3
        elif (r.cantidad_bins or 0) > 0:
            prio = 1
        else:
            prio = 2
        return (prio, tiene_num, -(r.id or 0))

    candidatos = sorted(candidatos, key=sort_key)
    des = candidatos[0] if candidatos else None

    if des:
        des.lote = _norm_lote(des.lote) or lote_n
        des.cantidad_bins = int(des.cantidad_bins or 0) + bins
        if (des.estado or "").lower() in ("empaquetado", "eliminado", ""):
            des.estado = "listo_empaque"
        elif (des.estado or "").lower() not in ("en_desverdizado", "listo_empaque"):
            des.estado = "listo_empaque"
        # Conservar numero_tanda original; solo si NUNCA tuvo, asignar uno
        # (caso raro: fila huérfana sin número)
        if des.numero_tanda is None:
            asignar_numero_tanda_nueva(db, des)
        db.flush()
        return

    from datetime import date, timedelta
    from app.core.constants import DIAS_DESVERDIZADO

    hoy = date.today()
    nuevo = InventarioDesverdizado(
        producto=Producto.LIMON_AMARILLO,
        cantidad_bins=bins,
        lote=lote_n,
        fecha_recepcion=hoy,
        fecha_tentativa_salida=hoy + timedelta(days=DIAS_DESVERDIZADO),
        estado="listo_empaque",
    )
    db.add(nuevo)
    db.flush()
    # Solo filas realmente nuevas (sin historial de tanda) reciben número
    asignar_numero_tanda_nueva(db, nuevo)


def _talla_for_pres(pres: str | None, talla) -> str | None:
    """bins_jugo no usa talla. rpc_granel y finales sí (inventario por tamaño)."""
    if not pres or pres == "bins_jugo":
        return None
    if talla is None:
        return None
    s = str(talla).strip()
    if not s or s.lower() in ("none", "null"):
        return None
    if s.startswith("#"):
        s = s[1:].strip()
    return s or None


def _calidad_pres(pres: str | None) -> str:
    if pres == "bins_jugo":
        return "segunda"
    if pres == "rpc_granel":
        return "primera"  # 1ra en proceso (pre-embolse)
    return "primera"


def _extra_dict(inv: InventarioFinal) -> dict:
    extra = inv.atributos_extra
    return extra if isinstance(extra, dict) else {}


def _find_inv_final_limon(
    db: Session,
    pres: str,
    talla_val: str | None,
    mercado=None,
) -> InventarioFinal | None:
    """Match robusto por presentación + talla (normaliza int/str). Prefiere mercado."""
    pres = (pres or "").strip()
    rows: list[InventarioFinal] = []
    for i in db.query(InventarioFinal).all():
        extra = _extra_dict(i)
        if (extra.get("presentacion") or "").strip() != pres:
            continue
        if _talla_for_pres(pres, extra.get("talla")) != talla_val:
            continue
        rows.append(i)
    if not rows:
        return None
    if mercado is not None:
        mval = str(getattr(mercado, "value", mercado))
        for r in rows:
            if str(getattr(r.mercado, "value", r.mercado)) == mval:
                return r
    # preferir con stock > 0
    for r in rows:
        if (r.cantidad_stock or 0) > 0:
            return r
    return rows[0]


def _ajustar_inventario_final(db: Session, producto: Producto, mercado, produccion: list, signo: int) -> None:
    """suma (signo=+1) o resta (signo=-1) producción en inventario final."""
    for linea in produccion or []:
        pres = (linea.get("presentacion") or "").strip()
        cant = int(linea.get("cantidad") or 0)
        talla_val = _talla_for_pres(pres, linea.get("talla"))
        if not pres or cant <= 0:
            continue
        delta = cant * signo
        inv_final = _find_inv_final_limon(db, pres, talla_val, mercado=mercado)
        if inv_final:
            nuevo = (inv_final.cantidad_stock or 0) + delta
            if nuevo < 0:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Stock insuficiente de {pres}"
                        + (f" talla {talla_val}" if talla_val else "")
                        + f" (hay {inv_final.cantidad_stock}, delta {delta})"
                    ),
                )
            inv_final.cantidad_stock = nuevo
            inv_final.fecha_actualizacion = datetime.utcnow()
        elif signo > 0:
            calidad = _calidad_pres(pres)
            extra = {"presentacion": pres, "calidad": calidad}
            if talla_val:
                extra["talla"] = talla_val
            db.add(
                InventarioFinal(
                    producto=producto if producto else Producto.LIMON_AMARILLO,
                    variedad=None,
                    tipo_cultivo=None,
                    mercado=mercado,
                    cantidad_stock=delta,
                    atributos_extra=extra,
                    fecha_actualizacion=datetime.utcnow(),
                )
            )
        else:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"No existe inventario final de {pres}"
                    + (f" talla {talla_val}" if talla_val else "")
                    + " para restar"
                ),
            )


def _netear_produccion(old_prod: list, new_prod: list) -> list[dict]:
    """
    Calcula deltas netos por (presentacion, talla) para aplicar un solo ajuste
    (evita fallar por stock intermedio al restar todo y sumar de nuevo).
    Returns list of {presentacion, talla, cantidad, signo} with cantidad > 0.
    """
    from collections import defaultdict

    acc: dict[tuple[str, str | None], int] = defaultdict(int)
    for p in old_prod or []:
        pres = (p.get("presentacion") or "").strip()
        if not pres:
            continue
        talla = _talla_for_pres(pres, p.get("talla"))
        acc[(pres, talla)] -= int(p.get("cantidad") or 0)
    for p in new_prod or []:
        pres = (p.get("presentacion") or "").strip()
        if not pres:
            continue
        talla = _talla_for_pres(pres, p.get("talla"))
        acc[(pres, talla)] += int(p.get("cantidad") or 0)

    out: list[dict] = []
    for (pres, talla), delta in acc.items():
        if delta == 0:
            continue
        out.append(
            {
                "presentacion": pres,
                "talla": talla,
                "cantidad": abs(delta),
                "_signo": 1 if delta > 0 else -1,
            }
        )
    return out

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

        # NO renumerar tandas al empacar (solo al eliminar tandas en correcciones)
        
        # Producir a inventario final por presentación (cantidades separadas) + talla para 1ra
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
        _ajustar_inventario_final(
            db, empaque.producto, empaque.mercado, lineas, signo=+1
        )
    
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


def _parse_fecha_empaque(s: str | None):
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise HTTPException(status_code=400, detail=f"Fecha inválida: {s}")


def _norm_consumos(raw: list | None) -> list[dict]:
    out = []
    for c in raw or []:
        lote = str(c.get("lote") or "").strip()
        bins = int(c.get("bins") or 0)
        if not lote or bins <= 0:
            continue
        out.append({"lote": lote, "bins": bins})
    return out


def _norm_produccion(raw: list | None) -> list[dict]:
    out = []
    for p in raw or []:
        pres = str(p.get("presentacion") or "").strip()
        cant = int(p.get("cantidad") or 0)
        if not pres or cant <= 0:
            continue
        talla = _talla_for_pres(pres, p.get("talla"))
        out.append({"presentacion": pres, "talla": talla, "cantidad": cant})
    return out


@router.put("/{empaque_id}/editar", response_model=EmpaqueResponse)
def editar_empaque_completo(
    empaque_id: int,
    body: EmpaqueEditRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Edición completa de empaque limón:
    - Reemplaza consumos (lotes/bins): devuelve los viejos y descuenta los nuevos.
    - Reemplaza producción: resta del inventario final lo anterior y suma lo nuevo.
    - Opcional: fecha, empacador, mercado.
    """
    emp = db.query(Empaque).filter(Empaque.id == empaque_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Empaque no encontrado")
    if emp.producto != Producto.LIMON_AMARILLO:
        raise HTTPException(status_code=400, detail="Edición completa solo para limón por ahora")

    detalle = emp.detalle_corrida if isinstance(emp.detalle_corrida, dict) else {}
    if detalle.get("anulado"):
        raise HTTPException(status_code=400, detail="El empaque está anulado; no se puede editar")

    old_consumos = _norm_consumos(detalle.get("consumos"))
    if not old_consumos and emp.bins_desverdizado_usados:
        old_consumos = [{
            "lote": emp.lote_desverdizado or "SIN_LOTE",
            "bins": int(emp.bins_desverdizado_usados),
        }]
    old_produccion = _norm_produccion(detalle.get("produccion"))
    if not old_produccion and emp.presentacion and emp.cantidad_producida:
        old_produccion = [{
            "presentacion": emp.presentacion,
            "talla": emp.talla,
            "cantidad": emp.cantidad_producida,
        }]

    new_consumos = (
        _norm_consumos(body.consumos)
        if body.consumos is not None
        else old_consumos
    )
    new_produccion = (
        _norm_produccion(body.produccion)
        if body.produccion is not None
        else old_produccion
    )

    if body.consumos is not None and not new_consumos:
        raise HTTPException(status_code=400, detail="Debe haber al menos un consumo (lote + bins > 0)")
    if body.produccion is not None and not new_produccion:
        raise HTTPException(status_code=400, detail="Debe haber al menos una línea de producción")

    # 1) Devolver consumos viejos al desverdizado
    for c in old_consumos:
        _devolver_bins_lote(db, c["lote"], c["bins"])

    # 2) Consumir nuevos lotes
    for c in new_consumos:
        _consumir_bins_lote(db, c["lote"], c["bins"])

    # 3) Ajuste NETO de producción (no restar todo y sumar: evita fallos de stock intermedio)
    mercado_dest = body.mercado if body.mercado is not None else emp.mercado
    for net in _netear_produccion(old_produccion, new_produccion):
        _ajustar_inventario_final(
            db,
            emp.producto,
            mercado_dest,
            [{"presentacion": net["presentacion"], "talla": net["talla"], "cantidad": net["cantidad"]}],
            signo=int(net["_signo"]),
        )

    bins_total = sum(c["bins"] for c in new_consumos)
    lotes = ", ".join(f"{c['lote']}:{c['bins']}" for c in new_consumos)
    detalle = {
        **detalle,
        "consumos": new_consumos,
        "produccion": new_produccion,
        "bins_campo": bins_total,
        "lotes_resumen": lotes,
        "editado_por": getattr(current_user, "username", None),
    }
    emp.detalle_corrida = detalle
    emp.bins_desverdizado_usados = bins_total
    emp.lote_desverdizado = new_consumos[0]["lote"] if new_consumos else emp.lote_desverdizado

    if body.numero_empacador is not None:
        emp.numero_empacador = body.numero_empacador.strip() or emp.numero_empacador
    if body.mercado is not None:
        emp.mercado = body.mercado
    if body.fecha is not None:
        f = _parse_fecha_empaque(body.fecha)
        if f:
            emp.fecha = f

    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(emp, "detalle_corrida")
    # No renumerar tandas al editar empaque
    db.commit()
    db.refresh(emp)
    return emp


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
    # No renumerar tandas al corregir consumos
    db.commit()
    db.refresh(emp)
    return emp


def _detalle_as_dict(raw) -> dict:
    """detalle_corrida puede venir como dict o JSON string."""
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        import json

        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _consumos_desde_empaque(emp: Empaque, detalle: dict) -> list[dict]:
    """
    Obtiene consumos de bins de campo a devolver.
    Prioridad: detalle.consumos → bins_campo/lotes_resumen → columnas del empaque.
    """
    consumos = _norm_consumos(detalle.get("consumos"))
    if consumos:
        return consumos

    # bins_campo en detalle
    bins_campo = int(detalle.get("bins_campo") or 0)
    lotes_resumen = (detalle.get("lotes_resumen") or "").strip()
    if bins_campo > 0 and lotes_resumen and ":" in lotes_resumen:
        # formato "lote1:10, lote2:5"
        parsed = []
        for part in lotes_resumen.split(","):
            part = part.strip()
            if ":" not in part:
                continue
            lo, bi = part.rsplit(":", 1)
            try:
                b = int(bi.strip())
            except ValueError:
                continue
            lo = lo.strip()
            if lo and b > 0:
                parsed.append({"lote": lo, "bins": b})
        if parsed:
            return parsed

    if emp.bins_desverdizado_usados and int(emp.bins_desverdizado_usados) > 0:
        return [
            {
                "lote": _norm_lote(emp.lote_desverdizado) or "SIN_LOTE",
                "bins": int(emp.bins_desverdizado_usados),
            }
        ]

    if bins_campo > 0:
        return [
            {
                "lote": _norm_lote(emp.lote_desverdizado) or "SIN_LOTE",
                "bins": bins_campo,
            }
        ]
    return []


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

    detalle = _detalle_as_dict(emp.detalle_corrida)
    if detalle.get("anulado"):
        raise HTTPException(status_code=400, detail="Este empaque ya está anulado")

    consumos = _consumos_desde_empaque(emp, detalle)
    produccion = _norm_produccion(detalle.get("produccion"))
    if not produccion and emp.presentacion and emp.cantidad_producida:
        produccion = [{
            "presentacion": emp.presentacion,
            "talla": emp.talla,
            "cantidad": emp.cantidad_producida,
        }]

    # 1) PRIMERO devolver bins a desverdizado (campo)
    bins_devueltos = 0
    for c in consumos:
        b = int(c.get("bins") or 0)
        lo = _norm_lote(c.get("lote"))
        if b > 0 and lo:
            _devolver_bins_lote(db, lo, b)
            bins_devueltos += b

    # 2) Restar producción del inventario final
    if produccion:
        try:
            _ajustar_inventario_final(db, emp.producto, emp.mercado, produccion, signo=-1)
        except HTTPException as e:
            # Si no hay stock final (ya se embarcó), igual devolvemos bins de campo
            # y marcamos anulado con nota; no dejamos el empaque a medias en desverdizado.
            if e.status_code == 400:
                detalle["aviso_anulacion"] = str(e.detail)
            else:
                raise

    # 3) Conversión granel→final: devolver el granel consumido
    if detalle.get("tipo") == "conversion_rpc_granel":
        consumos_g = detalle.get("consumos_granel") or []
        if consumos_g:
            try:
                _ajustar_inventario_final(
                    db, emp.producto, emp.mercado, consumos_g, signo=+1
                )
            except HTTPException:
                pass

    detalle = {
        **detalle,
        "consumos": consumos,
        "produccion": produccion,
        "bins_campo": bins_devueltos or detalle.get("bins_campo") or emp.bins_desverdizado_usados,
        "anulado": True,
        "anulado_por": getattr(current_user, "username", None),
        "bins_devueltos": bins_devueltos,
    }
    emp.detalle_corrida = detalle
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(emp, "detalle_corrida")
    db.commit()

    msg = f"Empaque anulado; {bins_devueltos} bins devueltos a desverdizado"
    if detalle.get("aviso_anulacion"):
        msg += f" (aviso inventario final: {detalle['aviso_anulacion']})"
    if bins_devueltos <= 0 and detalle.get("tipo") != "conversion_rpc_granel":
        msg += " — no se encontraron consumos de bins en el registro"
    return AnularEmpaqueResponse(message=msg, id=empaque_id)


@router.delete("/{empaque_id}", response_model=EliminarEmpaqueResponse)
def eliminar_empaque_anulado(
    empaque_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Borra permanentemente un empaque ya anulado (limpia historial).
    No toca inventarios: al anular ya se revirtieron.
    """
    emp = db.query(Empaque).filter(Empaque.id == empaque_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Empaque no encontrado")

    detalle = emp.detalle_corrida if isinstance(emp.detalle_corrida, dict) else {}
    if not detalle.get("anulado"):
        raise HTTPException(
            status_code=400,
            detail=(
                "Solo se pueden borrar empaques ANULADOS. "
                "Primero anula el empaque (revierte inventario) y luego bórralo."
            ),
        )

    db.delete(emp)
    db.commit()
    return EliminarEmpaqueResponse(
        message=f"Empaque #{empaque_id} borrado del historial",
        id=empaque_id,
    )


def _norm_consumos_granel(raw: list | None) -> list[dict]:
    """[{"talla": "165", "cantidad": 10}] → líneas presentacion rpc_granel."""
    out = []
    for c in raw or []:
        cant = int(c.get("cantidad") or 0)
        if cant <= 0:
            continue
        talla = c.get("talla")
        talla_val = str(talla).strip() if talla is not None and str(talla).strip() != "" else None
        out.append(
            {
                "presentacion": "rpc_granel",
                "talla": talla_val,
                "cantidad": cant,
            }
        )
    return out


@router.post("/convertir-granel", response_model=ConvertirGranelResponse)
def convertir_rpc_granel(
    body: ConvertirGranelRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN, Rol.RECEPCION_EMPACADOR, Rol.EMPACADOR])),
):
    """
    Consume RPC a granel (22 kg, por talla) del inventario y produce RPC 12/18 o cartón.
    No consume bins de campo: el granel ya se generó en un empaque previo.
    """
    consumos_g = _norm_consumos_granel(body.consumos_granel)
    if not consumos_g and body.cantidad_rpc_granel > 0:
        # Legacy: total sin talla
        consumos_g = [
            {
                "presentacion": "rpc_granel",
                "talla": None,
                "cantidad": int(body.cantidad_rpc_granel),
            }
        ]
    if not consumos_g:
        raise HTTPException(
            status_code=400,
            detail="Indica consumos de RPC a granel por talla (o cantidad_rpc_granel)",
        )

    produccion = _norm_produccion(body.produccion)
    if not produccion:
        raise HTTPException(status_code=400, detail="Indica producción final (RPC o cartón)")
    for p in produccion:
        if p["presentacion"] in ("rpc_granel", "bins_jugo"):
            raise HTTPException(
                status_code=400,
                detail="La conversión debe producir RPC 12/18 o cartón (no granel ni jugo)",
            )

    total_granel = sum(int(c["cantidad"]) for c in consumos_g)

    # 1) Descontar RPC a granel por talla
    _ajustar_inventario_final(
        db,
        Producto.LIMON_AMARILLO,
        body.mercado,
        consumos_g,
        signo=-1,
    )
    # 2) Sumar producción final
    _ajustar_inventario_final(db, Producto.LIMON_AMARILLO, body.mercado, produccion, signo=+1)

    # 3) Auditoría: registro de empaque sin consumos de campo
    lotes_resumen = ", ".join(
        f"granel#{c['talla'] or 's/t'}:{c['cantidad']}" for c in consumos_g
    )
    detalle = {
        "tipo": "conversion_rpc_granel",
        "consumos": [],
        "consumos_granel": consumos_g,
        "produccion": produccion,
        "bins_campo": 0,
        "lotes_resumen": lotes_resumen,
        "notas": body.notas,
    }
    nuevo = Empaque(
        producto=Producto.LIMON_AMARILLO,
        variedad=None,
        tipo_cultivo=None,
        mercado=body.mercado,
        cantidad_cajas_campo_usadas=0,
        cantidad_cajas_carton_producidas=0,
        porcentaje_merma=0.0,
        numero_empacador=body.numero_empacador or "EMP-01",
        bins_desverdizado_usados=0,
        lote_desverdizado=None,
        detalle_corrida=detalle,
        usuario_id=getattr(current_user, "id", None),
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    return ConvertirGranelResponse(
        message=(
            f"Convertidos {total_granel} RPC a granel → "
            f"{sum(p['cantidad'] for p in produccion)} unidades finales"
        ),
        empaque_id=nuevo.id,
        rpc_granel_consumido=total_granel,
        consumos_granel=consumos_g,
        produccion=produccion,
    )

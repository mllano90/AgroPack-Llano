from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import require_roles
from app.models.enums import Rol
from app.schemas.recepcion import RecepcionCampoCreate, RecepcionCampoResponse
from app.models.inventory import RecepcionCampo, InventarioCampo, InventarioFinal, InventarioDesverdizado, Empaque
from app.models.enums import Producto
from app.core.constants import DIAS_DESVERDIZADO

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
    
    es_limon = recepcion.producto == Producto.LIMON_AMARILLO
    es_melon = recepcion.producto == Producto.MELON
    # Limón / melón: fecha de corte guía el registro; uva usa hoy
    fecha_registro = fecha_corte if (es_limon or es_melon) else date.today()

    nueva_recepcion = RecepcionCampo(
        producto=recepcion.producto,
        variedad=recepcion.variedad,
        cantidad_cajas_campo=recepcion.cantidad_cajas_campo,
        cantidad_cajas_carton=recepcion.cantidad_cajas_carton,
        tipo_cultivo_carton=recepcion.tipo_cultivo_carton,
        mercado=recepcion.mercado,
        # Limón / melón: persistir lote y bins
        lote=recepcion.lote,
        cantidad_bins=recepcion.cantidad_bins or 0,
        fecha_corte=fecha_corte if (es_limon or es_melon) else None,
        fecha=fecha_registro,
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
    if es_limon:
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

    # ======================================================
    # LÓGICA PARA MELÓN (bins por área/sección/variedad; listos para empaque)
    # ======================================================
    if es_melon:
        lote_m = (recepcion.lote or "").strip()
        if recepcion.cantidad_bins <= 0 or not lote_m:
            raise HTTPException(
                status_code=400,
                detail="Para Melón se requiere cantidad_bins > 0 y lote (área + sección + variedad)",
            )
        nueva_recepcion.lote = lote_m
        # Stock por sección: mismo inventario_desverdizado, producto=melon,
        # estado listo_empaque (sin cámara / sin días de espera).
        inv_melon = InventarioDesverdizado(
            producto=Producto.MELON,
            cantidad_bins=recepcion.cantidad_bins,
            lote=lote_m,
            fecha_recepcion=fecha_corte,
            fecha_tentativa_salida=fecha_corte,
            estado="listo_empaque",
            recepcion_id=nueva_recepcion.id,
            usuario_id=current_user.id if hasattr(current_user, "id") else None,
        )
        db.add(inv_melon)

    db.commit()
    db.refresh(nueva_recepcion)
    return nueva_recepcion


def _producto_val(p) -> str:
    return str(getattr(p, "value", p) or "").lower()


@router.get("/", response_model=list[RecepcionCampoResponse])
def listar_recepciones(db: Session = Depends(get_db)):
    return db.query(RecepcionCampo).all()

@router.get("/desverdizado", response_model=list[dict])
def listar_desverdizado(db: Session = Depends(get_db)):
    """Lista inventario limón en desverdizado. Orden: fecha de corte ASC, luego id."""
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
    # Solo limón (melón tiene endpoint propio /bins-melon)
    items = [
        d
        for d in items
        if (d.estado or "") != "eliminado"
        and (d.cantidad_bins or 0) > 0
        and _producto_val(d.producto) in ("limon_amarillo", "limón_amarillo", "")
    ]
    return [
        {
            "id": d.id,
            "lote": d.lote,
            "cantidad_bins_disponibles": d.cantidad_bins,
            "fecha_recepcion": str(d.fecha_recepcion),
            "fecha_tentativa_salida": str(d.fecha_tentativa_salida),
            "estado": d.estado,
            "producto": _producto_val(d.producto) or "limon_amarillo",
        }
        for d in items
    ]


def _melon_bins_consumidos_por_corte(db: Session) -> dict[tuple[str, str], int]:
    """
    Suma bins de melón ya usados en empaques activos, agrupados por (lote, fecha_corte).
    Evita que el backfill de /bins-melon resucite stock ya empacado.
    """
    from app.utils.limon_inv import parse_detalle_corrida

    acc: dict[tuple[str, str], int] = {}
    empaques = (
        db.query(Empaque)
        .filter(Empaque.producto == Producto.MELON)
        .order_by(Empaque.id.asc())
        .all()
    )
    for e in empaques:
        detalle = parse_detalle_corrida(e.detalle_corrida)
        if detalle.get("anulado"):
            continue
        consumos = detalle.get("consumos") or []
        if not consumos and int(e.bins_desverdizado_usados or 0) > 0:
            consumos = [
                {
                    "lote": e.lote_desverdizado,
                    "bins": int(e.bins_desverdizado_usados or 0),
                }
            ]
        for c in consumos:
            if not isinstance(c, dict):
                continue
            lote = (c.get("lote") or "").strip()
            try:
                bins = int(c.get("bins") or 0)
            except (TypeError, ValueError):
                bins = 0
            if not lote or bins <= 0:
                continue
            fr = c.get("fecha_recepcion")
            fr_s = str(fr).strip()[:10] if fr else ""
            if not fr_s:
                # Sin fecha: no atribuir a un corte concreto (FIFO legacy);
                # el backfill solo descuenta cortes con fecha explícita.
                continue
            key = (lote.casefold(), fr_s)
            acc[key] = acc.get(key, 0) + bins
    return acc


@router.get("/bins-melon", response_model=list[dict])
def listar_bins_melon(db: Session = Depends(get_db)):
    """
    Bins de melón disponibles por sección/lote (área + sección + variedad).
    Cada recepción queda como fila aparte (mismo lote en distintas fechas = filas distintas).
    También hace backfill de recepciones melón antiguas sin fila de inventario.

    Importante: el backfill NUNCA recrea bins ya consumidos en empaque. Si la fila de
    inventario se perdió tras empacar, se recrea solo el remanente (o un marcador en 0).
    """
    # Backfill: recepciones melon sin inventario ligado
    recs = (
        db.query(RecepcionCampo)
        .filter(RecepcionCampo.producto == Producto.MELON)
        .order_by(RecepcionCampo.id.asc())
        .all()
    )
    consumidos = _melon_bins_consumidos_por_corte(db)
    # Remanente de consumo por corte aún no atribuido a filas de inventario existentes
    # (permite varias recepciones el mismo día sin sobrescribirse).
    consumo_restante = dict(consumidos)
    created = False

    # Primero: restar de inventarios ya ligados lo que ya está reflejado en stock/empaquetado
    # (no hace falta; el consumo se aplica solo al crear filas huérfanas).

    for r in recs:
        bins = int(r.cantidad_bins or 0)
        lote = (r.lote or "").strip()
        if bins <= 0 or not lote:
            continue
        ya = (
            db.query(InventarioDesverdizado)
            .filter(InventarioDesverdizado.recepcion_id == r.id)
            .first()
        )
        if ya:
            continue
        fr = r.fecha_corte or r.fecha
        fr_s = str(fr)[:10] if fr else ""
        same_rows = (
            db.query(InventarioDesverdizado)
            .filter(
                InventarioDesverdizado.producto == Producto.MELON,
                InventarioDesverdizado.lote == lote,
                InventarioDesverdizado.fecha_recepcion == fr,
            )
            .order_by(InventarioDesverdizado.id.asc())
            .all()
        )
        if same_rows:
            # Ya hay tracking de este corte: solo enlazar FK si falta
            for row in same_rows:
                if not row.recepcion_id:
                    row.recepcion_id = r.id
                    created = True
                    break
            continue

        # No hay fila de inventario para este corte: recrear solo el remanente real.
        key = (lote.casefold(), fr_s)
        ya_consumido = int(consumo_restante.get(key, 0) or 0)
        usar_consumo = min(bins, ya_consumido)
        if key in consumo_restante:
            consumo_restante[key] = max(0, ya_consumido - usar_consumo)
        remaining = max(0, bins - usar_consumo)
        estado = "listo_empaque" if remaining > 0 else "empaquetado"
        db.add(
            InventarioDesverdizado(
                producto=Producto.MELON,
                cantidad_bins=remaining,
                lote=lote,
                fecha_recepcion=fr,
                fecha_tentativa_salida=fr,
                estado=estado,
                recepcion_id=r.id,
                usuario_id=r.usuario_id,
            )
        )
        created = True

    # Reconciliar cortes con stock > (recepción − ya empacado). Corrige filas
    # resucitadas por el backfill antiguo que ignoraba consumos de empaque.
    from collections import defaultdict

    rec_por_corte: dict[tuple[str, str], int] = defaultdict(int)
    for r in recs:
        lote = (r.lote or "").strip()
        bins = int(r.cantidad_bins or 0)
        fr = r.fecha_corte or r.fecha
        fr_s = str(fr)[:10] if fr else ""
        if lote and bins > 0 and fr_s:
            rec_por_corte[(lote.casefold(), fr_s)] += bins

    inv_melon = (
        db.query(InventarioDesverdizado)
        .filter(InventarioDesverdizado.producto == Producto.MELON)
        .order_by(
            InventarioDesverdizado.fecha_recepcion.asc(),
            InventarioDesverdizado.id.asc(),
        )
        .all()
    )
    inv_por_corte: dict[tuple[str, str], list] = defaultdict(list)
    for d in inv_melon:
        if (d.estado or "").lower() == "eliminado":
            continue
        lote = (d.lote or "").strip()
        fr_s = str(d.fecha_recepcion)[:10] if d.fecha_recepcion else ""
        if lote and fr_s:
            inv_por_corte[(lote.casefold(), fr_s)].append(d)

    for key, rows in inv_por_corte.items():
        should = max(0, int(rec_por_corte.get(key, 0)) - int(consumidos.get(key, 0)))
        have = sum(int(d.cantidad_bins or 0) for d in rows)
        if have <= should:
            continue
        excess = have - should
        # Reducir desde la fila más reciente (suele ser la resucitada)
        for d in sorted(rows, key=lambda x: int(x.id or 0), reverse=True):
            if excess <= 0:
                break
            hay = int(d.cantidad_bins or 0)
            if hay <= 0:
                continue
            quitar = min(hay, excess)
            d.cantidad_bins = hay - quitar
            excess -= quitar
            if d.cantidad_bins == 0:
                d.estado = "empaquetado"
            created = True

    if created:
        db.commit()

    items = (
        db.query(InventarioDesverdizado)
        .filter(
            InventarioDesverdizado.producto == Producto.MELON,
            InventarioDesverdizado.cantidad_bins > 0,
        )
        .order_by(
            InventarioDesverdizado.lote.asc(),
            InventarioDesverdizado.fecha_recepcion.asc(),
            InventarioDesverdizado.id.asc(),
        )
        .all()
    )
    items = [
        d
        for d in items
        if (d.estado or "").lower() not in ("eliminado", "empaquetado")
        and (d.cantidad_bins or 0) > 0
    ]
    return [
        {
            "id": d.id,
            "lote": d.lote,
            "cantidad_bins_disponibles": d.cantidad_bins,
            "fecha_recepcion": str(d.fecha_recepcion) if d.fecha_recepcion else None,
            "estado": d.estado,
            "producto": "melon",
            "recepcion_id": d.recepcion_id,
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
            "producto": _producto_val(d.producto) or "limon_amarillo",
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
    db.flush()
    for r in rows:
        db.delete(r)
    db.flush()
    db.commit()
    return len(ids), bins_total, ids


def _norm_lote_cmp(lote: str | None) -> str:
    return (lote or "").strip().casefold()


def _empaques_que_usan_lote(db: Session, lote: str) -> list[int]:
    """
    IDs de empaques de limón que referencian el lote (detalle_corrida.consumos
    o campo legacy lote_desverdizado). Ignora empaques ya anulados.
    Parsea detalle_corrida aunque venga como JSON string (legacy).
    """
    from app.utils.limon_inv import parse_detalle_corrida

    lote_n = _norm_lote_cmp(lote)
    if not lote_n:
        return []
    ids: list[int] = []
    empaques = (
        db.query(Empaque)
        .filter(Empaque.producto == Producto.LIMON_AMARILLO)
        .order_by(Empaque.id.desc())
        .limit(500)
        .all()
    )
    for e in empaques:
        detalle = parse_detalle_corrida(e.detalle_corrida)
        if detalle.get("anulado"):
            continue
        found = False
        for c in detalle.get("consumos") or []:
            if not isinstance(c, dict):
                continue
            if _norm_lote_cmp(c.get("lote")) == lote_n:
                ids.append(int(e.id))
                found = True
                break
        if found:
            continue
        # fallback legacy
        if _norm_lote_cmp(e.lote_desverdizado) == lote_n:
            if int(e.bins_desverdizado_usados or 0) > 0 or detalle.get("bins_campo"):
                ids.append(int(e.id))
    return ids


def _assert_lote_eliminable(db: Session, lote: str) -> None:
    """Bloquea borrar desverdizado si el lote ya se usó en empaque activo."""
    usados = _empaques_que_usan_lote(db, lote)
    if usados:
        muestra = ", ".join(f"#{i}" for i in usados[:8])
        extra = f" (+{len(usados) - 8} más)" if len(usados) > 8 else ""
        raise HTTPException(
            status_code=400,
            detail=(
                f"No se puede eliminar el lote '{(lote or '').strip()}': "
                f"ya fue usado en empaque(s) {muestra}{extra}. "
                f"Anula o corrige esos empaques primero."
            ),
        )


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
        des.estado = "empaquetado"
    elif int(des.cantidad_bins or 0) > 0 and (des.estado or "").lower() in (
        "empaquetado",
        "eliminado",
        "",
    ):
        # Con stock no debe quedarse como empaquetado/eliminado (P1-5)
        des.estado = "listo_empaque"

    db.commit()
    db.refresh(des)
    return {
        "message": f"Desverdizado #{des.id} actualizado",
        "id": des.id,
        "lote": des.lote,
        "cantidad_bins_disponibles": des.cantidad_bins,
        "fecha_recepcion": str(des.fecha_recepcion) if des.fecha_recepcion else None,
        "fecha_tentativa_salida": str(des.fecha_tentativa_salida) if des.fecha_tentativa_salida else None,
        "estado": des.estado,
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
    Bloqueado si el lote ya aparece en un empaque activo (no anulado).
    """
    des = db.query(InventarioDesverdizado).filter(InventarioDesverdizado.id == desverdizado_id).first()
    if not des:
        raise HTTPException(status_code=404, detail="Lote de desverdizado no encontrado")

    lote = (des.lote or "").strip()
    if lote:
        _assert_lote_eliminable(db, lote)

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
    """Elimina por nombre de lote (todas las filas con ese lote). Bloqueado si ya se usó en empaque."""
    lote_clean = (lote or "").strip()
    if not lote_clean:
        raise HTTPException(status_code=400, detail="Indica el nombre del lote")

    _assert_lote_eliminable(db, lote_clean)

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

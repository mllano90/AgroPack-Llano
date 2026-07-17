"""
Historial unificado de movimientos (admin) para depurar y corregir errores.
"""
from __future__ import annotations

from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.security import require_roles
from app.models.enums import Rol, Producto
from app.models.inventory import (
    RecepcionCampo,
    InventarioDesverdizado,
    Empaque,
    Embarque,
    EmbarqueDetalle,
    InventarioFinal,
    InventarioCampo,
)
from app.utils.tandas import reasignar_numeros_tanda

router = APIRouter(tags=["Correcciones"])


def _pval(x) -> str:
    if x is None:
        return ""
    return getattr(x, "value", None) or str(x)


def _match_inv_limon(db: Session, presentacion: str | None, talla: str | None):
    all_inv = db.query(InventarioFinal).filter(
        InventarioFinal.producto == Producto.LIMON_AMARILLO
    ).all()
    talla_norm = talla if presentacion != "bins_jugo" else None
    return next(
        (
            i
            for i in all_inv
            if (i.atributos_extra or {}).get("presentacion") == presentacion
            and (i.atributos_extra or {}).get("talla") == talla_norm
        ),
        None,
    )


@router.get("/historial")
def historial_movimientos(
    modulo: str | None = Query(
        None,
        description="recepcion | desverdizado | empaque | embarque | todos",
    ),
    limit: int = Query(150, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Lista movimientos de todos los módulos (más recientes primero).
    Cada ítem indica si se puede editar/eliminar desde Correcciones.
    """
    mod = (modulo or "todos").lower().strip()
    items: list[dict] = []

    if mod in ("todos", "recepcion"):
        for r in db.query(RecepcionCampo).order_by(RecepcionCampo.id.desc()).limit(limit).all():
            prod = _pval(r.producto)
            es_limon = prod == "limon_amarillo" or "limon" in prod.lower()

            # Desverdizado ligado por FK o por coincidencia lote+fecha (datos viejos)
            desvs = (
                db.query(InventarioDesverdizado)
                .filter(InventarioDesverdizado.recepcion_id == r.id)
                .all()
            )
            if not desvs and es_limon:
                lote_r = (getattr(r, "lote", None) or "").strip()
                fecha_ref = getattr(r, "fecha_corte", None) or r.fecha
                q = db.query(InventarioDesverdizado).filter(
                    InventarioDesverdizado.estado != "eliminado"
                )
                if lote_r:
                    q = q.filter(InventarioDesverdizado.lote == lote_r)
                if fecha_ref:
                    q = q.filter(InventarioDesverdizado.fecha_recepcion == fecha_ref)
                desvs = q.order_by(InventarioDesverdizado.id.desc()).limit(5).all()

            if es_limon:
                lote = getattr(r, "lote", None) or (
                    desvs[0].lote if desvs else None
                )
                bins_rec = getattr(r, "cantidad_bins", None) or 0
                if not bins_rec and desvs:
                    bins_rec = sum(int(d.cantidad_bins or 0) for d in desvs)
                fecha_corte = getattr(r, "fecha_corte", None) or r.fecha
                if desvs and not fecha_corte:
                    fecha_corte = desvs[0].fecha_recepcion
                bins_ahora = sum(int(d.cantidad_bins or 0) for d in desvs) if desvs else None
                tandas = ", ".join(
                    f"#{d.numero_tanda}" for d in desvs if d.numero_tanda
                ) or "—"
                desv_ids = ", ".join(str(d.id) for d in desvs) if desvs else "—"
                resumen = (
                    f"Limón · Lote {lote or '—'} · {bins_rec} bins recibidos · "
                    f"corte {fecha_corte}"
                )
                detalle = (
                    f"Fecha recepción/corte: {fecha_corte} · "
                    f"Bins en desverdizado ahora: {bins_ahora if bins_ahora is not None else '—'} · "
                    f"Desverdizado ID(s): {desv_ids} · Tanda(s): {tandas}"
                )
            else:
                resumen = (
                    f"Recepción uva · campo {r.cantidad_cajas_campo or 0} · "
                    f"cartón {r.cantidad_cajas_carton or 0}"
                )
                detalle = (
                    f"Fecha {r.fecha} · {_pval(r.variedad)} · {_pval(r.mercado)} · "
                    f"cultivo cartón {_pval(r.tipo_cultivo_carton) or '—'}"
                )
                lote = None
                bins_rec = None
                fecha_corte = r.fecha
                bins_ahora = None
                desv_ids = None

            items.append(
                {
                    "modulo": "recepcion",
                    "id": r.id,
                    "fecha": str(
                        getattr(r, "fecha_corte", None) or r.fecha
                    )
                    if (getattr(r, "fecha_corte", None) or r.fecha)
                    else None,
                    "hora": str(r.hora) if r.hora else None,
                    "titulo": f"Recepción #{r.id}"
                    + (f" · {lote}" if lote else ""),
                    "resumen": resumen,
                    "detalle": detalle,
                    "producto": prod,
                    "puede_editar": False,
                    "puede_eliminar": True,
                    "meta": {
                        "variedad": _pval(r.variedad) or None,
                        "mercado": _pval(r.mercado) or None,
                        "cantidad_cajas_campo": r.cantidad_cajas_campo,
                        "cantidad_cajas_carton": r.cantidad_cajas_carton,
                        "lote": lote,
                        "cantidad_bins": bins_rec,
                        "fecha_corte": str(fecha_corte) if fecha_corte else None,
                        "fecha_recepcion": str(r.fecha) if r.fecha else None,
                        "bins_desverdizado_actual": bins_ahora,
                        "desverdizado_ids": [d.id for d in desvs] if desvs else [],
                        "tandas": [d.numero_tanda for d in desvs if d.numero_tanda],
                    },
                }
            )

    if mod in ("todos", "desverdizado"):
        # Incluir con y sin stock (historial de tandas)
        q = db.query(InventarioDesverdizado).order_by(InventarioDesverdizado.id.desc()).limit(limit)
        for d in q.all():
            if (d.estado or "") == "eliminado":
                continue
            rec_txt = f"Recepción #{d.recepcion_id}" if d.recepcion_id else "Sin recepción ligada"
            items.append(
                {
                    "modulo": "desverdizado",
                    "id": d.id,
                    "fecha": str(d.fecha_recepcion) if d.fecha_recepcion else None,
                    "hora": None,
                    "titulo": f"Tanda #{d.numero_tanda or '—'} · {d.lote}",
                    "resumen": (
                        f"{d.cantidad_bins or 0} bins · estado {d.estado} · "
                        f"corte {d.fecha_recepcion}"
                    ),
                    "detalle": (
                        f"Fecha corte/recepción: {d.fecha_recepcion} · "
                        f"Bins: {d.cantidad_bins or 0} · "
                        f"Salida tent.: {d.fecha_tentativa_salida} · "
                        f"{rec_txt}"
                    ),
                    "producto": "limon_amarillo",
                    "puede_editar": True,
                    "puede_eliminar": (d.cantidad_bins or 0) > 0,
                    "meta": {
                        "lote": d.lote,
                        "cantidad_bins": d.cantidad_bins,
                        "numero_tanda": d.numero_tanda,
                        "estado": d.estado,
                        "fecha_recepcion": str(d.fecha_recepcion) if d.fecha_recepcion else None,
                        "fecha_corte": str(d.fecha_recepcion) if d.fecha_recepcion else None,
                        "fecha_tentativa_salida": (
                            str(d.fecha_tentativa_salida) if d.fecha_tentativa_salida else None
                        ),
                        "recepcion_id": d.recepcion_id,
                    },
                }
            )

    if mod in ("todos", "empaque"):
        for e in db.query(Empaque).order_by(Empaque.id.desc()).limit(limit).all():
            det = e.detalle_corrida if isinstance(e.detalle_corrida, dict) else {}
            anulado = bool(det.get("anulado"))
            prod = _pval(e.producto)
            if prod == "limon_amarillo" or "limon" in prod.lower():
                lotes = det.get("lotes_resumen") or e.lote_desverdizado or "—"
                bins = e.bins_desverdizado_usados or det.get("bins_campo") or 0
                resumen = f"Empaque limón · {bins} bins · {lotes}"
                prod_lines = det.get("produccion") or []
                detalle = (
                    f"{len(prod_lines)} líneas prod. · "
                    + ("ANULADO" if anulado else "OK")
                )
            else:
                resumen = (
                    f"Empaque uva · campo {e.cantidad_cajas_campo_usadas} → "
                    f"cartón {e.cantidad_cajas_carton_producidas}"
                )
                detalle = f"{_pval(e.variedad)} · {_pval(e.mercado)} · empacador {e.numero_empacador}"
            items.append(
                {
                    "modulo": "empaque",
                    "id": e.id,
                    "fecha": str(e.fecha) if e.fecha else None,
                    "hora": None,
                    "titulo": f"Empaque #{e.id}",
                    "resumen": resumen,
                    "detalle": detalle,
                    "producto": prod,
                    "puede_editar": not anulado and (
                        prod == "limon_amarillo" or "limon" in prod.lower()
                    ),
                    "puede_eliminar": not anulado and (
                        prod == "limon_amarillo" or "limon" in prod.lower()
                    ),
                    "meta": {
                        "anulado": anulado,
                        "bins_desverdizado_usados": e.bins_desverdizado_usados,
                        "lotes_resumen": det.get("lotes_resumen"),
                        "detalle_corrida": det if det else None,
                    },
                }
            )

    if mod in ("todos", "embarque"):
        for emb in (
            db.query(Embarque)
            .options(joinedload(Embarque.detalles), joinedload(Embarque.cliente))
            .order_by(Embarque.id.desc())
            .limit(limit)
            .all()
        ):
            cli = getattr(emb.cliente, "nombre", None) or f"cliente #{emb.cliente_id}"
            dets = emb.detalles or []
            total = sum(int(d.cantidad_cajas or 0) for d in dets)
            lineas = []
            for d in dets[:6]:
                if d.presentacion:
                    lineas.append(
                        f"{d.presentacion}"
                        + (f" T{d.talla}" if d.talla else "")
                        + f"×{d.cantidad_cajas}"
                    )
                else:
                    lineas.append(f"{_pval(d.variedad)}×{d.cantidad_cajas}")
            items.append(
                {
                    "modulo": "embarque",
                    "id": emb.id,
                    "fecha": str(emb.fecha_salida) if emb.fecha_salida else None,
                    "hora": str(emb.hora_salida) if emb.hora_salida else None,
                    "titulo": f"Embarque #{emb.id} → {cli}",
                    "resumen": f"{total} cajas/bins · {len(dets)} líneas · {emb.estado}",
                    "detalle": "; ".join(lineas) + (f" · {emb.notas}" if emb.notas else ""),
                    "producto": None,
                    "puede_editar": False,
                    "puede_eliminar": emb.estado != "anulado",
                    "meta": {
                        "cliente_id": emb.cliente_id,
                        "cliente": cli,
                        "estado": emb.estado,
                        "notas": emb.notas,
                        "detalles": [
                            {
                                "producto": _pval(d.producto),
                                "cantidad_cajas": d.cantidad_cajas,
                                "presentacion": d.presentacion,
                                "talla": d.talla,
                                "mercado": _pval(d.mercado),
                                "variedad": _pval(d.variedad) or None,
                            }
                            for d in dets
                        ],
                    },
                }
            )

    # Orden unificado por fecha/id
    def sort_key(it: dict):
        f = it.get("fecha") or ""
        return (f, it.get("id") or 0)

    items.sort(key=sort_key, reverse=True)
    return {
        "total": len(items),
        "items": items[:limit],
    }


@router.delete("/recepcion/{recepcion_id}")
def eliminar_recepcion(
    recepcion_id: int,
    con_desverdizado: bool = True,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Elimina un registro de recepción.
    Uva: revierte inventario campo/cartón.
    Limón: si con_desverdizado=True, también elimina el/los desverdizado ligados
    (por recepcion_id o por lote+fecha de corte).
    """
    r = db.query(RecepcionCampo).filter(RecepcionCampo.id == recepcion_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recepción no encontrada")

    prod = r.producto
    pval = _pval(prod)
    desv_borrados = 0
    bins_borrados = 0

    if pval == "uva" or prod == Producto.UVA:
        if r.cantidad_cajas_campo and r.cantidad_cajas_campo > 0:
            inv = (
                db.query(InventarioCampo)
                .filter(
                    InventarioCampo.variedad == r.variedad,
                    InventarioCampo.mercado == r.mercado,
                )
                .first()
            )
            if inv:
                inv.cantidad_disponible = max(
                    0, (inv.cantidad_disponible or 0) - (r.cantidad_cajas_campo or 0)
                )
        if r.cantidad_cajas_carton and r.cantidad_cajas_carton > 0:
            invf = (
                db.query(InventarioFinal)
                .filter(
                    InventarioFinal.producto == Producto.UVA,
                    InventarioFinal.variedad == r.variedad,
                    InventarioFinal.tipo_cultivo == r.tipo_cultivo_carton,
                    InventarioFinal.mercado == r.mercado,
                )
                .first()
            )
            if invf:
                invf.cantidad_stock = max(
                    0, (invf.cantidad_stock or 0) - (r.cantidad_cajas_carton or 0)
                )
    else:
        # Limón: borrar desverdizado ligado
        if con_desverdizado:
            desvs = (
                db.query(InventarioDesverdizado)
                .filter(InventarioDesverdizado.recepcion_id == recepcion_id)
                .all()
            )
            if not desvs:
                lote_r = (getattr(r, "lote", None) or "").strip()
                fecha_ref = getattr(r, "fecha_corte", None) or r.fecha
                if lote_r and fecha_ref:
                    desvs = (
                        db.query(InventarioDesverdizado)
                        .filter(
                            InventarioDesverdizado.lote == lote_r,
                            InventarioDesverdizado.fecha_recepcion == fecha_ref,
                        )
                        .all()
                    )
            for d in desvs:
                bins_borrados += int(d.cantidad_bins or 0)
                db.delete(d)
                desv_borrados += 1
            if desv_borrados:
                reasignar_numeros_tanda(db)

    db.delete(r)
    db.commit()
    msg = f"Recepción #{recepcion_id} eliminada"
    if desv_borrados:
        msg += f" · {desv_borrados} desverdizado(s) ({bins_borrados} bins) también eliminados"
    return {
        "message": msg,
        "id": recepcion_id,
        "desverdizado_eliminados": desv_borrados,
        "bins_eliminados": bins_borrados,
    }


@router.delete("/embarque/{embarque_id}")
def eliminar_embarque(
    embarque_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Anula/elimina un embarque y devuelve las cantidades al inventario final.
    """
    emb = (
        db.query(Embarque)
        .options(joinedload(Embarque.detalles))
        .filter(Embarque.id == embarque_id)
        .first()
    )
    if not emb:
        raise HTTPException(status_code=404, detail="Embarque no encontrado")
    if emb.estado == "anulado":
        raise HTTPException(status_code=400, detail="El embarque ya está anulado")

    for d in emb.detalles or []:
        cant = int(d.cantidad_cajas or 0)
        if cant <= 0:
            continue
        prod = d.producto
        pval = _pval(prod)
        if pval == "limon_amarillo" or prod == Producto.LIMON_AMARILLO:
            inv = _match_inv_limon(db, d.presentacion, d.talla)
            if inv:
                inv.cantidad_stock = (inv.cantidad_stock or 0) + cant
            else:
                calidad = "segunda" if d.presentacion == "bins_jugo" else "primera"
                extra = {"presentacion": d.presentacion, "calidad": calidad}
                if d.talla and d.presentacion != "bins_jugo":
                    extra["talla"] = d.talla
                db.add(
                    InventarioFinal(
                        producto=Producto.LIMON_AMARILLO,
                        variedad=None,
                        tipo_cultivo=None,
                        mercado=d.mercado,
                        cantidad_stock=cant,
                        atributos_extra=extra,
                    )
                )
        else:
            inv = (
                db.query(InventarioFinal)
                .filter(
                    InventarioFinal.producto == prod,
                    InventarioFinal.variedad == d.variedad,
                    InventarioFinal.tipo_cultivo == d.tipo_cultivo,
                    InventarioFinal.mercado == d.mercado,
                )
                .first()
            )
            if inv:
                inv.cantidad_stock = (inv.cantidad_stock or 0) + cant
            else:
                db.add(
                    InventarioFinal(
                        producto=prod,
                        variedad=d.variedad,
                        tipo_cultivo=d.tipo_cultivo,
                        mercado=d.mercado,
                        cantidad_stock=cant,
                    )
                )

    # Borrar detalles y embarque
    for d in list(emb.detalles or []):
        db.delete(d)
    db.delete(emb)
    db.commit()
    return {
        "message": f"Embarque #{embarque_id} eliminado; inventario final restaurado",
        "id": embarque_id,
    }

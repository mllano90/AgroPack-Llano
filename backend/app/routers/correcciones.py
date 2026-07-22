"""
Historial unificado de movimientos (admin) para depurar y corregir errores.

Recepción limón = captura de lote/bins/fecha; el desverdizado es el inventario
generado por esa recepción (no es un módulo de captura aparte).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.security import require_roles
from app.core.constants import DIAS_DESVERDIZADO
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


router = APIRouter(tags=["Correcciones"])


def _pval(x) -> str:
    if x is None:
        return ""
    return getattr(x, "value", None) or str(x)


def _es_limon(prod) -> bool:
    p = _pval(prod).lower()
    return p == "limon_amarillo" or "limon" in p


def _fecha_corte_efectiva(r: RecepcionCampo, desvs: list | None = None) -> date | None:
    """Fecha de corte de negocio (prioridad: desverdizado → fecha_corte → fecha)."""
    if desvs:
        for d in desvs:
            if getattr(d, "fecha_recepcion", None):
                return d.fecha_recepcion
    fc = getattr(r, "fecha_corte", None) or r.fecha
    return fc


def _numeros_recepcion_cronologicos(db: Session) -> dict[int, int]:
    """
    Asigna número de recepción 1..N en orden cronológico de fecha de corte
    efectiva (desverdizado.fecha_recepcion → fecha_corte → fecha), luego id BD.
    El id interno de BD se mantiene para editar/borrar; este número es solo display.
    """
    # Carga todas; el orden final lo define ranked (no confiar en order por id).
    recs = db.query(RecepcionCampo).all()
    limon = [r for r in recs if _es_limon(r.producto)]
    if not limon:
        return {}

    # Prefetch desverdizados por recepción
    ids = [r.id for r in limon]
    desvs_all = (
        db.query(InventarioDesverdizado)
        .filter(InventarioDesverdizado.recepcion_id.in_(ids))
        .all()
    )
    by_rec: dict[int, list] = {}
    for d in desvs_all:
        if d.recepcion_id is None:
            continue
        by_rec.setdefault(int(d.recepcion_id), []).append(d)

    ranked = sorted(
        limon,
        key=lambda r: (
            _fecha_corte_efectiva(r, by_rec.get(r.id)) or date.min,
            r.id or 0,
        ),
    )
    return {r.id: i for i, r in enumerate(ranked, start=1)}


def _norm_talla_inv(presentacion: str | None, talla) -> str | None:
    from app.utils.limon_inv import norm_talla

    return norm_talla(presentacion, talla)


def _match_inv_limon(db: Session, presentacion: str | None, talla: str | None):
    """Coincide por presentación + talla (talla normalizada str)."""
    from app.utils.limon_inv import find_inv_final_limon

    return find_inv_final_limon(db, presentacion, talla, mercado=None)


def _fill_recepcion_from_desv(r: RecepcionCampo, d: InventarioDesverdizado) -> None:
    """Copia lote/bins/fecha del desverdizado a la recepción si faltan (datos viejos)."""
    if d.lote and not (getattr(r, "lote", None) or "").strip():
        r.lote = d.lote
    # Solo rellenar bins en recepción si está vacío (no pisar el original tras empaque)
    if not getattr(r, "cantidad_bins", None):
        r.cantidad_bins = int(d.cantidad_bins or 0)
    if d.fecha_recepcion and not getattr(r, "fecha_corte", None):
        r.fecha_corte = d.fecha_recepcion
        r.fecha = d.fecha_recepcion


def sincronizar_recepcion_desverdizado(db: Session) -> dict:
    """
    Enlaza y rellena recepciones limón con su inventario de desverdizado.
    - Si hay recepcion_id, sincroniza campos de la recepción.
    - Si no, empareja por orden (id) y/o misma fecha de corte.
    """
    desvs = (
        db.query(InventarioDesverdizado)
        .filter(InventarioDesverdizado.estado != "eliminado")
        .order_by(InventarioDesverdizado.id.asc())
        .all()
    )
    recs = [
        r
        for r in db.query(RecepcionCampo).order_by(RecepcionCampo.id.asc()).all()
        if _es_limon(r.producto)
    ]

    linked_desv_ids: set[int] = set()

    # 1) Ya ligados por FK
    for d in desvs:
        if d.recepcion_id:
            r = next((x for x in recs if x.id == d.recepcion_id), None)
            if r:
                _fill_recepcion_from_desv(r, d)
                linked_desv_ids.add(d.id)

    # 2) Recepciones con desv sin FK pero misma fecha + lote (si hay lote)
    unpaired_desv = [d for d in desvs if d.id not in linked_desv_ids]
    for r in recs:
        already = any(d.recepcion_id == r.id for d in desvs)
        if already:
            continue
        lote_r = (getattr(r, "lote", None) or "").strip()
        fecha_r = getattr(r, "fecha_corte", None) or r.fecha
        match = None
        if lote_r and fecha_r:
            match = next(
                (
                    d
                    for d in unpaired_desv
                    if (d.lote or "").strip() == lote_r and d.fecha_recepcion == fecha_r
                ),
                None,
            )
        if not match and fecha_r:
            match = next(
                (d for d in unpaired_desv if d.fecha_recepcion == fecha_r),
                None,
            )
        if match:
            match.recepcion_id = r.id
            _fill_recepcion_from_desv(r, match)
            linked_desv_ids.add(match.id)
            unpaired_desv = [d for d in unpaired_desv if d.id != match.id]

    # 3) Emparejar resto 1:1 por orden de id (captura cronológica)
    unpaired_rec = [
        r
        for r in recs
        if not any(d.recepcion_id == r.id for d in desvs)
    ]
    unpaired_desv = [d for d in desvs if d.id not in linked_desv_ids]
    for r, d in zip(unpaired_rec, unpaired_desv):
        d.recepcion_id = r.id
        _fill_recepcion_from_desv(r, d)
        linked_desv_ids.add(d.id)

    # 4) Desverdizado huérfano (sin recepción): crear recepción espejo para poder editarlo
    huerfanos = [d for d in desvs if d.id not in linked_desv_ids and not d.recepcion_id]
    creadas = 0
    for d in huerfanos:
        r = RecepcionCampo(
            producto=Producto.LIMON_AMARILLO,
            variedad=None,
            cantidad_cajas_campo=0,
            cantidad_cajas_carton=0,
            mercado=None,
            lote=d.lote,
            cantidad_bins=int(d.cantidad_bins or 0),
            fecha_corte=d.fecha_recepcion,
            fecha=d.fecha_recepcion or date.today(),
        )
        db.add(r)
        db.flush()
        d.recepcion_id = r.id
        creadas += 1

    db.commit()
    return {
        "desverdizados": len(desvs),
        "recepciones_limon": len(recs),
        "huerfanos_convertidos": creadas,
    }


class RecepcionLimonUpdate(BaseModel):
    """Editar captura de recepción limón (y sincroniza inventario desverdizado)."""
    lote: str | None = None
    cantidad_bins: int | None = Field(default=None, ge=0)
    fecha_corte: str | None = None  # YYYY-MM-DD
    recalcular_tentativa: bool = True


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


@router.post("/sincronizar-recepcion-desverdizado")
def api_sincronizar(
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """Fuerza enlace y relleno de lote/bins/fecha en recepciones limón."""
    return sincronizar_recepcion_desverdizado(db)


@router.patch("/recepcion/{recepcion_id}")
def editar_recepcion_limon(
    recepcion_id: int,
    body: RecepcionLimonUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Edita lote, bins y fecha de una recepción de limón y actualiza
    el inventario de desverdizado ligado (es el mismo registro de negocio).
    """
    r = db.query(RecepcionCampo).filter(RecepcionCampo.id == recepcion_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recepción no encontrada")
    if not _es_limon(r.producto):
        raise HTTPException(status_code=400, detail="Solo se edita recepción de limón aquí")

    desvs = (
        db.query(InventarioDesverdizado)
        .filter(InventarioDesverdizado.recepcion_id == recepcion_id)
        .all()
    )
    if not desvs:
        # Crear desverdizado si no existe
        fr = getattr(r, "fecha_corte", None) or r.fecha or date.today()
        d = InventarioDesverdizado(
            producto=Producto.LIMON_AMARILLO,
            cantidad_bins=int(getattr(r, "cantidad_bins", None) or 0),
            lote=getattr(r, "lote", None) or "SIN_LOTE",
            fecha_recepcion=fr,
            fecha_tentativa_salida=fr + timedelta(days=DIAS_DESVERDIZADO),
            estado="en_desverdizado",
            recepcion_id=r.id,
        )
        db.add(d)
        db.flush()
        desvs = [d]

    if body.lote is not None:
        lote = body.lote.strip()
        if not lote:
            raise HTTPException(status_code=400, detail="Lote no puede quedar vacío")
        r.lote = lote
        for d in desvs:
            d.lote = lote

    if body.cantidad_bins is not None:
        r.cantidad_bins = int(body.cantidad_bins)
        # Si hay un solo desv ligado, es la captura; actualizar stock
        if len(desvs) == 1:
            desvs[0].cantidad_bins = int(body.cantidad_bins)
            if desvs[0].cantidad_bins == 0:
                desvs[0].estado = "empaquetado"
            elif desvs[0].estado in ("empaquetado", "eliminado"):
                desvs[0].estado = "en_desverdizado"
        else:
            # Varios: poner todo en el primero y cero en el resto (raro)
            desvs[0].cantidad_bins = int(body.cantidad_bins)
            for d in desvs[1:]:
                d.cantidad_bins = 0
                d.estado = "empaquetado"

    if body.fecha_corte is not None:
        fr = _parse_date_flex(body.fecha_corte)
        if fr:
            r.fecha_corte = fr
            r.fecha = fr
            for d in desvs:
                d.fecha_recepcion = fr
                if body.recalcular_tentativa:
                    d.fecha_tentativa_salida = fr + timedelta(days=DIAS_DESVERDIZADO)

    db.commit()
    db.refresh(r)
    desvs = (
        db.query(InventarioDesverdizado)
        .filter(InventarioDesverdizado.recepcion_id == r.id)
        .all()
    )
    nums = _numeros_recepcion_cronologicos(db)
    n_rec = nums.get(r.id) or r.id
    return {
        "message": f"Recepción #{n_rec} actualizada (desverdizado sincronizado)",
        "id": r.id,
        "numero_recepcion": n_rec,
        "lote": r.lote,
        "cantidad_bins": r.cantidad_bins,
        "fecha_corte": str(r.fecha_corte) if r.fecha_corte else None,
        "desverdizado_ids": [d.id for d in desvs],
        "bins_en_camara": sum(int(d.cantidad_bins or 0) for d in desvs),
    }


@router.get("/historial")
def historial_movimientos(
    modulo: str | None = Query(
        None,
        description="recepcion | empaque | embarque | todos",
    ),
    limit: int = Query(150, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Lista movimientos. Recepción limón muestra lote/bins/fecha (captura real);
    el desverdizado se sincroniza al cargar y no se lista como módulo aparte
    en 'todos' (evita confusión).
    """
    mod = (modulo or "todos").lower().strip()
    # Siempre reenlazar y rellenar datos limón
    try:
        sincronizar_recepcion_desverdizado(db)
    except Exception:
        db.rollback()

    items: list[dict] = []

    if mod in ("todos", "recepcion", "desverdizado"):
        # Número de recepción limón = orden cronológico por fecha de corte (no el id BD)
        nums_crono = _numeros_recepcion_cronologicos(db)
        # Cargar todas (el límite se aplica al final del historial unificado)
        for r in db.query(RecepcionCampo).order_by(RecepcionCampo.id.asc()).all():
            prod = _pval(r.producto)
            es_limon = _es_limon(r.producto)

            desvs = (
                db.query(InventarioDesverdizado)
                .filter(InventarioDesverdizado.recepcion_id == r.id)
                .all()
            )

            if es_limon:
                lote = getattr(r, "lote", None) or (desvs[0].lote if desvs else None)
                bins_rec = int(getattr(r, "cantidad_bins", None) or 0)
                if bins_rec <= 0 and desvs:
                    bins_rec = sum(int(d.cantidad_bins or 0) for d in desvs)
                fecha_corte = _fecha_corte_efectiva(r, desvs)
                bins_ahora = sum(int(d.cantidad_bins or 0) for d in desvs) if desvs else 0
                desv_ids = [d.id for d in desvs]
                n_rec = nums_crono.get(r.id) or r.id
                resumen = (
                    f"Lote {lote or '—'} · {bins_rec} bins · "
                    f"corte {fecha_corte} · en cámara {bins_ahora} bins"
                )
                detalle = (
                    f"Fecha corte: {fecha_corte} · "
                    f"Bins registrados: {bins_rec} · "
                    f"Bins en desverdizado ahora: {bins_ahora} · "
                    f"Inv.desv. ID: {', '.join(map(str, desv_ids)) if desv_ids else '—'} · "
                    f"ID interno: {r.id}"
                )
                items.append(
                    {
                        "modulo": "recepcion",
                        "id": r.id,
                        "fecha": str(fecha_corte) if fecha_corte else None,
                        "hora": str(r.hora) if r.hora else None,
                        "titulo": f"Recepción #{n_rec}"
                        + (f" · {lote}" if lote else ""),
                        "resumen": resumen,
                        "detalle": detalle,
                        "producto": prod,
                        "puede_editar": True,
                        "puede_eliminar": True,
                        "meta": {
                            "lote": lote,
                            "cantidad_bins": bins_rec,
                            "fecha_corte": str(fecha_corte) if fecha_corte else None,
                            "fecha_recepcion": str(fecha_corte) if fecha_corte else None,
                            "bins_desverdizado_actual": bins_ahora,
                            "desverdizado_ids": desv_ids,
                            "numero_recepcion": n_rec,
                            "id_interno": r.id,
                        },
                    }
                )
            elif mod != "desverdizado":
                resumen = (
                    f"Recepción uva · campo {r.cantidad_cajas_campo or 0} · "
                    f"cartón {r.cantidad_cajas_carton or 0}"
                )
                detalle = (
                    f"Fecha {r.fecha} · {_pval(r.variedad)} · {_pval(r.mercado)} · "
                    f"cultivo cartón {_pval(r.tipo_cultivo_carton) or '—'}"
                )
                items.append(
                    {
                        "modulo": "recepcion",
                        "id": r.id,
                        "fecha": str(r.fecha) if r.fecha else None,
                        "hora": str(r.hora) if r.hora else None,
                        "titulo": f"Recepción #{r.id}",
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
                    # OK limón → anular; anulado → borrar permanente del historial
                    "puede_eliminar": (
                        prod == "limon_amarillo" or "limon" in prod.lower() or anulado
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

    # Orden unificado: fecha desc; en recepción limón usa número cronológico como desempate
    def sort_key(it: dict):
        f = it.get("fecha") or ""
        meta = it.get("meta") or {}
        n = meta.get("numero_recepcion")
        if n is not None:
            return (f, int(n))
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

    nums = _numeros_recepcion_cronologicos(db)
    n_rec = nums.get(recepcion_id) or recepcion_id
    db.delete(r)
    db.commit()
    msg = f"Recepción #{n_rec} eliminada"
    if desv_borrados:
        msg += f" · {desv_borrados} desverdizado(s) ({bins_borrados} bins) también eliminados"
    return {
        "message": msg,
        "id": recepcion_id,
        "numero_recepcion": n_rec,
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


# ---------------------------------------------------------------------------
# Inventarios: corrección manual (admin) — listar / crear / editar / borrar
# ---------------------------------------------------------------------------

from app.models.enums import VariedadUva, TipoCultivo, TipoMercado


class InvFinalAdminItem(BaseModel):
    id: int
    producto: str
    variedad: str | None = None
    tipo_cultivo: str | None = None
    mercado: str
    cantidad_stock: int
    presentacion: str | None = None
    talla: str | None = None
    calidad: str | None = None
    fecha_actualizacion: str | None = None


class InvFinalCreate(BaseModel):
    producto: Producto = Producto.LIMON_AMARILLO
    mercado: TipoMercado = TipoMercado.NACIONAL
    cantidad_stock: int = 0
    variedad: VariedadUva | None = None
    tipo_cultivo: TipoCultivo | None = None
    presentacion: str | None = None  # limón
    talla: str | None = None
    calidad: str | None = None


class InvFinalUpdate(BaseModel):
    cantidad_stock: int | None = None
    mercado: TipoMercado | None = None
    variedad: VariedadUva | None = None
    tipo_cultivo: TipoCultivo | None = None
    presentacion: str | None = None
    talla: str | None = None
    calidad: str | None = None
    # si True y se envía talla/presentacion, actualiza atributos_extra
    reemplazar_atributos: bool = True


class InvCampoAdminItem(BaseModel):
    id: int
    variedad: str
    mercado: str
    cantidad_disponible: int
    fecha_actualizacion: str | None = None


class InvCampoCreate(BaseModel):
    variedad: VariedadUva
    mercado: TipoMercado = TipoMercado.NACIONAL
    cantidad_disponible: int = 0


class InvCampoUpdate(BaseModel):
    cantidad_disponible: int | None = None
    variedad: VariedadUva | None = None
    mercado: TipoMercado | None = None


def _inv_final_to_item(item: InventarioFinal) -> dict:
    extra = item.atributos_extra if isinstance(item.atributos_extra, dict) else {}
    talla = extra.get("talla")
    talla_s = None if talla is None or str(talla).strip() == "" else str(talla).strip()
    fa = item.fecha_actualizacion
    return {
        "id": item.id,
        "producto": _pval(item.producto) or "uva",
        "variedad": _pval(item.variedad) or None,
        "tipo_cultivo": _pval(item.tipo_cultivo) or None,
        "mercado": _pval(item.mercado) or "nacional",
        "cantidad_stock": int(item.cantidad_stock or 0),
        "presentacion": extra.get("presentacion"),
        "talla": talla_s,
        "calidad": extra.get("calidad"),
        "fecha_actualizacion": fa.isoformat() if fa else None,
    }


def _inv_campo_to_item(item: InventarioCampo) -> dict:
    fa = item.fecha_actualizacion
    return {
        "id": item.id,
        "variedad": _pval(item.variedad) or "",
        "mercado": _pval(item.mercado) or "nacional",
        "cantidad_disponible": int(item.cantidad_disponible or 0),
        "fecha_actualizacion": fa.isoformat() if fa else None,
    }


@router.get("/inventario/final", response_model=list[InvFinalAdminItem])
def listar_inventario_final_admin(
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    rows = db.query(InventarioFinal).order_by(InventarioFinal.id.desc()).all()
    return [_inv_final_to_item(r) for r in rows]


@router.post("/inventario/final", response_model=InvFinalAdminItem)
def crear_inventario_final_admin(
    body: InvFinalCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    if body.cantidad_stock < 0:
        raise HTTPException(status_code=400, detail="cantidad_stock no puede ser negativa")

    es_limon = body.producto == Producto.LIMON_AMARILLO or bool(body.presentacion)
    extra = None
    if es_limon:
        if not body.presentacion:
            raise HTTPException(
                status_code=400,
                detail="Limón requiere presentación (rpc_12, rpc_18, caja_40lbs, rpc_granel, bins_jugo)",
            )
        calidad = body.calidad or (
            "segunda" if body.presentacion == "bins_jugo" else "primera"
        )
        extra = {"presentacion": body.presentacion, "calidad": calidad}
        if body.presentacion != "bins_jugo" and body.talla:
            extra["talla"] = str(body.talla).strip()

    inv = InventarioFinal(
        producto=Producto.LIMON_AMARILLO if es_limon else body.producto,
        variedad=None if es_limon else body.variedad,
        tipo_cultivo=None if es_limon else body.tipo_cultivo,
        mercado=body.mercado,
        cantidad_stock=int(body.cantidad_stock),
        atributos_extra=extra,
        fecha_actualizacion=datetime.utcnow(),
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return _inv_final_to_item(inv)


@router.patch("/inventario/final/{inv_id}", response_model=InvFinalAdminItem)
def editar_inventario_final_admin(
    inv_id: int,
    body: InvFinalUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    inv = db.query(InventarioFinal).filter(InventarioFinal.id == inv_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Inventario final no encontrado")

    if body.cantidad_stock is not None:
        if body.cantidad_stock < 0:
            raise HTTPException(status_code=400, detail="cantidad_stock no puede ser negativa")
        inv.cantidad_stock = int(body.cantidad_stock)
    if body.mercado is not None:
        inv.mercado = body.mercado
    if body.variedad is not None:
        inv.variedad = body.variedad
    if body.tipo_cultivo is not None:
        inv.tipo_cultivo = body.tipo_cultivo

    extra = dict(inv.atributos_extra) if isinstance(inv.atributos_extra, dict) else {}
    if body.reemplazar_atributos:
        if body.presentacion is not None:
            if body.presentacion == "":
                extra.pop("presentacion", None)
            else:
                extra["presentacion"] = body.presentacion
        if body.talla is not None:
            if body.talla == "" or (
                body.presentacion == "bins_jugo"
                or extra.get("presentacion") == "bins_jugo"
            ):
                extra.pop("talla", None)
            else:
                extra["talla"] = str(body.talla).strip()
        if body.calidad is not None:
            if body.calidad == "":
                extra.pop("calidad", None)
            else:
                extra["calidad"] = body.calidad
        inv.atributos_extra = extra or None
        from sqlalchemy.orm.attributes import flag_modified

        flag_modified(inv, "atributos_extra")

    inv.fecha_actualizacion = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return _inv_final_to_item(inv)


@router.delete("/inventario/final/{inv_id}")
def eliminar_inventario_final_admin(
    inv_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    inv = db.query(InventarioFinal).filter(InventarioFinal.id == inv_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Inventario final no encontrado")
    snap = _inv_final_to_item(inv)
    db.delete(inv)
    db.commit()
    return {
        "message": f"Inventario final #{inv_id} eliminado",
        "id": inv_id,
        "eliminado": snap,
    }


@router.get("/inventario/campo", response_model=list[InvCampoAdminItem])
def listar_inventario_campo_admin(
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    rows = db.query(InventarioCampo).order_by(InventarioCampo.id.desc()).all()
    return [_inv_campo_to_item(r) for r in rows]


@router.post("/inventario/campo", response_model=InvCampoAdminItem)
def crear_inventario_campo_admin(
    body: InvCampoCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    if body.cantidad_disponible < 0:
        raise HTTPException(status_code=400, detail="cantidad no puede ser negativa")
    # Si ya existe misma variedad+mercado, sumar / setear
    existing = (
        db.query(InventarioCampo)
        .filter(
            InventarioCampo.variedad == body.variedad,
            InventarioCampo.mercado == body.mercado,
        )
        .first()
    )
    if existing:
        existing.cantidad_disponible = int(body.cantidad_disponible)
        existing.fecha_actualizacion = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return _inv_campo_to_item(existing)

    inv = InventarioCampo(
        variedad=body.variedad,
        mercado=body.mercado,
        cantidad_disponible=int(body.cantidad_disponible),
        fecha_actualizacion=datetime.utcnow(),
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return _inv_campo_to_item(inv)


@router.patch("/inventario/campo/{inv_id}", response_model=InvCampoAdminItem)
def editar_inventario_campo_admin(
    inv_id: int,
    body: InvCampoUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    inv = db.query(InventarioCampo).filter(InventarioCampo.id == inv_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Inventario de campo no encontrado")
    if body.cantidad_disponible is not None:
        if body.cantidad_disponible < 0:
            raise HTTPException(status_code=400, detail="cantidad no puede ser negativa")
        inv.cantidad_disponible = int(body.cantidad_disponible)
    if body.variedad is not None:
        inv.variedad = body.variedad
    if body.mercado is not None:
        inv.mercado = body.mercado
    inv.fecha_actualizacion = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return _inv_campo_to_item(inv)


@router.delete("/inventario/campo/{inv_id}")
def eliminar_inventario_campo_admin(
    inv_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    inv = db.query(InventarioCampo).filter(InventarioCampo.id == inv_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Inventario de campo no encontrado")
    db.delete(inv)
    db.commit()
    return {"message": f"Inventario campo #{inv_id} eliminado", "id": inv_id}


# ---------------------------------------------------------------------------
# Reset operacional (admin) — limpia inventarios y movimientos, conserva users
# ---------------------------------------------------------------------------

from app.models.inventory import Parrilla, Cliente  # noqa: E402


class ResetOperacionalRequest(BaseModel):
    """
    Borra datos operativos (recepciones, desverdizado, empaques, inventarios,
    embarques, parrillas). Conserva usuarios y clientes.

    confirm debe ser exactamente: RESET_OPERACIONAL
    """
    confirm: str = Field(..., description='Debe ser "RESET_OPERACIONAL"')


@router.post("/reset-operacional")
def reset_operacional(
    body: ResetOperacionalRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """
    Pone la operación en ceros para recarga limpia.
    Solo admin. Irreversible.
    """
    if (body.confirm or "").strip() != "RESET_OPERACIONAL":
        raise HTTPException(
            status_code=400,
            detail='Para confirmar envía {"confirm": "RESET_OPERACIONAL"}',
        )

    counts: dict[str, int] = {}

    def _del(model, name: str) -> None:
        n = db.query(model).delete(synchronize_session=False)
        counts[name] = int(n or 0)

    # Orden: hijos → padres
    _del(EmbarqueDetalle, "embarque_detalle")
    _del(Embarque, "embarque")
    _del(Empaque, "empaque")
    _del(InventarioFinal, "inventario_final")
    _del(InventarioCampo, "inventario_campo")
    _del(InventarioDesverdizado, "inventario_desverdizado")
    _del(RecepcionCampo, "recepcion_campo")
    _del(Parrilla, "parrilla")

    db.commit()

    # Postgres: reiniciar secuencias de IDs para que el próximo alta empiece en 1
    try:
        from sqlalchemy import text

        dialect = db.bind.dialect.name if db.bind is not None else ""
        if dialect == "postgresql":
            tables = [
                "embarque_detalle",
                "embarque",
                "empaque",
                "inventario_final",
                "inventario_campo",
                "inventario_desverdizado",
                "recepcion_campo",
                "parrilla",
            ]
            for t in tables:
                db.execute(text(f"ALTER SEQUENCE IF EXISTS {t}_id_seq RESTART WITH 1"))
            db.commit()
    except Exception:
        db.rollback()

    return {
        "message": (
            "Datos operativos borrados. Usuarios y clientes se conservaron. "
            "El sistema queda listo para recarga limpia."
        ),
        "eliminados": counts,
        "ejecutado_por": getattr(current_user, "username", None),
        "conservado": ["users", "clientes"],
    }

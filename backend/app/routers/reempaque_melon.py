"""
Reempaque de melón (admin / Correcciones).

Flujo:
1) Elegir fecha de origen (día del empaque original).
2) Seleccionar cajas (por proceso/talla/calidad) a reempacar.
3) Indicar fecha del reempaque y resultado en cajas recuperadas.
4) Se descuentan del proceso e inventario de origen; las recuperadas
   vuelven al mismo proceso/fecha de origen (trazabilidad).
5) El registro de auditoría (tipo=reempaque_melon) NO cuenta en KPIs
   del día del reproceso.
6) Eliminar el reempaque deshace exactamente eso: quita el resultado,
   devuelve las cajas originales al día de empaque y borra la auditoría.
   No mueve bins.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.database import get_db
from app.core.security import require_roles
from app.models.enums import Rol, Producto, TipoMercado
from app.models.inventory import Empaque
from app.routers.empaque import (
    _ajustar_inventario_final,
    _detalle_as_dict,
    _parse_fecha_empaque,
    _problemas_stock_cajas_melon,
    _sync_legacy_empaque_fields,
)

router = APIRouter(tags=["Reempaque Melón"])

TIPO_REEMPAQUE = "reempaque_melon"


def _line_key(pres: str, talla: str | None, calidad: str | None, lote: str | None) -> tuple:
    return (
        (pres or "").strip(),
        str(talla or "").strip(),
        (calidad or "").strip().lower() or "llano",
        (lote or "").strip(),
    )


def _empaques_melon_fecha(db: Session, fecha) -> list[Empaque]:
    rows = (
        db.query(Empaque)
        .filter(Empaque.producto == Producto.MELON, Empaque.fecha == fecha)
        .order_by(Empaque.id.asc())
        .all()
    )
    out = []
    for e in rows:
        det = _detalle_as_dict(e.detalle_corrida)
        if det.get("anulado"):
            continue
        if (det.get("tipo") or "") == TIPO_REEMPAQUE:
            continue
        out.append(e)
    return out


class ReempaqueSalidaItem(BaseModel):
    empaque_id: int
    presentacion: str
    talla: str | None = None
    calidad: str = "llano"
    lote: str | None = None
    cantidad: int = Field(..., gt=0)


class ReempaqueResultadoItem(BaseModel):
    presentacion: str
    talla: str | None = None
    calidad: str = "llano"
    cantidad: int = Field(..., gt=0)
    """Si no se indica lote, hereda el lote único de las salidas."""
    lote: str | None = None


class ReempaqueMelonCreate(BaseModel):
    fecha_origen: str  # YYYY-MM-DD (día del proceso original)
    fecha_reempaque: str  # YYYY-MM-DD (día en que se reempacó)
    mercado: TipoMercado = TipoMercado.NACIONAL
    salidas: list[ReempaqueSalidaItem]
    resultados: list[ReempaqueResultadoItem]
    numero_empacador: str = "EMP-01"
    notas: str | None = None


@router.get("/reempaque-melon/disponibles")
def listar_disponibles_reempaque(
    fecha: str = Query(..., description="Fecha del empaque original YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    """Cajas producidas ese día por proceso / presentación / talla / calidad."""
    f = _parse_fecha_empaque(fecha)
    if not f:
        raise HTTPException(status_code=400, detail="Fecha inválida")
    lineas: list[dict[str, Any]] = []
    procesos: list[dict[str, Any]] = []
    for e in _empaques_melon_fecha(db, f):
        det = _detalle_as_dict(e.detalle_corrida)
        prod = det.get("produccion") or []
        total_cajas = 0
        for p in prod:
            if not isinstance(p, dict):
                continue
            cant = int(p.get("cantidad") or 0)
            if cant <= 0:
                continue
            pres = str(p.get("presentacion") or "").strip()
            if not pres:
                continue
            total_cajas += cant
            lineas.append(
                {
                    "empaque_id": e.id,
                    "fecha": str(e.fecha),
                    "presentacion": pres,
                    "talla": str(p.get("talla") or ""),
                    "calidad": str(p.get("calidad") or "llano").lower() or "llano",
                    "lote": str(p.get("lote") or e.lote_desverdizado or ""),
                    "cantidad": cant,
                    "cantidad_parrillas": p.get("cantidad_parrillas"),
                    "cajas_por_parrilla": p.get("cajas_por_parrilla"),
                }
            )
        consumos = det.get("consumos") or []
        lote = (
            det.get("lotes_resumen")
            or ", ".join(
                str(c.get("lote") or "") for c in consumos if isinstance(c, dict) and c.get("lote")
            )
            or e.lote_desverdizado
            or "—"
        )
        procesos.append(
            {
                "empaque_id": e.id,
                "fecha": str(e.fecha),
                "lote": lote,
                "bins": int(e.bins_desverdizado_usados or 0),
                "cajas": total_cajas,
                "empacador": e.numero_empacador,
            }
        )
    return {
        "fecha": str(f),
        "procesos": procesos,
        "lineas": lineas,
        "total_cajas": sum(int(x["cantidad"]) for x in lineas),
    }


@router.get("/reempaque-melon/historial")
def historial_reempaque_melon(
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    rows = (
        db.query(Empaque)
        .filter(Empaque.producto == Producto.MELON)
        .order_by(Empaque.id.desc())
        .limit(max(limit * 3, 150))
        .all()
    )
    items = []
    for e in rows:
        det = _detalle_as_dict(e.detalle_corrida)
        if (det.get("tipo") or "") != TIPO_REEMPAQUE:
            continue
        if det.get("anulado"):
            continue
        salidas = det.get("salidas") or det.get("consumos_cajas") or []
        resultados = det.get("produccion") or []
        c_out = sum(int(s.get("cantidad") or 0) for s in salidas if isinstance(s, dict))
        c_in = sum(int(r.get("cantidad") or 0) for r in resultados if isinstance(r, dict))
        items.append(
            {
                "id": e.id,
                "fecha_reempaque": str(e.fecha) if e.fecha else None,
                "fecha_origen": det.get("fecha_origen"),
                "mercado": getattr(e.mercado, "value", e.mercado),
                "empacador": e.numero_empacador,
                "cajas_salidas": c_out,
                "cajas_resultado": c_in,
                "merma_cajas": max(0, c_out - c_in),
                "procesos_origen": det.get("procesos_origen") or [],
                "salidas": salidas,
                "resultados": resultados,
                "notas": det.get("notas"),
                "registrado_por": det.get("registrado_por"),
            }
        )
        if len(items) >= limit:
            break
    return {"total": len(items), "items": items}


def _restar_de_produccion_empaque(
    emp: Empaque,
    *,
    presentacion: str,
    talla: str | None,
    calidad: str,
    lote: str | None,
    cantidad: int,
) -> None:
    det = _detalle_as_dict(emp.detalle_corrida)
    prod = list(det.get("produccion") or [])
    need = int(cantidad)
    key = _line_key(presentacion, talla, calidad, lote)
    # 1) match exacto
    for i, p in enumerate(prod):
        if need <= 0:
            break
        if not isinstance(p, dict):
            continue
        pk = _line_key(
            str(p.get("presentacion") or ""),
            p.get("talla"),
            p.get("calidad"),
            p.get("lote") or emp.lote_desverdizado,
        )
        if pk != key:
            continue
        have = int(p.get("cantidad") or 0)
        take = min(have, need)
        if take <= 0:
            continue
        new_cant = have - take
        p = dict(p)
        p["cantidad"] = new_cant
        cpp = int(p.get("cajas_por_parrilla") or 0)
        if cpp > 0 and p.get("cantidad_parrillas") is not None:
            p["cantidad_parrillas"] = round(new_cant / cpp, 4) if new_cant else 0
        prod[i] = p
        need -= take
    if need > 0:
        # 2) mismo sku sin exigir lote
        key2 = (key[0], key[1], key[2])
        for i, p in enumerate(prod):
            if need <= 0:
                break
            if not isinstance(p, dict):
                continue
            pk2 = (
                str(p.get("presentacion") or "").strip(),
                str(p.get("talla") or "").strip(),
                (str(p.get("calidad") or "llano").strip().lower() or "llano"),
            )
            if pk2 != key2:
                continue
            have = int(p.get("cantidad") or 0)
            take = min(have, need)
            if take <= 0:
                continue
            new_cant = have - take
            p = dict(p)
            p["cantidad"] = new_cant
            cpp = int(p.get("cajas_por_parrilla") or 0)
            if cpp > 0 and p.get("cantidad_parrillas") is not None:
                p["cantidad_parrillas"] = round(new_cant / cpp, 4) if new_cant else 0
            prod[i] = p
            need -= take
    if need > 0:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Empaque #{emp.id} no tiene suficientes cajas "
                f"{presentacion} talla {talla or '—'} ({calidad}): faltan {need}"
            ),
        )
    prod = [p for p in prod if isinstance(p, dict) and int(p.get("cantidad") or 0) > 0]
    det["produccion"] = prod
    emp.detalle_corrida = det
    flag_modified(emp, "detalle_corrida")
    _sync_legacy_empaque_fields(
        emp,
        produccion=prod,
        consumos=det.get("consumos") or [],
        bins_usados=int(emp.bins_desverdizado_usados or 0),
    )


def _sumar_a_produccion_empaque(
    emp: Empaque,
    *,
    presentacion: str,
    talla: str | None,
    calidad: str,
    lote: str | None,
    cantidad: int,
    fecha_empaque: str,
) -> None:
    det = _detalle_as_dict(emp.detalle_corrida)
    prod = list(det.get("produccion") or [])
    key = _line_key(presentacion, talla, calidad, lote)
    matched = False
    for i, p in enumerate(prod):
        if not isinstance(p, dict):
            continue
        pk = _line_key(
            str(p.get("presentacion") or ""),
            p.get("talla"),
            p.get("calidad"),
            p.get("lote") or emp.lote_desverdizado,
        )
        if pk != key:
            continue
        p = dict(p)
        new_cant = int(p.get("cantidad") or 0) + int(cantidad)
        p["cantidad"] = new_cant
        p["fecha_empaque"] = fecha_empaque
        if lote:
            p["lote"] = lote
        cpp = int(p.get("cajas_por_parrilla") or 0)
        if cpp > 0:
            p["cantidad_parrillas"] = round(new_cant / cpp, 4)
        prod[i] = p
        matched = True
        break
    if not matched:
        row: dict[str, Any] = {
            "presentacion": presentacion,
            "talla": talla,
            "cantidad": int(cantidad),
            "calidad": calidad,
            "fecha_empaque": fecha_empaque,
            "origen_reempaque": True,
        }
        if lote:
            row["lote"] = lote
        prod.append(row)
    det["produccion"] = prod
    emp.detalle_corrida = det
    flag_modified(emp, "detalle_corrida")
    _sync_legacy_empaque_fields(
        emp,
        produccion=prod,
        consumos=det.get("consumos") or [],
        bins_usados=int(emp.bins_desverdizado_usados or 0),
    )


@router.post("/reempaque-melon")
def crear_reempaque_melon(
    body: ReempaqueMelonCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles([Rol.ADMIN])),
):
    f_origen = _parse_fecha_empaque(body.fecha_origen)
    f_re = _parse_fecha_empaque(body.fecha_reempaque)
    if not f_origen or not f_re:
        raise HTTPException(status_code=400, detail="Fechas inválidas (usa YYYY-MM-DD)")
    if not body.salidas:
        raise HTTPException(status_code=400, detail="Indica al menos una salida de cajas a reempacar")
    if not body.resultados:
        raise HTTPException(status_code=400, detail="Indica el resultado en cajas recuperadas")

    total_out = sum(int(s.cantidad) for s in body.salidas)
    total_in = sum(int(r.cantidad) for r in body.resultados)
    if total_in > total_out:
        raise HTTPException(
            status_code=400,
            detail=f"El resultado ({total_in}) no puede superar las cajas salidas ({total_out})",
        )

    # Validar empaques origen
    emp_cache: dict[int, Empaque] = {}
    for s in body.salidas:
        emp = emp_cache.get(s.empaque_id) or db.query(Empaque).filter(Empaque.id == s.empaque_id).first()
        if not emp or emp.producto != Producto.MELON:
            raise HTTPException(status_code=404, detail=f"Empaque melón #{s.empaque_id} no encontrado")
        det = _detalle_as_dict(emp.detalle_corrida)
        if det.get("anulado"):
            raise HTTPException(status_code=400, detail=f"Empaque #{s.empaque_id} está anulado")
        if (det.get("tipo") or "") == TIPO_REEMPAQUE:
            raise HTTPException(status_code=400, detail=f"#{s.empaque_id} es un registro de reempaque, no un proceso de origen")
        if emp.fecha != f_origen:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Empaque #{s.empaque_id} es del {emp.fecha}, "
                    f"no de la fecha de origen {f_origen}"
                ),
            )
        emp_cache[s.empaque_id] = emp

    lotes_salida = sorted(
        {
            (s.lote or emp_cache[s.empaque_id].lote_desverdizado or "").strip()
            for s in body.salidas
            if (s.lote or emp_cache[s.empaque_id].lote_desverdizado or "").strip()
        }
    )
    lote_unico = lotes_salida[0] if len(lotes_salida) == 1 else None

    # 1) Restar del proceso original + inventario
    debit_lines: list[dict] = []
    salidas_norm: list[dict] = []
    for s in body.salidas:
        emp = emp_cache[s.empaque_id]
        lote = (s.lote or emp.lote_desverdizado or "").strip() or None
        cal = (s.calidad or "llano").strip().lower() or "llano"
        _restar_de_produccion_empaque(
            emp,
            presentacion=s.presentacion.strip(),
            talla=s.talla,
            calidad=cal,
            lote=lote,
            cantidad=int(s.cantidad),
        )
        line = {
            "presentacion": s.presentacion.strip(),
            "talla": s.talla,
            "calidad": cal,
            "lote": lote,
            "fecha_empaque": str(f_origen),
            "cantidad": int(s.cantidad),
            "empaque_id": s.empaque_id,
        }
        debit_lines.append(line)
        salidas_norm.append(dict(line))

    aplicadas, problemas = _ajustar_inventario_final(
        db, Producto.MELON, body.mercado, debit_lines, signo=-1
    )
    if problemas:
        raise HTTPException(
            status_code=400,
            detail="Stock insuficiente para reempacar: " + "; ".join(problemas),
        )

    # 2) Sumar resultado al proceso de origen (primer empaque tocado) + inventario
    #    fecha_empaque = fecha_origen → no contamina el día del reempaque
    primary_id = body.salidas[0].empaque_id
    primary = emp_cache[primary_id]
    credit_lines: list[dict] = []
    resultados_norm: list[dict] = []
    for r in body.resultados:
        cal = (r.calidad or "llano").strip().lower() or "llano"
        lote = (r.lote or lote_unico or primary.lote_desverdizado or "").strip() or None
        _sumar_a_produccion_empaque(
            primary,
            presentacion=r.presentacion.strip(),
            talla=r.talla,
            calidad=cal,
            lote=lote,
            cantidad=int(r.cantidad),
            fecha_empaque=str(f_origen),
        )
        line = {
            "presentacion": r.presentacion.strip(),
            "talla": r.talla,
            "calidad": cal,
            "lote": lote,
            "fecha_empaque": str(f_origen),
            "cantidad": int(r.cantidad),
            "proceso_origen_id": primary_id,
        }
        credit_lines.append(line)
        resultados_norm.append(dict(line))

    _ajustar_inventario_final(db, Producto.MELON, body.mercado, credit_lines, signo=+1)

    # 3) Registro de auditoría (excluido de KPIs MelonReportes)
    merma = total_out - total_in
    detalle = {
        "tipo": TIPO_REEMPAQUE,
        "fecha_origen": str(f_origen),
        "fecha_reempaque": str(f_re),
        "procesos_origen": sorted({s.empaque_id for s in body.salidas}),
        "proceso_destino_id": primary_id,
        "salidas": salidas_norm,
        "consumos_cajas": salidas_norm,
        "produccion": resultados_norm,
        "consumos": [],
        "bins_campo": 0,
        "merma_cajas": merma,
        "lotes_resumen": (
            f"reempaque {total_out}→{total_in} (merma {merma}) "
            f"origen {f_origen} / hecho {f_re}"
        ),
        "notas": body.notas,
        "registrado_por": getattr(current_user, "username", None),
        "stock_debitado": aplicadas,
    }
    audit = Empaque(
        producto=Producto.MELON,
        fecha=f_re,
        variedad=None,
        tipo_cultivo=None,
        mercado=body.mercado,
        cantidad_cajas_campo_usadas=0,
        cantidad_cajas_carton_producidas=0,
        porcentaje_merma=round((merma / total_out) * 100, 2) if total_out else 0.0,
        numero_empacador=body.numero_empacador or "EMP-01",
        bins_desverdizado_usados=0,
        lote_desverdizado=lote_unico,
        detalle_corrida=detalle,
        usuario_id=getattr(current_user, "id", None),
    )
    _sync_legacy_empaque_fields(
        audit,
        produccion=resultados_norm,
        consumos=[],
        bins_usados=0,
    )
    db.add(audit)
    db.commit()
    db.refresh(audit)

    return {
        "message": (
            f"Reempaque registrado: {total_out} cajas salidas → {total_in} recuperadas "
            f"(merma {merma}). Resultado integrado al proceso #{primary_id} del {f_origen}."
        ),
        "id": audit.id,
        "fecha_origen": str(f_origen),
        "fecha_reempaque": str(f_re),
        "cajas_salidas": total_out,
        "cajas_resultado": total_in,
        "merma_cajas": merma,
        "proceso_destino_id": primary_id,
        "procesos_origen": sorted({s.empaque_id for s in body.salidas}),
    }


def _sku_reempaque(row: dict) -> tuple:
    return (
        str(row.get("presentacion") or "").strip(),
        str(row.get("talla") or "").strip(),
        str(row.get("calidad") or "llano").strip().lower() or "llano",
        str(row.get("lote") or "").strip(),
        str(row.get("fecha_empaque") or "")[:10],
    )


def _ids_reempaque(det: dict) -> set[int]:
    ids: set[int] = set()
    for raw in det.get("procesos_origen") or []:
        try:
            ids.add(int(raw))
        except (TypeError, ValueError):
            continue
    if det.get("proceso_destino_id") is not None:
        try:
            ids.add(int(det.get("proceso_destino_id")))
        except (TypeError, ValueError):
            pass
    for s in det.get("salidas") or det.get("consumos_cajas") or []:
        if isinstance(s, dict) and s.get("empaque_id") is not None:
            try:
                ids.add(int(s.get("empaque_id")))
            except (TypeError, ValueError):
                continue
    return ids


def reempaques_posteriores_sobre_resultado(db: Session, audit: Empaque) -> list[Empaque]:
    """
    Reempaques más nuevos que usaron las cajas recuperadas de este.
    No se deshace la cadena sola: hay que borrar el más nuevo primero.
    """
    det = _detalle_as_dict(audit.detalle_corrida)
    skus = {
        _sku_reempaque(p)
        for p in (det.get("produccion") or [])
        if isinstance(p, dict) and int(p.get("cantidad") or 0) > 0
    }
    if not skus:
        return []
    origenes = _ids_reempaque(det)
    hits: list[Empaque] = []
    rows = (
        db.query(Empaque)
        .filter(Empaque.producto == Producto.MELON, Empaque.id != audit.id)
        .all()
    )
    for e in rows:
        if (e.id or 0) < (audit.id or 0):
            continue
        odet = _detalle_as_dict(e.detalle_corrida)
        if odet.get("anulado") or (odet.get("tipo") or "") != TIPO_REEMPAQUE:
            continue
        if origenes and _ids_reempaque(odet) and not (origenes & _ids_reempaque(odet)):
            continue
        salidas = odet.get("salidas") or odet.get("consumos_cajas") or []
        if any(isinstance(s, dict) and _sku_reempaque(s) in skus for s in salidas):
            hits.append(e)
    return hits


def _lineas_resultado(det: dict) -> list[dict]:
    out = []
    for p in det.get("produccion") or []:
        if not isinstance(p, dict):
            continue
        if int(p.get("cantidad") or 0) <= 0:
            continue
        out.append(p)
    return out


def _lineas_salida(det: dict) -> list[dict]:
    raw = det.get("salidas") or det.get("consumos_cajas") or []
    return [s for s in raw if isinstance(s, dict) and int(s.get("cantidad") or 0) > 0]


def revertir_reempaque_melon(
    db: Session, audit: Empaque, *, commit: bool = True
) -> dict:
    """
    Deshace un reempaque de melón sin tocar bins.

    Quita del día de origen las cajas recuperadas y devuelve las cajas
    que se habían sacado (la merma vuelve como cajas originales).
    Si esas cajas ya se embarcaron o un reempaque posterior las volvió
    a usar, no cambia nada.
    """
    det = _detalle_as_dict(audit.detalle_corrida)
    if (det.get("tipo") or "") != TIPO_REEMPAQUE:
        raise HTTPException(
            status_code=400,
            detail=f"El registro #{audit.id} no es un reempaque de melón.",
        )
    if det.get("anulado"):
        db.delete(audit)
        if commit:
            db.commit()
        return {
            "message": (
                f"Reempaque #{audit.id} borrado del historial. "
                f"Los inventarios no se movieron (el registro ya estaba anulado)."
            ),
            "id": audit.id,
            "cajas_devueltas": 0,
            "cajas_quitadas": 0,
        }

    posteriores = reempaques_posteriores_sobre_resultado(db, audit)
    if posteriores:
        refs = ", ".join(f"#{e.id}" for e in posteriores[:6])
        raise HTTPException(
            status_code=409,
            detail=(
                f"No se puede eliminar el reempaque #{audit.id}: "
                f"sus cajas recuperadas se volvieron a reempacar ({refs}). "
                f"Elimina primero ese reempaque más nuevo. No se cambió nada."
            ),
        )

    resultados = _lineas_resultado(det)
    salidas = _lineas_salida(det)
    problemas = _problemas_stock_cajas_melon(db, audit.mercado, resultados)
    if problemas:
        raise HTTPException(
            status_code=409,
            detail=(
                f"No se puede eliminar el reempaque #{audit.id}. "
                + " | ".join(problemas)
                + " No se cambió nada."
            ),
        )

    dest_id = det.get("proceso_destino_id")
    try:
        dest_id_i = int(dest_id) if dest_id is not None else None
    except (TypeError, ValueError):
        dest_id_i = None
    if dest_id_i is None and salidas:
        try:
            dest_id_i = int(salidas[0].get("empaque_id"))
        except (TypeError, ValueError):
            dest_id_i = None

    origen_ids = _ids_reempaque(det)
    if dest_id_i is not None:
        origen_ids.add(dest_id_i)
    origenes: dict[int, Empaque] = {}
    for oid in origen_ids:
        emp = db.query(Empaque).filter(Empaque.id == oid).first()
        if not emp or emp.producto != Producto.MELON:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"No se puede eliminar el reempaque #{audit.id}: "
                    f"el proceso de origen #{oid} ya no existe. No se cambió nada."
                ),
            )
        odet = _detalle_as_dict(emp.detalle_corrida)
        if odet.get("anulado"):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"No se puede eliminar el reempaque #{audit.id}: "
                    f"el proceso de origen #{oid} está anulado. "
                    f"Deshacerlo duplicaría cajas. No se cambió nada."
                ),
            )
        if (odet.get("tipo") or "") == TIPO_REEMPAQUE:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"No se puede eliminar el reempaque #{audit.id}: "
                    f"#{oid} también es un reempaque. No se cambió nada."
                ),
            )
        origenes[oid] = emp

    if dest_id_i is None or dest_id_i not in origenes:
        raise HTTPException(
            status_code=409,
            detail=(
                f"No se puede eliminar el reempaque #{audit.id}: "
                f"no tiene proceso de origen. No se cambió nada."
            ),
        )
    destino = origenes[dest_id_i]
    fecha_origen = str(det.get("fecha_origen") or destino.fecha or "")[:10]

    for r in resultados:
        _restar_de_produccion_empaque(
            destino,
            presentacion=str(r.get("presentacion") or "").strip(),
            talla=r.get("talla"),
            calidad=str(r.get("calidad") or "llano"),
            lote=(str(r.get("lote") or "").strip() or None),
            cantidad=int(r.get("cantidad") or 0),
        )
    if resultados:
        _ajustar_inventario_final(
            db,
            Producto.MELON,
            audit.mercado,
            resultados,
            signo=-1,
            best_effort=False,
            ignorar_reclamo_empaque_id=dest_id_i,
        )

    credit: list[dict] = []
    for s in salidas:
        try:
            eid = int(s.get("empaque_id"))
        except (TypeError, ValueError):
            eid = dest_id_i
        emp = origenes.get(eid) or destino
        lote = str(s.get("lote") or "").strip() or None
        fecha = str(s.get("fecha_empaque") or fecha_origen)[:10]
        cal = str(s.get("calidad") or "llano").strip().lower() or "llano"
        _sumar_a_produccion_empaque(
            emp,
            presentacion=str(s.get("presentacion") or "").strip(),
            talla=s.get("talla"),
            calidad=cal,
            lote=lote,
            cantidad=int(s.get("cantidad") or 0),
            fecha_empaque=fecha,
        )
        credit.append(
            {
                "presentacion": str(s.get("presentacion") or "").strip(),
                "talla": s.get("talla"),
                "calidad": cal,
                "lote": lote,
                "fecha_empaque": fecha,
                "cantidad": int(s.get("cantidad") or 0),
            }
        )
    if credit:
        _ajustar_inventario_final(
            db, Producto.MELON, audit.mercado, credit, signo=+1
        )

    cajas_devueltas = sum(int(s.get("cantidad") or 0) for s in salidas)
    cajas_quitadas = sum(int(r.get("cantidad") or 0) for r in resultados)
    db.delete(audit)
    db.flush()
    if commit:
        db.commit()
    return {
        "message": (
            f"Reempaque #{audit.id} eliminado. "
            f"Volvieron {cajas_devueltas} cajas al día de empaque "
            f"y se quitaron {cajas_quitadas} cajas recuperadas. "
            f"Los bins no se movieron."
        ),
        "id": audit.id,
        "cajas_devueltas": cajas_devueltas,
        "cajas_quitadas": cajas_quitadas,
    }

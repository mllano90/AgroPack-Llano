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

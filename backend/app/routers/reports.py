from collections import defaultdict
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.inventory import InventarioFinal, InventarioCampo, Embarque, InventarioDesverdizado, Empaque
from app.models.enums import Producto
from app.schemas.reports import (
    DashboardResponse,
    InventarioFinalItem,
    InventarioCampoItem,
    DesverdizadoItem,
    CorridaRendimiento,
    LoteRendimiento,
    RendimientosLimonResponse,
)

router = APIRouter(tags=["Reportes"])

# Constantes de peso y parrillas (limón)
KG_BIN_CAMPO = 260
KG_POR_PRESENTACION = {
    "rpc_12": 12,
    "rpc_18": 18,
    "caja_40lbs": 18,
    "bins_jugo": 900,
}
CAJAS_POR_PARRILLA_RPC = 45  # RPC 12 y 18
CAJAS_POR_PARRILLA_CARTON = 63  # cartón / 40lbs


def _calcular_rendimiento(
    *,
    id: int,
    fecha: str,
    numero_empacador: str | None,
    consumos: list,
    produccion: list,
    lotes_resumen: str | None = None,
) -> CorridaRendimiento:
    bins_campo = sum(int(c.get("bins") or 0) for c in (consumos or []))
    kg_entrada = bins_campo * KG_BIN_CAMPO

    kg_primera = 0.0
    kg_segunda = 0.0
    cajas_rpc = 0
    cajas_carton = 0
    bins_jugo = 0

    for p in produccion or []:
        pres = p.get("presentacion") or ""
        cant = int(p.get("cantidad") or 0)
        if cant <= 0:
            continue
        kg_unit = KG_POR_PRESENTACION.get(pres, 0)
        kg = kg_unit * cant
        if pres == "bins_jugo":
            kg_segunda += kg
            bins_jugo += cant
        elif pres in ("rpc_12", "rpc_18"):
            kg_primera += kg
            cajas_rpc += cant
        elif pres == "caja_40lbs":
            kg_primera += kg
            cajas_carton += cant
        else:
            # desconocido: contar como primera si tiene peso
            kg_primera += kg

    kg_salida = kg_primera + kg_segunda
    pct_primera = round((kg_primera / kg_entrada * 100) if kg_entrada else 0.0, 2)
    pct_segunda = round((kg_segunda / kg_entrada * 100) if kg_entrada else 0.0, 2)
    pct_recuperacion = round((kg_salida / kg_entrada * 100) if kg_entrada else 0.0, 2)

    parrillas_rpc = round(cajas_rpc / CAJAS_POR_PARRILLA_RPC, 2) if cajas_rpc else 0.0
    parrillas_carton = round(cajas_carton / CAJAS_POR_PARRILLA_CARTON, 2) if cajas_carton else 0.0
    parrillas_jugo = float(bins_jugo)
    parrillas_total = round(parrillas_rpc + parrillas_carton + parrillas_jugo, 2)
    bins_por_parrilla = (
        round(bins_campo / parrillas_total, 2) if parrillas_total > 0 else None
    )

    return CorridaRendimiento(
        id=id,
        fecha=fecha,
        numero_empacador=numero_empacador,
        bins_campo=bins_campo,
        kg_entrada=round(kg_entrada, 2),
        kg_primera=round(kg_primera, 2),
        kg_segunda=round(kg_segunda, 2),
        kg_salida=round(kg_salida, 2),
        pct_primera=pct_primera,
        pct_segunda=pct_segunda,
        pct_recuperacion=pct_recuperacion,
        cajas_rpc=cajas_rpc,
        cajas_carton=cajas_carton,
        bins_jugo=bins_jugo,
        parrillas_rpc=parrillas_rpc,
        parrillas_carton=parrillas_carton,
        parrillas_jugo=parrillas_jugo,
        parrillas_total=parrillas_total,
        bins_por_parrilla=bins_por_parrilla,
        lotes_resumen=lotes_resumen,
    )


def _acumular(corridas: list[CorridaRendimiento]) -> CorridaRendimiento:
    if not corridas:
        return _calcular_rendimiento(
            id=0, fecha="acumulado", numero_empacador=None, consumos=[], produccion=[]
        )
    # Acumular kg y unidades; recalcular % y parrillas
    bins_campo = sum(c.bins_campo for c in corridas)
    kg_entrada = sum(c.kg_entrada for c in corridas)
    kg_primera = sum(c.kg_primera for c in corridas)
    kg_segunda = sum(c.kg_segunda for c in corridas)
    kg_salida = kg_primera + kg_segunda
    cajas_rpc = sum(c.cajas_rpc for c in corridas)
    cajas_carton = sum(c.cajas_carton for c in corridas)
    bins_jugo = sum(c.bins_jugo for c in corridas)
    parrillas_rpc = round(cajas_rpc / CAJAS_POR_PARRILLA_RPC, 2) if cajas_rpc else 0.0
    parrillas_carton = round(cajas_carton / CAJAS_POR_PARRILLA_CARTON, 2) if cajas_carton else 0.0
    parrillas_jugo = float(bins_jugo)
    parrillas_total = round(parrillas_rpc + parrillas_carton + parrillas_jugo, 2)
    return CorridaRendimiento(
        id=0,
        fecha="acumulado",
        numero_empacador=None,
        bins_campo=bins_campo,
        kg_entrada=round(kg_entrada, 2),
        kg_primera=round(kg_primera, 2),
        kg_segunda=round(kg_segunda, 2),
        kg_salida=round(kg_salida, 2),
        pct_primera=round((kg_primera / kg_entrada * 100) if kg_entrada else 0.0, 2),
        pct_segunda=round((kg_segunda / kg_entrada * 100) if kg_entrada else 0.0, 2),
        pct_recuperacion=round((kg_salida / kg_entrada * 100) if kg_entrada else 0.0, 2),
        cajas_rpc=cajas_rpc,
        cajas_carton=cajas_carton,
        bins_jugo=bins_jugo,
        parrillas_rpc=parrillas_rpc,
        parrillas_carton=parrillas_carton,
        parrillas_jugo=parrillas_jugo,
        parrillas_total=parrillas_total,
        bins_por_parrilla=round(bins_campo / parrillas_total, 2) if parrillas_total > 0 else None,
        lotes_resumen=f"{len(corridas)} corridas",
    )


def _kg_y_unidades_produccion(produccion: list) -> dict:
    """Suma kg 1ra/2da y unidades a partir de líneas de producción."""
    kg_primera = 0.0
    kg_segunda = 0.0
    cajas_rpc = 0
    cajas_carton = 0
    bins_jugo = 0
    for p in produccion or []:
        pres = p.get("presentacion") or ""
        cant = int(p.get("cantidad") or 0)
        if cant <= 0:
            continue
        kg_unit = KG_POR_PRESENTACION.get(pres, 0)
        kg = kg_unit * cant
        if pres == "bins_jugo":
            kg_segunda += kg
            bins_jugo += cant
        elif pres in ("rpc_12", "rpc_18"):
            kg_primera += kg
            cajas_rpc += cant
        elif pres == "caja_40lbs":
            kg_primera += kg
            cajas_carton += cant
        else:
            kg_primera += kg
    return {
        "kg_primera": kg_primera,
        "kg_segunda": kg_segunda,
        "cajas_rpc": cajas_rpc,
        "cajas_carton": cajas_carton,
        "bins_jugo": bins_jugo,
    }


def _extract_empaque_detalle(e: Empaque) -> tuple[list, list, bool]:
    """
    Devuelve (consumos, produccion, anulado).
    """
    detalle = e.detalle_corrida if isinstance(e.detalle_corrida, dict) else None
    if detalle and detalle.get("anulado"):
        return [], [], True

    if detalle and (detalle.get("produccion") or detalle.get("consumos")):
        consumos = list(detalle.get("consumos") or [])
        produccion = list(detalle.get("produccion") or [])
    else:
        bins = e.bins_desverdizado_usados or 0
        consumos = []
        if bins > 0:
            consumos = [{"bins": bins, "lote": e.lote_desverdizado or "SIN_LOTE"}]
        produccion = []
        if e.presentacion and e.cantidad_producida:
            produccion = [{
                "presentacion": e.presentacion,
                "talla": e.talla,
                "cantidad": e.cantidad_producida,
            }]

    return consumos, produccion, False


def _rendimientos_por_lote(empaques: list) -> list[LoteRendimiento]:
    """
    Acumula por lote de campo.
    Si una corrida usó varios lotes, la producción se prorratea por proporción de bins
    (no se registra 1ra/2da por lote al empacar).
    """
    acc: dict[str, dict] = defaultdict(
        lambda: {
            "bins_campo": 0,
            "kg_primera": 0.0,
            "kg_segunda": 0.0,
            "cajas_rpc": 0.0,
            "cajas_carton": 0.0,
            "bins_jugo": 0.0,
            "corrida_ids": set(),
            "prorrateado": False,
        }
    )

    for e in empaques:
        consumos, produccion, anulado = _extract_empaque_detalle(e)
        if anulado:
            continue
        consumos_ok = [
            c for c in consumos
            if int(c.get("bins") or 0) > 0
        ]
        total_bins = sum(int(c.get("bins") or 0) for c in consumos_ok)
        if total_bins <= 0:
            continue

        units = _kg_y_unidades_produccion(produccion)
        multi_lote = len({str(c.get("lote") or "SIN_LOTE") for c in consumos_ok}) > 1

        for c in consumos_ok:
            lote = str(c.get("lote") or "SIN_LOTE").strip() or "SIN_LOTE"
            bins = int(c.get("bins") or 0)
            share = bins / total_bins
            row = acc[lote]
            row["bins_campo"] += bins
            row["kg_primera"] += units["kg_primera"] * share
            row["kg_segunda"] += units["kg_segunda"] * share
            row["cajas_rpc"] += units["cajas_rpc"] * share
            row["cajas_carton"] += units["cajas_carton"] * share
            row["bins_jugo"] += units["bins_jugo"] * share
            row["corrida_ids"].add(e.id)
            if multi_lote:
                row["prorrateado"] = True

    result: list[LoteRendimiento] = []
    for lote, row in sorted(acc.items(), key=lambda x: x[0]):
        bins_campo = int(row["bins_campo"])
        kg_entrada = bins_campo * KG_BIN_CAMPO
        kg_primera = row["kg_primera"]
        kg_segunda = row["kg_segunda"]
        kg_salida = kg_primera + kg_segunda
        cajas_rpc = int(round(row["cajas_rpc"]))
        cajas_carton = int(round(row["cajas_carton"]))
        bins_jugo = int(round(row["bins_jugo"]))
        parrillas_rpc = round(cajas_rpc / CAJAS_POR_PARRILLA_RPC, 2) if cajas_rpc else 0.0
        parrillas_carton = round(cajas_carton / CAJAS_POR_PARRILLA_CARTON, 2) if cajas_carton else 0.0
        parrillas_jugo = float(bins_jugo)
        parrillas_total = round(parrillas_rpc + parrillas_carton + parrillas_jugo, 2)
        result.append(
            LoteRendimiento(
                lote=lote,
                bins_campo=bins_campo,
                kg_entrada=round(kg_entrada, 2),
                kg_primera=round(kg_primera, 2),
                kg_segunda=round(kg_segunda, 2),
                kg_salida=round(kg_salida, 2),
                pct_primera=round((kg_primera / kg_entrada * 100) if kg_entrada else 0.0, 2),
                pct_segunda=round((kg_segunda / kg_entrada * 100) if kg_entrada else 0.0, 2),
                pct_recuperacion=round((kg_salida / kg_entrada * 100) if kg_entrada else 0.0, 2),
                cajas_rpc=cajas_rpc,
                cajas_carton=cajas_carton,
                bins_jugo=bins_jugo,
                parrillas_total=parrillas_total,
                num_corridas=len(row["corrida_ids"]),
                prorrateado=bool(row["prorrateado"]),
            )
        )
    return result

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


@router.get("/rendimientos-limon", response_model=RendimientosLimonResponse)
def rendimientos_limon(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Rendimientos de limón:
    - por corrida de empaque
    - por lote de campo (kg total, 1ra, 2da; multi-lote prorratea por bins)
    - acumulado
    Empaques anulados se excluyen.
    """
    empaques = (
        db.query(Empaque)
        .filter(Empaque.producto == Producto.LIMON_AMARILLO)
        .order_by(Empaque.fecha.desc(), Empaque.id.desc())
        .all()
    )

    corridas: list[CorridaRendimiento] = []
    for e in empaques:
        consumos, produccion, anulado = _extract_empaque_detalle(e)
        if anulado:
            continue
        if not consumos and not produccion:
            continue

        detalle = e.detalle_corrida if isinstance(e.detalle_corrida, dict) else None
        lotes = None
        if detalle:
            lotes = detalle.get("lotes_resumen")
        if not lotes:
            lotes = ", ".join(
                f"{c.get('lote')}:{c.get('bins')}"
                for c in consumos
                if c.get("lote")
            ) or e.lote_desverdizado

        corridas.append(
            _calcular_rendimiento(
                id=e.id,
                fecha=str(e.fecha) if e.fecha else "",
                numero_empacador=e.numero_empacador,
                consumos=consumos,
                produccion=produccion,
                lotes_resumen=lotes,
            )
        )

    return RendimientosLimonResponse(
        corridas=corridas,
        por_lote=_rendimientos_por_lote(empaques),
        acumulado=_acumular(corridas),
    )

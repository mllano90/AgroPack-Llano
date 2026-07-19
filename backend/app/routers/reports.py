import json
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
    TallaRendimiento,
    PresentacionRendimiento,
    FactoresProyeccion,
    ProyeccionUnidad,
    ProyeccionLoteItem,
    ProyeccionPorFecha,
    ProyeccionInventarioResponse,
    RendimientosLimonResponse,
)

router = APIRouter(tags=["Reportes"])

# Constantes de peso y parrillas (limón)
KG_BIN_CAMPO = 260
KG_POR_PRESENTACION = {
    "rpc_12": 12,
    "rpc_18": 18,
    "caja_40lbs": 18,
    "rpc_granel": 22,  # RPC a granel (intermedio 1ra, pre-embolse)
    "bins_jugo": 900,
}
CAJAS_POR_PARRILLA_RPC = 45  # RPC 12 y 18
CAJAS_POR_PARRILLA_CARTON = 63  # cartón / 40lbs
# Superficie total del rancho (para kg/ha acumulado / corrida)
HECTAREAS_RANCHO = 64.0
# Cada lote de campo se trata como 8 ha (kg/ha más real por lote)
HECTAREAS_POR_LOTE = 8.0


def _kg_por_ha(kg: float, hectareas: float = HECTAREAS_RANCHO) -> float | None:
    if not hectareas or hectareas <= 0:
        return None
    return round(kg / hectareas, 2)


def _calcular_rendimiento(
    *,
    id: int,
    fecha: str,
    numero_empacador: str | None,
    consumos: list,
    produccion: list,
    lotes_resumen: str | None = None,
    hectareas: float = HECTAREAS_RANCHO,
) -> CorridaRendimiento:
    bins_campo = sum(int(c.get("bins") or 0) for c in (consumos or []))
    kg_entrada = bins_campo * KG_BIN_CAMPO

    kg_primera = 0.0
    kg_segunda = 0.0
    kg_rpc = 0.0
    kg_carton = 0.0
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
        elif pres == "rpc_granel":
            # Intermedio 1ra (aún no embolsado); cuenta en 1ra pero no en RPC final/cartón
            kg_primera += kg
        elif pres in ("rpc_12", "rpc_18"):
            kg_primera += kg
            kg_rpc += kg
            cajas_rpc += cant
        elif pres == "caja_40lbs":
            kg_primera += kg
            kg_carton += kg
            cajas_carton += cant
        else:
            # desconocido: contar como primera si tiene peso
            kg_primera += kg

    kg_salida = kg_primera + kg_segunda
    pct_primera = round((kg_primera / kg_entrada * 100) if kg_entrada else 0.0, 2)
    pct_segunda = round((kg_segunda / kg_entrada * 100) if kg_entrada else 0.0, 2)
    pct_recuperacion = round((kg_salida / kg_entrada * 100) if kg_entrada else 0.0, 2)
    pct_rpc_de_primera = round((kg_rpc / kg_primera * 100) if kg_primera else 0.0, 2)
    pct_carton_de_primera = round((kg_carton / kg_primera * 100) if kg_primera else 0.0, 2)

    parrillas_rpc = round(cajas_rpc / CAJAS_POR_PARRILLA_RPC, 2) if cajas_rpc else 0.0
    parrillas_carton = round(cajas_carton / CAJAS_POR_PARRILLA_CARTON, 2) if cajas_carton else 0.0
    parrillas_jugo = float(bins_jugo)
    # Solo 1ra (RPC + cartón); no incluye bins jugo / 2da
    parrillas_primera = round(parrillas_rpc + parrillas_carton, 2)
    parrillas_total = round(parrillas_primera + parrillas_jugo, 2)
    bins_por_parrilla = (
        round(bins_campo / parrillas_primera, 2) if parrillas_primera > 0 else None
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
        kg_rpc=round(kg_rpc, 2),
        kg_carton=round(kg_carton, 2),
        pct_rpc_de_primera=pct_rpc_de_primera,
        pct_carton_de_primera=pct_carton_de_primera,
        cajas_rpc=cajas_rpc,
        cajas_carton=cajas_carton,
        bins_jugo=bins_jugo,
        parrillas_rpc=parrillas_rpc,
        parrillas_carton=parrillas_carton,
        parrillas_jugo=parrillas_jugo,
        parrillas_primera=parrillas_primera,
        parrillas_total=parrillas_total,
        bins_por_parrilla=bins_por_parrilla,
        kg_por_ha=_kg_por_ha(kg_salida, hectareas),
        kg_primera_por_ha=_kg_por_ha(kg_primera, hectareas),
        kg_segunda_por_ha=_kg_por_ha(kg_segunda, hectareas),
        lotes_resumen=lotes_resumen,
    )


def _acumular(
    corridas: list[CorridaRendimiento],
    hectareas: float = HECTAREAS_RANCHO,
) -> CorridaRendimiento:
    if not corridas:
        return _calcular_rendimiento(
            id=0, fecha="acumulado", numero_empacador=None, consumos=[], produccion=[],
            hectareas=hectareas,
        )
    # Acumular kg y unidades; recalcular % y parrillas
    bins_campo = sum(c.bins_campo for c in corridas)
    kg_entrada = sum(c.kg_entrada for c in corridas)
    kg_primera = sum(c.kg_primera for c in corridas)
    kg_segunda = sum(c.kg_segunda for c in corridas)
    kg_rpc = sum(getattr(c, "kg_rpc", 0) or 0 for c in corridas)
    kg_carton = sum(getattr(c, "kg_carton", 0) or 0 for c in corridas)
    kg_salida = kg_primera + kg_segunda
    cajas_rpc = sum(c.cajas_rpc for c in corridas)
    cajas_carton = sum(c.cajas_carton for c in corridas)
    bins_jugo = sum(c.bins_jugo for c in corridas)
    parrillas_rpc = round(cajas_rpc / CAJAS_POR_PARRILLA_RPC, 2) if cajas_rpc else 0.0
    parrillas_carton = round(cajas_carton / CAJAS_POR_PARRILLA_CARTON, 2) if cajas_carton else 0.0
    parrillas_jugo = float(bins_jugo)
    parrillas_primera = round(parrillas_rpc + parrillas_carton, 2)
    parrillas_total = round(parrillas_primera + parrillas_jugo, 2)
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
        kg_rpc=round(kg_rpc, 2),
        kg_carton=round(kg_carton, 2),
        pct_rpc_de_primera=round((kg_rpc / kg_primera * 100) if kg_primera else 0.0, 2),
        pct_carton_de_primera=round((kg_carton / kg_primera * 100) if kg_primera else 0.0, 2),
        cajas_rpc=cajas_rpc,
        cajas_carton=cajas_carton,
        bins_jugo=bins_jugo,
        parrillas_rpc=parrillas_rpc,
        parrillas_carton=parrillas_carton,
        parrillas_jugo=parrillas_jugo,
        parrillas_primera=parrillas_primera,
        parrillas_total=parrillas_total,
        bins_por_parrilla=(
            round(bins_campo / parrillas_primera, 2) if parrillas_primera > 0 else None
        ),
        kg_por_ha=_kg_por_ha(kg_salida, hectareas),
        kg_primera_por_ha=_kg_por_ha(kg_primera, hectareas),
        kg_segunda_por_ha=_kg_por_ha(kg_segunda, hectareas),
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


def _as_dict(val) -> dict | None:
    """Normaliza JSON de detalle_corrida (dict o string)."""
    if val is None:
        return None
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        try:
            parsed = json.loads(val)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None
    return None


def _producto_es_limon(producto) -> bool:
    if producto is None:
        return False
    val = getattr(producto, "value", None) or str(producto)
    return str(val).lower() in ("limon_amarillo", "producto.limon_amarillo")


def _es_conversion_granel(detalle: dict | None) -> bool:
    return bool(detalle and detalle.get("tipo") == "conversion_rpc_granel")


def _extract_empaque_detalle(e: Empaque) -> tuple[list, list, bool]:
    """
    Devuelve (consumos, produccion, anulado).
    """
    detalle = _as_dict(e.detalle_corrida)
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
        parrillas_primera = round(parrillas_rpc + parrillas_carton, 2)
        parrillas_total = round(parrillas_primera + parrillas_jugo, 2)
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
                parrillas_primera=parrillas_primera,
                bins_por_parrilla=(
                    round(bins_campo / parrillas_primera, 2) if parrillas_primera > 0 else None
                ),
                kg_por_ha=_kg_por_ha(kg_salida, HECTAREAS_POR_LOTE),
                kg_primera_por_ha=_kg_por_ha(kg_primera, HECTAREAS_POR_LOTE),
                kg_segunda_por_ha=_kg_por_ha(kg_segunda, HECTAREAS_POR_LOTE),
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
        talla_raw = extra.get("talla")
        talla_str = (
            None
            if talla_raw is None or str(talla_raw).strip() == ""
            else str(talla_raw).strip()
        )
        final_list.append(
            InventarioFinalItem(
                producto=item.producto,
                variedad=item.variedad,
                tipo_cultivo=item.tipo_cultivo,
                mercado=item.mercado,
                cantidad_stock=item.cantidad_stock,
                presentacion=extra.get("presentacion"),
                calidad=extra.get("calidad"),
                talla=talla_str,
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
    # No renumerar tandas al consultar dashboard (solo al eliminar)

    desverdizado_raw = db.query(InventarioDesverdizado).filter(
        InventarioDesverdizado.cantidad_bins > 0,
    ).order_by(
        InventarioDesverdizado.fecha_recepcion.asc(),
        InventarioDesverdizado.id.asc(),
    ).all()

    desverdizado_list = [
        DesverdizadoItem(
            lote=d.lote,
            cantidad_bins_disponibles=d.cantidad_bins,
            fecha_recepcion=str(d.fecha_recepcion),
            fecha_tentativa_salida=str(d.fecha_tentativa_salida),
            estado=d.estado,
            numero_tanda=d.numero_tanda,
        )
        for d in desverdizado_raw
        if (d.cantidad_bins or 0) > 0 and (d.estado or "") != "eliminado"
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


def _iter_produccion_empaques(empaques: list):
    """
    Agrega producción histórica y bins de campo (excluye anulados).
    Returns: agg_pres, bins_total, kg1, kg2, kg_por_talla, cajas_por_talla
    """
    bins_total = 0
    kg1_total = 0.0
    kg2_total = 0.0
    # key (presentacion, talla) -> cajas, kg
    agg_pres: dict[tuple[str, str | None], dict] = defaultdict(
        lambda: {"cajas": 0, "kg": 0.0}
    )
    kg_por_talla: dict[str, float] = defaultdict(float)
    cajas_por_talla: dict[str, int] = defaultdict(int)

    for e in empaques:
        consumos, produccion, anulado = _extract_empaque_detalle(e)
        if anulado:
            continue
        detalle = _as_dict(e.detalle_corrida)
        # Conversión: reasigna granel → final (sin bins de campo).
        # Restar granel consumido y sumar producto final para no doblar kg 1ra.
        if _es_conversion_granel(detalle):
            for g in detalle.get("consumos_granel") or []:
                cant_g = int(g.get("cantidad") or 0)
                if cant_g <= 0:
                    continue
                kg_g = KG_POR_PRESENTACION.get("rpc_granel", 22) * cant_g
                talla_g = g.get("talla")
                talla_g = str(talla_g) if talla_g is not None and str(talla_g).strip() else None
                key_g = ("rpc_granel", talla_g)
                agg_pres[key_g]["cajas"] -= cant_g
                agg_pres[key_g]["kg"] -= kg_g
                kg1_total -= kg_g
                if talla_g:
                    kg_por_talla[talla_g] -= kg_g
                    cajas_por_talla[talla_g] -= cant_g
            for p in produccion or []:
                pres = p.get("presentacion") or ""
                cant = int(p.get("cantidad") or 0)
                if cant <= 0 or not pres:
                    continue
                talla = p.get("talla") if pres != "bins_jugo" else None
                if talla is not None:
                    talla = str(talla)
                kg_unit = KG_POR_PRESENTACION.get(pres, 0)
                kg = kg_unit * cant
                key = (pres, talla)
                agg_pres[key]["cajas"] += cant
                agg_pres[key]["kg"] += kg
                if pres == "bins_jugo":
                    kg2_total += kg
                else:
                    kg1_total += kg
                    if talla:
                        kg_por_talla[talla] += kg
                        cajas_por_talla[talla] += cant
            continue

        bins = sum(int(c.get("bins") or 0) for c in consumos)
        if bins <= 0 and not produccion:
            continue
        bins_total += bins
        for p in produccion or []:
            pres = p.get("presentacion") or ""
            cant = int(p.get("cantidad") or 0)
            if cant <= 0 or not pres:
                continue
            talla = p.get("talla") if pres != "bins_jugo" else None
            if talla is not None:
                talla = str(talla)
            kg_unit = KG_POR_PRESENTACION.get(pres, 0)
            kg = kg_unit * cant
            key = (pres, talla)
            agg_pres[key]["cajas"] += cant
            agg_pres[key]["kg"] += kg
            if pres == "bins_jugo":
                kg2_total += kg
            else:
                kg1_total += kg
                if talla:
                    kg_por_talla[talla] += kg
                    cajas_por_talla[talla] += cant

    return agg_pres, bins_total, kg1_total, kg2_total, kg_por_talla, cajas_por_talla


def _por_talla_y_presentacion(
    empaques: list,
) -> tuple[list[TallaRendimiento], list[PresentacionRendimiento], FactoresProyeccion]:
    agg_pres, bins_total, kg1, kg2, kg_por_talla, cajas_por_talla = _iter_produccion_empaques(
        empaques
    )
    kg_entrada = bins_total * KG_BIN_CAMPO
    kg_salida = kg1 + kg2

    tallas: list[TallaRendimiento] = []
    for talla in sorted(kg_por_talla.keys(), key=lambda x: int(x) if str(x).isdigit() else 0):
        kg = kg_por_talla[talla]
        cajas = cajas_por_talla[talla]
        # parrillas approx: assume mix rpc/carton - use weighted: cajas / 45 as default for tallas
        parr = round(cajas / CAJAS_POR_PARRILLA_RPC, 2) if cajas else 0.0
        tallas.append(
            TallaRendimiento(
                talla=str(talla),
                cajas=cajas,
                kg=round(kg, 2),
                pct_de_primera=round((kg / kg1 * 100) if kg1 else 0.0, 2),
                pct_de_entrada=round((kg / kg_entrada * 100) if kg_entrada else 0.0, 2),
                parrillas=parr,
            )
        )

    presentaciones: list[PresentacionRendimiento] = []
    for (pres, talla), row in sorted(agg_pres.items(), key=lambda x: (x[0][0], x[0][1] or "")):
        presentaciones.append(
            PresentacionRendimiento(
                presentacion=pres,
                talla=talla,
                cajas=int(row["cajas"]),
                kg=round(row["kg"], 2),
                pct_de_salida=round((row["kg"] / kg_salida * 100) if kg_salida else 0.0, 2),
            )
        )

    cajas_por_bin = []
    for (pres, talla), row in sorted(agg_pres.items(), key=lambda x: (x[0][0], x[0][1] or "")):
        cajas_por_bin.append(
            {
                "presentacion": pres,
                "talla": talla,
                "cajas_por_bin": round(row["cajas"] / bins_total, 4) if bins_total else 0.0,
                "kg_por_bin": round(row["kg"] / bins_total, 4) if bins_total else 0.0,
            }
        )

    factores = FactoresProyeccion(
        bins_historicos=bins_total,
        kg_entrada_historico=round(kg_entrada, 2),
        pct_primera=round((kg1 / kg_entrada * 100) if kg_entrada else 0.0, 2),
        pct_segunda=round((kg2 / kg_entrada * 100) if kg_entrada else 0.0, 2),
        pct_recuperacion=round((kg_salida / kg_entrada * 100) if kg_entrada else 0.0, 2),
        kg_primera_por_bin=round(kg1 / bins_total, 4) if bins_total else 0.0,
        kg_segunda_por_bin=round(kg2 / bins_total, 4) if bins_total else 0.0,
        cajas_por_bin=cajas_por_bin,
        mix_tallas=tallas,
        con_datos=bins_total > 0 and (kg1 > 0 or kg2 > 0),
        nota=(
            None
            if bins_total > 0 and (kg1 > 0 or kg2 > 0)
            else "Sin histórico de empaque suficiente; no se puede proyectar aún."
        ),
    )
    return tallas, presentaciones, factores


def _parrillas_desde_cajas(presentacion: str, cantidad: float) -> tuple[int | None, int, int, str]:
    """
    Devuelve (cajas_por_parrilla, parrillas_enteras, cajas_sueltas, label).
    RPC 12/18 → 45; cartón 40 lbs → 63; bins jugo → 1 bin = 1 parrilla.
    """
    cajas = int(round(float(cantidad or 0)))
    if cajas < 0:
        cajas = 0
    if presentacion in ("rpc_12", "rpc_18"):
        div = CAJAS_POR_PARRILLA_RPC
    elif presentacion == "caja_40lbs":
        div = CAJAS_POR_PARRILLA_CARTON
    elif presentacion == "bins_jugo":
        # 1 bin jugo = 1 parrilla
        return 1, cajas, 0, f"{cajas} parrilla{'s' if cajas != 1 else ''}" if cajas else "0 parrillas"
    else:
        return None, 0, cajas, f"{cajas} cajas" if cajas else "0 cajas"

    parr = cajas // div
    sueltas = cajas % div
    if parr > 0 and sueltas > 0:
        label = f"{parr} parrilla{'s' if parr != 1 else ''} + {sueltas} cajas"
    elif parr > 0:
        label = f"{parr} parrilla{'s' if parr != 1 else ''}"
    elif sueltas > 0:
        label = f"{sueltas} cajas"
    else:
        label = "0"
    return div, parr, sueltas, label


def _unidad_con_parrillas(
    presentacion: str,
    talla: str | None,
    calidad: str,
    cantidad: float,
    kg: float,
) -> ProyeccionUnidad:
    div, parr, sueltas, label = _parrillas_desde_cajas(presentacion, cantidad)
    return ProyeccionUnidad(
        presentacion=presentacion,
        talla=talla,
        calidad=calidad,
        cantidad=round(cantidad, 1),
        kg=round(kg, 1),
        cajas_por_parrilla=div,
        parrillas_enteras=parr,
        cajas_sueltas=sueltas,
        parrillas_label=label,
    )


def _proyectar_unidades(bins: int, factores: FactoresProyeccion) -> list[ProyeccionUnidad]:
    if bins <= 0 or not factores.con_datos:
        return []
    out: list[ProyeccionUnidad] = []
    for row in factores.cajas_por_bin:
        pres = row.get("presentacion") or ""
        talla = row.get("talla")
        cpb = float(row.get("cajas_por_bin") or 0)
        kpb = float(row.get("kg_por_bin") or 0)
        cant = round(cpb * bins, 1)
        kg = round(kpb * bins, 1)
        if cant <= 0 and kg <= 0:
            continue
        out.append(
            _unidad_con_parrillas(
                pres,
                talla,
                "segunda" if pres == "bins_jugo" else "primera",
                cant,
                kg,
            )
        )
    return out


def _merge_unidades(lists: list[list[ProyeccionUnidad]]) -> list[ProyeccionUnidad]:
    acc: dict[tuple[str, str | None], dict] = defaultdict(
        lambda: {"cantidad": 0.0, "kg": 0.0, "calidad": "primera"}
    )
    for units in lists:
        for u in units:
            key = (u.presentacion, u.talla)
            acc[key]["cantidad"] += u.cantidad
            acc[key]["kg"] += u.kg
            acc[key]["calidad"] = u.calidad
    result = []
    for (pres, talla), row in sorted(acc.items(), key=lambda x: (x[0][0], x[0][1] or "")):
        result.append(
            _unidad_con_parrillas(
                pres,
                talla,
                row["calidad"],
                round(row["cantidad"], 1),
                round(row["kg"], 1),
            )
        )
    return result


@router.get("/rendimientos-limon", response_model=RendimientosLimonResponse)
def rendimientos_limon(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Rendimientos de limón:
    - % 1ra / % 2da y % por talla (principales)
    - bins por parrilla solo de 1ra
    - kg/ha, por corrida, por lote
    """
    todos = db.query(Empaque).order_by(Empaque.fecha.desc(), Empaque.id.desc()).all()
    empaques = [e for e in todos if _producto_es_limon(e.producto)]

    corridas: list[CorridaRendimiento] = []
    for e in empaques:
        consumos, produccion, anulado = _extract_empaque_detalle(e)
        if anulado:
            continue
        if not consumos and not produccion:
            continue

        detalle = _as_dict(e.detalle_corrida)
        # Conversión granel→final no es corrida de campo (evita doble conteo de 1ra)
        if _es_conversion_granel(detalle):
            continue
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
                hectareas=HECTAREAS_RANCHO,
            )
        )

    por_talla, por_pres, factores = _por_talla_y_presentacion(empaques)

    return RendimientosLimonResponse(
        corridas=corridas,
        por_lote=_rendimientos_por_lote(empaques),
        por_talla=por_talla,
        por_presentacion=por_pres,
        acumulado=_acumular(corridas, hectareas=HECTAREAS_RANCHO),
        hectareas=HECTAREAS_RANCHO,
        hectareas_por_lote=HECTAREAS_POR_LOTE,
        factores_proyeccion=factores,
    )


@router.get("/proyeccion-inventario", response_model=ProyeccionInventarioResponse)
def proyeccion_inventario(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Proyecta inventario final a partir de bins en desverdizado y fechas tentativas,
    usando factores acumulados del histórico de empaque (% 1ra/2da y mix de tallas).
    """
    todos = db.query(Empaque).order_by(Empaque.id.desc()).all()
    empaques = [e for e in todos if _producto_es_limon(e.producto)]
    _, _, factores = _por_talla_y_presentacion(empaques)

    desvs = (
        db.query(InventarioDesverdizado)
        .filter(
            InventarioDesverdizado.cantidad_bins > 0,
            InventarioDesverdizado.estado != "eliminado",
        )
        .order_by(InventarioDesverdizado.fecha_tentativa_salida.asc())
        .all()
    )
    desvs = [d for d in desvs if (d.cantidad_bins or 0) > 0 and (d.estado or "") != "eliminado"]

    por_lote: list[ProyeccionLoteItem] = []
    by_fecha: dict[str, dict] = defaultdict(
        lambda: {
            "bins": 0,
            "lotes": [],
            "units": [],
            "kg1": 0.0,
            "kg2": 0.0,
            "kg_e": 0.0,
        }
    )

    for d in desvs:
        bins = int(d.cantidad_bins or 0)
        if bins <= 0:
            continue
        kg_e = bins * KG_BIN_CAMPO
        kg1 = round(factores.kg_primera_por_bin * bins, 1) if factores.con_datos else 0.0
        kg2 = round(factores.kg_segunda_por_bin * bins, 1) if factores.con_datos else 0.0
        units = _proyectar_unidades(bins, factores)
        fecha_t = str(d.fecha_tentativa_salida) if d.fecha_tentativa_salida else ""
        item = ProyeccionLoteItem(
            lote=d.lote or "SIN_LOTE",
            bins=bins,
            fecha_recepcion=str(d.fecha_recepcion) if d.fecha_recepcion else "",
            fecha_tentativa_salida=fecha_t,
            estado=d.estado or "",
            kg_entrada=round(kg_e, 1),
            kg_primera=kg1,
            kg_segunda=kg2,
            kg_salida=round(kg1 + kg2, 1),
            unidades=units,
        )
        por_lote.append(item)
        if fecha_t:
            by_fecha[fecha_t]["bins"] += bins
            by_fecha[fecha_t]["lotes"].append(d.lote or "SIN_LOTE")
            by_fecha[fecha_t]["units"].append(units)
            by_fecha[fecha_t]["kg1"] += kg1
            by_fecha[fecha_t]["kg2"] += kg2
            by_fecha[fecha_t]["kg_e"] += kg_e

    por_fecha: list[ProyeccionPorFecha] = []
    for fecha, row in sorted(by_fecha.items(), key=lambda x: x[0]):
        por_fecha.append(
            ProyeccionPorFecha(
                fecha=fecha,
                bins=row["bins"],
                lotes=row["lotes"],
                kg_entrada=round(row["kg_e"], 1),
                kg_primera=round(row["kg1"], 1),
                kg_segunda=round(row["kg2"], 1),
                kg_salida=round(row["kg1"] + row["kg2"], 1),
                unidades=_merge_unidades(row["units"]),
            )
        )

    total_bins = sum(p.bins for p in por_lote)
    total_kg1 = round(sum(p.kg_primera for p in por_lote), 1)
    total_kg2 = round(sum(p.kg_segunda for p in por_lote), 1)
    unidades_totales = _merge_unidades([p.unidades for p in por_lote])

    # Stock actual limón
    stock_actual = []
    for item in db.query(InventarioFinal).all():
        pval = getattr(item.producto, "value", None) or str(item.producto)
        if "limon" not in str(pval).lower() and not (item.atributos_extra or {}).get("presentacion"):
            continue
        extra = item.atributos_extra or {}
        if not isinstance(extra, dict):
            extra = {}
        if (item.cantidad_stock or 0) <= 0:
            continue
        stock_actual.append(
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

    return ProyeccionInventarioResponse(
        factores=factores,
        por_lote=por_lote,
        por_fecha=por_fecha,
        total_bins_desverdizado=total_bins,
        total_kg_primera=total_kg1,
        total_kg_segunda=total_kg2,
        total_kg_salida=round(total_kg1 + total_kg2, 1),
        unidades_totales=unidades_totales,
        stock_actual=stock_actual,
    )


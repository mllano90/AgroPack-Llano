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
    CorridaPasoDetalle,
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
from app.utils.limon_inv import parse_detalle_corrida, norm_talla, norm_pres

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


def _resumen_consumos_granel(consumos_granel: list | None) -> str:
    """Texto legible de granel usado: 'granel 8500#75:100, granel 8500#95:150'."""
    parts: list[str] = []
    for g in consumos_granel or []:
        cant = int(g.get("cantidad") or 0)
        if cant <= 0:
            continue
        lote = str(g.get("lote") or "").strip() or "SIN_LOTE"
        talla = g.get("talla")
        talla_s = f"#{talla}" if talla is not None and str(talla).strip() != "" else ""
        fe = g.get("fecha_empaque")
        fe_s = f"@{fe}" if fe else ""
        parts.append(f"granel {lote}{talla_s}{fe_s}:{cant}")
    return ", ".join(parts)


def _split_produccion(produccion: list | None) -> dict:
    """Separa producción en final (RPC/cartón), granel WIP y jugo."""
    kg_rpc = 0.0
    kg_carton = 0.0
    kg_granel = 0.0
    kg_segunda = 0.0
    cajas_rpc = 0
    cajas_carton = 0
    bins_jugo = 0
    rpc_granel_producido = 0
    for p in produccion or []:
        pres = p.get("presentacion") or ""
        cant = int(p.get("cantidad") or 0)
        if cant <= 0:
            continue
        kg = KG_POR_PRESENTACION.get(pres, 0) * cant
        if pres == "bins_jugo":
            kg_segunda += kg
            bins_jugo += cant
        elif pres == "rpc_granel":
            kg_granel += kg
            rpc_granel_producido += cant
        elif pres in ("rpc_12", "rpc_18"):
            kg_rpc += kg
            cajas_rpc += cant
        elif pres == "caja_40lbs":
            kg_carton += kg
            cajas_carton += cant
        else:
            # desconocido con peso → final 1ra
            kg_rpc += kg
    kg_final = kg_rpc + kg_carton
    return {
        "kg_rpc": kg_rpc,
        "kg_carton": kg_carton,
        "kg_granel": kg_granel,
        "kg_segunda": kg_segunda,
        "kg_final": kg_final,
        "cajas_rpc": cajas_rpc,
        "cajas_carton": cajas_carton,
        "bins_jugo": bins_jugo,
        "rpc_granel_producido": rpc_granel_producido,
    }


def _calcular_rendimiento(
    *,
    id: int,
    fecha: str,
    numero_empacador: str | None,
    consumos: list,
    produccion: list,
    lotes_resumen: str | None = None,
    hectareas: float = HECTAREAS_RANCHO,
    tipo_corrida: str = "campo",
    consumos_granel: list | None = None,
    pasos: list | None = None,
    ids_empaques: list[int] | None = None,
) -> CorridaRendimiento:
    """
    kg_primera = solo producto FINAL (RPC/cartón). El granel es WIP y no suma a 1ra.
    tipo_corrida:
      - campo / proceso: entrada = bins × 260
      - conversion_granel: entrada = granel × 22 (solo si va suelta, sin fusionar)
    """
    rpc_granel_usado = 0
    if tipo_corrida == "conversion_granel":
        bins_campo = 0
        rpc_granel_usado = sum(int(g.get("cantidad") or 0) for g in (consumos_granel or []))
        kg_entrada = rpc_granel_usado * KG_POR_PRESENTACION.get("rpc_granel", 22)
        if not lotes_resumen:
            lotes_resumen = _resumen_consumos_granel(consumos_granel) or "conversión granel"
    else:
        bins_campo = sum(int(c.get("bins") or 0) for c in (consumos or []))
        kg_entrada = bins_campo * KG_BIN_CAMPO

    sp = _split_produccion(produccion)
    # Solo final en kg 1ra (no granel WIP)
    kg_primera = float(sp["kg_final"])
    kg_segunda = float(sp["kg_segunda"])
    kg_rpc = float(sp["kg_rpc"])
    kg_carton = float(sp["kg_carton"])
    kg_granel = float(sp["kg_granel"]) if tipo_corrida != "conversion_granel" else 0.0
    cajas_rpc = int(sp["cajas_rpc"])
    cajas_carton = int(sp["cajas_carton"])
    bins_jugo = int(sp["bins_jugo"])
    rpc_granel_producido = (
        int(sp["rpc_granel_producido"]) if tipo_corrida != "conversion_granel" else 0
    )
    if tipo_corrida == "conversion_granel":
        # En conversión el "granel" informativo es el consumido
        kg_granel = rpc_granel_usado * KG_POR_PRESENTACION.get("rpc_granel", 22)

    kg_salida = kg_primera + kg_segunda
    pct_primera = round((kg_primera / kg_entrada * 100) if kg_entrada else 0.0, 2)
    pct_segunda = round((kg_segunda / kg_entrada * 100) if kg_entrada else 0.0, 2)
    pct_recuperacion = round((kg_salida / kg_entrada * 100) if kg_entrada else 0.0, 2)
    pct_rpc_de_primera = round((kg_rpc / kg_primera * 100) if kg_primera else 0.0, 2)
    pct_carton_de_primera = round((kg_carton / kg_primera * 100) if kg_primera else 0.0, 2)

    parrillas_rpc = round(cajas_rpc / CAJAS_POR_PARRILLA_RPC, 2) if cajas_rpc else 0.0
    parrillas_carton = round(cajas_carton / CAJAS_POR_PARRILLA_CARTON, 2) if cajas_carton else 0.0
    parrillas_jugo = float(bins_jugo)
    parrillas_primera = round(parrillas_rpc + parrillas_carton, 2)
    parrillas_total = round(parrillas_primera + parrillas_jugo, 2)
    bins_por_parrilla = (
        round(bins_campo / parrillas_primera, 2)
        if tipo_corrida in ("campo", "proceso") and parrillas_primera > 0 and bins_campo > 0
        else None
    )
    use_ha = hectareas if tipo_corrida in ("campo", "proceso") else 0.0
    kg_g_prod = float(sp["kg_granel"]) if tipo_corrida != "conversion_granel" else 0.0
    kg_pend = max(0.0, kg_g_prod - (rpc_granel_usado * KG_POR_PRESENTACION.get("rpc_granel", 22)))

    return CorridaRendimiento(
        id=id,
        fecha=fecha,
        numero_empacador=numero_empacador,
        tipo_corrida=tipo_corrida,
        bins_campo=bins_campo,
        rpc_granel_usado=rpc_granel_usado,
        rpc_granel_producido=rpc_granel_producido,
        kg_granel_pendiente=round(kg_pend, 2),
        kg_entrada=round(kg_entrada, 2),
        kg_primera=round(kg_primera, 2),
        kg_segunda=round(kg_segunda, 2),
        kg_salida=round(kg_salida, 2),
        pct_primera=pct_primera,
        pct_segunda=pct_segunda,
        pct_recuperacion=pct_recuperacion,
        kg_rpc=round(kg_rpc, 2),
        kg_carton=round(kg_carton, 2),
        kg_granel=round(kg_g_prod if tipo_corrida != "conversion_granel" else kg_granel, 2),
        pct_rpc_de_primera=pct_rpc_de_primera,
        pct_carton_de_primera=pct_carton_de_primera,
        pct_granel_de_primera=0.0,
        cajas_rpc=cajas_rpc,
        cajas_carton=cajas_carton,
        bins_jugo=bins_jugo,
        parrillas_rpc=parrillas_rpc,
        parrillas_carton=parrillas_carton,
        parrillas_jugo=parrillas_jugo,
        parrillas_primera=parrillas_primera,
        parrillas_total=parrillas_total,
        bins_por_parrilla=bins_por_parrilla,
        kg_por_ha=_kg_por_ha(kg_salida, use_ha) if use_ha else None,
        kg_primera_por_ha=_kg_por_ha(kg_primera, use_ha) if use_ha else None,
        kg_segunda_por_ha=_kg_por_ha(kg_segunda, use_ha) if use_ha else None,
        lotes_resumen=lotes_resumen,
        pasos=list(pasos or []),
        ids_empaques=list(ids_empaques or [id]),
    )


def _paso_desde_empaque(e, detalle: dict | None, consumos: list, produccion: list) -> CorridaPasoDetalle:
    """Construye un paso de desglose a partir de un registro de empaque."""
    fecha = str(e.fecha) if e.fecha else ""
    if _es_conversion_granel(detalle):
        cg = list((detalle or {}).get("consumos_granel") or [])
        g_cant = sum(int(x.get("cantidad") or 0) for x in cg)
        kg_g = g_cant * KG_POR_PRESENTACION.get("rpc_granel", 22)
        sp = _split_produccion(produccion)
        return CorridaPasoDetalle(
            empaque_id=e.id,
            fecha=fecha,
            tipo="conversion_granel",
            titulo=f"Conversión granel → final (empaque #{e.id})",
            bins_campo=0,
            rpc_granel_producido=0,
            rpc_granel_usado=g_cant,
            kg_entrada=round(kg_g, 2),
            kg_rpc=round(sp["kg_rpc"], 2),
            kg_carton=round(sp["kg_carton"], 2),
            kg_granel=round(kg_g, 2),
            kg_primera_final=round(sp["kg_final"], 2),
            kg_segunda=round(sp["kg_segunda"], 2),
            cajas_rpc=int(sp["cajas_rpc"]),
            cajas_carton=int(sp["cajas_carton"]),
            bins_jugo=int(sp["bins_jugo"]),
            lotes_resumen=_resumen_consumos_granel(cg),
            notas=(
                f"Se usaron {g_cant} RPC a granel ({kg_g:.0f} kg) y se obtuvieron "
                f"{sp['kg_final']:.0f} kg de producto final."
            ),
        )

    bins = sum(int(c.get("bins") or 0) for c in consumos)
    sp = _split_produccion(produccion)
    lotes = None
    if detalle:
        lotes = detalle.get("lotes_resumen")
    if not lotes:
        lotes = ", ".join(
            f"{c.get('lote')}:{c.get('bins')}" for c in consumos if c.get("lote")
        ) or e.lote_desverdizado
    return CorridaPasoDetalle(
        empaque_id=e.id,
        fecha=fecha,
        tipo="campo",
        titulo=f"Empaque de campo (empaque #{e.id})",
        bins_campo=bins,
        rpc_granel_producido=int(sp["rpc_granel_producido"]),
        rpc_granel_usado=0,
        kg_entrada=round(bins * KG_BIN_CAMPO, 2),
        kg_rpc=round(sp["kg_rpc"], 2),
        kg_carton=round(sp["kg_carton"], 2),
        kg_granel=round(sp["kg_granel"], 2),
        kg_primera_final=round(sp["kg_final"], 2),
        kg_segunda=round(sp["kg_segunda"], 2),
        cajas_rpc=int(sp["cajas_rpc"]),
        cajas_carton=int(sp["cajas_carton"]),
        bins_jugo=int(sp["bins_jugo"]),
        lotes_resumen=lotes,
        notas=(
            f"De {bins} bins de campo: {sp['kg_final']:.0f} kg producto final "
            f"(RPC {sp['kg_rpc']:.0f} + cartón {sp['kg_carton']:.0f})"
            + (
                f" y {sp['rpc_granel_producido']} RPC a granel ({sp['kg_granel']:.0f} kg) "
                f"para procesar después."
                if sp["rpc_granel_producido"]
                else "."
            )
        ),
    )


def _clave_granel(lote, fecha_empaque, talla=None) -> tuple:
    lote_s = str(lote or "").strip() or "SIN_LOTE"
    fe = str(fecha_empaque or "").strip()[:10]
    return (lote_s, fe)


def _fusionar_procesos_empaque(empaques: list) -> list[CorridaRendimiento]:
    """
    Fusiona empaque de campo + conversiones de su granel en UN proceso.

    kg_primera del proceso = solo producto final (día campo + conversiones).
    El granel intermedio NO suma a 1ra; queda en pasos y kg_granel / pendiente.
    """
    campo_rows: list[dict] = []
    conv_rows: list[dict] = []

    for e in empaques:
        consumos, produccion, anulado = _extract_empaque_detalle(e)
        if anulado:
            continue
        detalle = _as_dict(e.detalle_corrida)
        if _es_conversion_granel(detalle):
            cg = list((detalle or {}).get("consumos_granel") or [])
            if not cg and not produccion:
                continue
            conv_rows.append(
                {
                    "e": e,
                    "detalle": detalle,
                    "consumos": consumos,
                    "produccion": produccion,
                    "cg": cg,
                    "paso": _paso_desde_empaque(e, detalle, consumos, produccion),
                }
            )
            continue
        if not consumos and not produccion:
            continue
        paso = _paso_desde_empaque(e, detalle, consumos, produccion)
        # Índice de granel producido: (lote, fecha_empaque) → field id
        keys = set()
        for p in produccion or []:
            if (p.get("presentacion") or "") != "rpc_granel":
                continue
            if int(p.get("cantidad") or 0) <= 0:
                continue
            fe = p.get("fecha_empaque") or (str(e.fecha) if e.fecha else "")
            keys.add(_clave_granel(p.get("lote") or e.lote_desverdizado, fe))
        campo_rows.append(
            {
                "e": e,
                "detalle": detalle,
                "consumos": consumos,
                "produccion": produccion,
                "paso": paso,
                "granel_keys": keys,
                "conv_attached": [],
            }
        )

    # Asignar cada conversión al empaque de campo que produjo ese granel
    used_conv: set[int] = set()
    for cr in conv_rows:
        matched_field = None
        for g in cr["cg"]:
            key = _clave_granel(g.get("lote"), g.get("fecha_empaque") or "")
            for fr in campo_rows:
                if key in fr["granel_keys"] or (
                    key[0] != "SIN_LOTE"
                    and any(k[0] == key[0] and (not key[1] or k[1] == key[1]) for k in fr["granel_keys"])
                ):
                    matched_field = fr
                    break
            if matched_field:
                break
        # Fallback: mismo lote en consumos de campo
        if not matched_field and cr["cg"]:
            lote0 = str(cr["cg"][0].get("lote") or "").strip()
            for fr in campo_rows:
                for c in fr["consumos"]:
                    if str(c.get("lote") or "").strip() == lote0:
                        matched_field = fr
                        break
                if matched_field:
                    break
        if matched_field:
            matched_field["conv_attached"].append(cr)
            used_conv.add(cr["e"].id)

    result: list[CorridaRendimiento] = []

    for fr in campo_rows:
        e = fr["e"]
        paso_campo: CorridaPasoDetalle = fr["paso"]
        pasos: list[CorridaPasoDetalle] = [paso_campo]
        ids = [e.id]
        kg_rpc = paso_campo.kg_rpc
        kg_carton = paso_campo.kg_carton
        kg_segunda = paso_campo.kg_segunda
        cajas_rpc = paso_campo.cajas_rpc
        cajas_carton = paso_campo.cajas_carton
        bins_jugo = paso_campo.bins_jugo
        g_prod = paso_campo.rpc_granel_producido
        g_used = 0
        kg_g_prod = paso_campo.kg_granel

        for cr in fr["conv_attached"]:
            p = cr["paso"]
            pasos.append(p)
            ids.append(cr["e"].id)
            kg_rpc += p.kg_rpc
            kg_carton += p.kg_carton
            kg_segunda += p.kg_segunda
            cajas_rpc += p.cajas_rpc
            cajas_carton += p.cajas_carton
            bins_jugo += p.bins_jugo
            g_used += p.rpc_granel_usado

        kg_primera = kg_rpc + kg_carton  # SOLO final
        bins_campo = paso_campo.bins_campo
        kg_entrada = bins_campo * KG_BIN_CAMPO
        kg_salida = kg_primera + kg_segunda
        kg_pend = max(0.0, kg_g_prod - g_used * KG_POR_PRESENTACION.get("rpc_granel", 22))
        tiene_conv = len(fr["conv_attached"]) > 0
        tipo = "proceso" if tiene_conv else "campo"

        fechas = [paso_campo.fecha] + [p.fecha for p in pasos[1:] if p.fecha]
        fechas_u = []
        for f in fechas:
            if f and f not in fechas_u:
                fechas_u.append(f)
        fecha_txt = fechas_u[0] if len(fechas_u) <= 1 else f"{fechas_u[0]} → {fechas_u[-1]}"

        parrillas_rpc = round(cajas_rpc / CAJAS_POR_PARRILLA_RPC, 2) if cajas_rpc else 0.0
        parrillas_carton = (
            round(cajas_carton / CAJAS_POR_PARRILLA_CARTON, 2) if cajas_carton else 0.0
        )
        parrillas_primera = round(parrillas_rpc + parrillas_carton, 2)
        parrillas_jugo = float(bins_jugo)
        parrillas_total = round(parrillas_primera + parrillas_jugo, 2)

        lotes = paso_campo.lotes_resumen
        if tiene_conv:
            lotes = (lotes or "") + f" · +{len(fr['conv_attached'])} conversión(es) granel"

        result.append(
            CorridaRendimiento(
                id=e.id,
                fecha=fecha_txt,
                numero_empacador=e.numero_empacador,
                tipo_corrida=tipo,
                bins_campo=bins_campo,
                rpc_granel_usado=g_used,
                rpc_granel_producido=g_prod,
                kg_granel_pendiente=round(kg_pend, 2),
                kg_entrada=round(kg_entrada, 2),
                kg_primera=round(kg_primera, 2),
                kg_segunda=round(kg_segunda, 2),
                kg_salida=round(kg_salida, 2),
                pct_primera=round((kg_primera / kg_entrada * 100) if kg_entrada else 0.0, 2),
                pct_segunda=round((kg_segunda / kg_entrada * 100) if kg_entrada else 0.0, 2),
                pct_recuperacion=round((kg_salida / kg_entrada * 100) if kg_entrada else 0.0, 2),
                kg_rpc=round(kg_rpc, 2),
                kg_carton=round(kg_carton, 2),
                kg_granel=round(kg_g_prod, 2),
                pct_rpc_de_primera=round((kg_rpc / kg_primera * 100) if kg_primera else 0.0, 2),
                pct_carton_de_primera=round(
                    (kg_carton / kg_primera * 100) if kg_primera else 0.0, 2
                ),
                pct_granel_de_primera=0.0,
                cajas_rpc=cajas_rpc,
                cajas_carton=cajas_carton,
                bins_jugo=bins_jugo,
                parrillas_rpc=parrillas_rpc,
                parrillas_carton=parrillas_carton,
                parrillas_jugo=parrillas_jugo,
                parrillas_primera=parrillas_primera,
                parrillas_total=parrillas_total,
                bins_por_parrilla=(
                    round(bins_campo / parrillas_primera, 2)
                    if parrillas_primera > 0 and bins_campo > 0
                    else None
                ),
                kg_por_ha=_kg_por_ha(kg_salida, HECTAREAS_RANCHO),
                kg_primera_por_ha=_kg_por_ha(kg_primera, HECTAREAS_RANCHO),
                kg_segunda_por_ha=_kg_por_ha(kg_segunda, HECTAREAS_RANCHO),
                lotes_resumen=lotes,
                pasos=pasos,
                ids_empaques=ids,
            )
        )

    # Conversiones sin campo asociado (huérfanas)
    for cr in conv_rows:
        if cr["e"].id in used_conv:
            continue
        e = cr["e"]
        result.append(
            _calcular_rendimiento(
                id=e.id,
                fecha=str(e.fecha) if e.fecha else "",
                numero_empacador=e.numero_empacador,
                consumos=[],
                produccion=cr["produccion"],
                lotes_resumen=_resumen_consumos_granel(cr["cg"]),
                tipo_corrida="conversion_granel",
                consumos_granel=cr["cg"],
                pasos=[cr["paso"]],
                ids_empaques=[e.id],
            )
        )

    # Orden: más reciente primero (por fecha del primer paso / id)
    result.sort(key=lambda c: (c.fecha or "", c.id), reverse=True)
    return result


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
        tipo_corrida="campo",
        bins_campo=bins_campo,
        rpc_granel_usado=sum(getattr(c, "rpc_granel_usado", 0) or 0 for c in corridas),
        rpc_granel_producido=sum(getattr(c, "rpc_granel_producido", 0) or 0 for c in corridas),
        kg_granel_pendiente=round(
            sum(getattr(c, "kg_granel_pendiente", 0) or 0 for c in corridas), 2
        ),
        kg_entrada=round(kg_entrada, 2),
        kg_primera=round(kg_primera, 2),
        kg_segunda=round(kg_segunda, 2),
        kg_salida=round(kg_salida, 2),
        pct_primera=round((kg_primera / kg_entrada * 100) if kg_entrada else 0.0, 2),
        pct_segunda=round((kg_segunda / kg_entrada * 100) if kg_entrada else 0.0, 2),
        pct_recuperacion=round((kg_salida / kg_entrada * 100) if kg_entrada else 0.0, 2),
        kg_rpc=round(kg_rpc, 2),
        kg_carton=round(kg_carton, 2),
        kg_granel=round(sum(getattr(c, "kg_granel", 0) or 0 for c in corridas), 2),
        pct_rpc_de_primera=round((kg_rpc / kg_primera * 100) if kg_primera else 0.0, 2),
        pct_carton_de_primera=round((kg_carton / kg_primera * 100) if kg_primera else 0.0, 2),
        pct_granel_de_primera=0.0,
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
        lotes_resumen=f"{len(corridas)} procesos",
        pasos=[],
        ids_empaques=[],
    )


def _kg_y_unidades_produccion(produccion: list) -> dict:
    """Suma kg 1ra/2da FINAL (sin granel WIP) y unidades."""
    sp = _split_produccion(produccion)
    return {
        "kg_primera": sp["kg_final"],  # solo RPC/cartón
        "kg_segunda": sp["kg_segunda"],
        "cajas_rpc": sp["cajas_rpc"],
        "cajas_carton": sp["cajas_carton"],
        "bins_jugo": sp["bins_jugo"],
    }


def _as_dict(val) -> dict | None:
    """Normaliza JSON de detalle_corrida (dict o string) vía util compartida."""
    if val is None:
        return None
    if isinstance(val, dict):
        return val
    d = parse_detalle_corrida(val)
    return d if d else None


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

    # Usar procesos fusionados: kg 1ra = final de campo + final de conversiones
    for proc in _fusionar_procesos_empaque(empaques):
        if (proc.tipo_corrida or "") == "conversion_granel":
            # Huérfana sin bins de campo: no entra a por-lote de campo
            continue
        # Lotes desde el paso de campo
        paso_campo = next((p for p in proc.pasos if p.tipo == "campo"), None)
        lotes_txt = (paso_campo.lotes_resumen if paso_campo else proc.lotes_resumen) or ""
        # Parse "LOTE:bins, LOTE2:bins"
        consumos_ok = []
        for part in lotes_txt.replace("·", ",").split(","):
            part = part.strip()
            if "conversión" in part.lower() or part.lower().startswith("granel"):
                continue
            if ":" in part:
                lote_s, bins_s = part.rsplit(":", 1)
                try:
                    b = int(float(bins_s.strip()))
                except ValueError:
                    continue
                if b > 0:
                    consumos_ok.append({"lote": lote_s.strip(), "bins": b})
        if not consumos_ok and proc.bins_campo > 0:
            consumos_ok = [{"lote": "SIN_LOTE", "bins": proc.bins_campo}]
        total_bins = sum(int(c["bins"]) for c in consumos_ok) or 0
        if total_bins <= 0:
            continue
        multi_lote = len({c["lote"] for c in consumos_ok}) > 1
        for c in consumos_ok:
            lote = c["lote"] or "SIN_LOTE"
            bins = int(c["bins"])
            share = bins / total_bins
            row = acc[lote]
            row["bins_campo"] += bins
            row["kg_primera"] += proc.kg_primera * share
            row["kg_segunda"] += proc.kg_segunda * share
            row["cajas_rpc"] += proc.cajas_rpc * share
            row["cajas_carton"] += proc.cajas_carton * share
            row["bins_jugo"] += proc.bins_jugo * share
            row["corrida_ids"].add(proc.id)
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
                lote=(str(extra["lote"]).strip() if extra.get("lote") else None),
                fecha_empaque=(
                    str(extra["fecha_empaque"]).strip()[:10]
                    if extra.get("fecha_empaque")
                    else None
                ),
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

    # Inventario en Desverdizado: orden por fecha de corte (más antiguo primero)
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
            # Solo suma producto final de la conversión (el granel no contó en kg1)
            for p in produccion or []:
                pres = norm_pres(p.get("presentacion")) or ""
                cant = int(p.get("cantidad") or 0)
                if cant <= 0 or not pres or pres == "rpc_granel":
                    continue
                talla = norm_talla(pres, p.get("talla"))
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
            # Solo producto final en kg 1ra; granel WIP se omite (sale en conversión)
            if pres == "rpc_granel":
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

    # Campo + conversiones de su granel = una sola fila de proceso (kg 1ra = solo final)
    corridas = _fusionar_procesos_empaque(empaques)

    por_talla, por_pres, factores = _por_talla_y_presentacion(empaques)

    # Acumulado: procesos con bins de campo (excluye conversiones huérfanas)
    corridas_proceso = [
        c for c in corridas if (c.tipo_corrida or "campo") != "conversion_granel"
    ]

    return RendimientosLimonResponse(
        corridas=corridas,
        por_lote=_rendimientos_por_lote(empaques),
        por_talla=por_talla,
        por_presentacion=por_pres,
        acumulado=_acumular(corridas_proceso, hectareas=HECTAREAS_RANCHO),
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
                lote=(str(extra["lote"]).strip() if extra.get("lote") else None),
                fecha_empaque=(
                    str(extra["fecha_empaque"]).strip()[:10]
                    if extra.get("fecha_empaque")
                    else None
                ),
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


from pydantic import BaseModel
from app.models.enums import VariedadUva, TipoCultivo, TipoMercado, Producto
from typing import List

class InventarioCampoItem(BaseModel):
    variedad: VariedadUva
    mercado: TipoMercado
    cantidad: int

class InventarioFinalItem(BaseModel):
    producto: Producto
    variedad: VariedadUva | None = None
    tipo_cultivo: TipoCultivo | None = None
    mercado: TipoMercado
    cantidad_stock: int
    # For limón (and future products)
    presentacion: str | None = None
    calidad: str | None = None
    talla: str | None = None
    lote: str | None = None  # origen de campo (esp. rpc_granel)
    fecha_empaque: str | None = None  # día en que se empacó el granel

class DesverdizadoItem(BaseModel):
    lote: str
    cantidad_bins_disponibles: int
    fecha_recepcion: str
    fecha_tentativa_salida: str
    estado: str

class DashboardResponse(BaseModel):
    inventario_final: List[InventarioFinalItem]
    inventario_campo: List[InventarioCampoItem]
    desverdizado: List[DesverdizadoItem] = []
    embarques_recientes: List[dict] = []


class CorridaPasoDetalle(BaseModel):
    """Un paso del proceso (día de campo o conversión granel→final)."""
    empaque_id: int
    fecha: str
    # "campo" | "conversion_granel"
    tipo: str
    titulo: str = ""
    bins_campo: int = 0
    rpc_granel_producido: int = 0
    rpc_granel_usado: int = 0
    kg_entrada: float = 0.0  # bins×260 o granel×22
    kg_rpc: float = 0.0
    kg_carton: float = 0.0
    kg_granel: float = 0.0  # producido (campo) o consumido (conversión)
    kg_primera_final: float = 0.0  # solo producto final de este paso
    kg_segunda: float = 0.0
    cajas_rpc: int = 0
    cajas_carton: int = 0
    bins_jugo: int = 0
    lotes_resumen: str | None = None
    notas: str | None = None


class CorridaRendimiento(BaseModel):
    """Rendimiento de una corrida / proceso de empaque de limón.

    En vista fusionada (campo + conversiones del granel residual), kg_primera
    solo incluye producto FINAL (RPC/cartón), no el WIP a granel.
    """
    id: int
    fecha: str
    numero_empacador: str | None = None
    # "campo" | "conversion_granel" | "proceso" (campo + 1+ conversiones fusionadas)
    tipo_corrida: str = "campo"
    bins_campo: int
    # RPC a granel consumidos (conversiones del proceso)
    rpc_granel_usado: int = 0
    # RPC a granel producidos el día de campo (WIP)
    rpc_granel_producido: int = 0
    # Granel aún no convertido (producido − usado), kg
    kg_granel_pendiente: float = 0.0
    kg_entrada: float
    kg_primera: float  # solo final (RPC+cartón) del proceso completo
    kg_segunda: float
    kg_salida: float
    pct_primera: float  # vs bins de campo (proceso) o vs granel (conversión suelta)
    pct_segunda: float
    pct_recuperacion: float  # (1ra+2da) / entrada
    # Desglose 1ra FINAL del proceso
    kg_rpc: float = 0.0
    kg_carton: float = 0.0
    kg_granel: float = 0.0  # WIP producido en campo (informativo; no va en kg_primera)
    pct_rpc_de_primera: float = 0.0
    pct_carton_de_primera: float = 0.0
    pct_granel_de_primera: float = 0.0  # legacy; suele 0 en resumen fusionado
    cajas_rpc: int  # rpc_12 + rpc_18
    cajas_carton: int  # caja_40lbs
    bins_jugo: int
    parrillas_rpc: float  # cajas_rpc / 45
    parrillas_carton: float  # cajas_carton / 63
    parrillas_jugo: float  # 1 bin jugo = 1 parrilla (2da)
    parrillas_primera: float = 0.0  # solo 1ra final: RPC + cartón
    parrillas_total: float
    bins_por_parrilla: float | None = None
    kg_por_ha: float | None = None
    kg_primera_por_ha: float | None = None
    kg_segunda_por_ha: float | None = None
    lotes_resumen: str | None = None
    # Pasos del proceso (campo + conversiones) para desglose al expandir
    pasos: list[CorridaPasoDetalle] = []
    ids_empaques: list[int] = []  # empaques que componen este proceso


class LoteRendimiento(BaseModel):
    """Rendimiento acumulado por lote de campo (limón)."""
    lote: str
    bins_campo: int
    kg_entrada: float
    kg_primera: float
    kg_segunda: float
    kg_salida: float  # 1ra + 2da (kg totales producidos)
    pct_primera: float
    pct_segunda: float
    pct_recuperacion: float
    cajas_rpc: int
    cajas_carton: int
    bins_jugo: int
    parrillas_primera: float = 0.0
    parrillas_total: float
    bins_por_parrilla: float | None = None  # bins / parrillas 1ra
    # kg/ha por lote: kg / HECTAREAS_POR_LOTE (8 ha por lote)
    kg_por_ha: float | None = None
    kg_primera_por_ha: float | None = None
    kg_segunda_por_ha: float | None = None
    num_corridas: int  # empaques donde participó este lote
    prorrateado: bool = False  # True si alguna corrida mezcló lotes


class TallaRendimiento(BaseModel):
    """Distribución por talla (1ra calidad) sobre corridas acumuladas."""
    talla: str
    cajas: int = 0  # rpc + cartón de esa talla
    kg: float = 0.0
    pct_de_primera: float = 0.0  # % del kg 1ra
    pct_de_entrada: float = 0.0  # % del kg de campo
    parrillas: float = 0.0


class PresentacionRendimiento(BaseModel):
    presentacion: str
    talla: str | None = None
    cajas: int = 0
    kg: float = 0.0
    pct_de_salida: float = 0.0  # % del kg 1ra+2da


class FactoresProyeccion(BaseModel):
    """Factores derivados del histórico de empaque (por bin de campo)."""
    bins_historicos: int = 0
    kg_entrada_historico: float = 0.0
    pct_primera: float = 0.0
    pct_segunda: float = 0.0
    pct_recuperacion: float = 0.0
    kg_primera_por_bin: float = 0.0
    kg_segunda_por_bin: float = 0.0
    # cajas por bin de campo, por presentación+talla
    cajas_por_bin: List[dict] = []  # [{presentacion, talla, cajas_por_bin, kg_por_bin}]
    # mix de tallas 1ra (% del kg 1ra)
    mix_tallas: List[TallaRendimiento] = []
    con_datos: bool = False
    nota: str | None = None


class ProyeccionUnidad(BaseModel):
    presentacion: str
    talla: str | None = None
    calidad: str = "primera"
    cantidad: float  # cajas o bins jugo proyectados
    kg: float
    # Parrillas: RPC=45 cajas, cartón=63; jugo: 1 bin = 1 parrilla
    cajas_por_parrilla: int | None = None
    parrillas_enteras: int = 0
    cajas_sueltas: int = 0
    parrillas_label: str = ""  # ej. "2 parrillas + 10 cajas"


class ProyeccionLoteItem(BaseModel):
    lote: str
    bins: int
    fecha_recepcion: str
    fecha_tentativa_salida: str
    estado: str
    kg_entrada: float
    kg_primera: float
    kg_segunda: float
    kg_salida: float
    unidades: List[ProyeccionUnidad] = []


class ProyeccionPorFecha(BaseModel):
    fecha: str  # fecha tentativa de salida de desverdizado
    bins: int
    lotes: List[str] = []
    kg_entrada: float
    kg_primera: float
    kg_segunda: float
    kg_salida: float
    unidades: List[ProyeccionUnidad] = []


class ProyeccionInventarioResponse(BaseModel):
    factores: FactoresProyeccion
    por_lote: List[ProyeccionLoteItem] = []
    por_fecha: List[ProyeccionPorFecha] = []
    total_bins_desverdizado: int = 0
    total_kg_primera: float = 0.0
    total_kg_segunda: float = 0.0
    total_kg_salida: float = 0.0
    unidades_totales: List[ProyeccionUnidad] = []
    stock_actual: List[InventarioFinalItem] = []


class RendimientosLimonResponse(BaseModel):
    corridas: List[CorridaRendimiento]
    por_lote: List[LoteRendimiento] = []
    por_talla: List[TallaRendimiento] = []
    por_presentacion: List[PresentacionRendimiento] = []
    acumulado: CorridaRendimiento
    hectareas: float = 64.0  # rancho total (acumulado / corrida)
    hectareas_por_lote: float = 8.0  # superficie por lote para kg/ha por lote
    factores_proyeccion: FactoresProyeccion | None = None

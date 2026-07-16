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


class CorridaRendimiento(BaseModel):
    """Rendimiento de una corrida de empaque de limón."""
    id: int
    fecha: str
    numero_empacador: str | None = None
    bins_campo: int
    kg_entrada: float
    kg_primera: float
    kg_segunda: float
    kg_salida: float
    pct_primera: float  # % del peso de campo (dato principal)
    pct_segunda: float
    pct_recuperacion: float  # (1ra+2da) / entrada
    cajas_rpc: int  # rpc_12 + rpc_18
    cajas_carton: int  # caja_40lbs
    bins_jugo: int
    parrillas_rpc: float  # cajas_rpc / 45
    parrillas_carton: float  # cajas_carton / 63
    parrillas_jugo: float  # 1 bin jugo = 1 parrilla (2da)
    parrillas_primera: float = 0.0  # solo 1ra: RPC + cartón
    parrillas_total: float
    # bins campo / parrillas de 1ra (NO incluye bins jugo)
    bins_por_parrilla: float | None = None
    kg_por_ha: float | None = None  # kg salida / hectareas del rancho
    kg_primera_por_ha: float | None = None
    kg_segunda_por_ha: float | None = None
    lotes_resumen: str | None = None


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
    hectareas: float = 64.0
    factores_proyeccion: FactoresProyeccion | None = None

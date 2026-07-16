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
    pct_primera: float  # % del peso de campo
    pct_segunda: float
    pct_recuperacion: float  # (1ra+2da) / entrada
    cajas_rpc: int  # rpc_12 + rpc_18
    cajas_carton: int  # caja_40lbs
    bins_jugo: int
    parrillas_rpc: float  # cajas_rpc / 45
    parrillas_carton: float  # cajas_carton / 63
    parrillas_jugo: float  # 1 bin jugo = 1 parrilla
    parrillas_total: float
    bins_por_parrilla: float | None = None  # bins campo / parrillas
    lotes_resumen: str | None = None


class RendimientosLimonResponse(BaseModel):
    corridas: List[CorridaRendimiento]
    acumulado: CorridaRendimiento

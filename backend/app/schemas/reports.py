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

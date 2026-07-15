from pydantic import BaseModel
from datetime import date
from app.models.enums import VariedadUva, TipoCultivo, Producto, TipoMercado

class EmpaqueCreate(BaseModel):
    producto: Producto = Producto.UVA
    variedad: VariedadUva | None = None
    cantidad_cajas_campo_usadas: int = 0
    tipo_cultivo: TipoCultivo | None = None
    mercado: TipoMercado = TipoMercado.NACIONAL
    cantidad_cajas_carton_producidas: int = 0
    porcentaje_merma: float = 0.0
    notas_merma: str | None = None
    numero_empacador: str
    # Limón specific
    bins_desverdizado_usados: int = 0
    lote_desverdizado: str | None = None  # legacy single
    presentacion: str | None = None  # legacy
    talla: str | None = None
    calidad: str | None = None  # legacy, automatic now
    cantidad_producida: int = 0
    # New for multiple lotes from desverdizado and per presentation output
    consumos_desverdizado: list[dict] | None = None  # [{"lote": "L-001", "bins": 50}, ...]
    # Structured production lines (preferred for mixed tallas)
    produccion: list[dict] | None = None  # [{"presentacion": "rpc_12", "talla": "165", "cantidad": 40}, ...]
    # Legacy flat (kept for compatibility)
    cantidad_rpc12: int = 0
    cantidad_rpc18: int = 0
    cantidad_caja40lbs: int = 0
    cantidad_bins_jugo: int = 0
    talla: str | None = None

class EmpaqueResponse(BaseModel):
    id: int
    fecha: date
    producto: Producto
    variedad: VariedadUva | None
    tipo_cultivo: TipoCultivo | None
    mercado: TipoMercado
    cantidad_cajas_campo_usadas: int
    cantidad_cajas_carton_producidas: int
    porcentaje_merma: float
    numero_empacador: str
    bins_desverdizado_usados: int | None = None
    lote_desverdizado: str | None = None
    presentacion: str | None = None
    talla: str | None = None
    calidad: str | None = None
    cantidad_producida: int | None = None

    class Config:
        from_attributes = True

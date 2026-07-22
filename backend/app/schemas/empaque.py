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
    # Fecha de la corrida de empaque (obligatoria en el endpoint)
    fecha: str | None = None  # YYYY-MM-DD
    # Limón specific
    bins_desverdizado_usados: int = 0
    lote_desverdizado: str | None = None  # legacy single
    presentacion: str | None = None  # legacy
    talla: str | None = None
    calidad: str | None = None  # legacy, automatic now
    cantidad_producida: int = 0
    # New for multiple lotes from desverdizado and per presentation output
    consumos_desverdizado: list[dict] | None = None  # [{"lote": "L-001", "bins": 50}, ...]
    # Structured production: granel puede llevar lote de origen
    # [{"presentacion": "rpc_granel", "talla": "165", "cantidad": 40, "lote": "8506 S1C4"}, ...]
    produccion: list[dict] | None = None
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
    detalle_corrida: dict | None = None

    class Config:
        from_attributes = True


class AgregarConsumoRequest(BaseModel):
    """Corrige un empaque: descuenta bins de un lote olvidado."""
    lote: str
    bins: int


class AnularEmpaqueResponse(BaseModel):
    message: str
    id: int
    bins_devueltos: int | None = None
    stock_final_revertido: bool | None = None
    forzado: bool | None = None
    aviso: str | None = None


class EliminarEmpaqueResponse(BaseModel):
    message: str
    id: int


class EmpaqueEditRequest(BaseModel):
    """
    Edición completa de empaque limón (admin).
    Reemplaza consumos y producción ajustando inventarios.
    """
    consumos: list[dict] | None = None  # [{"lote": "...", "bins": N}, ...]
    produccion: list[dict] | None = None  # [{"presentacion", "talla", "cantidad"}, ...]
    fecha: str | None = None  # YYYY-MM-DD
    numero_empacador: str | None = None
    mercado: TipoMercado | None = None


class ConvertirGranelRequest(BaseModel):
    """
    Convierte inventario de RPC a granel (22 kg, por talla y lote) en producto final
    (rpc_12, rpc_18, caja_40lbs).
    Preferido: consumos_granel = [{"talla": "165", "lote": "8506 S1C4", "cantidad": 10}, ...]
    Legacy: cantidad_rpc_granel (sin talla/lote) si no hay consumos_granel.
    """
    mercado: TipoMercado = TipoMercado.NACIONAL
    fecha: str | None = None  # YYYY-MM-DD obligatoria en endpoint
    consumos_granel: list[dict] | None = None  # [{"talla","lote","cantidad"}, ...]
    cantidad_rpc_granel: int = 0  # legacy total sin talla
    produccion: list[dict]  # puede incluir lote heredado del granel
    numero_empacador: str = "EMP-01"
    notas: str | None = None


class ConvertirGranelResponse(BaseModel):
    message: str
    empaque_id: int | None = None
    rpc_granel_consumido: int
    consumos_granel: list[dict] = []
    produccion: list[dict]

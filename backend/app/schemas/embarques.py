from pydantic import BaseModel
from datetime import date
from app.models.enums import VariedadUva, TipoCultivo, TipoMercado, Producto
from typing import List, Optional

class EmbarqueDetalleCreate(BaseModel):
    producto: Producto = Producto.UVA
    variedad: VariedadUva | None = None
    tipo_cultivo: TipoCultivo | None = None
    mercado: TipoMercado = TipoMercado.NACIONAL
    cantidad_cajas: int
    # For Limón
    presentacion: str | None = None  # rpc_12, rpc_18, caja_40lbs, bins_jugo
    talla: str | None = None
    calidad: str | None = None

class EmbarqueCreate(BaseModel):
    cliente_id: int
    notas: str | None = None
    detalles: List[EmbarqueDetalleCreate]

class EmbarqueDetalleResponse(BaseModel):
    producto: Producto
    variedad: VariedadUva | None
    tipo_cultivo: TipoCultivo | None
    mercado: TipoMercado
    cantidad_cajas: int
    presentacion: str | None = None
    talla: str | None = None
    calidad: str | None = None

class EmbarqueResponse(BaseModel):
    id: int
    fecha_salida: date
    cliente_id: int
    notas: str | None
    estado: str
    detalles: List[EmbarqueDetalleResponse]

    class Config:
        from_attributes = True


# --- Manifiesto PDF ---
class ManifiestoLineaRaw(BaseModel):
    no: int
    bultos: int
    descripcion: str
    lote: str | None = None
    etiqueta: str | None = None
    pallet: str | None = None
    presentacion: str | None = None
    talla: str | None = None
    calidad: str | None = None
    parse_ok: bool = False
    parse_note: str | None = None


class ManifiestoDetalleStock(BaseModel):
    producto: Producto = Producto.LIMON_AMARILLO
    mercado: TipoMercado = TipoMercado.EXPORTACION
    cantidad_cajas: int
    presentacion: str | None = None
    talla: str | None = None
    calidad: str | None = None
    stock_disponible: int = 0
    suficiente: bool = False


class ManifiestoParseResponse(BaseModel):
    fecha_embarque: str | None = None
    hora_salida: str | None = None
    numero_manifiesto: str | None = None
    embarcador: str | None = None
    distribuidor: str | None = None
    lugar: str | None = None
    mercado: str | None = None
    factura: str | None = None
    total_bultos_manifiesto: int | None = None
    total_bultos_parseados: int = 0
    lineas_raw: List[ManifiestoLineaRaw] = []
    detalles: List[ManifiestoDetalleStock] = []
    warnings: List[str] = []
    puede_confirmar: bool = False
    cliente_sugerido_id: int | None = None
    cliente_sugerido_nombre: str | None = None


class ManifiestoConfirmarRequest(BaseModel):
    """Confirma embarque a partir de líneas ya parseadas (o editadas)."""
    cliente_id: int
    notas: str | None = None
    fecha_embarque: str | None = None  # DD/MM/YYYY o YYYY-MM-DD
    detalles: List[EmbarqueDetalleCreate]


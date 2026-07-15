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

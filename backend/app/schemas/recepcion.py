from pydantic import BaseModel
from datetime import date
from app.models.enums import VariedadUva, TipoCultivo, TipoMercado, Producto

class RecepcionCampoCreate(BaseModel):
    producto: Producto = Producto.UVA
    variedad: VariedadUva | None = None  # None para limón
    cantidad_cajas_campo: int = 0
    cantidad_cajas_carton: int = 0
    tipo_cultivo_carton: TipoCultivo | None = None
    mercado: TipoMercado = TipoMercado.NACIONAL
    
    # Campos específicos para Limón
    lote: str | None = None
    cantidad_bins: int = 0   # bins de 230kg
    fecha_corte: date | None = None  # misma que recepción

class RecepcionCampoResponse(BaseModel):
    id: int
    fecha: date
    producto: Producto
    variedad: VariedadUva | None
    cantidad_cajas_campo: int
    cantidad_cajas_carton: int | None
    tipo_cultivo_carton: TipoCultivo | None
    mercado: TipoMercado
    lote: str | None = None
    cantidad_bins: int = 0
    fecha_corte: date | None = None

    class Config:
        from_attributes = True

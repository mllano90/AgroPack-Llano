from datetime import date
from pydantic import BaseModel
from app.models.enums import VariedadUva, TipoCultivo, EstadoParrilla

class ParrillaCreate(BaseModel):
    numero_parrilla: str
    variedad: VariedadUva
    tipo_cultivo: TipoCultivo
    cantidad_cajas: int

class ParrillaResponse(ParrillaCreate):
    id: int
    fecha_armado: date
    estado: EstadoParrilla
    usuario_id: int

    class Config:
        from_attributes = True

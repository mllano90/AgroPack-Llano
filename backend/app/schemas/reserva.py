# backend/app/schemas/reserva.py
from datetime import date

class ReservaCreate(BaseModel):
    parrilla_id: int | None = None
    variedad: str | None = None
    tipo_cultivo: str | None = None
    cantidad_cajas: int
    cliente_nombre: str

class ReservaResponse(ReservaCreate):
    id: int
    fecha: date
    activa: bool

    class Config:
        from_attributes = True

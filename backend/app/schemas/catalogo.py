from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class NombreIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=80)

    @model_validator(mode="after")
    def _strip(self):
        self.nombre = self.nombre.strip()
        if not self.nombre:
            raise ValueError("El nombre es obligatorio")
        return self


class ParametroIn(BaseModel):
    calidad: Literal["primera", "segunda"]
    tipo_caja_id: int
    kg: float = Field(gt=0, le=100000)
    cajas_por_parrilla: int = Field(ge=1, le=10000)


class ConfigIn(BaseModel):
    tipo_cosecha: str = Field(min_length=1, max_length=48)
    peso_contenedor_kg: float = Field(gt=0, le=100000)
    hectareas: float | None = Field(default=None, gt=0, le=100000)
    parametros: list[ParametroIn] = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def _dups(self):
        self.tipo_cosecha = self.tipo_cosecha.strip()
        keys = [(p.calidad, p.tipo_caja_id) for p in self.parametros]
        if len(keys) != len(set(keys)):
            raise ValueError("Hay un tipo de caja repetido en la misma calidad")
        return self


class ActivoIn(BaseModel):
    activo: bool


class RecepcionIn(BaseModel):
    producto_id: int
    cantidad: int = Field(gt=0, le=1_000_000)
    lote: str | None = None
    fecha: date | None = None
    notas: str | None = None


class LineaEmpaqueIn(BaseModel):
    parametro_id: int
    cantidad: int = Field(gt=0, le=1_000_000)


class EmpaqueIn(BaseModel):
    producto_id: int
    lote: str = Field(min_length=1, max_length=120)
    cantidad_campo: int = Field(gt=0, le=1_000_000)
    fecha: date | None = None
    lineas: list[LineaEmpaqueIn] = Field(min_length=1, max_length=40)


class LineaEmbarqueIn(BaseModel):
    inventario_id: int
    cantidad: int = Field(gt=0, le=1_000_000)


class EmbarqueIn(BaseModel):
    cliente_id: int
    notas: str | None = None
    fecha: date | None = None
    lineas: list[LineaEmbarqueIn] = Field(min_length=1, max_length=80)

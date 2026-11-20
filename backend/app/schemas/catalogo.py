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


class FormaIn(BaseModel):
    codigo: str = Field(min_length=1, max_length=48)
    peso_kg: float = Field(gt=0, le=100000)

    @model_validator(mode="after")
    def _strip(self):
        self.codigo = self.codigo.strip()
        if not self.codigo:
            raise ValueError("La forma de cosecha necesita un código")
        return self


class ConfigIn(BaseModel):
    """Acepta la forma única antigua (tipo_cosecha + peso) o varias formas."""

    tipo_cosecha: str | None = None
    peso_contenedor_kg: float | None = Field(default=None, gt=0, le=100000)
    hectareas: float | None = Field(default=None, gt=0, le=100000)
    parametros: list[ParametroIn] = Field(min_length=1, max_length=40)
    formas: list[FormaIn] | None = None

    @model_validator(mode="after")
    def _dups(self):
        if self.tipo_cosecha:
            self.tipo_cosecha = self.tipo_cosecha.strip()
        formas = list(self.formas or [])
        if not formas and self.tipo_cosecha and self.peso_contenedor_kg:
            formas = [FormaIn(codigo=self.tipo_cosecha, peso_kg=self.peso_contenedor_kg)]
        if not formas:
            raise ValueError("Indica al menos una forma de cosecha con su peso")
        codes = [f.codigo for f in formas]
        if len(codes) != len(set(codes)):
            raise ValueError("Hay una forma de cosecha repetida")
        self.formas = formas
        self.tipo_cosecha = formas[0].codigo
        self.peso_contenedor_kg = formas[0].peso_kg
        keys = [(p.calidad, p.tipo_caja_id) for p in self.parametros]
        if len(keys) != len(set(keys)):
            raise ValueError("Hay un tipo de caja repetido en la misma calidad")
        return self


class ActivoIn(BaseModel):
    activo: bool


class LineaRecepcionIn(BaseModel):
    codigo: str | None = None
    cantidad: int = Field(gt=0, le=1_000_000)

    @model_validator(mode="after")
    def _strip(self):
        if self.codigo:
            self.codigo = self.codigo.strip()
        return self


class RecepcionIn(BaseModel):
    """Una recepción puede traer varias formas. cantidad + codigo_cosecha sigue valiendo para una sola."""

    producto_id: int
    cantidad: int | None = Field(default=None, gt=0, le=1_000_000)
    lote: str | None = None
    fecha: date | None = None
    notas: str | None = None
    codigo_cosecha: str | None = None
    lineas: list[LineaRecepcionIn] | None = None

    @model_validator(mode="after")
    def _lineas(self):
        if self.codigo_cosecha:
            self.codigo_cosecha = self.codigo_cosecha.strip()
        if self.lineas:
            lineas = list(self.lineas)
        elif self.cantidad:
            lineas = [LineaRecepcionIn(codigo=self.codigo_cosecha, cantidad=self.cantidad)]
        else:
            raise ValueError("Indica al menos una forma de cosecha y su cantidad")
        if len(lineas) > 1:
            codes: list[str] = []
            for lin in lineas:
                if not lin.codigo:
                    raise ValueError("Cada línea necesita su forma de cosecha")
                codes.append(lin.codigo)
            if len(codes) != len(set(codes)):
                raise ValueError("No repitas la misma forma en la recepción")
        self.lineas = lineas
        return self


class LineaEmpaqueIn(BaseModel):
    parametro_id: int
    cantidad: int = Field(gt=0, le=1_000_000)


class ConsumoIn(BaseModel):
    codigo: str = Field(min_length=1, max_length=48)
    cantidad: int = Field(gt=0, le=1_000_000)

    @model_validator(mode="after")
    def _strip(self):
        self.codigo = self.codigo.strip()
        return self


class EmpaqueIn(BaseModel):
    producto_id: int
    lote: str = Field(min_length=1, max_length=120)
    cantidad_campo: int | None = Field(default=None, gt=0, le=1_000_000)
    consumos: list[ConsumoIn] | None = None
    fecha: date | None = None
    lineas: list[LineaEmpaqueIn] = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def _consumos(self):
        if self.consumos:
            codes = [c.codigo for c in self.consumos]
            if len(codes) != len(set(codes)):
                raise ValueError("Hay una forma de cosecha repetida en el consumo")
        elif self.cantidad_campo is None:
            raise ValueError("Indica los contenedores a usar")
        return self


class RecepcionEditIn(BaseModel):
    lote: str | None = None
    fecha: date | None = None
    lineas: list[LineaRecepcionIn] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def _unicas(self):
        codes = []
        for lin in self.lineas:
            if not lin.codigo:
                raise ValueError("Cada línea necesita su forma de cosecha")
            codes.append(lin.codigo)
        if len(codes) != len(set(codes)):
            raise ValueError("No repitas la misma forma en la recepción")
        return self


class EmpaqueEditIn(BaseModel):
    fecha: date | None = None
    consumos: list[ConsumoIn] = Field(min_length=1, max_length=20)
    lineas: list[LineaEmpaqueIn] = Field(min_length=1, max_length=40)


class EmbarqueLineaEdit(BaseModel):
    tipo_caja_id: int
    calidad: Literal["primera", "segunda"]
    lote: str = Field(min_length=1, max_length=120)
    cantidad: int = Field(gt=0, le=1_000_000)


class EmbarqueEditIn(BaseModel):
    fecha: date | None = None
    notas: str | None = None
    lineas: list[EmbarqueLineaEdit] = Field(min_length=1, max_length=40)


class AjusteCampoIn(BaseModel):
    producto_id: int
    lote: str = Field(min_length=1, max_length=120)
    codigo: str = Field(min_length=1, max_length=48)
    cantidad: int = Field(ge=0, le=1_000_000)


class AjusteFinalIn(BaseModel):
    cantidad: int = Field(ge=0, le=1_000_000)


class LineaEmbarqueIn(BaseModel):
    inventario_id: int
    cantidad: int = Field(gt=0, le=1_000_000)


class EmbarqueIn(BaseModel):
    cliente_id: int
    notas: str | None = None
    fecha: date | None = None
    lineas: list[LineaEmbarqueIn] = Field(min_length=1, max_length=80)

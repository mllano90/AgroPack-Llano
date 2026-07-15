from enum import Enum

class Rol(str, Enum):
    RECEPCION = "recepcion"
    RECEPCION_EMPACADOR = "recepcion_empacador"
    EMPACADOR = "empacador"
    EMBARQUES = "embarques"
    ADMIN = "admin"
    OBSERVADOR = "observador"

class VariedadUva(str, Enum):
    EARLY_SWEET = "early_sweet"
    FLAME = "flame"
    SUMMER_ROYAL = "summer_royal"

class TipoCultivo(str, Enum):
    ORGANICA = "organica"
    CONVENCIONAL = "convencional"

class TipoMercado(str, Enum):
    NACIONAL = "nacional"
    EXPORTACION = "exportacion"

class Producto(str, Enum):
    UVA = "uva"
    LIMON_AMARILLO = "limon_amarillo"


class TallaLimon(str, Enum):
    T75 = "75"
    T95 = "95"
    T115 = "115"
    T140 = "140"
    T165 = "165"
    T200 = "200"
    T235 = "235"


class PresentacionLimon(str, Enum):
    RPC_12 = "rpc_12"
    RPC_18 = "rpc_18"
    CAJA_40LBS = "caja_40lbs"
    BINS_JUGO = "bins_jugo"


class Calidad(str, Enum):
    PRIMERA = "primera"
    SEGUNDA = "segunda"

class EstadoParrilla(str, Enum):
    DISPONIBLE = "disponible"
    RESERVADA = "reservada"
    EMBARCADA = "embarcada"

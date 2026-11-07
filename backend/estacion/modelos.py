"""Modelos SQLAlchemy del módulo. Todas las tablas con prefijo estacion_ y SIN claves foráneas externas.

Tiempos: epoch Unix UTC en segundos (BigInteger) para que SQLite y Postgres se comporten igual.
"""
from sqlalchemy import (BigInteger, Boolean, Column, Float, Index, Integer, MetaData, String, Text,
                        inspect, text)
from sqlalchemy.orm import declarative_base

# Base propia (no se mezcla con la de AgroPack). crear_tablas() hace create_all solo de estas tablas.
Base = declarative_base(metadata=MetaData())
ID = BigInteger().with_variant(Integer, "sqlite")   # autoincremento correcto en SQLite


class Lectura(Base):
    """Paquete crudo decodificado (retención: ESTACION_RETENCION_DIAS, 30 por defecto)."""
    __tablename__ = "estacion_lecturas"
    id = Column(ID, primary_key=True, autoincrement=True)
    uid = Column(String(96), nullable=False, unique=True)        # id idempotente
    nodo = Column(String(32), nullable=False)
    tipo = Column(String(1), nullable=False)                     # 'D' / 'C'
    seq = Column(Integer, nullable=False)
    ts = Column(BigInteger, nullable=False)                      # hora de la medición
    ts_emisora = Column(BigInteger, nullable=False)              # campo 24 tal cual (0 = sin hora)
    ts_rx = Column(BigInteger)
    ts_servidor = Column(BigInteger, nullable=False)
    rssi = Column(Integer)
    snr = Column(Float)
    e_a1 = Column(Integer, nullable=False); t1 = Column(Float); h1 = Column(Float)
    e_a2 = Column(Integer, nullable=False); t2 = Column(Float); h2 = Column(Float)
    # Caja interna (paquete de 27). NULL en paquetes de 23/24 campos. No entra al aire.
    e_int = Column(Integer); t_int = Column(Float); h_int = Column(Float)
    e_pir = Column(Integer, nullable=False); pir = Column(Float)
    e_suelo = Column(Integer, nullable=False); h_suelo = Column(Float); t_suelo = Column(Float)
    ts_suelo = Column(BigInteger)
    suelo_nuevo = Column(Integer, nullable=False, server_default="0")
    ec = Column(Float); ph = Column(Float); n = Column(Integer); p = Column(Integer); k = Column(Integer)
    n_npk = Column(Integer, nullable=False); edad_npk = Column(Integer, nullable=False)
    ts_npk = Column(BigInteger)
    npk_nuevo = Column(Integer, nullable=False, server_default="0")
    fase = Column(Integer, nullable=False); min_fase = Column(Integer, nullable=False); tot_fase = Column(Integer, nullable=False)
    reinicio = Column(Integer, nullable=False, server_default="0")
    csv = Column(String(160), nullable=False)
    __table_args__ = (Index("ix_estacion_lecturas_nodo_ts", "nodo", "ts"),
                      Index("ix_estacion_lecturas_nodo_ts_suelo", "nodo", "ts_suelo"),
                      Index("ix_estacion_lecturas_nodo_ts_npk", "nodo", "ts_npk"))


class AgregadoHora(Base):
    """Promedio/mín/máx por hora y variable (se conserva indefinidamente)."""
    __tablename__ = "estacion_agregados_hora"
    nodo = Column(String(32), primary_key=True)
    hora = Column(BigInteger, primary_key=True)                  # epoch del inicio de la hora (UTC)
    var = Column(String(16), primary_key=True)
    prom = Column(Float, nullable=False); vmin = Column(Float, nullable=False); vmax = Column(Float, nullable=False)
    n = Column(Integer, nullable=False)


class EstadoReceptora(Base):
    __tablename__ = "estacion_estado_receptora"
    id = Column(ID, primary_key=True, autoincrement=True)
    nodo = Column(String(32), nullable=False)
    ts = Column(BigInteger, nullable=False)
    recibidos = Column(BigInteger); perdidos = Column(BigInteger); duplicados = Column(BigInteger)
    reinicios_emisora = Column(BigInteger); err_crc = Column(BigInteger); err_formato = Column(BigInteger)
    radio_reinit = Column(BigInteger); heap = Column(BigInteger); heap_min = Column(BigInteger)
    cola_pendiente = Column(BigInteger); firmware = Column(String(40)); uptime_s = Column(BigInteger)
    bateria_v = Column(Float); rssi_wifi = Column(Integer)
    __table_args__ = (Index("ix_estacion_estado_nodo_ts", "nodo", "ts"),)


class Alerta(Base):
    __tablename__ = "estacion_alertas"
    id = Column(ID, primary_key=True, autoincrement=True)
    nodo = Column(String(32), nullable=False)
    clave = Column(String(32), nullable=False)       # 'sin_datos', 'err:A1', 'rango:t_aire', 'reinicio', 'cmd:5'
    tipo = Column(String(16), nullable=False)        # sin_datos|error_sensor|fuera_rango|reinicio|bateria|comando
    mensaje = Column(String(300), nullable=False)
    valor = Column(Float)
    estado = Column(String(10), nullable=False)      # activa | resuelta
    inicio = Column(BigInteger, nullable=False)
    ultima = Column(BigInteger, nullable=False)
    fin = Column(BigInteger)
    conteo = Column(Integer, nullable=False, server_default="1")
    __table_args__ = (Index("ix_estacion_alertas_nodo_estado", "nodo", "estado", "clave"),)


class Comando(Base):
    """Comandos remotos (OTA). Estados: pendiente, entregado_receptora, enviado_emisora, activo,
    completado, expirado, fallido, cancelado."""
    __tablename__ = "estacion_comandos"
    id = Column(ID, primary_key=True, autoincrement=True)
    nodo = Column(String(32), nullable=False)
    tipo = Column(String(16), nullable=False)
    parametros = Column(Text, nullable=False)        # JSON
    estado = Column(String(24), nullable=False)
    creado = Column(BigInteger, nullable=False)
    actualizado = Column(BigInteger, nullable=False)
    detalle = Column(String(300))
    usuario = Column(String(64))
    alerta_id = Column(BigInteger)                   # referencia lógica (sin FK)
    __table_args__ = (Index("ix_estacion_comandos_nodo_estado", "nodo", "estado"),)


class Config(Base):
    __tablename__ = "estacion_config"
    clave = Column(String(32), primary_key=True)
    valor = Column(Text, nullable=False)


class NodoEval(Base):
    """Marca de agua de la evaluación de alertas por nodo."""
    __tablename__ = "estacion_nodo_eval"
    nodo = Column(String(32), primary_key=True)
    ultimo_ts = Column(BigInteger, nullable=False)
    ultimo_seq = Column(Integer, nullable=False)


class Trabajo(Base):
    """Marcas de agua de los trabajos en segundo plano (p. ej. último id procesado)."""
    __tablename__ = "estacion_trabajos"
    nombre = Column(String(32), primary_key=True)
    valor = Column(BigInteger, nullable=False)


class Usuario(Base):
    """Usuarios propios de la estación (independientes de users de AgroPack)."""
    __tablename__ = "estacion_usuarios"
    id = Column(ID, primary_key=True, autoincrement=True)
    usuario = Column(String(64), nullable=False, unique=True)
    hash = Column(String(200), nullable=False)       # pbkdf2_sha256$iter$salt$hash
    activo = Column(Boolean, nullable=False, default=True)
    creado = Column(BigInteger, nullable=False)


def crear_tablas(engine):
    Base.metadata.create_all(engine)
    # create_all no altera una estacion_lecturas ya creada (p. ej. el esquema del PR 9).
    insp = inspect(engine)
    if not insp.has_table("estacion_lecturas"):
        return
    columnas = {c["name"]: c for c in insp.get_columns("estacion_lecturas")}
    tipo_num = "DOUBLE PRECISION" if engine.dialect.name == "postgresql" else "REAL"
    with engine.begin() as conn:
        for nombre, tipo in (("e_int", "INTEGER"), ("t_int", tipo_num), ("h_int", tipo_num)):
            if nombre not in columnas:
                conn.execute(text(f"ALTER TABLE estacion_lecturas ADD COLUMN {nombre} {tipo}"))
        largo = getattr(columnas.get("csv", {}).get("type"), "length", None)
        if engine.dialect.name == "postgresql" and largo is not None and largo < 160:
            conn.execute(text("ALTER TABLE estacion_lecturas ALTER COLUMN csv TYPE VARCHAR(160)"))

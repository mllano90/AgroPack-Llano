from sqlalchemy import Column, Integer, Float, String, ForeignKey, Date, DateTime, UniqueConstraint, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base
from app.models.enums import VariedadUva, TipoCultivo, TipoMercado, Producto, TallaLimon, PresentacionLimon, Calidad
from sqlalchemy import Enum as SQLEnum


class RecepcionCampo(Base):
    __tablename__ = "recepcion_campo"
    
    id = Column(Integer, primary_key=True, index=True)
    fecha = Column(Date, default=datetime.utcnow().date)
    hora = Column(DateTime, default=datetime.utcnow)
    
    producto = Column(SQLEnum(Producto), nullable=False, default=Producto.UVA)
    variedad = Column(SQLEnum(VariedadUva), nullable=True)  # null para limón
    cantidad_cajas_campo = Column(Integer, nullable=False, default=0)
    cantidad_cajas_carton = Column(Integer, nullable=True, default=0)
    tipo_cultivo_carton = Column(SQLEnum(TipoCultivo), nullable=True)
    mercado = Column(SQLEnum(TipoMercado), nullable=True)   # Opcional por ahora
    
    usuario_id = Column(Integer, ForeignKey("users.id"))
    usuario = relationship("User")

    # For Limón desverdizado tracking
    desverdizados = relationship("InventarioDesverdizado", back_populates="recepcion", foreign_keys="InventarioDesverdizado.recepcion_id")


class InventarioCampo(Base):
    __tablename__ = "inventario_campo"
    
    id = Column(Integer, primary_key=True, index=True)
    variedad = Column(SQLEnum(VariedadUva), nullable=False)
    mercado = Column(SQLEnum(TipoMercado), nullable=False, default=TipoMercado.NACIONAL)
    cantidad_disponible = Column(Integer, default=0)
    fecha_actualizacion = Column(DateTime, default=datetime.utcnow)


class Empaque(Base):
    __tablename__ = "empaque"
    
    id = Column(Integer, primary_key=True, index=True)
    fecha = Column(Date, default=datetime.utcnow().date)
    
    producto = Column(SQLEnum(Producto), nullable=False, default=Producto.UVA)
    variedad = Column(SQLEnum(VariedadUva), nullable=True)
    tipo_cultivo = Column(SQLEnum(TipoCultivo), nullable=True)
    mercado = Column(SQLEnum(TipoMercado), nullable=False, default=TipoMercado.NACIONAL)
    
    cantidad_cajas_campo_usadas = Column(Integer, nullable=False)
    cantidad_cajas_carton_producidas = Column(Integer, nullable=False)
    porcentaje_merma = Column(Float, default=0.0)
    notas_merma = Column(String, nullable=True)
    numero_empacador = Column(String, nullable=False)
    
    # Limón fields (reusing existing model)
    bins_desverdizado_usados = Column(Integer, default=0)
    lote_desverdizado = Column(String, nullable=True)
    presentacion = Column(String, nullable=True)
    talla = Column(String, nullable=True)
    calidad = Column(String, nullable=True)
    cantidad_producida = Column(Integer, default=0)
    # Detalle de corrida limón: {consumos: [...], produccion: [...]}
    detalle_corrida = Column(JSON, nullable=True)
    
    usuario_id = Column(Integer, ForeignKey("users.id"))
    usuario = relationship("User")


class InventarioFinal(Base):
    __tablename__ = "inventario_final"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Nuevo modelo flexible
    producto = Column(SQLEnum(Producto), nullable=False, default=Producto.UVA)
    variedad = Column(SQLEnum(VariedadUva), nullable=True)
    tipo_cultivo = Column(SQLEnum(TipoCultivo), nullable=True)
    mercado = Column(SQLEnum(TipoMercado), nullable=False, default=TipoMercado.NACIONAL)
    
    cantidad_stock = Column(Integer, default=0)
    fecha_actualizacion = Column(DateTime, default=datetime.utcnow)
    
    # Para productos futuros con atributos muy distintos
    atributos_extra = Column(JSON, nullable=True)

    # Unique constraint relaxed for Limón support (multiple presentaciones)
    # __table_args__ = (
    #     UniqueConstraint(
    #         "producto", "variedad", "tipo_cultivo", "mercado",
    #         name="uq_inventario_final_completo"
    #     ),
    # )


# ==================== NUEVO: EMBARQUES ====================
class Embarque(Base):
    __tablename__ = "embarque"
    
    id = Column(Integer, primary_key=True, index=True)
    fecha_salida = Column(Date, default=datetime.utcnow().date)
    hora_salida = Column(DateTime, default=datetime.utcnow)
    
    # Ahora usamos FK a Cliente en lugar de texto libre
    cliente_id = Column(Integer, ForeignKey("clientes.id"), nullable=False)
    cliente = relationship("Cliente")
    
    # numero_contenedor eliminado según requerimiento
    notas = Column(String, nullable=True)
    estado = Column(String, default="en_transito")
    
    usuario_id = Column(Integer, ForeignKey("users.id"))
    usuario = relationship("User")

    detalles = relationship("EmbarqueDetalle", back_populates="embarque")


class EmbarqueDetalle(Base):
    __tablename__ = "embarque_detalle"
    
    id = Column(Integer, primary_key=True, index=True)
    embarque_id = Column(Integer, ForeignKey("embarque.id"), nullable=False)
    
    producto = Column(SQLEnum(Producto), nullable=False, default=Producto.UVA)
    variedad = Column(SQLEnum(VariedadUva), nullable=True)
    tipo_cultivo = Column(SQLEnum(TipoCultivo), nullable=True)
    mercado = Column(SQLEnum(TipoMercado), nullable=False, default=TipoMercado.NACIONAL)
    
    cantidad_cajas = Column(Integer, nullable=False)
    
    # For Limón
    presentacion = Column(String, nullable=True)
    talla = Column(String, nullable=True)
    calidad = Column(String, nullable=True)
    
    embarque = relationship("Embarque", back_populates="detalles")


# ============================================
# NUEVOS MODELOS: Cliente y Producto
# ============================================

class ProductoModel(Base):  # Renombrado para evitar conflicto con el enum
    __tablename__ = "productos"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False, unique=True)
    codigo = Column(String, nullable=False, unique=True)
    descripcion = Column(String, nullable=True)
    activo = Column(Integer, default=1)  # 1 = activo, 0 = inactivo

    fecha_creacion = Column(DateTime, default=datetime.utcnow)


class Cliente(Base):
    __tablename__ = "clientes"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    empresa = Column(String, nullable=True)
    contacto = Column(String, nullable=True)
    email = Column(String, nullable=True)
    telefono = Column(String, nullable=True)
    notas = Column(String, nullable=True)
    activo = Column(Integer, default=1)

    fecha_creacion = Column(DateTime, default=datetime.utcnow)


# ============================================
# Modelo temporal para no romper otros routers
# ============================================
class Parrilla(Base):
    __tablename__ = "parrilla"
    
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    estado = Column(String, default="disponible")
    variedad = Column(SQLEnum(VariedadUva), nullable=True)
    cantidad = Column(Integer, default=0)
    
    usuario_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    usuario = relationship("User")


# ============================================
# INVENTARIO SEPARADO PARA DESVERDIZADO (LIMÓN)
# ============================================

class InventarioDesverdizado(Base):
    __tablename__ = "inventario_desverdizado"

    id = Column(Integer, primary_key=True, index=True)
    producto = Column(SQLEnum(Producto), nullable=False, default=Producto.LIMON_AMARILLO)
    
    # Cantidad en bins de 260kg
    cantidad_bins = Column(Integer, nullable=False, default=0)
    
    # Lote y fecha (fecha_recepcion = fecha de corte)
    lote = Column(String, nullable=False)
    fecha_recepcion = Column(Date, nullable=False)
    
    # Fecha tentativa de salida (recepción + DIAS_DESVERDIZADO, default 7)
    fecha_tentativa_salida = Column(Date, nullable=False)
    
    # Usuario marca manualmente cuando sale
    fecha_real_salida = Column(Date, nullable=True)
    estado = Column(String, default="en_desverdizado")  # en_desverdizado, listo_empaque, empaquetado
    
    usuario_id = Column(Integer, ForeignKey("users.id"))
    usuario = relationship("User")
    
    # Referencia opcional a la recepción original
    recepcion_id = Column(Integer, ForeignKey("recepcion_campo.id"), nullable=True)
    recepcion = relationship("RecepcionCampo", back_populates="desverdizados", foreign_keys=[recepcion_id])
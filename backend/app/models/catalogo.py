"""Catálogo de productos nuevos y su operación.

Tablas nuevas, creadas por create_all. No alteran uva, limón ni melón.
Esos productos siguen en sus tablas y en el enum `producto`.
"""

from datetime import datetime

from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base


class TipoCosechaCatalogo(Base):
    """Contenedor de cosecha registrado por el admin (además de Bin y Caja de campo)."""

    __tablename__ = "catalogo_tipos_cosecha"

    id = Column(Integer, primary_key=True, index=True)
    codigo = Column(String, nullable=False, unique=True, index=True)
    nombre = Column(String, nullable=False, unique=True)
    fecha_creacion = Column(DateTime, default=datetime.utcnow)


class TipoCajaCatalogo(Base):
    """Tipo de caja reutilizable entre productos. El kg y las cajas/parrilla son por producto y calidad."""

    __tablename__ = "catalogo_tipos_caja"

    id = Column(Integer, primary_key=True, index=True)
    codigo = Column(String, nullable=False, unique=True, index=True)
    nombre = Column(String, nullable=False, unique=True)
    fecha_creacion = Column(DateTime, default=datetime.utcnow)


class ProductoCatalogo(Base):
    __tablename__ = "productos_catalogo"

    id = Column(Integer, primary_key=True, index=True)
    codigo = Column(String, nullable=False, unique=True, index=True)
    nombre = Column(String, nullable=False)
    # bins | cajas_campo | codigo de catalogo_tipos_cosecha
    tipo_cosecha = Column(String, nullable=False, default="bins")
    peso_contenedor_kg = Column(Float, nullable=True)
    hectareas = Column(Float, nullable=True)
    activo = Column(Integer, nullable=False, default=1)
    fecha_creacion = Column(DateTime, default=datetime.utcnow)

    parametros = relationship(
        "ProductoParametro",
        back_populates="producto",
        cascade="all, delete-orphan",
    )


class ProductoParametro(Base):
    """Presentación de empaque: tipo de caja + kg + cajas por parrilla, por calidad."""

    __tablename__ = "producto_parametros"
    __table_args__ = (
        UniqueConstraint(
            "producto_id",
            "calidad",
            "tipo_caja_id",
            name="uq_parametro_producto_calidad_caja",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(
        Integer,
        ForeignKey("productos_catalogo.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    calidad = Column(String, nullable=False)  # primera | segunda
    tipo_caja_id = Column(
        Integer,
        ForeignKey("catalogo_tipos_caja.id"),
        nullable=False,
        index=True,
    )
    kg = Column(Float, nullable=False)
    cajas_por_parrilla = Column(Integer, nullable=False)

    producto = relationship("ProductoCatalogo", back_populates="parametros")
    tipo_caja = relationship("TipoCajaCatalogo")


class CatalogoRecepcion(Base):
    __tablename__ = "catalogo_recepciones"

    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(
        Integer,
        ForeignKey("productos_catalogo.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    fecha = Column(Date, nullable=False)
    lote = Column(String, nullable=False, default="General")
    cantidad = Column(Integer, nullable=False)
    usuario_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    notas = Column(String, nullable=True)


class CatalogoInventarioCampo(Base):
    __tablename__ = "catalogo_inventario_campo"
    __table_args__ = (
        UniqueConstraint("producto_id", "lote", name="uq_catalogo_campo_producto_lote"),
    )

    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(
        Integer,
        ForeignKey("productos_catalogo.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    lote = Column(String, nullable=False)
    cantidad_disponible = Column(Integer, nullable=False, default=0)


class CatalogoEmpaque(Base):
    __tablename__ = "catalogo_empaques"

    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(
        Integer,
        ForeignKey("productos_catalogo.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    fecha = Column(Date, nullable=False)
    lote = Column(String, nullable=False)
    cantidad_campo = Column(Integer, nullable=False)
    # [{parametro_id, tipo_caja_id, calidad, cantidad}]
    lineas = Column(JSON, nullable=False)
    usuario_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class CatalogoInventarioFinal(Base):
    __tablename__ = "catalogo_inventario_final"
    __table_args__ = (
        UniqueConstraint(
            "producto_id",
            "tipo_caja_id",
            "calidad",
            "lote",
            name="uq_catalogo_final_sku",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(
        Integer,
        ForeignKey("productos_catalogo.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tipo_caja_id = Column(
        Integer,
        ForeignKey("catalogo_tipos_caja.id"),
        nullable=False,
        index=True,
    )
    calidad = Column(String, nullable=False)
    lote = Column(String, nullable=False, default="")
    cantidad_stock = Column(Integer, nullable=False, default=0)


class CatalogoEmbarque(Base):
    """Embarque del catálogo. No inserta en la tabla embarque de uva/limón/melón."""

    __tablename__ = "catalogo_embarques"

    id = Column(Integer, primary_key=True, index=True)
    fecha_salida = Column(Date, nullable=False)
    cliente_id = Column(Integer, ForeignKey("clientes.id"), nullable=False, index=True)
    notas = Column(String, nullable=True)
    usuario_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class CatalogoEmbarqueLinea(Base):
    __tablename__ = "catalogo_embarque_lineas"

    id = Column(Integer, primary_key=True, index=True)
    embarque_id = Column(
        Integer,
        ForeignKey("catalogo_embarques.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    producto_id = Column(
        Integer,
        ForeignKey("productos_catalogo.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tipo_caja_id = Column(Integer, ForeignKey("catalogo_tipos_caja.id"), nullable=False)
    calidad = Column(String, nullable=False)
    lote = Column(String, nullable=False, default="")
    cantidad = Column(Integer, nullable=False)
    cajas_por_parrilla = Column(Integer, nullable=True)

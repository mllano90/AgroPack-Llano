from sqlalchemy import Column, Integer, String, Enum as SQLEnum
from app.core.database import Base
from app.models.enums import Rol

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    nombre_completo = Column(String, nullable=False)
    rol = Column(SQLEnum(Rol), nullable=False)
    hashed_password = Column(String, nullable=False)

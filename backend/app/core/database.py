from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from pathlib import Path

from app.core.config import get_settings

settings = get_settings()

# ==============================================
# Configuración de Base de Datos
# Soporta tanto SQLite (desarrollo) como PostgreSQL (producción)
# ==============================================

DATABASE_URL = settings.DATABASE_URL

# Render / Railway a veces entregan "postgres://"; SQLAlchemy requiere "postgresql://"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Configuración especial para SQLite
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
    print(f"📦 Usando SQLite: {DATABASE_URL}")
else:
    print(f"🐘 Usando PostgreSQL: {DATABASE_URL.split('@')[-1] if '@' in DATABASE_URL else 'configurado'}")

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,  # Ayuda con conexiones perdidas en Postgres
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Dependency that provides a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

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


def ensure_schema():
    """Añade columnas nuevas sin migración Alembic (Postgres/SQLite)."""
    from sqlalchemy import text, inspect

    try:
        insp = inspect(engine)
        tables = insp.get_table_names()
        if "empaque" in tables:
            cols = {c["name"] for c in insp.get_columns("empaque")}
            if "detalle_corrida" not in cols:
                with engine.begin() as conn:
                    if DATABASE_URL.startswith("sqlite"):
                        conn.execute(text("ALTER TABLE empaque ADD COLUMN detalle_corrida JSON"))
                    else:
                        conn.execute(
                            text("ALTER TABLE empaque ADD COLUMN IF NOT EXISTS detalle_corrida JSON")
                        )
                print("✅ Columna empaque.detalle_corrida agregada")

        if "inventario_desverdizado" in tables:
            dcols = {c["name"] for c in insp.get_columns("inventario_desverdizado")}
            if "numero_tanda" not in dcols:
                with engine.begin() as conn:
                    if DATABASE_URL.startswith("sqlite"):
                        conn.execute(
                            text("ALTER TABLE inventario_desverdizado ADD COLUMN numero_tanda INTEGER")
                        )
                    else:
                        conn.execute(
                            text(
                                "ALTER TABLE inventario_desverdizado "
                                "ADD COLUMN IF NOT EXISTS numero_tanda INTEGER"
                            )
                        )
                print("✅ Columna inventario_desverdizado.numero_tanda agregada")

        if "recepcion_campo" in tables:
            rcols = {c["name"] for c in insp.get_columns("recepcion_campo")}
            for col, ddl_sqlite, ddl_pg in [
                ("lote", "ALTER TABLE recepcion_campo ADD COLUMN lote VARCHAR",
                 "ALTER TABLE recepcion_campo ADD COLUMN IF NOT EXISTS lote VARCHAR"),
                ("cantidad_bins", "ALTER TABLE recepcion_campo ADD COLUMN cantidad_bins INTEGER DEFAULT 0",
                 "ALTER TABLE recepcion_campo ADD COLUMN IF NOT EXISTS cantidad_bins INTEGER DEFAULT 0"),
                ("fecha_corte", "ALTER TABLE recepcion_campo ADD COLUMN fecha_corte DATE",
                 "ALTER TABLE recepcion_campo ADD COLUMN IF NOT EXISTS fecha_corte DATE"),
            ]:
                if col not in rcols:
                    with engine.begin() as conn:
                        if DATABASE_URL.startswith("sqlite"):
                            conn.execute(text(ddl_sqlite))
                        else:
                            conn.execute(text(ddl_pg))
                    print(f"✅ Columna recepcion_campo.{col} agregada")
    except Exception as e:
        print(f"⚠️ ensure_schema: {e}")

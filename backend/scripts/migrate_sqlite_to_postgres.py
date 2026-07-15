"""
Migración de datos de SQLite a PostgreSQL para AgroPack Llano.

Este script copia todos los datos respetando el orden de dependencias
(foreign keys) y resetea las secuencias de PostgreSQL al final.

Uso recomendado:

1. Configura las variables de entorno (SECRET_KEY ya NO es obligatorio para este script):
   export SQLITE_URL="sqlite:////ruta/completa/a/agropack_llano.db"
   export DATABASE_URL="postgresql://usuario:password@localhost:5432/agropack_llano"

2. Ejecuta:
   python backend/scripts/migrate_sqlite_to_postgres.py

Opciones:
   --dry-run     : Solo muestra lo que haría sin escribir nada.
                   (No requiere driver de PostgreSQL ni SECRET_KEY)
   --reset-seq   : Resetea las secuencias de PostgreSQL después de migrar (recomendado)

Ejemplo completo:
   export SQLITE_URL="sqlite:////Users/marcoallanoe/AgroPack-Llano/backend/agropack_llano.db"
   export DATABASE_URL="postgresql://agro:Agr0.26@localhost:5432/agropack_llano"
   python backend/scripts/migrate_sqlite_to_postgres.py --reset-seq
"""

import os
import sys
import argparse
from pathlib import Path
from datetime import datetime

# ============================================================
# Environment guard for standalone migration script
# ============================================================
# The app's config.py (via pydantic-settings) requires SECRET_KEY at import time.
# The migration script itself does **not** need any secret — it only moves data.
# We set a safe dummy here if the variable is missing so the script can be
# executed in clean environments (CI, new machines, Docker, etc.) without
# forcing the user to export a fake SECRET_KEY just to run the migrator.
if not os.getenv("SECRET_KEY"):
    os.environ["SECRET_KEY"] = "migration-dummy-key-not-for-production-use"
    print("⚠️  SECRET_KEY no definido. Usando valor dummy temporal solo para este script.")

# Añadir path del proyecto
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.append(str(PROJECT_ROOT))

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import SQLAlchemyError

# Importar Base y todos los modelos para que metadata esté cargada
from app.core.database import Base
from app.models import *  # noqa: F403


def get_engines(sqlite_url: str, postgres_url: str, dry_run: bool = False):
    """
    Crea los engines de origen y destino.

    En modo dry-run evitamos crear un engine con esquema 'postgresql://'
    para no requerir el driver psycopg2. Usamos un SQLite en memoria
    como dummy inofensivo (nunca se escribe nada en dry-run).
    """
    sqlite_engine = create_engine(
        sqlite_url,
        connect_args={"check_same_thread": False},
        echo=False
    )

    if dry_run:
        # No necesitamos Postgres real para dry-run.
        # Esto permite ejecutar el script con --dry-run aunque
        # psycopg2-binary no esté instalado.
        postgres_engine = create_engine("sqlite:///:memory:", echo=False)
    else:
        postgres_engine = create_engine(
            postgres_url,
            pool_pre_ping=True,
            echo=False
        )

    return sqlite_engine, postgres_engine


def get_sorted_tables():
    """Devuelve las tablas en orden correcto de dependencias."""
    return Base.metadata.sorted_tables


def reset_postgres_sequences(engine):
    """Resetea las secuencias de todas las tablas con primary key serial."""
    print("\n🔄 Reseteando secuencias en PostgreSQL...")

    with engine.connect() as conn:
        for table in Base.metadata.sorted_tables:
            pk_columns = [col.name for col in table.primary_key.columns]
            if not pk_columns:
                continue

            pk = pk_columns[0]  # asumimos una sola PK por ahora

            # Obtener el valor máximo actual
            result = conn.execute(text(f'SELECT COALESCE(MAX("{pk}"), 0) FROM "{table.name}"'))
            max_id = result.scalar() or 0

            # Nombre de la secuencia por defecto de SQLAlchemy/Postgres
            seq_name = f"{table.name}_{pk}_seq"

            try:
                conn.execute(text(f"SELECT setval('{seq_name}', {max_id + 1})"))
                print(f"   ✓ Secuencia de '{table.name}' reseteada a {max_id + 1}")
            except Exception as e:
                print(f"   ⚠️  No se pudo resetear secuencia de '{table.name}': {e}")

        conn.commit()


def migrate_data(sqlite_engine, postgres_engine, dry_run: bool = False):
    """Migra los datos tabla por tabla en el orden correcto."""
    sqlite_session = sessionmaker(bind=sqlite_engine)()
    postgres_session = sessionmaker(bind=postgres_engine)()

    tables = get_sorted_tables()

    print(f"\n📦 Tablas a migrar ({len(tables)}):")
    for t in tables:
        print(f"   - {t.name}")

    total_rows = 0

    try:
        for table in tables:
            print(f"\n➡️  Migrando tabla: {table.name}")

            # Leer todos los datos de SQLite
            result = sqlite_session.execute(table.select())
            rows = result.fetchall()

            if not rows:
                print(f"   (sin datos)")
                continue

            print(f"   → {len(rows)} registros encontrados")

            if dry_run:
                print(f"   [DRY-RUN] Se insertarían {len(rows)} filas")
                total_rows += len(rows)
                continue

            # Insertar en PostgreSQL
            # Usamos bulk insert para mejor rendimiento
            data = [dict(row._mapping) for row in rows]

            try:
                postgres_session.execute(table.insert(), data)
                postgres_session.commit()
                print(f"   ✓ {len(rows)} registros migrados")
                total_rows += len(rows)
            except SQLAlchemyError as e:
                postgres_session.rollback()
                print(f"   ❌ Error migrando {table.name}: {e}")
                raise

        print(f"\n✅ Migración completada. Total de registros migrados: {total_rows}")

    except Exception as e:
        print(f"\n❌ Error durante la migración: {e}")
        raise
    finally:
        sqlite_session.close()
        postgres_session.close()


def main():
    parser = argparse.ArgumentParser(description="Migrar datos de SQLite a PostgreSQL")
    parser.add_argument("--dry-run", action="store_true", help="Ejecutar sin escribir datos")
    parser.add_argument("--reset-seq", action="store_true", help="Resetear secuencias después de migrar")
    args = parser.parse_args()

    sqlite_url = os.getenv("SQLITE_URL")
    postgres_url = os.getenv("DATABASE_URL")

    if not sqlite_url:
        sqlite_url = "sqlite:///./agropack_llano.db"  # fallback
        print(f"⚠️  Usando SQLite por defecto: {sqlite_url}")

    if args.dry_run:
        # In dry-run we don't need a real Postgres connection
        postgres_url = postgres_url or "postgresql://dry-run-placeholder"
    else:
        if not postgres_url or not postgres_url.startswith("postgresql"):
            print("❌ Error: Debes definir DATABASE_URL con una conexión PostgreSQL")
            print("Ejemplo:")
            print('  export DATABASE_URL="postgresql://usuario:contraseña@localhost:5432/agropack_llano"')
            sys.exit(1)

    destino_display = "DRY-RUN (no se conectará)" if args.dry_run else (postgres_url.split('@')[-1] if '@' in postgres_url else postgres_url)

    print("=" * 60)
    print("🚀 MIGRACIÓN SQLite → PostgreSQL - AgroPack Llano")
    print("=" * 60)
    print(f"Origen : {sqlite_url}")
    print(f"Destino: {destino_display}")
    print(f"Modo   : {'DRY RUN' if args.dry_run else 'REAL'}")
    print(f"Fecha  : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    try:
        sqlite_engine, postgres_engine = get_engines(sqlite_url, postgres_url, dry_run=args.dry_run)

        # Crear tablas en destino si no existen
        if not args.dry_run:
            print("\n📋 Asegurando que las tablas existan en PostgreSQL...")
            Base.metadata.create_all(postgres_engine)

        migrate_data(sqlite_engine, postgres_engine, dry_run=args.dry_run)

        if args.reset_seq and not args.dry_run:
            reset_postgres_sequences(postgres_engine)

        print("\n🎉 Proceso finalizado exitosamente.")

    except Exception as e:
        print(f"\n💥 Falló la migración: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Borra datos operativos de la BD configurada en DATABASE_URL / backend/.env.
Conserva: users, clientes.

Uso (desde backend/):
  cd backend && source .venv/bin/activate
  python ../scripts/wipe_operacional.py --yes

Producción (Render):
  export DATABASE_URL='postgresql://...'
  python ../scripts/wipe_operacional.py --yes
"""
from __future__ import annotations

import argparse
import os
import sys

# Asegurar imports de app
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, ROOT)
os.chdir(ROOT)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirma el borrado sin prompt interactivo",
    )
    args = parser.parse_args()

    if not args.yes:
        print("Esto borra recepciones, desverdizado, empaques, inventarios y embarques.")
        print("Conserva users y clientes.")
        conf = input('Escribe RESET_OPERACIONAL para continuar: ').strip()
        if conf != "RESET_OPERACIONAL":
            print("Cancelado.")
            return 1

    from app.core.database import SessionLocal, engine
    from app.models.inventory import (
        EmbarqueDetalle,
        Embarque,
        Empaque,
        InventarioFinal,
        InventarioCampo,
        InventarioDesverdizado,
        RecepcionCampo,
        Parrilla,
    )
    from sqlalchemy import text

    db = SessionLocal()
    counts = {}
    try:
        for model, name in [
            (EmbarqueDetalle, "embarque_detalle"),
            (Embarque, "embarque"),
            (Empaque, "empaque"),
            (InventarioFinal, "inventario_final"),
            (InventarioCampo, "inventario_campo"),
            (InventarioDesverdizado, "inventario_desverdizado"),
            (RecepcionCampo, "recepcion_campo"),
            (Parrilla, "parrilla"),
        ]:
            n = db.query(model).delete(synchronize_session=False)
            counts[name] = int(n or 0)
        db.commit()

        if engine.dialect.name == "postgresql":
            for t in counts:
                try:
                    db.execute(text(f"ALTER SEQUENCE IF EXISTS {t}_id_seq RESTART WITH 1"))
                except Exception as ex:
                    print(f"  (secuencia {t}: {ex})")
            db.commit()

        print("OK — datos operativos eliminados:")
        for k, v in counts.items():
            print(f"  {k}: {v}")
        print("Conservado: users, clientes")
        return 0
    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())

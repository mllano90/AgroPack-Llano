#!/usr/bin/env python3
"""
Borra SOLO datos operativos de melón. Conserva limón/uva y users/clientes.

Tablas tocadas (filas producto MELON / melon):
  - empaque
  - inventario_final
  - inventario_desverdizado (bins de campo)
  - recepcion_campo
  - embarque_detalle (producto melon) + embarques huérfanos solo-melón

Uso (local):
  cd backend && source .venv/bin/activate
  python ../scripts/wipe_melon.py --yes

Producción (DATABASE_URL de Render):
  export DATABASE_URL='postgresql://...'
  python ../scripts/wipe_melon.py --yes
"""
from __future__ import annotations

import argparse
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, ROOT)
os.chdir(ROOT)


def _is_melon(val) -> bool:
    if val is None:
        return False
    s = getattr(val, "value", None) or getattr(val, "name", None) or str(val)
    s = str(s).lower()
    if "." in s:
        s = s.split(".")[-1]
    return s in ("melon", "MELON".lower())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", action="store_true", help="Confirma sin prompt")
    args = parser.parse_args()

    if not args.yes:
        print("Esto borra SOLO inventarios/empaques/recepciones/bins de MELÓN.")
        print("Conserva limón, uva, users y clientes.")
        conf = input('Escribe WIPE_MELON para continuar: ').strip()
        if conf != "WIPE_MELON":
            print("Cancelado.")
            return 1

    from app.core.database import SessionLocal
    from app.models.enums import Producto
    from app.models.inventory import (
        Embarque,
        EmbarqueDetalle,
        Empaque,
        InventarioDesverdizado,
        InventarioFinal,
        RecepcionCampo,
    )

    db = SessionLocal()
    counts: dict[str, int] = {}
    try:
        # Empaques melon
        n = (
            db.query(Empaque)
            .filter(Empaque.producto == Producto.MELON)
            .delete(synchronize_session=False)
        )
        counts["empaque_melon"] = int(n or 0)

        # Inventario final melon
        n = (
            db.query(InventarioFinal)
            .filter(InventarioFinal.producto == Producto.MELON)
            .delete(synchronize_session=False)
        )
        counts["inventario_final_melon"] = int(n or 0)

        # Bins campo / desverdizado melon
        n = (
            db.query(InventarioDesverdizado)
            .filter(InventarioDesverdizado.producto == Producto.MELON)
            .delete(synchronize_session=False)
        )
        counts["inventario_desverdizado_melon"] = int(n or 0)

        # Recepciones melon
        n = (
            db.query(RecepcionCampo)
            .filter(RecepcionCampo.producto == Producto.MELON)
            .delete(synchronize_session=False)
        )
        counts["recepcion_campo_melon"] = int(n or 0)

        # Detalles de embarque melon
        dets = db.query(EmbarqueDetalle).all()
        det_ids = []
        emb_ids_touched = set()
        for d in dets:
            if _is_melon(d.producto):
                det_ids.append(d.id)
                emb_ids_touched.add(d.embarque_id)
        n = 0
        if det_ids:
            n = (
                db.query(EmbarqueDetalle)
                .filter(EmbarqueDetalle.id.in_(det_ids))
                .delete(synchronize_session=False)
            )
        counts["embarque_detalle_melon"] = int(n or 0)

        # Embarques que quedaron sin detalles
        n_emb = 0
        for eid in emb_ids_touched:
            left = (
                db.query(EmbarqueDetalle)
                .filter(EmbarqueDetalle.embarque_id == eid)
                .count()
            )
            if left == 0:
                db.query(Embarque).filter(Embarque.id == eid).delete(
                    synchronize_session=False
                )
                n_emb += 1
        counts["embarque_solo_melon"] = n_emb

        db.commit()
        print("OK — melón en ceros:")
        for k, v in counts.items():
            print(f"  {k}: {v}")
        print("Conservado: limón/uva, users, clientes")
        return 0
    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())

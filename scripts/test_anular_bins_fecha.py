#!/usr/bin/env python3
"""
Prueba: mismo lote, dos fechas de corte → empacar → anular → bins vuelven a su fecha.

Causa raíz cubierta:
  - Al consumir se guarda fecha_recepcion en detalle_corrida.consumos
  - Al anular se devuelve a esa fecha (no se mezcla con otro corte del mismo lote)
  - Legacy sin fecha: reverse-FIFO por cupo de recepción
"""
from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

# BD temporal en memoria/sqlite de prueba
os.environ.setdefault("DATABASE_URL", "sqlite:///./agropack_test_anular_fecha.db")
os.environ.setdefault("SECRET_KEY", "test-anular-fecha")

from sqlalchemy.orm import Session  # noqa: E402
from app.core.database import SessionLocal, engine, Base  # noqa: E402
from app.models.enums import Producto, TipoMercado  # noqa: E402
from app.models.inventory import InventarioDesverdizado, RecepcionCampo  # noqa: E402
from app.routers.empaque import (  # noqa: E402
    _agregar_consumos_desverdizado,
    _devolver_bins_lote,
    _inferir_fechas_consumos_legacy,
)
from app.core.constants import DIAS_DESVERDIZADO  # noqa: E402


def stock_map(db: Session, lote: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in db.query(InventarioDesverdizado).filter(
        InventarioDesverdizado.lote == lote
    ):
        if (r.estado or "").lower() == "eliminado":
            continue
        fr = str(r.fecha_recepcion) if r.fecha_recepcion else "?"
        out[fr] = out.get(fr, 0) + int(r.cantidad_bins or 0)
    return out


def seed(db: Session) -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    lote = "TEST-8502"
    # Recepción 03-ago: 28 bins
    r1 = RecepcionCampo(
        fecha=date(2026, 8, 3),
        producto=Producto.LIMON_AMARILLO,
        mercado=TipoMercado.NACIONAL,
        cantidad_cajas_campo=0,
        lote=lote,
        cantidad_bins=28,
        fecha_corte=date(2026, 8, 3),
    )
    db.add(r1)
    db.flush()
    db.add(
        InventarioDesverdizado(
            producto=Producto.LIMON_AMARILLO,
            cantidad_bins=28,
            lote=lote,
            fecha_recepcion=date(2026, 8, 3),
            fecha_tentativa_salida=date(2026, 8, 3) + timedelta(days=DIAS_DESVERDIZADO),
            estado="listo_empaque",
            recepcion_id=r1.id,
        )
    )
    # Recepción 05-ago: 65 bins
    r2 = RecepcionCampo(
        fecha=date(2026, 8, 5),
        producto=Producto.LIMON_AMARILLO,
        mercado=TipoMercado.NACIONAL,
        cantidad_cajas_campo=0,
        lote=lote,
        cantidad_bins=65,
        fecha_corte=date(2026, 8, 5),
    )
    db.add(r2)
    db.flush()
    db.add(
        InventarioDesverdizado(
            producto=Producto.LIMON_AMARILLO,
            cantidad_bins=65,
            lote=lote,
            fecha_recepcion=date(2026, 8, 5),
            fecha_tentativa_salida=date(2026, 8, 5) + timedelta(days=DIAS_DESVERDIZADO),
            estado="listo_empaque",
            recepcion_id=r2.id,
        )
    )
    db.commit()


def check(cond: bool, msg: str, fails: list) -> None:
    if cond:
        print(f"  OK  {msg}")
    else:
        print(f"  FAIL {msg}")
        fails.append(msg)


def main() -> int:
    fails: list[str] = []
    db = SessionLocal()
    try:
        seed(db)
        lote = "TEST-8502"
        print("1) Stock inicial 28@03 + 65@05")
        m0 = stock_map(db, lote)
        check(m0.get("2026-08-03") == 28, f"03-ago=28 got {m0}", fails)
        check(m0.get("2026-08-05") == 65, f"05-ago=65 got {m0}", fails)

        print("2) Consumir 65 del 05-ago (con fecha explícita)")
        partes = _agregar_consumos_desverdizado(
            db,
            [{"lote": lote, "bins": 65, "fecha_recepcion": "2026-08-05"}],
        )
        db.commit()
        check(
            len(partes) == 1 and partes[0].get("fecha_recepcion") == "2026-08-05",
            f"desglose guarda fecha {partes}",
            fails,
        )
        m1 = stock_map(db, lote)
        check(m1.get("2026-08-03") == 28, f"03 intacto tras consumo got {m1}", fails)
        check(m1.get("2026-08-05", 0) == 0, f"05 agotado got {m1}", fails)

        # Simular empaque anulado vía devolver con fecha
        print("3) Devolver 65 al 05-ago (anular con fecha)")
        for p in partes:
            _devolver_bins_lote(db, p["lote"], p["bins"], p.get("fecha_recepcion"))
        db.commit()
        m2 = stock_map(db, lote)
        check(m2.get("2026-08-03") == 28, f"03 tras devolver={m2}", fails)
        check(m2.get("2026-08-05") == 65, f"05 restaurado={m2}", fails)

        print("4) Legacy: consumir sin fecha (FIFO toma 28@03 + 37@05)")
        # reset: 28@03 + 65@05 already
        partes2 = _agregar_consumos_desverdizado(
            db, [{"lote": lote, "bins": 65}]  # sin fecha → FIFO
        )
        db.commit()
        fechas = sorted(
            (p.get("fecha_recepcion"), p.get("bins")) for p in partes2
        )
        check(
            ("2026-08-03", 28) in fechas and ("2026-08-05", 37) in fechas,
            f"FIFO desglosa por fecha {partes2}",
            fails,
        )
        m3 = stock_map(db, lote)
        check(m3.get("2026-08-03", 0) == 0, f"03 vacío {m3}", fails)
        check(m3.get("2026-08-05", 0) == 28, f"05 queda 28 {m3}", fails)

        print("5) Devolver desglose con fechas (anular correcto)")
        for p in partes2:
            _devolver_bins_lote(db, p["lote"], p["bins"], p.get("fecha_recepcion"))
        db.commit()
        m4 = stock_map(db, lote)
        check(m4.get("2026-08-03") == 28, f"03 full {m4}", fails)
        check(m4.get("2026-08-05") == 65, f"05 full {m4}", fails)

        print("6) Legacy sin fecha en detalle: inferir reverse-FIFO y devolver")
        # Consumir solo 65@05 dejando 28@03
        _agregar_consumos_desverdizado(
            db, [{"lote": lote, "bins": 65, "fecha_recepcion": "2026-08-05"}]
        )
        db.commit()
        # Simular detalle viejo SOLO lote+bins
        legacy = [{"lote": lote, "bins": 65}]
        expanded = _inferir_fechas_consumos_legacy(db, legacy)
        check(
            any(
                e.get("fecha_recepcion") == "2026-08-05" and e.get("bins") == 65
                for e in expanded
            ),
            f"inferencia reverse-FIFO → 05-ago:65 got {expanded}",
            fails,
        )
        for e in expanded:
            _devolver_bins_lote(db, e["lote"], e["bins"], e.get("fecha_recepcion"))
        db.commit()
        m5 = stock_map(db, lote)
        check(m5.get("2026-08-03") == 28, f"legacy 03 {m5}", fails)
        check(m5.get("2026-08-05") == 65, f"legacy 05 {m5}", fails)

        print("\n=== RESULTADO ===")
        if fails:
            print(f"FALLÓ ({len(fails)}):")
            for f in fails:
                print(f"  - {f}")
            return 1
        print("TODOS LOS CHECKS OK")
        return 0
    finally:
        db.close()
        # cleanup test db
        try:
            p = BACKEND / "agropack_test_anular_fecha.db"
            if p.exists():
                p.unlink()
        except OSError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())

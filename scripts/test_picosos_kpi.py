#!/usr/bin/env python3
"""
Seis tarjetas del reporte de picosos y de tomatillo.

No toca ninguna base. Corre las funciones del frontend:
porcentajes sobre kilos consumidos, rendimiento por parrilla (1ra + 2da),
kg efectivos, tolva y la reserva de ton/ha.
Picosos cuentan bins. Tomatillo cuenta cajas de campo
(cada bin = 15 cajas). Limón y melón no entran.

    python3 scripts/test_picosos_kpi.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    proc = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            "--test",
            str(ROOT / "frontend" / "test" / "picososKpi.test.ts"),
        ],
        cwd=str(ROOT),
    )
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())

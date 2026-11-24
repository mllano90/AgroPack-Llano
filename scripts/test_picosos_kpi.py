#!/usr/bin/env python3
"""
Seis tarjetas del reporte de picosos.

No toca ninguna base. Corre las funciones del frontend:
porcentajes sobre kilos consumidos, bins por parrilla (1ra + 2da),
kg efectivos por bin, tolva y la reserva de ton/ha.
Tomatillo queda fuera.

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

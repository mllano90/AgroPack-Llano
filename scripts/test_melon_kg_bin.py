"""
% de 1ra y 2da del reporte de melón suman 100, y kg/bin es el kilo empacado.

No toca ninguna base. Solo corre la función del frontend.

    python3 scripts/test_melon_kg_bin.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAILS = []


def check(cond, msg):
    print(("OK  " if cond else "FAIL") + " " + msg)
    if not cond:
        FAILS.append(msg)


def main():
    proc = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            str(ROOT / "scripts" / "check_melon_kg_bin.ts"),
        ],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    check(proc.returncode == 0, f"node {proc.returncode} {proc.stderr[-400:]}")
    if proc.returncode != 0:
        print("\nFALLOS", len(FAILS))
        raise SystemExit(1)
    data = json.loads(proc.stdout)

    for r in data["resultados"]:
        etiqueta = f"{r['llano']}+{r['wallys']}"
        if r["llano"] + r["wallys"] > 0:
            check(r["suma"] == 100, f"{etiqueta} suma {r['suma']}")
            check(r["segundaEsResto"], f"{etiqueta} 2da = 100 - 1ra {r['pct']}")
        else:
            check(r["pct"]["primera"] == 0 and r["pct"]["segunda"] == 0, f"sin kilos {r['pct']}")
        kb = r["kgBin"]
        if r["llano"] + r["wallys"] != 260:
            check(
                kb["total"] == (r["llano"] + r["wallys"]) / 10,
                f"{etiqueta} kg/bin total {kb['total']}",
            )
        check(kb["llano"] == r["llano"] / (1 if r["llano"] + r["wallys"] == 260 else 10), f"{etiqueta} kg/bin 1ra")
        check(
            abs((kb["llano"] or 0) + (kb["wallys"] or 0) - (kb["total"] or 0)) < 1e-9,
            f"{etiqueta} 1ra/bin + 2da/bin = total/bin",
        )

    ej = data["ejemplo"]
    check(ej["kgBinLlano"] == 230 and ej["kgBinWallys"] == 30 and ej["kgBinTotal"] == 260, f"ejemplo 230+30=260 {ej}")
    pct_ej = next(r for r in data["resultados"] if r["llano"] == 230 and r["wallys"] == 30)
    check(pct_ej["pct"]["primera"] == 88.5 and pct_ej["pct"]["segunda"] == 11.5, f"ejemplo % {pct_ej['pct']}")

    vacia = data["sinBins"]
    check(
        vacia["kgBinLlano"] is None and vacia["kgBinWallys"] is None and vacia["kgBinTotal"] is None,
        f"bins 0 es null {vacia}",
    )

    tot = data["total"]
    check(data["totalCuadra"], "el total es kilos ÷ bins, no el promedio de los promedios")
    check(tot["bins"] == 6, f"bins total {tot['bins']}")
    check(tot["kgBinLlano"] == 1320 / 6, f"1ra/bin total {tot['kgBinLlano']}")
    check(tot["kgBinWallys"] == 160 / 6, f"2da/bin total {tot['kgBinWallys']}")
    check(tot["kgBinTotal"] == 1480 / 6, f"total/bin {tot['kgBinTotal']}")

    print("\nFALLOS", len(FAILS))
    for f in FAILS:
        print(" -", f)
    if FAILS:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

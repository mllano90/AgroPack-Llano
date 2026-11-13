"""
% de 1ra y 2da (jugo) de limón suman 100 sobre el kilo producido.

El bin de campo de 260 kg no es el denominador. El bin de jugo sí pesa 900 kg
y entra en el total (en el modelo, la 2da es el jugo).

No toca ninguna base. Corre la función de backend y la del frontend.

    python3 scripts/test_limon_porcentajes.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.utils.limon_pct import kg_real_por_bin, porcentajes_produccion  # noqa: E402

FAILS = []


def check(cond, msg):
    print(("OK  " if cond else "FAIL") + " " + msg)
    if not cond:
        FAILS.append(msg)


def main():
    # El caso de la ficha S2C1: 61,891.4 + 28,732 sobre 419 bins, no sobre 419×260.
    p1, p2 = porcentajes_produccion(61891.4, 28732)
    check(p1 + p2 == 100, f"S2C1 suma {p1}+{p2}")
    check(p1 == 68.3 and p2 == 31.7, f"S2C1 % {p1} {p2}")
    viejo = round(61891.4 / (419 * 260) * 100, 1)
    check(p1 != viejo, f"S2C1 ya no es el % sobre 260 kg ({viejo})")
    kb = kg_real_por_bin(61891.4 + 28732, 419)
    check(kb is not None and abs(kb - (90623.4 / 419)) < 1e-9, f"S2C1 kg/bin {kb}")

    # Jugo a 900 kg entra en el total. 4,500 de 1ra + 1 bin de jugo.
    p1, p2 = porcentajes_produccion(4500, 900)
    check(p1 == 83.3 and p2 == 16.7 and p1 + p2 == 100, f"jugo 900 entra {p1} {p2}")
    check(kg_real_por_bin(5400, 20) == 270, "20 bins → 270 kg/bin")

    # Redondeo: 33.35 y 66.65 por separado sumarían 100.1. El resto evita eso.
    p1, p2 = porcentajes_produccion(3335, 6665)
    check(p1 + p2 == 100, f"redondeo suma {p1}+{p2}")
    check(p2 == round(100 - p1, 1), f"2da es el resto {p1} {p2}")

    for a, b in ((1, 2), (1, 5), (2, 5), (0, 10), (10, 0), (1, 17), (243684, 14826)):
        p1, p2 = porcentajes_produccion(a, b)
        check(p1 + p2 == 100, f"{a}+{b} suma {p1}+{p2}")
        check(p2 == round(100 - p1, 1), f"{a}+{b} resto")

    p1, p2 = porcentajes_produccion(0, 0)
    check(p1 == 0 and p2 == 0, f"sin kilos {p1} {p2}")
    check(kg_real_por_bin(100, 0) is None, "bins 0 es None")
    check(kg_real_por_bin(0, 4) == 0, "kilos 0 con bins es 0")

    # El total de varios lotes es kilos ÷ bins, no el promedio de los promedios.
    total = kg_real_por_bin(920 + 400, 4 + 2)
    promedio = (kg_real_por_bin(920, 4) + kg_real_por_bin(400, 2)) / 2
    check(total == 1320 / 6, f"total lotes {total}")
    check(total != promedio, "no es el promedio de los promedios")

    proc = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            str(ROOT / "scripts" / "check_limon_porcentajes.ts"),
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
        py = porcentajes_produccion(r["primera"], r["segunda"])
        etiqueta = f"{r['primera']}+{r['segunda']}"
        check(r["pct"]["primera"] == py[0] and r["pct"]["segunda"] == py[1], f"js=py {etiqueta}")
        if r["primera"] + r["segunda"] > 0:
            check(r["suma"] == 100, f"js suma {etiqueta} {r['suma']}")
            check(r["segundaEsResto"], f"js resto {etiqueta}")
        else:
            check(r["pct"]["primera"] == 0 and r["pct"]["segunda"] == 0, f"js sin kilos {r['pct']}")
        py_bin = kg_real_por_bin(r["primera"] + r["segunda"], r["bins"])
        js_bin = r["kgBin"]
        if py_bin is None:
            check(js_bin is None, f"js bins 0 {etiqueta}")
        else:
            check(js_bin is not None and abs(js_bin - py_bin) < 1e-9, f"js kg/bin {etiqueta}")

    check(data["totalCuadra"], "js total es kilos ÷ bins")
    check(data["noEsPromedioDePromedios"], "js no promedia los promedios")

    print("\nFALLOS", len(FAILS))
    for f in FAILS:
        print(" -", f)
    if FAILS:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

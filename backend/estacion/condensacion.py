"""Probabilidad de condensación dentro de la caja (sensor XY-MD01).

Si falta la temperatura o la humedad, el resultado es None: nunca se inventa un 0.
"""
import math


def _par(t, rh):
    if t is None or rh is None:
        return None
    try:
        t = float(t)
        rh = float(rh)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(t) or not math.isfinite(rh):
        return None
    if t <= -243.04:
        return None
    return t, rh


def punto_rocio(t, rh):
    """Punto de rocío Magnus-Tetens (°C), sin redondear. None si falta T o RH."""
    par = _par(t, rh)
    if par is None:
        return None
    t, rh = par
    rh_c = min(max(rh, 0.1), 100.0)
    gamma = math.log(rh_c / 100.0) + (17.625 * t) / (243.04 + t)
    den = 17.625 - gamma
    if den == 0:
        return None
    return (243.04 * gamma) / den


def condensacion_pct(t, rh):
    """Probabilidad 0–100 % a 1 decimal para una caja electrónica al exterior.

    100 si la humedad es ≥ 98 % o el margen al rocío es ≤ 0.3 °C.
    0 si el margen es ≥ 10 °C. En medio, logística centrada en 2.8 °C.
    """
    par = _par(t, rh)
    if par is None:
        return None
    t, rh = par
    td = punto_rocio(t, rh)
    if td is None:
        return None
    delta = t - td
    if rh >= 98.0 or delta <= 0.3:
        p = 100.0
    elif delta >= 10.0:
        p = 0.0
    else:
        p = 100.0 / (1.0 + math.exp(0.95 * (delta - 2.8)))
    if p < 0.0:
        p = 0.0
    elif p > 100.0:
        p = 100.0
    return round(p, 1)


def rellenar_condensacion(cx) -> int:
    """Completa caja_condensacion_pct donde ya hay T y RH de caja y el porcentaje es NULL.

    Las lecturas sin temperatura o sin humedad se quedan en NULL. Volver a correrlo no pisa lo ya guardado.
    """
    filas = cx.todos(
        "SELECT id, t_int, h_int FROM estacion_lecturas "
        "WHERE t_int IS NOT NULL AND h_int IS NOT NULL AND caja_condensacion_pct IS NULL")
    n = 0
    for f in filas:
        pct = condensacion_pct(f["t_int"], f["h_int"])
        if pct is None:
            continue
        cx.ejecutar(
            "UPDATE estacion_lecturas SET caja_condensacion_pct = ? WHERE id = ? AND caja_condensacion_pct IS NULL",
            (pct, f["id"]))
        n += 1
    return n

"""
Porcentajes de limón sobre el kilo producido, no sobre el bin de campo de 260 kg.

La 2da del limón es el jugo. El bin de jugo sí pesa 900 kg (peso de la
presentación, igual que una caja). Ese kilo entra en el total. No hay una
tercera calidad distinta del jugo: contarlo aparte lo duplicaría.

% 2da = 100 − % 1ra ya redondeado, para que los dos sumen 100.
"""
from __future__ import annotations

import math


def _redondear(valor: float, decimales: int) -> float:
    """Medio hacia arriba, igual que Math.round del frontend (valores ≥ 0)."""
    if not math.isfinite(valor):
        return 0.0
    factor = 10 ** decimales
    return math.floor(valor * factor + 0.5) / factor


def porcentajes_produccion(kg_primera: float, kg_segunda: float) -> tuple[float, float]:
    """
    % de la producción real: kg 1ra (RPC/cartón) + kg 2da (bins de jugo × 900).

    Sin kilos devuelve (0, 0). No usa el peso estimado del bin de campo.
    """
    try:
        kg1 = float(kg_primera or 0)
        kg2 = float(kg_segunda or 0)
    except (TypeError, ValueError):
        return 0.0, 0.0
    total = kg1 + kg2
    if not math.isfinite(total) or not (total > 0):
        return 0.0, 0.0
    primera = _redondear(kg1 / total * 100, 1)
    segunda = _redondear(100.0 - primera, 1)
    return primera, segunda


def kg_real_por_bin(kg_producidos: float, bins_campo: float) -> float | None:
    """
    Kilos producidos ÷ bins de campo procesados.

    None si no hay bins: no se inventa un promedio. El 260 kg no entra aquí.
    """
    try:
        bins = float(bins_campo)
        kg = float(kg_producidos or 0)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(bins) or not math.isfinite(kg) or bins <= 0:
        return None
    return kg / bins

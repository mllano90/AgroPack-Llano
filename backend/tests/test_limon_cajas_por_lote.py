"""Cajas de cartón, cajas RPC y bins de jugo de 2da por lote de limón.

No toca la base: arma registros de empaque en memoria y llama la misma
agregación que usa GET /api/reports/rendimientos-limon.

    python3 backend/tests/test_limon_cajas_por_lote.py
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import date
from pathlib import Path

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-limon-cajas")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.enums import Producto  # noqa: E402
from app.routers.reports import (  # noqa: E402
    _producto_es_limon,
    _rendimientos_por_lote,
    _split_produccion,
)


class _Empaque:
    def __init__(self, **kwargs):
        self.id = kwargs.get("id", 1)
        self.fecha = kwargs.get("fecha", date(2026, 8, 1))
        self.numero_empacador = "EMP-01"
        self.detalle_corrida = kwargs.get("detalle")
        self.bins_desverdizado_usados = kwargs.get("bins", 0)
        self.lote_desverdizado = kwargs.get("lote")
        self.presentacion = kwargs.get("presentacion")
        self.talla = kwargs.get("talla")
        self.cantidad_producida = kwargs.get("cantidad", 0)
        self.producto = kwargs.get("producto", Producto.LIMON_AMARILLO)


def _por_lote(nombre: str, rows: list):
    found = [r for r in _rendimientos_por_lote(rows) if r.lote == nombre]
    if len(found) != 1:
        raise AssertionError(f"lote {nombre!r}: {[(r.lote, r.cajas_rpc, r.cajas_carton, r.bins_jugo) for r in _rendimientos_por_lote(rows)]}")
    return found[0]


class TestCajasYBinsJugoLimon(unittest.TestCase):
    def test_presentacion_separa_carton_rpc_y_jugo_por_cantidad(self):
        sp = _split_produccion(
            [
                {"presentacion": "rpc_12", "cantidad": 10},
                {"presentacion": "rpc_18", "cantidad": 5},
                {"presentacion": "caja_40lbs", "cantidad": 2},
                {"presentacion": " Caja_40lbs ", "cantidad": 3},
                {"presentacion": "rpc_granel", "cantidad": 100},
                {"presentacion": "bins_jugo", "cantidad": 4},
                {"presentacion": "bins_jugo", "cantidad": 0},
                # RPC marcado 2da sigue siendo caja RPC, no bin de jugo.
                {"presentacion": "rpc_18", "calidad": "segunda", "cantidad": 7},
            ]
        )
        self.assertEqual(sp["cajas_rpc"], 22)
        self.assertEqual(sp["cajas_carton"], 5)
        self.assertEqual(sp["bins_jugo"], 4)
        self.assertEqual(sp["rpc_granel_producido"], 100)
        # 5 cajas de cartón × 18 kg. El conteo no es el peso.
        self.assertEqual(sp["kg_carton"], 90)
        self.assertNotEqual(sp["cajas_carton"], sp["kg_carton"])
        self.assertEqual(sp["kg_segunda"], 4 * 900)

    def test_lote_suma_cajas_y_bins_de_jugo(self):
        row = _por_lote(
            "8500 S1C1",
            [
                _Empaque(
                    id=1,
                    detalle={
                        "consumos": [{"lote": "8500 S1C1", "bins": 8}],
                        "produccion": [
                            {"presentacion": "rpc_12", "cantidad": 40},
                            {"presentacion": "rpc_18", "cantidad": 15},
                            {"presentacion": "caja_40lbs", "cantidad": 63},
                            {"presentacion": "bins_jugo", "cantidad": 6},
                            {"presentacion": "rpc_granel", "cantidad": 20},
                        ],
                    },
                )
            ],
        )
        self.assertEqual(row.cajas_rpc, 55)
        self.assertEqual(row.cajas_carton, 63)
        self.assertEqual(row.bins_jugo, 6)
        self.assertEqual(row.bins_campo, 8)

    def test_multi_lote_prorratea_por_bins_y_agrupa_fecha_de_corte(self):
        mezclado = _Empaque(
            id=1,
            detalle={
                "consumos": [
                    {"lote": "8500 S1C1", "bins": 3},
                    {"lote": "8502 S2C1@2026-08-05", "bins": 1},
                ],
                "produccion": [
                    {"presentacion": "rpc_18", "cantidad": 40},
                    {"presentacion": "caja_40lbs", "cantidad": 8},
                    {"presentacion": "bins_jugo", "cantidad": 4},
                ],
            },
        )
        otro_dia = _Empaque(
            id=2,
            fecha=date(2026, 8, 6),
            detalle={
                "consumos": [{"lote": "8502 S2C1", "bins": 2}],
                "produccion": [
                    {"presentacion": "caja_40lbs", "cantidad": 10},
                    {"presentacion": "bins_jugo", "cantidad": 1},
                ],
            },
        )
        a = _por_lote("8500 S1C1", [mezclado, otro_dia])
        b = _por_lote("8502 S2C1", [mezclado, otro_dia])
        self.assertEqual((a.cajas_rpc, a.cajas_carton, a.bins_jugo), (30, 6, 3))
        self.assertTrue(a.prorrateado)
        # 1/4 del mix + el día propio, misma clave aunque uno traiga @fecha.
        self.assertEqual((b.cajas_rpc, b.cajas_carton, b.bins_jugo), (10, 12, 2))
        self.assertEqual(b.bins_campo, 3)

    def test_conversion_suma_cajas_finales_al_lote_y_anulado_no_cuenta(self):
        campo = _Empaque(
            id=1,
            detalle={
                "consumos": [{"lote": "8501 S1C2", "bins": 10}],
                "produccion": [
                    {
                        "presentacion": "rpc_granel",
                        "cantidad": 50,
                        "lote": "8501 S1C2",
                        "fecha_empaque": "2026-08-01",
                    },
                    {"presentacion": "bins_jugo", "cantidad": 2},
                    {"presentacion": "rpc_18", "cantidad": 10},
                ],
            },
        )
        conversion = _Empaque(
            id=2,
            fecha=date(2026, 8, 2),
            detalle={
                "tipo": "conversion_rpc_granel",
                "consumos_granel": [
                    {
                        "lote": "8501 S1C2",
                        "fecha_empaque": "2026-08-01",
                        "cantidad": 50,
                    }
                ],
                "produccion": [
                    {"presentacion": "caja_40lbs", "cantidad": 20},
                    {"presentacion": "rpc_12", "cantidad": 4},
                ],
            },
        )
        anulado = _Empaque(
            id=3,
            detalle={
                "anulado": True,
                "consumos": [{"lote": "8501 S1C2", "bins": 99}],
                "produccion": [
                    {"presentacion": "caja_40lbs", "cantidad": 500},
                    {"presentacion": "bins_jugo", "cantidad": 80},
                ],
            },
        )
        row = _por_lote("8501 S1C2", [campo, conversion, anulado])
        self.assertEqual(row.cajas_rpc, 14)
        self.assertEqual(row.cajas_carton, 20)
        self.assertEqual(row.bins_jugo, 2)
        self.assertEqual(row.bins_campo, 10)

    def test_registro_legacy_sin_detalle_usa_presentacion(self):
        row = _por_lote(
            "9001 S2C2",
            [
                _Empaque(
                    id=4,
                    detalle=None,
                    bins=4,
                    lote="9001 S2C2",
                    presentacion="caja_40lbs",
                    cantidad=12,
                )
            ],
        )
        self.assertEqual(row.cajas_carton, 12)
        self.assertEqual(row.cajas_rpc, 0)
        self.assertEqual(row.bins_jugo, 0)

    def test_el_reporte_de_limon_no_mezcla_melon(self):
        self.assertTrue(_producto_es_limon(Producto.LIMON_AMARILLO))
        self.assertFalse(_producto_es_limon(Producto.MELON))
        self.assertFalse(_producto_es_limon("melon"))


if __name__ == "__main__":
    unittest.main()

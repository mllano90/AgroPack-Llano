/**
 * Aplica el cálculo de las tarjetas de melón (inventario + embarcado).
 * Lo llama scripts/test_melon_cajas_inventario.py. No escribe en la base.
 *
 * stdin: { inventario, embarques, empaques, ha }
 */
import { readFileSync } from 'node:fs';
import { sumaKgTallas } from '../frontend/src/lib/melonDistribucionTallas.ts';
import {
  binsDeProceso,
  distribucionDesdeLineas,
  kpiDesdeLineas,
  lineasProducidasMelon,
  variedadDeLinea,
} from '../frontend/src/lib/melonCajasInventario.ts';

const PESO: Record<string, number> = {
  caja_chica_a: 15,
  caja_normal_b: 18,
  caja_jumbo_c: 21,
};

const raw = readFileSync(0, 'utf8');
const data = JSON.parse(raw) as {
  inventario: Array<Record<string, unknown>>;
  embarques: Array<Record<string, unknown>>;
  empaques: Array<Record<string, unknown>>;
  ha?: number;
};

const peso = (pres: string, _talla?: string | null) => PESO[pres] ?? PESO.caja_normal_b;
const lineas = lineasProducidasMelon(data.inventario as never, data.embarques as never);
const bins = (data.empaques || []).reduce((s, e) => s + binsDeProceso(e as never), 0);
const kpi = kpiDesdeLineas(lineas, bins, Number(data.ha) || 0, peso);
const tallas = sumaKgTallas(distribucionDesdeLineas(lineas, peso, 'simple'));
const porVariedad: Record<string, number> = {};
for (const ln of lineas) {
  const v = variedadDeLinea(ln.lote);
  porVariedad[v] = (porVariedad[v] || 0) + ln.cajas;
}

process.stdout.write(
  JSON.stringify({
    cajasTotal: kpi.cajasTotal,
    cajasLlano: kpi.cajasLlano,
    cajasWallys: kpi.cajasWallys,
    kgTotal: kpi.kgTotal,
    bins: kpi.bins,
    parrillas: kpi.parrillas,
    pctSuma: Math.round((kpi.pctLlano + kpi.pctWallys) * 10) / 10,
    tallasCajas: tallas.cajas,
    porVariedad,
  })
);

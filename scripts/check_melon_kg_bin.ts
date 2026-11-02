/**
 * Comprueba los % y el kg/bin del reporte de melón (funciones reales).
 * Lo llama scripts/test_melon_kg_bin.py. No escribe nada.
 */
import { filaKgPorBin, kgPorBin, porcentajesQueSuman100 } from '../frontend/src/components/Reportes/melonKpi.ts';

const pares: Array<[number, number]> = [
  [230, 30],
  [1, 2],
  [1, 5],
  [2, 5],
  [1, 17],
  [0, 10],
  [10, 0],
  [0, 0],
  [243684, 14826],
];

const resultados = pares.map(([llano, wallys]) => {
  const pct = porcentajesQueSuman100(llano, wallys);
  const bins = llano + wallys === 260 ? 1 : 10;
  const fila = filaKgPorBin('x', bins, llano, wallys);
  return {
    llano,
    wallys,
    pct,
    suma: Math.round((pct.primera + pct.segunda) * 10) / 10,
    segundaEsResto: Math.round((100 - pct.primera) * 10) / 10 === pct.segunda,
    kgBin: {
      llano: kgPorBin(llano, bins),
      wallys: kgPorBin(wallys, bins),
      total: kgPorBin(llano + wallys, bins),
    },
    fila,
  };
});

const ejemplo = filaKgPorBin('Diputado', 1, 230, 30);
const sinBins = filaKgPorBin('Vacía', 0, 100, 20);
const dip = filaKgPorBin('Diputado', 4, 920, 120);
const kry = filaKgPorBin('Krypto', 2, 400, 40);
const total = filaKgPorBin('Total', dip.bins + kry.bins, dip.kgLlano + kry.kgLlano, dip.kgWallys + kry.kgWallys);

console.log(
  JSON.stringify({
    resultados,
    ejemplo,
    sinBins,
    total,
    totalCuadra:
      total.kgBinTotal === (dip.kgLlano + kry.kgLlano + dip.kgWallys + kry.kgWallys) / (dip.bins + kry.bins),
  })
);

/**
 * Comprueba los % y el kg/bin de limón (funciones reales del frontend).
 * Lo llama scripts/test_limon_porcentajes.py. No escribe nada.
 */
import { kgRealPorBin, porcentajesQueSuman100 } from '../frontend/src/components/Reportes/limonKpi.ts';

const pares: Array<[number, number, number]> = [
  [61891.4, 28732, 419],
  [4500, 900, 20],
  [3335, 6665, 10],
  [1, 2, 3],
  [1, 5, 1],
  [2, 5, 4],
  [0, 10, 2],
  [10, 0, 2],
  [0, 0, 5],
  [100, 0, 0],
];

const resultados = pares.map(([primera, segunda, bins]) => {
  const pct = porcentajesQueSuman100(primera, segunda);
  const total = primera + segunda;
  return {
    primera,
    segunda,
    bins,
    pct,
    suma: Math.round((pct.primera + pct.segunda) * 10) / 10,
    segundaEsResto: Math.round((100 - pct.primera) * 10) / 10 === pct.segunda,
    kgBin: kgRealPorBin(total, bins),
  };
});

const loteA = { kg: 920, bins: 4 };
const loteB = { kg: 400, bins: 2 };
const totalLotes = kgRealPorBin(loteA.kg + loteB.kg, loteA.bins + loteB.bins);
const promedioDePromedios =
  ((kgRealPorBin(loteA.kg, loteA.bins) || 0) + (kgRealPorBin(loteB.kg, loteB.bins) || 0)) / 2;

console.log(
  JSON.stringify({
    resultados,
    totalLotes,
    promedioDePromedios,
    totalCuadra: totalLotes === (loteA.kg + loteB.kg) / (loteA.bins + loteB.bins),
    noEsPromedioDePromedios: totalLotes !== promedioDePromedios,
  })
);

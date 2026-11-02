/**
 * Porcentajes y kg/bin del reporte de melón.
 * El % es del kilo empacado (1ra + 2da), no del peso teórico del bin.
 */

export function porcentajesQueSuman100(
  primeraKg: number,
  segundaKg: number
): { primera: number; segunda: number } {
  const total = primeraKg + segundaKg;
  if (!(total > 0)) return { primera: 0, segunda: 0 };
  const primera = Math.round((primeraKg / total) * 1000) / 10;
  const segunda = Math.round((100 - primera) * 10) / 10;
  return { primera, segunda };
}

/** null si no hay bins: no se inventa un promedio. */
export function kgPorBin(kg: number, bins: number): number | null {
  if (!(bins > 0) || !Number.isFinite(kg)) return null;
  return kg / bins;
}

export type FilaKgPorBin = {
  variedad: string;
  bins: number;
  kgLlano: number;
  kgWallys: number;
  kgBinLlano: number | null;
  kgBinWallys: number | null;
  kgBinTotal: number | null;
};

export function filaKgPorBin(
  variedad: string,
  bins: number,
  kgLlano: number,
  kgWallys: number
): FilaKgPorBin {
  return {
    variedad,
    bins,
    kgLlano,
    kgWallys,
    kgBinLlano: kgPorBin(kgLlano, bins),
    kgBinWallys: kgPorBin(kgWallys, bins),
    kgBinTotal: kgPorBin(kgLlano + kgWallys, bins),
  };
}

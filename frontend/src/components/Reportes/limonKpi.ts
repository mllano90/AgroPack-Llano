/**
 * Porcentajes y kg/bin de limón.
 * El % es del kilo producido (1ra + jugo a 900 kg), no del bin de campo de 260 kg.
 * La 2da es el jugo: no se suma otra vez como tercera categoría.
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

/** null si no hay bins de campo: no se inventa un promedio. */
export function kgRealPorBin(kg: number, bins: number): number | null {
  if (!(bins > 0) || !Number.isFinite(kg)) return null;
  return kg / bins;
}

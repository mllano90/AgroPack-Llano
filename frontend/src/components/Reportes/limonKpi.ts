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

function kiloNoNegativo(n: number): number {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return x;
}

function unDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * % de RPC, cartón y jugo sobre el mismo kilo producido.
 * El jugo es el resto, así que los tres suman 100.
 */
export function porcentajesRpcCartonJugo(
  kgRpc: number,
  kgCarton: number,
  kgJugo: number
): { rpc: number; carton: number; jugo: number } {
  const rpcKg = kiloNoNegativo(kgRpc);
  const cartonKg = kiloNoNegativo(kgCarton);
  const jugoKg = kiloNoNegativo(kgJugo);
  const total = rpcKg + cartonKg + jugoKg;
  if (!(total > 0)) return { rpc: 0, carton: 0, jugo: 0 };
  const rpc = unDecimal((rpcKg / total) * 100);
  const resto = unDecimal(100 - rpc);
  const restoKg = cartonKg + jugoKg;
  if (!(restoKg > 0)) return { rpc, carton: 0, jugo: 0 };
  const carton = unDecimal((cartonKg / restoKg) * resto);
  const jugo = unDecimal(resto - carton);
  return { rpc, carton, jugo };
}

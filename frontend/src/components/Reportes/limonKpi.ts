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

/**
 * % de 1ra calidad sobre el mismo kilo producido que RPC / cartón / jugo.
 * Es % RPC + % cartón (ya redondeados). Con el % de jugo suma 100.
 */
export function pctPrimeraCalidad(partes: { rpc: number; carton: number }): number {
  const rpc = Number(partes.rpc);
  const carton = Number(partes.carton);
  if (!Number.isFinite(rpc) || !Number.isFinite(carton)) return 0;
  return unDecimal(rpc + carton);
}

/** Cada bin de jugo pesa 900 kg y en el modelo ya cuenta como 1 parrilla. */
export const KG_BIN_JUGO = 900;

function dosDecimales(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Rendimiento en bins de campo por parrilla.
 *
 * Solo 1ra: bins de campo ÷ parrillas de 1ra. Es el número que ya se mostraba.
 *
 * General (1ra + 2da): bins de campo ÷ (parrillas de 1ra + unidades de 2da).
 * La 2da del limón es el jugo. No hay otra "parrilla de 2da": parrillas_jugo
 * es el conteo de bins de jugo, y cada uno es una unidad de 900 kg.
 * Si no vienen unidades, se derivan de kg de jugo ÷ 900.
 *
 * null si no hay bins de campo o el denominador no es positivo.
 */
export function rendimientoBinsPorParrilla(
  binsCampo: number,
  parrillasPrimera: number,
  unidadesSegunda?: number | null,
  kgSegunda?: number | null
): { general: number | null; soloPrimera: number | null; unidadesSegunda: number } {
  const bins = Number(binsCampo);
  const p1raw = Number(parrillasPrimera);
  const p1 = Number.isFinite(p1raw) && p1raw > 0 ? p1raw : 0;
  if (!Number.isFinite(bins) || bins <= 0) {
    return { general: null, soloPrimera: null, unidadesSegunda: 0 };
  }
  const soloPrimera = p1 > 0 ? dosDecimales(bins / p1) : null;

  let u2 = unidadesSegunda == null ? Number.NaN : Number(unidadesSegunda);
  const kg2 = Number(kgSegunda);
  const desdeKg = Number.isFinite(kg2) && kg2 > 0 ? kg2 / KG_BIN_JUGO : 0;
  // Sin conteo de bins (o en cero habiendo kilos) cada 900 kg de jugo es una unidad.
  if (!Number.isFinite(u2) || u2 < 0 || (u2 === 0 && desdeKg > 0)) {
    u2 = desdeKg;
  }
  const den = p1 + u2;
  const general = den > 0 ? dosDecimales(bins / den) : null;
  return { general, soloPrimera, unidadesSegunda: u2 };
}

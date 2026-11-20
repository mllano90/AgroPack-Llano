/** µmol/m²/s por cada W/m². Base de malla sombra blanca o neutra bajo luz solar. */
export const FACTOR_PAR_BASE = 2.02;
export const FACTOR_PAR_MIN = 0.5;
export const FACTOR_PAR_MAX = 4.5;

/** PAR medido / radiación de la estación. Null si la radiación no sirve para dividir. */
export function factorDeCampo(parMedido: number, wm2: number): number | null {
  if (!Number.isFinite(parMedido) || !Number.isFinite(wm2) || wm2 <= 0 || parMedido < 0) return null;
  return Math.round((parMedido / wm2) * 1000) / 1000;
}

export function factorValido(v: number): boolean {
  return Number.isFinite(v) && v >= FACTOR_PAR_MIN && v <= FACTOR_PAR_MAX;
}

/**
 * Cada cuánto llega una lectura NUEVA de cada variable (segundos). Las de suelo de frecuencia larga solo se
 * guardan cuando cambian de muestreo: CE, pH, N, P y K una vez por ciclo de 30 min, y T/H de suelo en los
 * min 0/6/12/18 del ciclo (hueco de 12 min). Con el crudo cada 2 min, la regla "3 pasos" cortaba la línea y
 * quedaban solo puntos sueltos: aquí el hueco tolerado es el mayor entre 3 pasos y 2.5 ciclos.
 */
export const CADENCIA_S: Record<string, number> = { ec: 1800, ph: 1800, n: 1800, p: 1800, k: 1800, t_suelo: 1800, h_suelo: 1800 };

/** Hueco máximo (ms) que se une con línea; más grande = falta de datos (se corta la línea). */
export function huecoMs(v: string, paso_s: number): number {
  return Math.max(paso_s * 3, (CADENCIA_S[v] ?? 0) * 2.5) * 1000;
}

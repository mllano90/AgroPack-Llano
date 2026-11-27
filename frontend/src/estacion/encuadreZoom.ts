/** Encuadre del zoom vertical anclado a la lectura bajo la línea, no al 50 % del eje. */

import { lecturaEnCursor, type Muestra } from './lecturaMira.ts';

export type RangoY = { min: number; max: number };
export type LimitesY = { min?: number; max?: number };
export type SerieCursor = { pts: Muestra[]; huecoMs: number };

const EPS = 1e-6;

export function puntoMedio(valores: number[]): number | null {
  const ok = valores.filter(v => Number.isFinite(v));
  if (!ok.length) return null;
  return (Math.min(...ok) + Math.max(...ok)) / 2;
}

/** Centra `span` en el ancla y, si choca con un límite, corre toda la ventana sin cambiar el span. */
export function encuadreEnAncla(anchorY: number, span: number, limites?: LimitesY): RangoY {
  const ancho = Math.max(span, EPS);
  let min = anchorY - ancho / 2;
  let max = anchorY + ancho / 2;
  const lo = limites?.min;
  const hi = limites?.max;
  if (lo != null && hi != null && hi - lo <= ancho + EPS) return { min: lo, max: hi };
  if (lo != null && min < lo) {
    min = lo;
    max = lo + ancho;
  }
  if (hi != null && max > hi) {
    max = hi;
    min = hi - ancho;
  }
  if (lo != null && min < lo) min = lo;
  return { min, max };
}

/**
 * Acerca (factor > 1) o aleja (factor < 1). El span nuevo es el actual dividido por el factor:
 * 2× deja la mitad de alto, centrado en el ancla.
 */
export function zoomEnAncla(actual: RangoY, anchorY: number, factor: number, limites?: LimitesY): RangoY {
  const span = actual.max - actual.min;
  if (!(span > 0) || !(factor > 0) || !Number.isFinite(anchorY)) return { min: actual.min, max: actual.max };
  return encuadreEnAncla(anchorY, span / factor, limites);
}

/**
 * Con el zoom ya puesto, corre el encuadre (mismo span) si el punto se acerca al borde o se sale.
 * Si ya está holgado, no mueve nada.
 */
export function seguirPunto(actual: RangoY, punto: number, limites?: LimitesY, margenFraccion = 0.18): RangoY {
  const span = actual.max - actual.min;
  if (!(span > 0) || !Number.isFinite(punto)) return { min: actual.min, max: actual.max };
  const margen = span * margenFraccion;
  if (punto >= actual.min + margen && punto <= actual.max - margen) return { min: actual.min, max: actual.max };
  const min = punto < actual.min + margen ? punto - margen : punto - (span - margen);
  return encuadreEnAncla(min + span / 2, span, limites);
}

/**
 * Ancla del zoom: lecturas bajo la línea, o si es un hueco el valor válido más cercano
 * (dentro de lo visible, si lo hay). Nunca el centro vacío del eje.
 */
export function anclaEnCursor(
  series: SerieCursor[],
  t: number,
  visible?: { tMin: number; tMax: number },
): number | null {
  const activos: number[] = [];
  for (const s of series) {
    const lec = lecturaEnCursor(s.pts, t, s.huecoMs);
    if (lec.hay) activos.push(lec.y);
  }
  const medio = puntoMedio(activos);
  if (medio != null) return medio;

  const todas = series.flatMap(s => s.pts).filter(p => Number.isFinite(p.t) && Number.isFinite(p.y));
  if (!todas.length || !Number.isFinite(t)) return null;
  const enPantalla = visible ? todas.filter(p => p.t >= visible.tMin && p.t <= visible.tMax) : [];
  const base = enPantalla.length ? enPantalla : todas;
  let mejor = Infinity;
  const ys: number[] = [];
  for (const p of base) {
    const d = Math.abs(p.t - t);
    if (d + EPS < mejor) {
      mejor = d;
      ys.length = 0;
      ys.push(p.y);
    } else if (Math.abs(d - mejor) <= EPS) ys.push(p.y);
  }
  return puntoMedio(ys);
}

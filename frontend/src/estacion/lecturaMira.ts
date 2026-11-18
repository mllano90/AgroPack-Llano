/** Lectura bajo la retícula. No interpola: si el instante cae en un hueco, no hay valor. */

export type Muestra = { t: number; y: number };

export type LecturaCursor = { hay: true; t: number; y: number } | { hay: false };

/**
 * Punto exacto más cercano al instante `t` (ms).
 * Si `t` queda entre dos muestras separadas por más de `huecoMs`, o fuera de
 * ese margen respecto de la única muestra vecina, es un hueco.
 */
export function lecturaEnCursor(puntos: Muestra[], t: number, huecoMs: number): LecturaCursor {
  if (!puntos.length || !Number.isFinite(t) || huecoMs < 0) return { hay: false };
  let i = 0;
  while (i < puntos.length && puntos[i].t < t) i++;
  const der = puntos[i];
  const izq = i > 0 ? puntos[i - 1] : undefined;
  if (izq && der) {
    if (der.t - izq.t > huecoMs) return { hay: false };
    const cerca = Math.abs(t - izq.t) <= Math.abs(der.t - t) ? izq : der;
    return { hay: true, t: cerca.t, y: cerca.y };
  }
  const solo = izq ?? der;
  if (!solo || Math.abs(t - solo.t) > huecoMs) return { hay: false };
  return { hay: true, t: solo.t, y: solo.y };
}

/** Límites del paneo para que el primer y el último instante puedan quedar en el centro. */
export function limitesPaneo(desde: number, hasta: number) {
  const ancho = Math.max(0, hasta - desde);
  return { min: desde - ancho / 2, max: hasta + ancho / 2, ancho };
}

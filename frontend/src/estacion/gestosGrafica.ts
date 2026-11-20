/** Decide el gesto de un dedo dentro del área de trazado. */
export function decidirGesto(dx: number, dy: number, umbral = 8): 'esperar' | 'horizontal' | 'vertical' {
  if (Math.abs(dx) < umbral && Math.abs(dy) < umbral) return 'esperar';
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
}

/** El pellizco solo escala valores si se abre en vertical. Devuelve null si es horizontal. */
export function razonPellizcoVertical(sepX: number, sepY: number, sepYAntes: number): number | null {
  if (!(Math.abs(sepY) > Math.abs(sepX))) return null;
  if (Math.abs(sepYAntes) < 12) return null;
  const razon = Math.abs(sepY) / Math.abs(sepYAntes);
  if (!Number.isFinite(razon) || razon <= 0) return null;
  return Math.min(1.25, Math.max(0.8, razon));
}

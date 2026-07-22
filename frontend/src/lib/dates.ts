/**
 * Utilidades de fecha sin desfase de zona horaria.
 * `new Date("YYYY-MM-DD")` se interpreta como UTC medianoche y en México
 * muestra el día anterior. Usamos mediodía local o parse por partes.
 */

/** Parsea YYYY-MM-DD (o con T...) a Date en calendario local. */
export function parseDateLocal(fecha: string | null | undefined): Date | null {
  if (!fecha) return null;
  const s = String(fecha).trim();
  // YYYY-MM-DD or YYYY-MM-DDTHH:mm...
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    return new Date(y, mo, d, 12, 0, 0, 0);
  }
  // DD/MM/YYYY
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m2) {
    const d = parseInt(m2[1], 10);
    const mo = parseInt(m2[2], 10) - 1;
    const y = parseInt(m2[3], 10);
    return new Date(y, mo, d, 12, 0, 0, 0);
  }
  const date = new Date(s);
  if (isNaN(date.getTime())) return null;
  return date;
}

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

/** Hoy como YYYY-MM-DD (local) para inputs type=date */
export function todayInputDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Formato: 08 JUL 2026 */
export function formatFechaCorta(fecha: string | null | undefined): string {
  if (!fecha) return '—';
  const date = parseDateLocal(fecha);
  if (!date) return String(fecha);
  const d = String(date.getDate()).padStart(2, '0');
  const mes = MESES[date.getMonth()];
  const y = date.getFullYear();
  return `${d} ${mes} ${y}`;
}

/** Formato ISO local YYYY-MM-DD para inputs type=date */
export function toInputDate(fecha: string | null | undefined): string {
  if (!fecha) return '';
  const m = String(fecha).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const date = parseDateLocal(fecha);
  if (!date) return '';
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

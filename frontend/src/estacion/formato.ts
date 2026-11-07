export const TZ = 'America/Hermosillo';
const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-MX', { timeZone: TZ, hour12: false, ...o });
export const fHora = f({ hour: '2-digit', minute: '2-digit' });
export const fHoraS = f({ hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const fFecha = f({ day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fDia = f({ day: '2-digit', month: 'short' });

export const num = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '--' : Number(v).toFixed(d));

/** Duración de un extremo del día: "25 min", "2 h", "2.5 h". */
export function durTxt(seg: number): string {
  if (seg < 3600) return `${Math.max(1, Math.round(seg / 60))} min`;
  const h = Math.round(seg / 1800) / 2;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

export function edadTxt(ts: number | null | undefined, ahora: number): string {
  if (!ts) return '';
  const m = Math.max(0, Math.round((ahora - ts) / 60));
  const h = ahora - ts > 20 * 3600 ? fFecha.format(ts * 1000) : fHora.format(ts * 1000);
  if (m < 1) return `${h} (ahora)`;
  if (m < 120) return `${h} (hace ${m} min)`;
  return `${h} (hace ${Math.round(m / 60)} h)`;
}

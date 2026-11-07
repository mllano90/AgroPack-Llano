/**
 * Rango ideal por parámetro (Configuración → min/max opcionales). Se reutiliza en:
 *  - gráficas (ventana emergente, Historial, zoom y reportes PDF/PNG): líneas discontinuas Mín/Máx con etiqueta y,
 *    opcionalmente, una banda suave entre ambas (chartjs-plugin-annotation);
 *  - indicadores de Inicio (valor fuera de rango en ámbar) y tiempo en rango del periodo.
 */
import { Chart } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import type { Punto, Umbral } from './tipos';

Chart.register(annotationPlugin);

export const COLOR_RANGO = '#ffb020';
export const tieneRango = (u?: Umbral | null): u is Umbral => !!u && (u.min != null || u.max != null);

export function fueraDeRango(val: number | null | undefined, u?: Umbral | null): 'bajo' | 'alto' | null {
  if (val == null || !u) return null;
  if (u.min != null && val < u.min) return 'bajo';
  if (u.max != null && val > u.max) return 'alto';
  return null;
}

/** % del tiempo dentro del rango (lecturas ponderadas por punto, usando el promedio de cada intervalo). */
export function pctEnRango(pts: Punto[], u?: Umbral | null): number | null {
  if (!tieneRango(u)) return null;
  let n = 0, dentro = 0;
  for (const p of pts) { n += p.n; if (!fueraDeRango(p.prom, u)) dentro += p.n; }
  return n ? Math.round(1000 * dentro / n) / 10 : null;
}

export const fmtLimite = (v: number, dec: number) => v.toLocaleString('es-MX', { maximumFractionDigits: Math.max(dec, 1) });

export interface OpcRango { banda?: boolean; claro?: boolean; letra?: number; grosor?: number }

/** Anotaciones (plugin annotation) para el rango: líneas Mín/Máx discontinuas con etiqueta + banda suave opcional. */
export function anotacionesRango(u: Umbral | null | undefined, unidad: string, dec: number, o: OpcRango = {}) {
  const out: Record<string, any> = {};
  if (!tieneRango(u)) return out;
  const letra = o.letra ?? 11, grosor = o.grosor ?? 1.5, uu = unidad ? ' ' + unidad : '';
  const linea = (valor: number, txt: string, pos: 'start' | 'end') => ({
    type: 'line', scaleID: 'y', value: valor, borderColor: COLOR_RANGO, borderWidth: grosor, borderDash: [6 * grosor / 1.5, 5 * grosor / 1.5],
    drawTime: 'beforeDatasetsDraw',
    label: { display: true, content: `${txt} ${fmtLimite(valor, dec)}${uu}`, position: pos,
      backgroundColor: o.claro ? 'rgba(255,255,255,.88)' : 'rgba(10,20,14,.78)', color: o.claro ? '#b45309' : COLOR_RANGO,
      font: { size: letra, weight: 600 }, padding: { x: letra * .5, y: letra * .25 }, borderRadius: 4,
      yAdjust: txt === 'Máx' ? -(letra * .9) : letra * .9 },
  });
  if (o.banda && u.min != null && u.max != null)
    out.banda = { type: 'box', yScaleID: 'y', yMin: u.min, yMax: u.max, backgroundColor: o.claro ? 'rgba(34,160,90,.07)' : 'rgba(47,224,122,.07)',
      borderWidth: 0, drawTime: 'beforeDatasetsDraw' };
  if (u.min != null) out.min = linea(u.min, 'Mín', 'start');
  if (u.max != null) out.max = linea(u.max, 'Máx', 'end');
  return out;
}

/** Amplía el eje Y lo justo para que las líneas del rango queden visibles aunque los datos no lleguen a ellas. */
export function ejeConRango(u?: Umbral | null) {
  if (!tieneRango(u)) return {};
  const a = u.min ?? u.max!, b = u.max ?? u.min!, m = Math.max(Math.abs(b - a) * 0.08, Math.abs(b || a) * 0.02, 0.1);
  return { suggestedMin: (u.min ?? b) - (u.min != null ? m : 0), suggestedMax: (u.max ?? a) + (u.max != null ? m : 0) };
}

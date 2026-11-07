import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import 'hammerjs';
import zoomPlugin from 'chartjs-plugin-zoom';
import { api } from './api';
import type { Historial as H, Umbral } from './tipos';
import { anotacionesRango, ejeConRango } from './rango';
import { fDia, fFecha, fHora } from './formato';
import { huecoMs } from './cadencia';

Chart.register(zoomPlugin);

export interface Serie { v: string; nombre: string; color: string }

const fmtVentana = (seg: number) => (seg <= 12 * 3600 ? (ms: number) => fHora.format(ms)
  : seg <= 10 * 86400 ? (ms: number) => fDia.format(ms) + ' ' + fHora.format(ms) : (ms: number) => fDia.format(ms));
const SIN_SERIES: Serie[] = [];
const SIN_DATOS: H[] = [];
const pasoTxt = (s: number) => (s >= 3600 ? `${s / 3600} h` : `${s / 60} min`);

/**
 * Gráfica de historial con zoom/paneo del eje de tiempo (chartjs-plugin-zoom + hammerjs):
 * rueda o pellizco = zoom, arrastrar = desplazar, Shift+arrastrar = seleccionar ventana.
 * Al acercar pide al backend la ventana visible (GET /historial?desde&hasta) con la resolución más fina disponible
 * (crudo cada 2 min dentro de los 30 días; agregados horarios fuera). "Restablecer zoom" vuelve al rango original.
 */
export default function GraficaHist({ principal, extras = SIN_SERIES, datos, datosExtras = SIN_DATOS, unidad, dec, banda, umbral = null,
  rangoBanda = true, className = '' }: {
  principal: Serie; extras?: Serie[]; datos: H; datosExtras?: H[]; unidad: string; dec: number; banda: boolean;
  /** rango ideal (Configuración): líneas Mín/Máx discontinuas + banda suave opcional */
  umbral?: Umbral | null; rangoBanda?: boolean; className?: string;
}) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const grafica = useRef<Chart | null>(null);
  const temporizador = useRef<number | undefined>(undefined);
  const pedido = useRef(0);
  const restaurar = useRef<() => void>(() => {});
  const [zoom, setZoom] = useState<null | { paso: number; fuente: string; cargando: boolean }>(null);

  useEffect(() => {
    if (!lienzo.current) return;
    // Todas las variables se dibujan como LÍNEA (puntos unidos); las de suelo lentas toleran huecos de su ciclo (cadencia.ts)
    const hueco = (p: number) => huecoMs(principal.v, p);
    const series = (d: H, ex: (H | undefined)[]) => {
      const xy = (k: 'prom' | 'min' | 'max', pts = d.puntos) => pts.map(q => ({ x: q.t * 1000, y: q[k] }));
      return [...(banda ? [xy('max'), xy('min')] : []), xy('prom'), ...extras.map((_, i) => xy('prom', ex[i]?.puntos ?? []))];
    };
    const datosIni = series(datos, datosExtras);
    const ds: any[] = [];
    if (banda) {
      ds.push({ label: 'máx', borderColor: 'transparent', pointRadius: 0, fill: false });
      ds.push({ label: 'Mín–máx', borderColor: 'transparent', backgroundColor: principal.color + '30', pointRadius: 0, fill: '-1' });
    }
    ds.push({ label: principal.nombre, borderColor: principal.color, backgroundColor: principal.color + '22', fill: banda ? false : 'origin',
      borderWidth: 2.2, tension: .25, showLine: true, pointBackgroundColor: principal.color, pointHoverRadius: 5 });
    extras.forEach(x => ds.push({ label: x.nombre, borderColor: x.color, borderWidth: 1.2, borderDash: [5, 4], pointRadius: 0, fill: false, tension: .25, showLine: true }));
    const aplicar = (arr: { x: number; y: number }[][], paso: number) => arr.forEach((d, i) => {
      ds[i].data = d; ds[i].spanGaps = hueco(paso);
      if (ds[i].label === principal.nombre) ds[i].pointRadius = d.length < 40 ? 3 : 0;
    });
    aplicar(datosIni, datos.paso_s);
    const x0 = datos.desde * 1000, x1 = datos.hasta * 1000;

    const pedirDetalle = (ch: Chart) => {
      window.clearTimeout(temporizador.current);
      const { min, max } = ch.scales.x;
      if (max - min >= (x1 - x0) * 0.98) {   // volvió al rango completo
        aplicar(datosIni, datos.paso_s); ch.update('none'); setZoom(null); return;
      }
      setZoom(z => ({ paso: z?.paso ?? datos.paso_s, fuente: z?.fuente ?? datos.fuente, cargando: true }));
      temporizador.current = window.setTimeout(async () => {
        const n = ++pedido.current;
        try {
          const [d, ...ex] = await Promise.all([principal, ...extras].map(s => api.historialVentana(s.v, min / 1000, max / 1000)));
          if (n !== pedido.current || grafica.current !== ch) return;
          aplicar(series(d, ex), d.paso_s);
          ch.update('none');
          setZoom({ paso: d.paso_s, fuente: d.fuente, cargando: false });
        } catch { if (n === pedido.current) setZoom(z => z && { ...z, cargando: false }); }
      }, 250);
    };

    const ch = new Chart(lienzo.current, {
      type: 'line', data: { datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: { type: 'linear', min: x0, max: x1, grid: { color: 'rgba(255,255,255,.06)' },
            ticks: { color: '#a9c3b1', maxTicksLimit: 6, maxRotation: 0,
              callback(val) { const s = this.chart.scales.x; return fmtVentana((s.max - s.min) / 1000)(Number(val)); } } },
          y: { ...ejeConRango(umbral), ticks: { color: '#a9c3b1' }, grid: { color: 'rgba(255,255,255,.08)' }, title: { display: !!unidad, text: unidad, color: '#a9c3b1' } },
        },
        plugins: {
          annotation: { annotations: anotacionesRango(umbral, unidad, dec, { banda: rangoBanda }) },
          legend: { display: ds.length > 1, labels: { color: '#eef7f0', boxWidth: 12, filter: it => it.text !== 'máx' } },
          tooltip: { filter: (it: any) => it.dataset.label !== 'máx' && it.dataset.label !== 'Mín–máx', callbacks: { title: it => fFecha.format(it[0].parsed.x as number),
            label: it => `${it.dataset.label}: ${Number(it.parsed.y).toFixed(dec)} ${unidad}` } },
          zoom: {
            limits: { x: { min: x0, max: x1, minRange: 10 * 60 * 1000 } },
            pan: { enabled: true, mode: 'x', threshold: 6, onPanComplete: ({ chart }) => pedirDetalle(chart) },
            zoom: { mode: 'x', wheel: { enabled: true, speed: 0.15 }, pinch: { enabled: true },
              drag: { enabled: true, modifierKey: 'shift', backgroundColor: 'rgba(47,224,122,.18)', borderColor: '#2fe07a', borderWidth: 1 },
              onZoomComplete: ({ chart }) => pedirDetalle(chart) },
          },
        },
      },
    });
    grafica.current = ch;
    restaurar.current = () => { pedido.current++; window.clearTimeout(temporizador.current); ch.resetZoom('none'); aplicar(datosIni, datos.paso_s); ch.update('none'); setZoom(null); };
    setZoom(null);
    return () => { window.clearTimeout(temporizador.current); ch.destroy(); if (grafica.current === ch) grafica.current = null; };
  }, [datos, datosExtras, umbral?.min, umbral?.max, rangoBanda]); // eslint-disable-line react-hooks/exhaustive-deps

  const restablecer = () => restaurar.current();
  return (
    <div className={'graf-zoom ' + className}>
      <div className="graf-barra">
        <span className="graf-ayuda">{zoom
          ? <>Zoom · detalle {pasoTxt(zoom.paso)} ({zoom.fuente === 'hora' ? 'agregados' : zoom.paso === 120 ? 'crudo completo' : 'crudo'}){zoom.cargando && ' · cargando…'}</>
          : 'Pellizca o usa la rueda para acercar · arrastra para desplazar · Shift+arrastrar selecciona'}</span>
        <button type="button" className="btn mini" onClick={restablecer} disabled={!zoom}>Restablecer zoom</button>
      </div>
      <div className="grafica-lienzo"><canvas ref={lienzo} /></div>
    </div>
  );
}

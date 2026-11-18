import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import 'hammerjs';
import zoomPlugin from 'chartjs-plugin-zoom';
import type { Historial as H, Umbral } from './tipos';
import { anotacionesRango, ejeConRango } from './rango';
import { fDia, fFecha, fHora } from './formato';
import { huecoMs } from './cadencia';
import { lecturaEnCursor, limitesPaneo, type Muestra } from './lecturaMira';

Chart.register(zoomPlugin);

export interface Serie { v: string; nombre: string; color: string }

type GraficaZoom = Chart & {
  zoom: (amount: { x?: number; y?: number }, transition?: string) => void;
  zoomScale: (id: string, range: { min: number; max: number }, transition?: string) => void;
};

const fmtVentana = (seg: number) => (seg <= 12 * 3600 ? (ms: number) => fHora.format(ms)
  : seg <= 10 * 86400 ? (ms: number) => fDia.format(ms) + ' ' + fHora.format(ms) : (ms: number) => fDia.format(ms));
const SIN_SERIES: Serie[] = [];
const SIN_DATOS: H[] = [];

/**
 * Historial: un dedo (o el mouse) desplaza el tiempo bajo una línea fija al centro.
 * El pellizco vertical, Shift+rueda y los botones +/− escalan solo el eje de valores.
 * El pellizco horizontal no cambia el tiempo. La exportación PDF/PNG no usa este componente.
 */
export default function GraficaHist({ principal, extras = SIN_SERIES, datos, datosExtras = SIN_DATOS, unidad, dec, banda, umbral = null,
  rangoBanda = true, className = '' }: {
  principal: Serie; extras?: Serie[]; datos: H; datosExtras?: H[]; unidad: string; dec: number; banda: boolean;
  umbral?: Umbral | null; rangoBanda?: boolean; className?: string;
}) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const mira = useRef<HTMLDivElement>(null);
  const etiqueta = useRef<HTMLDivElement>(null);
  const grafica = useRef<GraficaZoom | null>(null);
  const yBase = useRef<{ min: number; max: number } | null>(null);
  const restablecerY = useRef<() => void>(() => {});
  const [yZoom, setYZoom] = useState(false);

  useEffect(() => {
    const canvas = lienzo.current;
    if (!canvas) return;
    const muestras = (h?: H): Muestra[] => (h?.puntos ?? []).map(p => ({ t: p.t * 1000, y: p.prom }));
    const metas = [
      { nombre: principal.nombre, color: principal.color, v: principal.v, pts: muestras(datos) },
      ...extras.map((s, i) => ({ nombre: s.nombre, color: s.color, v: s.v, pts: muestras(datosExtras[i]) })),
    ];
    const hueco = (v: string, paso: number) => huecoMs(v, paso);
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
      borderWidth: 2.2, tension: .25, showLine: true, pointBackgroundColor: principal.color, pointHoverRadius: 0, pointRadius: 0 });
    extras.forEach(x => ds.push({ label: x.nombre, borderColor: x.color, borderWidth: 1.2, borderDash: [5, 4], pointRadius: 0, fill: false, tension: .25, showLine: true }));
    const aplicar = (arr: { x: number; y: number }[][], paso: number) => arr.forEach((d, i) => {
      ds[i].data = d;
      ds[i].spanGaps = hueco(ds[i].label === principal.nombre ? principal.v : (extras.find(e => e.nombre === ds[i].label)?.v ?? principal.v), paso);
    });
    aplicar(datosIni, datos.paso_s);
    const x0 = datos.desde * 1000, x1 = datos.hasta * 1000;
    const pan = limitesPaneo(x0, x1);
    const valores: number[] = [];
    for (const m of metas) for (const p of m.pts) valores.push(p.y);
    if (umbral?.min != null) valores.push(umbral.min);
    if (umbral?.max != null) valores.push(umbral.max);
    const lo = valores.length ? Math.min(...valores) : 0;
    const hi = valores.length ? Math.max(...valores) : 1;
    const span = Math.max(hi - lo, dec === 0 ? 2 : 0.4);
    const yLim = { min: lo - span * 0.6, max: hi + span * 0.6, minRange: Math.max(span * 0.08, dec === 0 ? 1 : 0.2) };

    const pintar = (chart: Chart) => {
      const caja = mira.current, etiq = etiqueta.current;
      const area = chart.chartArea;
      if (!caja || !etiq || !area || area.width < 8) return;
      const cx = (area.left + area.right) / 2;
      const crudo = chart.scales.x.getValueForPixel(cx);
      if (crudo == null) return;
      const t = crudo;
      caja.style.transform = `translate(${cx}px, ${area.top}px)`;
      caja.style.height = `${area.bottom - area.top}px`;
      const lecturas = metas.map(m => ({ ...m, lec: lecturaEnCursor(m.pts, t, hueco(m.v, datos.paso_s)) }));
      const conDato = lecturas.find(l => l.lec.hay);
      const cuando = fFecha.format((conDato && conDato.lec.hay ? conDato.lec.t : t));
      etiq.replaceChildren();
      if (lecturas.length === 1) {
        const l = lecturas[0];
        const valor = document.createElement('b');
        valor.textContent = l.lec.hay ? `${l.lec.y.toFixed(dec)}${unidad ? ' ' + unidad : ''}` : 'sin datos';
        etiq.append(valor);
      } else {
        for (const l of lecturas) {
          const fila = document.createElement('div');
          fila.textContent = l.lec.hay ? `${l.nombre} ${l.lec.y.toFixed(dec)}${unidad ? ' ' + unidad : ''}` : `${l.nombre}: sin datos`;
          etiq.append(fila);
        }
      }
      const hora = document.createElement('div');
      hora.className = 'cuando';
      hora.textContent = cuando;
      etiq.append(hora);
      etiq.classList.toggle('izq', area.right - cx < 150);
      const ctx = chart.ctx;
      ctx.save();
      for (const l of lecturas) {
        if (!l.lec.hay) continue;
        const px = chart.scales.x.getPixelForValue(l.lec.t);
        const py = chart.scales.y.getPixelForValue(l.lec.y);
        if (px < area.left || px > area.right || py < area.top || py > area.bottom) continue;
        ctx.beginPath();
        ctx.arc(px, py, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = l.color;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    };

    const ch = new Chart(canvas, {
      type: 'line', data: { datasets: ds },
      plugins: [{ id: 'miraLectura', afterDraw: pintar }],
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: { type: 'linear', min: x0, max: x1, grid: { color: 'rgba(255,255,255,.06)' },
            ticks: { color: '#a9c3b1', maxTicksLimit: window.innerWidth < 520 ? 4 : 6, maxRotation: 0, autoSkip: true, autoSkipPadding: 12,
              callback(val) {
                const escala = this.chart.scales.x;
                const ventana = (escala.max - escala.min) / 1000;
                const ms = Number(val);
                if (this.chart.width < 480) return ventana <= 2 * 86400 ? fHora.format(ms) : fDia.format(ms);
                return fmtVentana(ventana)(ms);
              } } },
          y: { ...ejeConRango(umbral), ticks: { color: '#a9c3b1' }, grid: { color: 'rgba(255,255,255,.08)' }, title: { display: !!unidad, text: unidad, color: '#a9c3b1' } },
        },
        plugins: {
          annotation: { annotations: anotacionesRango(umbral, unidad, dec, { banda: rangoBanda }) },
          legend: { display: ds.length > 1, labels: { color: '#eef7f0', boxWidth: 12, filter: (it: { text: string }) => it.text !== 'máx' } },
          tooltip: { enabled: false },
          zoom: {
            limits: { x: { min: pan.min, max: pan.max, minRange: pan.ancho * 0.98 }, y: yLim },
            pan: { enabled: true, mode: 'x', threshold: 4 },
            zoom: {
              mode: 'y',
              wheel: { enabled: true, modifierKey: 'shift', speed: 0.12 },
              pinch: { enabled: true },
              drag: { enabled: false },
              onZoomComplete: ({ chart }) => marcarZoom(chart),
            },
          },
        },
      },
    }) as GraficaZoom;
    grafica.current = ch;
    const marcarZoom = (chart: Chart) => {
      const base = yBase.current;
      if (!base) return;
      const y = chart.scales.y;
      setYZoom(Math.abs(y.min - base.min) > span * 0.02 || Math.abs(y.max - base.max) > span * 0.02);
    };
    yBase.current = { min: ch.scales.y.min, max: ch.scales.y.max };
    restablecerY.current = () => {
      const base = yBase.current;
      if (!base || !grafica.current) return;
      grafica.current.zoomScale('y', { min: base.min, max: base.max }, 'none');
      setYZoom(false);
    };
    let toque = 0, tx = 0, ty = 0;
    const doble = (x: number, y: number) => {
      const ahora = performance.now();
      if (ahora - toque < 320 && Math.hypot(x - tx, y - ty) < 28) { restablecerY.current(); toque = 0; }
      else { toque = ahora; tx = x; ty = y; }
    };
    const alDoble = (e: MouseEvent) => { e.preventDefault(); restablecerY.current(); };
    const alToque = (e: TouchEvent) => {
      if (e.touches.length) return;
      const c = e.changedTouches[0];
      if (c) doble(c.clientX, c.clientY);
    };
    canvas.addEventListener('dblclick', alDoble);
    canvas.addEventListener('touchend', alToque);
    setYZoom(false);
    return () => {
      canvas.removeEventListener('dblclick', alDoble);
      canvas.removeEventListener('touchend', alToque);
      ch.destroy();
      if (grafica.current === ch) grafica.current = null;
    };
  }, [datos, datosExtras, umbral?.min, umbral?.max, rangoBanda]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomY = (factor: number) => {
    const ch = grafica.current;
    const base = yBase.current;
    if (!ch || !base) return;
    ch.zoom({ y: factor }, 'none');
    const y = ch.scales.y;
    const span = Math.max(base.max - base.min, 0.2);
    setYZoom(Math.abs(y.min - base.min) > span * 0.02 || Math.abs(y.max - base.max) > span * 0.02);
  };

  return (
    <div className={'graf-zoom ' + className}>
      <div className="graf-barra">
        <span className="graf-ayuda">Arrastra para leer bajo la línea · pellizco vertical o Shift+rueda cambia la escala</span>
        <span className="graf-controles">
          <button type="button" className="btn mini" aria-label="Acercar valores" onClick={() => zoomY(1.3)}>+</button>
          <button type="button" className="btn mini" aria-label="Alejar valores" onClick={() => zoomY(0.75)}>−</button>
          <button type="button" className="btn mini" onClick={() => restablecerY.current()} disabled={!yZoom}>Restablecer</button>
        </span>
      </div>
      <div className="grafica-lienzo">
        <canvas ref={lienzo} />
        <div ref={mira} className="graf-mira" aria-hidden="true">
          <span className="punta sup" />
          <span className="linea" />
          <span className="punta inf" />
          <div ref={etiqueta} className="graf-lectura" />
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import 'hammerjs';
import zoomPlugin from 'chartjs-plugin-zoom';
import type { Historial as H, Umbral } from './tipos';
import { anotacionesRango, ejeConRango } from './rango';
import { fDia, fFecha, fHora } from './formato';
import { huecoMs } from './cadencia';
import { lecturaEnCursor, limitesPaneo, type Muestra } from './lecturaMira';
import { decidirGesto, razonPellizcoVertical } from './gestosGrafica';
import { anclaEnCursor, seguirPunto, zoomEnAncla } from './encuadreZoom';

Chart.register(zoomPlugin);

export interface Serie { v: string; nombre: string; color: string }

type GraficaZoom = Chart & {
  pan: (delta: { x?: number; y?: number }, enabled?: unknown, transition?: string) => void;
  zoom: (amount: { x?: number; y?: number; focalPoint?: { x: number; y: number } }, transition?: string) => void;
  zoomScale: (id: string, range: { min: number; max: number }, transition?: string) => void;
};

const fmtVentana = (seg: number) => (seg <= 12 * 3600 ? (ms: number) => fHora.format(ms)
  : seg <= 10 * 86400 ? (ms: number) => fDia.format(ms) + ' ' + fHora.format(ms) : (ms: number) => fDia.format(ms));
const SIN_SERIES: Serie[] = [];
const SIN_DATOS: H[] = [];

/**
 * Historial: dentro del área de trazado, un dedo horizontal mueve el tiempo bajo la línea.
 * Un dedo vertical deja pasar el scroll de la página. El pellizco vertical (dos dedos),
 * Shift+rueda y los botones +/− escalan solo los valores. Fuera del trazado, la página se comporta normal.
 * La exportación PDF/PNG no usa este componente.
 */
export default function GraficaHist({ principal, extras = SIN_SERIES, datos, datosExtras = SIN_DATOS, unidad, dec, banda, umbral = null,
  rangoBanda = true, className = '', yEscala }: {
  principal: Serie; extras?: Serie[]; datos: H; datosExtras?: H[]; unidad: string; dec: number; banda: boolean;
  umbral?: Umbral | null; rangoBanda?: boolean; className?: string; yEscala?: { min: number; max: number };
}) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const toque = useRef<HTMLDivElement>(null);
  const mira = useRef<HTMLDivElement>(null);
  const etiqueta = useRef<HTMLDivElement>(null);
  const grafica = useRef<GraficaZoom | null>(null);
  const yBase = useRef<{ min: number; max: number } | null>(null);
  const restablecerY = useRef<() => void>(() => {});
  const aplicarZoomRef = useRef<(factor: number) => void>(() => {});
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
    const yLim = yEscala
      ? { min: yEscala.min - 5, max: yEscala.max + 5, minRange: 8 }
      : { min: lo - span * 0.6, max: hi + span * 0.6, minRange: Math.max(span * 0.08, dec === 0 ? 1 : 0.2) };

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
      const zona = toque.current;
      if (zona) {
        zona.style.left = `${area.left}px`;
        zona.style.top = `${area.top}px`;
        zona.style.width = `${area.width}px`;
        zona.style.height = `${area.height}px`;
      }
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
          y: { ...ejeConRango(umbral), ...(yEscala ? { min: yEscala.min, max: yEscala.max } : {}), ticks: { color: '#a9c3b1' }, grid: { color: 'rgba(255,255,255,.08)' }, title: { display: !!unidad, text: unidad, color: '#a9c3b1' } },
        },
        plugins: {
          annotation: { annotations: anotacionesRango(umbral, unidad, dec, { banda: rangoBanda }) },
          legend: { display: ds.length > 1, labels: { color: '#eef7f0', boxWidth: 12, filter: (it: { text: string }) => it.text !== 'máx' } },
          tooltip: { enabled: false },
          zoom: {
            limits: { x: { min: pan.min, max: pan.max, minRange: pan.ancho * 0.98 }, y: yLim },
            pan: { enabled: false },
            zoom: {
              mode: 'y',
              wheel: { enabled: false },
              pinch: { enabled: false },
              drag: { enabled: false },
              onZoomStart: (ctx: { chart: Chart; point: { x: number | null; y: number | null } }) => {
                const a = ctx.chart.chartArea;
                const p = ctx.point;
                if (p.x == null || p.y == null || p.x < a.left || p.x > a.right || p.y < a.top || p.y > a.bottom) return false;
              },
              onZoomComplete: ({ chart }: { chart: Chart }) => marcarZoom(chart),
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
    const limitesY = { min: yLim.min, max: yLim.max };
    const anclaDe = (chart: Chart) => {
      const area = chart.chartArea;
      if (!area || area.width < 8) return null;
      const t = chart.scales.x.getValueForPixel((area.left + area.right) / 2);
      if (t == null || !Number.isFinite(Number(t))) return null;
      return anclaEnCursor(
        metas.map(m => ({ pts: m.pts, huecoMs: hueco(m.v, datos.paso_s) })),
        Number(t),
        { tMin: chart.scales.x.min, tMax: chart.scales.x.max },
      );
    };
    const aplicarZoom = (chart: GraficaZoom, factor: number) => {
      const anchor = anclaDe(chart);
      if (anchor == null) return;
      const y = chart.scales.y;
      chart.zoomScale('y', zoomEnAncla({ min: y.min, max: y.max }, anchor, factor, limitesY), 'none');
      marcarZoom(chart);
    };
    const seguir = (chart: GraficaZoom) => {
      const base = yBase.current;
      if (!base) return;
      const y = chart.scales.y;
      const spanY = y.max - y.min;
      if (!(spanY > 0) || spanY >= (base.max - base.min) * 0.98) return;
      const anchor = anclaDe(chart);
      if (anchor == null) return;
      const next = seguirPunto({ min: y.min, max: y.max }, anchor, limitesY);
      if (Math.abs(next.min - y.min) < 1e-4 && Math.abs(next.max - y.max) < 1e-4) return;
      chart.zoomScale('y', next, 'none');
    };
    aplicarZoomRef.current = (factor) => {
      const chart = grafica.current;
      if (chart) aplicarZoom(chart, factor);
    };
    restablecerY.current = () => {
      const base = yBase.current;
      if (!base || !grafica.current) return;
      grafica.current.zoomScale('y', { min: base.min, max: base.max }, 'none');
      setYZoom(false);
    };
    let toqueEn = 0, tx = 0, ty = 0;
    const doble = (x: number, y: number) => {
      const ahora = performance.now();
      if (ahora - toqueEn < 320 && Math.hypot(x - tx, y - ty) < 28) { restablecerY.current(); toqueEn = 0; }
      else { toqueEn = ahora; tx = x; ty = y; }
    };
    const zona = toque.current;
    let modo: 'esperar' | 'horizontal' | 'vertical' | 'pellizco' = 'esperar';
    let ox = 0, oy = 0, ultimoX = 0;
    let sepY = 0;
    const alInicio = (e: TouchEvent) => {
      if (e.touches.length >= 2) { modo = 'pellizco'; sepY = Math.abs(e.touches[0].clientY - e.touches[1].clientY); return; }
      modo = 'esperar';
      ox = e.touches[0].clientX; oy = e.touches[0].clientY; ultimoX = ox;
    };
    const alMover = (e: TouchEvent) => {
      const chz = grafica.current;
      if (!chz) return;
      if (e.touches.length >= 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const razon = razonPellizcoVertical(dx, dy, sepY);
        sepY = Math.abs(dy);
        if (razon == null) return;
        if (e.cancelable) e.preventDefault();
        aplicarZoom(chz, razon);
        return;
      }
      if (modo === 'vertical' || modo === 'pellizco') return;
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      if (modo === 'esperar') {
        const decision = decidirGesto(x - ox, y - oy);
        if (decision === 'esperar') return;
        modo = decision;
        if (modo === 'vertical') return;
      }
      if (e.cancelable) e.preventDefault();
      chz.pan({ x: x - ultimoX }, undefined, 'none');
      ultimoX = x;
      seguir(chz);
    };
    const alFin = (e: TouchEvent) => {
      if (e.touches.length >= 2) return;
      if (e.touches.length === 1) { modo = 'esperar'; ultimoX = e.touches[0].clientX; return; }
      const c = e.changedTouches[0];
      if (c && modo !== 'horizontal') doble(c.clientX, c.clientY);
      modo = 'esperar';
    };
    let arrastre = false, ratonX = 0;
    const alRatonAbajo = (e: MouseEvent) => {
      if (e.button !== 0) return;
      arrastre = true; ratonX = e.clientX;
    };
    const alRatonMover = (e: MouseEvent) => {
      if (!arrastre || !grafica.current) return;
      grafica.current.pan({ x: e.clientX - ratonX }, undefined, 'none');
      ratonX = e.clientX;
      seguir(grafica.current);
    };
    const alRatonSoltar = () => { arrastre = false; };
    const alDobleRaton = (e: MouseEvent) => { e.preventDefault(); restablecerY.current(); };
    const alRueda = (e: WheelEvent) => {
      if (!e.shiftKey || !grafica.current) return;
      e.preventDefault();
      aplicarZoom(grafica.current, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    zona?.addEventListener('touchstart', alInicio, { passive: true });
    zona?.addEventListener('touchmove', alMover, { passive: false });
    zona?.addEventListener('touchend', alFin);
    zona?.addEventListener('touchcancel', alFin);
    zona?.addEventListener('wheel', alRueda, { passive: false });
    zona?.addEventListener('mousedown', alRatonAbajo);
    zona?.addEventListener('dblclick', alDobleRaton);
    window.addEventListener('mousemove', alRatonMover);
    window.addEventListener('mouseup', alRatonSoltar);
    setYZoom(false);
    return () => {
      aplicarZoomRef.current = () => {};
      zona?.removeEventListener('touchstart', alInicio);
      zona?.removeEventListener('touchmove', alMover);
      zona?.removeEventListener('touchend', alFin);
      zona?.removeEventListener('touchcancel', alFin);
      zona?.removeEventListener('wheel', alRueda);
      zona?.removeEventListener('mousedown', alRatonAbajo);
      zona?.removeEventListener('dblclick', alDobleRaton);
      window.removeEventListener('mousemove', alRatonMover);
      window.removeEventListener('mouseup', alRatonSoltar);
      ch.destroy();
      if (grafica.current === ch) grafica.current = null;
    };
  }, [datos, datosExtras, umbral?.min, umbral?.max, rangoBanda, yEscala?.min, yEscala?.max]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomY = (factor: number) => aplicarZoomRef.current(factor);

  return (
    <div className={'graf-zoom ' + className}>
      <div className="graf-barra">
        <span className="graf-ayuda">Desliza en horizontal sobre la gráfica para leer · pellizco vertical cambia la escala</span>
        <span className="graf-controles">
          <button type="button" className="btn mini" aria-label="Acercar valores" onClick={() => zoomY(1.3)}>+</button>
          <button type="button" className="btn mini" aria-label="Alejar valores" onClick={() => zoomY(0.75)}>−</button>
          <button type="button" className="btn mini" onClick={() => restablecerY.current()} disabled={!yZoom}>Restablecer</button>
        </span>
      </div>
      <div className="grafica-lienzo">
        <canvas ref={lienzo} />
        <div ref={toque} className="graf-toque" />
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

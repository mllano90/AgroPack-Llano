import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { api } from './api';
import type { Historial as H } from './tipos';
import { Icono } from './Icono';
import { fDia, fFecha, fHora } from './formato';

const VARS: [string, string, string, number][] = [
  ['t_aire', 'Temp. aire', '°C', 1], ['h_aire', 'Hum. aire', '%', 0], ['pir', 'Radiación', 'W/m²', 0],
  ['t_suelo', 'Temp. suelo', '°C', 1], ['h_suelo', 'Hum. suelo', '%', 0], ['ph', 'pH', '', 1], ['ec', 'CE', 'dS/m', 2],
  ['n', 'N', 'mg/kg', 0], ['p', 'P', 'mg/kg', 0], ['k', 'K', 'mg/kg', 0], ['t1', 'T Aire1', '°C', 1], ['t2', 'T Aire2', '°C', 1],
  ['h1', 'H Aire1', '%', 0], ['h2', 'H Aire2', '%', 0], ['rssi', 'RSSI', 'dBm', 0]];
const RANGOS: [string, string][] = [['24h', '24 h'], ['7d', '7 d'], ['30d', '30 d'], ['365d', '1 año']];
const LENTAS = ['t_suelo', 'h_suelo', 'ph', 'ec', 'n', 'p', 'k'];

export default function Historial() {
  const [v, setV] = useState('t_aire');
  const [rango, setRango] = useState('24h');
  const [datos, setDatos] = useState<H | null>(null);
  const [error, setError] = useState('');
  const lienzo = useRef<HTMLCanvasElement>(null);
  const grafica = useRef<Chart | null>(null);
  const def = VARS.find(x => x[0] === v)!;

  useEffect(() => {
    let vivo = true;
    api.historial(v, rango).then(d => { if (vivo) { setDatos(d); setError(''); } }).catch(e => setError(e.message));
    return () => { vivo = false; };
  }, [v, rango]);

  useEffect(() => {
    if (!datos || !lienzo.current) return;
    const [, nombre, u, dec] = def;
    const pts = datos.puntos, hueco = datos.paso_s * 3 * 1000;
    const ds: any[] = [{ label: `${nombre} (${u}) promedio`, data: pts.map(p => ({ x: p.t * 1000, y: p.prom })), borderColor: '#2fe07a',
      backgroundColor: 'rgba(47,224,122,.15)', fill: true, pointRadius: pts.length < 60 ? 2 : 0, borderWidth: 2, tension: .25, spanGaps: hueco }];
    if (rango !== '24h' || LENTAS.includes(v)) {
      ds.push({ label: 'máx', data: pts.map(p => ({ x: p.t * 1000, y: p.max })), borderColor: 'rgba(255,176,32,.6)', pointRadius: 0, borderWidth: 1, fill: false, spanGaps: hueco });
      ds.push({ label: 'mín', data: pts.map(p => ({ x: p.t * 1000, y: p.min })), borderColor: 'rgba(46,168,255,.6)', pointRadius: 0, borderWidth: 1, fill: false, spanGaps: hueco });
    }
    const fmtX = rango === '24h' ? (ms: number) => fHora.format(ms) : (ms: number) => fDia.format(ms) + (rango === '7d' ? ' ' + fHora.format(ms) : '');
    grafica.current?.destroy();
    grafica.current = new Chart(lienzo.current, {
      type: 'line', data: { datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: { type: 'linear', min: datos.desde * 1000, max: datos.hasta * 1000, grid: { color: 'rgba(255,255,255,.06)' },
            ticks: { color: '#a9c3b1', maxTicksLimit: 6, callback: val => fmtX(Number(val)) } },
          y: { ticks: { color: '#a9c3b1' }, grid: { color: 'rgba(255,255,255,.08)' } },
        },
        plugins: {
          legend: { labels: { color: '#eef7f0', boxWidth: 12 } },
          tooltip: { callbacks: { title: it => fFecha.format(it[0].parsed.x as number), label: it => `${it.dataset.label}: ${Number(it.parsed.y).toFixed(dec)} ${u}` } },
        },
      },
    });
    return () => { grafica.current?.destroy(); grafica.current = null; };
  }, [datos]); // eslint-disable-line react-hooks/exhaustive-deps

  const pts = datos?.puntos ?? [];
  const n = pts.reduce((a, p) => a + p.n, 0);
  const dec = def[3];
  return (
    <section id="v-historial" className="vista">
      <div className="vidrio bloque">
        <div className="chips">
          {VARS.map(x => <button key={x[0]} className={x[0] === v ? 'on' : ''} onClick={() => setV(x[0])}>{x[1]}</button>)}
        </div>
        <div className="fila-ctl">
          <div className="seg">
            {RANGOS.map(([r, t]) => <button key={r} className={r === rango ? 'on' : ''} onClick={() => setRango(r)}>{t}</button>)}
          </div>
          <button className="btn" onClick={() => api.descargarCsv(rango).catch(e => alert(e.message))}><Icono id="descarga" />CSV</button>
        </div>
        <div className="grafica"><canvas ref={lienzo} /></div>
        <div className="stats">
          {error ? error : !pts.length ? 'Sin datos en este rango' : <>
            Mín <b>{Math.min(...pts.map(p => p.min)).toFixed(dec)}</b> · Prom <b>{(pts.reduce((a, p) => a + p.prom * p.n, 0) / n).toFixed(dec)}</b> ·
            Máx <b>{Math.max(...pts.map(p => p.max)).toFixed(dec)}</b> {def[2]} · {n} lecturas, intervalos de {datos!.paso_s / 60} min
            {datos!.fuente === 'hora' && ' (agregados horarios)'}
          </>}
        </div>
      </div>
    </section>
  );
}

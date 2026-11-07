import { useEffect, useState } from 'react';
import GraficaHist from './GraficaHist';
import { api } from './api';
import type { Historial as H, Umbral } from './tipos';

const VARS: [string, string, string, number, boolean][] = [
  ['t_aire', 'Temp. aire', '°C', 1, false], ['h_aire', 'Hum. aire', '%', 0, false], ['pir', 'Radiación', 'W/m²', 0, false],
  ['t_suelo', 'Temp. suelo', '°C', 1, false], ['h_suelo', 'Hum. suelo', '%', 0, false], ['ph', 'pH', '', 1, false],
  ['ec', 'CE', 'dS/m', 2, false], ['n', 'N', 'mg/kg', 0, false], ['p', 'P', 'mg/kg', 0, false], ['k', 'K', 'mg/kg', 0, false],
  ['t1', 'T Aire1', '°C', 1, false], ['t2', 'T Aire2', '°C', 1, false],
  ['t_caja', 'T caja', '°C', 1, true], ['h_caja', 'H caja', '%', 0, true],
  ['h1', 'H Aire1', '%', 0, false], ['h2', 'H Aire2', '%', 0, false], ['rssi', 'RSSI', 'dBm', 0, false],
];
const RANGOS: [string, string][] = [['24h', '24 h'], ['7d', '7 d'], ['30d', '30 d'], ['365d', '1 año']];

/** Historial con líneas de rango. La caja solo entra en el selector del administrador. */
export default function Historial({ esAdmin = false }: { esAdmin?: boolean }) {
  const visibles = VARS.filter(x => esAdmin || !x[4]);
  const [v, setV] = useState('t_aire');
  const [rango, setRango] = useState('24h');
  const [datos, setDatos] = useState<H | null>(null);
  const [error, setError] = useState('');
  const def = visibles.find(x => x[0] === v) ?? visibles[0];
  const [umbrales, setUmbrales] = useState<Record<string, Umbral>>({});
  useEffect(() => { api.ultimo().then(u => setUmbrales(u.umbrales || {})).catch(() => {}); }, []);
  const mapa: Record<string, string> = { t1: 't_aire', t2: 't_aire', h1: 'h_aire', h2: 'h_aire' };
  const umbral = umbrales[mapa[def[0]] ?? def[0]] ?? null;

  useEffect(() => {
    let vivo = true;
    api.historial(def[0], rango).then(d => { if (vivo) { setDatos(d); setError(''); } }).catch(e => setError(e.message));
    return () => { vivo = false; };
  }, [def, rango]);

  const pts = datos?.puntos ?? [];
  const n = pts.reduce((a, p) => a + p.n, 0);
  const dec = def[3];
  return (
    <section id="v-historial" className="vista">
      <div className="vidrio bloque">
        <div className="chips">
          {visibles.map(x => <button key={x[0]} className={x[0] === def[0] ? 'on' : ''} onClick={() => setV(x[0])}>{x[1]}</button>)}
        </div>
        <div className="fila-ctl">
          <div className="seg">{RANGOS.map(([r, t]) => <button key={r} className={r === rango ? 'on' : ''} onClick={() => setRango(r)}>{t}</button>)}</div>
          {n > 0 && datos && <span className="tenue chico">{n} lecturas</span>}
        </div>
        {error && <p className="error-login">{error}</p>}
        {datos && n > 0 ? (
          <GraficaHist datos={datos} unidad={def[2]} dec={dec} banda={rango !== '24h'} umbral={umbral}
            principal={{ v: def[0], nombre: def[1], color: '#2fe07a' }} />
        ) : <div className="grafica"><div className="mh-vacio">{datos ? 'Sin datos en este rango' : 'Cargando…'}</div></div>}
      </div>
    </section>
  );
}

import { Fragment, useEffect, useState } from 'react';
import GraficaHist from './GraficaHist';
import { api } from './api';
import type { Historial as H, Umbral } from './tipos';
import { Icono } from './Icono';
import { RANGOS_REPORTE, descargar, generarReporte } from './reporte';

const VARS: [string, string, string, number][] = [
  ['t_aire', 'Temp. aire', '°C', 1], ['h_aire', 'Hum. aire', '%', 0], ['pir', 'Radiación', 'W/m²', 0],
  ['t_caja', 'Temp. caja', '°C', 1], ['h_caja', 'Hum. caja', '%', 0],
  ['t_suelo', 'Temp. suelo', '°C', 1], ['h_suelo', 'Hum. suelo', '%', 0], ['ph', 'pH', '', 1],
  ['ec', 'CE', 'dS/m', 2], ['n', 'N', 'mg/kg', 0], ['p', 'P', 'mg/kg', 0], ['k', 'K', 'mg/kg', 0],
  ['t1', 'T Aire1', '°C', 1], ['t2', 'T Aire2', '°C', 1],
  ['h1', 'H Aire1', '%', 0], ['h2', 'H Aire2', '%', 0], ['rssi', 'RSSI', 'dBm', 0],
];
const RANGOS: [string, string][] = [['24h', '24 h'], ['7d', '7 d'], ['30d', '30 d'], ['365d', '1 año']];
const esCaja = (v: string) => v === 't_caja' || v === 'h_caja';

/** Historial con líneas de rango. La caja interna (XY-MD01) la ven admin y usuario normal. */
export default function Historial() {
  const [v, setV] = useState('t_aire');
  const [rango, setRango] = useState('24h');
  const [datos, setDatos] = useState<H | null>(null);
  const [error, setError] = useState('');
  const def = VARS.find(x => x[0] === v) ?? VARS[0];
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
        <div className="chips" role="tablist" aria-label="Serie del historial">
          {VARS.map(x => (
            <Fragment key={x[0]}>
              {x[0] === 't_caja' && <span className="chip-grupo">Caja interna</span>}
              <button type="button" role="tab" aria-selected={x[0] === def[0]}
                className={x[0] === def[0] ? 'on' : ''} onClick={() => setV(x[0])}
                title={esCaja(x[0]) ? `Caja interna · ${x[1]}` : x[1]}>{x[1]}</button>
            </Fragment>
          ))}
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
      <BloqueReporte />
    </section>
  );
}

function BloqueReporte() {
  const [rango, setRango] = useState('7d');
  const [formato, setFormato] = useState<'pdf' | 'png'>('pdf');
  const [estado, setEstado] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const generar = async () => {
    setOcupado(true); setEstado('Consultando datos…');
    try {
      const d = await api.reporte(rango);
      setEstado(`Generando ${formato.toUpperCase()}…`);
      const { blob, nombre } = await generarReporte(d, formato);
      descargar(blob, nombre);
      setEstado(`✔ ${nombre} (${Math.round(blob.size / 1024)} kB)`);
    } catch (e) { setEstado('✖ ' + (e as Error).message); }
    setOcupado(false);
  };
  return (
    <div id="reporte" className="vidrio bloque">
      <h2><Icono id="descarga" className="ico" /> Reporte descargable</h2>
      <p className="tenue chico">PDF tamaño carta o una imagen PNG, con el rango ideal en líneas punteadas.</p>
      <div className="fila-ctl">
        <div className="seg" role="group" aria-label="Rango del reporte">
          {RANGOS_REPORTE.map(([r, t]) => <button key={r} className={r === rango ? 'on' : ''} onClick={() => setRango(r)}>{t}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Formato">
          {(['pdf', 'png'] as const).map(x => <button key={x} className={x === formato ? 'on' : ''} onClick={() => setFormato(x)}>{x.toUpperCase()}</button>)}
        </div>
        <button className="btn primario" id="btn-reporte" disabled={ocupado} onClick={generar}>{ocupado ? 'Generando…' : 'Generar reporte'}</button>
      </div>
      {estado && <p className="chico" role="status">{estado}</p>}
    </div>
  );
}

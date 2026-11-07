import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import GraficaHist from './GraficaHist';
import type { Historial as H, Umbral } from './tipos';
import { fmtLimite, pctEnRango, tieneRango } from './rango';
import { Icono } from './Icono';
import type { DefIndicador } from './indicadores';
import { RANGOS_MODAL } from './indicadores';
import { fFecha, num } from './formato';

/** Resumen del rango: mín/máx absolutos y promedio ponderado por número de lecturas. */
export function resumen(pts: H['puntos']) {
  const n = pts.reduce((a, p) => a + p.n, 0);
  if (!n) return null;
  return { min: Math.min(...pts.map(p => p.min)), max: Math.max(...pts.map(p => p.max)),
    prom: pts.reduce((a, p) => a + p.prom * p.n, 0) / n, n, ultimo: pts[pts.length - 1].t };
}

/** Ventana emergente con el historial de un indicador (8 h / 24 h / 7 días / 1 mes). Cierra con X, Esc o clic fuera. */
export default function ModalHistorial({ def, umbral, rangoBanda = true, alCerrar }: {
  def: DefIndicador; umbral?: Umbral | null; rangoBanda?: boolean; alCerrar: () => void;
}) {
  const [rango, setRango] = useState('24h');
  const [datos, setDatos] = useState<H | null>(null);
  const [extras, setExtras] = useState<H[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const cerrarBtn = useRef<HTMLButtonElement>(null);
  const caja = useRef<HTMLDivElement>(null);

  // Esc, foco inicial, foco atrapado dentro de la ventana y devolución del foco al indicador al cerrar.
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    cerrarBtn.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); alCerrar(); return; }
      if (e.key !== 'Tab' || !caja.current) return;
      const f = caja.current.querySelectorAll<HTMLElement>('button');
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', tecla);
    const ov = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', tecla); document.body.style.overflow = ov; previo?.focus?.(); };
  }, [alCerrar]);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError('');
    Promise.all([api.historial(def.v, rango), ...(def.extras ?? []).map(x => api.historial(x.v, rango))])
      .then(([d, ...ex]) => { if (vivo) { setDatos(d); setExtras(ex); } })
      .catch(e => { if (vivo) { setError(e.message); setDatos(null); } })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [def, rango]);

  const pts = datos?.puntos ?? [];
  const r = resumen(pts);

  const u = def.unidad ? ` ${def.unidad}` : '';
  const conRango = tieneRango(umbral), enRango = conRango ? pctEnRango(pts, umbral) : null;
  const txtRango = !conRango ? '' : umbral!.min != null && umbral!.max != null
    ? `${fmtLimite(umbral!.min, def.dec)}–${fmtLimite(umbral!.max, def.dec)}${u}`
    : umbral!.min != null ? `mín ${fmtLimite(umbral!.min, def.dec)}${u}` : `máx ${fmtLimite(umbral!.max!, def.dec)}${u}`;
  return (
    <div className="modal modal-hist" onMouseDown={e => { if (e.target === e.currentTarget) alCerrar(); }}>
      <div ref={caja} className="vidrio modal-caja hist-caja" role="dialog" aria-modal="true" aria-labelledby="mh-titulo">
        <div className="mh-cab">
          <Icono id={def.icono} className="ico" />
          <h3 id="mh-titulo">{def.nombre}</h3>
          <button ref={cerrarBtn} className="x" aria-label="Cerrar" onClick={alCerrar}>×</button>
        </div>
        <div className="seg mh-rangos" role="group" aria-label="Rango del historial">
          {RANGOS_MODAL.map(([k, t]) => (
            <button key={k} className={k === rango ? 'on' : ''} aria-pressed={k === rango} onClick={() => setRango(k)}>{t}</button>
          ))}
        </div>
        <div className="mh-stats">
          {(['min', 'prom', 'max'] as const).map(k => (
            <div key={k} className={'st-' + k}><span>{{ min: 'Mínimo', prom: 'Promedio', max: 'Máximo' }[k]}</span>
              <b>{r ? num(r[k], def.dec) : '--'}<small>{u}</small></b></div>
          ))}
          {conRango && <div className="st-rango" title={`Rango ideal ${txtRango}`}><span>En rango</span>
            <b>{enRango != null ? num(enRango, 0) : '--'}<small> %</small></b></div>}
        </div>
        {r && datos ? (
          <GraficaHist className="mh-grafica" datos={datos} datosExtras={extras} unidad={def.unidad} dec={def.dec}
            banda={rango === '7d' || rango === '30d'} extras={def.extras} umbral={umbral} rangoBanda={rangoBanda}
            principal={{ v: def.v, nombre: def.extras ? 'Promedio' : def.corto, color: def.color }} />
        ) : (
          <div className="grafica mh-grafica mh-vacia"><div className="mh-vacio">{cargando ? 'Cargando…' : error ? error : 'Sin datos en este rango'}</div></div>
        )}
        <p className="mh-pie">
          {r && datos ? <>
            {r.n} lecturas · intervalos de {datos.paso_s >= 3600 ? `${datos.paso_s / 3600} h` : `${datos.paso_s / 60} min`}
            {datos.fuente === 'hora' ? ' (agregados horarios)' : ' (datos crudos)'} · {fFecha.format(datos.desde * 1000)} – {fFecha.format(datos.hasta * 1000)}
          </> : datos ? `${fFecha.format(datos.desde * 1000)} – ${fFecha.format(datos.hasta * 1000)}` : ''}
          <span> · hora de Hermosillo</span>
          {conRango && <span className="mh-rango"> · <i aria-hidden="true" /> Rango ideal {txtRango} (Configuración)</span>}
        </p>
      </div>
    </div>
  );
}

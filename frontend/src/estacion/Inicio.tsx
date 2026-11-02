import { useState } from 'react';
import type { Sensor, Ultimo, Umbral } from './tipos';
import { Icono } from './Icono';
import { edadTxt, fHoraS, num } from './formato';

function Tarjeta({ id, icono, etq, valor, dec, unidad, err, lo, hi, umb, ts, ahora, onClick }: {
  id: string; icono: string; etq: string; valor: number | null | undefined; dec: number; unidad: string; err: string | null;
  lo: number; hi: number; umb?: Umbral; ts?: number; ahora: number; onClick?: () => void;
}) {
  const ancho = err || valor == null ? 0 : Math.max(3, Math.min(100, ((valor - lo) / (hi - lo)) * 100));
  const fuera = !err && valor != null && umb?.activo && (valor < umb.min || valor > umb.max);
  return (
    <article id={id} className={'vidrio tarjeta' + (onClick ? ' tocable' : '')} onClick={onClick}
      role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={e => { if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick(); }}>
      <Icono id={icono} className="ico grande" />
      <div className="cuerpo">
        <div className="etq">{etq}</div>
        <div className="valor">
          {err ? <b className="err" title={err}>Error sensor</b> : <><b>{num(valor, dec)}</b><small>{unidad}</small></>}
        </div>
        <div className="barra"><i className={fuera ? 'fuera' : ''} style={{ width: `${ancho}%` }} /></div>
        <div className="edad">{ts ? 'Medido ' + edadTxt(ts, ahora) : ''}</div>
      </div>
    </article>
  );
}

function FilaSuelo({ icono, etq, html, err, ts, ahora, extra = '' }: {
  icono: string; etq: string; html: React.ReactNode; err: string | null; ts?: number | null; ahora: number; extra?: string;
}) {
  return (
    <div className="fila">
      <Icono id={icono} />
      <span>{etq}</span>
      {err ? <b className="err" title={err}>Error sensor</b> : <b>{html}</b>}
      <em>{(ts ? 'Lectura ' + edadTxt(ts, ahora) : err || 'sin datos') + extra}</em>
    </div>
  );
}

const txtSensor = (s: Sensor, campo: 't' | 'h', u: string, d = 1) => (s.ok ? `${num(s[campo], d)} ${u}` : 'Error sensor');

export default function Inicio({ d, errorRed }: { d: Ultimo | null; errorRed: boolean }) {
  const [verAire, setVerAire] = useState(false);
  if (!d) return <section className="vista"><div className="vidrio pie-info">{errorRed ? 'Sin conexión con el servidor' : 'Cargando…'}</div></section>;
  if (!d.hay_datos || !d.aire || !d.pir || !d.suelo) return <section className="vista"><div className="vidrio pie-info">Aún no hay lecturas de este nodo.</div></section>;
  const A = d.ahora, ar = d.aire, U = d.umbrales, su = d.suelo;
  const errAire = !ar.a1.ok && !ar.a2.ok ? `A1: ${ar.a1.error} · A2: ${ar.a2.error}` : null;
  const errSuelo = su.ok ? null : su.codigo === 255 ? 'Aún sin lectura' : su.error;
  const extraNpk = d.npk_ultimo_fallo ? ' · último muestreo FALLÓ' : '';
  const f = d.fase!;
  return (
    <section id="v-inicio" className="vista">
      <div className="fila-aire">
        <Tarjeta id="cPir" icono="sol" etq="Radiación solar" valor={d.pir.v} dec={0} unidad="W/m²" err={d.pir.error} lo={0} hi={1000} umb={U.pir} ts={d.ts} ahora={A} />
        <Tarjeta id="cTa" icono="termo" etq="Temperatura aire" valor={ar.t} dec={1} unidad="°C" err={errAire} lo={0} hi={45} umb={U.t_aire} ts={d.ts} ahora={A} onClick={() => setVerAire(v => !v)} />
        <Tarjeta id="cHa" icono="gota" etq="Humedad aire" valor={ar.h} dec={0} unidad="%" err={errAire} lo={0} hi={100} umb={U.h_aire} ts={d.ts} ahora={A} onClick={() => setVerAire(v => !v)} />
      </div>
      {verAire && (
        <div className="vidrio detalle-aire">
          <div className="det-tit">Sensores de aire <button className="x" aria-label="Cerrar" onClick={() => setVerAire(false)}>×</button></div>
          <div className="det-grid">
            {([['Aire 1', ar.a1], ['Aire 2', ar.a2]] as const).map(([n, s]) => (
              <div key={n}><span className="tenue">{n}</span>
                <b className={s.ok ? '' : 'err'}>{txtSensor(s, 't', '°C')}</b>
                <b className={s.ok ? '' : 'err'}>{s.ok ? `${num(s.h)} %` : s.error}</b></div>
            ))}
          </div>
          <p className="tenue chico">La tarjeta muestra el promedio de los sensores válidos.</p>
        </div>
      )}
      <aside className="vidrio panel-suelo">
        <h2><Icono id="hoja" className="ico hoja" />Sensor de tierra</h2>
        <FilaSuelo icono="termo" etq="Temperatura" html={`${num(su.t)} °C`} err={errSuelo} ts={su.ts} ahora={A} />
        <FilaSuelo icono="gota" etq="Humedad" html={`${num(su.h, 0)} %`} err={errSuelo} ts={su.ts} ahora={A} />
        {d.npk ? <>
          <FilaSuelo icono="ph" etq="pH" html={num(d.npk.ph)} err={null} ts={d.npk.ts} ahora={A} extra={extraNpk} />
          <FilaSuelo icono="ec" etq="Conductividad" html={`${num(d.npk.ec, 2)} dS/m`} err={null} ts={d.npk.ts} ahora={A} extra={extraNpk} />
          <FilaSuelo icono="npk" etq="NPK" html={<>{d.npk.n}-{d.npk.p}-{d.npk.k} <small>mg/kg</small></>} err={null} ts={d.npk.ts} ahora={A} extra={extraNpk} />
        </> : (['pH', 'Conductividad', 'NPK'] as const).map((e, i) => (
          <FilaSuelo key={e} icono={['ph', 'ec', 'npk'][i]} etq={e} html="--" err={null} ts={null} ahora={A} extra=" (NPK aún no medido)" />
        ))}
        <p className="tenue chico">{f.fase === 1 ? `Calentando suelo ${f.min}/${f.tot} min` : f.fase === 2 ? 'Muestreando NPK…' : `Próximo NPK en ~${Math.max(0, f.tot - f.min)} min`}</p>
      </aside>
      <div className="vidrio pie-info">
        Última lectura: <b>{fHoraS.format(d.ts! * 1000)}</b> (hace {Math.max(0, Math.round((A - d.ts!) / 60))} min) · paquete {d.tipo} #{d.seq}
        {d.rssi != null && ` · RSSI ${d.rssi} dBm`}{d.snr != null && ` · SNR ${num(d.snr)} dB`}
        {d.sin_hora_emisora && <span style={{ color: 'var(--ambar)' }}> · emisora sin hora (se usó la de recepción)</span>}
        {d.receptora && ` · Receptora ${d.receptora.firmware || ''}, cola ${d.receptora.cola_pendiente ?? '?'}`}
      </div>
    </section>
  );
}

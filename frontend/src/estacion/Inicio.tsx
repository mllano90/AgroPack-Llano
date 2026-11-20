import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Alerta, ExtremoDia, ResumenDia, Sensor, Ultimo, Umbral } from './tipos';
import { Icono } from './Icono';
import { durTxt, edadTxt, fHora, num } from './formato';
import { IND, type DefIndicador } from './indicadores';
import ModalHistorial from './ModalHistorial';
import { fueraDeRango } from './rango';

/** Indicador tocable: abre la ventana emergente con su historial. */
/** Máximo y mínimo de hoy con cuánto duró cada nivel, p. ej. "máx 39.0 °C (2 h)" / "mín 18.0 °C (3 h)".
 * Móvil (≤480 px): sin unidad (ya está en el valor grande) y, en las tarjetas angostas del suelo (≈65 px útiles),
 * ▲/▼ en lugar de "máx"/"mín"; el título (toque largo / hover) conserva el texto completo con la hora del extremo. */
function Extremos({ def, e }: { def: DefIndicador; e?: ExtremoDia | null }) {
  const u = def.unidad ? ' ' + def.unidad : '';
  if (!e) {
    return (
      <span className="ind-ext" title="Aún sin máximo ni mínimo de hoy">
        <span className="ext-max"><span className="ext-q">máx </span><span className="ext-f" aria-hidden="true">▲</span>—</span>
        <span className="ext-min"><span className="ext-q">mín </span><span className="ext-f" aria-hidden="true">▼</span>—</span>
      </span>
    );
  }
  const t = (v: number, ts: number, s: number, q: string) =>
    `${q} de hoy ${num(v, def.dec)}${u} a las ${fHora.format(ts * 1000)}; ${durTxt(s)} cerca de ese nivel (±${num(e.banda, def.dec)}${u})`;
  return (
    <span className="ind-ext" title={`${t(e.max, e.ts_max, e.s_max, 'Máximo')}\n${t(e.min, e.ts_min, e.s_min, 'Mínimo')}`}>
      <span className="ext-max"><span className="ext-q">máx </span><span className="ext-f" aria-hidden="true">▲</span>{num(e.max, def.dec)}<span className="ext-u">{u}</span> <i>({durTxt(e.s_max)})</i></span>
      <span className="ext-min"><span className="ext-q">mín </span><span className="ext-f" aria-hidden="true">▼</span>{num(e.min, def.dec)}<span className="ext-u">{u}</span> <i>({durTxt(e.s_min)})</i></span>
    </span>
  );
}

function Indicador({ def, valor, err, umb, lo, hi, sub, ext, tam = 'normal', alAbrir }: {
  def: DefIndicador; valor: number | null | undefined; err: string | null; umb?: Umbral; lo?: number; hi?: number;
  sub?: React.ReactNode; ext?: ExtremoDia | null; tam?: 'grande' | 'normal' | 'mini'; alAbrir: (d: DefIndicador) => void;
}) {
  const fuera = !err && !!fueraDeRango(valor, umb);
  const ancho = lo == null || hi == null || err || valor == null ? null : Math.max(3, Math.min(100, ((valor - lo) / (hi - lo)) * 100));
  const txt = err ? 'Error sensor' : `${num(valor, def.dec)}${def.unidad ? ' ' + def.unidad : ''}`;
  return (
    <button type="button" id={'ind-' + def.v} className={`ind ind-${tam}${fuera ? ' fuera' : ''}${err ? ' con-error' : ''}`}
      onClick={() => alAbrir(def)} aria-haspopup="dialog" aria-label={`${def.nombre}: ${txt}. Ver historial`}>
      <span className="ind-cab"><Icono id={def.icono} className="ico" /><span className="ind-etq"><span className="etq-larga">{def.corto}</span>{def.mini && <span className="etq-mini">{def.mini}</span>}</span>
        <Icono id="grafica" className="ico ind-graf" /></span>
      <span className="ind-cuerpo">
        <span className="ind-valor">
          {err ? <b className="err" title={err}>Error sensor</b> : <><b>{num(valor, def.dec)}</b>{def.unidad && <small>{def.unidad}</small>}</>}
        </span>
        <Extremos def={def} e={ext} />
      </span>
      {ancho != null && <span className="barra"><i className={fuera ? 'fuera' : ''} style={{ width: `${ancho}%`, background: def.color }} /></span>}
      {sub && <span className="ind-sub">{sub}</span>}
    </button>
  );
}


const sAire = (s: Sensor, c: 't' | 'h', d: number) => (s.ok ? num(s[c], d) : 'err');

/** Avisos de enlace y de bus, los mismos que la lista de Alertas. */
function AvisosEnlace() {
  const [lista, setLista] = useState<Alerta[]>([]);
  useEffect(() => {
    let vivo = true;
    const cargar = () => api.alertas('activa').then(d => {
      if (vivo) setLista(d.alertas.filter(a => a.clave === 'sin_datos' || a.clave === 'err:bus'));
    }).catch(() => {});
    cargar();
    const id = setInterval(cargar, 30000);
    return () => { vivo = false; clearInterval(id); };
  }, []);
  if (!lista.length) return null;
  return (
    <div className="aviso-diag" role="alert">
      {lista.map(a => (
        <p key={a.id}><strong>{a.clave === 'err:bus' ? 'Bus RS485' : 'Sin datos'}</strong>{a.mensaje}</p>
      ))}
    </div>
  );
}

export default function Inicio({ d, errorRed }: { d: Ultimo | null; errorRed: boolean }) {
  const [abierto, setAbierto] = useState<DefIndicador | null>(null);
  const cerrar = useCallback(() => setAbierto(null), []);
  const hay = !!(d?.hay_datos && d.aire && d.pir && d.suelo);
  // extremos del día: se piden al llegar una lectura nueva (cada ~2 min), no en cada refresco de 30 s
  const [dia, setDia] = useState<ResumenDia | null>(null);
  const tsUlt = d?.ts ?? 0;
  useEffect(() => {
    if (!hay) return;
    let vivo = true;
    api.resumenDia().then(r => { if (vivo) setDia(r); }).catch(() => { /* sin extremos: la tarjeta sigue igual */ });
    return () => { vivo = false; };
  }, [hay, tsUlt]);
  const X = dia?.vars ?? {};
  if (!d) return <section className="vista"><div className="vidrio pie-info">{errorRed ? 'Sin conexión con el servidor' : 'Cargando…'}</div></section>;
  if (!d.hay_datos || !d.aire || !d.pir || !d.suelo) return <section className="vista"><div className="vidrio pie-info">Aún no hay lecturas de este nodo.</div></section>;
  const A = d.ahora, ar = d.aire, U = d.umbrales, su = d.suelo, npk = d.npk;
  const errAire = !ar.a1.ok && !ar.a2.ok ? `A1: ${ar.a1.error} · A2: ${ar.a2.error}` : null;
  const errSuelo = su.ok ? null : su.codigo === 255 ? 'Aún sin lectura' : su.error;
  const f = d.fase!;
  const abrir = setAbierto;
  const nq = (k: 'ec' | 'ph' | 'n' | 'p' | 'k') => (npk ? npk[k] : null);
  return (
    <>
    <AvisosEnlace />
    <section id="v-inicio" className="vista">
      {/* ---------- AIRE: arriba de la planta */}
      <div className="vidrio zona zona-aire" aria-label="Aire">
        <h2 className="zona-tit"><Icono id="sol" className="ico" />Aire</h2>
        <div className="ind-grid ind-aire">
          <Indicador def={IND.t_aire} valor={ar.t} err={errAire} umb={U.t_aire} lo={0} hi={45} ext={X.t_aire} tam="grande" alAbrir={abrir}
            sub={<>A1 {sAire(ar.a1, 't', 1)} · A2 {sAire(ar.a2, 't', 1)}</>} />
          <Indicador def={IND.h_aire} valor={ar.h} err={errAire} umb={U.h_aire} lo={0} hi={100} ext={X.h_aire} tam="grande" alAbrir={abrir}
            sub={<>A1 {sAire(ar.a1, 'h', 0)} · A2 {sAire(ar.a2, 'h', 0)}</>} />
          <Indicador def={IND.pir} valor={d.pir.v} err={d.pir.error} umb={U.pir} lo={0} hi={1000} ext={X.pir} tam="grande" alAbrir={abrir}
            sub={d.pir.ok ? ((d.pir.v ?? 0) > 5 ? 'Piranómetro' : 'Sin sol') : d.pir.error} />
        </div>
      </div>

      {/* ---------- PLANTA: zona reservada, ninguna tarjeta la cubre */}
      <figure className="figura-planta" aria-hidden="true" />

      {/* ---------- SUELO: en la parte de la tierra, debajo de la planta */}
      <div className="zona zona-suelo" aria-label="Suelo">
        <h2 className="zona-tit"><Icono id="hoja" className="ico hoja" />Sensor de tierra
          <span className="zona-hora">{f.fase === 1 ? `Calentando suelo ${f.min}/${f.tot} min` : f.fase === 2 ? 'Muestreando NPK…' : `Próximo NPK en ~${Math.max(0, f.tot - f.min)} min`}</span></h2>
        <div className="sub-grupos">
          <div className="sub-grupo">
            <h3>Humedad y temperatura <span>{su.ts ? edadTxt(su.ts, A) : errSuelo || 'sin datos'}</span></h3>
            <div className="ind-grid c2">
              <Indicador def={IND.h_suelo} valor={su.h} err={errSuelo} umb={U.h_suelo} lo={0} hi={100} ext={X.h_suelo} alAbrir={abrir} />
              <Indicador def={IND.t_suelo} valor={su.t} err={errSuelo} umb={U.t_suelo} lo={0} hi={45} ext={X.t_suelo} alAbrir={abrir} />
            </div>
          </div>
          <div className="sub-grupo">
            <h3>Salinidad y acidez <span>{npk ? edadTxt(npk.ts, A) : 'NPK aún no medido'}</span></h3>
            <div className="ind-grid c2">
              <Indicador def={IND.ec} valor={nq('ec')} err={null} umb={U.ec} lo={0} hi={4} ext={X.ec} alAbrir={abrir} />
              <Indicador def={IND.ph} valor={nq('ph')} err={null} umb={U.ph} lo={3} hi={10} ext={X.ph} alAbrir={abrir} />
            </div>
          </div>
          <div className="sub-grupo">
            <h3>Nutrientes NPK <span>{npk ? 'mg/kg' : ''}{d.npk_ultimo_fallo && <em className="aviso"> · último muestreo FALLÓ</em>}</span></h3>
            <div className="ind-grid c3">
              {(['n', 'p', 'k'] as const).map(k => <Indicador key={k} def={IND[k]} valor={nq(k)} err={null} umb={U[k]} ext={X[k]} tam="mini" alAbrir={abrir} />)}
            </div>
          </div>
        </div>
        <p className="pista">Toca un indicador para ver su historial (8 h · 24 h · 7 días · 1 mes)</p>
      </div>

      {abierto && <ModalHistorial def={abierto} umbral={U[abierto.v]} rangoBanda alCerrar={cerrar}
        luz={abierto.v === 'pir' ? { par: d.par_actual ?? null, dli: d.dli_hoy ?? null, factor: d.factor_par ?? 2.02 } : undefined} />}
    </section>
    </>
  );
}

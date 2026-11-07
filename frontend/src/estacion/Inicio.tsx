import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api';
import BarrasEnlace from './Enlace';
import type { ExtremoDia, ResumenDia, Sensor, Ultimo, Umbral } from './tipos';
import { Icono } from './Icono';
import { durTxt, edadTxt, fHora, fHoraS, num } from './formato';
import { IND, type DefIndicador } from './indicadores';
import ModalHistorial from './ModalHistorial';
import fondo from './assets/fondo_continuo.jpg';
import { fueraDeRango } from './rango';
import { prefAmbiente, UMBRAL_AMB } from './prefs';

/** Lienzo de fondo_continuo.jpg (foto original en FOTO, planta en PLANTA). Ver sim/generar_fondo_continuo.py. */
const LIENZO = { w: 2800, h: 3560 }, FOTO = { x: 760, y: 1040 }, PLANTA = { x0: 232, x1: 942, y0: 99, y1: 719 };

export function geometriaFondo(hueco: { left: number; top: number; width: number; height: number }) {
  const pw = PLANTA.x1 - PLANTA.x0, ph = PLANTA.y1 - PLANTA.y0;
  const s = Math.min(hueco.width / pw, hueco.height / ph);
  const cx = FOTO.x + (PLANTA.x0 + PLANTA.x1) / 2, cy = FOTO.y + (PLANTA.y0 + PLANTA.y1) / 2;
  const x = hueco.left + hueco.width / 2 - cx * s, y = hueco.top + hueco.height / 2 - cy * s;
  const planta = { left: x + (FOTO.x + PLANTA.x0) * s, top: y + (FOTO.y + PLANTA.y0) * s, width: pw * s, height: ph * s };
  return { s, x, y, w: LIENZO.w * s, h: LIENZO.h * s, planta };
}

function alinearFondo(fig: HTMLElement, capa: HTMLElement) {
  const r = fig.getBoundingClientRect();
  if (!r.height || !r.width) return;
  const g = geometriaFondo(r);
  capa.style.backgroundImage = `url(${fondo})`;
  capa.style.backgroundSize = `${g.w}px ${g.h}px`;
  capa.style.backgroundPosition = `${g.x}px ${g.y}px`;
  const p = g.planta;
  capa.dataset.planta = [p.left, p.top, p.width, p.height].map(v => Math.round(v)).join(',');
}

/** Indicador tocable: abre la ventana emergente con su historial. */
/** Máximo y mínimo de hoy con cuánto duró cada nivel, p. ej. "máx 39.0 °C (2 h)" / "mín 18.0 °C (3 h)".
 * Móvil (≤480 px): sin unidad (ya está en el valor grande) y, en las tarjetas angostas del suelo (≈65 px útiles),
 * ▲/▼ en lugar de "máx"/"mín"; el título (toque largo / hover) conserva el texto completo con la hora del extremo. */
function Extremos({ def, e }: { def: DefIndicador; e?: ExtremoDia | null }) {
  if (!e) return null;
  const u = def.unidad ? ' ' + def.unidad : '';
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


/** Tarjeta compacta de conexión LoRa: click despliega lectura, receptora, cola y barras RSSI/SNR. */
function TarjetaConexion({ d }: { d: Ultimo }) {
  const [abierta, setAbierta] = useState(false);
  const A = d.ahora;
  const fw = (d.receptora?.firmware || '').replace(/^receptora-/, 'v');
  const resumen = [
    edadTxt(d.ts, A) || 'sin lectura',
    d.rssi != null ? `RSSI ${d.rssi}` : null,
    d.snr != null ? `SNR ${Number(d.snr).toFixed(1)}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <button type="button" className={'tarjeta-conexion meta-lectura' + (abierta ? ' abierta' : '')}
      aria-expanded={abierta} onClick={() => setAbierta(v => !v)}
      aria-label={abierta ? 'Ocultar detalle de conexión' : 'Ver detalle de conexión'}>
      <span className="tc-cab">
        <Icono id="wifi" className="ico" />
        <span className="tc-tit">Conexión</span>
        {!abierta && <span className="tc-resumen">{resumen}</span>}
        <span className="tc-chev" aria-hidden="true">{abierta ? '▾' : '▸'}</span>
      </span>
      <BarrasEnlace rssi={d.rssi} snr={d.snr} />
      {abierta && (
        <span className="tc-det">
          <span>Última lectura: <b>{d.ts ? fHoraS.format(d.ts * 1000) : '--'}</b>
            {d.ts != null && <> (hace {Math.max(0, Math.round((A - d.ts) / 60))} min)</>}
            {d.tipo != null && <> · paquete {d.tipo} #{d.seq}</>}
          </span>
          {d.sin_hora_emisora && <span className="tc-aviso">Emisora sin hora (se usó la de recepción)</span>}
          {d.receptora && <span>Receptora {fw || '?'}, cola {d.receptora.cola_pendiente ?? '?'}</span>}
        </span>
      )}
    </button>
  );
}


/** Capa CSS ligera: tinte cálido/frío y haz de sol según aire y piranómetro. No captura clics. */
function ambienteQuieto(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || window.matchMedia('(max-width: 699px), (pointer: coarse)').matches;
}

function CapaAmbiente({ tAire, pir }: { tAire: number | null | undefined; pir: number | null | undefined }) {
  if (!prefAmbiente.activo() || ambienteQuieto()) return null;
  const clases = ['capa-ambiente'];
  if (tAire != null && tAire > UMBRAL_AMB.calor) clases.push('amb-calido');
  else if (tAire != null && tAire < UMBRAL_AMB.frio) clases.push('amb-frio');
  if (pir != null && pir >= UMBRAL_AMB.sol) clases.push('amb-sol');
  if (clases.length === 1) return null; // sin efecto activo
  return <div className={clases.join(' ')} aria-hidden="true" />;
}

const sAire = (s: Sensor, c: 't' | 'h', d: number) => (s.ok ? num(s[c], d) : 'err');

export default function Inicio({ d, errorRed }: { d: Ultimo | null; errorRed: boolean }) {
  const [abierto, setAbierto] = useState<DefIndicador | null>(null);
  const cerrar = useCallback(() => setAbierto(null), []);
  const fig = useRef<HTMLElement>(null), capa = useRef<HTMLDivElement>(null);
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
  useLayoutEffect(() => {
    if (!hay || !fig.current || !capa.current) return;
    const f = fig.current, c = capa.current, ajustar = () => alinearFondo(f, c);
    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(f);
    window.addEventListener('resize', ajustar);
    window.addEventListener('orientationchange', ajustar);
    return () => { ro.disconnect(); window.removeEventListener('resize', ajustar); window.removeEventListener('orientationchange', ajustar); };
  }, [hay]);
  if (!d) return <section className="vista"><div className="vidrio pie-info">{errorRed ? 'Sin conexión con el servidor' : 'Cargando…'}</div></section>;
  if (!d.hay_datos || !d.aire || !d.pir || !d.suelo) return <section className="vista"><div className="vidrio pie-info">Aún no hay lecturas de este nodo.</div></section>;
  const A = d.ahora, ar = d.aire, U = d.umbrales, su = d.suelo, npk = d.npk;
  const errAire = !ar.a1.ok && !ar.a2.ok ? `A1: ${ar.a1.error} · A2: ${ar.a2.error}` : null;
  const errSuelo = su.ok ? null : su.codigo === 255 ? 'Aún sin lectura' : su.error;
  const f = d.fase!;
  const abrir = setAbierto;
  const nq = (k: 'ec' | 'ph' | 'n' | 'p' | 'k') => (npk ? npk[k] : null);
  return (
    <section id="v-inicio" className="vista">
      <div ref={capa} className="escena-fondo" aria-hidden="true" />
      <CapaAmbiente tAire={ar.t} pir={d.pir.v} />
      {/* ---------- AIRE: arriba de la planta */}
      <div className="vidrio zona zona-aire" aria-label="Aire">
        <h2 className="zona-tit"><Icono id="sol" className="ico" />Aire<span className="zona-hora">Lectura {edadTxt(d.ts, A)}</span></h2>
        <div className="ind-grid ind-aire">
          <Indicador def={IND.t_aire} valor={ar.t} err={errAire} umb={U.t_aire} lo={0} hi={45} ext={X.t_aire} tam="grande" alAbrir={abrir}
            sub={<>A1 {sAire(ar.a1, 't', 1)} · A2 {sAire(ar.a2, 't', 1)}</>} />
          <Indicador def={IND.h_aire} valor={ar.h} err={errAire} umb={U.h_aire} lo={0} hi={100} ext={X.h_aire} tam="grande" alAbrir={abrir}
            sub={<>A1 {sAire(ar.a1, 'h', 0)} · A2 {sAire(ar.a2, 'h', 0)}</>} />
          <Indicador def={IND.pir} valor={d.pir.v} err={d.pir.error} umb={U.pir} lo={0} hi={1000} ext={X.pir} tam="grande" alAbrir={abrir}
            sub={d.pir.ok ? ((d.pir.v ?? 0) > 5 ? 'Piranómetro' : 'Sin sol') : d.pir.error} />
        </div>
        <TarjetaConexion d={d} />
      </div>

      {/* ---------- PLANTA: zona reservada, ninguna tarjeta la cubre */}
      <figure ref={fig} className="figura-planta" aria-hidden="true" />

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
              <Indicador def={IND.ec} valor={nq('ec')} err={null} umb={U.ec} lo={0} hi={4} alAbrir={abrir} />
              <Indicador def={IND.ph} valor={nq('ph')} err={null} umb={U.ph} lo={3} hi={10} alAbrir={abrir} />
            </div>
          </div>
          <div className="sub-grupo">
            <h3>Nutrientes NPK <span>{npk ? 'mg/kg' : ''}{d.npk_ultimo_fallo && <em className="aviso"> · último muestreo FALLÓ</em>}</span></h3>
            <div className="ind-grid c3">
              {(['n', 'p', 'k'] as const).map(k => <Indicador key={k} def={IND[k]} valor={nq(k)} err={null} umb={U[k]} tam="mini" alAbrir={abrir} />)}
            </div>
          </div>
        </div>
        <p className="pista">Toca un indicador para ver su historial (8 h · 24 h · 7 días · 1 mes)</p>
      </div>

      {abierto && <ModalHistorial def={abierto} umbral={U[abierto.v]} rangoBanda alCerrar={cerrar} />}
    </section>
  );
}

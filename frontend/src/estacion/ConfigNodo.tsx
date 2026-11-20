import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import type { Config, Cuenta, Ultimo } from './tipos';
import { Icono } from './Icono';
import { num } from './formato';
import Mantenimiento from './Mantenimiento';
import RedWifi from './RedWifi';
import PruebaEnlace from './PruebaEnlace';
import { prefAmbiente } from './prefs';
import { fasePreviewGuardada, fijarFasePreview } from './faseReloj';
import type { FaseId } from './faseDelDia';
import BarrasEnlace from './Enlace';
import ModalHistorial from './ModalHistorial';
import { IND, type DefIndicador } from './indicadores';
import { FACTOR_PAR_BASE, FACTOR_PAR_MAX, FACTOR_PAR_MIN, factorDeCampo, factorValido } from './luzPar';

function Cuentas() {
  const [lista, setLista] = useState<Cuenta[]>([]);
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { api.usuarios().then(d => setLista(d.usuarios)).catch(e => setMsg(e.message)); }, []);
  const crear = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      await api.crearUsuario(usuario.trim(), clave);
      setUsuario('');
      setClave('');
      setMsg('✔ Cuenta creada. Solo ve la estación.');
      setLista((await api.usuarios()).usuarios);
    } catch (err) { setMsg('✖ ' + (err as Error).message); }
  };
  return (
    <form className="vidrio bloque" onSubmit={crear}>
      <h2>Cuentas</h2>
      <p className="tenue">La cuenta nueva es de acceso normal: Inicio, Historial y Alertas. No entra a empaque, a esta configuración ni al modo programación. Desde aquí no se crea otro administrador.</p>
      <div className="dos">
        <label>Usuario<input name="nuevo-usuario" autoComplete="off" required minLength={3} maxLength={32} value={usuario} onChange={e => setUsuario(e.target.value)} /></label>
        <label>Contraseña<input name="nueva-clave" type="password" autoComplete="new-password" required minLength={10} maxLength={72} value={clave} onChange={e => setClave(e.target.value)} /></label>
      </div>
      <div className="acciones"><button className="btn primario" type="submit">Crear cuenta</button><span className="tenue">{msg}</span></div>
      <ul className="lista-cuentas">
        {lista.map(c => (
          <li key={c.usuario}><b>{c.usuario}</b><span className="tenue">{c.rol === 'admin' ? 'Administrador' : 'Acceso normal'}</span></li>
        ))}
      </ul>
    </form>
  );
}

function numero(txt: string): number {
  return Number(String(txt).trim().replace(',', '.'));
}

/** Calibración del factor PAR. El cálculo llena el campo; Guardar lo persiste. */
function CalibracionPar({ cfg, setCfg, ultimo }: {
  cfg: Config; setCfg: (c: Config) => void; ultimo: Ultimo | null;
}) {
  const [factor, setFactor] = useState(String(cfg.factor_par ?? FACTOR_PAR_BASE));
  const [medido, setMedido] = useState('');
  const [wm2, setWm2] = useState('');
  const [msg, setMsg] = useState('');
  const guardar = async () => {
    const f = numero(factor);
    if (!factorValido(f)) {
      setMsg(`✖ El factor debe estar entre ${FACTOR_PAR_MIN} y ${FACTOR_PAR_MAX}`);
      return;
    }
    try {
      const r = await api.guardarConfig({ ...cfg, factor_par: f });
      const sig = r?.config ? { ...cfg, ...r.config, factor_par: f } : { ...cfg, factor_par: f };
      setCfg(sig);
      setFactor(String(sig.factor_par ?? f));
      setMsg('✔ Factor guardado');
    } catch (err) { setMsg('✖ ' + (err as Error).message); }
  };
  const usarActual = () => {
    const p = ultimo?.pir;
    if (!p?.ok || p.v == null) { setMsg('✖ No hay radiación válida ahora'); return; }
    setWm2(String(p.v));
    setMsg('');
  };
  const calcular = () => {
    const f = factorDeCampo(numero(medido), numero(wm2));
    if (f == null) { setMsg('✖ Indica un PAR medido y una radiación mayor que 0'); return; }
    setFactor(String(f));
    setMsg(factorValido(f) ? 'Factor calculado. Pulsa Guardar para aplicarlo.' : `✖ ${f} queda fuera de ${FACTOR_PAR_MIN} a ${FACTOR_PAR_MAX}`);
  };
  return (
    <div className="vidrio bloque cal-par" aria-label="Calibración de luz PAR">
      <h2>Calibración de luz PAR</h2>
      <p className="tenue chico">Base 2.02 para malla sombra blanca o neutra bajo luz solar. Ajusta el factor tras medir junto al piranómetro con un medidor PAR.</p>
      <label>Factor de conversión (µmol/m²/s por W/m²)
        <input type="number" min={FACTOR_PAR_MIN} max={FACTOR_PAR_MAX} step={0.01} inputMode="decimal"
          value={factor} onChange={e => setFactor(e.target.value)} />
      </label>
      <div className="acciones">
        <button className="btn primario" type="button" onClick={guardar}>Guardar</button>
        <button className="btn" type="button" onClick={() => { setFactor(String(FACTOR_PAR_BASE)); setMsg(''); }}>Restablecer 2.02</button>
      </div>
      <h3>Calculadora de campo</h3>
      <div className="dos">
        <label>PAR medido (medidor PAR)
          <input type="number" min={0} step={1} inputMode="decimal" value={medido} onChange={e => setMedido(e.target.value)} />
        </label>
        <label>Radiación estación (W/m²)
          <input type="number" min={0} step={1} inputMode="decimal" value={wm2} onChange={e => setWm2(e.target.value)} />
        </label>
      </div>
      <div className="acciones">
        <button className="btn" type="button" onClick={usarActual}>Usar lectura actual</button>
        <button className="btn" type="button" onClick={calcular}>Calcular factor</button>
      </div>
      {msg && <p className="tenue chico" role="status">{msg}</p>}
    </div>
  );
}

/** Configuración de nodo: solo admin. La caja no se muestra en Inicio. */
export default function ConfigNodo({ ultimo, alGuardar, alSalir }: {
  ultimo: Ultimo | null; alGuardar: () => void; alSalir: () => void;
}) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [msg, setMsg] = useState('');
  const [ambiente, setAmbiente] = useState(() => prefAmbiente.activo());
  const [preview, setPreview] = useState<FaseId | ''>(() => fasePreviewGuardada());
  const [hist, setHist] = useState<DefIndicador | null>(null);
  const cerrarHist = useCallback(() => setHist(null), []);
  const togAmbiente = () => { const v = !ambiente; prefAmbiente.set(v); setAmbiente(v); };
  const elegirFase = (v: string) => {
    const id = (v || '') as FaseId | '';
    setPreview(id);
    fijarFasePreview(id);
  };
  useEffect(() => { api.config().then(setCfg).catch(e => setMsg(e.message)); }, []);
  if (!cfg) return <section className="vista"><div className="vidrio bloque">{msg || 'Cargando…'}</div></section>;
  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.guardarConfig({
        nombre_nodo: cfg.nombre_nodo, sin_datos_min: cfg.sin_datos_min, offline_min: cfg.offline_min,
        bateria_min_v: cfg.bateria_min_v, factor_par: cfg.factor_par ?? FACTOR_PAR_BASE, umbrales: cfg.umbrales,
      });
      if (r && 'config' in r && r.config) setCfg({ ...cfg, ...r.config });
      setMsg('✔ Guardado'); alGuardar();
    } catch (err) { setMsg('✖ ' + (err as Error).message); }
    setTimeout(() => setMsg(''), 4000);
  };
  const caja = ultimo?.interno;
  const hayCaja = !!(caja && caja.codigo !== 255 && caja.codigo != null);
  return (
    <section id="v-config-nodo" className="vista">
      <div className="vidrio bloque bloque-enlace" aria-label="Enlace LoRa">
        <h2>Enlace LoRa</h2>
        <p className="tenue chico">Fuerza de la señal e interferencia de la última lectura. No se muestran en Inicio.</p>
        {ultimo?.hay_datos && (ultimo.rssi != null || ultimo.snr != null)
          ? <BarrasEnlace rssi={ultimo.rssi} snr={ultimo.snr} />
          : <p className="tenue">Aún sin datos de enlace.</p>}
      </div>
      <div className="vidrio bloque bloque-caja" aria-label="Interior de la caja">
        <h2>Interior caja</h2>
        <p className="tenue chico">Sensor XY-MD01 de la caja. Toca una tarjeta para ver su historial. No sale en Inicio.</p>
        <div className="caja-vals">
          <button type="button" className={'caja-val' + (hayCaja && !caja!.ok ? ' malo' : '')}
            onClick={() => setHist(IND.t_caja)} aria-haspopup="dialog" aria-label="Temperatura de la caja. Ver historial">
            <span>Temperatura</span>
            <b>{hayCaja && caja!.ok ? <>{num(caja!.t, 1)}<small> °C</small></> : (hayCaja ? (caja!.error || 'Error') : '—')}</b>
          </button>
          <button type="button" className={'caja-val' + (hayCaja && !caja!.ok ? ' malo' : '')}
            onClick={() => setHist(IND.h_caja)} aria-haspopup="dialog" aria-label="Humedad de la caja. Ver historial">
            <span>Humedad</span>
            <b>{hayCaja && caja!.ok ? <>{num(caja!.h, 0)}<small> %</small></> : (hayCaja ? (caja!.error || 'Error') : '—')}</b>
          </button>
        </div>
        {!hayCaja && <p className="tenue chico">Aún sin lectura en vivo{caja?.codigo != null ? ` (código ${caja.codigo})` : ''}. El historial abre las lecturas guardadas.</p>}
      </div>
      <div className="vidrio bloque" aria-label="Ambiente animado">
        <h2>Ambiente en Inicio</h2>
        <p className="tenue chico">El fondo de la estación sigue la hora del sol en Guaymas en todas las pestañas: noche, amanecer, mañana, mediodía y atardecer. En Inicio, encima van un haz de luz y partículas (polvo de día, brasas al atardecer, luciérnagas de noche); también se animan en el teléfono. Esta casilla apaga el haz y las partículas; la foto sigue la hora. Si el teléfono pide menos movimiento, o si la app queda en segundo plano, la animación se pausa. La vista previa dura solo esta sesión y vale para todas las pestañas.</p>
        <label className="check">
          <input type="checkbox" checked={ambiente} onChange={togAmbiente} />
          Animaciones de ambiente {ambiente ? 'activadas' : 'desactivadas'}
        </label>
        <label>Vista previa del fondo
          <select value={preview} onChange={e => elegirFase(e.target.value)}>
            <option value="">Según el sol (Guaymas)</option>
            <option value="noche">Noche</option>
            <option value="amanecer">Amanecer</option>
            <option value="manana">Mañana</option>
            <option value="mediodia">Mediodía y tarde</option>
            <option value="atardecer">Atardecer</option>
          </select>
        </label>
      </div>
      <CalibracionPar cfg={cfg} setCfg={setCfg} ultimo={ultimo} />
      <form className="vidrio bloque" onSubmit={guardar}>
        <h2>Configuración del nodo</h2>
        <label>Nombre del nodo<input maxLength={60} required value={cfg.nombre_nodo} onChange={e => setCfg({ ...cfg, nombre_nodo: e.target.value })} /></label>
        <div className="dos">
          <label>Alerta "sin datos" tras (min)<input type="number" min={3} max={1440} required value={cfg.sin_datos_min} onChange={e => setCfg({ ...cfg, sin_datos_min: +e.target.value })} /></label>
          <label>"Sin conexión" tras (min)<input type="number" min={3} max={120} required value={cfg.offline_min} onChange={e => setCfg({ ...cfg, offline_min: +e.target.value })} /></label>
        </div>
        <div className="acciones"><button className="btn primario" type="submit">Guardar</button><span className="tenue">{msg}</span></div>
      </form>
      <Cuentas />
      <RedWifi />
      <PruebaEnlace />
      <Mantenimiento />
      <div className="salir"><button className="btn" type="button" onClick={alSalir}><Icono id="salir" />Cerrar sesión</button></div>
      {hist && <ModalHistorial def={hist} umbral={cfg.umbrales[hist.v]} alCerrar={cerrarHist} />}
    </section>
  );
}

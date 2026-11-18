import { useEffect, useState, type FormEvent } from 'react';
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

/** Configuración de nodo: solo admin. La caja no se muestra en Inicio. */
export default function ConfigNodo({ ultimo, alGuardar, alSalir }: {
  ultimo: Ultimo | null; alGuardar: () => void; alSalir: () => void;
}) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [msg, setMsg] = useState('');
  const [ambiente, setAmbiente] = useState(() => prefAmbiente.activo());
  const [preview, setPreview] = useState<FaseId | ''>(() => fasePreviewGuardada());
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
        bateria_min_v: cfg.bateria_min_v, umbrales: cfg.umbrales,
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
        <p className="tenue chico">Sensor de la caja de control. Solo lo ve el administrador; no sale en Inicio.</p>
        {!hayCaja ? (
          <p className="tenue">Aún sin lectura de caja{caja?.codigo != null ? ` (código ${caja.codigo})` : ''}.</p>
        ) : (
          <div className="caja-vals">
            <div className={'caja-val' + (caja!.ok ? '' : ' malo')}>
              <span>Temperatura</span>
              <b>{caja!.ok ? <>{num(caja!.t, 1)}<small> °C</small></> : (caja!.error || 'Error')}</b>
            </div>
            <div className={'caja-val' + (caja!.ok ? '' : ' malo')}>
              <span>Humedad</span>
              <b>{caja!.ok ? <>{num(caja!.h, 0)}<small> %</small></> : (caja!.error || 'Error')}</b>
            </div>
          </div>
        )}
      </div>
      <div className="vidrio bloque" aria-label="Ambiente animado">
        <h2>Ambiente en Inicio</h2>
        <p className="tenue chico">El fondo de Inicio sigue el amanecer y el ocaso de Guaymas: un haz y polvo suave, el mismo momento en la foto. Se apaga con esta casilla o si el teléfono pide menos movimiento. La vista previa dura solo esta sesión.</p>
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
    </section>
  );
}

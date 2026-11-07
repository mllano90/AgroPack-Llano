import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import type { Config, Cuenta } from './tipos';
import { Icono } from './Icono';
import Mantenimiento from './Mantenimiento';

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
      <p className="tenue">La cuenta nueva es de acceso normal: ve lecturas, historial y alertas. No entra a empaque, a esta configuración, al WiFi ni al modo programación. Desde aquí no se crea otro administrador.</p>
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

export default function Configuracion({ alGuardar, alSalir }: { alGuardar: () => void; alSalir: () => void }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.config().then(setCfg).catch(e => setMsg(e.message)); }, []);
  if (!cfg) return <section className="vista"><div className="vidrio bloque">{msg || 'Cargando…'}</div></section>;
  const umb = (k: string, campo: 'min' | 'max' | 'activo', val: number | boolean) =>
    setCfg({ ...cfg, umbrales: { ...cfg.umbrales, [k]: { ...cfg.umbrales[k], [campo]: val } } });
  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.guardarConfig({ nombre_nodo: cfg.nombre_nodo, sin_datos_min: cfg.sin_datos_min, offline_min: cfg.offline_min,
        bateria_min_v: cfg.bateria_min_v, umbrales: cfg.umbrales });
      setMsg('✔ Guardado'); alGuardar();
    } catch (err) { setMsg('✖ ' + (err as Error).message); }
    setTimeout(() => setMsg(''), 4000);
  };
  return (
    <section id="v-config" className="vista">
      <form className="vidrio bloque" onSubmit={guardar}>
        <h2>Configuración</h2>
        <label>Nombre del nodo<input maxLength={60} required value={cfg.nombre_nodo} onChange={e => setCfg({ ...cfg, nombre_nodo: e.target.value })} /></label>
        <div className="dos">
          <label>Alerta "sin datos" tras (min)<input type="number" min={3} max={1440} required value={cfg.sin_datos_min} onChange={e => setCfg({ ...cfg, sin_datos_min: +e.target.value })} /></label>
          <label>"Sin conexión" tras (min)<input type="number" min={3} max={120} required value={cfg.offline_min} onChange={e => setCfg({ ...cfg, offline_min: +e.target.value })} /></label>
        </div>
        <h3>Umbrales de alerta</h3>
        <div className="tabla-umb">
          <div className="u cab"><span>Variable</span><span>Mín</span><span>Máx</span><span>On</span></div>
          {Object.entries(cfg.umbrales).map(([k, u]) => (
            <div className="u" key={k}>
              <span>{cfg.variables[k]?.nombre} <small>{cfg.variables[k]?.unidad}</small></span>
              <input type="number" step="any" aria-label="mínimo" value={u.min} onChange={e => umb(k, 'min', +e.target.value)} />
              <input type="number" step="any" aria-label="máximo" value={u.max} onChange={e => umb(k, 'max', +e.target.value)} />
              <input type="checkbox" aria-label="activo" checked={u.activo} onChange={e => umb(k, 'activo', e.target.checked)} />
            </div>
          ))}
        </div>
        <div className="acciones"><button className="btn primario" type="submit">Guardar</button><span className="tenue">{msg}</span></div>
      </form>
      <Cuentas />
      <Mantenimiento />
      <div className="salir"><button className="btn" type="button" onClick={alSalir}><Icono id="salir" />Cerrar sesión</button></div>
    </section>
  );
}

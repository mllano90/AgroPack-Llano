import { useCallback, useEffect, useState } from 'react';
import './estacion.css';
import { api, enNoAutorizado, sesion } from './api';
import type { Ultimo } from './tipos';
import { Icono, SpriteIconos } from './Icono';
import Login from './Login';
import Inicio from './Inicio';
import Historial from './Historial';
import Rangos from './Rangos';
import ConfigNodo from './ConfigNodo';
import Alertas from './Alertas';
import { MARCA, MARCA_FIRMA, MARCA_NOMBRE, NODO_POR_DEFECTO } from './marca';
import { leyendaLectura } from './formato';
import Instalar from './Instalar';
import { ensancharLienzo, montarMetaPWA, registrarWorkerEstacion } from './pwa';

type Vista = 'inicio' | 'historial' | 'rangos' | 'nodo' | 'alertas';
type Rol = 'admin' | 'normal';
const VISTAS: Vista[] = ['inicio', 'historial', 'rangos', 'nodo', 'alertas'];
const vistaDeHash = (): Vista => {
  const raw = location.hash.replace('#', '');
  const v = (raw === 'config' ? 'nodo' : raw) as Vista;
  return VISTAS.includes(v) ? v : 'inicio';
};

/** Módulo de la estación. La ruta de AgroPack sigue siendo /estacion. */
export default function EstacionApp() {
  const [token, setToken] = useState(sesion.token());
  const [rol, setRol] = useState<Rol | null>(null);
  const [vista, setVista] = useState<Vista>(vistaDeHash());
  const [ultimo, setUltimo] = useState<Ultimo | null>(null);
  const [errorRed, setErrorRed] = useState(false);

  useEffect(() => { enNoAutorizado(() => { setToken(null); setRol(null); }); }, []);
  useEffect(() => {
    const limpiar = [ensancharLienzo(), montarMetaPWA()];
    registrarWorkerEstacion();
    return () => limpiar.forEach(f => f());
  }, []);
  useEffect(() => {
    if (!token) { setRol(null); return; }
    api.yo().then(y => setRol(y.rol)).catch(() => {});
  }, [token]);
  useEffect(() => {
    const f = () => setVista(vistaDeHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  const cargar = useCallback(async () => {
    try { setUltimo(await api.ultimo()); setErrorRed(false); } catch { setErrorRed(true); }
  }, []);
  useEffect(() => {
    if (!token) return;
    cargar();
    const id = setInterval(cargar, 30000);
    return () => clearInterval(id);
  }, [token, cargar]);

  if (!token) {
    return (
      <div className="estacion-root">
        <SpriteIconos />
        <Login alEntrar={(t, r) => { sesion.guardar(t); setToken(t); setRol(r); }} />
        <div className="login-instalar"><Instalar /></div>
      </div>
    );
  }

  const admin = rol === 'admin';
  const on = !!(ultimo?.hay_datos && ultimo.en_linea);
  const leyenda = leyendaLectura(ultimo?.ts, ultimo?.ahora ?? 0, !!ultimo?.hay_datos);
  const tituloLectura = !ultimo?.hay_datos || ultimo.ts == null
    ? 'Aún no hay una lectura de este nodo.'
    : ultimo.sin_hora_emisora
      ? 'La emisora no traía hora; se muestra la hora en que se recibió el paquete.'
      : 'Hora de la última lectura. En línea solo indica si esa lectura es reciente.';
  const ir = (v: Vista) => { location.hash = v; setVista(v); window.scrollTo(0, 0); };
  const salir = () => { sesion.borrar(); setToken(null); setRol(null); };
  const vistaOk: Vista = !admin && (vista === 'nodo' || vista === 'rangos') ? 'inicio' : vista;
  const nav: [Vista, string, string][] = [
    ['inicio', 'casa', 'Inicio'],
    ['historial', 'grafica', 'Historial'],
    ...(admin ? [['rangos', 'rangos', 'Rangos'] as [Vista, string, string], ['nodo', 'engrane', 'Config'] as [Vista, string, string]] : []),
    ['alertas', 'campana', 'Alertas'],
  ];
  return (
    <div className={'estacion-root' + (vistaOk === 'inicio' ? ' en-inicio' : '')}>
      <SpriteIconos />
      <div className="fondo" />
      <header className="vidrio cabecera">
        <Icono id="hoja" className="ico hoja" />
        <div className="marca">
          <h1>{MARCA}<span className="marca-nombre">{MARCA_NOMBRE}</span><span className="marca-firma">{MARCA_FIRMA}</span></h1>
          <div className="marca-nodo">{ultimo?.nombre_nodo ?? NODO_POR_DEFECTO}</div>
        </div>
        <div className="cab-acciones">
          <div className="estado-senal">
            <div className={'conexion' + (on ? '' : ' off')} title={on ? `En línea: la última lectura tiene menos de ${ultimo?.offline_min ?? ''} min.` : 'Sin conexión: no hay una lectura reciente.'}>
              <span className="punto" />
              <span>{on ? 'En línea' : 'Sin conexión'}</span>
              <Icono id={on ? 'wifi' : 'wifi-off'} className={'ico wifi' + (on ? '' : ' off')} />
            </div>
            <span className="ultima-lectura" title={tituloLectura}>{leyenda}</span>
          </div>
          <Instalar />
          <button className="btn" type="button" onClick={salir}>Salir</button>
        </div>
      </header>
      <main>
        {vistaOk === 'inicio' && <Inicio d={ultimo} errorRed={errorRed} />}
        {vistaOk === 'historial' && <Historial esAdmin={admin} />}
        {vistaOk === 'rangos' && admin && <Rangos alGuardar={cargar} alSalir={salir} />}
        {vistaOk === 'nodo' && admin && <ConfigNodo ultimo={ultimo} alGuardar={cargar} alSalir={salir} />}
        {vistaOk === 'alertas' && <Alertas alCambiar={cargar} puedeResolver={admin} />}
        <footer className="pie-marca">{MARCA} · {MARCA_NOMBRE} · <span>{MARCA_FIRMA}</span></footer>
      </main>
      <nav className="vidrio barra-nav">
        {nav.map(([v, ic, txt]) => (
          <a key={v} href={`#${v}`} className={vistaOk === v ? 'on' : ''} onClick={e => { e.preventDefault(); ir(v); }}>
            {v === 'alertas'
              ? <span className="campana"><Icono id={ic} />{!!ultimo?.alertas_activas && <span className="badge">{ultimo.alertas_activas > 99 ? '99+' : ultimo.alertas_activas}</span>}</span>
              : <Icono id={ic} />}
            {txt}
          </a>
        ))}
      </nav>
    </div>
  );
}

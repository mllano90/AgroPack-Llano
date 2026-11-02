import { useCallback, useEffect, useState } from 'react';
import './estacion.css';
import { api, enNoAutorizado, sesion } from './api';
import type { Ultimo } from './tipos';
import { Icono, SpriteIconos } from './Icono';
import Login from './Login';
import Inicio from './Inicio';
import Historial from './Historial';
import Configuracion from './Configuracion';
import Alertas from './Alertas';

type Vista = 'inicio' | 'historial' | 'config' | 'alertas';
const VISTAS: Vista[] = ['inicio', 'historial', 'config', 'alertas'];
const vistaDeHash = (): Vista => {
  const v = location.hash.replace('#', '') as Vista;
  return VISTAS.includes(v) ? v : 'inicio';
};

/** Módulo completo de la estación. En AgroPack: <Route path="/estacion/*" element={<EstacionApp />} /> */
export default function EstacionApp() {
  const [token, setToken] = useState(sesion.token());
  const [vista, setVista] = useState<Vista>(vistaDeHash());
  const [ultimo, setUltimo] = useState<Ultimo | null>(null);
  const [errorRed, setErrorRed] = useState(false);

  useEffect(() => { enNoAutorizado(() => setToken(null)); }, []);
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

  if (!token) return <div className="estacion-root"><SpriteIconos /><Login alEntrar={t => { sesion.guardar(t); setToken(t); }} /></div>;

  const on = !!(ultimo?.hay_datos && ultimo.en_linea);
  const ir = (v: Vista) => { location.hash = v; setVista(v); window.scrollTo(0, 0); };
  return (
    <div className="estacion-root">
      <SpriteIconos />
      <div className="fondo" />
      <header className="vidrio cabecera">
        <Icono id="hoja" className="ico hoja" />
        <h1>{ultimo?.nombre_nodo ?? 'Nodo Cultivo – Casa Sombra'}</h1>
        <div className={'conexion' + (on ? '' : ' off')}><span className="punto" /><span>{on ? 'En línea' : 'Sin conexión'}</span></div>
        <Icono id={on ? 'wifi' : 'wifi-off'} className={'ico wifi' + (on ? '' : ' off')} />
      </header>
      <main>
        {vista === 'inicio' && <Inicio d={ultimo} errorRed={errorRed} />}
        {vista === 'historial' && <Historial />}
        {vista === 'config' && <Configuracion alGuardar={cargar} alSalir={() => { sesion.borrar(); setToken(null); }} />}
        {vista === 'alertas' && <Alertas alCambiar={cargar} />}
      </main>
      <nav className="vidrio barra-nav">
        {([['inicio', 'casa', 'Inicio'], ['historial', 'grafica', 'Historial'], ['config', 'engrane', 'Configuración'], ['alertas', 'campana', 'Alertas']] as const).map(([v, ic, txt]) => (
          <a key={v} href={`#${v}`} className={vista === v ? 'on' : ''} onClick={e => { e.preventDefault(); ir(v); }}>
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

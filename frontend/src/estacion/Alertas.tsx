import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Alerta } from './tipos';
import { fFecha } from './formato';

const TIPOS: Record<string, string> = { sin_datos: 'Sin datos', error_sensor: 'Error de sensor', fuera_rango: 'Fuera de rango',
  reinicio: 'Reinicio emisora', bateria: 'Batería', comando: 'Comando remoto' };

export default function Alertas({ alCambiar }: { alCambiar: () => void }) {
  const [filtro, setFiltro] = useState('activa');
  const [lista, setLista] = useState<Alerta[] | null>(null);
  const cargar = useCallback(() => api.alertas(filtro).then(d => setLista(d.alertas)).catch(() => {}), [filtro]);
  useEffect(() => { cargar(); const id = setInterval(cargar, 30000); return () => clearInterval(id); }, [cargar]);
  const resolver = async (id: number) => { await api.resolverAlerta(id); cargar(); alCambiar(); };
  return (
    <section id="v-alertas" className="vista">
      <div className="vidrio bloque">
        <div className="seg">
          {[['activa', 'Activas'], ['todas', 'Todas'], ['resuelta', 'Resueltas']].map(([f, t]) =>
            <button key={f} className={f === filtro ? 'on' : ''} onClick={() => setFiltro(f)}>{t}</button>)}
        </div>
        <ul className="lista-alertas">
          {lista && !lista.length && <li className="vacio" style={{ display: 'block' }}>{filtro === 'activa' ? 'Sin alertas activas 🎉' : 'Sin alertas'}</li>}
          {lista?.map(a => (
            <li key={a.id} className={`${a.estado} ${a.tipo}`}>
              <span className="marca" />
              <div>
                <div className="msg">{a.mensaje}</div>
                <div className="meta">{TIPOS[a.tipo] || a.tipo} · desde {fFecha.format(a.inicio * 1000)}
                  {a.fin ? ` · hasta ${fFecha.format(a.fin * 1000)}` : ` · última ${fFecha.format(a.ultima * 1000)}`}
                  {a.conteo > 1 && ` · ${a.conteo} veces`}</div>
                {a.estado === 'activa' && a.tipo !== 'comando' && <button className="btn" onClick={() => resolver(a.id)}>Marcar resuelta</button>}
              </div>
              <span className="est">{a.estado}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

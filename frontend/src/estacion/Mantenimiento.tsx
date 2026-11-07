import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Comando } from './tipos';
import { fFecha, fHora, fHoraS } from './formato';

const PASOS = ['pendiente', 'entregado_receptora', 'enviado_emisora', 'activo', 'completado'];
const TERMINALES = ['completado', 'expirado', 'fallido', 'cancelado'];

function Modal({ titulo, texto, alResponder }: { titulo: string; texto: string; alResponder: (si: boolean) => void }) {
  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="vidrio modal-caja">
        <h3>{titulo}</h3><p>{texto}</p>
        <div className="acciones">
          <button className="btn" onClick={() => alResponder(false)}>Cancelar</button>
          <button className="btn primario" onClick={() => alResponder(true)}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}

/** Sección "Mantenimiento de la emisora": comando remoto de modo programación (OTA). Polling cada 10 s. */
export default function Mantenimiento() {
  const [lista, setLista] = useState<Comando[]>([]);
  const [dur, setDur] = useState(15);
  const [modal, setModal] = useState<null | { titulo: string; texto: string; accion: () => Promise<unknown> }>(null);
  const cargar = useCallback(() => api.comandos().then(d => setLista(d.comandos)).catch(() => {}), []);
  useEffect(() => { cargar(); const id = setInterval(cargar, 10000); return () => clearInterval(id); }, [cargar]);
  const c = lista[0];
  const enCurso = !!c && !TERMINALES.includes(c.estado);
  const idx = c ? PASOS.indexOf(c.estado) : -1;
  const responder = async (si: boolean) => {
    const m = modal; setModal(null);
    if (si && m) { try { await m.accion(); } catch (e) { alert((e as Error).message); } cargar(); }
  };
  return (
    <div className="vidrio bloque" id="mant">
      <h2>Mantenimiento de la emisora</h2>
      <p className="tenue">Activa el <b>modo programación</b> (OTA por WiFi) en la emisora de campo. La orden viaja: servidor → receptora (en su próxima subida) → emisora por LoRa.</p>
      <div className="fila-ctl">
        <label className="inline">Duración
          <select value={dur} onChange={e => setDur(+e.target.value)}>
            {[5, 10, 15, 20, 30].map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <button className="btn primario" type="button" disabled={enCurso} onClick={() => setModal({
          titulo: 'Activar modo programación',
          texto: `La emisora abrirá su red WiFi "EstacionPimiento-OTA" durante ${dur} min y dejará de medir mientras tanto. ¿Continuar?`,
          accion: () => api.crearComando(dur),
        })}>Activar modo programación</button>
      </div>
      {c && (
        <div className={'ota-estado' + (c.estado === 'activo' ? ' activo' : '') + (['expirado', 'fallido', 'cancelado'].includes(c.estado) ? ' malo' : '')}>
          <div>Comando #{c.id} · {c.parametros.duracion_min} min · <span className="st">{c.estado_texto}</span></div>
          <div className="pasos">{PASOS.map((p, i) => <i key={p} className={idx >= i ? 'on' : ''} title={p} />)}</div>
          <div className="chico tenue">
            Creado {fFecha.format(c.creado * 1000)} por {c.usuario || '?'} · actualizado {fHoraS.format(c.actualizado * 1000)}
            {c.detalle && ` · ${c.detalle}`}{c.expira && enCurso && ` · expira ${fHora.format(c.expira * 1000)} si no se activa`}
          </div>
          {['pendiente', 'entregado_receptora'].includes(c.estado) && (
            <button className="btn peligro" type="button" onClick={() => setModal({
              titulo: 'Cancelar comando', texto: `¿Cancelar el comando #${c.id}?`, accion: () => api.cancelarComando(c.id),
            })}>Cancelar</button>
          )}
        </div>
      )}
      <ol className="instr">
        <li>Espera a que el estado diga <b>ACTIVO</b>.</li>
        <li>Con la PC conéctate a la red WiFi de la emisora <b>EstacionPimiento-OTA</b> (la clave la define el firmware).</li>
        <li>En Arduino IDE: <i>Herramientas → Puerto</i> → puerto de red <b>emisora-pimiento</b> y sube el sketch.</li>
        <li>Al terminar la ventana, la emisora vuelve a su ciclo normal.</li>
      </ol>
      <div className="chico tenue">
        {lista.slice(1, 6).map(x => <div key={x.id}>#{x.id} {fFecha.format(x.creado * 1000)} · {x.parametros.duracion_min} min · {x.estado}</div>)}
      </div>
      {modal && <Modal titulo={modal.titulo} texto={modal.texto} alResponder={responder} />}
    </div>
  );
}

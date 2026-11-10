import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { CanalLora, EstadoEnlace, FilaEnlace } from './tipos';

const TERMINALES = ['completado', 'expirado', 'fallido', 'cancelado'];
const APTA: Record<string, string> = {
  apta: 'apta', perdida_alta: 'mucha pérdida', poco_margen: 'poco margen', sin_enlace: 'sin enlace', no_probada: 'no probada',
};

function versionAnterior(fw: string | null): boolean {
  if (!fw) return false;
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(fw);
  if (!m) return false;
  const v = [+m[1], +m[2], +m[3]];
  const min = [4, 5, 3];
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] < min[i];
  return false;
}

function num(v: number | null | undefined, d = 1) {
  return v == null ? '—' : Number(v).toFixed(d);
}

/** Configuración → prueba de canales LoRa. Solo administrador. */
export default function PruebaEnlace() {
  const [est, setEst] = useState<EstadoEnlace | null>(null);
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState<null | { titulo: string; texto: string; accion: 'usar' | 'fabrica'; n: number }>(null);
  const cargar = useCallback(() => api.enlace().then(setEst).catch(e => setMsg('✖ ' + (e as Error).message)), []);
  useEffect(() => { cargar(); const id = setInterval(cargar, 5000); return () => clearInterval(id); }, [cargar]);

  const prueba = est?.prueba_enlace ?? null;
  const canal = est?.canal_lora ?? null;
  const abierto = est?.comandos.find(c => !TERMINALES.includes(c.estado));
  const enCurso = prueba?.estado === 'en_curso' || (abierto?.parametros.accion === 'prueba' && abierto.estado === 'activo');
  const esperando = !enCurso && (prueba?.estado === 'esperando_ack' || (!!abierto && ['pendiente', 'entregado_receptora', 'enviado_emisora'].includes(abierto.estado)));
  const fallo = abierto?.estado === 'fallido' || (prueba?.estado === 'terminada' && !!prueba.fin && !['completa', 'cancelada', 'en_curso', ''].includes(prueba.fin));
  const terminado = prueba?.estado === 'terminada' && (prueba.fin === 'completa' || prueba.fin === 'cancelada' || !prueba.fin);
  const k = prueba?.combinacion ?? 0;
  const total = prueba?.total || 10;

  const ordenar = async (accion: 'prueba' | 'usar' | 'fabrica' | 'cancelar', n = 0) => {
    setOcupado(true); setMsg(''); setConfirmar(null);
    try {
      await api.ordenEnlace(accion, n);
      setMsg(accion === 'cancelar' ? '✔ Cancelación enviada.' : '✔ Orden enviada. La receptora la toma en su próximo latido.');
      cargar();
    } catch (e) { setMsg('✖ ' + (e as Error).message); }
    setOcupado(false);
  };
  const cancelar = async () => {
    if (abierto && ['pendiente', 'entregado_receptora'].includes(abierto.estado) && abierto.parametros.accion !== 'cancelar') {
      setOcupado(true);
      try { await api.cancelarComando(abierto.id); setMsg('✔ Cancelado antes de que la receptora lo ejecutara.'); cargar(); }
      catch (e) { setMsg('✖ ' + (e as Error).message); }
      setOcupado(false);
      return;
    }
    await ordenar('cancelar', 0);
  };

  return (
    <div className="vidrio bloque" id="prueba-enlace">
      <h2>Prueba de canales LoRa</h2>
      <p className="tenue">Prueba 10 combinaciones (cerca de un minuto y medio) y puede cambiar el canal de las dos placas. Pida confirmación: los datos se pausan durante la prueba.</p>
      <CanalActivo canal={canal} />
      {versionAnterior(est?.firmware ?? null) && <p className="aviso">Requiere receptora 4.5.3. El firmware informado es {est?.firmware}.</p>}
      {est && !est.token_configurado && <p className="aviso">El servidor no tiene ESTACION_INGEST_TOKEN: no se puede firmar la orden.</p>}
      <EstadoPrueba enCurso={!!enCurso} esperando={!!esperando} terminado={!!terminado && !enCurso && !esperando} fallo={!!fallo && !enCurso}
        k={k} total={total} detalle={abierto?.detalle || prueba?.fin_texto || ''} />
      {(enCurso || esperando) && <button className="btn peligro" type="button" disabled={ocupado} onClick={cancelar}>Cancelar</button>}
      <div className="acciones">
        <button className="btn primario" type="button" id="btn-probar-canales" disabled={ocupado || enCurso || esperando || !est?.token_configurado} onClick={() => ordenar('prueba', 0)}>Probar canales</button>
        <button className="btn" type="button" disabled={ocupado || enCurso} onClick={() => setConfirmar({
          titulo: 'Volver a canal de fábrica', texto: 'Las dos placas vuelven a 910.7 MHz SF7 BW125. Si la emisora no contesta, la receptora vuelve sola.', accion: 'fabrica', n: 0,
        })}>Volver a canal de fábrica</button>
        <span className="tenue">{msg}</span>
      </div>
      {prueba && prueba.tabla.length > 0 && <Tabla filas={prueba.tabla} recomendada={prueba.recomendada ?? null}
        alternativa={prueba.alternativa_poco_margen ?? null} ocupado={ocupado || !!enCurso}
        usar={n => setConfirmar({ titulo: `Usar canal ${n}`, texto: `Las dos placas pasarán al canal ${n} solo después del ACK de la emisora. Si no llegan datos, vuelven solas.`, accion: 'usar', n })} />}
      {prueba?.recomendada == null && prueba?.alternativa_poco_margen != null && (
        <p className="chico tenue">Ninguna cumple margen y pérdida. La más rápida con poca pérdida es la {prueba.alternativa_poco_margen}, con poco margen.</p>
      )}
      {confirmar && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="vidrio modal-caja">
            <h3>{confirmar.titulo}</h3>
            <p>{confirmar.texto}</p>
            <div className="acciones">
              <button className="btn" type="button" onClick={() => setConfirmar(null)}>Cancelar</button>
              <button className="btn primario" type="button" onClick={() => ordenar(confirmar.accion, confirmar.n)}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CanalActivo({ canal }: { canal: CanalLora | null }) {
  if (!canal) return <p className="tenue">La receptora aún no informa el canal LoRa (hace falta firmware 4.5.3).</p>;
  return (
    <div className="wifi-actual">
      Canal activo: <b>{canal.fabrica ? 'fábrica' : canal.activo}</b> · {canal.mhz} MHz SF{canal.sf} BW{canal.bw_khz}
      {canal.confirmado ? '' : ' · sin confirmar'}
      {canal.fallback && (
        <p className="aviso-fallback">Volvió del canal {canal.fallback.desde} al {canal.fallback.hacia}
          {' '}({canal.fallback.motivo === 'sin_paquetes_fabrica' ? 'se perdió el enlace' : 'el canal nuevo no se confirmó'}, hace {canal.fallback.hace_s} s).</p>
      )}
    </div>
  );
}

function EstadoPrueba({ enCurso, esperando, terminado, fallo, k, total, detalle }: {
  enCurso: boolean; esperando: boolean; terminado: boolean; fallo: boolean; k: number; total: number; detalle: string;
}) {
  const texto = enCurso ? 'En curso' : esperando ? 'Esperando que la receptora tome el comando' : fallo ? 'Falló o regresó al canal seguro' : terminado ? 'Terminado' : '';
  if (!texto) return null;
  return (
    <div className={'ota-estado' + (enCurso ? ' activo' : '') + (fallo ? ' malo' : '')}>
      <div><span className="st">{texto}</span>{detalle ? ` · ${detalle}` : ''}</div>
      {enCurso && (
        <>
          <div className="barra-prueba" aria-label={`Combinación ${k} de ${total}`}><i style={{ width: `${Math.min(100, 100 * k / total)}%` }} /></div>
          <div className="chico">Combinación {k} de {total}</div>
        </>
      )}
    </div>
  );
}

function Tabla({ filas, recomendada, alternativa, ocupado, usar }: {
  filas: FilaEnlace[]; recomendada: number | null; alternativa: number | null; ocupado: boolean;
  usar: (n: number) => void;
}) {
  return (
    <div className="tabla-enlace">
      <table>
        <thead>
          <tr>
            <th>n</th><th>MHz</th><th>SF</th><th>BW</th><th>recibidos</th><th>pérdida</th><th>RSSI</th><th>SNR</th><th>margen</th><th>aire</th><th></th>
          </tr>
        </thead>
        <tbody>
          {filas.map(f => (
            <tr key={f.n} className={f.n === recomendada ? 'recomendada' : f.n === alternativa ? 'alternativa' : ''}>
              <td>{f.n}{f.n === recomendada ? ' ★' : ''}</td>
              <td>{f.mhz}</td>
              <td>{f.sf}</td>
              <td>{f.bw_khz}</td>
              <td>{f.recibidos ?? '—'}/{f.enviados ?? '—'}</td>
              <td>{f.perdida_pct == null ? '—' : `${f.perdida_pct}%`}</td>
              <td>{num(f.rssi_prom, 0)}</td>
              <td>{num(f.snr_prom, 1)}</td>
              <td>{num(f.margen_snr_db, 1)}</td>
              <td>{f.toa_ms == null ? '—' : `${f.toa_ms} ms`}</td>
              <td>{f.probada === false ? 'no probada' : (APTA[f.apta || ''] || f.apta)}
                {f.probada !== false && <button className="btn mini" type="button" disabled={ocupado} onClick={() => usar(f.n)}>Usar este canal</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

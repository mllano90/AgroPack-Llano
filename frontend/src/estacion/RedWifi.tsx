import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import type { Comando, EstadoWifi } from './tipos';
import { fFecha, fHoraS } from './formato';

const PASOS = ['pendiente', 'entregado_receptora', 'activo', 'completado'];
const NOMBRE_PASO: Record<string, string> = { pendiente: 'En cola', entregado_receptora: 'Recibido', activo: 'Probando', completado: 'Aplicado' };
const TERMINALES = ['completado', 'expirado', 'fallido', 'cancelado'];
const FUENTE: Record<string, string> = { nvs: 'guardada en la receptora', fabrica: 'de fábrica (firmware)', prueba: 'en prueba' };

/** Valida en el navegador lo mismo que el servidor (estacion/wifi_cmd.py). null = ok. */
export function errorWifi(ssid: string, clave: string, url: string, abierta: boolean, conservar: boolean): string | null {
  const s = ssid.trim();
  if (!s) return 'Escribe el nombre de la red (SSID)';
  if (new TextEncoder().encode(s).length > 32) return 'El SSID no puede pasar de 32 bytes';
  if (clave) {
    if (!/^[\x20-\x7e]*$/.test(clave)) return 'La contraseña solo admite caracteres ASCII imprimibles';
    if (clave.length === 64 ? !/^[0-9a-fA-F]{64}$/.test(clave) : clave.length < 8 || clave.length > 63)
      return 'La contraseña WPA2 debe tener de 8 a 63 caracteres';
  } else if (!abierta && !conservar) return 'Escribe la contraseña de la red nueva (o marca "Red abierta")';
  const u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\/[^\s"\\]{1,112}$/.test(u)) return 'La URL debe empezar con http:// o https:// (sin espacios)';
  return null;
}

/** Configuración → "Red WiFi de la receptora" (plan A). La contraseña guardada nunca se muestra: solo "configurada"/"vacía". */
export default function RedWifi() {
  const [est, setEst] = useState<EstadoWifi | null>(null);
  const [ssid, setSsid] = useState(''), [clave, setClave] = useState(''), [url, setUrl] = useState('');
  const [abierta, setAbierta] = useState(false), [ver, setVer] = useState(false);
  const [msg, setMsg] = useState(''), [enviando, setEnviando] = useState(false), [confirmar, setConfirmar] = useState(false);
  const cargar = useCallback(() => api.wifi().then(e => {
    setEst(e); setSsid(s => s || e.receptora?.ssid || '');
  }).catch(err => setMsg('✖ ' + (err as Error).message)), []);
  useEffect(() => { cargar(); const id = setInterval(cargar, 8000); return () => clearInterval(id); }, [cargar]);

  const actual = est?.receptora?.ssid ?? null;
  const mismaRed = !!actual && ssid.trim() === actual;
  const conservar = !clave && !abierta && mismaRed;
  const error = errorWifi(ssid, clave, url, abierta, conservar);
  const c: Comando | undefined = est?.comandos[0];
  const enCurso = !!c && !TERMINALES.includes(c.estado);
  const idx = c ? PASOS.indexOf(c.estado) : -1;

  const pedir = (e: FormEvent) => { e.preventDefault(); if (error) { setMsg('✖ ' + error); return; } setMsg(''); setConfirmar(true); };
  const aplicar = async () => {
    setConfirmar(false); setEnviando(true);
    try {
      await api.aplicarWifi({ ssid: ssid.trim(), clave: abierta ? '' : clave, url: url.trim(), red_abierta: abierta, conservar_clave: conservar });
      setClave(''); setVer(false); setMsg('✔ Enviado: la receptora lo recibe en su próximo latido (≤ 1 min).');
      cargar();
    } catch (err) { setMsg('✖ ' + (err as Error).message); }
    setEnviando(false);
  };
  const cancelar = async () => { if (c) { try { await api.cancelarComando(c.id); } catch (err) { setMsg('✖ ' + (err as Error).message); } cargar(); } };

  return (
    <div className="vidrio bloque" id="red-wifi">
      <h2>Red WiFi de la receptora</h2>
      <p className="tenue">Cambia la red a la que se conecta la Heltec receptora (Nodo Cultivo). Se aplica a distancia: la receptora la
        prueba 15 s y, si no conecta, <b>vuelve sola a la red anterior</b> y aquí verás el error.</p>
      <div className="wifi-actual">
        {est?.receptora ? <>
          Red actual: <b>{est.receptora.ssid || '—'}</b> · contraseña: <b>{est.receptora.clave}</b>
          {est.receptora.fuente && <> · {FUENTE[est.receptora.fuente] ?? est.receptora.fuente}</>}
          <span className="chico tenue"> · informado {fFecha.format(est.receptora.ts * 1000)}{est.receptora.firmware && ` · ${est.receptora.firmware}`}</span>
        </> : <span className="tenue">La receptora aún no informa su red (necesita firmware receptora-4.4.0 o posterior).</span>}
      </div>
      {est && !est.token_configurado && <p className="aviso">El servidor no tiene ESTACION_INGEST_TOKEN: no se puede cifrar la contraseña.</p>}
      <form onSubmit={pedir} autoComplete="off">
        <label>Nombre de la red (SSID)<input maxLength={32} required value={ssid} onChange={e => setSsid(e.target.value)} autoComplete="off" spellCheck={false} /></label>
        <label>Contraseña
          <span className="con-boton">
            <input type={ver ? 'text' : 'password'} maxLength={64} value={clave} disabled={abierta} autoComplete="new-password"
              placeholder={mismaRed && est?.receptora?.clave === 'configurada' ? '•••••••• configurada — vacío = conservar' : 'Contraseña de la red nueva'}
              onChange={e => setClave(e.target.value)} />
            <button type="button" className="btn mini" onClick={() => setVer(!ver)} disabled={abierta}>{ver ? 'Ocultar' : 'Ver'}</button>
          </span>
        </label>
        <label className="check"><input type="checkbox" checked={abierta} onChange={e => setAbierta(e.target.checked)} /> Red abierta (sin contraseña)</label>
        <label>URL del servidor <small className="tenue">(opcional; vacío = no cambiar)</small>
          <input type="url" maxLength={120} placeholder="https://… o http://192.168.1.50:8000" value={url} onChange={e => setUrl(e.target.value)} spellCheck={false} /></label>
        {conservar && <p className="chico tenue">Se conservará la contraseña que ya tiene guardada la receptora para «{actual}».</p>}
        <div className="acciones">
          <button className="btn primario" type="submit" disabled={enviando || enCurso || !!error || (est != null && !est.token_configurado)}>Aplicar</button>
          <span className="tenue">{msg || (error && ssid ? error : '')}</span>
        </div>
      </form>
      {c && (
        <div className={'ota-estado' + (c.estado === 'activo' ? ' activo' : '') + (['expirado', 'fallido', 'cancelado'].includes(c.estado) ? ' malo' : '')}>
          <div>Cambio #{c.id} → «{c.parametros.ssid}»{c.parametros.url && <> · servidor {c.parametros.url}</>} · <span className="st">{c.estado_texto}</span></div>
          <div className="pasos">{PASOS.map((p, i) => <i key={p} className={idx >= i ? 'on' : ''} title={NOMBRE_PASO[p]} />)}</div>
          <div className="chico tenue">
            Pedido {fFecha.format(c.creado * 1000)} por {c.usuario || '?'} · actualizado {fHoraS.format(c.actualizado * 1000)}{c.detalle && ` · ${c.detalle}`}
          </div>
          {['pendiente', 'entregado_receptora'].includes(c.estado) && <button className="btn peligro" type="button" onClick={cancelar}>Cancelar</button>}
        </div>
      )}
      <details className="chico tenue wifi-ayuda">
        <summary>Seguridad y otras formas de cambiar la red</summary>
        <ul>
          <li>La contraseña viaja <b>cifrada</b> con el token de la estación y se <b>borra del servidor</b> en cuanto la receptora la recibe; nunca se vuelve a mostrar.</li>
          <li><b>Plan B (Bluetooth):</b> mantén el botón <b>PRG 3 s</b> en la receptora. La pantalla muestra <i>BLE listo · PIN ######</i>; con nRF Connect conéctate a <b>EM-SIF-RX</b> y escribe SSID, contraseña y «Aplicar».</li>
          <li><b>Plan C:</b> sin red utilizable (o PRG 10 s) la receptora abre la red <b>EM-SIF-Setup</b> (clave en la pantalla) con una página en 192.168.4.1.</li>
        </ul>
      </details>
      {confirmar && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="vidrio modal-caja">
            <h3>Cambiar la red WiFi</h3>
            <p>La receptora se cambiará a «{ssid.trim()}»{url.trim() && ` y al servidor ${url.trim()}`}. Si no conecta en 15 s, vuelve a la red actual. ¿Continuar?</p>
            <div className="acciones"><button className="btn" onClick={() => setConfirmar(false)}>Cancelar</button>
              <button className="btn primario" onClick={aplicar}>Aplicar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

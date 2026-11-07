import { useEffect, useState } from 'react';

interface EvInstalar extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function enPantallaInicio() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function esIOS() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Instalar en Android solo si el navegador ofrece beforeinstallprompt.
 *  En iOS no hay prompt: se explican los pasos de Safari, sin prometer uno. */
export default function Instalar() {
  const [ev, setEv] = useState<EvInstalar | null>(null);
  const [ios, setIos] = useState(false);
  const [ayuda, setAyuda] = useState(false);
  const [aviso, setAviso] = useState('');
  const [ya, setYa] = useState(false);

  useEffect(() => {
    if (enPantallaInicio()) { setYa(true); return; }
    setIos(esIOS());
    const on = (e: Event) => {
      e.preventDefault();
      if (typeof (e as EvInstalar).prompt === 'function') setEv(e as EvInstalar);
    };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);

  if (ya) return null;

  const instalar = async () => {
    if (!ev) return;
    const pendiente = ev;
    setEv(null);
    await pendiente.prompt();
    const r = await pendiente.userChoice;
    setAviso(r.outcome === 'accepted' ? 'Lista en el inicio. Ábrela desde el icono EM SIF.' : '');
  };

  return (
    <>
      {ev && <button type="button" className="btn instalar-btn" id="instalar-android" onClick={instalar}>Instalar</button>}
      {!ev && ios && <button type="button" className="btn instalar-btn" id="instalar-ios" onClick={() => setAyuda(true)}>Al inicio</button>}
      {aviso && <span className="tenue chico" role="status">{aviso}</span>}
      {ayuda && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="instalar-titulo">
          <div className="vidrio modal-caja">
            <h3 id="instalar-titulo">Agregar EM SIF al inicio</h3>
            <p className="instalar-ayuda">Safari no muestra un aviso automático. En el botón <b>Compartir</b> elige <b>Agregar a inicio</b>. El icono abre solo la estación, en <b>/estacion/</b>.</p>
            <div className="acciones"><button type="button" className="btn primario" onClick={() => setAyuda(false)}>Entendido</button></div>
          </div>
        </div>
      )}
    </>
  );
}

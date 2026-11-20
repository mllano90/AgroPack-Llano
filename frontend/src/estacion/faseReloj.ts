import { useEffect, useState } from 'react';
import { esFase, faseEn, type FaseId } from './faseDelDia';

const CLAVE = 'estacion_fase_preview';
const EVENTO = 'estacion-fase';

/** `?fase=amanecer` gana. Si no, la vista previa de Configuración (esta sesión). */
export function faseForzada(): FaseId | null {
  try {
    const q = new URLSearchParams(location.search).get('fase');
    if (esFase(q)) return q;
  } catch { /* sin location */ }
  try {
    const s = sessionStorage.getItem(CLAVE);
    if (esFase(s)) return s;
  } catch { /* navegador privado */ }
  return null;
}

export function fijarFasePreview(id: FaseId | '') {
  try {
    if (id) sessionStorage.setItem(CLAVE, id);
    else sessionStorage.removeItem(CLAVE);
  } catch { /* navegador privado */ }
  window.dispatchEvent(new Event(EVENTO));
}

export function fasePreviewGuardada(): FaseId | '' {
  try {
    const s = sessionStorage.getItem(CLAVE);
    return esFase(s) ? s : '';
  } catch { return ''; }
}

function leer(): FaseId {
  return faseForzada() ?? faseEn(new Date());
}

/** Una fase para toda la escena. Se relee cada minuto, al volver a la pestaña y al enfocar. */
export function useFase(): FaseId {
  const [fase, setFase] = useState(leer);
  useEffect(() => {
    const tick = () => setFase(leer());
    const id = window.setInterval(tick, 60_000);
    const vis = () => { if (document.visibilityState === 'visible') tick(); };
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener(EVENTO, tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener(EVENTO, tick);
    };
  }, []);
  return fase;
}

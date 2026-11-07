/** Registra la PWA solo dentro de /estacion/. No toca el <head> de AgroPack al salir. */

const VISTA_BASE = 'width=device-width, initial-scale=1.0';
const MANIFEST = '/estacion/manifest.webmanifest';
const APPLE = '/estacion/icons/apple-touch-icon.png';

function meta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  const creado = !el;
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  const previo = el.content;
  el.content = content;
  return () => {
    if (!el) return;
    if (creado) el.remove();
    else el.content = previo;
  };
}

function link(rel: string, href: string, extra?: Record<string, string>) {
  const el = document.createElement('link');
  el.rel = rel;
  el.href = href;
  if (extra) Object.entries(extra).forEach(([k, v]) => el.setAttribute(k, v));
  document.head.appendChild(el);
  return () => el.remove();
}

/** El #root de AgroPack mide 1126 px. La estación lo ensancha solo mientras está montada. */
export function ensancharLienzo(): () => void {
  const root = document.getElementById('root');
  const body = document.body;
  const previo = root ? { width: root.style.width, maxWidth: root.style.maxWidth, borderInline: root.style.borderInline, textAlign: root.style.textAlign, background: root.style.background } : null;
  const fondo = body.style.background;
  if (root) {
    root.style.width = '100%';
    root.style.maxWidth = 'none';
    root.style.borderInline = '0';
    root.style.textAlign = 'left';
    root.style.background = '#06140c';
  }
  body.style.background = '#06140c';
  return () => {
    if (root && previo) {
      root.style.width = previo.width;
      root.style.maxWidth = previo.maxWidth;
      root.style.borderInline = previo.borderInline;
      root.style.textAlign = previo.textAlign;
      root.style.background = previo.background;
    }
    body.style.background = fondo;
  };
}

/** Enlaza manifest, icono de iOS y viewport-fit. Devuelve la limpieza. */
export function montarMetaPWA(): () => void {
  const limpiar = [
    meta('viewport', `${VISTA_BASE}, viewport-fit=cover`),
    meta('theme-color', '#0b1f14'),
    meta('apple-mobile-web-app-capable', 'yes'),
    meta('mobile-web-app-capable', 'yes'),
    meta('apple-mobile-web-app-title', 'EM SIF'),
    meta('apple-mobile-web-app-status-bar-style', 'black-translucent'),
    link('manifest', MANIFEST),
    link('apple-touch-icon', APPLE),
  ];
  return () => limpiar.forEach(f => f());
}

/** Registra solo /estacion/sw.js con scope /estacion/. No enumera ni toca otros workers. */
export function registrarWorkerEstacion() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext || import.meta.env.DEV) return;
  if (!location.pathname.startsWith('/estacion')) return;
  navigator.serviceWorker.register('/estacion/sw.js', { scope: '/estacion/' }).catch(() => {
    /* Sin HTTPS o sin archivo: la estación sigue en el navegador. */
  });
}

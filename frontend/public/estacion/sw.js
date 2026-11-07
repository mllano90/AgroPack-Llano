/* EM SIF — service worker del módulo estación.
 * El script vive en /estacion/sw.js, así el navegador limita el scope a /estacion/.
 * No se declara ninguna cabecera que amplíe ese scope hacia la raíz.
 * No controla AgroPack: una página fuera de /estacion/ no queda bajo este worker.
 * No cachea /api/ ni nada con Authorization: sin red, la estación muestra su aviso
 * de conexión y no reutiliza lecturas, tokens ni comandos viejos.
 */
const VERSION = 'emsif-shell-v2';
const SCOPE = '/estacion/';
const ICONOS = [
  '/estacion/manifest.webmanifest',
  '/estacion/icons/icon-192.png',
  '/estacion/icons/icon-512.png',
  '/estacion/icons/icon-maskable-192.png',
  '/estacion/icons/icon-maskable-512.png',
  '/estacion/icons/apple-touch-icon.png',
  '/estacion/icons/favicon-32.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.all(ICONOS.map(u => c.add(u).catch(() => undefined))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('emsif-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function esHtml(res) {
  return (res.headers.get('content-type') || '').toLowerCase().includes('text/html');
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/api') return;
  if (req.headers.get('authorization')) return;

  if (req.mode === 'navigate') {
    if (!url.pathname.startsWith(SCOPE)) return;
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok && esHtml(res)) {
          const copia = res.clone();
          const cache = await caches.open(VERSION);
          await cache.put(SCOPE + 'index-shell', copia);
        }
        return res;
      } catch {
        const guardado = await caches.match(SCOPE + 'index-shell');
        if (guardado) return guardado;
        return new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  const hashed = url.pathname.startsWith('/assets/');
  const propio = url.pathname.startsWith('/estacion/icons/') || url.pathname === '/estacion/manifest.webmanifest';
  if (!hashed && !propio) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (hashed) {
      const hit = await cache.match(req);
      if (hit && !esHtml(hit)) return hit;
    }
    const res = await fetch(req);
    if (res.ok && res.type === 'basic' && !esHtml(res)) await cache.put(req, res.clone());
    return res;
  })());
});

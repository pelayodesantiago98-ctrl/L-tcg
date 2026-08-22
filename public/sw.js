/*
 * Service worker.
 *
 * Dos cachés con reglas distintas a propósito:
 *
 *   - El armazón (HTML, CSS, JS) va con "red primero": si hay conexión se
 *     coge lo último, y si no, lo guardado. Así una versión nueva llega sin
 *     que nadie tenga que borrar nada, que es el problema clásico de las PWA.
 *   - Las imágenes de carta van con "caché primero" y no caducan: el
 *     identificador de una carta no se reutiliza, la imagen nunca cambia, y
 *     además cada una que no esté guardada le cuesta al servidor una petición
 *     de su cuota diaria. Guardarlas bien es lo que hace que el álbum se
 *     pueda hojear sin gastar nada.
 *
 * Las respuestas de /api que no son imágenes no se cachean nunca: son datos
 * del usuario y verlos viejos confunde más que ayuda.
 */
const VERSION = 'v2';
const ARMAZON = `ltcg-armazon-${VERSION}`;
const IMAGENES = 'ltcg-imagenes';

const BASICOS = ['/', '/css/estilo.css', '/css/mejoras.css', '/js/app.js', '/js/mejoras.js', '/manifest.webmanifest'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(ARMAZON).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres
      .filter((n) => n.startsWith('ltcg-armazon-') && n !== ARMAZON)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Imágenes de carta: caché primero, para siempre.
  if (url.pathname.startsWith('/api/imagen/')) {
    ev.respondWith((async () => {
      const cache = await caches.open(IMAGENES);
      const guardada = await cache.match(req);
      if (guardada) return guardada;
      try {
        const res = await fetch(req);
        // Un 429 significa "hoy no queda cuota", no "esta carta no tiene
        // imagen": guardarlo dejaría el hueco vacío para siempre.
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  // El resto de la API nunca se cachea.
  if (url.pathname.startsWith('/api/')) return;

  // Armazón: red primero con vuelta a la caché.
  ev.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(ARMAZON)).put(req, res.clone());
      return res;
    } catch {
      const cache = await caches.open(ARMAZON);
      return (await cache.match(req)) || (await cache.match('/')) ||
        new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});

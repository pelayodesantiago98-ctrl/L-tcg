/*
 * Service worker.
 *
 * Dos cachés con reglas distintas a propósito:
 *
 *   - El armazón (HTML, CSS, JS) va con "red primero": si hay conexión se
 *     coge lo último, y si no, lo guardado. Así una versión nueva llega sin
 *     que nadie tenga que borrar nada, que es el problema clásico de las PWA.
 *   - Las imágenes de carta van con "caché primero + revalidar en segundo
 *     plano" (stale-while-revalidate): el id no se reutiliza, pero el
 *     contenido SÍ puede mejorar bajo el mismo id (ver lib/mejora-imagenes.js
 *     y lib/mejora-imagenes-ptcgio.js, que sustituyen el fichero en el
 *     servidor cuando encuentran una versión más grande). Con "para siempre"
 *     a secas esa mejora no se veía jamás aunque el servidor ya tuviera el
 *     fichero bueno: el navegador no volvía a preguntar. Así se sigue
 *     hojeando el álbum al instante desde la caché, y de paso se refresca
 *     sin que nadie tenga que borrar nada; el servidor ya pone Cache-Control
 *     de una hora con ETag, así que la petición de fondo normalmente es
 *     barata (304) salvo cuando de verdad hay fichero nuevo que traer.
 *
 * Las respuestas de /api que no son imágenes no se cachean nunca: son datos
 * del usuario y verlos viejos confunde más que ayuda.
 */
const VERSION = 'v3';
const ARMAZON = `ltcg-armazon-${VERSION}`;
const IMAGENES = `ltcg-imagenes-${VERSION}`;

const BASICOS = ['/', '/css/estilo.css', '/css/mejoras.css', '/js/app.js', '/js/mejoras.js', '/manifest.webmanifest'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(ARMAZON).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres
      .filter((n) => (n.startsWith('ltcg-armazon-') || n.startsWith('ltcg-imagenes')) && n !== ARMAZON && n !== IMAGENES)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Imágenes de carta: caché primero, con revalidación en segundo plano.
  if (url.pathname.startsWith('/api/imagen/')) {
    ev.respondWith((async () => {
      const cache = await caches.open(IMAGENES);
      const guardada = await cache.match(req);
      // Un 429 significa "hoy no queda cuota", no "esta carta no tiene
      // imagen": guardarlo dejaría el hueco vacío para siempre.
      const traerYGuardar = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);

      if (guardada) {
        ev.waitUntil(traerYGuardar);
        return guardada;
      }
      return (await traerYGuardar) || new Response('', { status: 504 });
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

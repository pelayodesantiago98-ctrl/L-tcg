'use strict';
/*
 * L-tcg — colección de cartas Pokémon con álbum visual.
 *
 * Node + Express, SQLite y JWT. El catálogo viene de la API de PokeWallet,
 * que va con cuota (100 peticiones/hora, 1.000/día), así que todo lo que
 * hable con ella es trabajo de fondo reanudable y nunca una espera dentro de
 * una petición del navegador. Ver lib/ingesta.js y lib/imagenes.js.
 */
const fs = require('fs');
const path = require('path');

// Carga del .env a mano: son cuatro líneas y evita una dependencia más. Se
// respeta lo que ya venga del entorno, que es lo que systemd puede inyectar.
for (const linea of (fs.existsSync(path.join(__dirname, '.env'))
  ? fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n') : [])) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const express = require('express');
const cookieParser = require('cookie-parser');
const { conSesion } = require('./lib/auth');
const ingesta = require('./lib/ingesta');
const imagenes = require('./lib/imagenes');

const app = express();
app.set('trust proxy', true);   // detrás de nginx y de Cloudflare
app.disable('x-powered-by');

const VERSION = (() => {
  try { return require('./package.json').version || '0.0.0'; } catch { return '0.0.0'; }
})();

app.use(cookieParser());
app.use(conSesion);

app.get('/api/version', (req, res) => res.json({ version: VERSION }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/collection'));
app.use('/api/binder', require('./routes/binder'));
app.use('/api/admin', require('./routes/admin'));

/* Los estáticos con caché corta y versión por fecha de fichero: así un cambio
   de CSS se ve sin tener que explicarle a nadie cómo se vacía la caché. */
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true, lastModified: true, maxAge: '1h',
  setHeaders: (res, ruta) => {
    if (/\.(png|jpg|svg|webmanifest|ico)$/.test(ruta)) res.setHeader('Cache-Control', 'public, max-age=604800');
    if (/sw\.js$/.test(ruta)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// Aplicación de una sola página: cualquier ruta que no sea API devuelve el
// index y el enrutado lo hace el navegador. Sin esto, recargar en /binder da
// un 404 y la PWA se rompe al abrirse desde el icono.
app.get(/^(?!\/api\/).*/, (req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
  const codigo = err.status || 500;
  if (codigo >= 500) console.error('[l-tcg]', err);
  res.status(codigo).json({ error: err.message || 'Error interno.' });
});

const PUERTO = parseInt(process.env.PORT, 10) || 3003;
app.listen(PUERTO, '127.0.0.1', () => {
  console.log(`[l-tcg] v${VERSION} escuchando en 127.0.0.1:${PUERTO}`);
  // Si el servicio se reinició en mitad de una bajada de cuatro horas, sigue
  // por donde iba en vez de quedarse callado.
  ingesta.reanudarSiHacia();
  imagenes.reanudarPrecarga();
});

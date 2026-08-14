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
const sso = require('/usr/local/lib/lepayimio/sso');
const temas = require('/usr/local/lib/lepayimio/tema');
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

/* El tema elegido, por usuario y en el servidor. Se indexa por el ID del SSO
   y no por el de la tabla de aquí: ese es el que no cambia nunca. */
const tema = temas.crear(
  path.join(__dirname, 'data', 'temas.json'),
  ['oscuro', 'crystal', 'dark-crystal'],
  'oscuro');

const quienTema = (req) => {
  const s = sso.sesion(req);
  return s ? s.id : '';
};

/* El cuerpo JSON se monta solo para esta ruta: aqui no hay express.json()
   global, cada router monta el suyo con el limite que le hace falta. */
app.use('/api/tema', express.json({ limit: '1kb' }));
tema.rutas(app, quienTema);

app.get('/api/version', (req, res) => res.json({ version: VERSION }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/collection'));
app.use('/api/binder', require('./routes/binder'));
app.use('/api/admin', require('./routes/admin'));

/* Los estáticos con caché corta y versión por fecha de fichero: así un cambio
   de CSS se ve sin tener que explicarle a nadie cómo se vacía la caché. */
app.use(express.static(path.join(__dirname, 'public'), {
  // Sin esto, express.static sirve public/index.html para "/" antes de que la
  // peticion llegue a la ruta de abajo, y el index saldria sin las versiones
  // de los estaticos y con la cabecera de cache equivocada.
  index: false,
  etag: true, lastModified: true, maxAge: '1h',
  setHeaders: (res, ruta) => {
    if (/\.(png|jpg|svg|webmanifest|ico)$/.test(ruta)) res.setHeader('Cache-Control', 'public, max-age=604800');
    if (/sw\.js$/.test(ruta)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

/*
 * El index se sirve con la fecha de cada estático metida en su URL.
 *
 * Los estáticos van con una hora de caché, y sin número de versión un cambio
 * de CSS tarda esa hora en verse: el navegador reutiliza el que ya tiene y
 * Cloudflare puede tener el suyo. Pasó justo eso al añadir el selector de
 * cartas: la regla nueva no llegaba y el diálogo salía sin estilos, con el
 * agravante de que parecía un fallo del código y no de la caché.
 *
 * Con ?v=<fecha del fichero> la URL cambia cuando cambia el contenido, así que
 * la caché sigue siendo de una hora pero deja de estorbar.
 */
const ESTATICOS_VERSIONADOS = ['/css/estilo.css', '/js/app.js'];
let indexCache = null;

function indexHtml() {
  const ruta = path.join(__dirname, 'public', 'index.html');

  /*
   * La firma incluye la fecha del index Y la de cada estatico. Al principio
   * solo miraba la del index, y entonces cambiar el CSS no refrescaba nada:
   * el HTML seguia saliendo de memoria con la version vieja, que es
   * exactamente el problema que esto venia a resolver.
   *
   * Son tres statSync por peticion del index. A 0,6 ms de respuesta eso no se
   * nota, y solo afecta al HTML, no a los estaticos ni a la API.
   */
  const versiones = {};
  for (const est of ESTATICOS_VERSIONADOS) {
    try { versiones[est] = Math.floor(fs.statSync(path.join(__dirname, 'public', est)).mtimeMs); }
    catch { versiones[est] = 0; }
  }
  const firma = [fs.statSync(ruta).mtimeMs, ...ESTATICOS_VERSIONADOS.map((e) => versiones[e])].join('|');
  if (indexCache && indexCache.firma === firma) return indexCache.html;

  let html = fs.readFileSync(ruta, 'utf8');
  for (const est of ESTATICOS_VERSIONADOS) {
    if (versiones[est]) html = html.split(est + '"').join(`${est}?v=${versiones[est]}"`);
  }
  indexCache = { firma, html };
  return html;
}

// Aplicación de una sola página: cualquier ruta que no sea API devuelve el
// index y el enrutado lo hace el navegador. Sin esto, recargar en /album da
// un 404 y la PWA se rompe al abrirse desde el icono.
app.get(/^(?!\/api\/).*/, (req, res, next) => {
  if (req.method !== 'GET') return next();

  /*
   * Lo que pide un fichero no es una ruta de la aplicacion.
   *
   * Antes esto devolvia el index con un 200 a cualquier cosa: /.env,
   * /package.json, /.git/config. No se filtraba nada -- lo que sale es el
   * index de siempre, esos ficheros ni se leen -- pero un escaneo automatico
   * lee "200" y da por hecho que estan ahi, y una auditoria pierde el tiempo
   * detras de una fuga que no existe. Pasa: en la revision del 5 de agosto
   * salieron los ocho como EXPUESTO hasta mirar el cuerpo de la respuesta.
   *
   * Los estaticos de verdad (css, js, iconos) los ha servido express.static
   * mas arriba, asi que si una peticion con pinta de fichero llega hasta aqui
   * es que no existe, y lo honrado es decirlo: cae en el 404 de abajo.
   */
  if (/^\/\./.test(req.path) ||
      /\.(env|json|js|mjs|md|ya?ml|lock|sh|bak|sql|db|sqlite3?|conf|ini|log|pem|key)$/i.test(req.path)) {
    return next();
  }
  // El index nunca se cachea: es quien lleva las versiones de lo demás.
  res.set('Cache-Control', 'no-cache');
  /* El tema se marca AQUÍ y no dentro de indexHtml(): esa función cachea su
     resultado, y meterlo dentro serviría a todo el mundo el tema del último
     que hubiera pasado por ahí. */
  res.type('html').send(tema.inyectar(indexHtml(), tema.de(quienTema(req))));
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
  imagenes.vigilar();
});

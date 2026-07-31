'use strict';
/*
 * Autenticación con JWT.
 *
 * El token viaja en una cookie httpOnly, no en localStorage: así el JavaScript
 * de la página no puede leerlo y un XSS no se lleva la sesión. Como la web y
 * la API están en el mismo origen no hace falta cabecera Authorization, pero
 * se acepta igualmente por si algún día hay una app con Capacitor, que no
 * comparte las cookies del navegador.
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const SECRETO = process.env.JWT_SECRET;
if (!SECRETO) {
  console.error('Falta JWT_SECRET en .env; sin él cualquiera podría firmar tokens.');
  process.exit(1);
}

const DURACION = '30d';
const COSTE_BCRYPT = 10;

const hashear = (clave) => bcrypt.hash(clave, COSTE_BCRYPT);
const comprobar = (clave, hash) => bcrypt.compare(clave, hash);

const firmar = (usuario) => jwt.sign(
  { sub: usuario.id, usuario: usuario.usuario, rol: usuario.rol },
  SECRETO, { expiresIn: DURACION });

const verificar = (token) => {
  try { return jwt.verify(token, SECRETO); } catch { return null; }
};

const OPCIONES_COOKIE = {
  httpOnly: true,
  sameSite: 'lax',
  secure: true,          // todo va por HTTPS detrás de Cloudflare
  maxAge: 30 * 24 * 3600 * 1000,
  path: '/',
};

/* Deja req.usuario si hay token válido, y sigue igualmente si no lo hay: las
   páginas públicas y las privadas usan el mismo camino y cada una decide. */
function conSesion(req, res, next) {
  const cabecera = req.get('authorization') || '';
  const token = (req.cookies && req.cookies.token) ||
    (cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null);
  const datos = token ? verificar(token) : null;
  req.usuario = datos ? { id: datos.sub, usuario: datos.usuario, rol: datos.rol } : null;
  next();
}

const exigeSesion = (req, res, next) => {
  if (!req.usuario) return res.status(401).json({ error: 'Hay que iniciar sesión.' });
  next();
};

const exigeAdmin = (req, res, next) => {
  if (!req.usuario) return res.status(401).json({ error: 'Hay que iniciar sesión.' });
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo para administradores.' });
  next();
};

module.exports = {
  hashear, comprobar, firmar, verificar,
  conSesion, exigeSesion, exigeAdmin, OPCIONES_COOKIE,
};

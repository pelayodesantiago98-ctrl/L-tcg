'use strict';
const express = require('express');
const User = require('../models/User');
const { firmar, exigeSesion, OPCIONES_COOKIE } = require('../lib/auth');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));

const CLAVE_REGISTRO = process.env.CLAVE_REGISTRO || '';

/* Registro. La clave de administrador no está en el código: si falta la
   variable de entorno el registro queda cerrado, que es el fallo seguro. El
   primer usuario que entra se queda de admin, porque si no no habría nadie
   que pudiera arrancar la bajada del catálogo. */
router.post('/registro', async (req, res, next) => {
  try {
    const { usuario, nombre, clave, clave2, claveRegistro } = req.body || {};
    if (!CLAVE_REGISTRO) return res.status(503).json({ error: 'El registro está cerrado.' });
    if (String(clave || '') !== String(clave2 || '')) {
      return res.status(400).json({ error: 'Las dos contraseñas no coinciden.' });
    }
    const primero = User.cuantos() === 0;
    if (!primero && String(claveRegistro || '') !== CLAVE_REGISTRO) {
      return res.status(403).json({ error: 'La contraseña de administrador no es correcta.' });
    }
    const u = await User.crear({ usuario, nombre, clave, rol: primero ? 'admin' : 'user' });
    User.anotarAcceso(u.id);
    res.cookie('token', firmar(u), OPCIONES_COOKIE);
    res.status(201).json({ usuario: User.publico(u), primero });
  } catch (e) { next(e); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { usuario, clave } = req.body || {};
    const u = await User.verificarClave(usuario, clave);
    if (!u) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    User.anotarAcceso(u.id);
    res.cookie('token', firmar(u), OPCIONES_COOKIE);
    res.json({ usuario: User.publico(u) });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token', { ...OPCIONES_COOKIE, maxAge: undefined });
  res.json({ ok: true });
});

// Quién soy. El front lo llama al arrancar para saber si pintar login o no.
router.get('/me', (req, res) => {
  if (!req.usuario) return res.json({ usuario: null, hayUsuarios: User.cuantos() > 0 });
  const u = User.porId(req.usuario.id);
  if (!u) return res.json({ usuario: null, hayUsuarios: User.cuantos() > 0 });
  res.json({ usuario: User.publico(u), hayUsuarios: true });
});

router.post('/clave', exigeSesion, async (req, res, next) => {
  try {
    const { actual, nueva, nueva2 } = req.body || {};
    const u = await User.verificarClave(req.usuario.usuario, actual);
    if (!u) return res.status(403).json({ error: 'La contraseña actual no es correcta.' });
    if (String(nueva || '') !== String(nueva2 || '')) {
      return res.status(400).json({ error: 'Las dos contraseñas nuevas no coinciden.' });
    }
    await User.cambiarClave(u.id, nueva);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/perfil', exigeSesion, (req, res, next) => {
  try {
    const nombre = String((req.body || {}).nombre || '').trim().slice(0, 120);
    require('../lib/db').db.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?')
      .run(nombre, req.usuario.id);
    res.json({ usuario: User.publico(User.porId(req.usuario.id)) });
  } catch (e) { next(e); }
});

module.exports = router;

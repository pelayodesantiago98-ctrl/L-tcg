'use strict';
/*
 * Lo que queda de las rutas de sesión.
 *
 * El registro, el login, el logout y el cambio de contraseña vivían aquí y ya
 * no existen: de eso se encarga lepayimio.es. Se responde 410 en lugar de 404
 * para dejar claro que la ruta existió y se ha retirado, no que esté mal
 * escrita, y se dice dónde está ahora.
 */
const express = require('express');
const { exigeSesion } = require('../lib/auth');
const { db } = require('../lib/db');

const router = express.Router();

const PORTAL = 'https://lepayimio.es/login';
const mudado = (req, res) => res.status(410).json({
  error: 'La sesión se gestiona en lepayimio.es',
  login: PORTAL,
});

router.post('/registro', mudado);
router.post('/login', mudado);
router.post('/clave', mudado);

/* El cierre de sesión también es del portal: aquí no hay ninguna cookie propia
   que borrar, y borrar la del portal desde un subdominio dejaría al resto de
   servicios en un estado raro. */
router.post('/logout', (req, res) => res.json({ ok: true, salir: 'https://lepayimio.es/salir' }));

router.get('/me', (req, res) => {
  if (!req.usuario) return res.json({ usuario: null });
  const u = db.prepare('SELECT id, usuario, nombre, rol FROM usuarios WHERE id = ?')
    .get(req.usuario.id);
  res.json({ usuario: u || req.usuario });
});

/* El nombre visible sí es cosa de este servicio: es cómo apareces en tu álbum,
   no quién eres. */
router.post('/perfil', exigeSesion, (req, res, next) => {
  try {
    const nombre = String((req.body || {}).nombre || '').trim().slice(0, 60);
    db.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?').run(nombre, req.usuario.id);
    res.json({ ok: true, nombre });
  } catch (e) { next(e); }
});

module.exports = router;

'use strict';
const express = require('express');
const ingesta = require('../lib/ingesta');
const img = require('../lib/imagenes');
const api = require('../lib/api');
const Card = require('../models/Card');
const User = require('../models/User');
const { db } = require('../lib/db');
const { exigeAdmin } = require('../lib/auth');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));
router.use(exigeAdmin);

/* El panel entero en una llamada: el front lo consulta cada pocos segundos
   mientras la ingesta corre, y no tiene sentido pedir cuatro cosas por
   separado para pintar una sola pantalla. */
router.get('/estado', (req, res, next) => {
  try {
    const e = ingesta.estado();
    const exps = db.prepare('SELECT COUNT(*) c FROM expansiones').get().c;
    const cartas = Card.cuantasCartas();
    const cuota = api.cuotaActual();
    const pendientes = e.setsTotales ? Math.max(e.setsTotales - e.indiceSet, 0) : null;
    res.json({
      ingesta: e,
      precarga: img.estado(),
      cuota,
      catalogo: { expansiones: exps, cartas, imagenes: img.cuantasEnDisco(),
                  sinImagen: db.prepare('SELECT COUNT(*) c FROM cartas WHERE imagen_local = 0').get().c },
      // Con 200 cartas por petición y el techo por hora, esto es lo que
      // realmente se tarda; conviene que el administrador lo vea antes de
      // darle al botón y no lo descubra a las cuatro horas.
      estimacion: pendientes == null ? null : {
        expansionesPendientes: pendientes,
        horasAproximadas: Math.ceil((pendientes * 1.2) / Math.max(cuota.limiteHora - api.RESERVA_HORA, 1)),
      },
    });
  } catch (e) { next(e); }
});

router.post('/ingesta/arrancar', (req, res, next) => {
  try {
    // "faltantes" repasa solo las expansiones que no están enteras: es lo que
    // se quiere después de una bajada que dejó huecos, sin repetir el catálogo.
    const { idiomas, desdeCero, modo } = req.body || {};
    res.json(ingesta.arrancar({ idiomas, desdeCero: !!desdeCero, modo }));
  } catch (e) { next(e); }
});

router.post('/ingesta/parar', (req, res, next) => {
  try { res.json(ingesta.parar()); } catch (e) { next(e); }
});

router.post('/precarga/arrancar', (req, res, next) => {
  try {
    const { setCode, tamano } = req.body || {};
    if (!setCode) return res.status(400).json({ error: 'Falta la expansión.' });
    res.json(img.precargar(setCode, tamano));
  } catch (e) { next(e); }
});

/* Las imágenes de la colección de un usuario. Son pocas y son justo las que
   va a abrir, así que es la precarga que más se nota. */
router.post('/precarga/coleccion', (req, res, next) => {
  try {
    const { usuarioId, tamano } = req.body || {};
    const id = parseInt(usuarioId, 10);
    if (!id) return res.status(400).json({ error: 'Falta el usuario.' });
    res.json(img.precargarColeccion(id, tamano));
  } catch (e) { next(e); }
});

/* Todas las que falten. Es cosa de semanas por la cuota, así que se lanza y
   se olvida uno; el panel enseña por dónde va. */
router.post('/precarga/catalogo', (req, res, next) => {
  try { res.json(img.precargarCatalogo((req.body || {}).tamano)); }
  catch (e) { next(e); }
});

router.post('/precarga/parar', (req, res, next) => {
  try { res.json(img.pararPrecarga()); } catch (e) { next(e); }
});

router.get('/usuarios', (req, res, next) => {
  try { res.json({ usuarios: User.listar() }); } catch (e) { next(e); }
});

router.patch('/usuarios/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const u = User.porId(id);
    if (!u) return res.status(404).json({ error: 'No existe ese usuario.' });
    const { rol, nombre, clave } = req.body || {};
    // Un admin no puede quitarse a sí mismo el rol: si es el único, la web se
    // queda sin nadie que pueda actualizar el catálogo.
    if (rol && id === req.usuario.id && rol !== 'admin') {
      return res.status(400).json({ error: 'No puedes quitarte a ti mismo el rol de administrador.' });
    }
    if (rol) db.prepare('UPDATE usuarios SET rol = ? WHERE id = ?').run(rol === 'admin' ? 'admin' : 'user', id);
    if (nombre != null) db.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?').run(String(nombre).slice(0, 120), id);
    if (clave) await User.cambiarClave(id, clave);
    res.json({ usuario: User.publico(User.porId(id)) });
  } catch (e) { next(e); }
});

module.exports = router;

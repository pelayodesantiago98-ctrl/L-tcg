'use strict';
const express = require('express');
const Binder = require('../models/BinderSlot');
const Card = require('../models/Card');
const { exigeSesion } = require('../lib/auth');

const router = express.Router();
router.use(express.json({ limit: '64kb' }));
router.use(exigeSesion);

const miBinder = (req, res) => {
  const b = Binder.porId(parseInt(req.params.id, 10), req.usuario.id);
  if (!b) { res.status(404).json({ error: 'Ese álbum no existe o no es tuyo.' }); return null; }
  return b;
};

router.get('/', (req, res, next) => {
  try { res.json({ binders: Binder.listar(req.usuario.id), distribuciones: Binder.DISTRIBUCIONES }); }
  catch (e) { next(e); }
});

router.post('/', (req, res, next) => {
  try {
    const { nombre, slots, paginas } = req.body || {};
    res.status(201).json(Binder.crear(req.usuario.id, nombre, slots, paginas));
  } catch (e) { next(e); }
});

router.patch('/:id', (req, res, next) => {
  try {
    if (!miBinder(req, res)) return;
    const { nombre, paginas } = req.body || {};
    res.json(Binder.renombrar(parseInt(req.params.id, 10), req.usuario.id, nombre, paginas));
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    if (!miBinder(req, res)) return;
    res.json({ ok: Binder.borrar(parseInt(req.params.id, 10), req.usuario.id) });
  } catch (e) { next(e); }
});

// Una página con sus huecos y su barra de progreso.
router.get('/:id/pagina/:num', (req, res, next) => {
  try {
    const p = Binder.pagina(parseInt(req.params.id, 10), req.usuario.id, req.params.num);
    if (!p) return res.status(404).json({ error: 'Ese álbum no existe o no es tuyo.' });
    res.json(p);
  } catch (e) { next(e); }
});

// Poner o quitar una carta de un hueco.
router.put('/:id/pagina/:num/hueco/:hueco', (req, res, next) => {
  try {
    const b = miBinder(req, res); if (!b) return;
    const hueco = parseInt(req.params.hueco, 10);
    if (!(hueco >= 0 && hueco < b.slots_por_pagina)) {
      return res.status(400).json({ error: 'Ese hueco no existe en esta página.' });
    }
    const cartaId = (req.body || {}).cartaId || null;
    if (cartaId && !Card.porId(cartaId)) return res.status(404).json({ error: 'No existe esa carta.' });
    const p = parseInt(req.params.num, 10);
    if (cartaId) Binder.poner(b.id, p, hueco, cartaId); else Binder.vaciar(b.id, p, hueco);
    res.json(Binder.pagina(b.id, req.usuario.id, p));
  } catch (e) { next(e); }
});

/* Arrastrar y soltar. Manda origen y destino y el servidor decide: si el
   destino tiene carta, se intercambian; el navegador no tiene que saberlo. */
router.post('/:id/mover', (req, res, next) => {
  try {
    const b = miBinder(req, res); if (!b) return;
    const { desde, hasta } = req.body || {};
    const valido = (x) => x && Number.isInteger(x.pagina) && Number.isInteger(x.hueco) &&
      x.pagina >= 1 && x.hueco >= 0 && x.hueco < b.slots_por_pagina;
    if (!valido(desde) || !valido(hasta)) {
      return res.status(400).json({ error: 'Origen o destino no válidos.' });
    }
    const r = Binder.mover(b.id, desde, hasta);
    res.json({ ...r, origen: Binder.pagina(b.id, req.usuario.id, desde.pagina),
               destino: Binder.pagina(b.id, req.usuario.id, hasta.pagina) });
  } catch (e) { next(e); }
});

// Rellenar con una expansión entera: colocar 200 cartas a mano no lo hace nadie.
router.post('/:id/rellenar', (req, res, next) => {
  try {
    const b = miBinder(req, res); if (!b) return;
    const { setCode, desdePagina } = req.body || {};
    if (!setCode) return res.status(400).json({ error: 'Falta la expansión.' });
    const desde = Math.max(parseInt(desdePagina, 10) || 1, 1);
    const r = Binder.rellenarConExpansion(b.id, setCode, desde, b.slots_por_pagina);
    if (r.hastaPagina > b.paginas) {
      Binder.renombrar(b.id, req.usuario.id, b.nombre, r.hastaPagina);
    }
    res.json(r);
  } catch (e) { next(e); }
});

module.exports = router;

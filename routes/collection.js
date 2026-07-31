'use strict';
const fs = require('fs');
const express = require('express');
const Card = require('../models/Card');
const img = require('../lib/imagenes');
const api = require('../lib/api');
const { exigeSesion, exigeAdmin } = require('../lib/auth');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));

const bool = (v) => v === '1' || v === 'true' || v === true;

// Catálogo con buscador, filtros y ordenación. Todo en una consulta.
router.get('/cartas', exigeSesion, (req, res, next) => {
  try {
    const q = req.query;
    res.json(Card.consultar({
      usuarioId: req.usuario.id,
      q: q.q || '', expansion: q.expansion || '', rareza: q.rareza || '',
      tipo: q.tipo || '', idioma: q.idioma || '',
      soloMias: bool(q.mias), soloDeseadas: bool(q.deseadas), soloFaltan: bool(q.faltan),
      orden: q.orden || 'expansion', dir: q.dir || 'asc',
      pagina: q.pagina || 1, limite: q.limite || 60,
    }));
  } catch (e) { next(e); }
});

router.get('/cartas/:id', exigeSesion, (req, res, next) => {
  try {
    const c = Card.porId(req.params.id, req.usuario.id);
    if (!c) return res.status(404).json({ error: 'No existe esa carta.' });
    c.ataques = JSON.parse(c.ataques || '[]');
    c.precios = JSON.parse(c.precios_json || '[]');
    delete c.precios_json;
    res.json(c);
  } catch (e) { next(e); }
});

router.get('/sugerencias', exigeSesion, (req, res, next) => {
  try { res.json({ sugerencias: Card.sugerencias(req.query.q || '') }); } catch (e) { next(e); }
});

router.get('/filtros', exigeSesion, (req, res, next) => {
  try {
    res.json({
      expansiones: Card.expansiones(true),
      rarezas: Card.valoresDe('rareza'),
      tipos: Card.valoresDe('tipo'),
    });
  } catch (e) { next(e); }
});

router.get('/resumen', exigeSesion, (req, res, next) => {
  try {
    res.json({
      resumen: Card.resumen(req.usuario.id),
      expansiones: Card.progresoExpansiones(req.usuario.id),
    });
  } catch (e) { next(e); }
});

/* Marcar cuántas tengo y si la deseo. La wishlist no es una lista aparte: es
   una columna de la misma fila, así una carta no puede estar a la vez en dos
   sitios que se contradigan. */
router.post('/cartas/:id/marcar', exigeSesion, (req, res, next) => {
  try {
    if (!Card.porId(req.params.id)) return res.status(404).json({ error: 'No existe esa carta.' });
    const { cantidad, deseada, nota } = req.body || {};
    res.json(Card.marcar(req.usuario.id, req.params.id, { cantidad, deseada, nota }));
  } catch (e) { next(e); }
});

// ── Imágenes ───────────────────────────────────────────────────────────────

/*
 * Proxy con caché en disco. La primera vez gasta una petición de la cuota; a
 * partir de ahí la sirve nginx-style desde el fichero. El navegador la cachea
 * un año porque el identificador de la carta no se reutiliza nunca.
 */
router.get('/imagen/:id', exigeSesion, async (req, res) => {
  const tamano = req.query.size === 'high' ? 'high' : 'low';
  try {
    const fichero = await img.asegurar(req.params.id, tamano);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(img.tipoDeRuta(fichero));
    fs.createReadStream(fichero).pipe(res);
  } catch (e) {
    if (e instanceof api.SinCuota) {
      // 429 y no 404: el front distingue "no hay imagen" de "hoy no puedo
      // bajarla" y en el segundo caso reintenta más tarde en vez de dar la
      // carta por ilustrada con un hueco negro para siempre.
      return res.status(429).json({ error: 'Cuota de la API agotada', cuota: e.cuota });
    }
    res.status(e.status === 404 ? 404 : 502).json({ error: String(e.message || e) });
  }
});

// Alta manual de imagen, para lo que la API no tiene.
router.put('/imagen/:id', exigeAdmin, (req, res, next) => {
  const trozos = [];
  let total = 0;
  req.on('data', (t) => {
    total += t.length;
    if (total > 8 * 1024 * 1024) { req.destroy(); return; }
    trozos.push(t);
  });
  req.on('end', () => {
    try {
      if (!total) return res.status(400).json({ error: 'No llegó ningún fichero.' });
      const datos = Buffer.concat(trozos);
      // Comprobación por contenido y no por extensión: la cabecera de un JPEG
      // empieza por FF D8 FF y la de un PNG por 89 50 4E 47.
      const esJpeg = datos[0] === 0xFF && datos[1] === 0xD8;
      const esPng = datos[0] === 0x89 && datos[1] === 0x50;
      if (!esJpeg && !esPng) return res.status(415).json({ error: 'Solo se admiten JPEG o PNG.' });
      img.guardarManual(req.params.id, req.query.size === 'high' ? 'high' : 'low', datos);
      res.json({ ok: true, bytes: total });
    } catch (e) { next(e); }
  });
});

module.exports = router;

'use strict';
/*
 * Amigos: a quién le has mandado solicitud, quién te la manda a ti, y los
 * pocos datos de solo lectura que un amigo puede ver de tu colección.
 *
 * Deliberadamente no hay aquí ningún POST/PUT/PATCH/DELETE sobre cartas o
 * álbumes de otro: que un amigo no pueda editarte la colección no es un
 * permiso que se comprueba, es que esa ruta de escritura no existe bajo
 * /api/amigos. Card y BinderSlot ya aceptan cualquier usuarioId como
 * parámetro —no están atados a req.usuario—, así que ver lo de un amigo es
 * llamarlos con su id en vez del tuyo.
 */
const express = require('express');
const User = require('../models/User');
const Amistad = require('../models/Amistad');
const Card = require('../models/Card');
const Binder = require('../models/BinderSlot');
const { exigeSesion } = require('../lib/auth');

const router = express.Router();
router.use(express.json({ limit: '4kb' }));
router.use(exigeSesion);

/* path-to-regexp 8 (Express 5) ya no admite ":id(\\d+)" para acotar el
   parámetro en la propia ruta -- hay que comprobarlo a mano aquí. */
const idValido = (v) => /^\d+$/.test(String(v || ''));
const exigeIdNumerico = (req, res, next) => {
  if (!idValido(req.params.id)) return res.status(400).json({ error: 'Id no válido.' });
  next();
};

router.get('/', (req, res, next) => {
  try { res.json({ amigos: Amistad.listarAmigos(req.usuario.id) }); }
  catch (e) { next(e); }
});

router.get('/solicitudes', (req, res, next) => {
  try { res.json({ solicitudes: Amistad.recibidas(req.usuario.id) }); }
  catch (e) { next(e); }
});

router.get('/buscar', (req, res, next) => {
  try {
    const candidatos = User.buscar(req.query.q, req.usuario.id);
    res.json({ resultados: candidatos.map((u) => {
      const estado = Amistad.estadoCon(req.usuario.id, u.id);
      // Para poder cancelar una solicitud enviada hace falta el id de la
      // propia solicitud, no el del usuario: son tablas distintas.
      const s = estado === 'enviada' ? Amistad.solicitudDe(req.usuario.id, u.id) : null;
      return { ...u, estado, solicitudId: s ? s.id : null };
    }) });
  } catch (e) { next(e); }
});

router.post('/solicitud', (req, res, next) => {
  try {
    const q = String((req.body || {}).para || '').trim();
    const u = /^\d+$/.test(q) ? User.porId(Number(q)) : User.porNombre(q);
    if (!u) return res.status(404).json({ error: 'No existe ese usuario.' });
    res.status(201).json(Amistad.enviar(req.usuario.id, u.id));
  } catch (e) { next(e); }
});

router.post('/solicitudes/:id/aceptar', (req, res, next) => {
  try { res.json(Amistad.aceptar(parseInt(req.params.id, 10), req.usuario.id)); }
  catch (e) { next(e); }
});

router.post('/solicitudes/:id/rechazar', (req, res, next) => {
  try { res.json(Amistad.rechazar(parseInt(req.params.id, 10), req.usuario.id)); }
  catch (e) { next(e); }
});

router.delete('/solicitud/:id', (req, res, next) => {
  try { res.json(Amistad.cancelar(parseInt(req.params.id, 10), req.usuario.id)); }
  catch (e) { next(e); }
});

router.delete('/:id', exigeIdNumerico, (req, res, next) => {
  try { res.json(Amistad.deshacer(req.usuario.id, parseInt(req.params.id, 10))); }
  catch (e) { next(e); }
});

// A partir de aquí, todo exige que :id sea amigo de quien pregunta.
const requiereAmigo = (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Amistad.sonAmigos(req.usuario.id, id)) {
    return res.status(403).json({ error: 'No sois amigos.' });
  }
  next();
};

router.get('/:id/resumen', exigeIdNumerico, requiereAmigo, (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const u = User.porId(id);
    if (!u) return res.status(404).json({ error: 'Ese usuario no existe.' });
    res.json({
      perfil: User.publico(u),
      resumen: Card.resumen(id),
      albumes: Binder.listar(id).length,
    });
  } catch (e) { next(e); }
});

router.get('/:id/cartas', exigeIdNumerico, requiereAmigo, (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const q = req.query;
    const bool = (v) => v === '1' || v === 'true' || v === true;
    res.json(Card.consultar({
      usuarioId: id,
      q: q.q || '', expansion: q.expansion || '', rareza: q.rareza || '',
      tipo: q.tipo || '', idioma: q.idioma || '',
      soloMias: bool(q.mias), soloDeseadas: bool(q.deseadas), soloFaltan: bool(q.faltan),
      orden: q.orden || 'expansion', dir: q.dir || 'asc',
      pagina: q.pagina || 1, limite: q.limite || 60,
    }));
  } catch (e) { next(e); }
});

router.get('/:id/cartas/:cartaId', exigeIdNumerico, requiereAmigo, (req, res, next) => {
  try {
    const c = Card.porId(req.params.cartaId, parseInt(req.params.id, 10));
    if (!c) return res.status(404).json({ error: 'No existe esa carta.' });
    c.ataques = JSON.parse(c.ataques || '[]');
    c.precios = JSON.parse(c.precios_json || '[]');
    delete c.precios_json;
    res.json(c);
  } catch (e) { next(e); }
});

/* Mismo nombre de segmento que /api/binder (singular) y no /api/amigos/:id/binders:
   así el front puede anteponer "/amigos/<id>" a la ruta propia sin tener que
   traducir nombres de un lado a otro. */
router.get('/:id/binder', exigeIdNumerico, requiereAmigo, (req, res, next) => {
  try {
    res.json({ binders: Binder.listar(parseInt(req.params.id, 10)), distribuciones: Binder.DISTRIBUCIONES });
  } catch (e) { next(e); }
});

router.get('/:id/binder/:bid/pagina/:num', exigeIdNumerico, requiereAmigo, (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Binder.porId(parseInt(req.params.bid, 10), id)) {
      return res.status(404).json({ error: 'Ese álbum no existe.' });
    }
    const p = Binder.pagina(parseInt(req.params.bid, 10), id, req.params.num);
    if (!p) return res.status(404).json({ error: 'Esa página no existe.' });
    res.json(p);
  } catch (e) { next(e); }
});

module.exports = router;

'use strict';
const { db, ahora } = require('../lib/db');
const { publico } = require('./User');

const par = (a, b) => (a < b ? [a, b] : [b, a]);

const sonAmigos = (id1, id2) => {
  const [a, b] = par(id1, id2);
  return !!db.prepare('SELECT 1 FROM amistades WHERE usuario_a = ? AND usuario_b = ?').get(a, b);
};

const listarAmigos = (usuarioId) => db.prepare(`
  SELECT u.* FROM amistades am
  JOIN usuarios u ON u.id = CASE WHEN am.usuario_a = ? THEN am.usuario_b ELSE am.usuario_a END
  WHERE am.usuario_a = ? OR am.usuario_b = ?
  ORDER BY u.usuario
`).all(usuarioId, usuarioId, usuarioId).map(publico);

/* Alias en las columnas de la solicitud: sin ellos, "u.*" detrás pisa el
   propio id y creado de la solicitud con los del usuario que la envía —
   better-sqlite3 no distingue columnas repetidas, se queda con la última. */
const recibidas = (usuarioId) => db.prepare(`
  SELECT s.id AS solicitud_id, s.creado AS solicitud_creado, u.*
  FROM solicitudes_amistad s
  JOIN usuarios u ON u.id = s.de_usuario
  WHERE s.para_usuario = ?
  ORDER BY s.creado
`).all(usuarioId).map((f) => ({ id: f.solicitud_id, creado: f.solicitud_creado, de: publico(f) }));

const buscarSolicitud = (deId, paraId) =>
  db.prepare('SELECT * FROM solicitudes_amistad WHERE de_usuario = ? AND para_usuario = ?').get(deId, paraId);

function estadoCon(usuarioId, otroId) {
  if (usuarioId === otroId) return 'yo';
  if (sonAmigos(usuarioId, otroId)) return 'amigos';
  if (buscarSolicitud(usuarioId, otroId)) return 'enviada';
  if (buscarSolicitud(otroId, usuarioId)) return 'recibida';
  return 'nada';
}

function aceptar(solicitudId, paraId) {
  const s = db.prepare('SELECT * FROM solicitudes_amistad WHERE id = ?').get(solicitudId);
  if (!s || s.para_usuario !== paraId) {
    throw Object.assign(new Error('Esa solicitud no existe.'), { status: 404 });
  }
  const [a, b] = par(s.de_usuario, s.para_usuario);
  db.prepare('INSERT OR IGNORE INTO amistades (usuario_a, usuario_b, creado) VALUES (?, ?, ?)')
    .run(a, b, ahora());
  db.prepare('DELETE FROM solicitudes_amistad WHERE id = ?').run(solicitudId);
  return { ok: true };
}

function rechazar(solicitudId, paraId) {
  const s = db.prepare('SELECT * FROM solicitudes_amistad WHERE id = ?').get(solicitudId);
  if (!s || s.para_usuario !== paraId) {
    throw Object.assign(new Error('Esa solicitud no existe.'), { status: 404 });
  }
  db.prepare('DELETE FROM solicitudes_amistad WHERE id = ?').run(solicitudId);
  return { ok: true };
}

function cancelar(solicitudId, deId) {
  const s = db.prepare('SELECT * FROM solicitudes_amistad WHERE id = ?').get(solicitudId);
  if (!s || s.de_usuario !== deId) {
    throw Object.assign(new Error('Esa solicitud no existe.'), { status: 404 });
  }
  db.prepare('DELETE FROM solicitudes_amistad WHERE id = ?').run(solicitudId);
  return { ok: true };
}

/* Enviar una solicitud cuando la otra persona ya te había enviado una a ti es,
   en la práctica, aceptar la suya: si no se mira esto quedan dos filas
   cruzadas pendientes y nadie ve nunca un botón de "aceptar". */
function enviar(deId, paraId) {
  if (deId === paraId) {
    throw Object.assign(new Error('No puedes enviarte una solicitud a ti mismo.'), { status: 400 });
  }
  if (sonAmigos(deId, paraId)) {
    throw Object.assign(new Error('Ya sois amigos.'), { status: 409 });
  }
  const inversa = buscarSolicitud(paraId, deId);
  if (inversa) return aceptar(inversa.id, deId);
  if (buscarSolicitud(deId, paraId)) {
    throw Object.assign(new Error('Ya le has enviado una solicitud.'), { status: 409 });
  }
  const r = db.prepare(
    'INSERT INTO solicitudes_amistad (de_usuario, para_usuario, creado) VALUES (?, ?, ?)'
  ).run(deId, paraId, ahora());
  return { id: r.lastInsertRowid, ok: true };
}

const deshacer = (id1, id2) => {
  const [a, b] = par(id1, id2);
  db.prepare('DELETE FROM amistades WHERE usuario_a = ? AND usuario_b = ?').run(a, b);
  return { ok: true };
};

module.exports = {
  sonAmigos, listarAmigos, recibidas, estadoCon, solicitudDe: buscarSolicitud,
  enviar, aceptar, rechazar, cancelar, deshacer,
};

'use strict';
const { db, ahora } = require('../lib/db');
const { hashear, comprobar } = require('../lib/auth');

const VALIDO = /^[a-zA-Z0-9._-]{3,24}$/;
const MINIMO_CLAVE = 8;

const porNombre = (usuario) =>
  db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(String(usuario || '').trim());

const porId = (id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);

const cuantos = () => db.prepare('SELECT COUNT(*) c FROM usuarios').get().c;

const publico = (u) => u && ({
  id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol,
  creado: u.creado, ultimoAcceso: u.ultimo_acceso,
});

async function crear({ usuario, nombre, clave, rol = 'user' }) {
  usuario = String(usuario || '').trim();
  if (!VALIDO.test(usuario)) {
    throw Object.assign(new Error('El usuario admite de 3 a 24 letras, números, punto, guion o guion bajo.'), { status: 400 });
  }
  if (String(clave || '').length < MINIMO_CLAVE) {
    throw Object.assign(new Error(`La contraseña necesita al menos ${MINIMO_CLAVE} caracteres.`), { status: 400 });
  }
  if (porNombre(usuario)) {
    throw Object.assign(new Error('Ese usuario ya existe.'), { status: 409 });
  }
  const hash = await hashear(clave);
  const r = db.prepare(
    'INSERT INTO usuarios (usuario, nombre, clave_hash, rol, creado) VALUES (?, ?, ?, ?, ?)'
  ).run(usuario, String(nombre || '').trim(), hash, rol === 'admin' ? 'admin' : 'user', ahora());
  return porId(r.lastInsertRowid);
}

async function verificarClave(usuario, clave) {
  const u = porNombre(usuario);
  // Se compara igualmente contra un hash falso cuando el usuario no existe,
  // para que responder "no existe" y "clave mala" cueste lo mismo y no se
  // puedan adivinar usuarios cronometrando la respuesta.
  const hash = u ? u.clave_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const vale = await comprobar(String(clave || ''), hash);
  return u && vale ? u : null;
}

const anotarAcceso = (id) =>
  db.prepare('UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?').run(ahora(), id);

async function cambiarClave(id, clave) {
  if (String(clave || '').length < MINIMO_CLAVE) {
    throw Object.assign(new Error(`La contraseña necesita al menos ${MINIMO_CLAVE} caracteres.`), { status: 400 });
  }
  db.prepare('UPDATE usuarios SET clave_hash = ? WHERE id = ?').run(await hashear(clave), id);
}

const listar = () =>
  db.prepare('SELECT * FROM usuarios ORDER BY creado').all().map(publico);

module.exports = {
  VALIDO, MINIMO_CLAVE, porNombre, porId, cuantos, publico,
  crear, verificarClave, anotarAcceso, cambiarClave, listar,
};

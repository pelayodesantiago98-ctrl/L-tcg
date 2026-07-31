'use strict';
/*
 * El binder: un álbum con páginas y huecos.
 *
 * Solo se guardan los huecos ocupados. Un álbum de 60 páginas con 9 huecos
 * son 540 filas si se guardara la rejilla entera, y casi todas vacías; los
 * huecos libres se calculan al pintar la página, que es donde se sabe cuántos
 * caben. Por eso el "hueco negro" del diseño no existe en la base de datos:
 * es la ausencia de fila.
 */
const { db, ahora } = require('../lib/db');

const DISTRIBUCIONES = { 4: [2, 2], 6: [3, 2], 9: [3, 3], 12: [4, 3] };
const PERMITIDOS = Object.keys(DISTRIBUCIONES).map(Number);

const listar = (usuarioId) => db.prepare(`
  SELECT b.*, (SELECT COUNT(*) FROM binder_slots s
               WHERE s.binder_id = b.id AND s.carta_id IS NOT NULL) AS ocupados
  FROM binders b WHERE b.usuario_id = ? ORDER BY b.creado`).all(usuarioId);

const porId = (id, usuarioId) =>
  db.prepare('SELECT * FROM binders WHERE id = ? AND usuario_id = ?').get(id, usuarioId);

function crear(usuarioId, nombre, slotsPorPagina = 9, paginas = 20) {
  const s = PERMITIDOS.includes(Number(slotsPorPagina)) ? Number(slotsPorPagina) : 9;
  const r = db.prepare(
    'INSERT INTO binders (usuario_id, nombre, slots_por_pagina, paginas, creado) VALUES (?, ?, ?, ?, ?)'
  ).run(usuarioId, String(nombre || 'Mi álbum').trim().slice(0, 80) || 'Mi álbum',
        s, Math.min(Math.max(parseInt(paginas, 10) || 20, 1), 500), ahora());
  return db.prepare('SELECT * FROM binders WHERE id = ?').get(r.lastInsertRowid);
}

const borrar = (id, usuarioId) =>
  db.prepare('DELETE FROM binders WHERE id = ? AND usuario_id = ?').run(id, usuarioId).changes > 0;

function renombrar(id, usuarioId, nombre, paginas) {
  const b = porId(id, usuarioId);
  if (!b) return null;
  db.prepare('UPDATE binders SET nombre = ?, paginas = ? WHERE id = ?').run(
    String(nombre || b.nombre).trim().slice(0, 80) || b.nombre,
    paginas == null ? b.paginas : Math.min(Math.max(parseInt(paginas, 10) || 1, 1), 500),
    id);
  return porId(id, usuarioId);
}

/*
 * Una página con sus huecos, ya rellenados con los datos de cada carta. Los
 * huecos vacíos vienen como null para que el front pinte el hueco negro sin
 * tener que adivinar cuántos van.
 */
function pagina(binderId, usuarioId, num) {
  const b = porId(binderId, usuarioId);
  if (!b) return null;
  const p = Math.min(Math.max(parseInt(num, 10) || 1, 1), b.paginas);

  const filas = db.prepare(`
    SELECT s.hueco, s.carta_id, c.nombre, c.numero, c.rareza, c.precio_avg,
           c.set_code, e.nombre AS expansion,
           COALESCE(col.cantidad, 0) AS cantidad, COALESCE(col.deseada, 0) AS deseada
    FROM binder_slots s
    LEFT JOIN cartas c      ON c.id = s.carta_id
    LEFT JOIN expansiones e ON e.set_code = c.set_code
    LEFT JOIN coleccion col ON col.carta_id = s.carta_id AND col.usuario_id = ?
    WHERE s.binder_id = ? AND s.pagina = ?`).all(usuarioId, binderId, p);

  const porHueco = new Map(filas.map((f) => [f.hueco, f]));
  const huecos = Array.from({ length: b.slots_por_pagina }, (_, i) => {
    const f = porHueco.get(i);
    return (f && f.carta_id) ? { hueco: i, carta: f } : { hueco: i, carta: null };
  });

  const llenos = huecos.filter((h) => h.carta).length;
  // "Tenida" = está en el álbum Y el usuario marca que la posee. Un hueco con
  // carta asignada pero cantidad 0 es justo lo que hay que ir a buscar.
  const tenidas = huecos.filter((h) => h.carta && h.carta.cantidad > 0).length;

  return {
    binder: { ...b, distribucion: DISTRIBUCIONES[b.slots_por_pagina] || [3, 3] },
    pagina: p, huecos,
    progreso: {
      llenos, tenidas, total: b.slots_por_pagina,
      faltan: huecos.filter((h) => h.carta && h.carta.cantidad === 0).map((h) => h.carta.nombre),
      porcentaje: b.slots_por_pagina ? Math.round((tenidas / b.slots_por_pagina) * 100) : 0,
    },
  };
}

const poner = (binderId, p, hueco, cartaId) =>
  db.prepare(`INSERT INTO binder_slots (binder_id, pagina, hueco, carta_id)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(binder_id, pagina, hueco) DO UPDATE SET carta_id = excluded.carta_id`)
    .run(binderId, p, hueco, cartaId || null);

const vaciar = (binderId, p, hueco) =>
  db.prepare('DELETE FROM binder_slots WHERE binder_id = ? AND pagina = ? AND hueco = ?')
    .run(binderId, p, hueco);

/* Mover es intercambiar: si el destino está ocupado, las dos cartas cambian de
   sitio en lugar de perderse una. En una transacción porque a mitad quedaría
   la misma carta en dos huecos. */
const mover = db.transaction((binderId, desde, hasta) => {
  const leer = db.prepare('SELECT carta_id FROM binder_slots WHERE binder_id = ? AND pagina = ? AND hueco = ?');
  const a = leer.get(binderId, desde.pagina, desde.hueco);
  const b = leer.get(binderId, hasta.pagina, hasta.hueco);
  const cartaA = a ? a.carta_id : null;
  const cartaB = b ? b.carta_id : null;
  if (cartaB) poner(binderId, desde.pagina, desde.hueco, cartaB);
  else vaciar(binderId, desde.pagina, desde.hueco);
  if (cartaA) poner(binderId, hasta.pagina, hasta.hueco, cartaA);
  else vaciar(binderId, hasta.pagina, hasta.hueco);
  return { movida: cartaA, intercambiada: cartaB };
});

/*
 * El primer hueco libre del álbum, recorriendo páginas en orden. Es lo que
 * hace falta para "añadir esta carta" sin pedirle al usuario que elija sitio:
 * la carta cae donde toca y luego ya la arrastra si quiere.
 *
 * Se leen los huecos ocupados de una vez y se busca en memoria; ir preguntando
 * hueco por hueco serían cientos de consultas en un álbum grande.
 */
function primerHuecoLibre(binderId, slotsPorPagina, paginas) {
  const ocupados = new Set(db.prepare(
    'SELECT pagina, hueco FROM binder_slots WHERE binder_id = ? AND carta_id IS NOT NULL')
    .all(binderId).map((f) => `${f.pagina}:${f.hueco}`));
  for (let p = 1; p <= paginas; p++) {
    for (let h = 0; h < slotsPorPagina; h++) {
      if (!ocupados.has(`${p}:${h}`)) return { pagina: p, hueco: h };
    }
  }
  return null;   // álbum lleno
}

/* Añade una carta al primer sitio libre. Si ya estaba en el álbum se devuelve
   dónde, en vez de duplicarla: tener dos veces la misma carta en el álbum es
   casi siempre un despiste, y el usuario ya lleva la cuenta de cuántas tiene
   en su colección. */
function anadir(binder, cartaId) {
  const ya = db.prepare(
    'SELECT pagina, hueco FROM binder_slots WHERE binder_id = ? AND carta_id = ? LIMIT 1')
    .get(binder.id, cartaId);
  if (ya) return { ...ya, repetida: true };
  const libre = primerHuecoLibre(binder.id, binder.slots_por_pagina, binder.paginas);
  if (!libre) return null;
  poner(binder.id, libre.pagina, libre.hueco, cartaId);
  return { ...libre, repetida: false };
}

/* Rellena el álbum con una expansión entera, en orden de número. Es lo que
   convierte el binder en algo usable: nadie va a colocar 200 cartas a mano. */
const rellenarConExpansion = db.transaction((binderId, setCode, desdePagina, slotsPorPagina) => {
  const cartas = db.prepare(
    'SELECT id FROM cartas WHERE set_code = ? ORDER BY numero_orden IS NULL, numero_orden, id'
  ).all(setCode);
  let p = desdePagina, h = 0;
  for (const c of cartas) {
    poner(binderId, p, h, c.id);
    if (++h >= slotsPorPagina) { h = 0; p++; }
  }
  return { colocadas: cartas.length, hastaPagina: h === 0 ? p - 1 : p };
});

module.exports = {
  DISTRIBUCIONES, PERMITIDOS, listar, porId, crear, borrar, renombrar,
  pagina, poner, vaciar, mover, rellenarConExpansion,
  primerHuecoLibre, anadir,
};

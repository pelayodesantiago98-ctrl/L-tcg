'use strict';
const { db, normaliza, ahora } = require('../lib/db');

/* "003/053" -> 3. Sirve para ordenar por número dentro de la expansión, que
   con texto puro pondría el 10 antes que el 2. Algunas cartas traen números
   con letra (SWSH045, TG12) y de ahí se saca el primer grupo de dígitos. */
function numeroOrden(numero) {
  const m = String(numero || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/* Fechas del tipo "3rd August, 2007" a algo ordenable. Si no se entiende se
   deja vacío y esa expansión cae al final al ordenar por fecha. */
const MESES = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12 };
function fechaOrden(texto) {
  const m = String(texto || '').match(/(\d{1,2})\w*\s+(\w+),?\s+(\d{4})/);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  return `${m[3]}-${String(mes).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

/*
 * Precio de Cardmarket, en euros. La API devuelve una entrada por variante
 * (normal, holo, reverse…) y muchas vienen con todo a null. Se elige la
 * primera que tenga precio medio, prefiriendo la normal, y se guardan todas
 * en JSON por si luego se quiere enseñar el desglose.
 */
function precioCardmarket(cardmarket) {
  const lista = (cardmarket && cardmarket.prices) || [];
  const conPrecio = lista.filter((p) => p && (p.avg != null || p.low != null));
  if (!conPrecio.length) return { elegido: null, todos: lista };
  const normal = conPrecio.find((p) => (p.variant_type || '').toLowerCase() === 'normal');
  return { elegido: normal || conPrecio[0], todos: lista };
}

const INSERTAR = `
INSERT INTO cartas (
  id, set_code, nombre, nombre_limpio, busca, numero, numero_orden, rareza, tipo,
  hp, etapa, texto, ataques, debilidad, resistencia, retirada, idiomas_img,
  cm_url, tcg_url, precio_avg, precio_low, precio_avg1, precio_avg7, precio_avg30,
  precio_trend, precio_variante, precio_fecha, precios_json, actualizada
) VALUES (
  @id, @set_code, @nombre, @nombre_limpio, @busca, @numero, @numero_orden, @rareza, @tipo,
  @hp, @etapa, @texto, @ataques, @debilidad, @resistencia, @retirada, @idiomas_img,
  @cm_url, @tcg_url, @precio_avg, @precio_low, @precio_avg1, @precio_avg7, @precio_avg30,
  @precio_trend, @precio_variante, @precio_fecha, @precios_json, @actualizada
)
ON CONFLICT(id) DO UPDATE SET
  set_code = excluded.set_code, nombre = excluded.nombre,
  nombre_limpio = excluded.nombre_limpio, busca = excluded.busca,
  numero = excluded.numero, numero_orden = excluded.numero_orden,
  rareza = excluded.rareza, tipo = excluded.tipo, hp = excluded.hp,
  etapa = excluded.etapa, texto = excluded.texto, ataques = excluded.ataques,
  debilidad = excluded.debilidad, resistencia = excluded.resistencia,
  retirada = excluded.retirada, idiomas_img = excluded.idiomas_img,
  cm_url = excluded.cm_url, tcg_url = excluded.tcg_url,
  precio_avg = excluded.precio_avg, precio_low = excluded.precio_low,
  precio_avg1 = excluded.precio_avg1, precio_avg7 = excluded.precio_avg7,
  precio_avg30 = excluded.precio_avg30, precio_trend = excluded.precio_trend,
  precio_variante = excluded.precio_variante, precio_fecha = excluded.precio_fecha,
  precios_json = excluded.precios_json, actualizada = excluded.actualizada`;

const stmtInsertar = db.prepare(INSERTAR);

/* El set_code se pasa desde fuera a propósito: dentro de card_info la API
   mete en set_code el set_id numérico ("23696") y no el código de la
   expansión ("SM6a"), así que fiarse de ahí rompería la relación. */
const guardarLote = db.transaction((setCode, cartas) => {
  const t = ahora();
  for (const c of cartas) {
    const info = c.card_info || {};
    const { elegido, todos } = precioCardmarket(c.cardmarket);
    stmtInsertar.run({
      id: c.id,
      set_code: setCode,
      nombre: info.name || '(sin nombre)',
      nombre_limpio: info.clean_name || info.name || '',
      busca: normaliza(`${info.name || ''} ${info.clean_name || ''} ${info.card_number || ''} ${info.rarity || ''}`),
      numero: info.card_number || null,
      numero_orden: numeroOrden(info.card_number),
      rareza: info.rarity || null,
      tipo: info.card_type || null,
      hp: info.hp != null ? Number(info.hp) : null,
      etapa: info.stage || null,
      texto: info.card_text || null,
      ataques: JSON.stringify(info.attacks || []),
      debilidad: info.weakness || null,
      resistencia: info.resistance || null,
      retirada: info.retreat_cost != null ? Number(info.retreat_cost) : null,
      idiomas_img: JSON.stringify((c.images && c.images.languages) || []),
      cm_url: (c.cardmarket && c.cardmarket.product_url) || null,
      tcg_url: (c.tcgplayer && c.tcgplayer.url) || null,
      precio_avg: elegido ? elegido.avg : null,
      precio_low: elegido ? elegido.low : null,
      precio_avg1: elegido ? elegido.avg1 : null,
      precio_avg7: elegido ? elegido.avg7 : null,
      precio_avg30: elegido ? elegido.avg30 : null,
      precio_trend: elegido ? elegido.trend : null,
      precio_variante: elegido ? elegido.variant_type : null,
      precio_fecha: elegido ? elegido.updated_at : null,
      precios_json: JSON.stringify(todos),
      actualizada: t,
    });
  }
  return cartas.length;
});

const guardarExpansiones = db.transaction((sets) => {
  const t = ahora();
  const st = db.prepare(`
    INSERT INTO expansiones (set_code, set_id, nombre, busca, idioma, total_cartas, fecha, fecha_orden, actualizada)
    VALUES (@set_code, @set_id, @nombre, @busca, @idioma, @total, @fecha, @fecha_orden, @t)
    ON CONFLICT(set_code) DO UPDATE SET
      set_id = excluded.set_id, nombre = excluded.nombre, busca = excluded.busca,
      idioma = excluded.idioma, total_cartas = excluded.total_cartas,
      fecha = excluded.fecha, fecha_orden = excluded.fecha_orden,
      actualizada = excluded.actualizada`);
  for (const s of sets) {
    st.run({
      set_code: s.set_code, set_id: s.set_id, nombre: s.name || s.set_code,
      busca: normaliza(`${s.name || ''} ${s.set_code || ''}`),
      idioma: (s.language || '').toLowerCase(),
      total: s.card_count || 0, fecha: s.release_date || null,
      fecha_orden: fechaOrden(s.release_date), t,
    });
  }
  return sets.length;
});

// ── Consultas ──────────────────────────────────────────────────────────────

const ORDENES = {
  nombre:    'c.nombre COLLATE NOCASE',
  numero:    'c.numero_orden',
  expansion: 'e.nombre COLLATE NOCASE, c.numero_orden',
  rareza:    'c.rareza',
  precio:    'c.precio_avg',
  fecha:     'e.fecha_orden',
};

/*
 * Una sola consulta sirve para la colección, la wishlist y el catálogo: lo que
 * cambia son los filtros. Va con LEFT JOIN a coleccion para que cada carta
 * traiga ya cuántas tiene el usuario y si la desea, y no haya que preguntarlo
 * carta por carta desde el navegador.
 */
function consultar({
  usuarioId, q = '', expansion = '', rareza = '', tipo = '', idioma = '',
  soloMias = false, soloDeseadas = false, soloFaltan = false,
  orden = 'expansion', dir = 'asc', pagina = 1, limite = 60,
} = {}) {
  const donde = [];
  const par = { usuarioId: usuarioId || 0 };

  if (q) { donde.push('c.busca LIKE @q'); par.q = '%' + normaliza(q) + '%'; }
  if (expansion) { donde.push('c.set_code = @expansion'); par.expansion = expansion; }
  if (rareza) { donde.push('c.rareza = @rareza'); par.rareza = rareza; }
  if (tipo) { donde.push('c.tipo = @tipo'); par.tipo = tipo; }
  if (idioma) { donde.push('e.idioma = @idioma'); par.idioma = idioma; }
  if (soloMias) donde.push('COALESCE(col.cantidad, 0) > 0');
  if (soloDeseadas) donde.push('COALESCE(col.deseada, 0) = 1');
  if (soloFaltan) donde.push('COALESCE(col.cantidad, 0) = 0');

  const filtro = donde.length ? 'WHERE ' + donde.join(' AND ') : '';
  const campo = ORDENES[orden] || ORDENES.expansion;
  const sentido = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  // Los nulos al final siempre: una carta sin precio no debe encabezar la
  // lista al ordenar por precio ascendente.
  const orderBy = `${campo} IS NULL, ${campo} ${sentido}, c.id`;

  const base = `FROM cartas c
    JOIN expansiones e ON e.set_code = c.set_code
    LEFT JOIN coleccion col ON col.carta_id = c.id AND col.usuario_id = @usuarioId
    ${filtro}`;

  const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(par).n;
  const lim = Math.min(Math.max(parseInt(limite, 10) || 60, 1), 200);
  const pag = Math.max(parseInt(pagina, 10) || 1, 1);

  const filas = db.prepare(`
    SELECT c.id, c.nombre, c.numero, c.numero_orden, c.rareza, c.tipo, c.hp, c.etapa,
           c.precio_avg, c.precio_low, c.precio_trend, c.precio_fecha, c.cm_url,
           c.imagen_local, c.set_code, e.nombre AS expansion, e.idioma,
           COALESCE(col.cantidad, 0) AS cantidad,
           COALESCE(col.deseada, 0)  AS deseada
    ${base}
    ORDER BY ${orderBy}
    LIMIT @lim OFFSET @off`).all({ ...par, lim, off: (pag - 1) * lim });

  return { total, pagina: pag, limite: lim, paginas: Math.ceil(total / lim) || 1, cartas: filas };
}

const porId = (id, usuarioId = 0) => db.prepare(`
  SELECT c.*, e.nombre AS expansion, e.idioma, e.fecha,
         COALESCE(col.cantidad, 0) AS cantidad, COALESCE(col.deseada, 0) AS deseada
  FROM cartas c
  JOIN expansiones e ON e.set_code = c.set_code
  LEFT JOIN coleccion col ON col.carta_id = c.id AND col.usuario_id = ?
  WHERE c.id = ?`).get(usuarioId, id);

const expansiones = (soloConCartas = false) => db.prepare(`
  SELECT e.*, (SELECT COUNT(*) FROM cartas c WHERE c.set_code = e.set_code) AS cartas
  FROM expansiones e
  ${soloConCartas ? 'WHERE (SELECT COUNT(*) FROM cartas c WHERE c.set_code = e.set_code) > 0' : ''}
  ORDER BY e.fecha_orden IS NULL, e.fecha_orden DESC, e.nombre`).all();

const valoresDe = (columna) => {
  if (!['rareza', 'tipo'].includes(columna)) return [];
  return db.prepare(`SELECT DISTINCT ${columna} v FROM cartas
    WHERE ${columna} IS NOT NULL AND ${columna} <> '' ORDER BY ${columna}`).all().map((r) => r.v);
};

// Autocompletado del buscador: nombres distintos que empiezan por lo tecleado.
const sugerencias = (q, limite = 8) => {
  if (!q || q.length < 2) return [];
  return db.prepare(`SELECT nombre, COUNT(*) n FROM cartas
    WHERE busca LIKE @pre GROUP BY nombre COLLATE NOCASE
    ORDER BY (busca LIKE @exacto) DESC, n DESC, nombre LIMIT @lim`)
    .all({ pre: normaliza(q) + '%', exacto: normaliza(q), lim: limite })
    .map((r) => r.nombre);
};

const cuantasCartas = () => db.prepare('SELECT COUNT(*) c FROM cartas').get().c;

// ── Lo que cada usuario tiene y desea ──────────────────────────────────────

/* Una sola sentencia para las dos cosas: se inserta la fila si no estaba y se
   toca solo la columna que corresponda. Cuando queda a cero y sin desear, la
   fila se borra para que la tabla no se llene de ceros de cartas que alguien
   miró una vez. */
function marcar(usuarioId, cartaId, { cantidad, deseada, nota } = {}) {
  const existe = db.prepare('SELECT * FROM coleccion WHERE usuario_id = ? AND carta_id = ?')
    .get(usuarioId, cartaId);
  const c = cantidad != null ? Math.max(0, Math.min(parseInt(cantidad, 10) || 0, 9999))
                             : (existe ? existe.cantidad : 0);
  const d = deseada != null ? (deseada ? 1 : 0) : (existe ? existe.deseada : 0);
  const n = nota !== undefined ? String(nota || '').slice(0, 400) : (existe ? existe.nota : null);

  if (!c && !d && !n) {
    if (existe) db.prepare('DELETE FROM coleccion WHERE usuario_id = ? AND carta_id = ?').run(usuarioId, cartaId);
    return { cantidad: 0, deseada: 0, nota: null };
  }
  db.prepare(`INSERT INTO coleccion (usuario_id, carta_id, cantidad, deseada, nota, actualizado)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(usuario_id, carta_id) DO UPDATE SET
                cantidad = excluded.cantidad, deseada = excluded.deseada,
                nota = excluded.nota, actualizado = excluded.actualizado`)
    .run(usuarioId, cartaId, c, d, n, ahora());
  return { cantidad: c, deseada: d, nota: n };
}

/* Resumen para la cabecera: cuántas tiene, cuánto valen y cuánto le falta.
   El valor usa el precio medio de Cardmarket por la cantidad que posee. */
const resumen = (usuarioId) => {
  const r = db.prepare(`
    SELECT COUNT(*) distintas,
           COALESCE(SUM(col.cantidad), 0) totales,
           COALESCE(SUM(col.cantidad * COALESCE(c.precio_avg, 0)), 0) valor
    FROM coleccion col JOIN cartas c ON c.id = col.carta_id
    WHERE col.usuario_id = ? AND col.cantidad > 0`).get(usuarioId);
  const d = db.prepare(`
    SELECT COUNT(*) deseadas,
           COALESCE(SUM(COALESCE(c.precio_avg, 0)), 0) valor_deseadas
    FROM coleccion col JOIN cartas c ON c.id = col.carta_id
    WHERE col.usuario_id = ? AND col.deseada = 1 AND col.cantidad = 0`).get(usuarioId);
  return { ...r, ...d, catalogo: cuantasCartas() };
};

/* Progreso por expansión: cuántas tiene de cada una. Es lo que llena la vista
   de colección y lo que decide qué expansión merece la pena precargar. */
const progresoExpansiones = (usuarioId) => db.prepare(`
  SELECT e.set_code, e.nombre, e.idioma, e.fecha_orden,
         COUNT(c.id) cartas,
         SUM(CASE WHEN COALESCE(col.cantidad, 0) > 0 THEN 1 ELSE 0 END) tengo
  FROM expansiones e
  JOIN cartas c ON c.set_code = e.set_code
  LEFT JOIN coleccion col ON col.carta_id = c.id AND col.usuario_id = ?
  GROUP BY e.set_code
  HAVING cartas > 0
  ORDER BY e.fecha_orden IS NULL, e.fecha_orden DESC, e.nombre`).all(usuarioId);

module.exports = {
  guardarLote, guardarExpansiones, consultar, porId, expansiones,
  valoresDe, sugerencias, cuantasCartas, numeroOrden, fechaOrden, ORDENES,
  marcar, resumen, progresoExpansiones,
};

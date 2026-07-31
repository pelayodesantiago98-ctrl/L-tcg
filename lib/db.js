'use strict';
/*
 * Base de datos.
 *
 * SQLite, un fichero, igual que l-notes. No hay ninguna base compartida en el
 * servidor —l-notes tiene su .sqlite3 y los dos sitios en Node guardan JSON—,
 * así que "la misma que los demás, separada" es esto. Con 68.000 cartas y
 * 700 MB de RAM libres, un motor con servidor propio saldría caro para nada:
 * aquí no hay concurrencia de escritura más allá de un puñado de usuarios.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DIR, { recursive: true });

const db = new Database(path.join(DIR, 'l-tcg.sqlite3'));

// WAL deja leer mientras se escribe: la ingesta tarda horas por el límite de
// la API y durante ese rato la web tiene que seguir respondiendo.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY,
  usuario       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre        TEXT NOT NULL DEFAULT '',
  clave_hash    TEXT NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'user',
  creado        TEXT NOT NULL,
  ultimo_acceso TEXT
);

CREATE TABLE IF NOT EXISTS expansiones (
  set_code     TEXT PRIMARY KEY,
  set_id       TEXT,
  nombre       TEXT NOT NULL,
  busca        TEXT,
  idioma       TEXT,
  total_cartas INTEGER DEFAULT 0,
  fecha        TEXT,
  fecha_orden  TEXT,
  cartas_bajadas INTEGER DEFAULT 0,
  actualizada  TEXT
);
CREATE INDEX IF NOT EXISTS idx_exp_idioma ON expansiones(idioma);
CREATE INDEX IF NOT EXISTS idx_exp_fecha  ON expansiones(fecha_orden);

CREATE TABLE IF NOT EXISTS cartas (
  id             TEXT PRIMARY KEY,
  set_code       TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  nombre_limpio  TEXT,
  busca          TEXT,
  numero         TEXT,
  numero_orden   INTEGER,
  rareza         TEXT,
  tipo           TEXT,
  hp             REAL,
  etapa          TEXT,
  texto          TEXT,
  ataques        TEXT,
  debilidad      TEXT,
  resistencia    TEXT,
  retirada       REAL,
  idiomas_img    TEXT,
  cm_url         TEXT,
  tcg_url        TEXT,
  precio_avg     REAL,
  precio_low     REAL,
  precio_avg1    REAL,
  precio_avg7    REAL,
  precio_avg30   REAL,
  precio_trend   REAL,
  precio_variante TEXT,
  precio_fecha   TEXT,
  precios_json   TEXT,
  imagen_local   INTEGER NOT NULL DEFAULT 0,
  actualizada    TEXT,
  FOREIGN KEY (set_code) REFERENCES expansiones(set_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cartas_set    ON cartas(set_code);
CREATE INDEX IF NOT EXISTS idx_cartas_busca  ON cartas(busca);
CREATE INDEX IF NOT EXISTS idx_cartas_nombre ON cartas(nombre);
CREATE INDEX IF NOT EXISTS idx_cartas_precio ON cartas(precio_avg);
CREATE INDEX IF NOT EXISTS idx_cartas_rareza ON cartas(rareza);
CREATE INDEX IF NOT EXISTS idx_cartas_orden  ON cartas(set_code, numero_orden);

/* Una fila por carta que el usuario tiene o desea. Si no hay fila, ni la tiene
   ni la quiere: así la tabla crece con lo que cada uno colecciona y no con el
   catálogo entero multiplicado por usuarios. */
CREATE TABLE IF NOT EXISTS coleccion (
  usuario_id  INTEGER NOT NULL,
  carta_id    TEXT NOT NULL,
  cantidad    INTEGER NOT NULL DEFAULT 0,
  deseada     INTEGER NOT NULL DEFAULT 0,
  nota        TEXT,
  actualizado TEXT,
  PRIMARY KEY (usuario_id, carta_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (carta_id)   REFERENCES cartas(id)   ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_col_usuario ON coleccion(usuario_id);
CREATE INDEX IF NOT EXISTS idx_col_deseada ON coleccion(usuario_id, deseada);

CREATE TABLE IF NOT EXISTS binders (
  id                INTEGER PRIMARY KEY,
  usuario_id        INTEGER NOT NULL,
  nombre            TEXT NOT NULL,
  slots_por_pagina  INTEGER NOT NULL DEFAULT 9,
  paginas           INTEGER NOT NULL DEFAULT 1,
  creado            TEXT NOT NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_binders_usuario ON binders(usuario_id);

CREATE TABLE IF NOT EXISTS binder_slots (
  binder_id INTEGER NOT NULL,
  pagina    INTEGER NOT NULL,
  hueco     INTEGER NOT NULL,
  carta_id  TEXT,
  PRIMARY KEY (binder_id, pagina, hueco),
  FOREIGN KEY (binder_id) REFERENCES binders(id) ON DELETE CASCADE,
  FOREIGN KEY (carta_id)  REFERENCES cartas(id)  ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_slots_pagina ON binder_slots(binder_id, pagina);

/* Estado de la ingesta. Va en tabla y no en memoria porque el trabajo dura
   horas, se corta al agotar la cuota y tiene que reanudarse donde lo dejó
   aunque el servicio se haya reiniciado por medio. */
CREATE TABLE IF NOT EXISTS ingesta (
  clave TEXT PRIMARY KEY,
  valor TEXT
);
`);

/*
 * Dos cosas que no estaban y que a este tamaño se notan. Medido sobre una
 * copia inflada a 69.195 cartas, que es a donde va el catálogo completo:
 *
 *   listado por expansión   9,49 ms  ->  0,07 ms
 *   contar resultados      15,24 ms  ->  1,32 ms
 *   sugerencias            12,98 ms  ->  0,97 ms
 *
 * `exp_orden` es el nombre de la expansión copiado en la propia carta. Ordenar
 * por una columna de la tabla de al lado obliga a SQLite a unirlo todo y
 * ordenarlo en memoria (USE TEMP B-TREE), y eso crece con el catálogo aunque
 * solo se pidan 60 filas. Con la clave aquí, el índice sirve y el LIMIT corta.
 *
 * `cartas_fts` es un índice de texto completo. Buscar con LIKE '%algo%' no
 * puede usar ningún índice —el comodín va delante—, así que cada búsqueda
 * recorría las 69.000 filas. Los disparadores lo mantienen al día solos.
 */
function migrar() {
  const columnas = db.prepare('PRAGMA table_info(cartas)').all().map((c) => c.name);
  if (!columnas.includes('exp_orden')) {
    db.exec('ALTER TABLE cartas ADD COLUMN exp_orden TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_cartas_expnum ON cartas(exp_orden, numero_orden, id)');

  /*
   * EL ORDEN DE ESTO IMPORTA Y COSTÓ UNA BASE DE DATOS CORRUPTA.
   *
   * Primero se rellena `exp_orden`, después se crea el índice de texto y se
   * puebla, y solo al final se ponen los disparadores.
   *
   * Al revés no funciona: el UPDATE que rellena la columna toca todas las
   * filas, y con los disparadores ya puestos cada una lanzaba un 'delete'
   * contra un índice todavía vacío. Un FTS5 de contenido externo no lo
   * tolera y la base pasó a dar "database disk image is malformed".
   */
  const sinClave = db.prepare('SELECT COUNT(*) c FROM cartas WHERE exp_orden IS NULL').get().c;
  if (sinClave) {
    db.exec(`UPDATE cartas SET exp_orden =
      (SELECT lower(e.nombre) FROM expansiones e WHERE e.set_code = cartas.set_code)
      WHERE exp_orden IS NULL`);
  }

  const hayFts = db.prepare(
    "SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='cartas_fts'").get().c;
  if (!hayFts) {
    db.exec(`CREATE VIRTUAL TABLE cartas_fts
             USING fts5(busca, content='cartas', content_rowid='rowid')`);
  }

  const enIndice = db.prepare('SELECT COUNT(*) c FROM cartas_fts').get().c;
  const enTabla = db.prepare('SELECT COUNT(*) c FROM cartas').get().c;
  if (enIndice !== enTabla) db.exec("INSERT INTO cartas_fts(cartas_fts) VALUES('rebuild')");

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS cartas_fts_ai AFTER INSERT ON cartas BEGIN
      INSERT INTO cartas_fts(rowid, busca) VALUES (new.rowid, new.busca);
    END;
    CREATE TRIGGER IF NOT EXISTS cartas_fts_ad AFTER DELETE ON cartas BEGIN
      INSERT INTO cartas_fts(cartas_fts, rowid, busca) VALUES ('delete', old.rowid, old.busca);
    END;
    CREATE TRIGGER IF NOT EXISTS cartas_fts_au AFTER UPDATE ON cartas BEGIN
      INSERT INTO cartas_fts(cartas_fts, rowid, busca) VALUES ('delete', old.rowid, old.busca);
      INSERT INTO cartas_fts(rowid, busca) VALUES (new.rowid, new.busca);
    END;
  `);

  if (sinClave || enIndice !== enTabla) db.exec('ANALYZE');
}
migrar();

/* Quita acentos y baja a minúsculas. La misma función se usa al guardar y al
   buscar, en servidor y en navegador, para que "pokemon" encuentre "Pokémon". */
const normaliza = (t) => String(t == null ? '' : t)
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const ahora = () => new Date().toISOString();

// Pequeño almacén clave-valor para el estado de la ingesta.
const leerEstado = (clave, pordefecto = null) => {
  const f = db.prepare('SELECT valor FROM ingesta WHERE clave = ?').get(clave);
  if (!f) return pordefecto;
  try { return JSON.parse(f.valor); } catch { return pordefecto; }
};
const guardarEstado = (clave, valor) => {
  db.prepare('INSERT INTO ingesta (clave, valor) VALUES (?, ?) ' +
             'ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
    .run(clave, JSON.stringify(valor));
};

module.exports = { db, normaliza, ahora, leerEstado, guardarEstado };

'use strict';
/*
 * Imágenes de las cartas.
 *
 * El endpoint de la API exige la clave, así que el navegador no puede pedir
 * las imágenes directamente: habría que mandarle la clave y quedaría a la
 * vista de cualquiera. Van por aquí, con la clave en el servidor.
 *
 * Y cada imagen gasta una petición de la cuota. Bajar las 68.227 a una por
 * petición serían 68 días. Por eso se guardan en disco para siempre: la
 * primera vez que alguien mira una carta cuesta una petición y no vuelve a
 * costar nada. La propia API lo bendice, responde con cache-control immutable.
 *
 * Aun así, abrir una página de álbum con nueve cartas nuevas son nueve
 * peticiones, y un álbum de veinte páginas se come la cuota de dos horas. De
 * ahí el precargador: deja el servidor bajando una expansión entera poco a
 * poco, en segundo plano, sin que nadie tenga que esperar mirando.
 */
const fs = require('fs');
const path = require('path');
const api = require('./api');
const { db, leerEstado, guardarEstado, ahora } = require('./db');

const RAIZ = path.join(__dirname, '..', 'data', 'imagenes');
const TAMANOS = ['low', 'high'];

const seguro = (id) => /^[A-Za-z0-9_-]{4,200}$/.test(String(id || ''));

/* Los ficheros se reparten en carpetas por los primeros caracteres del id.
   Sesenta y ocho mil ficheros en un solo directorio hacen lento cualquier
   listado y algunos sistemas de ficheros se atragantan. */
function ruta(id, tamano, ext = 'jpg') {
  const t = TAMANOS.includes(tamano) ? tamano : 'low';
  const limpio = String(id).replace(/^pk_/, '');
  return path.join(RAIZ, t, limpio.slice(0, 2), `${id}.${ext}`);
}

/*
 * La API no devuelve siempre JPEG: bastantes cartas vienen en PNG. Guardarlas
 * todas con extension .jpg y anunciarlas como image/jpeg es mentir sobre el
 * contenido, y con X-Content-Type-Options: nosniff puesto en nginx eso es
 * pedir problemas. Asi que el tipo se deduce de los bytes de cabecera y el
 * fichero se guarda con la extension que le toca.
 */
const EXTENSIONES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

function tipoDe(datos) {
  if (datos[0] === 0xFF && datos[1] === 0xD8) return 'jpg';
  if (datos[0] === 0x89 && datos[1] === 0x50 && datos[2] === 0x4E) return 'png';
  if (datos[0] === 0x47 && datos[1] === 0x49 && datos[2] === 0x46) return 'gif';
  if (datos.length > 12 && datos.slice(0, 4).toString('latin1') === 'RIFF' &&
      datos.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/* Devuelve la ruta del fichero que hay en disco, sea cual sea su formato, o
   null si no hay ninguno. */
function enDisco(id, tamano) {
  for (const ext of Object.keys(EXTENSIONES)) {
    const r = ruta(id, tamano, ext);
    try { if (fs.statSync(r).size > 0) return r; } catch {}
  }
  return null;
}

// Evita que diez visitas simultáneas a la misma carta gasten diez peticiones.
const enVuelo = new Map();

async function asegurar(id, tamano = 'low') {
  if (!seguro(id)) throw Object.assign(new Error('Identificador de carta no válido'), { status: 400 });
  const ya = enDisco(id, tamano);
  if (ya) return ya;

  const llave = `${id}|${tamano}`;
  if (enVuelo.has(llave)) return enVuelo.get(llave);

  const tarea = (async () => {
    const datos = await api.imagen(id, tamano);
    const ext = tipoDe(datos);
    if (!ext) throw Object.assign(new Error('La API devolvió algo que no es una imagen'), { status: 502 });
    const destino = ruta(id, tamano, ext);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    // Temporal y renombrado: si el proceso muere a media escritura no queda
    // una imagen truncada que luego se sirva para siempre desde la caché.
    const tmp = `${destino}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, datos);
    fs.renameSync(tmp, destino);
    db.prepare('UPDATE cartas SET imagen_local = 1 WHERE id = ? AND imagen_local = 0').run(id);
    return destino;
  })().finally(() => enVuelo.delete(llave));

  enVuelo.set(llave, tarea);
  return tarea;
}

// El tipo que hay que anunciar al servir un fichero ya guardado.
const tipoDeRuta = (fichero) =>
  EXTENSIONES[String(fichero).split('.').pop().toLowerCase()] || 'application/octet-stream';

/* Alta manual, para las cartas que la API no tiene o trae mal. Es lo que pidió
   el usuario: "si no hay imágenes, añadirlas manualmente". Se marca con un 2
   para no confundirla con la bajada y para que el precargador no la pise. */
function guardarManual(id, tamano, datos) {
  if (!seguro(id)) throw Object.assign(new Error('Identificador de carta no válido'), { status: 400 });
  const ext = tipoDe(datos);
  if (!ext) throw Object.assign(new Error('Eso no es una imagen que se pueda reconocer.'), { status: 415 });
  // Si ya había una en otro formato, se quita: si no, quedarían dos y ganaría
  // la primera que encontrase enDisco().
  for (const e of Object.keys(EXTENSIONES)) { try { fs.unlinkSync(ruta(id, tamano, e)); } catch {} }
  const destino = ruta(id, tamano, ext);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, datos);
  fs.renameSync(tmp, destino);
  db.prepare('UPDATE cartas SET imagen_local = 2 WHERE id = ?').run(id);
  return destino;
}

const borrar = (id) => {
  for (const t of TAMANOS) {
    for (const e of Object.keys(EXTENSIONES)) { try { fs.unlinkSync(ruta(id, t, e)); } catch {} }
  }
  db.prepare('UPDATE cartas SET imagen_local = 0 WHERE id = ?').run(id);
};

// ── Precargador ────────────────────────────────────────────────────────────

const CLAVE = 'precarga';
const PAUSA = 1500;
let temporizador = null;
let corriendo = false;

const estado = () => ({
  activo: false, ambito: 'set', setCode: null, usuarioId: null,
  tamano: 'low', hechas: 0, total: 0,
  mensaje: 'Parado', ultimo: null, ...(leerEstado(CLAVE) || {}),
});
const guardar = (p) => {
  const e = { ...estado(), ...p, ultimo: ahora() };
  guardarEstado(CLAVE, e);
  return e;
};

const pendientesDe = (setCode) =>
  db.prepare('SELECT id FROM cartas WHERE set_code = ? AND imagen_local = 0 ORDER BY numero_orden')
    .all(setCode).map((r) => r.id);

/*
 * Las cartas de un usuario: las que tiene o desea, más las que ha colocado en
 * sus álbumes. Es lo que de verdad va a mirar, así que es lo que compensa
 * tener en disco antes de que abra la página, y son pocas —ciento y pico
 * frente a las 22.000 del catálogo—, así que cabe de sobra en la cuota de un
 * día. Una carta puede estar en la colección y además en un álbum: DISTINCT.
 */
const pendientesDeColeccion = (usuarioId) =>
  db.prepare(`SELECT DISTINCT c.id FROM cartas c
     WHERE c.imagen_local = 0
       AND (c.id IN (SELECT carta_id FROM coleccion WHERE usuario_id = @u)
         OR c.id IN (SELECT s.carta_id FROM binder_slots s
                     JOIN binders b ON b.id = s.binder_id
                     WHERE b.usuario_id = @u AND s.carta_id IS NOT NULL))
     ORDER BY c.set_code, c.numero_orden`).all({ u: usuarioId }).map((r) => r.id);

// Qué queda por bajar, según lo que se esté precargando.
const pendientesActuales = (e) =>
  e.ambito === 'coleccion' ? pendientesDeColeccion(e.usuarioId) : pendientesDe(e.setCode);

// Lo que se enseña en el panel mientras corre.
const rotulo = (e) => (e.ambito === 'coleccion' ? 'Colección' : e.setCode);

async function cicloPrecarga() {
  if (corriendo) return;
  corriendo = true;
  try {
    let e = estado();
    if (!e.activo || (e.ambito === 'coleccion' ? !e.usuarioId : !e.setCode)) return;
    const pend = pendientesActuales(e).filter((id) => !enDisco(id, e.tamano));   // enDisco devuelve ruta o null
    if (!pend.length) {
      guardar({ activo: false, mensaje: `Listo: ${rotulo(e)} ya tiene todas sus imágenes` });
      return;
    }
    for (const id of pend) {
      if (!estado().activo) return;
      await asegurar(id, e.tamano);
      e = guardar({ hechas: e.hechas + 1, total: e.total || pend.length,
                    mensaje: `${rotulo(e)}: ${e.hechas + 1} de ${e.total || pend.length}` });
      await new Promise((r) => setTimeout(r, PAUSA));
    }
    guardar({ activo: false, mensaje: `Terminado: ${rotulo(e)}` });
  } catch (err) {
    if (err instanceof api.SinCuota) {
      guardar({ mensaje: 'Sin cuota; sigue cuando la API dé margen' });
      reprogramar(10 * 60 * 1000);
    } else {
      guardar({ mensaje: 'Error: ' + String(err.message || err).slice(0, 160) });
      reprogramar(60 * 1000);
    }
  } finally {
    corriendo = false;
  }
}

function reprogramar(ms) {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { cicloPrecarga().catch(() => {}); }, ms);
  if (temporizador.unref) temporizador.unref();
}

function precargar(setCode, tamano = 'low') {
  const total = pendientesDe(setCode).length;
  const e = guardar({ activo: true, ambito: 'set', setCode, usuarioId: null,
                      tamano: TAMANOS.includes(tamano) ? tamano : 'low',
                      hechas: 0, total, mensaje: `${setCode}: ${total} imágenes por bajar` });
  reprogramar(50);
  return e;
}

function precargarColeccion(usuarioId, tamano = 'low') {
  const total = pendientesDeColeccion(usuarioId).length;
  const e = guardar({ activo: true, ambito: 'coleccion', setCode: null, usuarioId,
                      tamano: TAMANOS.includes(tamano) ? tamano : 'low',
                      hechas: 0, total, mensaje: `Colección: ${total} imágenes por bajar` });
  reprogramar(50);
  return e;
}

const pararPrecarga = () => { clearTimeout(temporizador); return guardar({ activo: false, mensaje: 'Precarga parada' }); };
const reanudarPrecarga = () => { if (estado().activo) reprogramar(5000); return estado(); };

const cuantasEnDisco = () =>
  db.prepare('SELECT COUNT(*) c FROM cartas WHERE imagen_local > 0').get().c;

module.exports = {
  RAIZ, TAMANOS, EXTENSIONES, tipoDe, tipoDeRuta, ruta, enDisco, asegurar, guardarManual, borrar,
  precargar, precargarColeccion, pararPrecarga, reanudarPrecarga, estado, cuantasEnDisco, seguro,
};

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

/* Evita que diez visitas simultáneas a la misma carta gasten diez peticiones.
   Si coinciden la precarga y alguien mirando esa misma carta, comparten la
   petición con la reserva del que llegó primero. Da igual: es una sola
   petición para los dos y el resultado es el mismo fichero. */
const enVuelo = new Map();

async function asegurar(id, tamano = 'low', opciones = {}) {
  if (!seguro(id)) throw Object.assign(new Error('Identificador de carta no válido'), { status: 400 });
  const ya = enDisco(id, tamano);
  if (ya) return ya;

  const llave = `${id}|${tamano}`;
  if (enVuelo.has(llave)) return enVuelo.get(llave);

  const tarea = (async () => {
    const datos = await api.imagen(id, tamano, opciones);
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

/*
 * Qué significa cartas.imagen_local:
 *   0   por bajar
 *   1   bajada de la API y en disco
 *   2   subida a mano (ver abajo)
 *  -1   la API no tiene imagen de esa carta; no se vuelve a pedir sola
 *
 * Alta manual, para las cartas que la API no tiene o trae mal. Es lo que pidió
 * el usuario: "si no hay imágenes, añadirlas manualmente". Se marca con un 2
 * para no confundirla con la bajada y para que el precargador no la pise.
 */
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

// Suelo entre peticiones: por rápido que fuese el plan, no se ametralla la API.
const PAUSA = 1500;

/*
 * Cada cuánto se baja una imagen.
 *
 * Antes era PAUSA fija, o sea cuarenta imágenes por minuto, y a ese ritmo el
 * cupo del día —1.000 peticiones, una por imagen— se funde en veinticinco
 * minutos seguidos. Medido el 4 de agosto: 960 imágenes bajadas entre las
 * 09:00 y las 09:49 y la cuota a cero el resto del día, así que quien entrase
 * por la tarde a mirar una carta que no estuviera ya en disco se quedaba sin
 * imagen hasta el día siguiente.
 *
 * Correr no adelanta nada: el techo son las peticiones al día, no la
 * velocidad, y el catálogo entero tarda las mismas semanas si se reparte. Así
 * que se reparte, y a cualquier hora queda cuota libre.
 *
 * El ritmo sale de los límites que la propia API declara, no de un número
 * escrito aquí, para que siga valiendo si cambia el plan: el cupo del día
 * menos la reserva, repartido entre 24 horas, y sin pasarse nunca del techo
 * de la hora. Con el plan gratuito son 985/24 ≈ 41 por hora, una imagen cada
 * 88 segundos.
 */
function cadencia() {
  const c = api.cuotaActual();
  const dia = Math.max((c.limiteDia || 1000) - api.RESERVA_PRECARGA, 1);
  const hora = Math.max((c.limiteHora || 100) - api.RESERVA_PRECARGA, 1);
  return Math.max(Math.round(3600e3 / Math.min(dia / 24, hora)), PAUSA);
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let temporizador = null;
let corriendo = false;

const estado = () => ({
  activo: false, ambito: 'set', setCode: null, usuarioId: null,
  tamano: 'low', hechas: 0, total: 0, fallidas: 0,
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

/*
 * El catálogo entero, a tandas. Aquí no se pueden pedir las 29.000 de golpe:
 * la lista se filtra después contra el disco con un statSync por carta y por
 * formato, y eso con el catálogo completo son cientos de miles de llamadas
 * cada vez que el ciclo arranca. Con la cuota en 100 por hora, una tanda de
 * 500 sobra para cualquier ventana; cuando se acaba, el ciclo pide la
 * siguiente.
 */
const TANDA_CATALOGO = 500;
const pendientesDeCatalogo = () =>
  db.prepare(`SELECT id FROM cartas WHERE imagen_local = 0
     ORDER BY set_code, numero_orden LIMIT ${TANDA_CATALOGO}`).all().map((r) => r.id);

const cuantasPendientesCatalogo = () =>
  db.prepare('SELECT COUNT(*) c FROM cartas WHERE imagen_local = 0').get().c;

// Qué queda por bajar, según lo que se esté precargando.
const pendientesActuales = (e) =>
  e.ambito === 'coleccion' ? pendientesDeColeccion(e.usuarioId)
  : e.ambito === 'catalogo' ? pendientesDeCatalogo()
  : pendientesDe(e.setCode);

// Lo que se enseña en el panel mientras corre.
const ROTULOS = { coleccion: 'Colección', catalogo: 'Catálogo' };
const rotulo = (e) => ROTULOS[e.ambito] || e.setCode;

async function cicloPrecarga() {
  if (corriendo) return;
  corriendo = true;
  try {
    let e = estado();
    const sinDestino = e.ambito === 'coleccion' ? !e.usuarioId
                     : e.ambito === 'catalogo' ? false
                     : !e.setCode;
    if (!e.activo || sinDestino) return;
    const pend = pendientesActuales(e).filter((id) => !enDisco(id, e.tamano));   // enDisco devuelve ruta o null
    if (!pend.length) {
      guardar({ activo: false, mensaje: `Listo: ${rotulo(e)} ya tiene todas sus imágenes` });
      return;
    }
    /* El ámbito con el que arrancó este ciclo. `e` se reescribe con lo que hay
       en la base cada vez que se guarda el progreso, así que no vale para
       saber si alguien ha cambiado de precarga por debajo: eso se compara
       contra esta copia. */
    const destino = { ambito: e.ambito, setCode: e.setCode,
                      usuarioId: e.usuarioId, tamano: e.tamano };
    for (const id of pend) {
      const enCurso = estado();
      if (!enCurso.activo) return;
      /*
       * Con el cupo repartido por el día, entre imagen e imagen pasan minutos,
       * y en ese hueco cabe de sobra que el administrador arranque otra
       * precarga desde el panel. Si pasa, este ciclo se retira y deja sitio al
       * nuevo: sin esto seguiría bajando el catálogo mientras el estado dice
       * "colección", y encima el ciclo nuevo se moriría nada más entrar al ver
       * `corriendo` en true, sin que nadie volviera a programarlo.
       */
      if (enCurso.ambito !== destino.ambito || enCurso.setCode !== destino.setCode ||
          enCurso.usuarioId !== destino.usuarioId || enCurso.tamano !== destino.tamano) {
        reprogramar(50);
        return;
      }
      try {
        await asegurar(id, destino.tamano, { reserva: api.RESERVA_PRECARGA });
      } catch (err) {
        if (err instanceof api.SinCuota) throw err;   // eso lo lleva el catch de fuera
        /*
         * La API no tiene la imagen de esa carta (404, y algún 5xx suelto).
         * Sin esto la precarga se quedaba clavada: el error la hacía esperar un
         * minuto, la misma carta volvía a salir la primera en la lista de
         * pendientes y volvía a fallar, gastando una petición por minuto sin
         * avanzar nunca ni terminar. Se marca con -1 —ni 0 "por bajar" ni >0
         * "está en disco"— y se sigue con la siguiente.
         */
        db.prepare('UPDATE cartas SET imagen_local = -1 WHERE id = ? AND imagen_local = 0').run(id);
        e = guardar({ fallidas: (e.fallidas || 0) + 1, total: e.total || pend.length,
                      mensaje: `${rotulo(e)}: sin imagen en la API, ` +
                               `${e.hechas} de ${e.total || pend.length} y sigo` });
        await espera(cadencia());
        continue;
      }
      e = guardar({ hechas: e.hechas + 1, total: e.total || pend.length,
                    mensaje: `${rotulo(e)}: ${e.hechas + 1} de ${e.total || pend.length}` });
      await espera(cadencia());
    }
    /* El catálogo va por tandas: agotada una, quedan más y hay que seguir.
       Sin esto la precarga se daría por terminada cada 500 cartas. */
    if (e.ambito === 'catalogo' && cuantasPendientesCatalogo()) {
      guardar({ mensaje: `Catálogo: ${e.hechas} bajadas, ` +
                         `quedan ${cuantasPendientesCatalogo()}` });
      reprogramar(cadencia());
      return;
    }

    const fin = estado();
    guardar({ activo: false, mensaje: `Terminado: ${rotulo(e)}` +
      (fin.fallidas ? ` · ${fin.fallidas} sin imagen en la API` : '') });
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
                      hechas: 0, fallidas: 0, total,
                      mensaje: `${setCode}: ${total} imágenes por bajar` });
  reprogramar(50);
  return e;
}

function precargarColeccion(usuarioId, tamano = 'low') {
  const total = pendientesDeColeccion(usuarioId).length;
  const e = guardar({ activo: true, ambito: 'coleccion', setCode: null, usuarioId,
                      tamano: TAMANOS.includes(tamano) ? tamano : 'low',
                      hechas: 0, fallidas: 0, total,
                      mensaje: `Colección: ${total} imágenes por bajar` });
  reprogramar(50);
  return e;
}

/*
 * Todas las que falten, en segundo plano y sin fecha. A una petición por
 * imagen y 1.000 al día son semanas: no es una tarea que se espere mirando,
 * es dejar el servidor llenando la caché con la cuota que sobre. Se para
 * cuando se quiera y sigue donde iba, porque lo que ya está en disco no se
 * vuelve a pedir.
 */
function precargarCatalogo(tamano = 'low') {
  const total = cuantasPendientesCatalogo();
  const e = guardar({ activo: true, ambito: 'catalogo', setCode: null, usuarioId: null,
                      tamano: TAMANOS.includes(tamano) ? tamano : 'low',
                      hechas: 0, fallidas: 0, total,
                      mensaje: `Catálogo: ${total} imágenes por bajar` });
  reprogramar(50);
  return e;
}

const pararPrecarga = () => { clearTimeout(temporizador); return guardar({ activo: false, mensaje: 'Precarga parada' }); };
const reanudarPrecarga = () => { if (estado().activo) reprogramar(5000); return estado(); };

const cuantasEnDisco = () =>
  db.prepare('SELECT COUNT(*) c FROM cartas WHERE imagen_local > 0').get().c;

module.exports = {
  RAIZ, TAMANOS, EXTENSIONES, tipoDe, tipoDeRuta, ruta, enDisco, asegurar, guardarManual, borrar,
  precargar, precargarColeccion, precargarCatalogo, pararPrecarga, reanudarPrecarga,
  estado, cuantasEnDisco, seguro,
};

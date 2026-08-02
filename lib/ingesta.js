'use strict';
/*
 * Bajada del catálogo.
 *
 * Lo importante, y lo que costó descubrir: los dos endpoints que devuelven
 * cartas NO devuelven lo mismo.
 *
 *   /sets/:code     lista completa y fiable de la expansión, pero con el
 *                   array de precios VACÍO. Comprobado: 69 cartas de Hidden
 *                   Fates, 0 con precio.
 *   /search?q=...   trae los precios de Cardmarket y de TCGplayer, pero
 *                   ordena por relevancia y su tope de página es 100, no 200.
 *
 * Como los precios son medio proyecto, la bajada va por /search buscando el
 * nombre de cada expansión: en una sola pasada se consigue la carta y su
 * precio. Ojo con el nombre: hay que quitarle el prefijo del código (ver
 * terminoBusqueda) o la búsqueda no devuelve nada, y si aun así no aparece
 * ninguna carta de la expansión se cae al listado de /sets/:code, que no trae
 * precios pero no se deja la expansión vacía.
 *
 * Lo que devuelve la búsqueda puede incluir cartas de otras
 * expansiones —buscar "Hidden Fates" también saca las del Shiny Vault—, así
 * que cada carta se coloca en la expansión que dice su propio set_id y no en
 * la que se estaba buscando. Esas cartas de más no sobran: se guardan igual y
 * ahorran peticiones futuras.
 *
 * Números: 34.014 cartas en inglés a 100 por página son unas 341 peticiones,
 * y con 100 por hora eso son unas cuatro horas. Por eso esto es un trabajo de
 * fondo reanudable y nunca una espera dentro de una petición del navegador.
 */
const api = require('./api');
const { db, leerEstado, guardarEstado, ahora, normaliza } = require('./db');
const Card = require('../models/Card');

const CLAVE = 'trabajo';
const ESPERA_SIN_CUOTA = 10 * 60 * 1000;
const PAUSA_ENTRE = 1200;
const POR_PAGINA = 100;          // tope real de /search
const PAGINAS_DE_MAS = 2;        // margen sobre lo que dice card_count
const POR_PAGINA_LISTADO = 200;  // tope de /sets/:code

/*
 * El nombre de la expansión no vale tal cual como término de búsqueda. Muchos
 * vienen con el código delante —"SV02: Paldea Evolved"— y ese prefijo no
 * aparece en los datos de las cartas, así que /search devolvía cero y la
 * expansión entera se quedaba vacía sin que nada lo avisara.
 *
 * Medido contra la API:
 *   "SV02: Paldea Evolved"  ->    0 resultados
 *   "Paldea Evolved"        ->  280, 99 de cada 100 del set y con precio
 *
 * Así se quedaron a cero Paldea Evolved, Fusion Strike, Surging Sparks,
 * Evolving Skies y otras 60 expansiones.
 */
const terminoBusqueda = (nombre) => {
  const limpio = String(nombre || '').replace(/^[A-Za-z0-9&\-\/]{1,8}:\s*/, '').trim();
  return limpio || String(nombre || '');
};

let temporizador = null;
let corriendo = false;

const estadoInicial = () => ({
  activo: false, fase: 'parado', idiomas: ['eng'], modo: 'completo',
  indiceSet: 0, pagina: 1, setsTotales: 0, via: 'busqueda',
  cartasGuardadas: 0, conPrecio: 0, peticiones: 0,
  mensaje: 'Sin arrancar', error: null,
  iniciado: null, ultimo: null, terminado: null,
});

const estado = () => ({ ...estadoInicial(), ...(leerEstado(CLAVE) || {}) });
const guardar = (parcial) => {
  const e = { ...estado(), ...parcial, ultimo: ahora() };
  guardarEstado(CLAVE, e);
  return e;
};

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * A qué expansión pertenece una carta. Los distintos endpoints rellenan estos
 * campos de forma distinta —en /sets/:code el card_info.set_code trae en
 * realidad el set_id numérico—, así que se prueban todas las vías antes de
 * darse por vencido. La consulta que se estaba haciendo es el último recurso.
 */
const cacheSets = new Map();
function resolverSet(info, porDefecto) {
  const claves = [info.set_id, info.set_code, info.set_name].filter(Boolean).map(String);
  for (const k of claves) {
    if (cacheSets.has(k)) return cacheSets.get(k);
  }
  for (const k of claves) {
    const f = db.prepare(`SELECT set_code FROM expansiones
      WHERE set_id = ? OR set_code = ? OR nombre = ? LIMIT 1`).get(k, k, k);
    if (f) { cacheSets.set(k, f.set_code); return f.set_code; }
  }
  // Nombres como "SM6a: Dragon Storm" frente a "Dragon Storm".
  if (info.set_name) {
    const f = db.prepare('SELECT set_code FROM expansiones WHERE busca LIKE ? LIMIT 1')
      .get('%' + normaliza(info.set_name) + '%');
    if (f) { cacheSets.set(String(info.set_name), f.set_code); return f.set_code; }
  }
  return porDefecto;
}

function expansionesPendientes(idiomas) {
  const marcas = idiomas.map(() => '?').join(',');
  return db.prepare(`SELECT set_code, set_id, nombre, total_cartas, cartas_bajadas
    FROM expansiones WHERE idioma IN (${marcas})
    ORDER BY fecha_orden IS NULL, fecha_orden DESC, nombre`).all(...idiomas);
}

/* Guarda un lote de cartas repartiéndolas por su expansión real. Devuelve
   cuántas cayeron en la expansión que se estaba buscando, que es lo que sirve
   para saber cuándo parar de pedir páginas. */
function repartir(cartas, setCodePorDefecto) {
  const porSet = new Map();
  for (const c of cartas) {
    const destino = resolverSet(c.card_info || {}, setCodePorDefecto);
    if (!destino) continue;
    if (!porSet.has(destino)) porSet.set(destino, []);
    porSet.get(destino).push(c);
  }
  let guardadas = 0, delBuscado = 0, conPrecio = 0;
  for (const [setCode, lote] of porSet) {
    Card.guardarLote(setCode, lote);
    guardadas += lote.length;
    if (setCode === setCodePorDefecto) delBuscado += lote.length;
    conPrecio += lote.filter((c) => ((c.cardmarket || {}).prices || []).length).length;
  }
  return { guardadas, delBuscado, conPrecio, tocados: [...porSet.keys()] };
}

const contarBajadas = (setCode) =>
  db.prepare('UPDATE expansiones SET cartas_bajadas = (SELECT COUNT(*) FROM cartas WHERE set_code = ?) WHERE set_code = ?')
    .run(setCode, setCode);

async function ciclo() {
  if (corriendo) return;
  corriendo = true;
  try {
    let e = estado();
    if (!e.activo) return;

    // Fase 1: las 857 expansiones en una sola petición.
    if (e.fase === 'expansiones' || !e.setsTotales) {
      const r = await api.listarExpansiones();
      const sets = r.data || r;
      Card.guardarExpansiones(sets);
      cacheSets.clear();
      const pend = expansionesPendientes(e.idiomas);
      e = guardar({
        fase: 'cartas', setsTotales: pend.length, peticiones: e.peticiones + 1,
        mensaje: `${sets.length} expansiones; a bajar ${pend.length} en ${e.idiomas.join(', ')}`,
      });
    }

    const pendientes = expansionesPendientes(e.idiomas);
    while (e.activo && e.indiceSet < pendientes.length) {
      const exp = pendientes[e.indiceSet];

      // En modo "solo precios" se saltan las que aún no tienen cartas: no hay
      // nada que actualizar y gastarían cuota para nada.
      if (e.modo === 'precios' && !exp.cartas_bajadas) {
        e = guardar({ indiceSet: e.indiceSet + 1, pagina: 1 });
        continue;
      }

      /* En modo "faltantes" se saltan las que ya están enteras. Sirve para
         rellenar lo que quedó a medias sin volver a pagar por el catálogo
         entero. El contador se sincroniza al arrancar, así que es de fiar. */
      if (e.modo === 'faltantes' && exp.total_cartas && exp.cartas_bajadas >= exp.total_cartas) {
        e = guardar({ indiceSet: e.indiceSet + 1, pagina: 1 });
        continue;
      }

      /*
       * Dos vías. La búsqueda trae los precios y es la buena; el listado del
       * set es fiable pero viene sin precios, y solo se usa cuando la búsqueda
       * no encuentra ni una carta de la expansión.
       */
      const porListado = e.via === 'listado';
      const limite = porListado ? POR_PAGINA_LISTADO : POR_PAGINA;
      const r = porListado
        ? await api.cartasDeExpansion(exp.set_code, e.pagina, limite)
        : await api.buscar(terminoBusqueda(exp.nombre), limite, e.pagina);
      const cartas = r.results || r.cards || [];
      const { guardadas, delBuscado, conPrecio, tocados } = repartir(cartas, exp.set_code);
      for (const s of tocados) contarBajadas(s);

      const pg = r.pagination || {};

      /* La búsqueda no ha dado nada de esta expansión: se reintenta por el
         listado antes de darla por perdida. Tener la carta sin precio es mejor
         que no tenerla; los precios los recupera luego el modo "precios". */
      if (!porListado && e.pagina === 1 && delBuscado === 0) {
        e = guardar({
          via: 'listado', pagina: 1, peticiones: e.peticiones + 1,
          cartasGuardadas: e.cartasGuardadas + guardadas,
          conPrecio: e.conPrecio + conPrecio,
          mensaje: exp.nombre + ': la búsqueda no da nada suyo, se baja por listado',
        });
        await espera(PAUSA_ENTRE);
        e = estado();
        continue;
      }

      const techo = Math.ceil((exp.total_cartas || limite) / limite) + PAGINAS_DE_MAS;
      // Se para cuando la API dice que no hay más, cuando ya se ha pedido más
      // de lo que esta expansión puede dar, o cuando una página entera no
      // aportó ninguna carta suya: seguir sería pagar por relevancia ajena.
      const ultima = !cartas.length ||
        (pg.total_pages && e.pagina >= pg.total_pages) ||
        e.pagina >= techo ||
        (!porListado && delBuscado === 0 && e.pagina > 1);

      e = guardar({
        cartasGuardadas: e.cartasGuardadas + guardadas,
        conPrecio: e.conPrecio + conPrecio,
        peticiones: e.peticiones + 1,
        indiceSet: ultima ? e.indiceSet + 1 : e.indiceSet,
        pagina: ultima ? 1 : e.pagina + 1,
        via: ultima ? 'busqueda' : e.via,
        mensaje: `${exp.nombre} · pág. ${e.pagina}${pg.total_pages ? '/' + Math.min(pg.total_pages, techo) : ''} · ` +
                 `${e.cartasGuardadas + guardadas} cartas, ${e.conPrecio + conPrecio} con precio`,
      });
      if (ultima) contarBajadas(exp.set_code);

      await espera(PAUSA_ENTRE);
      e = estado();
    }

    if (e.activo && e.indiceSet >= pendientes.length) {
      /* cartasGuardadas suma filas procesadas, y como guardarLote es un upsert
         cuenta dos veces la carta que reaparece en otra búsqueda. Para el
         mensaje final se miran las filas que hay de verdad. */
      const reales = db.prepare('SELECT COUNT(*) c FROM cartas').get().c;
      guardar({ activo: false, fase: 'terminado', terminado: ahora(),
        mensaje: `Terminado: ${reales} cartas en la base (${e.cartasGuardadas} escrituras, ` +
                 `${e.conPrecio} con precio) en ${e.peticiones} peticiones` });
    }
  } catch (err) {
    if (err instanceof api.SinCuota) {
      guardar({ fase: 'esperando', error: null,
        mensaje: 'Sin cuota; reanuda en cuanto la API vuelva a dar margen' });
      programar(ESPERA_SIN_CUOTA);
    } else {
      guardar({ fase: 'reintentando', error: String(err.message || err),
        mensaje: 'Error, se reintenta en un minuto: ' + String(err.message || err).slice(0, 160) });
      programar(60 * 1000);
    }
  } finally {
    corriendo = false;
  }
}

function programar(ms) {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { ciclo().catch(() => {}); }, ms);
  if (temporizador.unref) temporizador.unref();
}

const MODOS = ['completo', 'precios', 'faltantes'];

/* Los contadores por expansión se desincronizan: contarBajadas() solo repasaba
   la expansión en curso, y no las que reciben cartas de rebote al repartir. El
   modo "faltantes" decide a partir de ellos, así que se recalculan enteros
   antes de empezar. Son 772 filas, cuesta milisegundos. */
const sincronizarContadores = () =>
  db.prepare(`UPDATE expansiones SET cartas_bajadas =
    (SELECT COUNT(*) FROM cartas WHERE cartas.set_code = expansiones.set_code)`).run();

function arrancar({ idiomas = ['eng'], desdeCero = false, modo = 'completo' } = {}) {
  const e = estado();
  if (e.activo && e.fase !== 'esperando') return e;
  sincronizarContadores();
  const nuevo = guardar({
    activo: true,
    fase: desdeCero || !e.setsTotales ? 'expansiones' : 'cartas',
    idiomas: Array.isArray(idiomas) && idiomas.length ? idiomas : ['eng'],
    modo: MODOS.includes(modo) ? modo : 'completo',
    indiceSet: desdeCero ? 0 : e.indiceSet,
    pagina: desdeCero ? 1 : e.pagina,
    via: desdeCero ? 'busqueda' : e.via,
    cartasGuardadas: desdeCero ? 0 : e.cartasGuardadas,
    conPrecio: desdeCero ? 0 : e.conPrecio,
    peticiones: desdeCero ? 0 : e.peticiones,
    error: null, terminado: null,
    iniciado: desdeCero || !e.iniciado ? ahora() : e.iniciado,
    mensaje: 'Arrancando…',
  });
  programar(50);
  return nuevo;
}

const parar = () => {
  clearTimeout(temporizador);
  return guardar({ activo: false, fase: 'parado', mensaje: 'Parado a mano' });
};

/* Si el servicio se reinicia en mitad de cuatro horas de bajada, sigue solo.
   Sin esto un `systemctl restart` la dejaría a medias y en silencio. */
function reanudarSiHacia() {
  const e = estado();
  if (e.activo) programar(3000);
  return e;
}

module.exports = { arrancar, parar, estado, reanudarSiHacia, expansionesPendientes, resolverSet };

'use strict';
/*
 * Mejora de imágenes contra TCGdex.
 *
 * Mismo patrón que lib/ingesta.js: trabajo de fondo, reanudable, con su
 * estado en la tabla `ingesta` (clave aparte) para sobrevivir a un reinicio
 * del servicio. La diferencia es la fuente: esto no toca la cuota de
 * PokeWallet para nada, habla con TCGdex, que es pública y no la tiene tan
 * ajustada — por eso el ritmo lo pone un pausa fija (tcgdex.ESPERA_MS) y no
 * un contador de cuota que vigilar.
 *
 * El emparejamiento con TCGdex (expansiones.tcgdex_set_id/tcgdex_lang) ya
 * está hecho — ver herramientas/emparejar-colecciones.js —, así que aquí solo
 * se procesan las expansiones que SÍ tienen pareja encontrada; las que no, se
 * quedan sin tocar, no es un fallo de esto.
 *
 * Dentro de cada expansión, el emparejamiento de cada carta es por número
 * (numero/localId): el de set+número es justo el mismo que usan las bases de
 * datos de TCG de verdad para decir "es la misma carta", y es muchísimo más
 * fiable que comparar imágenes a ciegas.
 *
 * Solo se sustituye si el área en píxeles de la nueva imagen es mayor que la
 * que ya hay: esto es "mejorar", nunca "cambiar porque sí".
 */
const fs = require('fs');
const path = require('path');
const { db, leerEstado, guardarEstado, ahora } = require('./db');
const tcgdex = require('./tcgdex');
const { dimensiones } = require('./dimensiones');

const CLAVE = 'mejora_imagenes';
// 'low', no 'high': el front nunca pide ?size=high (ver routes/collection.js),
// así que escribir en 'high' no se veía nunca. 'low' es el tamaño que de
// verdad sirve la app, aunque el nombre de la carpeta ya no describa bien
// lo que hay dentro tras esta mejora.
const RAIZ = path.join(__dirname, '..', 'data', 'imagenes', 'low');
const EXTENSIONES = ['jpg', 'png', 'gif', 'webp'];

let temporizador = null;
let corriendo = false;

const estadoInicial = () => ({
  activo: false, indiceSet: 0, setsTotales: 0,
  cartasRevisadas: 0, cartasMejoradas: 0,
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

// De más reciente a más antigua, y solo las que tienen con qué compararse.
const listaOrdenada = () => db.prepare(`
  SELECT set_code, nombre, tcgdex_set_id, tcgdex_lang
  FROM expansiones
  WHERE tcgdex_set_id IS NOT NULL
  ORDER BY fecha_orden IS NULL, fecha_orden DESC, nombre`).all();

const marcarSet = db.prepare(`
  INSERT INTO mejora_imagenes (set_code, estado, cartas_revisadas, cartas_mejoradas, error, actualizado)
  VALUES (@set_code, @estado, @revisadas, @mejoradas, @error, @t)
  ON CONFLICT(set_code) DO UPDATE SET
    estado = excluded.estado, cartas_revisadas = excluded.cartas_revisadas,
    cartas_mejoradas = excluded.cartas_mejoradas, error = excluded.error, actualizado = excluded.actualizado`);

const rutaLocal = (id, ext) => {
  const limpio = String(id).replace(/^pk_/, '');
  return path.join(RAIZ, limpio.slice(0, 2), `${id}.${ext}`);
};

function ficheroLocal(id) {
  for (const ext of EXTENSIONES) {
    const r = rutaLocal(id, ext);
    try { if (fs.statSync(r).size > 0) return r; } catch { /* no está en ese formato */ }
  }
  return null;
}

function tipoDe(datos) {
  if (datos[0] === 0xFF && datos[1] === 0xD8) return 'jpg';
  if (datos[0] === 0x89 && datos[1] === 0x50) return 'png';
  if (datos.length > 12 && datos.slice(0, 4).toString('latin1') === 'RIFF' &&
      datos.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return 'jpg';
}

// "071/081" y "071" son la misma carta; el total tras la barra no pinta nada.
const numeroLimpio = (n) => String(n || '').split('/')[0].replace(/^0+(?=\d)/, '');

async function procesarSet(exp) {
  let detalle;
  try {
    detalle = await tcgdex.detalleSet(exp.tcgdex_lang, exp.tcgdex_set_id);
  } catch (err) {
    marcarSet.run({ set_code: exp.set_code, estado: 'error', revisadas: 0, mejoradas: 0,
      error: String(err.message || err), t: ahora() });
    return { revisadas: 0, mejoradas: 0 };
  }
  await espera(tcgdex.ESPERA_MS);

  if (!detalle || !Array.isArray(detalle.cards)) {
    marcarSet.run({ set_code: exp.set_code, estado: 'sin-datos', revisadas: 0, mejoradas: 0,
      error: 'TCGdex no devolvió cartas para este set', t: ahora() });
    return { revisadas: 0, mejoradas: 0 };
  }

  const porNumero = new Map();
  for (const c of detalle.cards) {
    const n = numeroLimpio(c.localId);
    if (n) porNumero.set(n, c);
  }

  const mias = db.prepare('SELECT id, numero FROM cartas WHERE set_code = ?').all(exp.set_code);
  let revisadas = 0, mejoradas = 0;

  for (const carta of mias) {
    const candidato = porNumero.get(numeroLimpio(carta.numero));
    if (!candidato) continue;
    revisadas++;

    const actual = ficheroLocal(carta.id);
    const dimActual = actual ? dimensiones(fs.readFileSync(actual)) : null;

    let nueva = null;
    try { nueva = await tcgdex.descargarImagen(candidato.image, 'high'); } catch { /* se salta esta carta */ }
    await espera(tcgdex.ESPERA_MS);
    if (!nueva) continue;

    const dimNueva = dimensiones(nueva);
    if (!dimNueva) continue;

    const areaActual = dimActual ? dimActual.ancho * dimActual.alto : 0;
    if (dimNueva.ancho * dimNueva.alto <= areaActual) continue;

    const destino = rutaLocal(carta.id, tipoDe(nueva));
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, nueva);
    if (actual && actual !== destino) fs.unlinkSync(actual);
    mejoradas++;
  }

  marcarSet.run({ set_code: exp.set_code, estado: 'hecho', revisadas, mejoradas, error: null, t: ahora() });
  return { revisadas, mejoradas };
}

async function ciclo() {
  if (corriendo) return;
  corriendo = true;
  try {
    let e = estado();
    if (!e.activo) return;

    const lista = listaOrdenada();
    if (e.setsTotales !== lista.length) e = guardar({ setsTotales: lista.length });

    while (e.activo && e.indiceSet < lista.length) {
      const exp = lista[e.indiceSet];
      const { revisadas, mejoradas } = await procesarSet(exp);
      e = guardar({
        indiceSet: e.indiceSet + 1,
        cartasRevisadas: e.cartasRevisadas + revisadas,
        cartasMejoradas: e.cartasMejoradas + mejoradas,
        mensaje: `${exp.nombre}: ${revisadas} revisadas, ${mejoradas} mejoradas ` +
                 `(${e.indiceSet + 1}/${lista.length} colecciones · ${e.cartasMejoradas + mejoradas} mejoradas en total)`,
      });
    }

    if (e.activo && e.indiceSet >= lista.length) {
      guardar({ activo: false, terminado: ahora(),
        mensaje: `Terminado: ${e.cartasMejoradas} cartas mejoradas de ${e.cartasRevisadas} revisadas en ${lista.length} colecciones` });
    }
  } catch (err) {
    guardar({ mensaje: 'Error, se reintenta en un minuto: ' + String(err.message || err).slice(0, 160) });
    programar(60 * 1000);
  } finally {
    corriendo = false;
  }
}

function programar(ms) {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { ciclo().catch(() => {}); }, ms);
  if (temporizador.unref) temporizador.unref();
}

function arrancar() {
  const e = estado();
  if (e.activo) return e;
  const nuevo = guardar({
    activo: true, error: null, terminado: null,
    iniciado: e.iniciado || ahora(), mensaje: 'Arrancando…',
  });
  programar(50);
  return nuevo;
}

const parar = () => { clearTimeout(temporizador); return guardar({ activo: false, mensaje: 'Parado a mano' }); };

/* Si el servicio se reinicia a mitad, sigue solo donde lo dejó — igual que
   la ingesta del catálogo. */
function reanudarSiHacia() {
  const e = estado();
  if (e.activo) programar(3000);
  return e;
}

module.exports = { arrancar, parar, estado, reanudarSiHacia };

'use strict';
/*
 * Segunda pasada de mejora de imágenes, esta vez contra pokemontcg.io.
 * Mismo patrón que lib/mejora-imagenes.js (TCGdex) y lib/ingesta.js: estado
 * resumible en la tabla `ingesta`, progreso por colección en su propia
 * tabla (`mejora_imagenes_ptcgio`, para no pisar la de TCGdex).
 *
 * Solo colecciones en inglés: pokemontcg.io no tiene catálogo japonés ni
 * chino. Y a diferencia de TCGdex, aquí no hay forma de pedir una colección
 * entera de un tirón —pokemontcg.io devuelve error 500 sin filtro de
 * número, comprobado varias veces—, así que esto gasta una petición POR
 * CARTA y no por colección: más lento, de ahí que vaya detrás de la pasada
 * de TCGdex y no a la vez.
 *
 * El nombre de la colección se busca igual que ingesta.js busca en la API
 * de PokeWallet: sin el prefijo "SV: "/"ME: " delante, que pokemontcg.io no
 * lo tiene en sus propios nombres.
 */
const fs = require('fs');
const path = require('path');
const { db, leerEstado, guardarEstado, ahora } = require('./db');
const ptcgio = require('./pokemontcgio');
const { dimensiones } = require('./dimensiones');

const CLAVE = 'mejora_imagenes_ptcgio';
// 'low', no 'high': ver el mismo comentario en mejora-imagenes.js.
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

// De más reciente a más antigua, solo inglés.
const listaOrdenada = () => db.prepare(`
  SELECT set_code, nombre
  FROM expansiones
  WHERE idioma = 'eng'
  ORDER BY fecha_orden IS NULL, fecha_orden DESC, nombre`).all();

const marcarSet = db.prepare(`
  INSERT INTO mejora_imagenes_ptcgio (set_code, estado, cartas_revisadas, cartas_mejoradas, error, actualizado)
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

const numeroLimpio = (n) => String(n || '').split('/')[0].replace(/^0+(?=\d)/, '');
// Mismo arreglo que ingesta.js: "SV: Paldean Fates" no encuentra nada en
// pokemontcg.io, "Paldean Fates" sí.
const terminoBusqueda = (nombre) => {
  const limpio = String(nombre || '').replace(/^[A-Za-z0-9&\-\/]{1,8}:\s*/, '').trim();
  return limpio || String(nombre || '');
};

/* A diferencia de mejora-imagenes.js (TCGdex), aquí cada carta es su propia
   petición de red con su propia espera y sus propios reintentos — un set de
   125 cartas puede tardar varios minutos. Guardar el progreso solo al
   terminar el set entero (como hace TCGdex) dejaba esto pareciendo colgado
   un buen rato sin ningún aviso; aquí se avisa después de CADA carta, y
   `sigueActivo()` corta el set a medio camino si alguien para el trabajo
   desde fuera, en vez de obligar a apurar las que queden. */
const sigueActivo = () => estado().activo;

async function procesarSet(exp, enCada) {
  const termino = terminoBusqueda(exp.nombre);
  const mias = db.prepare('SELECT id, numero FROM cartas WHERE set_code = ?').all(exp.set_code);
  let revisadas = 0, mejoradas = 0, completo = true;

  for (const carta of mias) {
    if (!sigueActivo()) { completo = false; break; }
    const numero = numeroLimpio(carta.numero);
    if (!numero) continue;

    let candidato;
    try {
      candidato = await ptcgio.buscarCarta(termino, numero);
    } catch (e) {
      // Un fallo de red en una carta no tira la colección entera: se sigue
      // con la siguiente y esta cuenta como no revisada.
      await ptcgio.espera(ptcgio.ESPERA_MS);
      enCada(revisadas, mejoradas);
      continue;
    }
    await ptcgio.espera(ptcgio.ESPERA_MS);
    const urlGrande = candidato?.images?.large;
    if (!urlGrande) { enCada(revisadas, mejoradas); continue; }
    revisadas++;

    const actual = ficheroLocal(carta.id);
    const dimActual = actual ? dimensiones(fs.readFileSync(actual)) : null;

    let nueva = null;
    try { nueva = await ptcgio.descargarImagen(urlGrande); } catch { /* se salta esta carta */ }
    if (!nueva) { enCada(revisadas, mejoradas); continue; }

    const dimNueva = dimensiones(nueva);
    if (!dimNueva) { enCada(revisadas, mejoradas); continue; }

    const areaActual = dimActual ? dimActual.ancho * dimActual.alto : 0;
    if (dimNueva.ancho * dimNueva.alto <= areaActual) { enCada(revisadas, mejoradas); continue; }

    const destino = rutaLocal(carta.id, tipoDe(nueva));
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, nueva);
    if (actual && actual !== destino) fs.unlinkSync(actual);
    mejoradas++;
    enCada(revisadas, mejoradas);
  }

  // Si se paró a medio set, no se marca "hecho": la próxima vez que arranque
  // vuelve a este mismo set entero (sigueActivo() sale barato, y repasar de
  // más es preferible a dar por buena una colección a medio revisar).
  if (completo) {
    marcarSet.run({ set_code: exp.set_code, estado: 'hecho', revisadas, mejoradas, error: null, t: ahora() });
  }
  return { revisadas, mejoradas, completo };
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
      const base = { revisadas: e.cartasRevisadas, mejoradas: e.cartasMejoradas };
      const { revisadas, mejoradas, completo } = await procesarSet(exp, (rEnSet, mEnSet) => {
        guardar({
          cartasRevisadas: base.revisadas + rEnSet,
          cartasMejoradas: base.mejoradas + mEnSet,
          mensaje: `${exp.nombre}: ${rEnSet} revisadas, ${mEnSet} mejoradas ` +
                   `(colección ${e.indiceSet + 1}/${lista.length} · ${base.mejoradas + mEnSet} mejoradas en total)`,
        });
      });
      e = guardar({
        indiceSet: completo ? e.indiceSet + 1 : e.indiceSet,
        cartasRevisadas: base.revisadas + revisadas,
        cartasMejoradas: base.mejoradas + mejoradas,
        mensaje: completo
          ? `${exp.nombre}: ${revisadas} revisadas, ${mejoradas} mejoradas ` +
            `(${e.indiceSet + 1}/${lista.length} colecciones · ${base.mejoradas + mejoradas} mejoradas en total)`
          : 'Parado a mano',
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

function reanudarSiHacia() {
  const e = estado();
  if (e.activo) programar(3000);
  return e;
}

module.exports = { arrancar, parar, estado, reanudarSiHacia };

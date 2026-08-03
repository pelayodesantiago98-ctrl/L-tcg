'use strict';
/*
 * Cliente de la API de PokeWallet.
 *
 * Lo único que de verdad importa aquí es la cuota: 100 peticiones por hora y
 * 1.000 por día en el plan gratuito. El catálogo son 68.227 cartas y el tope
 * de página es 200, así que bajarlo entero cuesta 342 peticiones, o sea unas
 * cuatro horas. Nada de esto puede hacerse dentro de una petición web.
 *
 * La API devuelve en cada respuesta cuánto queda (X-RateLimit-Remaining-Hour
 * y -Day), así que no hay que llevar la cuenta a ciegas: se lee de la fuente
 * y se guarda para que el panel de administración lo enseñe.
 */
const { leerEstado, guardarEstado } = require('./db');

const BASE = (process.env.POKEWALLET_BASE_URL || 'https://api.pokewallet.io/').replace(/\/*$/, '/');
const CLAVE = process.env.POKEWALLET_API_KEY;

// Margen que no se toca, para que la navegación normal (imágenes nuevas) no
// se quede sin cuota porque la ingesta se la comió entera.
const RESERVA_HORA = 10;

// Cada cuánto se deja pasar una petición de sondeo con los contadores a cero.
const VENTANA_SONDEO = 3600e3;

class SinCuota extends Error {
  constructor(cuota) {
    super('Cuota de la API agotada');
    this.name = 'SinCuota';
    this.cuota = cuota;
  }
}

const cuotaActual = () => leerEstado('cuota', {
  restanHora: null, restanDia: null, limiteHora: 100, limiteDia: 1000, visto: null,
});

function anotarCuota(res) {
  const num = (n) => { const v = Number(res.headers.get(n)); return Number.isFinite(v) ? v : null; };
  const cuota = {
    restanHora: num('x-ratelimit-remaining-hour'),
    restanDia: num('x-ratelimit-remaining-day'),
    limiteHora: num('x-ratelimit-limit-hour') || 100,
    limiteDia: num('x-ratelimit-limit-day') || 1000,
    visto: new Date().toISOString(),
  };
  guardarEstado('cuota', cuota);
  return cuota;
}

/*
 * Una petición. `reserva` es cuántas peticiones hay que dejar sin gastar: la
 * ingesta pide con reserva para no dejar seca la navegación, y las imágenes
 * piden con reserva 0 porque son lo que el usuario está mirando ahora mismo.
 */
async function pedir(ruta, { reserva = 0, binario = false, corte } = {}) {
  const cuota = cuotaActual();
  /*
   * Los contadores solo se refrescan cuando se llama a la API, así que al
   * llegar a cero se quedarían clavados en cero para siempre y nunca se
   * volvería a intentar nada. Por eso caducan: pasada la ventana desde la
   * última lectura, se deja pasar una petición de sondeo que traerá los
   * contadores nuevos. Sin esto, agotar la cuota una vez apagaba la ingesta
   * de forma permanente.
   *
   * La ventana es la misma para los dos contadores. Antes la del día era de
   * 24 h, y eso reproducía el mismo bloqueo a otra escala: al agotar la cuota
   * un día a las 19:40, el trabajo se quedaba esperando hasta las 19:40 del
   * día siguiente, aunque la API renovase el cupo diario a medianoche. Se
   * perdían las horas intermedias enteras — medido: 10,7 h parado, 0
   * peticiones, reintentando cada minuto sin llegar nunca a salir a la red.
   * Sondear una vez por hora cuesta 24 peticiones al día en el peor caso y
   * encuentra el margen como mucho una hora después de que exista.
   */
  const edad = cuota.visto ? Date.now() - Date.parse(cuota.visto) : Infinity;
  const caducado = edad > VENTANA_SONDEO;
  if (!caducado && cuota.restanHora != null && cuota.restanHora <= reserva) throw new SinCuota(cuota);
  if (!caducado && cuota.restanDia != null && cuota.restanDia <= reserva) throw new SinCuota(cuota);

  const res = await fetch(BASE + ruta.replace(/^\//, ''), {
    headers: { 'X-API-Key': CLAVE, 'Accept': binario ? 'image/*' : 'application/json' },
    signal: corte,
  });
  const nueva = anotarCuota(res);

  if (res.status === 429) throw new SinCuota(nueva);
  if (!res.ok) {
    const cuerpo = binario ? '' : await res.text().catch(() => '');
    const err = new Error(`La API respondió ${res.status} en ${ruta}${cuerpo ? ': ' + cuerpo.slice(0, 200) : ''}`);
    err.status = res.status;
    throw err;
  }
  return binario ? Buffer.from(await res.arrayBuffer()) : res.json();
}

const listarExpansiones = () => pedir('sets', { reserva: 0 });

const cartasDeExpansion = (setCode, pagina, limite = 200, opciones = {}) =>
  pedir(`sets/${encodeURIComponent(setCode)}?page=${pagina}&limit=${limite}`, opciones);

const imagen = (id, tamano = 'low') =>
  pedir(`images/${encodeURIComponent(id)}?size=${tamano === 'high' ? 'high' : 'low'}`,
        { binario: true });

const buscar = (q, limite = 20, pagina = 1) =>
  pedir(`search?q=${encodeURIComponent(q)}&limit=${limite}&page=${pagina}`);

module.exports = {
  pedir, listarExpansiones, cartasDeExpansion, imagen, buscar,
  cuotaActual, SinCuota, RESERVA_HORA, BASE,
};

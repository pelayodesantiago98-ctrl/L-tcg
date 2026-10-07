'use strict';
/*
 * Cliente de TCGdex (tcgdex.net): público, sin clave, sin el cupo tan
 * ajustado de la API de PokeWallet. Se usa para dos cosas que esa API no
 * trae: el logo de cada colección y, cuando hay una versión en más
 * resolución de la MISMA carta, su imagen.
 *
 * No hay límite documentado, pero tampoco hace falta ir deprisa: una espera
 * corta entre peticiones basta para no abusar de un servicio gratuito del
 * que depende esta mejora, sin que importe lo más mínimo para algo que va a
 * tardar horas de todas formas.
 */
const ESPERA_MS = 250;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(ruta, intentos = 3) {
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch('https://api.tcgdex.net/v2/' + ruta.replace(/^\//, ''));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`TCGdex respondió ${res.status} en ${ruta}`);
      return await res.json();
    } catch (e) {
      if (i === intentos - 1) throw e;
      await espera(1000 * (i + 1));
    }
  }
}

// IDs de idioma de TCGdex que de verdad tienen catálogo propio hoy.
const IDIOMAS = { eng: 'en', jap: 'ja', chn: 'zh-tw' };

const listarSets = (idiomaTcgdex) => pedir(`${idiomaTcgdex}/sets`);
const detalleSet = (idiomaTcgdex, id) => pedir(`${idiomaTcgdex}/sets/${encodeURIComponent(id)}`);

/* `base` es el campo `image` que trae cada carta: una URL sin extensión ni
   calidad, hay que completarla. webp pesa menos que png para la misma
   calidad y todos los navegadores de hoy lo leen. */
const imagenUrl = (base, calidad = 'high') => `${base}/${calidad}.webp`;

async function descargarImagen(base, calidad = 'high') {
  const res = await fetch(imagenUrl(base, calidad));
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { IDIOMAS, listarSets, detalleSet, imagenUrl, descargarImagen, espera, ESPERA_MS };

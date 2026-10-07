'use strict';
/*
 * Cliente de pokemontcg.io: pública, sin clave, pensada para que otras apps
 * la usen igual que TCGdex. A diferencia de TCGdex, aquí NO se puede pedir
 * "toda la colección de un tirón" —devuelve 500 sin filtro de número,
 * comprobado varias veces, parece un límite real del lado de ellos sin
 * clave— así que esto va carta a carta: una petición por carta, no por
 * colección. Por eso la pausa entre peticiones importa más aquí que en
 * TCGdex.
 */
const ESPERA_MS = 350;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(url, intentos = 3) {
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`pokemontcg.io respondió ${res.status}`);
      const texto = await res.text();
      return texto ? JSON.parse(texto) : null;
    } catch (e) {
      if (i === intentos - 1) throw e;
      await espera(1000 * (i + 1));
    }
  }
}

/* nombreExpansion ya sin el prefijo "SV: "/"ME: " — ver terminoBusqueda() en
   mejora-imagenes-ptcgio.js, el mismo problema que ya resolvió ingesta.js
   para la API de PokeWallet. */
async function buscarCarta(nombreExpansion, numero) {
  const q = `set.name:"${nombreExpansion.replace(/"/g, '')}" number:${numero}`;
  const d = await pedir('https://api.pokemontcg.io/v2/cards?q=' + encodeURIComponent(q));
  return (d && d.data && d.data[0]) || null;
}

async function descargarImagen(urlImagen) {
  const res = await fetch(urlImagen);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { buscarCarta, descargarImagen, espera, ESPERA_MS };

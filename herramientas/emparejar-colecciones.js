'use strict';
const { db, normaliza, ahora } = require('/var/www/l-tcg/lib/db');
const tcgdex = require('/var/www/l-tcg/lib/tcgdex');

const diasEntre = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

async function main() {
  // Limpio lo del intento anterior: el emparejamiento difuso sin fecha coló
  // casos como "Champion's Path: Gym Heroes" -> el "Gym Heroes" real de 2000.
  db.prepare('UPDATE expansiones SET logo_url=NULL, tcgdex_set_id=NULL, tcgdex_lang=NULL').run();

  const expansiones = db.prepare('SELECT set_code, nombre, idioma, fecha_orden FROM expansiones').all();
  const porIdioma = {};
  for (const [miIdioma, tcgLang] of Object.entries(tcgdex.IDIOMAS)) {
    const sets = await tcgdex.listarSets(tcgLang);
    porIdioma[miIdioma] = (sets || []).map((s) => ({ ...s, _busca: normaliza(s.name) }));
    console.log(tcgLang, 'sets TCGdex:', porIdioma[miIdioma].length);
  }

  // Caché de releaseDate por candidato difuso: solo hace falta pedir el
  // detalle de los sets que de verdad entran en juego como posible fuzzy match.
  const fechaCache = new Map();
  async function fechaDe(tcgLang, id) {
    const clave = `${tcgLang}:${id}`;
    if (fechaCache.has(clave)) return fechaCache.get(clave);
    const d = await tcgdex.detalleSet(tcgLang, id);
    await tcgdex.espera(tcgdex.ESPERA_MS);
    const f = d && d.releaseDate;
    fechaCache.set(clave, f);
    return f;
  }

  const upd = db.prepare('UPDATE expansiones SET logo_url=?, tcgdex_set_id=?, tcgdex_lang=? WHERE set_code=?');
  let exactas = 0, difusas = 0, rechazadasPorFecha = 0, sinLogo = 0, sinPool = 0;
  const ejemplos = [];
  const rechazos = [];
  for (const e of expansiones) {
    const tcgLang = tcgdex.IDIOMAS[e.idioma];
    const pool = porIdioma[e.idioma] || [];
    if (!tcgLang || !pool.length) { sinPool++; continue; }
    const miBusca = normaliza(e.nombre);
    let match = pool.find((s) => s._busca === miBusca);
    let tipo = 'exacta';
    if (!match) {
      tipo = 'difusa';
      const candidatos = pool.filter((s) => s._busca.length > 3 &&
        (miBusca.includes(s._busca) || s._busca.includes(miBusca)));
      // Entre varios candidatos difusos, el de fecha más cercana a la mía.
      for (const c of candidatos) {
        if (!e.fecha_orden) continue;
        const f = await fechaDe(tcgLang, c.id);
        if (!f) continue;
        c._dias = diasEntre(f, e.fecha_orden);
      }
      const validos = candidatos.filter((c) => c._dias != null && c._dias <= 730);
      validos.sort((a, b) => a._dias - b._dias);
      if (validos.length) {
        match = validos[0];
      } else if (candidatos.length) {
        rechazadasPorFecha++;
        rechazos.push(`${e.nombre} (${e.idioma}, ${e.fecha_orden}) descartado: ` +
          candidatos.map((c) => `${c.name}[${c._dias != null ? Math.round(c._dias) + 'd' : 'sin fecha'}]`).join(', '));
        match = null;
      }
    }
    if (match && match.logo) {
      upd.run(match.logo, match.id, tcgLang, e.set_code);
      if (tipo === 'exacta') exactas++; else difusas++;
      if (ejemplos.length < 40) ejemplos.push(`${tipo} | ${e.nombre} (${e.idioma}) -> ${match.name} [${match.id}]`);
    } else {
      sinLogo++;
    }
  }
  console.log({ total: expansiones.length, exactas, difusas, rechazadasPorFecha, sinLogo, sinPool });
  console.log('--- emparejadas (muestra) ---');
  console.log(ejemplos.join('\n'));
  console.log('--- rechazadas por fecha (muestra) ---');
  console.log(rechazos.slice(0, 20).join('\n'));
}
main().catch((e) => { console.error(e); process.exit(1); });

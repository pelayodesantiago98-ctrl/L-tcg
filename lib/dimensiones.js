'use strict';
/*
 * Ancho y alto de una imagen leyendo solo su cabecera, sin ninguna
 * dependencia de proceso de imagen: lo único que hace falta aquí es comparar
 * tamaños, no decodificar píxeles. Cubre los tres formatos que de verdad
 * aparecen en esta casa: JPEG y PNG (lo que guarda PokeWallet) y WebP (lo que
 * sirve TCGdex).
 */

function png(b) {
  if (b.length < 24) return null;
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4E || b[3] !== 0x47) return null;
  return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) };
}

function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const marcador = b[i + 1];
    // Los SOFn que de verdad traen dimensiones; se salta todo lo demás.
    if (marcador >= 0xC0 && marcador <= 0xCF && marcador !== 0xC4 && marcador !== 0xC8 && marcador !== 0xCC) {
      return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) };
    }
    if (marcador === 0xD8 || marcador === 0xD9) { i += 2; continue; }
    const largo = b.readUInt16BE(i + 2);
    i += 2 + largo;
  }
  return null;
}

function webp(b) {
  if (b.length < 30) return null;
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const formato = b.toString('latin1', 12, 16);
  if (formato === 'VP8 ') {
    // Lossy: dimensiones de 14 bits en los bytes 26-29 del chunk.
    return { ancho: b.readUInt16LE(26) & 0x3FFF, alto: b.readUInt16LE(28) & 0x3FFF };
  }
  if (formato === 'VP8L') {
    const n = b.readUInt32LE(21);
    return { ancho: (n & 0x3FFF) + 1, alto: ((n >> 14) & 0x3FFF) + 1 };
  }
  if (formato === 'VP8X') {
    const ancho = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
    const alto = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
    return { ancho, alto };
  }
  return null;
}

/* Devuelve {ancho, alto} o null si no se reconoce / está corrupta. No lanza:
   un fallo aquí es "no se puede comparar", no un error de verdad. */
function dimensiones(buf) {
  try { return png(buf) || jpeg(buf) || webp(buf); } catch { return null; }
}

module.exports = { dimensiones };

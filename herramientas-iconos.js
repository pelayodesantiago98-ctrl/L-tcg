'use strict';
/*
 * Genera los iconos de la PWA sin dependencias.
 *
 * En el servidor no hay ImageMagick ni rsvg, y traerlos con sus dependencias
 * para cuatro PNG no compensa. Node ya trae zlib, que es lo único que hace
 * falta: un PNG es la cabecera, los píxeles comprimidos y poco más.
 *
 * Cada píxel se resuelve con una función y se muestrea 3x3 para suavizar los
 * bordes; sin eso las esquinas redondeadas y la carta girada salen dentadas.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FONDO = [0x16, 0x16, 0x14];
const VERDE = [0x5f, 0xae, 0x85];
const OSCURO = [0x16, 0x16, 0x14];

const mezclar = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);

// ── Figuras, en coordenadas de 0 a 1 ───────────────────────────────────────

function dentroRedondeado(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

const girar = (x, y, cx, cy, grados) => {
  const a = (grados * Math.PI) / 180;
  const dx = x - cx, dy = y - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
};

/* La L se dibuja con dos rectángulos en vez de con una fuente: no hay
   garantía de que el servidor tenga ninguna instalada, y así el icono sale
   igual en cualquier máquina. */
function dentroL(x, y, e) {
  const barra = 0.055 * e, alto = 0.20 * e, pie = 0.145 * e;
  // Abajo y a la izquierda del centro: es donde la carta tiene verde liso,
  // debajo de la ventana oscura, y la L se lee sin pelearse con nada.
  const x0 = 0.5 - 0.085 * e, y0 = 0.5 + 0.045 * e;
  const vertical = x >= x0 && x <= x0 + barra && y >= y0 && y <= y0 + alto;
  const base = x >= x0 && x <= x0 + pie && y >= y0 + alto - barra && y <= y0 + alto;
  return vertical || base;
}

function color(x, y, escala, conMarco) {
  // Fondo: cuadrado redondeado en la versión normal, lleno en la enmascarable.
  if (conMarco && !dentroRedondeado(x, y, 0, 0, 1, 1, 0.22)) return null;

  const e = escala;
  const c = 0.5;
  const [gx, gy] = girar(x, y, c, c, 12);   // se gira el punto, no la carta

  const cx0 = c - 0.207 * e, cx1 = c + 0.207 * e;
  const cy0 = c - 0.289 * e, cy1 = c + 0.289 * e;

  // La L va antes que la carta: si se comprueba después, la carta ya ha
  // devuelto color y la letra no llega a verse. Pasó en la primera versión.
  if (dentroL(x, y, e)) return OSCURO;

  if (dentroRedondeado(gx, gy, cx0, cy0, cx1, cy1, 0.039 * e)) {
    // Ventana interior más oscura, como la ilustración de una carta.
    const vx0 = c - 0.172 * e, vx1 = c + 0.172 * e;
    const vy0 = cy0 + 0.035 * e, vy1 = cy0 + 0.386 * e;
    if (dentroRedondeado(gx, gy, vx0, vy0, vx1, vy1, 0.02 * e)) {
      return mezclar(VERDE, OSCURO, 0.28);
    }
    return VERDE;
  }
  return FONDO;
}

// ── PNG ────────────────────────────────────────────────────────────────────

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo) >>> 0);
  return Buffer.concat([largo, cuerpo, crc]);
}

const TABLA = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = TABLA[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return c ^ 0xFFFFFFFF;
}

function png(lado, escala, conMarco) {
  const M = 3;                     // muestreo 3x3 por píxel
  const filas = Buffer.alloc(lado * (lado * 4 + 1));
  let p = 0;
  for (let y = 0; y < lado; y++) {
    filas[p++] = 0;                // filtro "ninguno"
    for (let x = 0; x < lado; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < M; sy++) {
        for (let sx = 0; sx < M; sx++) {
          const c = color((x + (sx + 0.5) / M) / lado, (y + (sy + 0.5) / M) / lado, escala, conMarco);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = M * M;
      const op = a / n;
      // Se premultiplica al vuelo: donde no hay figura, el color no cuenta.
      filas[p++] = a ? Math.round(r / (a / 255)) : 0;
      filas[p++] = a ? Math.round(g / (a / 255)) : 0;
      filas[p++] = a ? Math.round(b / (a / 255)) : 0;
      filas[p++] = Math.round(op);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8;      // bits por canal
  ihdr[9] = 6;      // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    trozo('IHDR', ihdr),
    trozo('IDAT', zlib.deflateSync(filas, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

const destino = process.argv[2] || '/var/www/l-tcg/public/img';
fs.mkdirSync(destino, { recursive: true });

const salidas = [
  ['icono-192.png', 192, 1, true],
  ['icono-512.png', 512, 1, true],
  ['icono-180.png', 180, 1, true],
  ['icono-mascara.png', 512, 0.62, false],   // Android recorta: hace falta margen
  ['favicon-32.png', 32, 1, true],
];

for (const [nombre, lado, escala, marco] of salidas) {
  const datos = png(lado, escala, marco);
  fs.writeFileSync(path.join(destino, nombre), datos);
  console.log(`  ${nombre.padEnd(20)} ${lado}x${lado}  ${datos.length} bytes`);
}

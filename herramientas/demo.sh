#!/bin/bash
# Levanta una copia de l-tcg en /var/tmp con sesión falsa, le pone una
# colección y un álbum de ejemplo, la fotografía y la borra.
#
# No toca la instalación real: la base se copia con VACUUM INTO (consistente
# aunque la precarga esté escribiendo) y las imágenes se enlazan, que son 273
# MB y no hay por qué duplicarlas.
set -eu

DEMO=/var/tmp/tcg-demo
PUERTO=3098

rm -rf "$DEMO"
cp -a /var/www/l-tcg "$DEMO"
rm -rf "$DEMO/data"
mkdir -p "$DEMO/data"

node -e '
const { db } = require("/var/www/l-tcg/lib/db");
db.prepare("VACUUM INTO ?").run("/var/tmp/tcg-demo/data/l-tcg.sqlite3");
console.log("base copiada");
'
ln -s /var/www/l-tcg/data/imagenes "$DEMO/data/imagenes"

# Sesión falsa solo en la copia.
python3 - "$DEMO/lib/auth.js" <<'EOP'
import sys
ruta = sys.argv[1]
texto = open(ruta, encoding='utf-8').read()
viejo = "  const s = sso.sesion(req);"
nuevo = "  const s = { id: 'demo', nombre: 'Demo' };  // SOLO EN LA DEMO"
assert viejo in texto, 'no encuentro la llamada al sso'
open(ruta, 'w', encoding='utf-8').write(texto.replace(viejo, nuevo, 1))
print('sesion falsa puesta')
EOP

# Colección y álbum de ejemplo, con cartas que ya tienen la imagen en disco.
node - "$DEMO" <<'EON'
const path = require('path');
const raiz = process.argv[2];
const Database = require(path.join(raiz, 'node_modules', 'better-sqlite3'));
const db = new Database(path.join(raiz, 'data', 'l-tcg.sqlite3'));
const ahora = new Date().toISOString();

// El usuario que verá la demo: el perfil se crea solo al entrar, pero aquí
// hace falta antes para colgarle la colección.
db.prepare(`INSERT INTO usuarios (usuario, nombre, clave_hash, rol, creado, sso_id)
            VALUES ('Demo', 'Demo', '', 'admin', ?, 'demo')`).run(ahora);
const uid = db.prepare("SELECT id FROM usuarios WHERE sso_id = 'demo'").get().id;

// Cartas con foto y con precio, que son las que lucen.
const cartas = db.prepare(`
  SELECT id FROM cartas
  WHERE imagen_local > 0 AND precio_avg IS NOT NULL
  ORDER BY precio_avg DESC LIMIT 60
`).all().map((c) => c.id);

const meter = db.prepare(`INSERT INTO coleccion (usuario_id, carta_id, cantidad, deseada, actualizado)
                          VALUES (?, ?, ?, ?, ?)`);
cartas.forEach((id, i) => meter.run(uid, id, i % 7 === 0 ? 0 : 1, i % 7 === 0 ? 1 : 0, ahora));

const bid = db.prepare(`INSERT INTO binders (usuario_id, nombre, slots_por_pagina, paginas, creado)
                        VALUES (?, 'Mi primer álbum', 9, 4, ?)`).run(uid, ahora).lastInsertRowid;
const hueco = db.prepare('INSERT INTO binder_slots (binder_id, pagina, hueco, carta_id) VALUES (?, ?, ?, ?)');
cartas.slice(0, 36).forEach((id, i) => hueco.run(bid, Math.floor(i / 9) + 1, i % 9, id));

console.log('coleccion de', cartas.length, 'cartas y album de 4 paginas');
EON

PORT=$PUERTO node "$DEMO/server.js" > /var/tmp/tcg-demo.log 2>&1 &
PID=$!
sleep 4
echo "demo en $PUERTO (pid $PID)"

B=http://127.0.0.1:$PUERTO
C="--headless --disable-gpu --no-sandbox --hide-scrollbars --virtual-time-budget=12000 --run-all-compositor-stages-before-draw"

chromium $C --window-size=1280,1700 --screenshot=/var/tmp/t-coleccion.png "$B/coleccion" 2>/dev/null
chromium $C --window-size=1280,1500 --screenshot=/var/tmp/t-album.png      "$B/album"     2>/dev/null
chromium $C --window-size=1280,1700 --screenshot=/var/tmp/t-enciclopedia.png "$B/enciclopedia" 2>/dev/null
chromium $C --window-size=430,1600  --screenshot=/var/tmp/t-movil.png      "$B/coleccion" 2>/dev/null

echo 'capturas hechas'
kill $PID 2>/dev/null || true
sleep 1
rm -rf "$DEMO"
ls -l /var/tmp/t-*.png | awk '{print $5, $9}'

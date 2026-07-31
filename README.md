# L-tcg

Colección de cartas Pokémon con álbum visual, en
[l-tcg.lepayimio.es](https://l-tcg.lepayimio.es).

Node + Express, SQLite y JWT. Los datos vienen de la API de
[PokeWallet](https://api.pokewallet.io/).

## Lo que hay que saber antes de tocar nada

### La API va con cuota, y es poca

**100 peticiones por hora y 1.000 al día** en el plan gratuito. El catálogo son
**857 expansiones y 68.227 cartas** (34.014 en inglés). Nada que hable con la
API puede vivir dentro de una petición del navegador: la bajada completa son
unas 400 peticiones, o sea cuatro o cinco horas.

De ahí que `lib/ingesta.js` sea un trabajo de fondo que guarda por dónde va en
la tabla `ingesta`, se detiene solo al quedarse sin cuota, vuelve a intentarlo
diez minutos después y **se reanuda aunque se reinicie el servicio**.

### Los dos endpoints de cartas no devuelven lo mismo

Esto costó descubrirlo y condiciona toda la ingesta:

| Endpoint | Cartas | Precios | Tope de página |
|---|---|---|---|
| `/sets/:code` | lista completa y fiable | **vacíos** | 200 |
| `/search?q=` | por relevancia | **sí** | 100 |
| `/cards/:id` | una | sí | — |

Comprobado: 69 cartas de Hidden Fates por `/sets`, **0 con precio**. Como los
precios son medio proyecto, la bajada va por `/search` buscando el nombre de
cada expansión, que trae carta y precio en la misma petición.

Lo que devuelve la búsqueda puede incluir cartas de otras expansiones —buscar
«Hidden Fates» también saca las del Shiny Vault—, así que **cada carta se
coloca en la expansión que dice su propio `set_id`**, no en la que se estaba
buscando. Los distintos endpoints rellenan esos campos de forma distinta: en
`/sets/:code` el `card_info.set_code` trae en realidad el `set_id` numérico.
Por eso `resolverSet()` prueba varias vías antes de rendirse.

### Las imágenes también gastan cuota

`/images/:id` exige la clave, así que el navegador no puede pedirlas directamente
sin que la clave quede a la vista. Van por `/api/imagen/:id`, con la clave en el
servidor.

Y cada una cuesta una petición. Bajar las 68.227 serían **68 días**. Por eso se
guardan en disco para siempre: la primera vez que alguien mira una carta cuesta
una petición y no vuelve a costar nada. La propia API lo bendice, responde con
`cache-control: immutable`.

En la práctica: unas **100 cartas nuevas por hora** el primer día, y gratis
después. El precargador (`/api/admin/precarga/arrancar`) deja el servidor
bajando una expansión entera poco a poco, sin que nadie espere mirando.

No todas son JPEG: hay bastantes PNG. El formato se deduce de los bytes de
cabecera y el fichero se guarda con la extensión que le toca; anunciar un PNG
como `image/jpeg` con `nosniff` puesto en nginx es pedir problemas.

## Por qué SQLite y no MongoDB

La idea inicial era MongoDB + Mongoose. En el servidor **no hay ninguna base de
datos compartida**: l-notes tiene su `.sqlite3` y los dos sitios en Node guardan
JSON. Con 1,8 GB de RAM, tres servicios ya corriendo, unos 600 MB libres y sin
swap, un motor con servidor propio se habría comido buena parte para nada: aquí
no hay concurrencia de escritura más allá de un puñado de usuarios. Node entero
ocupa 231 MB.

WAL activado para que la web siga respondiendo durante las horas que dura la
ingesta.

## Estructura

```
lib/db.js         esquema y utilidades
lib/auth.js       JWT en cookie httpOnly + bcrypt
lib/api.js        cliente de PokeWallet, con control de cuota
lib/ingesta.js    bajada del catálogo, reanudable
lib/imagenes.js   proxy con caché en disco y precargador
models/User.js
models/Card.js        catálogo, consultas, colección y wishlist
models/BinderSlot.js  álbum: páginas, huecos, mover, rellenar
routes/auth.js  collection.js  binder.js  admin.js
public/           index.html, css/, js/app.js, sw.js, manifest
```

## Decisiones que no se ven en el código

**El token va en cookie `httpOnly`, no en localStorage**, para que un XSS no se
lleve la sesión. Se acepta también `Authorization: Bearer` por si algún día hay
una app con Capacitor, que no comparte las cookies del navegador.

**La wishlist no es una lista aparte**: es una columna de la misma fila de
`coleccion`, así una carta no puede estar a la vez en dos sitios que se
contradigan. Cuando queda a cero y sin desear, la fila se borra.

**Del álbum solo se guardan los huecos ocupados.** Un álbum de 60 páginas con 9
huecos serían 540 filas casi todas vacías. El «hueco negro» del diseño no
existe en la base de datos: es la ausencia de fila.

**Mover es intercambiar.** Si el destino está ocupado, las dos cartas cambian de
sitio en vez de perderse una, y en una transacción porque a mitad quedaría la
misma carta en dos huecos.

**El service worker trata distinto al armazón y a las imágenes.** El armazón va
con red primero, para que una versión nueva llegue sin que nadie borre nada; las
imágenes con caché primero y sin caducar. Un **429 nunca se guarda en caché**:
significa «hoy no queda cuota», no «esta carta no tiene imagen», y guardarlo
dejaría el hueco vacío para siempre.

**El primer usuario que se registra se queda de admin.** Si no, no habría nadie
que pudiera arrancar la bajada del catálogo. El resto necesita `CLAVE_REGISTRO`;
si esa variable falta, el registro queda **cerrado**, que es el fallo seguro.

## Configuración

`.env` con permisos 600, nunca en el repositorio:

```
PORT=3003
JWT_SECRET=...
POKEWALLET_API_KEY=pk_live_...
POKEWALLET_BASE_URL=https://api.pokewallet.io/
CLAVE_REGISTRO=...
```

Fuera del repositorio van también `data/l-tcg.sqlite3` (colecciones de los
usuarios) y `data/imagenes/` (la caché, que puede llegar a varios GB).

## Puesta en marcha

```bash
npm install
node server.js          # o systemctl start l-tcg
```

Nginx hace de proxy a `127.0.0.1:3003`; el certificado es de origen de
Cloudflare, y el modo SSL de la zona tiene que seguir en **Full**, no en
«Full (strict)».

`better-sqlite3` está fijado a la serie 11: la última exige Node ≥ 22 y su
binario precompilado **revienta con un segfault** en el Node 20 del servidor,
que es el que usan también l-games y el portal.

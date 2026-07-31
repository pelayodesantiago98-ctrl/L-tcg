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

## Las tres pantallas de cartas

Tienen la misma consulta debajo y solo cambia un filtro, pero son cosas
distintas:

| | Qué enseña |
|---|---|
| **Enciclopedia** | el catálogo entero, decenas de miles de cartas |
| **Mi colección** | solo las que el usuario tiene (`cantidad > 0`) |
| **Deseadas** | lo que le falta y quiere |

Al principio la colección enseñaba el catálogo completo con una casilla de
«solo las que tengo», y era el error de fondo: entrar en «tu colección» y ver
68.000 cartas ajenas no dice nada de la tuya.

**El buscador de cada lista filtra lo que ya se está viendo.** Para añadir hay
otro distinto, el selector (`abrirSelector`), que busca en el catálogo entero
independientemente de la pantalla desde la que se abra. Son dos búsquedas con
propósitos opuestos y por eso están separadas.

En la colección cada tarjeta lleva sus botones de cantidad. Van dentro de la
tarjeta, que abre la ficha al pulsarla, así que el manejador **para la
propagación**: sin eso, subir la cantidad abría también la ficha. Cuando la
cantidad llega a cero la carta deja de ser «mía» y se recarga la lista para que
no quede una tarjeta fantasma.

En el álbum se puede añadir de dos formas: el botón busca en el catálogo y
coloca la carta en el primer hueco libre —y salta a esa página, porque si no
uno añade una carta y no ve que haya pasado nada al haber ido a parar a la
página 7—, o se pulsa directamente un hueco negro para elegir qué poner ahí.
Meter una carta en el álbum marca también que se tiene, salvo que ya hubiera
una cantidad puesta.

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

## Versiones de los estaticos

El index no se sirve tal cual: el servidor le mete en la URL del CSS y del JS
la fecha del fichero (`?v=<mtime>`). Sin eso, los estaticos van con una hora de
cache y **un cambio tarda esa hora en verse**. Paso al anadir el selector de
cartas: la regla nueva no llegaba al navegador y el dialogo salia sin estilos,
con el agravante de que parecia un fallo del codigo y no de la cache.

Dos detalles que costaron un intento cada uno:

- `express.static` sirve `public/index.html` para `/` antes de llegar a la ruta
  que hace la sustitucion. Va con `index: false`.
- La firma que decide si hay que regenerar el HTML incluye la fecha del index
  **y la de cada estatico**. Con solo la del index, tocar el CSS no refrescaba
  nada, que es justo lo que esto venia a arreglar.

El index se sirve con `Cache-Control: no-cache` porque es quien lleva las
versiones de lo demas.

## Rendimiento

Medido sobre la misma base inflada a 74.304 cartas, que es a donde va el
catalogo completo. No son numeros de laboratorio: son las consultas que hace
la web, con los mismos datos antes y despues.

| Consulta | Antes | Despues | |
|---|---|---|---|
| listado por expansion | 39,81 ms | 0,07 ms | 700x |
| ordenar por precio, mas caras | 26,76 ms | 0,07 ms | 389x |
| ordenar por precio, mas baratas | 25,46 ms | 0,14 ms | 188x |
| contar resultados | 17,08 ms | 0,55 ms | 31x |
| sugerencias del autocompletado | 17,31 ms | 0,68 ms | 25x |
| buscar, 60 primeros | 0,22 ms | 0,26 ms | 1,2x mas lento |
| **suma** | **126,63 ms** | **1,75 ms** | **72x** |

Tres cambios, y cada uno ataca una causa distinta:

**`exp_orden`.** El nombre de la expansion, copiado en la propia carta.
Ordenar por una columna de la tabla de al lado obliga a unirlo todo y
ordenarlo en memoria (`USE TEMP B-TREE`), y eso crece con el catalogo aunque
solo se pidan 60 filas. Con la clave en la carta el indice sirve y el LIMIT
corta antes.

**`cartas_fts`.** Indice de texto completo. `LIKE '%algo%'` no puede usar
ningun indice porque el comodin va delante, asi que cada busqueda recorria las
74.000 filas. Buscar los 60 primeros ya era rapido -el recorrido se para al
llenar el limite- y de hecho ahi se pierde un poco; lo que se gana es el
**conteo**, que no puede parar y va en cada listado, y las **sugerencias**, que
saltan con cada tecla.

**Nulos al final sin romper el indice.** Poner `campo IS NULL` delante del
ORDER BY manda los nulos al final, pero es una expresion calculada y con ella
el indice deja de valer. Descendente no lo necesita -en SQLite los nulos ya
caen al final- y ascendente se resuelve con `NULLS LAST`.

El indice de texto ocupa unos 15 MB con el catalogo completo. Es el precio.

### El orden de la migracion importa

Costo una base de datos corrupta. Primero se rellena `exp_orden`, despues se
crea y puebla el indice de texto, y **los disparadores al final**. Al reves, el
UPDATE que rellena la columna toca todas las filas y con los disparadores ya
puestos cada una lanzaba un `delete` contra un indice todavia vacio; un FTS5 de
contenido externo no lo tolera y la base pasa a dar *database disk image is
malformed*. Se recupero tirando la tabla virtual y reconstruyendola: el dano
estaba solo en el indice, no en los datos.

### Lo que NO se toco

Los otros tres sitios responden entre 0,98 y 1,40 ms. No hay nada que ganar
ahi, y cambiar codigo que funciona para no mejorar nada solo anade riesgo.

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

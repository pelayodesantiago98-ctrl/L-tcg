/*
 * L-tcg — aplicación de una sola página.
 *
 * Sin framework a propósito: son seis vistas y el peso de traerse uno no lo
 * paga nadie. El estado vive en `sesion` y en la URL; el enrutado es un
 * switch sobre location.pathname y el servidor devuelve index.html para
 * cualquier ruta que no sea /api, así que recargar en /album funciona.
 */

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const vista = $('#vista');

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const eur = (n) => (n == null ? '—' : Number(n).toLocaleString('es-ES',
  { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }));

/* El brillo (shine/glare/foil) es cosa de la rareza, no de si la tienes: una
   Illustration Rare reluce igual la tengas o no, y una Common no reluce
   aunque la tengas. Lista negra y no blanca porque las rarezas "especiales"
   son muchas y rarísimas (Kagayaku, Mega Ultra Rare...) y lo normal es casi
   siempre Common/Uncommon. */
const SIN_BRILLO = new Set(['Common', 'Uncommon', 'Code Card', 'Unconfirmed', '']);
const esBrillante = (rareza) => !SIN_BRILLO.has(rareza || '');

/* Qué textura de brillo le toca a cada rareza (ver brillo.css, sección
   "Brillos por rareza", para los ocho tipos). La rareza es la de TCGdex —no
   la de pokemontcg.io, que usa otros nombres— así que el mapeo es el suyo:
   "Rare Holo V"/"VMAX"/"VSTAR" no existen como valores sueltos aquí, caen
   mezcladas dentro de "Ultra Rare" u "Holo Rare" según el set, y no hay forma
   de separarlas sin ese dato — por eso todas las V a toda plancha van al
   tipo "ultra" en vez de tener su propio brillo (ver cabecera de brillo.css).
   Lo que no aparece en esta lista (Rare, Promo, Holo Rare, Rare BREAK, Rare
   Holo LEGEND/LV.X, Common Holo, Ultra-Rare Común/Uncommon…) usa el brillo
   genérico de siempre — es la mejor aproximación sin más datos, no una
   certeza; cambiar una entrada de aquí es tan fácil como mover la cadena de
   una lista a otra. */
const TIPO_BRILLO = {
  'Ultra Rare': 'ultra', 'Double Rare': 'ultra', 'Super Rare': 'ultra',
  'Super Rare Holo': 'ultra', 'Illustration Rare': 'ultra', 'Special Art Rare': 'ultra',
  'Art Rare': 'ultra', 'Special Illustration Rare': 'ultra', 'Triple Rare': 'ultra',
  'Character Rare': 'ultra', 'Trainer Rare': 'ultra', 'Futuristic Rare': 'ultra',
  'Mega Ultra Rare': 'ultra', 'Black White Rare': 'ultra', 'Mega Attack Rare': 'ultra',
  'Hyper Rare': 'rainbow', 'Character Super Rare': 'rainbow', 'RGB Rare': 'rainbow',
  'Mega Hyper Rare': 'rainbow',
  'Secret Rare': 'secreta', 'Shiny Secret Rare': 'secreta', 'ACE SPEC Rare': 'secreta',
  'ACE Rare': 'secreta', 'Rare Ace': 'secreta',
  'Shiny Rare': 'shiny', 'Shiny Holo Rare': 'shiny', 'Kagayaku': 'shiny', 'Shining': 'shiny',
  'Shiny Ultra Rare': 'shiny-v',
  'Radiant Rare': 'radiante', 'Prism Rare': 'radiante',
  'Amazing Rare': 'amazing',
  'Classic Collection': 'cosmos',
};
const tipoBrillo = (rareza) => TIPO_BRILLO[rareza] || '';

/* Algunas Ultra Rare (Galarian Gallery, Shining Fates...) tienen el borde
   real amarillo/dorado, pero la mayoría de Ultra Rare lo tienen plateado —
   la rareza sola no distingue las unas de las otras, así que no hay entrada
   de TIPO_BRILLO que pueda decidirlo. Se mira el píxel: en cuanto la imagen
   carga, se promedia un anillo pegado al borde (mismo margen que el padding
   de .foil en brillo.css, 3.9%) y si sale amarillo se marca
   data-borde="amarillo" en el mismo nodo que ya lleva data-brillo, para que
   brillo.css pueda teñir el marco de .foil sin tocar el brillo en sí (ver
   "[data-borde=amarillo] .foil" ahí). Mismo origen que la carta —la imagen
   la sirve esta misma app— así que el lienzo nunca queda "tainted". */
function marcarBordeAmarillo(img) {
  const nodo = img.closest('.perspective-card__artwork--front');
  if (!nodo || !nodo.querySelector('.foil')) return;
  try {
    const w = 24, h = 24;
    const lienzo = document.createElement('canvas');
    lienzo.width = w; lienzo.height = h;
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const borde = Math.max(1, Math.round(w * 0.06));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x >= borde && x < w - borde && y >= borde && y < h - borde) continue;
        const i = (y * w + x) * 4;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n += 1;
      }
    }
    r /= n; g /= n; b /= n;
    if (r > 140 && g > 115 && (r - b) > 55 && (g - b) > 35) nodo.dataset.borde = 'amarillo';
  } catch { /* lo que sea que falle aquí, se queda con el marco plateado de siempre */ }
}

/* Enganchado junto a cada montarBrillo(): para las imágenes que ya están
   cargadas (caché, loading="lazy" que ya entró en viewport) mide ya mismo;
   para el resto, en cuanto carguen. */
function activarBordesAmarillos(raiz) {
  raiz.querySelectorAll('.perspective-card__artwork--front[data-brillo] img').forEach((img) => {
    if (img.complete && img.naturalWidth) marcarBordeAmarillo(img);
    else img.addEventListener('load', () => marcarBordeAmarillo(img), { once: true });
  });
}

/* Una sola puerta de entrada a la API: centraliza el JSON, los errores y el
   401, que siempre significa lo mismo (se cayó la sesión, a la pantalla de
   entrada). */
async function api(ruta, opciones = {}) {
  const res = await fetch('/api' + ruta, {
    credentials: 'same-origin',
    headers: opciones.cuerpo ? { 'Content-Type': 'application/json' } : {},
    method: opciones.metodo || 'GET',
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
  });
  if (res.status === 401 && !ruta.startsWith('/auth/')) {
    sesion.usuario = null;
    ir('/entrar');
    throw new Error('Sesión caducada');
  }
  const datos = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error((datos && datos.error) || `Error ${res.status}`), { status: res.status, datos });
  return datos;
}

const sesion = { usuario: null, filtros: null };

/* Cuando esto está activo, las vistas de colección y álbum son las de otra
   persona: se piden a /api/amigos/<id>/... en vez de a /api/..., y ningún
   control de edición se pinta. Una vez más y no parámetros encadenados por
   cada función, igual que `sesion` o `estadoLista` ya hacen aquí. */
const verAmigo = { activo: false, id: null, nombre: '' };
const rutaApi = (p) => (verAmigo.activo ? `/amigos/${verAmigo.id}${p}` : p);

// El aviso que se repite en colección, deseadas y álbumes al ver a un amigo.
const bannerAmigo = () => !verAmigo.activo ? '' : `
  <p class="panel aviso-amigo">Viendo lo de <b>${esc(verAmigo.nombre)}</b> · solo lectura
    <a class="link-btn" href="/amigos" data-ruta>Volver a Amigos</a></p>`;

// ── Enrutado ───────────────────────────────────────────────────────────────

/* Donde se aterriza: la raiz y el salto de despues de entrar. Aqui y no
   repartido, que antes eran dos literales que habia que cambiar a la vez. */
const INICIO = '/enciclopedia';

const RUTAS = {
  '/entrar': vistaEntrada,
  '/registro': vistaRegistro,
  '/coleccion': (p) => vistaColeccion(p, { modo: 'mias' }),
  '/enciclopedia': vistaEnciclopedia,
  '/deseadas': (p) => vistaColeccion(p, { modo: 'deseadas' }),
  '/albumes': vistaAlbumes,
  '/album': vistaAlbum,
  '/perfil': vistaPerfil,
  '/admin': vistaAdmin,
  '/amigos': vistaAmigos,
};

function ir(ruta, reemplazar = false) {
  if (reemplazar) history.replaceState({}, '', ruta); else history.pushState({}, '', ruta);
  pintar();
}

async function pintar() {
  const ruta = location.pathname === '/' ? (sesion.usuario ? INICIO : '/entrar') : location.pathname;
  const base = '/' + ruta.split('/')[1];
  const publica = base === '/entrar' || base === '/registro';

  if (!sesion.usuario && !publica) return ir('/entrar', true);
  if (sesion.usuario && publica) return ir(INICIO, true);

  $('#topbar').hidden = !sesion.usuario;
  document.querySelectorAll('.nav a[data-ruta]').forEach((a) => {
    a.classList.toggle('activo', a.getAttribute('href') === base);
  });

  const fn = RUTAS[base];
  limpiarBrillo();
  // Se resetea aquí y no al salir de las vistas de amigo: así da igual por
  // dónde se navegue después, siempre se vuelve a "lo mío" por defecto.
  if (base !== '/amigos') { verAmigo.activo = false; verAmigo.id = null; verAmigo.nombre = ''; }
  vista.innerHTML = '<div class="cargando"><div class="girando"></div></div>';
  try {
    await (fn ? fn(ruta) : vistaNoEncontrada());
  } catch (e) {
    vista.innerHTML = `<div class="wrap"><p class="error">${esc(e.message)}</p></div>`;
  }
}

addEventListener('popstate', pintar);

document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[data-ruta]');
  if (a && a.origin === location.origin) { ev.preventDefault(); cerrarMenu(); ir(a.getAttribute('href')); }
});

// ── Cabecera ───────────────────────────────────────────────────────────────

const iniciales = (u) => (u.nombre || u.usuario || '?').trim().split(/\s+/)
  .slice(0, 2).map((p) => p[0]).join('').toUpperCase();

function cabecera() {
  if (!sesion.usuario) return;
  $('#avatar').textContent = iniciales(sesion.usuario);
  $('#menu-perfil-nombre').textContent = sesion.usuario.nombre || sesion.usuario.usuario;
  $('#menu-perfil-rol').textContent = sesion.usuario.rol === 'admin' ? 'Administrador' : 'Usuario';
  ponerFotoDelPortal();
  const admin = sesion.usuario.rol === 'admin';
  /* Ya no esta en la barra —las secciones se fueron al menu— pero se
     comprueba en vez de darlo por hecho: asi no revienta si vuelve. */
  const enBarra = $('#nav-admin');
  if (enBarra) enBarra.hidden = !admin;
  $('#menu-admin').hidden = !admin;
  medirBarra();
}

const cerrarMenu = () => { $('#menu').hidden = true; $('#avatar').setAttribute('aria-expanded', 'false'); };

$('#avatar').addEventListener('click', (ev) => {
  ev.stopPropagation();
  const m = $('#menu');
  m.hidden = !m.hidden;
  $('#avatar').setAttribute('aria-expanded', String(!m.hidden));
});
document.addEventListener('click', (ev) => { if (!ev.target.closest('#menu')) cerrarMenu(); });

$('#salir').addEventListener('click', async () => {
  await api('/auth/logout', { metodo: 'POST' });
  sesion.usuario = null;
  cerrarMenu();
  ir('/entrar');
});

// ── Entrada ────────────────────────────────────────────────────────────────

function vistaEntrada() {
  vista.innerHTML = `
  <div class="entrada"><form class="caja-entrada" id="f">
    <h1>L-tcg</h1>
    <p class="subtitle">Tu colección de cartas Pokémon.</p>
    <div id="msg"></div>
    <div class="campo"><label for="u">Usuario</label>
      <input id="u" name="usuario" type="text" autocomplete="username" required autofocus></div>
    <div class="campo"><label for="p">Contraseña</label>
      <input id="p" name="clave" type="password" autocomplete="current-password" required></div>
    <button class="btn" type="submit">Entrar</button>
    <p class="subtitle" style="margin-top:1rem">
      ¿No tienes cuenta? <a href="/registro" data-ruta>Crear una</a>
    </p>
  </form></div>`;

  $('#f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const boton = $('#f button');
    boton.disabled = true;
    try {
      const r = await api('/auth/login', { metodo: 'POST', cuerpo: {
        usuario: $('#u').value, clave: $('#p').value } });
      sesion.usuario = r.usuario;
      cabecera();
      ir(INICIO);
    } catch (e) {
      $('#msg').innerHTML = `<p class="error">${esc(e.message)}</p>`;
      boton.disabled = false;
    }
  });
}

function vistaRegistro() {
  vista.innerHTML = `
  <div class="entrada"><form class="caja-entrada" id="f">
    <h1>Crear cuenta</h1>
    <p class="subtitle">Hace falta la contraseña de administrador.</p>
    <div id="msg"></div>
    <div class="campo"><label for="n">Nombre y apellidos</label>
      <input id="n" type="text" autocomplete="name"></div>
    <div class="campo"><label for="u">Usuario</label>
      <input id="u" type="text" autocomplete="username" required></div>
    <div class="campo"><label for="p">Contraseña</label>
      <input id="p" type="password" autocomplete="new-password" required></div>
    <div class="campo"><label for="p2">Confirmar contraseña</label>
      <input id="p2" type="password" autocomplete="new-password" required></div>
    <div class="campo"><label for="a">Contraseña de administrador</label>
      <input id="a" type="password" autocomplete="off"></div>
    <button class="btn" type="submit">Crear cuenta</button>
    <p class="subtitle" style="margin-top:1rem">
      ¿Ya tienes? <a href="/entrar" data-ruta>Entrar</a>
    </p>
  </form></div>`;

  $('#f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const boton = $('#f button');
    boton.disabled = true;
    try {
      const r = await api('/auth/registro', { metodo: 'POST', cuerpo: {
        usuario: $('#u').value, nombre: $('#n').value, clave: $('#p').value,
        clave2: $('#p2').value, claveRegistro: $('#a').value } });
      sesion.usuario = r.usuario;
      cabecera();
      ir(INICIO);
    } catch (e) {
      $('#msg').innerHTML = `<p class="error">${esc(e.message)}</p>`;
      boton.disabled = false;
    }
  });
}

// ── Enciclopedia por colecciones ────────────────────────────────────────────

// Texto pendiente de buscar cuando se viene de la galería al cuadro "_buscar".
let busquedaPendiente = '';

// Una pokéball en vez del icono de "imagen rota": para las colecciones sin
// logo real (ver categoria.md / herramientas de logos) es más propio del
// tema que un icono genérico de foto, y el nombre ya va debajo de todas
// formas. Todo en currentColor salvo el botón central, que usa el fondo de
// la propia tarjeta para que el "hueco" del centro se vea bien en cualquier
// tema (oscuro, Crystal...).
const ICONO_COLECCION_GENERICO = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 2a10 10 0 0 1 10 9.3H2A10 10 0 0 1 12 2Z" fill="currentColor"/>
  <circle cx="12" cy="12" r="9.3" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <line x1="2.3" y1="12" x2="21.7" y2="12" stroke="currentColor" stroke-width="1.4"/>
  <circle cx="12" cy="12" r="3" fill="var(--card-solido)" stroke="currentColor" stroke-width="1.4"/>
  <circle cx="12" cy="12" r="1.2" fill="currentColor"/>
</svg>`;

async function vistaEnciclopedia(ruta) {
  const partes = ruta.split('/').filter(Boolean);   // ['enciclopedia'] o ['enciclopedia', setCode|'_buscar']
  if (partes.length === 1) return vistaGaleriaColecciones();
  if (partes[1] === '_buscar') {
    return vistaColeccion(ruta, { modo: 'todas', busquedaInicial: busquedaPendiente });
  }
  return vistaColeccion(ruta, { modo: 'todas', expansionFija: decodeURIComponent(partes[1]) });
}

/*
 * Categoria la calcula un script de clasificación aparte (set_code/nombre
 * contra patrones: McDonald's, Promos, Trainer Kit, Extended Art...) y la
 * deja en expansiones.categoria — no hay forma fiable de derivarla al vuelo
 * aquí porque la propia API de origen no distingue "expansión principal" de
 * "promo suelta", todo llega mezclado bajo el mismo idioma. Si aparece una
 * colección nueva mal metida en el cajón que no le toca, se corrige esa fila
 * a mano y punto, no hace falta tocar esto.
 */
const CATEGORIA_NOMBRE = {
  principal: 'Colecciones principales',
  extended: 'Extended Art',
  play: 'Play! Pokémon',
  kits: 'Kits y mazos',
  extras: 'Promos y extras',
  japones: 'Japonés',
  chino: 'Chino',
};

async function vistaGaleriaColecciones() {
  if (!sesion.filtros) sesion.filtros = await api('/filtros');
  const exps = sesion.filtros.expansiones; // ya trae logo_url, categoria, cartas, fecha_orden…

  vista.innerHTML = `
  <div class="wrap">
    <div class="head"><h1 class="title">Enciclopedia</h1>
      <p class="subtitle">Elige una colección, o busca una carta en concreto.</p></div>

    <div class="panel">
      <div class="buscador">
        <input id="buscar-global" type="search" placeholder="Buscar carta por nombre o número" autocomplete="off">
      </div>
    </div>

    <div class="fila" id="categorias-coleccion" style="margin:1rem 0;flex-wrap:wrap">
      <label class="chip"><input type="radio" name="cat" value="" checked style="width:auto"> Todas</label>
      ${Object.entries(CATEGORIA_NOMBRE).map(([k, t]) =>
        `<label class="chip"><input type="radio" name="cat" value="${k}" style="width:auto"> ${t}</label>`).join('')}
    </div>

    <div class="rejilla-colecciones" id="galeria-colecciones"></div>
  </div>`;

  const pintar = (categoria) => {
    const lista = (categoria ? exps.filter((e) => e.categoria === categoria) : exps)
      .filter((e) => e.cartas > 0);
    // Con logo no hace falta repetir el nombre debajo -el logo ya lo dice-,
    // y se usa `hidden` y no una clase de CSS: así no hay forma de que el
    // genérico y el nombre queden puestos a la vez que la imagen y se
    // solapen, sea cual sea el tamaño real del logo.
    $('#galeria-colecciones').innerHTML = lista.map((e) => `
      <a class="tarjeta-coleccion" href="/enciclopedia/${encodeURIComponent(e.set_code)}" data-ruta>
        <span class="tarjeta-coleccion-logo">
          ${e.logo_url ? `<img loading="lazy" src="${esc(e.logo_url)}" alt="${esc(e.nombre)}"
              onerror="this.remove();
                       this.closest('.tarjeta-coleccion').querySelector('.tarjeta-coleccion-generico').hidden=false;
                       this.closest('.tarjeta-coleccion').querySelector('.tarjeta-coleccion-nombre').hidden=false;">` : ''}
          <span class="tarjeta-coleccion-generico" aria-hidden="true"${e.logo_url ? ' hidden' : ''}>${ICONO_COLECCION_GENERICO}</span>
        </span>
        <span class="tarjeta-coleccion-nombre"${e.logo_url ? ' hidden' : ''}>${esc(e.nombre)}</span>
        <span class="tarjeta-coleccion-meta">${e.tenidas} / ${e.cartas} cartas</span>
        <span class="barra tarjeta-coleccion-barra"><div style="width:${e.cartas ? Math.round(e.tenidas / e.cartas * 100) : 0}%"></div></span>
      </a>`).join('') || '<p class="vacio">No hay colecciones en esta categoría.</p>';
  };
  pintar('');

  vista.querySelectorAll('input[name=cat]').forEach((r) => {
    r.addEventListener('change', (ev) => pintar(ev.target.value));
  });

  const irABuscar = () => {
    const q = $('#buscar-global').value.trim();
    if (!q) return;
    busquedaPendiente = q;
    ir('/enciclopedia/_buscar');
  };
  $('#buscar-global').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') irABuscar(); });
}

// ── Colección ──────────────────────────────────────────────────────────────

const estadoLista = {
  q: '', expansion: '', rareza: '', tipo: '', orden: 'expansion', dir: 'asc',
  mias: false, deseadas: false, faltan: false, pagina: 1, modo: 'todas',
};

/*
 * Tres pantallas con la misma consulta debajo; lo único que cambia es un
 * filtro. La enciclopedia enseña el catálogo entero —decenas de miles de
 * cartas— y la colección solo lo que uno tiene, que es lo que se mira a
 * diario. Mezclarlas era el problema: entrar en "colección" y ver 68.000
 * cartas ajenas no dice nada de la tuya.
 */
const MODOS = {
  todas: {
    titulo: 'Enciclopedia',
    sub: 'Todas las cartas que existen. Desde aquí las añades a tu colección y a tu álbum.',
    vacio: 'No hay cartas que encajen.',
  },
  mias: {
    titulo: 'Mi colección',
    sub: 'Solo las cartas que tienes. Para añadir más, ve a la enciclopedia.',
    vacio: 'Todavía no tienes ninguna carta. Ve a la enciclopedia y añade la primera.',
  },
  deseadas: {
    titulo: 'Cartas deseadas',
    sub: 'Lo que te falta y quieres conseguir.',
    vacio: 'No tienes ninguna carta en la lista de deseadas.',
  },
};

async function vistaColeccion(ruta, opciones = {}) {
  if (!sesion.filtros) sesion.filtros = await api('/filtros');
  const f = sesion.filtros;
  const modo = MODOS[opciones.modo] ? opciones.modo : 'todas';
  const coleccion = opciones.expansionFija && f.expansiones.find((e) => e.set_code === opciones.expansionFija);
  Object.assign(estadoLista, {
    modo,
    mias: modo === 'mias',
    deseadas: modo === 'deseadas',
    faltan: false, q: opciones.busquedaInicial || '',
    expansion: opciones.expansionFija || '', rareza: '', tipo: '', pagina: 1,
  });

  const opts = (lista, valor, texto = (x) => x, val = (x) => x) =>
    lista.map((x) => `<option value="${esc(val(x))}"${val(x) === valor ? ' selected' : ''}>${esc(texto(x))}</option>`).join('');

  const titulo = coleccion ? coleccion.nombre
    : verAmigo.activo ? `${MODOS[modo].titulo} de ${esc(verAmigo.nombre)}` : MODOS[modo].titulo;
  vista.innerHTML = `
  <div class="wrap">
    <div class="head">
      <h1 class="title">${esc(titulo)}</h1>
      <p class="subtitle">${coleccion ? `${coleccion.cartas} cartas · ${esc(coleccion.fecha || '')}` : MODOS[modo].sub}</p>
      <p class="subtitle" id="resumen">…</p>
    </div>
    ${coleccion ? `
    <div class="fila" style="align-items:center;margin-bottom:.8rem">
      <a class="link-btn crece" href="/enciclopedia" data-ruta>← Volver a Enciclopedia</a>
      ${verAmigo.activo ? '' : '<button class="btn btn-suave btn-pequeno" id="crear-album-coleccion">+ Crear álbum de esta colección</button>'}
    </div>` : ''}
    ${bannerAmigo()}

    ${modo !== 'deseadas' || verAmigo.activo ? '' : `
    <div class="panel panel-anadir">
      <div class="fila">
        <div class="crece">
          <b>Añadir una carta</b>
          <p class="carta-meta" style="margin:.1rem 0 0">
            Busca entre todas las cartas del catálogo, no solo entre las tuyas.</p>
        </div>
        <button class="btn" id="anadir">+ Añadir carta</button>
      </div>
      <div class="fila" style="margin-top:.6rem">
        <div class="crece">
          <b>Exportar para Cardmarket</b>
          <p class="carta-meta" style="margin:.1rem 0 0">
            Genera la lista en el formato del importador de wants.</p>
        </div>
        <button class="btn btn-suave" id="exportar">Exportar</button>
      </div>
    </div>
    <div class="panel" id="exportacion" hidden></div>`}

    <div class="panel">
      <div class="fila">
        <div class="buscador">
          <input id="q" type="search" placeholder="${modo === 'mias' ? 'Filtrar entre mis cartas' : 'Buscar carta por nombre o número'}"
                 autocomplete="off" value="${esc(estadoLista.q)}">
          <div class="sugerencias" id="sug" hidden></div>
        </div>
        <select id="expansion" style="flex:0 1 15rem">
          <option value="">Todas las expansiones</option>
          ${opts(f.expansiones, '', (e) => `${e.nombre} (${e.cartas})`, (e) => e.set_code)}
        </select>
        <select id="rareza" style="flex:0 1 10rem">
          <option value="">Toda rareza</option>${opts(f.rarezas, '')}
        </select>
        <select id="tipo" style="flex:0 1 9rem">
          <option value="">Todo tipo</option>${opts(f.tipos, '')}
        </select>
      </div>
      <div class="fila" style="margin-top:.6rem">
        <select id="orden" style="flex:0 1 12rem">
          <option value="expansion">Por expansión</option>
          <option value="nombre">Por nombre</option>
          <option value="numero">Por número</option>
          <option value="rareza">Por rareza</option>
          <option value="precio">Por precio</option>
          <option value="fecha">Por fecha de salida</option>
        </select>
        <select id="dir" style="flex:0 1 8rem">
          <option value="asc">Ascendente</option>
          <option value="desc">Descendente</option>
        </select>
        ${modo === 'todas' ? `
        <label class="chip"><input type="checkbox" id="mias" style="width:auto"> Solo las que tengo</label>
        <label class="chip"><input type="checkbox" id="faltan" style="width:auto"> Solo las que me faltan</label>` : ''}
        <span class="derecha chip" id="cuenta"></span>
      </div>
    </div>

    <div id="lista"><div class="cargando"><div class="girando"></div></div></div>
    <div class="fila" style="justify-content:center;margin-top:1.2rem" id="paginacion"></div>
  </div>`;

  $('#orden').value = estadoLista.orden;
  $('#dir').value = estadoLista.dir;

  const recargar = () => { estadoLista.pagina = 1; cargarLista(); };
  $('#expansion').addEventListener('change', (e) => { estadoLista.expansion = e.target.value; recargar(); });
  $('#rareza').addEventListener('change', (e) => { estadoLista.rareza = e.target.value; recargar(); });
  $('#tipo').addEventListener('change', (e) => { estadoLista.tipo = e.target.value; recargar(); });
  $('#orden').addEventListener('change', (e) => { estadoLista.orden = e.target.value; recargar(); });
  $('#dir').addEventListener('change', (e) => { estadoLista.dir = e.target.value; recargar(); });
  // Estas dos solo existen en la enciclopedia.
  $('#mias')?.addEventListener('change', (e) => { estadoLista.mias = e.target.checked; recargar(); });
  $('#faltan')?.addEventListener('change', (e) => { estadoLista.faltan = e.target.checked; recargar(); });

  // Solo queda en deseadas: en la colección se añade desde la enciclopedia.
  $('#anadir')?.addEventListener('click', () => abrirSelector({
    titulo: 'Añadir a deseadas',
    accion: 'Quiero esta',
    conCantidad: false,
    async alElegir(carta) {
      await api(`/cartas/${encodeURIComponent(carta.id)}/marcar`, { metodo: 'POST',
        cuerpo: { deseada: true } });
      cargarResumen();
      cargarLista();
    },
  }));

  $('#exportar')?.addEventListener('click', montarExportacion);

  $('#crear-album-coleccion')?.addEventListener('click', async (ev) => {
    const boton = ev.currentTarget;
    boton.disabled = true;
    boton.textContent = 'Creando…';
    try {
      const paginas = Math.max(1, Math.ceil(coleccion.cartas / 9));
      const b = await api('/binder', { metodo: 'POST', cuerpo: { nombre: coleccion.nombre, slots: 9, paginas } });
      await api(`/binder/${b.id}/rellenar`, { metodo: 'POST', cuerpo: { setCode: coleccion.set_code, desdePagina: 1 } });
      album.id = b.id; album.pagina = 1;
      ir('/album');
    } catch (e) {
      alert(e.message);
      boton.disabled = false;
      boton.textContent = '+ Crear álbum de esta colección';
    }
  });

  montarBuscador();
  cargarResumen();
  cargarLista();
}

/* Vuelca las deseadas en cajas de texto listas para pegar en Cardmarket. Se
   parte en varias porque una wants list no admite mas de 150 entradas, y las
   que no se pueden exportar se listan aparte con su enlace en vez de colarlas
   en el texto: si van dentro, el importador las rechaza en silencio y no hay
   forma de saber cuales faltaron. */
async function montarExportacion() {
  const caja = $('#exportacion');
  if (!caja) return;
  if (!caja.hidden) { caja.hidden = true; return; }
  caja.hidden = false;
  caja.innerHTML = '<div class="cargando"><div class="girando"></div></div>';

  let datos;
  try {
    datos = await api('/deseadas/exportar');
  } catch (e) {
    caja.innerHTML = `<p class="carta-meta">No se pudo generar la lista: ${esc(e.message)}</p>`;
    return;
  }

  const { bloques, sinDatos, total, exportadas, tope } = datos;
  const partes = [`
    <div class="fila">
      <div class="crece">
        <b>Listas para Cardmarket</b>
        <p class="carta-meta" style="margin:.1rem 0 0">
          ${exportadas} de ${total} deseadas, en ${bloques.length}
          ${bloques.length === 1 ? 'lista' : 'listas'} de ${tope} como mucho.
          Pega cada bloque en una wants list distinta.</p>
      </div>
      <button class="link-btn" id="exp-cerrar">Cerrar</button>
    </div>`];

  bloques.forEach((lineas, i) => {
    partes.push(`
      <div style="margin-top:.9rem">
        <div class="fila">
          <b class="crece">Lista ${i + 1} de ${bloques.length} · ${lineas.length} cartas</b>
          <button class="btn btn-pequeno" data-copiar="${i}">Copiar</button>
        </div>
        <textarea id="exp-txt-${i}" readonly rows="8" spellcheck="false"
          style="width:100%;margin-top:.4rem;font-family:ui-monospace,monospace;font-size:.8rem"
        >${esc(lineas.join('\n'))}</textarea>
      </div>`);
  });

  if (sinDatos.length) {
    partes.push(`
      <div style="margin-top:1rem">
        <b>${sinDatos.length} sin ataques guardados</b>
        <p class="carta-meta" style="margin:.1rem 0 .5rem">
          Cardmarket no admite un Pokémon solo por el nombre, así que estas no
          entran en la lista. Añádelas a mano desde su ficha.</p>
        <ul class="carta-meta" style="margin:0;padding-left:1.1rem">
          ${sinDatos.map((c) => `<li>${c.url
            ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.nombre)}</a>`
            : esc(c.nombre)}${c.expansion ? ` · ${esc(c.expansion)}` : ''}</li>`).join('')}
        </ul>
      </div>`);
  }

  caja.innerHTML = partes.join('');
  $('#exp-cerrar').addEventListener('click', () => { caja.hidden = true; });

  caja.querySelectorAll('[data-copiar]').forEach((boton) => {
    boton.addEventListener('click', async () => {
      const texto = $(`#exp-txt-${boton.dataset.copiar}`).value;
      try {
        await navigator.clipboard.writeText(texto);
        const antes = boton.textContent;
        boton.textContent = 'Copiado';
        setTimeout(() => { boton.textContent = antes; }, 1500);
      } catch {
        // Sin permiso de portapapeles queda seleccionar y copiar a mano.
        $(`#exp-txt-${boton.dataset.copiar}`).select();
      }
    });
  });
}

/* Buscador con autocompletado. Se espera a que el usuario deje de teclear
   250 ms antes de preguntar, porque si no cada letra son dos consultas: la
   de sugerencias y la de la lista. */
function montarBuscador() {
  const caja = $('#q'), sug = $('#sug');
  let temporizador = null, marcada = -1;

  const cerrar = () => { sug.hidden = true; marcada = -1; };

  caja.addEventListener('input', () => {
    estadoLista.q = caja.value.trim();
    clearTimeout(temporizador);
    temporizador = setTimeout(async () => {
      estadoLista.pagina = 1;
      cargarLista();
      if (estadoLista.q.length < 2) return cerrar();
      try {
        const r = await api('/sugerencias?q=' + encodeURIComponent(estadoLista.q));
        if (!r.sugerencias.length) return cerrar();
        sug.innerHTML = r.sugerencias.map((s) => `<button type="button">${esc(s)}</button>`).join('');
        sug.hidden = false;
        marcada = -1;
      } catch { cerrar(); }
    }, 250);
  });

  // Flechas y Enter, que es como se usa un autocompletado de verdad.
  caja.addEventListener('keydown', (ev) => {
    const items = [...sug.querySelectorAll('button')];
    if (sug.hidden || !items.length) { if (ev.key === 'Escape') cerrar(); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      marcada = (marcada + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((b, i) => b.classList.toggle('marcada', i === marcada));
    } else if (ev.key === 'Enter' && marcada >= 0) {
      ev.preventDefault();
      items[marcada].click();
    } else if (ev.key === 'Escape') cerrar();
  });

  sug.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    caja.value = b.textContent;
    estadoLista.q = b.textContent;
    cerrar();
    estadoLista.pagina = 1;
    cargarLista();
  });

  document.addEventListener('click', (ev) => { if (!ev.target.closest('.buscador')) cerrar(); });
}

async function cargarResumen() {
  try {
    const { resumen } = await api(rutaApi('/resumen'));
    const el = $('#resumen');
    if (el) el.innerHTML = `${resumen.totales} cartas · ${resumen.distintas} distintas · ` +
      `valor ${eur(resumen.valor)} · ${resumen.deseadas} deseadas · catálogo de ${resumen.catalogo}`;
  } catch {}
}

function paramsLista() {
  const p = new URLSearchParams();
  const e = estadoLista;
  if (e.q) p.set('q', e.q);
  if (e.expansion) p.set('expansion', e.expansion);
  if (e.rareza) p.set('rareza', e.rareza);
  if (e.tipo) p.set('tipo', e.tipo);
  if (e.mias) p.set('mias', '1');
  if (e.deseadas) p.set('deseadas', '1');
  if (e.faltan) p.set('faltan', '1');
  p.set('orden', e.orden); p.set('dir', e.dir);
  p.set('pagina', e.pagina); p.set('limite', '60');
  return p.toString();
}

async function cargarLista() {
  const caja = $('#lista');
  if (!caja) return;
  try {
    const r = await api(rutaApi('/cartas?' + paramsLista()));
    const cuenta = $('#cuenta');
    if (cuenta) cuenta.textContent = `${r.total} carta${r.total === 1 ? '' : 's'}`;

    if (!r.cartas.length) {
      caja.innerHTML = `<p class="vacio">${
        estadoLista.q ? 'No hay cartas que encajen.' : MODOS[estadoLista.modo].vacio}</p>`;
      $('#paginacion').innerHTML = '';
      return;
    }

    limpiarBrillo();
    caja.innerHTML = `<div class="rejilla">${r.cartas.map(tarjeta).join('')}</div>`;
    /* El mismo giro y la misma ampliación de verdad que en el álbum: cada
       carta de la rejilla es un ClickablePerspectiveCard, no un modal propio.
       `ambient: 0` y no el -1 del álbum: con -1 la librería monta la carta con
       "display:none" (clase .intersection-off) hasta que su propio
       IntersectionObserver confirma que está a la vista, y aquí ese aviso no
       siempre llega a tiempo —la rejilla se repinta entera en cada filtro,
       justo cuando el observador necesita que el layout ya esté asentado—,
       así que la carta se queda invisible y sin poder abrirse por un clic que
       no tiene nada que pulsar. Con 0 no se oculta nunca de entrada: el coste
       es una idea de movimiento ambiental en vez de quietud total, a cambio
       de que la carta siempre se pueda abrir. */
    montarBrillo(caja, { zoom: 6, intensity: 4, duration: 800, closeButtonLabel: 'Cerrar', ambient: 0 },
      window.WTCPerspectiveCard && WTCPerspectiveCard.ClickablePerspectiveCard);
    activarBordesAmarillos(caja);

    // Los botones de cantidad van dentro de la tarjeta: sin parar la
    // propagación, subir la cantidad abriría también la carta.
    caja.querySelectorAll('.cantidad button').forEach((b) => {
      b.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const caja2 = b.closest('.cantidad');
        const span = caja2.querySelector('span');
        const nueva = Math.max(0, Number(span.textContent) + Number(b.dataset.mas));
        const res = await api(`/cartas/${encodeURIComponent(caja2.dataset.id)}/marcar`,
          { metodo: 'POST', cuerpo: { cantidad: nueva } });
        span.textContent = res.cantidad;
        cargarResumen();
        // Al llegar a cero la carta deja de ser "mía" y desaparece de la
        // lista; se recarga para que no quede una tarjeta fantasma.
        if (res.cantidad === 0 && estadoLista.modo === 'mias') cargarLista();
      });
    });
    pintarPaginacion(r);
  } catch (e) {
    caja.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

/* La misma estructura que casilla() en el álbum, con el mismo
   ClickablePerspectiveCard: ver montarBrillo() en cargarLista(). El brillo
   depende de esBrillante(c.rareza), no de si la tienes — igual que allí. */
const tarjeta = (c) => `
<article class="carta" data-id="${esc(c.id)}">
  <div class="carta-imagen">
    <div class="perspective-card">
      <div class="perspective-card__transformer">
        <div class="perspective-card__artwork perspective-card__artwork--front"${esBrillante(c.rareza) && tipoBrillo(c.rareza) ? ` data-brillo="${tipoBrillo(c.rareza)}"` : ''}>
          <img alt="${esc(c.nombre)}"
               src="/api/imagen/${encodeURIComponent(c.id)}?size=low"
               onerror="this.style.visibility='hidden'">
          ${esBrillante(c.rareza) ? `<div class="shine" aria-hidden="true"></div><div class="glare" aria-hidden="true"></div>
          <div class="foil" aria-hidden="true"><div class="iri"></div></div>` : ''}
        </div>
        <div class="perspective-card__artwork perspective-card__artwork--back" aria-hidden="true"></div>
      </div>
      <div class="perspective-card__shine"></div>
    </div>
  </div>
  <div class="marcas">
    ${c.cantidad > 0 ? `<span class="marca marca-tengo">${c.cantidad}</span>` : ''}
    ${c.deseada ? '<span class="marca marca-deseo">♥</span>' : ''}
  </div>
  <div class="carta-cuerpo">
    <p class="carta-nombre">${esc(c.nombre)}</p>
    <p class="carta-meta">${esc(c.numero || '')} · ${esc(c.expansion || '')}</p>
    <p class="carta-meta carta-precio">${c.precio_avg == null ? 'sin precio' : eur(c.precio_avg)}</p>
    ${estadoLista.modo === 'mias' && !verAmigo.activo ? `
    <div class="cantidad" data-id="${esc(c.id)}">
      <button type="button" data-mas="-1" aria-label="Quitar una">−</button>
      <span>${c.cantidad}</span>
      <button type="button" data-mas="1" aria-label="Añadir una">+</button>
    </div>` : ''}
  </div>
</article>`;

function pintarPaginacion(r) {
  const el = $('#paginacion');
  if (!el) return;
  if (r.paginas <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button class="btn btn-suave" ${r.pagina <= 1 ? 'disabled' : ''} data-p="${r.pagina - 1}">Anterior</button>
    <span class="chip">Página ${r.pagina} de ${r.paginas}</span>
    <button class="btn btn-suave" ${r.pagina >= r.paginas ? 'disabled' : ''} data-p="${r.pagina + 1}">Siguiente</button>`;
  el.querySelectorAll('button[data-p]').forEach((b) => b.addEventListener('click', () => {
    estadoLista.pagina = Number(b.dataset.p);
    cargarLista();
    scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

// ── Ficha de una carta ─────────────────────────────────────────────────────

/*
 * El contenido de una ficha —precio, cantidad, deseados, álbum— aparte de la
 * imagen: lo usan el panel que se engancha al diálogo de ClickablePerspectiveCard,
 * tanto en el álbum como en la colección y la enciclopedia (ver el oyente de
 * perspectivecard:opened, más abajo), que es quien pone ahí la animación y
 * el giro de verdad de holonook.es. `conCerrar` no hace falta ahí: el
 * diálogo ya trae su propio botón de cerrar, puesto por la librería.
 */
/* A propósito solo nombre, precios y el enlace a Cardmarket: es lo que cabe
   bien en el panel bajo que deja sitio a la carta (ver .panel-carta-album en
   brillo.css). Cantidad/deseada/álbum se gestionan desde la rejilla, no
   desde aquí. */
function infoCartaHTML(c, binders, { conCerrar = true } = {}) {
  return `
    <h2>${esc(c.nombre)}</h2>
    <div class="precios">
      <div class="precio-caja"><b>${eur(c.precio_avg)}</b><span>media</span></div>
      <div class="precio-caja"><b>${eur(c.precio_low)}</b><span>mínimo</span></div>
      <div class="precio-caja"><b>${eur(c.precio_avg7)}</b><span>7 días</span></div>
      <div class="precio-caja"><b>${eur(c.precio_trend)}</b><span>tendencia</span></div>
    </div>
    <p class="fila" style="margin-top:.8rem">
      ${c.cm_url ? `<a class="link-btn" href="${esc(c.cm_url)}" target="_blank" rel="noopener">Ver en Cardmarket</a>` : ''}
      ${conCerrar ? '<button class="link-btn derecha" id="cerrar">Cerrar</button>' : ''}
    </p>`;
}

/* Engancha los botones de infoCartaHTML() dentro de `raiz`, sea el modal
   propio o el panel del álbum. */
function cablearInfoCarta(raiz, c, binders) {
  let cantidad = c.cantidad, deseada = !!c.deseada;
  const marcar = async (cambio) => {
    const r = await api(`/cartas/${encodeURIComponent(c.id)}/marcar`, { metodo: 'POST', cuerpo: cambio });
    cantidad = r.cantidad; deseada = !!r.deseada;
    raiz.querySelector('#cant').textContent = `Tengo ${cantidad}`;
    const b = raiz.querySelector('#deseo');
    b.textContent = deseada ? '♥ En deseadas' : '♡ Quiero esta';
    b.classList.toggle('btn-suave', !deseada);
    cargarResumen();
    cargarLista();
  };
  raiz.querySelector('#mas')?.addEventListener('click', () => marcar({ cantidad: cantidad + 1 }));
  raiz.querySelector('#menos')?.addEventListener('click', () => marcar({ cantidad: Math.max(0, cantidad - 1) }));
  raiz.querySelector('#deseo')?.addEventListener('click', () => marcar({ deseada: !deseada }));

  /* Va al primer hueco libre, y el servidor devuelve en qué página cayó: sin
     decirlo, uno pulsa el botón y no ve que haya pasado nada. Poner una carta
     en el álbum marca además que se tiene, si no había cantidad. */
  raiz.querySelector('#al-album')?.addEventListener('click', async (ev) => {
    const boton = ev.currentTarget;
    const cual = raiz.querySelector('#cual-album');
    const binderId = cual ? Number(cual.value) : binders[0].id;
    boton.disabled = true;
    boton.textContent = 'Colocando…';
    try {
      const r = await api(`/binder/${binderId}/anadir`, { metodo: 'POST',
        cuerpo: { cartaId: c.id, cantidad: 1 } });
      boton.textContent = `✓ En la página ${r.pagina}`;
      if (!cantidad) {
        cantidad = 1;
        raiz.querySelector('#cant').textContent = 'Tengo 1';
      }
      cargarResumen();
      cargarLista();
      // Si la ficha se abrió desde el propio álbum, la hoja de debajo acaba
      // de cambiar. cargarPagina() se retira sola si no hay hoja delante.
      cargarPagina();
    } catch (e) {
      boton.disabled = false;
      boton.textContent = '+ Poner en el álbum';
      alert(e.message);
    }
  });
}

// ── Selector de cartas ─────────────────────────────────────────────────────

/*
 * Buscador sobre TODO el catálogo, para añadir cartas desde la colección o
 * desde el álbum. Va aparte del buscador de cada lista porque busca otra cosa:
 * aquel filtra lo que ya se está viendo, este busca entre las decenas de miles
 * que existen.
 */
function abrirSelector({ titulo, accion = 'Añadir', conCantidad = true, alElegir }) {
  const velo = document.createElement('div');
  velo.className = 'velo';
  velo.innerHTML = `
    <div class="selector">
      <div class="fila">
        <h2 style="margin:0;font-size:1.1rem" class="crece">${esc(titulo)}</h2>
        <button class="link-btn" id="sel-cerrar">Cerrar</button>
      </div>
      <input id="sel-q" type="search" placeholder="Escribe el nombre de la carta…" autocomplete="off">
      ${conCantidad ? `<div class="fila" style="margin-top:.5rem">
        <label class="carta-meta" for="sel-cant">Cantidad</label>
        <input id="sel-cant" type="number" min="1" max="999" value="1" style="width:5rem">
      </div>` : ''}
      <div id="sel-res" class="sel-res"><p class="vacio">Escribe al menos dos letras.</p></div>
    </div>`;
  document.body.appendChild(velo);

  const cerrar = () => { velo.remove(); removeEventListener('keydown', porTecla); };
  const porTecla = (ev) => { if (ev.key === 'Escape') cerrar(); };
  addEventListener('keydown', porTecla);
  velo.addEventListener('click', (ev) => { if (ev.target === velo) cerrar(); });
  velo.querySelector('#sel-cerrar').addEventListener('click', cerrar);

  const caja = velo.querySelector('#sel-q');
  const res = velo.querySelector('#sel-res');
  let temporizador = null;

  const buscar = async () => {
    const q = caja.value.trim();
    if (q.length < 2) { res.innerHTML = '<p class="vacio">Escribe al menos dos letras.</p>'; return; }
    res.innerHTML = '<div class="cargando"><div class="girando"></div></div>';
    try {
      // Sin filtro de "mías": aquí se busca en el catálogo entero, que es
      // justo lo que pedía tener el buscador en las tres pantallas.
      const r = await api('/cartas?limite=24&orden=nombre&q=' + encodeURIComponent(q));
      if (!r.cartas.length) { res.innerHTML = '<p class="vacio">Ninguna carta se llama así.</p>'; return; }
      res.innerHTML = `<p class="carta-meta">${r.total} resultado${r.total === 1 ? '' : 's'}${
        r.total > 24 ? ', se enseñan los 24 primeros' : ''}</p>
        <div class="rejilla">${r.cartas.map((c) => `
        <article class="carta" data-id="${esc(c.id)}">
          <img class="carta-img" loading="lazy" alt="${esc(c.nombre)}"
               src="/api/imagen/${encodeURIComponent(c.id)}?size=low"
               onerror="this.style.visibility='hidden'">
          ${c.cantidad > 0 ? `<div class="marcas"><span class="marca marca-tengo">${c.cantidad}</span></div>` : ''}
          <div class="carta-cuerpo">
            <p class="carta-nombre">${esc(c.nombre)}</p>
            <p class="carta-meta">${esc(c.numero || '')} · ${esc(c.expansion || '')}</p>
            <button class="btn btn-pequeno" style="width:100%;margin-top:.35rem">${esc(accion)}</button>
          </div>
        </article>`).join('')}</div>`;

      res.querySelectorAll('.carta').forEach((art) => {
        art.addEventListener('click', async () => {
          const carta = r.cartas.find((x) => x.id === art.dataset.id);
          const cant = conCantidad ? Math.max(1, Number(velo.querySelector('#sel-cant').value) || 1) : 1;
          const boton = art.querySelector('button');
          boton.disabled = true;
          boton.textContent = 'Añadiendo…';
          try {
            await alElegir(carta, cant);
            boton.textContent = '✓ Añadida';
          } catch (e) {
            boton.disabled = false;
            boton.textContent = 'Error';
            alert(e.message);
          }
        });
      });
    } catch (e) {
      res.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  };

  caja.addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(buscar, 280); });
  caja.focus();
}

// ── Álbum ──────────────────────────────────────────────────────────────────

const album = { id: null, pagina: 1, datos: null };

/* Las 12 gamas del binder, tal cual binder.js › ACABADOS en holonook.es:
   [clave, claro, oscuro] — los dos tonos son solo para la muestra redonda
   del selector, el resto de variables de cada gama vive en binder.css. Uno
   por álbum y guardado en local, que es dato de decoración y no de
   colección: no hace falta que pase por el servidor ni que viaje entre
   dispositivos para que sirva de algo (holonook sí lo manda a su cuenta;
   aquí no hay ese backend, así que se queda en este aparato). */
const ACABADOS = [
  ['pearl', '#fffaff', '#c9cfeb'], ['glacier', '#e9f8ff', '#8fb7d5'],
  ['lavender', '#f2eaff', '#b49cd6'], ['sage', '#edf5ec', '#94b7a4'],
  ['rose', '#fff1f7', '#d0a6c1'], ['midnight', '#5b6d90', '#1c2539'],
  ['red', '#ef5c64', '#961e32'], ['orange', '#ffb059', '#c85d20'],
  ['yellow', '#ffe987', '#d7a522'], ['green', '#51ae82', '#17613f'],
  ['blue', '#6199ef', '#19409b'], ['black', '#52535a', '#111215'],
];
const NOMBRE_ACABADO = {
  pearl: 'Perla', glacier: 'Glaciar', lavender: 'Lavanda', sage: 'Salvia', rose: 'Rosa cuarzo',
  midnight: 'Medianoche', red: 'Rojo', orange: 'Naranja', yellow: 'Amarillo', green: 'Verde',
  blue: 'Azul', black: 'Negro', custom: 'Personalizado',
};
const VARS_BINDER = ['cover-a', 'cover-b', 'cover-c', 'page-a', 'page-b', 'slot-a', 'slot-b', 'ink'];
const ACABADO_BASE = { paleta: 'pearl', color: '#7b8fd1', modo: 'light' };
const claveAcabado = (binderId) => `ltcg-acabado-${binderId}`;

/* Las anillas del lomo (binder.js › lomoHTML()): tres ojales a cada lado y
   tres anillas que usan el dibujo de #b-anilla que lleva index.html. */
const LOMO_HTML = `<div class="lomo" aria-hidden="true">${[1, 2, 3].map((i) =>
  `<i class="ojal izq a${i}"></i><i class="ojal der a${i}"></i><svg class="anilla a${i}" viewBox="0 0 100 52"><use href="#b-anilla"/></svg>`).join('')}</div>`;

function leerAcabado(binderId) {
  try { return JSON.parse(localStorage.getItem(claveAcabado(binderId)) || 'null'); }
  catch { return null; }
}
function guardarAcabado(binderId, ac) {
  localStorage.setItem(claveAcabado(binderId), JSON.stringify(ac));
}

/* Mezcla un color con blanco o negro a un peso dado: es la fórmula de
   binder.js › mezclaColor, literal. Con ella, UN solo color elegido por
   quien mira el álbum reparte sus ocho variables (tapa, páginas, fundas,
   tinta) con el mismo contraste que ya usan las 12 gamas de serie. */
function mezclaColor(hex, peso, destino) {
  const rgb = hex.slice(1).match(/../g).map((v) => parseInt(v, 16));
  return 'rgb(' + rgb.map((v) => Math.round(v * (1 - peso) + destino * peso)).join(',') + ')';
}

function aplicarAcabado(binderId) {
  const carpeta = $('#carpeta');
  if (!carpeta) return;
  const ac = { ...ACABADO_BASE, ...(leerAcabado(binderId) || {}) };
  carpeta.dataset.paleta = ac.paleta;
  VARS_BINDER.forEach((v) => carpeta.style.removeProperty('--' + v));
  const oscuro = ac.paleta === 'midnight' || ac.paleta === 'black' || (ac.paleta === 'custom' && ac.modo === 'dark');
  if (ac.paleta === 'custom' && /^#[0-9a-f]{6}$/i.test(ac.color)) {
    // [peso, destino (0 = negro, 255 = blanco)] por variable, en el mismo orden que VARS_BINDER.
    const tonos = ac.modo === 'dark'
      ? [[.66, 0], [.25, 0], [.54, 0], [.38, 0], [.60, 0], [.45, 0], [.68, 0], [.88, 255]]
      : [[.23, 0], [.70, 255], [.24, 255], [.89, 255], [.66, 255], [.80, 255], [.57, 255], [.70, 0]];
    VARS_BINDER.forEach((v, i) => carpeta.style.setProperty('--' + v, mezclaColor(ac.color, ...tonos[i])));
  }
  carpeta.classList.toggle('oscuro', oscuro);
  const actual = $('#acabado-actual');
  if (actual) actual.textContent = 'ACABADO · ' + NOMBRE_ACABADO[ac.paleta].toUpperCase();
  $('#acabados')?.querySelectorAll('.acabado-chip').forEach((chip) => {
    chip.classList.toggle('activo', chip.dataset.acabado === ac.paleta);
  });
  const caja = $('#acabado-custom-caja');
  if (caja) {
    caja.hidden = ac.paleta !== 'custom';
    const color = $('#acabado-color'), modo = $('#acabado-modo');
    if (color) color.value = ac.color;
    if (modo) modo.value = ac.modo;
  }
}

/* El desplegable de acabados se cierra al tocar fuera. Un solo listener a
   nivel de módulo y no uno por visita a /album: vistaAlbum() se llama cada
   vez que se entra en la ruta, y meterlo ahí dentro apilaría un listener
   nuevo en cada visita sin quitar nunca los anteriores. */
document.addEventListener('click', (ev) => {
  const pop = $('#acabados');
  if (pop && !pop.hidden && !ev.target.closest('.acabado-envoltura')) {
    pop.hidden = true;
    $('#personalizar')?.setAttribute('aria-expanded', 'false');
  }
});

/*
 * Selección múltiple del álbum.
 *
 * Las claves son "página:hueco" y no el id de la carta: dos huecos pueden
 * llevar la misma carta (una copia en la página 3 y otra en la 9), y la
 * selección es de SITIOS en el álbum, no de cartas. `ultimo` guarda el
 * elemento del último hueco tocado, que es lo que necesita Mayús+clic para
 * saber dónde empieza el rango.
 */
/*
 * El brillo 3D de las cartas (wtc-perspective-card, ver perspective-card.js):
 * cada carta del álbum y la de la ficha grande montan su propia instancia,
 * que engancha listeners de ventana (resize, scroll) para saber dónde está.
 * Sin destruirlas al dejar de verse se quedan escuchando para siempre —una
 * fuga silenciosa que solo se nota tras navegar un rato por la app—, así que
 * limpiarBrillo() se llama justo antes de CUALQUIER repintado de vista
 * (pintar(), más abajo), no solo al salir del álbum.
 */
let instanciasBrillo = [];
function limpiarBrillo() { instanciasBrillo.forEach((i) => i.destroy()); instanciasBrillo = []; }
function montarBrillo(raiz, opciones, Clase) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !window.WTCPerspectiveCard) return;
  const Ctor = Clase || WTCPerspectiveCard.PerspectiveCard;
  raiz.querySelectorAll('.perspective-card').forEach((el) => {
    instanciasBrillo.push(new Ctor(el, opciones));
  });
}

/*
 * El menú que aparece al abrir una carta —precio, cantidad, deseados,
 * álbum— no lo monta un modal propio: ClickablePerspectiveCard (ver
 * montarBrillo(), usado tanto en el álbum como en cargarLista() para
 * colección/enciclopedia) ya abre su propio <dialog>, con el giro y la
 * animación de verdad de holonook.es; esto solo cuelga el panel de
 * infoCartaHTML() DENTRO de ese diálogo, enganchado a los eventos que la
 * librería dispara (perspectivecard:open/opened/closed). Tres listeners a
 * nivel de módulo, puestos una sola vez: el diálogo es uno solo, compartido
 * por todas las cartas de toda la aplicación, así que no hace falta —ni
 * conviene— engancharlos por carta.
 *
 * 'open' llega ANTES de que la librería mueva el .perspective-card dentro
 * del diálogo, mientras todavía cuelga de su sitio de origen —el .hueco del
 * álbum o el .carta de la rejilla—: es el único momento en el que se puede
 * saber de qué carta se trata. 'opened' llega después, ya colocado; ahí se
 * pide la carta y se construye el panel.
 */
let cartaAbriendo = null;
document.addEventListener('perspectivecard:open', (ev) => {
  const origen = ev.target.closest?.('.hueco[data-carta], .carta[data-id]');
  const id = origen && (origen.dataset.carta || origen.dataset.id);
  cartaAbriendo = id ? { id, panel: null } : null;
});
document.addEventListener('perspectivecard:opened', async (ev) => {
  const pedido = cartaAbriendo;
  if (!pedido) return;
  const dlg = ev.target.closest?.('dialog.perspective-card__dialog');
  if (!dlg) return;
  const panel = document.createElement('div');
  panel.className = 'panel-carta-album';
  panel.innerHTML = '<div class="cargando"><div class="girando"></div></div>';
  dlg.appendChild(panel);
  pedido.panel = panel;
  try {
    const [c, alb] = await Promise.all([
      api(rutaApi('/cartas/' + encodeURIComponent(pedido.id))),
      api(rutaApi('/binder')).catch(() => ({ binders: [] })),
    ]);
    if (!panel.isConnected || cartaAbriendo !== pedido) return;   // se cerró mientras llegaba la respuesta
    const binders = alb.binders || [];
    panel.innerHTML = infoCartaHTML(c, binders, { conCerrar: false });
    cablearInfoCarta(panel, c, binders);
  } catch (e) {
    if (panel.isConnected) panel.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
});
document.addEventListener('perspectivecard:closed', () => {
  cartaAbriendo?.panel?.remove();
  cartaAbriendo = null;
});

const seleccion = { activa: false, ids: new Set(), ultimo: null };
/* El hueco por el que pasa un arrastre de selección en curso. Vive aquí y no
   dentro de montarEnHoja() porque esa función se vuelve a llamar en cada
   cambio de página, y una variable local se perdería si el arrastre sigue
   activo al cruzar de una hoja a la otra. */
let pintando = null;
addEventListener('mouseup', () => { pintando = null; });

const huecosSeleccionables = () =>
  [$('#hoja'), $('#hoja-der')].filter((h) => h && !h.hidden)
    .flatMap((h) => [...h.querySelectorAll('.hueco[data-carta]')].map((el) => ({ el, hoja: h })));

const claveHueco = (hoja, el) => `${hoja.dataset.pagina}:${el.dataset.hueco}`;

function alternarSeleccion(hoja, el) {
  const clave = claveHueco(hoja, el);
  if (seleccion.ids.has(clave)) seleccion.ids.delete(clave); else seleccion.ids.add(clave);
  seleccion.ultimo = el;
  pintarSeleccion();
}

function seleccionarRango(hoja, el) {
  const lista = huecosSeleccionables();
  const iActual = lista.findIndex((x) => x.el === el);
  let iUltimo = seleccion.ultimo ? lista.findIndex((x) => x.el === seleccion.ultimo) : iActual;
  if (iUltimo === -1) iUltimo = iActual;
  const desde = Math.min(iActual, iUltimo), hasta = Math.max(iActual, iUltimo);
  for (let i = desde; i <= hasta; i++) seleccion.ids.add(claveHueco(lista[i].hoja, lista[i].el));
  seleccion.ultimo = el;
  pintarSeleccion();
}

/* Pinta la marca en cada hueco y apaga el arrastre nativo mientras se
   selecciona: mover una carta y seleccionar varias usan el mismo
   mousedown, y no hay forma de que convivan en el mismo gesto. */
function pintarSeleccion() {
  seleccion.activa = seleccion.ids.size > 0;
  const carpeta = $('#carpeta');
  if (!carpeta) return;
  carpeta.classList.toggle('seleccion-activa', seleccion.activa);
  huecosSeleccionables().forEach(({ el, hoja }) => {
    el.classList.toggle('seleccionada', seleccion.ids.has(claveHueco(hoja, el)));
    // En el álbum de un amigo nunca se arrastra, así que esto no puede
    // reactivar el draggable que casilla() ya dejó sin poner.
    el.draggable = !seleccion.activa && !verAmigo.activo;
  });
  const barra = $('#barra-seleccion');
  if (!barra) return;
  barra.hidden = !seleccion.activa;
  if (seleccion.activa) {
    $('#sel-cuenta').textContent = `${seleccion.ids.size} seleccionada${seleccion.ids.size === 1 ? '' : 's'}`;
  }
}

function salirSeleccion() {
  seleccion.ids.clear();
  seleccion.ultimo = null;
  const r = $('#sel-resultado');
  if (r) r.textContent = '';
  pintarSeleccion();
}

/* Esc y Ctrl/Cmd+A, a nivel de módulo por el mismo motivo que el
   desplegable de acabados: vistaAlbum() se llama en cada visita a la ruta. */
document.addEventListener('keydown', (ev) => {
  if (!$('#carpeta') || ev.target.closest('input, textarea, select')) return;
  if (ev.key === 'Escape' && seleccion.ids.size) { salirSeleccion(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a' && seleccion.activa) {
    ev.preventDefault();
    huecosSeleccionables().forEach(({ el, hoja }) => seleccion.ids.add(claveHueco(hoja, el)));
    pintarSeleccion();
  }
});

const ICONO_ALBUM = `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`;

/* La galería de "Mis álbumes": los binders que ya tienes, como tarjetas, más
   la de empezar uno nuevo. El visor de verdad (pasar páginas, poner
   cartas...) lo sigue haciendo /album con el mismo album.id de siempre;
   aquí solo se elige o se crea el binder. Clicar una tarjeta deja su id
   puesto en album.id ANTES de que el oyente global de data-ruta navegue —
   los dos escuchan el mismo click, y el de la tarjeta, por estar más
   adentro, se entera primero. */
async function vistaAlbumes() {
  const { binders } = await api(rutaApi('/binder'));
  const rutaAlbum = verAmigo.activo ? `/amigos/${verAmigo.id}/album` : '/album';

  vista.innerHTML = `
  <div class="wrap">
    <div class="head">
      <h1 class="title">${verAmigo.activo ? `Álbumes de ${esc(verAmigo.nombre)}` : 'Mis álbumes'}</h1>
      <p class="subtitle">${binders.length ? 'Tus colecciones en marcha.' : 'Todavía no tienes ninguno: empieza el primero.'}</p>
    </div>
    ${bannerAmigo()}
    <div class="rejilla-albumes">
      ${binders.map((b) => `
        <a class="tarjeta-album" href="${rutaAlbum}" data-ruta data-binder="${b.id}">
          <span class="tarjeta-album-icono" aria-hidden="true">${ICONO_ALBUM}</span>
          <span class="tarjeta-album-nombre">${esc(b.nombre)}</span>
          <span class="tarjeta-album-meta">${b.ocupados} carta${b.ocupados === 1 ? '' : 's'} · hasta ${b.paginas} páginas</span>
        </a>`).join('')}
      ${verAmigo.activo ? '' : `
      <button type="button" class="tarjeta-album tarjeta-album-nueva" id="nuevo-album">
        <span class="tarjeta-album-mas" aria-hidden="true">+</span>
        Empezar un álbum
      </button>`}
    </div>
  </div>`;

  vista.querySelectorAll('.tarjeta-album[data-binder]').forEach((a) => {
    a.addEventListener('click', () => { album.id = Number(a.dataset.binder); album.pagina = 1; });
  });
  $('#nuevo-album')?.addEventListener('click', () => dialogoNuevoAlbum());
}

/* El diálogo de crear: por una colección entera —se crea del tamaño justo
   y se rellena sola, reutilizando /rellenar, el mismo endpoint del botón
   "Rellenar" que ya había dentro del álbum— o personalizado —nombre y
   distribución, igual que el formulario que ya había para cuando no
   había ninguno todavía, en vistaAlbum()—. */
async function dialogoNuevoAlbum() {
  const velo = document.createElement('div');
  velo.className = 'velo';
  velo.innerHTML = `<div class="ficha panel-dialogo">
    <div class="fila" style="align-items:flex-start">
      <b style="font-size:1.1rem">Empezar un álbum</b>
      <button type="button" class="link-btn derecha" id="nuevo-cerrar" aria-label="Cerrar">✕</button>
    </div>
    <div class="fila" style="margin-top:.6rem;gap:.4rem">
      <button type="button" class="btn btn-suave btn-pequeno" id="modo-coleccion" aria-pressed="true">Por colección</button>
      <button type="button" class="btn btn-suave btn-pequeno" id="modo-custom" aria-pressed="false">Personalizado</button>
    </div>
    <div id="panel-coleccion" style="margin-top:.8rem">
      <label for="nuevo-set">Expansión</label>
      <select id="nuevo-set" style="width:100%"><option value="">Elige una expansión…</option></select>
      <p class="carta-meta" style="margin-top:.4rem">Se crea del tamaño justo y se rellena con todas sus cartas.</p>
    </div>
    <div id="panel-custom" hidden style="margin-top:.8rem">
      <label for="nuevo-nombre">Nombre del álbum</label>
      <input id="nuevo-nombre" type="text" value="Mi álbum" style="width:100%">
      <label for="nuevo-slots" style="margin-top:.5rem;display:block">Cartas por página</label>
      <select id="nuevo-slots" style="width:100%">
        <option value="9" selected>9 por página (3×3)</option>
        <option value="4">4 por página (2×2)</option>
        <option value="6">6 por página (3×2)</option>
        <option value="12">12 por página (4×3)</option>
      </select>
    </div>
    <p class="error" id="nuevo-error" hidden></p>
    <div class="fila" style="margin-top:1rem;justify-content:flex-end">
      <button type="button" class="btn" id="nuevo-crear">Crear</button>
    </div>
  </div>`;
  document.body.appendChild(velo);
  const cerrar = () => velo.remove();
  velo.addEventListener('click', (ev) => { if (ev.target === velo) cerrar(); });
  velo.querySelector('#nuevo-cerrar').addEventListener('click', cerrar);
  addEventListener('keydown', function esc3(ev) {
    if (ev.key === 'Escape') { cerrar(); removeEventListener('keydown', esc3); }
  });

  if (!sesion.filtros) sesion.filtros = await api('/filtros');
  const selSet = velo.querySelector('#nuevo-set');
  selSet.innerHTML += sesion.filtros.expansiones
    .map((e) => `<option value="${esc(e.set_code)}">${esc(e.nombre)} (${e.cartas})</option>`).join('');

  let modo = 'coleccion';
  const bColeccion = velo.querySelector('#modo-coleccion');
  const bCustom = velo.querySelector('#modo-custom');
  const pColeccion = velo.querySelector('#panel-coleccion');
  const pCustom = velo.querySelector('#panel-custom');
  const elegirModo = (m) => {
    modo = m;
    bColeccion.setAttribute('aria-pressed', String(m === 'coleccion'));
    bCustom.setAttribute('aria-pressed', String(m === 'custom'));
    pColeccion.hidden = m !== 'coleccion';
    pCustom.hidden = m !== 'custom';
  };
  bColeccion.addEventListener('click', () => elegirModo('coleccion'));
  bCustom.addEventListener('click', () => elegirModo('custom'));

  const error = velo.querySelector('#nuevo-error');
  velo.querySelector('#nuevo-crear').addEventListener('click', async () => {
    error.hidden = true;
    const boton = velo.querySelector('#nuevo-crear');
    boton.disabled = true;
    try {
      if (modo === 'coleccion') {
        const setCode = selSet.value;
        const exp = sesion.filtros.expansiones.find((e) => e.set_code === setCode);
        if (!setCode || !exp) throw new Error('Elige una expansión.');
        const paginas = Math.max(1, Math.ceil(exp.cartas / 9));
        const b = await api('/binder', { metodo: 'POST', cuerpo: { nombre: exp.nombre, slots: 9, paginas } });
        await api(`/binder/${b.id}/rellenar`, { metodo: 'POST', cuerpo: { setCode, desdePagina: 1 } });
        album.id = b.id; album.pagina = 1;
      } else {
        const nombre = velo.querySelector('#nuevo-nombre').value.trim() || 'Mi álbum';
        const slots = Number(velo.querySelector('#nuevo-slots').value);
        const b = await api('/binder', { metodo: 'POST', cuerpo: { nombre, slots, paginas: 30 } });
        album.id = b.id; album.pagina = 1;
      }
      cerrar();
      ir('/album');
    } catch (e) {
      error.textContent = e.message; error.hidden = false;
      boton.disabled = false;
    }
  });
}

async function vistaAlbum() {
  const { binders } = await api(rutaApi('/binder'));

  if (!binders.length) {
    vista.innerHTML = verAmigo.activo ? `
      <div class="wrap">
        <div class="head"><h1 class="title">Álbum de ${esc(verAmigo.nombre)}</h1>
          <p class="subtitle">Todavía no tiene ninguno.</p></div>
        ${bannerAmigo()}
      </div>` : `
      <div class="wrap">
        <div class="head"><h1 class="title">Álbum</h1>
          <p class="subtitle">Todavía no tienes ninguno.</p></div>
        <div class="panel">
          <div class="campo"><label for="nom">Nombre del álbum</label>
            <input id="nom" type="text" value="Mi colección"></div>
          <div class="fila">
            <select id="slots" style="flex:0 1 12rem">
              <option value="9" selected>9 por página (3×3)</option>
              <option value="4">4 por página (2×2)</option>
              <option value="6">6 por página (3×2)</option>
              <option value="12">12 por página (4×3)</option>
            </select>
            <button class="btn" id="crear">Crear álbum</button>
          </div>
        </div>
      </div>`;
    $('#crear')?.addEventListener('click', async () => {
      await api('/binder', { metodo: 'POST', cuerpo: {
        nombre: $('#nom').value, slots: Number($('#slots').value), paginas: 30 } });
      vistaAlbum();
    });
    return;
  }

  album.id = album.id && binders.some((b) => b.id === album.id) ? album.id : binders[0].id;
  seleccion.ids.clear();
  seleccion.ultimo = null;

  vista.innerHTML = `
  <div class="wrap">
    <div class="head">
      <h1 class="title">${verAmigo.activo ? `Álbum de ${esc(verAmigo.nombre)}` : 'Álbum'}</h1>
      <p class="subtitle" id="album-sub">…</p>
    </div>
    ${bannerAmigo()}

    <div class="fila album-nav">
      <button class="btn btn-suave btn-pequeno" id="ant">‹ Anterior</button>
      <span id="pie" class="album-nav-pie">…</span>
      <button class="btn btn-suave btn-pequeno" id="sig">Siguiente ›</button>
      <select id="ir-a" style="flex:0 1 9rem"><option value="">Ir a…</option></select>
      <span class="crece"></span>
      <label class="chip"><input type="checkbox" id="solo-faltan" style="width:auto"> Ver solo las que me faltan</label>
    </div>
    <div class="fila album-nav" style="margin-top:.5rem">
      <div class="acabado-envoltura">
        <button type="button" class="btn btn-suave btn-pequeno" id="personalizar"
                aria-haspopup="true" aria-expanded="false">☰ Personalizar</button>
        <div class="acabados" id="acabados" hidden role="menu" aria-label="Acabado del álbum">
          <div class="fila" style="align-items:flex-start">
            <b style="font-size:1rem">Tu binder, a tu gusto</b>
            <button type="button" class="link-btn derecha" id="acabados-cerrar" aria-label="Cerrar">✕</button>
          </div>
          <p class="carta-meta acabado-actual" id="acabado-actual" style="margin:.2rem 0 .7rem">ACABADO · PERLA</p>
          <div class="acabados-rejilla">
            ${ACABADOS.map(([k, claro, oscuro]) => `
              <button type="button" class="acabado-chip" data-acabado="${k}"
                      style="--muestra:linear-gradient(135deg, ${claro}, ${oscuro})">
                <span class="acabado-muestra"></span>${esc(NOMBRE_ACABADO[k])}
              </button>`).join('')}
            <button type="button" class="acabado-chip ptodo" data-acabado="custom"
                    style="--muestra:conic-gradient(#ec7492,#eaca7e,#81bba8,#7c9fe7,#b69ddd,#ec7492)">
              <span class="acabado-muestra"></span>Personalizado
            </button>
          </div>
          <div class="acabado-custom" id="acabado-custom-caja" hidden>
            <label>Color base <input type="color" id="acabado-color" value="#7b8fd1"></label>
            <label>Tono
              <select id="acabado-modo"><option value="light">Claro</option><option value="dark">Oscuro</option></select>
            </label>
          </div>
          <p class="carta-meta" style="margin:.7rem 0 0;opacity:.7">Se guarda en este dispositivo.</p>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:.8rem">
      <div class="fila">
        <select id="cual" style="flex:0 1 16rem">
          ${binders.map((b) => `<option value="${b.id}"${b.id === album.id ? ' selected' : ''}>${esc(b.nombre)} · ${b.ocupados} cartas</option>`).join('')}
        </select>
        <span class="carta-meta crece">Las cartas se añaden desde la enciclopedia o desde tu colección.</span>
        ${verAmigo.activo ? '' : `
        <label class="carta-meta">Páginas
          <input id="paginas" type="number" min="1" max="500" style="width:5rem;margin-left:.4rem">
        </label>
        <button class="btn btn-suave btn-pequeno" id="guardar-paginas">Guardar</button>`}
      </div>
      ${verAmigo.activo ? '' : `
      <div class="fila" style="margin-top:.6rem">
        <select id="rellenar-set" style="flex:1 1 14rem"><option value="">…o rellenar con una expansión entera</option></select>
        <button class="btn btn-suave" id="rellenar">Rellenar</button>
      </div>`}
    </div>

    <div class="album" id="carpeta">
      ${LOMO_HTML}
      <div class="hojas" id="hojas">
        <div class="hoja" id="hoja"></div>
        <div class="hoja" id="hoja-der" hidden></div>
      </div>
      <div class="barra"><div id="barra" style="width:0%"></div></div>
    </div>
    <p class="subtitle" style="text-align:center;margin-top:.8rem">
      Arrastra una carta a otro hueco para colocarla. Los huecos negros están vacíos:
      las cartas se añaden desde la enciclopedia o desde tu colección.
    </p>
  </div>

  <div class="barra-seleccion" id="barra-seleccion" hidden>
    <div class="fila">
      <b id="sel-cuenta">0 seleccionadas</b>
      <span class="crece"></span>
      <button type="button" class="link-btn" id="sel-todas">Todas</button>
      <button type="button" class="link-btn" id="sel-ninguna">Ninguna</button>
      <button type="button" class="link-btn" id="sel-salir">Salir</button>
    </div>
    <div class="fila" style="margin-top:.5rem">
      <button type="button" class="btn btn-suave btn-pequeno" id="sel-conseguidas">Marcar como conseguidas</button>
      <button type="button" class="btn btn-suave btn-pequeno" id="sel-quitar-col">Quitar de la colección</button>
      <button type="button" class="btn btn-suave btn-pequeno" id="sel-idioma" disabled title="Todavía no: cada copia no guarda idioma propio">Idioma…</button>
      <button type="button" class="btn btn-suave btn-pequeno" id="sel-deseos-mas">Añadir a deseos</button>
    </div>
    <div class="fila" style="margin-top:.5rem">
      <button type="button" class="btn btn-suave btn-pequeno" id="sel-deseos-menos">Quitar de deseos</button>
      <button type="button" class="btn btn-suave btn-pequeno" id="sel-ofrecer" disabled title="Todavía no: el álbum no tiene intercambios">Ofrecer para cambio</button>
      <button type="button" class="btn btn-suave btn-pequeno" id="sel-dejar-ofrecer" disabled title="Todavía no: el álbum no tiene intercambios">Dejar de ofrecer</button>
    </div>
    <p class="carta-meta" id="sel-resultado" style="margin:.5rem 0 0"></p>
    <p class="carta-meta" style="margin:.3rem 0 0;opacity:.7">
      Arrastra para seleccionar · Ctrl/⌘+clic: una a una · Mayús+clic: un rango · Ctrl/⌘+A: todas · Esc: salir
    </p>
  </div>`;

  if (!verAmigo.activo) {
    if (!sesion.filtros) sesion.filtros = await api('/filtros');
    $('#rellenar-set').innerHTML += sesion.filtros.expansiones
      .map((e) => `<option value="${esc(e.set_code)}">${esc(e.nombre)} (${e.cartas})</option>`).join('');
  }

  $('#cual').addEventListener('change', (e) => {
    album.id = Number(e.target.value); album.pagina = 1;
    aplicarAcabado(album.id);
    cargarPagina();
  });

  $('#guardar-paginas')?.addEventListener('click', async () => {
    const n = Number($('#paginas').value);
    try {
      await api(`/binder/${album.id}`, { metodo: 'PATCH', cuerpo: { paginas: n } });
      /* Si estabas mirando una hoja que ya no existe, atras hasta la ultima. */
      if (album.pagina > n) album.pagina = n;
      await cargarPagina();
    } catch (e) {
      alert(e.message);
      $('#paginas').value = album.datos.binder.paginas;
    }
  });

  $('#ant').addEventListener('click', () => pasar(-1));
  $('#sig').addEventListener('click', () => pasar(1));

  $('#personalizar').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const pop = $('#acabados');
    pop.hidden = !pop.hidden;
    $('#personalizar').setAttribute('aria-expanded', String(!pop.hidden));
  });
  $('#acabados-cerrar').addEventListener('click', () => {
    $('#acabados').hidden = true;
    $('#personalizar').setAttribute('aria-expanded', 'false');
  });
  $('#acabados').querySelectorAll('.acabado-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const actual = { ...ACABADO_BASE, ...(leerAcabado(album.id) || {}) };
      guardarAcabado(album.id, { ...actual, paleta: chip.dataset.acabado });
      aplicarAcabado(album.id);
    });
  });
  $('#acabado-color').addEventListener('input', (ev) => {
    const actual = { ...ACABADO_BASE, ...(leerAcabado(album.id) || {}) };
    guardarAcabado(album.id, { ...actual, paleta: 'custom', color: ev.target.value });
    aplicarAcabado(album.id);
  });
  $('#acabado-modo').addEventListener('change', (ev) => {
    const actual = { ...ACABADO_BASE, ...(leerAcabado(album.id) || {}) };
    guardarAcabado(album.id, { ...actual, paleta: 'custom', modo: ev.target.value });
    aplicarAcabado(album.id);
  });
  $('#solo-faltan').addEventListener('change', (ev) => {
    $('#carpeta').classList.toggle('solo-faltan', ev.target.checked);
  });
  $('#ir-a').addEventListener('change', (ev) => {
    const n = Number(ev.target.value);
    ev.target.value = '';
    if (!n) return;
    album.pagina = n;
    cargarPagina();
  });
  aplicarAcabado(album.id);

  $('#sel-todas').addEventListener('click', () => {
    huecosSeleccionables().forEach(({ el, hoja }) => seleccion.ids.add(claveHueco(hoja, el)));
    pintarSeleccion();
  });
  $('#sel-ninguna').addEventListener('click', () => { seleccion.ids.clear(); pintarSeleccion(); });
  $('#sel-salir').addEventListener('click', salirSeleccion);

  /* Por id de carta y no por hueco: si la misma carta está en dos huecos
     seleccionados a la vez, marcarla dos veces es trabajo de sobra y el
     segundo intento fallaría por estar ya hecho, inflando "sin cambios". */
  const idsCartaSeleccionadas = () => {
    const claves = seleccion.ids;
    const idsCarta = new Set();
    huecosSeleccionables().forEach(({ el, hoja }) => {
      if (claves.has(claveHueco(hoja, el))) idsCarta.add(el.dataset.carta);
    });
    return [...idsCarta];
  };

  async function aplicarEnLote(accion) {
    const ids = idsCartaSeleccionadas();
    if (!ids.length) return;
    const resultado = $('#sel-resultado');
    resultado.textContent = 'Aplicando…';
    let cambiadas = 0, sinCambios = 0;
    for (const id of ids) {
      try { await accion(id); cambiadas++; } catch { sinCambios++; }
    }
    resultado.textContent = `Hecho: ${cambiadas} carta${cambiadas === 1 ? '' : 's'} cambiada${cambiadas === 1 ? '' : 's'}.` +
      (sinCambios ? ` ${sinCambios} sin cambios (ya estaban así o no se podía).` : '');
    seleccion.ids.clear();
    pintarSeleccion();
    cargarResumen();
    cargarPagina();
  }

  const marcar = (id, cuerpo) => api(`/cartas/${encodeURIComponent(id)}/marcar`, { metodo: 'POST', cuerpo });
  $('#sel-conseguidas').addEventListener('click', () => aplicarEnLote((id) => marcar(id, { cantidad: 1 })));
  $('#sel-quitar-col').addEventListener('click', () => aplicarEnLote((id) => marcar(id, { cantidad: 0 })));
  $('#sel-deseos-mas').addEventListener('click', () => aplicarEnLote((id) => marcar(id, { deseada: true })));
  $('#sel-deseos-menos').addEventListener('click', () => aplicarEnLote((id) => marcar(id, { deseada: false })));

  $('#rellenar')?.addEventListener('click', async () => {
    const set = $('#rellenar-set').value;
    if (!set) return;
    const boton = $('#rellenar');
    boton.disabled = true;
    try {
      const r = await api(`/binder/${album.id}/rellenar`, { metodo: 'POST', cuerpo: { setCode: set, desdePagina: album.pagina } });
      alert(`Colocadas ${r.colocadas} cartas, hasta la página ${r.hastaPagina}.`);
      cargarPagina();
    } finally { boton.disabled = false; }
  });

  cargarPagina();
}

/*
 * Que paginas se ven a la vez.
 *
 * La primera va sola: una carpeta abierta por el principio enseña una sola
 * cara, y ademas hace de portada. A partir de ahi, de dos en dos y siempre con
 * la par a la izquierda, que es como cae en un libro de verdad. Si el total es
 * par, la ultima tambien queda sola.
 */
function hojasDe(pagina, total) {
  if (pagina <= 1) return [1];
  const izq = pagina % 2 === 0 ? pagina : pagina - 1;
  return izq + 1 <= total ? [izq, izq + 1] : [izq];
}

/* Los dos botones del borde (binder.js › pasaPaginas()): la franja con la
   punta doblada que se pulsa en cualquier punto del margen, no solo en un
   botón pequeño arriba. Llaman al mismo pasar(-1)/pasar(1) de los botones
   Anterior/Siguiente; se crean una vez y luego solo se esconden/enseñan
   según quede página en esa dirección. */
const FLECHA = (d) => `<svg viewBox="0 0 12 20" aria-hidden="true"><path d="${d < 0 ? 'M9 2 2 10l7 8' : 'M3 2l7 8-7 8'}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
let asomado = false;
function pintarPasar() {
  const carpeta = $('#carpeta');
  if (!carpeta) return;
  let izq = carpeta.querySelector(':scope > .pasar.izq');
  if (!izq) {
    [[-1, 'izq'], [1, 'der']].forEach(([dir, lado]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pasar ' + lado; b.tabIndex = -1;
      b.setAttribute('aria-label', dir < 0 ? 'Página anterior' : 'Página siguiente');
      b.innerHTML = `<i class="flecha" aria-hidden="true">${FLECHA(dir)}</i><i class="doblez" aria-hidden="true"></i>`;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); pasar(dir); });
      carpeta.appendChild(b);
    });
    izq = carpeta.querySelector(':scope > .pasar.izq');
  }
  const der = carpeta.querySelector(':scope > .pasar.der');
  izq.hidden = $('#ant').disabled;
  der.hidden = $('#sig').disabled;
  if (!asomado && !der.hidden) { asomado = true; der.classList.add('asoma'); }
}

async function cargarPagina() {
  const hoja = $('#hoja');
  if (!hoja) return;

  const total = (album.datos && album.datos.binder.paginas) || album.paginas || 1;
  const cuales = hojasDe(album.pagina, total);

  /* Las dos a la vez: pedirlas una detras de otra enseñaria media carpeta
     mientras llega la segunda. */
  const paginas = await Promise.all(
    cuales.map((n) => api(rutaApi(`/binder/${album.id}/pagina/${n}`))));

  const d = paginas[0];
  album.datos = d;
  album.paginas = d.binder.paginas;

  $('#carpeta').style.setProperty('--slots-x', d.binder.distribucion[0]);

  /* La página 1 ya no va sola: para que el álbum sea SIEMPRE un spread
     doble —sin el caso especial de una sola hoja, que es de donde salían
     todos los líos de animación— la primera pareja es portada (sin
     cartas, solo el nombre) + página 1 de verdad. Nunca hace falta pedir
     una segunda página por esto: la portada no es un dato del servidor. */
  const der = $('#hoja-der');
  const esPortada = cuales.length === 1 && cuales[0] === 1;
  if (esPortada) {
    hoja.innerHTML = portadaHTML(d.binder);
    hoja.removeAttribute('data-pagina');
    hoja.classList.add('portada');
    der.innerHTML = d.huecos.map((h) => casilla(h, d.binder)).join('');
    der.dataset.pagina = String(cuales[0]);
    der.hidden = false;
  } else {
    hoja.classList.remove('portada');
    hoja.innerHTML = d.huecos.map((h) => casilla(h, d.binder)).join('');
    hoja.dataset.pagina = String(cuales[0]);
    if (paginas[1]) {
      der.innerHTML = paginas[1].huecos.map((h) => casilla(h, paginas[1].binder)).join('');
      der.dataset.pagina = String(cuales[1]);
      der.hidden = false;
    } else {
      der.innerHTML = '';
      der.hidden = true;
    }
  }
  /* Con la portada ya nunca se parte de una sola hoja: solo queda sola la
     última, y nada más si el total de páginas es impar. */
  const abierto = !der.hidden;
  $('#hojas').classList.toggle('abierto', abierto);
  /* La carpeta tambien: sus anillas se pintan en un ::before y con las dos
     caras abiertas tienen que ir al centro, no al borde. */
  $('#carpeta').classList.toggle('abierto', abierto);

  const tenidas = paginas.reduce((s, p) => s + p.progreso.tenidas, 0);
  const llenos = paginas.reduce(
    (s, p) => s + (p.progreso.llenos || p.binder.slots_por_pagina), 0);

  $('#barra').style.width = d.progreso.porcentaje + '%';
  $('#pie').textContent = (cuales.length > 1
    ? `Páginas ${cuales[0]}-${cuales[1]} de ${d.binder.paginas}`
    : esPortada ? `Portada · página ${cuales[0]} de ${d.binder.paginas}` : `Página ${cuales[0]} de ${d.binder.paginas}`) +
    ` · ${tenidas} de ${llenos} conseguidas`;
  $('#album-sub').textContent =
    `${d.binder.nombre} · ${d.binder.slots_por_pagina} huecos por página`;

  const campo = $('#paginas');
  if (campo && document.activeElement !== campo) campo.value = d.binder.paginas;

  $('#ant').disabled = album.pagina <= 1;
  $('#sig').disabled = cuales[cuales.length - 1] >= d.binder.paginas;
  pintarPasar();

  /* Se reconstruye solo si el total de páginas cambió: es la única razón por
     la que la lista de pares tendría que ser otra, y reconstruirla en cada
     pase de página tira trabajo por un <select> que no ha cambiado. */
  const irA = $('#ir-a');
  if (irA && irA.dataset.total !== String(d.binder.paginas)) {
    irA.dataset.total = String(d.binder.paginas);
    const pares = [[1]];
    for (let n = 2; n <= d.binder.paginas; n += 2) pares.push(hojasDe(n, d.binder.paginas));
    irA.innerHTML = '<option value="">Ir a…</option>' + pares.map((par, i) =>
      `<option value="${par[0]}">${par.length > 1 ? `Páginas ${par[0]}-${par[1]}` : (i === 0 ? 'Portada' : `Página ${par[0]}`)}</option>`).join('');
  }

  montarArrastre();
  /* El innerHTML de arriba acaba de crear huecos nuevos: sin esto perderían
     la marca .seleccionada y volverían a ser arrastrables aunque la
     selección siguiera activa. */
  pintarSeleccion();
  /* Y también perderían el brillo: cada hoja se repinta entera en cada pase
     de página, así que las instancias de antes apuntan a nodos que ya no
     están y hay que tirarlas antes de montar las nuevas. */
  limpiarBrillo();
  /* ClickablePerspectiveCard y no la base: en el álbum es la propia librería
     quien abre la ficha —el mismo giro y el mismo diálogo de holonook.es—,
     no el modal propio (ver montarEnHoja() y el panel más abajo). */
  montarBrillo($('#hojas'), { zoom: 6, intensity: 4, duration: 800, closeButtonLabel: 'Cerrar' },
    window.WTCPerspectiveCard && WTCPerspectiveCard.ClickablePerspectiveCard);
  activarBordesAmarillos($('#hojas'));
}

/* La portada: la cara izquierda de la primera pareja, sin huecos —solo el
   nombre del álbum—, para que el spread sea SIEMPRE doble desde la primera
   página. */
const portadaHTML = (binder) => `
  <div class="portada-cara">
    <h2 class="portada-nombre">${esc(binder.nombre)}</h2>
    <p class="portada-meta">${binder.slots_por_pagina} huecos por página</p>
  </div>`;

/* La estructura que pide perspective-card.js (ver brillo.css): .perspective-card
   > .perspective-card__transformer > dos .perspective-card__artwork (delante
   y detrás —esta nunca se ve, no hay vuelta de carta aquí, pero el CSS de la
   librería la da por hecha—) + un .perspective-card__shine aparte, que es
   donde la librería pinta el reflejo que sigue al puntero. El brillo
   arcoíris (.shine/.glare) y el marco cromado (.foil) son cosa de la rareza
   (ver esBrillante más arriba), no de si la tienes: una Common no reluce
   aunque la tengas, y una Illustration Rare reluce aunque te falte. */
const casilla = (h, binder) => {
  const c = h.carta;
  if (!c) return `<div class="hueco vacio" data-num="${h.hueco + 1}" data-hueco="${h.hueco}">
    <svg class="bstar" viewBox="0 0 80 90" aria-hidden="true"><use href="#b-destello"/></svg>
  </div>`;
  const falta = c.cantidad === 0;
  return `<div class="hueco${falta ? ' falta' : ''}" data-hueco="${h.hueco}" data-carta="${esc(c.carta_id)}"
               ${verAmigo.activo ? '' : 'draggable="true"'} title="${esc(c.nombre)} · ${esc(c.numero || '')}">
            <div class="perspective-card">
              <div class="perspective-card__transformer">
                <div class="perspective-card__artwork perspective-card__artwork--front"${esBrillante(c.rareza) && tipoBrillo(c.rareza) ? ` data-brillo="${tipoBrillo(c.rareza)}"` : ''}>
                  <img loading="lazy" alt="${esc(c.nombre)}"
                       src="/api/imagen/${encodeURIComponent(c.carta_id)}?size=low"
                       onerror="this.style.display='none'">
                  ${esBrillante(c.rareza) ? `<div class="shine" aria-hidden="true"></div><div class="glare" aria-hidden="true"></div>
                  <div class="foil" aria-hidden="true"><div class="iri"></div></div>` : ''}
                </div>
                <div class="perspective-card__artwork perspective-card__artwork--back" aria-hidden="true"></div>
              </div>
              <div class="perspective-card__shine"></div>
            </div>
            ${verAmigo.activo ? '' : `
            <button type="button" class="quitar-carta" title="Quitar del álbum"
                    aria-label="Quitar ${esc(c.nombre)} del álbum">&times;</button>`}
          </div>`;
};

/* Pasar página: primero se anima la hoja que se va y solo después se pide la
   siguiente, para que el giro no se corte a la mitad esperando a la red. */
async function pasar(sentido) {
  const d = album.datos;
  if (!d) return;
  const total = d.binder.paginas;

  /* De la portada se salta a la primera pareja, y de ahi de dos en dos: es lo
     que pasa al girar UNA hoja de una carpeta. */
  let destino;
  if (sentido > 0) destino = album.pagina <= 1 ? 2 : album.pagina + 2;
  else destino = album.pagina <= 2 ? 1 : album.pagina - 2;
  if (destino < 1 || destino > total) return;

  const der = $('#hoja-der');
  const hoja = $('#hoja');
  const abiertoAhora = der && !der.hidden;
  const sig = sentido > 0;

  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducido || !hoja) {
    album.pagina = destino;
    await cargarPagina();
    return;
  }

  /* Pura, sin red: hojasDe() solo calcula números de página, así que esto ya
     se puede saber ANTES de pedir nada. "Doble" el destino es una pareja de
     verdad, o la portada —que desde que se fusionó con la página 1 también
     se enseña en spread doble, aunque hojasDe() siga devolviendo [1] a
     secas: sigue siendo un solo número de página real, el de al lado es la
     portada, que no sale de la base de datos—. */
  const cualesDestino = hojasDe(destino, total);
  const destinoDoble = cualesDestino.length > 1 || cualesDestino[0] === 1;
  const esLibro = abiertoAhora && destinoDoble;
  const sigOAnt = sig ? 'sig' : 'ant';
  /*
   * Colgada de #carpeta, no de <body> (binder.js › animarPasada() del
   * original: ahí el giro cuelga del propio .spread, con sus hojas en
   * absoluto DENTRO, no en fijo a la ventana): con <body> cada hoja llevaba
   * sus propias coordenadas de viewport, calculadas una vez y nunca más
   * corregidas —y de #carpeta no hereda las variables de color de la gama
   * (--page-a, --slot-a, --ink...), que son descendencia, no herencia desde
   * fuera del árbol, así que el fondo se quedaba en blanco—. Colgada de
   * #carpeta con posición absoluta, en cambio, se mueve CON ella si alguna
   * vez se desplaza a media animación, y hereda sus colores sin tener que
   * copiarlos a mano.
   */
  const carpeta = $('#carpeta');
  /* Clonar SIN la cascada de entrada de mejoras.css (m-sube): esa regla
     anima a cualquier hijo directo de un .grid/.hojas/etc. recien insertado
     en el documento, y le da igual de qué ancestro cuelgue en realidad —un
     clon dentro de .hoja-giro sigue teniendo esa clase por dentro, así que
     al insertarlo la dispara de nuevo, con sus retrasos escalonados por
     carta. Eso es lo que se veía como la carta "reescalándose" y la página
     "agrandándose" un instante al empezar el giro: era m-sube arrancando
     otra vez desde cero sobre el fantasma, no el giro en sí. */
  const sinCascada = (el) => {
    el.style.animation = 'none';
    el.querySelectorAll('*').forEach((x) => { x.style.animation = 'none'; });
    return el;
  };
  const caraDe = (hojaOrigen, clase) => {
    const clon = sinCascada(hojaOrigen.cloneNode(true));
    clon.removeAttribute('id');
    clon.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    const cara = document.createElement('div'); cara.className = 'cara ' + clase; cara.appendChild(clon);
    return cara;
  };

  /*
   * binder.js › animarPasada() del original SOLO se llama DESPUES de que la
   * pagina nueva ya este pintada: ahi, tanto el contenido VIEJO (de antes
   * del repintado) como el NUEVO ya se conocen los dos a la vez, y cada hoja
   * que gira se monta de una pieza —con sus dos caras ya puestas— antes de
   * colgarla del documento, que es cuando de verdad arranca su animacion.
   *
   * La primera version de esto aqui no podia hacer eso: cargarPagina() pide
   * la pagina por red, así que colgaba YA la hoja que gira —con solo la cara
   * de delante, la vieja— y anadia la cara de detras (la nueva) en cuanto
   * cargarPagina() terminaba, a mitad de animacion. Si la red tardaba mas de
   * lo que tarda en girar hasta el ecuador (primera-mitad/segunda-mitad, a
   * los 400ms de 800), la cara de detras llegaba tarde: el giro ya habia
   * puesto esa cara a la vista sin que existiera todavia, dejando un hueco
   * en blanco justo ahi hasta que por fin aparecia.
   *
   * Asi que ahora se hace igual que el original: capturar las caras VIEJAS
   * (clonadas) y las medidas de antes YA, sin tocar nada; pedir la pagina
   * nueva; y montar cada hoja que gira DE UNA PIEZA, con sus dos caras ya
   * puestas, antes de colgarla —recien entonces arranca el giro, ya con
   * todo listo de verdad.
   */
  const antesIzq = caraDe(hoja, 'delante');
  const antesDer = abiertoAhora ? caraDe(der, 'delante') : null;
  /* El sitio de cada lado se mide ya, antes de tocar nada: el alto de la
     portada (centrada) no es el de una rejilla de cartas, y cambia justo
     con cargarPagina(). Mide despues y el contenido VIEJO que se enseña
     mientras tanto hereda una caja que no es la suya. Relativo a #carpeta
     EN ESTE INSTANTE —si #carpeta se desplazara ella misma entre esta
     medida y la siguiente, el "antes" y el "despues" dejarian de
     compartir origen—, aunque en la practica no se mueve. */
  const rectCarpetaAntes = carpeta.getBoundingClientRect();
  const aRelativo = (r) => ({ left: r.left - rectCarpetaAntes.left, top: r.top - rectCarpetaAntes.top, width: r.width, height: r.height });
  const rectIzqAntes = aRelativo(hoja.getBoundingClientRect());
  const rectDerAntes = abiertoAhora ? aRelativo(der.getBoundingClientRect()) : null;

  album.pagina = destino;
  await cargarPagina();

  const giros = [];
  if (esLibro) {
    /*
     * El giro de libro (binder.js › animarPasada(), rama "libro"):
     *
     *   - "tapada" es el lado que queda CUBIERTO mientras dura el giro:
     *     hacia delante, el izquierdo; hacia atrás, el derecho.
     *   - La que de verdad gira ocupa el OTRO lado, con delante = su
     *     contenido viejo y detrás = una copia del contenido NUEVO de la
     *     tapada —los dos ya disponibles, cargarPagina() ya terminó—.
     *   - Mientras tanto, la tapada se esconde (visibility:hidden) y un
     *     "debajo" quieto enseña en su sitio el contenido VIEJO de ESE
     *     lado, para que no se note el cambio hasta que el giro termine.
     */
    const tapadaEl = sig ? hoja : der;          // ya actualizada por cargarPagina()
    const antesTapada = sig ? antesIzq : antesDer;   // contenido VIEJO de la tapada, para "debajo"
    const antesGira = sig ? antesDer : antesIzq;     // contenido VIEJO del que gira, para su "delante"
    const rectTapadaAntes = sig ? rectIzqAntes : rectDerAntes;
    /* El sitio de LA QUE GIRA también se mide de antes, no de después: su
       "delante" enseña el contenido VIEJO, así que tiene que ocupar la
       caja VIEJA —si se mide después (posicionar() con el elemento ya
       actualizado por cargarPagina()), y el antes y el después no miden
       lo mismo (al entrar o salir de la portada, que es mucho más baja
       que una rejilla de cartas), la hoja que gira sale encogida o
       recortada a la caja nueva mientras enseña el contenido viejo. */
    const rectGiraAntes = sig ? rectDerAntes : rectIzqAntes;

    const giroEl = document.createElement('div');
    giroEl.className = 'hoja-giro ' + sigOAnt;
    giroEl.setAttribute('aria-hidden', 'true');
    Object.assign(giroEl.style, {
      left: rectGiraAntes.left + 'px', top: rectGiraAntes.top + 'px',
      width: rectGiraAntes.width + 'px', height: rectGiraAntes.height + 'px',
    });
    giroEl.appendChild(antesGira);

    const detras = document.createElement('div'); detras.className = 'cara detras';
    const clonTapada = sinCascada(tapadaEl.cloneNode(true));
    clonTapada.removeAttribute('id');
    clonTapada.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    detras.appendChild(clonTapada);
    giroEl.appendChild(detras);

    const debajo = document.createElement('div');
    debajo.className = 'hoja-quieta';
    debajo.setAttribute('aria-hidden', 'true');
    Object.assign(debajo.style, {
      left: rectTapadaAntes.left + 'px', top: rectTapadaAntes.top + 'px',
      width: rectTapadaAntes.width + 'px', height: rectTapadaAntes.height + 'px',
    });
    debajo.appendChild(antesTapada);
    tapadaEl.style.visibility = 'hidden';

    // De una pieza y ya completa: colgarla de #carpeta con las dos caras
    // ya puestas.
    carpeta.appendChild(debajo);
    carpeta.appendChild(giroEl);
    giros.push(giroEl);

    await new Promise((r) => {
      let hecho = false;
      const fin = (e) => { if (hecho || (e && e.target !== giroEl)) return; hecho = true; r(); };
      giroEl.addEventListener('animationend', fin);
      setTimeout(fin, 1400);   // red de seguridad: no puede quedarse para siempre
    });
    giroEl.remove();
    debajo.remove();
    tapadaEl.style.visibility = '';
    return;
  }

  /*
   * Sin pareja al otro lado —la única vez que pasa ya es la última página
   * suelta, cuando el total es impar—: no hay con qué construir una cara de
   * detrás que encaje. Cada hoja que hubiera antes se va por su lado, solo
   * con su cara de delante (la vieja, ya capturada arriba), girando hasta
   * quedar de canto y desvaneciéndose, y deja ver lo que cargarPagina() ya
   * puso debajo.
   */
  [[antesIzq, rectIzqAntes], abiertoAhora ? [antesDer, rectDerAntes] : null].forEach((entrada, k) => {
    if (!entrada) return;
    const [antesCara, rectAntes] = entrada;
    const giroEl = document.createElement('div');
    giroEl.className = 'hoja-giro sale ' + sigOAnt + (k ? ' tarde' : '');
    giroEl.setAttribute('aria-hidden', 'true');
    Object.assign(giroEl.style, {
      left: rectAntes.left + 'px', top: rectAntes.top + 'px',
      width: rectAntes.width + 'px', height: rectAntes.height + 'px',
    });
    giroEl.appendChild(antesCara);
    carpeta.appendChild(giroEl);
    giros.push(giroEl);
  });

  await Promise.all(giros.map((g) => new Promise((r) => {
    let hecho = false;
    const fin = (e) => { if (hecho || (e && e.target !== g)) return; hecho = true; r(); };
    g.addEventListener('animationend', fin);
    setTimeout(fin, 1400);
  })));
  giros.forEach((g) => g.remove());
}

/* Arrastrar y soltar. Con ratón va el arrastre nativo; en táctil no existe,
   así que se sigue el dedo a mano y se mira qué hueco hay debajo al soltar. */
function montarArrastre() {
  /* Las dos hojas abiertas, no solo la izquierda: mover una carta de una a
     otra es lo primero que se intenta con el album abierto. */
  [$('#hoja'), $('#hoja-der')].filter((h) => h && !h.hidden).forEach(montarEnHoja);
}

function montarEnHoja(hoja) {
  let origen = null;

  /* Quitar una carta. La pagina se lee de la hoja: con las dos caras abiertas,
     la de la derecha no es album.pagina. */
  hoja.querySelectorAll('.quitar-carta').forEach((b) => {
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const hueco = ev.target.closest('.hueco');
      const pagina = Number(hoja.dataset.pagina) || album.pagina;
      b.disabled = true;
      try {
        await api(`/binder/${album.id}/pagina/${pagina}/hueco/${hueco.dataset.hueco}`,
                  { metodo: 'PUT', cuerpo: { cartaId: null } });
        await cargarPagina();
      } catch (e) {
        b.disabled = false;
        alert(e.message);
      }
    });
  });

  const soltarEn = async (destino) => {
    hoja.querySelectorAll('.destino').forEach((x) => x.classList.remove('destino'));
    if (!destino || !origen || destino === origen) return;
    await api(`/binder/${album.id}/mover`, { metodo: 'POST', cuerpo: {
      desde: { pagina: album.pagina, hueco: Number(origen.dataset.hueco) },
      hasta: { pagina: album.pagina, hueco: Number(destino.dataset.hueco) } } });
    cargarPagina();
  };

  hoja.addEventListener('dragstart', (ev) => {
    if (seleccion.activa) { ev.preventDefault(); return; }
    origen = ev.target.closest('.hueco[draggable]');
    if (!origen) return;
    origen.classList.add('arrastrando');
    ev.dataTransfer.effectAllowed = 'move';
    /* El fantasma que arrastra el ratón: una instantánea nada más —a
       diferencia del táctil, aquí no hay que seguir nada a mano, el propio
       navegador mueve lo que se le pase a setDragImage()—, así que se monta
       y se quita en el mismo tic. */
    const img = origen.querySelector('img');
    if (img) {
      const fantasma = document.createElement('div');
      fantasma.className = 'cfantasma';
      fantasma.style.width = origen.offsetWidth + 'px';
      fantasma.style.height = origen.offsetHeight + 'px';
      const clon = document.createElement('img');
      clon.src = img.currentSrc || img.src;
      fantasma.appendChild(clon);
      document.body.appendChild(fantasma);
      ev.dataTransfer.setDragImage(fantasma, origen.offsetWidth / 2, origen.offsetHeight / 2);
      setTimeout(() => fantasma.remove(), 0);
    }
  });

  /* Arrastrar para seleccionar varias de un tirón. El propio hueco donde
     empieza el arrastre lo decide el clic de más abajo —si lo marcara aquí
     también, un clic normal sin mover el ratón alternaría la selección dos
     veces—; este listener solo se ocupa de los huecos por los que el ratón
     PASA mientras el botón sigue pulsado. `pintando` vive fuera de esta
     función (ver más abajo): montarEnHoja() se llama de nuevo en cada
     cambio de página, y una variable local aquí se perdería a mitad de
     arrastre si el usuario pasa de una hoja a la otra. */
  hoja.addEventListener('mousedown', (ev) => {
    if (!seleccion.activa) return;
    pintando = ev.target.closest('.hueco[data-carta]');
  });
  hoja.addEventListener('mousemove', (ev) => {
    if (!seleccion.activa || !pintando) return;
    const h = ev.target.closest('.hueco[data-carta]');
    if (h && h !== pintando) {
      const clave = claveHueco(hoja, h);
      if (!seleccion.ids.has(clave)) { seleccion.ids.add(clave); seleccion.ultimo = h; pintarSeleccion(); }
    }
  });
  hoja.addEventListener('dragend', () => {
    hoja.querySelectorAll('.arrastrando, .destino').forEach((x) => x.classList.remove('arrastrando', 'destino'));
  });
  hoja.addEventListener('dragover', (ev) => {
    const h = ev.target.closest('.hueco');
    if (!h || !origen) return;
    ev.preventDefault();
    hoja.querySelectorAll('.destino').forEach((x) => x.classList.remove('destino'));
    h.classList.add('destino');
  });
  hoja.addEventListener('drop', (ev) => {
    ev.preventDefault();
    soltarEn(ev.target.closest('.hueco'));
  });

  // Táctil
  let moviendo = false;
  let fantasmaTactil = null;
  hoja.addEventListener('touchstart', (ev) => {
    origen = ev.target.closest('.hueco[draggable]');
    moviendo = false;
  }, { passive: true });
  hoja.addEventListener('touchmove', (ev) => {
    if (!origen) return;
    moviendo = true;
    origen.classList.add('arrastrando');
    const t = ev.touches[0];
    /* El fantasma de verdad, a mano: aquí sí hay que seguir el dedo, porque
       no existe el drag nativo en táctil. Se monta la primera vez que se
       mueve y solo se reposiciona después. */
    if (!fantasmaTactil) {
      fantasmaTactil = document.createElement('div');
      fantasmaTactil.className = 'cfantasma';
      fantasmaTactil.style.width = origen.offsetWidth + 'px';
      fantasmaTactil.style.height = origen.offsetHeight + 'px';
      const img = origen.querySelector('img');
      if (img) {
        const clon = document.createElement('img');
        clon.src = img.currentSrc || img.src;
        fantasmaTactil.appendChild(clon);
      }
      document.body.appendChild(fantasmaTactil);
    }
    fantasmaTactil.style.transform = `translate(${t.clientX - origen.offsetWidth / 2}px, ${t.clientY - origen.offsetHeight / 2}px)`;
    const bajo = document.elementFromPoint(t.clientX, t.clientY);
    const h = bajo && bajo.closest('.hueco');
    hoja.querySelectorAll('.destino').forEach((x) => x.classList.remove('destino'));
    if (h) h.classList.add('destino');
    ev.preventDefault();       // que la página no se desplace mientras se arrastra
  }, { passive: false });
  hoja.addEventListener('touchend', (ev) => {
    if (fantasmaTactil) { fantasmaTactil.remove(); fantasmaTactil = null; }
    if (!origen) return;
    origen.classList.remove('arrastrando');
    if (!moviendo) {           // toque simple: seleccionar si ya se estaba, o dejar que abra la ficha
      const id = origen.dataset.carta;
      const el = origen;
      hoja.querySelectorAll('.destino').forEach((x) => x.classList.remove('destino'));
      origen = null;
      if (!id) return;
      if (seleccion.activa) {
        /* Sin esto, el click sintético que el navegador dispara después de
           un toque llegaría también al botón de ClickablePerspectiveCard y
           alternaría la selección una SEGUNDA vez —quedaría como si no se
           hubiera tocado nada—. Si no se está seleccionando, no se hace
           nada aquí: ese click sintético es justo lo que tiene que abrir la
           ficha, igual que con el ratón. */
        ev.preventDefault();
        alternarSeleccion(hoja, el);
      }
      return;
    }
    const t = ev.changedTouches[0];
    const bajo = document.elementFromPoint(t.clientX, t.clientY);
    soltarEn(bajo && bajo.closest('.hueco'));
    origen = null;
  });

  /*
   * Sobre una carta se abre su ficha — pero aquí ya NO se llama a
   * abrirFicha(): cada carta del álbum lleva montado un
   * ClickablePerspectiveCard (ver cargarPagina() → montarBrillo()), y es su
   * propio botón —uno que cubre toda la carta— quien abre el diálogo y hace
   * el giro de verdad de holonook.es. Lo único que queda por hacer aquí es
   * la selección: en fase de CAPTURA, y no de burbuja, porque el botón de
   * la librería está más adentro que .hueco y su propio 'click' dispara
   * ANTES de que el nuestro llegara a enterarse si no se interceptara
   * primero. Al seleccionar se corta la propagación para que ese botón ni
   * se entere del clic —si no, abriría el diálogo Y seleccionaría a la vez—.
   *
   * El hueco vacío ya no abre el buscador del catálogo: las cartas entran
   * desde la enciclopedia o desde la colección y caen en el primer hueco
   * libre; para ponerlas en un sitio concreto se arrastran, que es lo que
   * ya se hacía para recolocarlas.
   */
  hoja.addEventListener('click', (ev) => {
    const conCarta = ev.target.closest('.hueco[data-carta]');
    // En el álbum de un amigo no hay selección en lote: el clic sigue su
    // camino hacia ClickablePerspectiveCard igual que para una carta propia.
    if (!conCarta || verAmigo.activo) return;
    if (ev.shiftKey) { ev.preventDefault(); ev.stopPropagation(); seleccionarRango(hoja, conCarta); return; }
    /* Ctrl/Cmd+clic entra en el modo aunque todavía no hubiera nada
       seleccionado; un clic normal solo selecciona si YA se está dentro
       —si no, no habría forma de abrir la ficha con un clic suelto—. */
    if (ev.ctrlKey || ev.metaKey || seleccion.activa) {
      ev.preventDefault(); ev.stopPropagation();
      alternarSeleccion(hoja, conCarta);
    }
    // Si no, no se hace nada: el clic sigue su camino hacia el botón de
    // ClickablePerspectiveCard, que es quien abre la carta.
  }, true);
}

// ── Amigos ─────────────────────────────────────────────────────────────────

/* Una fila con iniciales en vez de foto: la foto de perfil se pide al portal
   con tu propia cookie de sesión (ver fotoEnElemento), así que no hay forma
   de traer la de otra persona desde aquí. */
const filaPersona = (u) => `
  <span class="persona-foto" aria-hidden="true">${esc(iniciales(u))}</span>
  <span class="persona-nombre">${esc(u.nombre || u.usuario)}</span>`;

async function vistaAmigos(ruta) {
  const partes = ruta.split('/').filter(Boolean);   // ['amigos'] o ['amigos','42','coleccion']
  if (partes.length === 1) {
    // pintar() solo resetea verAmigo al cambiar de base, y la lista y la
    // ficha de un amigo comparten la base "/amigos": sin esto, volver aquí
    // desde /amigos/42/coleccion dejaría verAmigo activo y apuntando a 42.
    verAmigo.activo = false; verAmigo.id = null; verAmigo.nombre = '';
    return vistaAmigosLista();
  }

  const id = Number(partes[1]);
  if (!Number.isInteger(id)) return vistaNoEncontrada();
  const datos = await api(`/amigos/${id}/resumen`);
  verAmigo.activo = true; verAmigo.id = id;
  verAmigo.nombre = datos.perfil.nombre || datos.perfil.usuario;

  const sub = partes[2];
  if (sub === 'coleccion') return vistaColeccion(ruta, { modo: 'mias' });
  if (sub === 'deseadas') return vistaColeccion(ruta, { modo: 'deseadas' });
  if (sub === 'albumes') return vistaAlbumes();
  if (sub === 'album') return vistaAlbum();
  return vistaAmigoResumen(datos);
}

function vistaAmigoResumen({ perfil, resumen, albumes }) {
  vista.innerHTML = `
  <div class="wrap">
    <div class="head">
      <h1 class="title">${esc(perfil.nombre || perfil.usuario)}</h1>
      <p class="subtitle">${esc(perfil.rol === 'admin' ? 'Administrador' : 'Usuario')}</p>
    </div>
    <div class="panel">
      <div class="fila">
        <a class="btn btn-suave crece" href="/amigos/${perfil.id}/coleccion" data-ruta style="text-align:center">
          <b style="display:block;font-size:1.3rem">${resumen.distintas}</b>Cartas en posesión</a>
        <a class="btn btn-suave crece" href="/amigos/${perfil.id}/deseadas" data-ruta style="text-align:center">
          <b style="display:block;font-size:1.3rem">${resumen.deseadas}</b>Cartas deseadas</a>
        <a class="btn btn-suave crece" href="/amigos/${perfil.id}/albumes" data-ruta style="text-align:center">
          <b style="display:block;font-size:1.3rem">${albumes}</b>Álbumes</a>
      </div>
    </div>
    <p><a class="link-btn" href="/amigos" data-ruta>← Volver a Amigos</a></p>
  </div>`;
}

const PESTANAS_AMIGOS = { amigos: 'Amigos', agregar: 'Agregar', solicitudes: 'Solicitudes' };

async function vistaAmigosLista() {
  vista.innerHTML = `
  <div class="wrap">
    <div class="head"><h1 class="title">Amigos</h1>
      <p class="subtitle">Comparte tu colección y mira la de los demás.</p></div>
    <div class="pestanas" role="tablist">
      ${Object.entries(PESTANAS_AMIGOS).map(([k, t], i) =>
        `<button type="button" class="pestana${i === 0 ? ' activa' : ''}" data-pestana="${k}" role="tab">${t}
           ${k === 'solicitudes' ? '<span class="chip" id="contador-solicitudes" style="margin-left:.4rem" hidden></span>' : ''}</button>`).join('')}
    </div>
    <div id="amigos-contenido"><div class="cargando"><div class="girando"></div></div></div>
  </div>`;

  vista.querySelectorAll('[data-pestana]').forEach((b) => {
    b.addEventListener('click', () => {
      vista.querySelectorAll('[data-pestana]').forEach((x) => x.classList.toggle('activa', x === b));
      cargarPestanaAmigos(b.dataset.pestana);
    });
  });

  // El número de solicitudes pendientes se ve sin entrar en la pestaña.
  api('/amigos/solicitudes').then(({ solicitudes }) => {
    const c = $('#contador-solicitudes');
    if (!c) return;
    c.hidden = !solicitudes.length;
    c.textContent = solicitudes.length;
  }).catch(() => {});

  cargarPestanaAmigos('amigos');
}

async function cargarPestanaAmigos(cual) {
  const caja = $('#amigos-contenido');
  if (!caja) return;
  caja.innerHTML = '<div class="cargando"><div class="girando"></div></div>';
  try {
    if (cual === 'amigos') caja.innerHTML = await panelMisAmigos();
    else if (cual === 'agregar') caja.innerHTML = panelAgregarAmigo();
    else caja.innerHTML = await panelSolicitudes();
  } catch (e) {
    caja.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    return;
  }
  if (cual === 'amigos') cablearPanelMisAmigos(caja);
  else if (cual === 'agregar') cablearPanelAgregarAmigo(caja);
  else cablearPanelSolicitudes(caja);
}

async function panelMisAmigos() {
  const { amigos } = await api('/amigos');
  if (!amigos.length) return '<p class="vacio">Todavía no tienes amigos. Agrégalos desde la pestaña "Agregar".</p>';
  return `<div class="panel">${amigos.map((u) => `
    <div class="fila persona-fila" data-id="${u.id}">
      ${filaPersona(u)}
      <span class="crece"></span>
      <a class="btn btn-suave btn-pequeno" href="/amigos/${u.id}/coleccion" data-ruta>Ver colección</a>
      <a class="btn btn-suave btn-pequeno" href="/amigos/${u.id}/albumes" data-ruta>Ver álbumes</a>
      <button type="button" class="link-btn" data-quitar="${u.id}">Eliminar amistad</button>
    </div>`).join('')}</div>`;
}

function cablearPanelMisAmigos(caja) {
  caja.querySelectorAll('[data-quitar]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta amistad? Dejaréis de ver la colección del otro.')) return;
      await api(`/amigos/${b.dataset.quitar}`, { metodo: 'DELETE' });
      cargarPestanaAmigos('amigos');
    });
  });
}

function panelAgregarAmigo() {
  return `
  <div class="panel">
    <div class="fila">
      <input id="buscar-amigo" type="search" placeholder="Nombre de usuario o id" class="crece">
      <button class="btn" id="buscar-amigo-btn">Buscar</button>
    </div>
    <div id="resultados-amigo" style="margin-top:.8rem"></div>
  </div>`;
}

const ESTADO_BOTON = {
  amigos: () => '<span class="chip">Ya sois amigos</span>',
  enviada: (u) => `<button type="button" class="btn btn-suave btn-pequeno" data-cancelar="${u.solicitudId}">Solicitud enviada · Cancelar</button>`,
  recibida: () => '<span class="chip">Te ha enviado una solicitud</span>',
  nada: (u) => `<button type="button" class="btn btn-pequeno" data-pedir="${u.id}">Enviar solicitud</button>`,
};

function cablearPanelAgregarAmigo(caja) {
  const buscar = async () => {
    const q = caja.querySelector('#buscar-amigo').value.trim();
    const caja2 = caja.querySelector('#resultados-amigo');
    if (!q) { caja2.innerHTML = ''; return; }
    caja2.innerHTML = '<div class="cargando"><div class="girando"></div></div>';
    try {
      const { resultados } = await api('/amigos/buscar?q=' + encodeURIComponent(q));
      caja2.innerHTML = !resultados.length ? '<p class="vacio">Nadie encaja con esa búsqueda.</p>' :
        resultados.map((u) => `
          <div class="fila persona-fila">
            ${filaPersona(u)}
            <span class="crece"></span>
            ${ESTADO_BOTON[u.estado](u)}
          </div>`).join('');
      caja2.querySelectorAll('[data-pedir]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try { await api('/amigos/solicitud', { metodo: 'POST', cuerpo: { para: b.dataset.pedir } }); buscar(); }
        catch (e) { alert(e.message); b.disabled = false; }
      }));
      caja2.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        await api(`/amigos/solicitud/${b.dataset.cancelar}`, { metodo: 'DELETE' });
        buscar();
      }));
    } catch (e) {
      caja2.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  };
  caja.querySelector('#buscar-amigo-btn').addEventListener('click', buscar);
  caja.querySelector('#buscar-amigo').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') buscar(); });
}

async function panelSolicitudes() {
  const { solicitudes } = await api('/amigos/solicitudes');
  if (!solicitudes.length) return '<p class="vacio">No tienes solicitudes pendientes.</p>';
  return `<div class="panel">${solicitudes.map((s) => `
    <div class="fila persona-fila" data-id="${s.id}">
      ${filaPersona(s.de)}
      <span class="crece"></span>
      <button type="button" class="btn btn-pequeno" data-aceptar="${s.id}">Aceptar</button>
      <button type="button" class="link-btn" data-rechazar="${s.id}">Rechazar</button>
    </div>`).join('')}</div>`;
}

function cablearPanelSolicitudes(caja) {
  caja.querySelectorAll('[data-aceptar]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/amigos/solicitudes/${b.dataset.aceptar}/aceptar`, { metodo: 'POST' });
    cargarPestanaAmigos('solicitudes');
  }));
  caja.querySelectorAll('[data-rechazar]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/amigos/solicitudes/${b.dataset.rechazar}/rechazar`, { metodo: 'POST' });
    cargarPestanaAmigos('solicitudes');
  }));
}

// ── Perfil ─────────────────────────────────────────────────────────────────

async function vistaPerfil() {
  const u = sesion.usuario;
  const [{ resumen }, { binders }] = await Promise.all([api('/resumen'), api('/binder')]);

  vista.innerHTML = `
  <div class="wrap">
    <div class="head"><h1 class="title">Mi perfil</h1>
      <p class="subtitle">${esc(u.rol === 'admin' ? 'Administrador' : 'Usuario')}</p></div>

    <div class="panel">
      <h2 style="margin-top:0;font-size:1.05rem">Tu colección</h2>
      <div class="fila">
        <a class="btn btn-suave crece" href="/coleccion" data-ruta style="text-align:center">
          <b style="display:block;font-size:1.3rem">${resumen.distintas}</b>Cartas en posesión</a>
        <a class="btn btn-suave crece" href="/deseadas" data-ruta style="text-align:center">
          <b style="display:block;font-size:1.3rem">${resumen.deseadas}</b>Cartas deseadas</a>
        <a class="btn btn-suave crece" href="/albumes" data-ruta style="text-align:center">
          <b style="display:block;font-size:1.3rem">${binders.length}</b>Álbumes</a>
      </div>
    </div>

    <div class="panel">
      <h2 style="margin-top:0;font-size:1.05rem">Foto de perfil</h2>
      <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
        <div style="display:flex;flex-direction:column;align-items:center;gap:.35rem">
          <span id="perfil-avatar" style="position:relative;overflow:hidden;display:grid;
                place-items:center;width:72px;height:72px;border-radius:50%;
                background:var(--bg3,#2a2f3a)"></span>
          <span class="carta-meta" style="font-size:.75rem;opacity:.6">ID ${esc(u.id)}</span>
        </div>
        <div>
          <a class="btn" href="https://lepayimio.es/">Cambiar en lepayimio.es</a>
          <p class="campo-nota" style="opacity:.6;font-size:.82rem;margin:.5rem 0 0">
            Tu foto es la misma en todos los servicios: se gestiona en el portal.</p>
        </div>
      </div>
    </div>

    <div class="panel">
      <h2 style="margin-top:0;font-size:1.05rem">Datos</h2>
      <div id="m1"></div>
      <div class="campo"><label for="n">Nombre y apellidos</label>
        <input id="n" type="text" value="${esc(u.nombre)}"></div>
      <div class="campo"><label>Usuario</label>
        <input type="text" value="${esc(u.usuario)}" disabled></div>
      <button class="btn" id="guardar">Guardar</button>
    </div>

    <div class="panel">
      <h2 style="margin-top:0;font-size:1.05rem">Contraseña</h2>
      <div id="m2"></div>
      <div class="campo"><label for="a">Contraseña actual</label>
        <input id="a" type="password" autocomplete="current-password"></div>
      <div class="campo"><label for="b">Contraseña nueva</label>
        <input id="b" type="password" autocomplete="new-password"></div>
      <div class="campo"><label for="c">Confirmar contraseña nueva</label>
        <input id="c" type="password" autocomplete="new-password"></div>
      <button class="btn" id="cambiar">Cambiar contraseña</button>
    </div>
  </div>`;

  // Misma foto que en el resto de servicios, con las iniciales de respaldo.
  fotoEnElemento($('#perfil-avatar'));

  $('#guardar').addEventListener('click', async () => {
    try {
      const r = await api('/auth/perfil', { metodo: 'POST', cuerpo: { nombre: $('#n').value } });
      sesion.usuario = r.usuario; cabecera();
      $('#m1').innerHTML = '<p class="ok">Guardado.</p>';
    } catch (e) { $('#m1').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  });

  $('#cambiar').addEventListener('click', async () => {
    try {
      await api('/auth/clave', { metodo: 'POST', cuerpo: {
        actual: $('#a').value, nueva: $('#b').value, nueva2: $('#c').value } });
      $('#m2').innerHTML = '<p class="ok">Contraseña cambiada.</p>';
      ['#a', '#b', '#c'].forEach((s) => { $(s).value = ''; });
    } catch (e) { $('#m2').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  });
}

// ── Gestión ────────────────────────────────────────────────────────────────

let refrescoAdmin = null;

async function vistaAdmin() {
  if (sesion.usuario.rol !== 'admin') return vistaNoEncontrada();

  vista.innerHTML = `
  <div class="wrap">
    <div class="head"><h1 class="title">Gestión</h1>
      <p class="subtitle">Catálogo, imágenes y usuarios.</p></div>
    <div id="panel-estado" class="panel"><div class="cargando"><div class="girando"></div></div></div>
    <div class="panel">
      <h2 style="margin-top:0;font-size:1.05rem">Usuarios</h2>
      <div id="usuarios">…</div>
    </div>
  </div>`;

  const refrescar = async () => {
    if (!$('#panel-estado')) { clearInterval(refrescoAdmin); return; }
    try { pintarAdmin(await api('/admin/estado')); } catch {}
  };
  await refrescar();
  clearInterval(refrescoAdmin);
  refrescoAdmin = setInterval(refrescar, 5000);

  try {
    const { usuarios } = await api('/admin/usuarios');
    $('#usuarios').innerHTML = `<table class="tabla"><thead><tr>
      <th>Usuario</th><th>Nombre</th><th>Rol</th><th>Alta</th><th>Último acceso</th></tr></thead><tbody>
      ${usuarios.map((u) => `<tr><td><b>${esc(u.usuario)}</b></td><td>${esc(u.nombre)}</td>
        <td><span class="chip${u.rol === 'admin' ? ' chip-oro' : ''}">${esc(u.rol)}</span></td>
        <td>${esc(new Date(u.creado).toLocaleDateString('es-ES'))}</td>
        <td>${u.ultimoAcceso ? esc(new Date(u.ultimoAcceso).toLocaleString('es-ES')) : '—'}</td></tr>`).join('')}
      </tbody></table>`;
  } catch (e) { $('#usuarios').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

function pintarAdmin(d) {
  const i = d.ingesta, c = d.catalogo, q = d.cuota, p = d.precarga;
  const pct = i.setsTotales ? Math.round((i.indiceSet / i.setsTotales) * 100) : 0;

  $('#panel-estado').innerHTML = `
    <h2 style="margin-top:0;font-size:1.05rem">Catálogo</h2>
    <p class="subtitle">${c.expansiones} expansiones · <b>${c.cartas}</b> cartas · ${c.imagenes} imágenes guardadas</p>

    <div class="barra" style="background:color-mix(in srgb, var(--fg) 12%, transparent)">
      <div style="width:${pct}%"></div></div>
    <p class="carta-meta">${esc(i.mensaje)}</p>
    <p class="carta-meta">
      Estado: <b>${esc(i.fase)}</b> · ${i.peticiones} peticiones ·
      ${i.cartasGuardadas} cartas (${i.conPrecio} con precio)
      ${i.setsTotales ? ` · expansión ${i.indiceSet} de ${i.setsTotales}` : ''}
    </p>

    <p class="aviso">
      La API deja <b>${q.limiteHora} peticiones por hora</b> y ${q.limiteDia} al día;
      quedan <b>${q.restanHora == null ? '?' : q.restanHora}</b> esta hora y
      ${q.restanDia == null ? '?' : q.restanDia} hoy.
      El catálogo entero son unas 400 peticiones, así que la primera bajada
      lleva varias horas y se reanuda sola.
      ${d.estimacion ? `Quedan ${d.estimacion.expansionesPendientes} expansiones, unas ${d.estimacion.horasAproximadas} h.` : ''}
    </p>

    <div class="fila">
      ${i.activo
        ? '<button class="btn" id="parar">Parar</button>'
        : `<button class="btn" id="seguir">${i.indiceSet ? 'Reanudar' : 'Bajar catálogo'}</button>
           <button class="btn btn-suave" id="precios">Actualizar solo precios</button>
           <button class="btn btn-suave" id="cero">Empezar de cero</button>`}
      <button class="btn btn-suave" id="imagenes-todas"${p.activo ? ' disabled' : ''}>${p.activo
        ? 'Bajando imágenes…'
        : 'Bajar imágenes que faltan (' + (c.sinImagen || 0).toLocaleString('es-ES') + ')'}</button>
      <select id="idiomas" style="flex:0 1 12rem" ${i.activo ? 'disabled' : ''}>
        <option value="eng">Solo inglés (34.014)</option>
        <option value="eng,jap">Inglés y japonés (61.525)</option>
        <option value="eng,jap,chn">Todos los idiomas (68.227)</option>
      </select>
    </div>

    <h2 style="font-size:1.05rem;margin-bottom:.3rem">Imágenes</h2>
    <p class="carta-meta">${esc(p.mensaje)}${p.total ? ` · ${p.hechas} de ${p.total}` : ''}</p>
    <p class="carta-meta">Cada imagen gasta una petición la primera vez y luego queda guardada para siempre.</p>
    <div class="fila">
      <select id="set-precarga" style="flex:1 1 14rem"><option value="">Precargar imágenes de…</option></select>
      ${p.activo ? '<button class="btn btn-suave" id="parar-img">Parar</button>'
                 : '<button class="btn btn-suave" id="precargar">Precargar</button>'}
    </div>`;

  const idi = () => $('#idiomas').value.split(',');
  const bind = (sel, fn) => { const b = $(sel); if (b) b.addEventListener('click', fn); };

  bind('#seguir', async () => { await api('/admin/ingesta/arrancar', { metodo: 'POST', cuerpo: { idiomas: idi() } }); });
  bind('#precios', async () => { await api('/admin/ingesta/arrancar', { metodo: 'POST', cuerpo: { idiomas: idi(), modo: 'precios', desdeCero: true } }); });
  bind('#cero', async () => {
    if (!confirm('Vuelve a recorrer todas las expansiones desde el principio. ¿Seguir?')) return;
    await api('/admin/ingesta/arrancar', { metodo: 'POST', cuerpo: { idiomas: idi(), desdeCero: true } });
  });
  bind('#parar', async () => { await api('/admin/ingesta/parar', { metodo: 'POST' }); });
  // Las imágenes van por su cuenta y son semanas de cuota, pero el botón
  // vive aquí, al lado de Reanudar, que es donde se va a buscar.
  bind('#imagenes-todas', async () => { await api('/admin/precarga/catalogo', { metodo: 'POST' }); });
  bind('#parar-img', async () => { await api('/admin/precarga/parar', { metodo: 'POST' }); });
  bind('#precargar', async () => {
    const s = $('#set-precarga').value;
    if (s) await api('/admin/precarga/arrancar', { metodo: 'POST', cuerpo: { setCode: s } });
  });

  if (sesion.filtros) {
    $('#set-precarga').innerHTML += sesion.filtros.expansiones
      .map((e) => `<option value="${esc(e.set_code)}">${esc(e.nombre)} (${e.cartas})</option>`).join('');
  }
}

function vistaNoEncontrada() {
  vista.innerHTML = `<div class="wrap"><div class="head">
    <h1 class="title">404</h1><p class="subtitle">Esa página no existe.</p></div>
    <a class="btn" href="/enciclopedia" data-ruta>Volver</a></div>`;
}

// ── Arranque ───────────────────────────────────────────────────────────────

(async () => {
  try {
    const r = await api('/auth/me');
    sesion.usuario = r.usuario;
  } catch {}
  try { $('#version').textContent = 'v' + (await api('/version')).version; } catch {}
  cabecera();
  pintar();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();

/*
 * La foto de perfil vive en el portal y la comparten todos los servicios. Se
 * pide a lepayimio.es, que reconoce la sesión por la cookie del dominio padre.
 * Si no hay foto, la imagen falla, se retira y se quedan las iniciales.
 */
/* La misma foto se pone en el botón del avatar, en la tarjeta de perfil del
   menú y en el panel de "Mi perfil": un único sitio que crea el <img> con su
   respaldo de iniciales por si falla, en vez de tres copias del mismo código. */
function fotoEnElemento(el) {
  if (!el || el.querySelector('.avatar-portal')) return;
  const img = document.createElement('img');
  img.className = 'avatar-portal';
  img.alt = '';
  img.decoding = 'async';
  // En línea y no solo por CSS: el contenedor cambia (#avatar, la tarjeta del
  // menú, el panel de perfil) y así vale en los tres sin triplicar la regla.
  img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
  img.addEventListener('error', () => img.remove());
  img.src = 'https://lepayimio.es/perfil/foto';
  el.appendChild(img);
}

function ponerFotoDelPortal() {
  // En el botón de abajo no: es el mismo botón que abre Tema/Desconectarse y
  // con la fila "Perfil" ya arriba, repetir la foto ahí sobraba.
  fotoEnElemento(document.querySelector('#menu-perfil-foto'));
  fotoEnElemento(document.querySelector('#nav-perfil-foto'));
}


/* ── Tema ────────────────────────────────────────────────────────────────────
 *
 * La elección se guarda en el servidor, por usuario, así que sigue al usuario
 * de un dispositivo a otro.
 *
 * Aquí no se aplica al cargar: ya viene marcado en el <html> desde el servidor.
 * Hacerlo desde el cliente obligaría a pintar el tema por defecto y corregirlo
 * después, y ese parpadeo se ve en cada carga.
 */
const TEMAS_TCG = ['oscuro', 'crystal', 'dark-crystal'];
const ICONOS_TEMA = {
  'oscuro': '<svg class="ico ico-luna" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/></svg>',
  'crystal': '<svg class="ico ico-capas" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="ico-capa-alta" d="M12 6l-8 4l8 4l8 -4l-8 -4"/><path class="ico-capa-baja" d="M4 14l8 4l8 -4"/></svg>',
  'dark-crystal': '<svg class="ico ico-capas" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="ico-capa-alta" d="M12 6l-8 4l8 4l8 -4l-8 -4"/><path class="ico-capa-baja" d="M4 14l8 4l8 -4"/></svg>',
};
const NOMBRE_TEMA = { oscuro: 'Oscuro', crystal: 'Crystal', 'dark-crystal': 'Dark Crystal' };

const temaActual = () => document.documentElement.dataset.tema || 'oscuro';

function marcarTema(tema) {
  document.querySelectorAll('.menu-tema[data-tema]').forEach((b) => {
    const suyo = b.dataset.tema === tema;
    b.classList.toggle('activa', suyo);
    b.setAttribute('aria-checked', suyo ? 'true' : 'false');
  });
  const puesto = document.getElementById('tema-actual');
  /* El icono del tema puesto. El nombre sigue haciendo falta, pero
     para el lector de pantalla: un icono solo no dice nada. */
  if (puesto) {
    puesto.className = 'tema-muestra tema-mini ' + tema;
    puesto.innerHTML = ICONOS_TEMA[tema] || '';
  }
  if (abrirTemas) abrirTemas.setAttribute('aria-label', 'Tema: ' + (NOMBRE_TEMA[tema] || tema));
}

async function ponerTema(tema) {
  if (!TEMAS_TCG.includes(tema)) return;
  const antes = temaActual();

  /* Se aplica primero y se guarda después: cambiar de tema tiene que sentirse
     instantáneo, y esperar a la red para pintar lo haría parecer lento. */
  if (tema === 'oscuro') delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = tema;
  marcarTema(tema);

  try {
    const r = await fetch('/api/tema', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tema }),
    });
    if (!r.ok) throw new Error('no guardado');
  } catch {
    /* Si no se pudo guardar se deshace: dejar la pantalla diciendo una cosa y
       el servidor recordando otra haría que al recargar pareciera que el botón
       no funciona. */
    if (antes === 'oscuro') delete document.documentElement.dataset.tema;
    else document.documentElement.dataset.tema = antes;
    marcarTema(antes);
  }
}

document.querySelectorAll('.menu-tema[data-tema]').forEach((b) => {
  b.addEventListener('click', () => ponerTema(b.dataset.tema));
});

const abrirTemas = document.getElementById('abrir-temas');
const submenuTemas = document.getElementById('submenu-temas');
if (abrirTemas && submenuTemas) {
  abrirTemas.addEventListener('click', (ev) => {
    /* Sin esto el clic burbujea hasta el cierre global del menú, que cerraría
       la ventana en el mismo gesto que la abre. */
    ev.stopPropagation();
    verVentanaTema(true);
  });
}

function verVentanaTema(v) {
  const velo = document.getElementById('tema-velo');
  if (!velo) return;
  velo.hidden = !v;
  /* Se cierra el menú al abrirla: los dos a la vez tapan media pantalla. */
  if (v) cerrarMenu();
  if (abrirTemas) abrirTemas.setAttribute('aria-expanded', v ? 'true' : 'false');
}

const veloTema = document.getElementById('tema-velo');
if (veloTema) {
  veloTema.addEventListener('click', (e) => {
    if (e.target === veloTema || e.target.closest('[data-cierra-tema]')) verVentanaTema(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !veloTema.hidden) verVentanaTema(false);
  });
}

marcarTema(temaActual());


/* El hueco que deja la barra fija, medido de ella misma. Se recalcula al
   cambiar el tamaño porque en estrecho la barra crece de alto. */
function medirBarra() {
  const b = document.querySelector('.topbar');
  const alto = b && !b.hidden ? b.getBoundingClientRect().height : 0;
  document.documentElement.style.setProperty('--alto-barra', alto + 'px');
}
addEventListener('resize', medirBarra);
addEventListener('load', medirBarra);

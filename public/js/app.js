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

// ── Enrutado ───────────────────────────────────────────────────────────────

const RUTAS = {
  '/entrar': vistaEntrada,
  '/registro': vistaRegistro,
  '/coleccion': (p) => vistaColeccion(p, { modo: 'mias' }),
  '/enciclopedia': (p) => vistaColeccion(p, { modo: 'todas' }),
  '/deseadas': (p) => vistaColeccion(p, { modo: 'deseadas' }),
  '/album': vistaAlbum,
  '/perfil': vistaPerfil,
  '/admin': vistaAdmin,
};

function ir(ruta, reemplazar = false) {
  if (reemplazar) history.replaceState({}, '', ruta); else history.pushState({}, '', ruta);
  pintar();
}

async function pintar() {
  const ruta = location.pathname === '/' ? (sesion.usuario ? '/coleccion' : '/entrar') : location.pathname;
  const base = '/' + ruta.split('/')[1];
  const publica = base === '/entrar' || base === '/registro';

  if (!sesion.usuario && !publica) return ir('/entrar', true);
  if (sesion.usuario && publica) return ir('/coleccion', true);

  $('#topbar').hidden = !sesion.usuario;
  document.querySelectorAll('.nav a[data-ruta]').forEach((a) => {
    a.classList.toggle('activo', a.getAttribute('href') === base);
  });

  const fn = RUTAS[base];
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
  ponerFotoDelPortal();
  const admin = sesion.usuario.rol === 'admin';
  $('#nav-admin').hidden = !admin;
  $('#menu-admin').hidden = !admin;
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
      ir('/coleccion');
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
      ir('/coleccion');
    } catch (e) {
      $('#msg').innerHTML = `<p class="error">${esc(e.message)}</p>`;
      boton.disabled = false;
    }
  });
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
  Object.assign(estadoLista, {
    modo,
    mias: modo === 'mias',
    deseadas: modo === 'deseadas',
    faltan: false, q: '', expansion: '', rareza: '', tipo: '', pagina: 1,
  });

  const opts = (lista, valor, texto = (x) => x, val = (x) => x) =>
    lista.map((x) => `<option value="${esc(val(x))}"${val(x) === valor ? ' selected' : ''}>${esc(texto(x))}</option>`).join('');

  vista.innerHTML = `
  <div class="wrap">
    <div class="head">
      <h1 class="title">${MODOS[modo].titulo}</h1>
      <p class="subtitle">${MODOS[modo].sub}</p>
      <p class="subtitle" id="resumen">…</p>
    </div>

    ${modo !== 'deseadas' ? '' : `
    <div class="panel panel-anadir">
      <div class="fila">
        <div class="crece">
          <b>Añadir una carta</b>
          <p class="carta-meta" style="margin:.1rem 0 0">
            Busca entre todas las cartas del catálogo, no solo entre las tuyas.</p>
        </div>
        <button class="btn" id="anadir">+ Añadir carta</button>
      </div>
    </div>`}

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

  montarBuscador();
  cargarResumen();
  cargarLista();
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
    const { resumen } = await api('/resumen');
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
    const r = await api('/cartas?' + paramsLista());
    const cuenta = $('#cuenta');
    if (cuenta) cuenta.textContent = `${r.total} carta${r.total === 1 ? '' : 's'}`;

    if (!r.cartas.length) {
      caja.innerHTML = `<p class="vacio">${
        estadoLista.q ? 'No hay cartas que encajen.' : MODOS[estadoLista.modo].vacio}</p>`;
      $('#paginacion').innerHTML = '';
      return;
    }

    caja.innerHTML = `<div class="rejilla">${r.cartas.map(tarjeta).join('')}</div>`;
    caja.querySelectorAll('.carta').forEach((c) => {
      c.addEventListener('click', () => abrirFicha(c.dataset.id));
    });

    // Los botones de cantidad van dentro de la tarjeta, que abre la ficha al
    // pulsarla: sin parar la propagación, subir la cantidad abriría la ficha.
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

const tarjeta = (c) => `
<article class="carta" data-id="${esc(c.id)}">
  <img class="carta-img" loading="lazy" alt="${esc(c.nombre)}"
       src="/api/imagen/${encodeURIComponent(c.id)}?size=low"
       onerror="this.style.visibility='hidden'">
  <div class="marcas">
    ${c.cantidad > 0 ? `<span class="marca marca-tengo">${c.cantidad}</span>` : ''}
    ${c.deseada ? '<span class="marca marca-deseo">♥</span>' : ''}
  </div>
  <div class="carta-cuerpo">
    <p class="carta-nombre">${esc(c.nombre)}</p>
    <p class="carta-meta">${esc(c.numero || '')} · ${esc(c.expansion || '')}</p>
    <p class="carta-meta carta-precio">${c.precio_avg == null ? 'sin precio' : eur(c.precio_avg)}</p>
    ${estadoLista.modo === 'mias' ? `
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

async function abrirFicha(id) {
  const velo = document.createElement('div');
  velo.className = 'velo';
  velo.innerHTML = '<div class="ficha"><div class="cargando"><div class="girando"></div></div></div>';
  document.body.appendChild(velo);
  const cerrar = () => velo.remove();
  velo.addEventListener('click', (ev) => { if (ev.target === velo) cerrar(); });
  addEventListener('keydown', function esc2(ev) {
    if (ev.key === 'Escape') { cerrar(); removeEventListener('keydown', esc2); }
  });

  try {
    // Los álbumes se piden a la vez que la carta: son dos consultas locales y
    // esperar una detrás de otra se nota al abrir la ficha.
    const [c, alb] = await Promise.all([
      api('/cartas/' + encodeURIComponent(id)),
      api('/binder').catch(() => ({ binders: [] })),
    ]);
    const binders = alb.binders || [];
    const p = (c.precios || []).filter((x) => x && x.avg != null);
    velo.querySelector('.ficha').innerHTML = `
      <div>
        <img src="/api/imagen/${encodeURIComponent(c.id)}?size=high" alt="${esc(c.nombre)}"
             onerror="this.src='/api/imagen/${encodeURIComponent(c.id)}?size=low'">
      </div>
      <div>
        <h2>${esc(c.nombre)}</h2>
        <p class="subtitle">${esc(c.expansion)} · ${esc(c.numero || '')} · ${esc(c.rareza || 'sin rareza')}</p>

        <div class="precios">
          <div class="precio-caja"><b>${eur(c.precio_avg)}</b><span>media</span></div>
          <div class="precio-caja"><b>${eur(c.precio_low)}</b><span>mínimo</span></div>
          <div class="precio-caja"><b>${eur(c.precio_avg7)}</b><span>7 días</span></div>
          <div class="precio-caja"><b>${eur(c.precio_trend)}</b><span>tendencia</span></div>
        </div>
        <p class="carta-meta">Precios de Cardmarket en euros${
          c.precio_fecha ? ', actualizados el ' + esc(new Date(c.precio_fecha).toLocaleDateString('es-ES')) : ''}.
          ${p.length > 1 ? esc(p.length) + ' variantes.' : ''}</p>

        <dl>
          ${c.tipo ? `<dt>Tipo</dt><dd>${esc(c.tipo)}</dd>` : ''}
          ${c.hp ? `<dt>PS</dt><dd>${esc(c.hp)}</dd>` : ''}
          ${c.etapa ? `<dt>Etapa</dt><dd>${esc(c.etapa)}</dd>` : ''}
          ${c.debilidad ? `<dt>Debilidad</dt><dd>${esc(c.debilidad)}</dd>` : ''}
          ${c.resistencia ? `<dt>Resistencia</dt><dd>${esc(c.resistencia)}</dd>` : ''}
          ${c.retirada != null ? `<dt>Retirada</dt><dd>${esc(c.retirada)}</dd>` : ''}
        </dl>
        ${(c.ataques || []).length ? `<p class="carta-meta">${c.ataques.map(esc).join('<br>')}</p>` : ''}

        <div class="fila" style="margin-top:1rem">
          <button class="btn btn-suave btn-pequeno" id="menos">−</button>
          <span class="chip" id="cant">Tengo ${c.cantidad}</span>
          <button class="btn btn-suave btn-pequeno" id="mas">+</button>
          <button class="btn ${c.deseada ? '' : 'btn-suave'}" id="deseo">
            ${c.deseada ? '♥ En deseadas' : '♡ Quiero esta'}</button>
        </div>

        <div class="fila" style="margin-top:.6rem">
          ${binders.length > 1 ? `<select id="cual-album" style="flex:0 1 12rem">
            ${binders.map((b) => `<option value="${b.id}">${esc(b.nombre)}</option>`).join('')}
          </select>` : ''}
          ${binders.length
            ? '<button class="btn btn-suave" id="al-album">+ Poner en el álbum</button>'
            : '<a class="link-btn" href="/album" data-ruta>Crea un álbum para poder colocarla</a>'}
        </div>
        <p class="fila" style="margin-top:1rem">
          ${c.cm_url ? `<a class="link-btn" href="${esc(c.cm_url)}" target="_blank" rel="noopener">Ver en Cardmarket</a>` : ''}
          <button class="link-btn derecha" id="cerrar">Cerrar</button>
        </p>
      </div>`;

    let cantidad = c.cantidad, deseada = !!c.deseada;
    const marcar = async (cambio) => {
      const r = await api(`/cartas/${encodeURIComponent(c.id)}/marcar`, { metodo: 'POST', cuerpo: cambio });
      cantidad = r.cantidad; deseada = !!r.deseada;
      velo.querySelector('#cant').textContent = `Tengo ${cantidad}`;
      const b = velo.querySelector('#deseo');
      b.textContent = deseada ? '♥ En deseadas' : '♡ Quiero esta';
      b.classList.toggle('btn-suave', !deseada);
      cargarResumen();
      cargarLista();
    };
    velo.querySelector('#mas').addEventListener('click', () => marcar({ cantidad: cantidad + 1 }));
    velo.querySelector('#menos').addEventListener('click', () => marcar({ cantidad: Math.max(0, cantidad - 1) }));
    velo.querySelector('#deseo').addEventListener('click', () => marcar({ deseada: !deseada }));

    /* Va al primer hueco libre, y el servidor devuelve en qué página cayó: sin
       decirlo, uno pulsa el botón y no ve que haya pasado nada. Poner una carta
       en el álbum marca además que se tiene, si no había cantidad. */
    velo.querySelector('#al-album')?.addEventListener('click', async (ev) => {
      const boton = ev.currentTarget;
      const cual = velo.querySelector('#cual-album');
      const binderId = cual ? Number(cual.value) : binders[0].id;
      boton.disabled = true;
      boton.textContent = 'Colocando…';
      try {
        const r = await api(`/binder/${binderId}/anadir`, { metodo: 'POST',
          cuerpo: { cartaId: c.id, cantidad: 1 } });
        boton.textContent = `✓ En la página ${r.pagina}`;
        if (!cantidad) {
          cantidad = 1;
          velo.querySelector('#cant').textContent = 'Tengo 1';
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

    velo.querySelector('#cerrar').addEventListener('click', cerrar);
    /* El enlace para crear un álbum navega por debajo del modal: sin esto la
       ficha se queda flotando encima de la vista nueva. */
    velo.querySelector('a[data-ruta]')?.addEventListener('click', cerrar);
  } catch (e) {
    velo.querySelector('.ficha').innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
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

async function vistaAlbum() {
  const { binders } = await api('/binder');

  if (!binders.length) {
    vista.innerHTML = `
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
    $('#crear').addEventListener('click', async () => {
      await api('/binder', { metodo: 'POST', cuerpo: {
        nombre: $('#nom').value, slots: Number($('#slots').value), paginas: 30 } });
      vistaAlbum();
    });
    return;
  }

  album.id = album.id && binders.some((b) => b.id === album.id) ? album.id : binders[0].id;

  vista.innerHTML = `
  <div class="wrap">
    <div class="head">
      <h1 class="title">Álbum</h1>
      <p class="subtitle" id="album-sub">…</p>
    </div>
    <div class="panel">
      <div class="fila">
        <select id="cual" style="flex:0 1 16rem">
          ${binders.map((b) => `<option value="${b.id}"${b.id === album.id ? ' selected' : ''}>${esc(b.nombre)} · ${b.ocupados} cartas</option>`).join('')}
        </select>
        <span class="carta-meta crece">Las cartas se añaden desde la enciclopedia o desde tu colección.</span>
      </div>
      <div class="fila" style="margin-top:.6rem">
        <select id="rellenar-set" style="flex:1 1 14rem"><option value="">…o rellenar con una expansión entera</option></select>
        <button class="btn btn-suave" id="rellenar">Rellenar</button>
      </div>
    </div>

    <div class="album" id="carpeta">
      <div class="hojas"><div class="hoja" id="hoja"></div></div>
      <div class="barra"><div id="barra" style="width:0%"></div></div>
      <div class="album-pie">
        <button class="btn btn-suave btn-pequeno" id="ant">‹ Anterior</button>
        <span id="pie">…</span>
        <button class="btn btn-suave btn-pequeno" id="sig">Siguiente ›</button>
      </div>
    </div>
    <p class="subtitle" style="text-align:center;margin-top:.8rem">
      Arrastra una carta a otro hueco para colocarla. Los huecos negros están vacíos:
      las cartas se añaden desde la enciclopedia o desde tu colección.
    </p>
  </div>`;

  if (!sesion.filtros) sesion.filtros = await api('/filtros');
  $('#rellenar-set').innerHTML += sesion.filtros.expansiones
    .map((e) => `<option value="${esc(e.set_code)}">${esc(e.nombre)} (${e.cartas})</option>`).join('');

  $('#cual').addEventListener('change', (e) => { album.id = Number(e.target.value); album.pagina = 1; cargarPagina(); });

  $('#ant').addEventListener('click', () => pasar(-1));
  $('#sig').addEventListener('click', () => pasar(1));
  $('#rellenar').addEventListener('click', async () => {
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

async function cargarPagina() {
  const hoja = $('#hoja');
  if (!hoja) return;
  const d = await api(`/binder/${album.id}/pagina/${album.pagina}`);
  album.datos = d;

  $('#carpeta').style.setProperty('--slots-x', d.binder.distribucion[0]);
  hoja.innerHTML = d.huecos.map((h) => casilla(h, d.binder)).join('');
  $('#barra').style.width = d.progreso.porcentaje + '%';
  $('#pie').textContent = `Página ${d.pagina} de ${d.binder.paginas} · ` +
    `${d.progreso.tenidas} de ${d.progreso.llenos || d.binder.slots_por_pagina} conseguidas` +
    (d.progreso.faltan.length ? ` · faltan ${d.progreso.faltan.length}` : '');
  $('#album-sub').textContent = `${d.binder.nombre} · ${d.binder.slots_por_pagina} huecos por página`;
  $('#ant').disabled = d.pagina <= 1;
  $('#sig').disabled = d.pagina >= d.binder.paginas;

  montarArrastre();
}

const casilla = (h, binder) => {
  const c = h.carta;
  if (!c) return `<div class="hueco vacio" data-num="${h.hueco + 1}" data-hueco="${h.hueco}"></div>`;
  const falta = c.cantidad === 0;
  return `<div class="hueco${falta ? ' falta' : ''}" data-hueco="${h.hueco}" data-carta="${esc(c.carta_id)}"
               draggable="true" title="${esc(c.nombre)} · ${esc(c.numero || '')}">
            <img loading="lazy" alt="${esc(c.nombre)}"
                 src="/api/imagen/${encodeURIComponent(c.carta_id)}?size=low"
                 onerror="this.style.display='none'">
          </div>`;
};

/* Pasar página: primero se anima la hoja que se va y solo después se pide la
   siguiente, para que el giro no se corte a la mitad esperando a la red. */
async function pasar(sentido) {
  const d = album.datos;
  const destino = album.pagina + sentido;
  if (!d || destino < 1 || destino > d.binder.paginas) return;
  const hoja = $('#hoja');
  hoja.classList.add(sentido > 0 ? 'pasa-adelante' : 'pasa-atras');
  album.pagina = destino;
  await new Promise((r) => setTimeout(r, 220));
  await cargarPagina();
  const nueva = $('#hoja');
  nueva.classList.remove('pasa-adelante', 'pasa-atras');
  nueva.classList.add(sentido > 0 ? 'pasa-atras' : 'pasa-adelante');
  setTimeout(() => nueva.classList.remove('pasa-adelante', 'pasa-atras'), 430);
}

/* Arrastrar y soltar. Con ratón va el arrastre nativo; en táctil no existe,
   así que se sigue el dedo a mano y se mira qué hueco hay debajo al soltar. */
function montarArrastre() {
  const hoja = $('#hoja');
  let origen = null;

  const soltarEn = async (destino) => {
    hoja.querySelectorAll('.destino').forEach((x) => x.classList.remove('destino'));
    if (!destino || !origen || destino === origen) return;
    await api(`/binder/${album.id}/mover`, { metodo: 'POST', cuerpo: {
      desde: { pagina: album.pagina, hueco: Number(origen.dataset.hueco) },
      hasta: { pagina: album.pagina, hueco: Number(destino.dataset.hueco) } } });
    cargarPagina();
  };

  hoja.addEventListener('dragstart', (ev) => {
    origen = ev.target.closest('.hueco[draggable]');
    if (origen) { origen.classList.add('arrastrando'); ev.dataTransfer.effectAllowed = 'move'; }
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
  hoja.addEventListener('touchstart', (ev) => {
    origen = ev.target.closest('.hueco[draggable]');
    moviendo = false;
  }, { passive: true });
  hoja.addEventListener('touchmove', (ev) => {
    if (!origen) return;
    moviendo = true;
    origen.classList.add('arrastrando');
    const t = ev.touches[0];
    const bajo = document.elementFromPoint(t.clientX, t.clientY);
    const h = bajo && bajo.closest('.hueco');
    hoja.querySelectorAll('.destino').forEach((x) => x.classList.remove('destino'));
    if (h) h.classList.add('destino');
    ev.preventDefault();       // que la página no se desplace mientras se arrastra
  }, { passive: false });
  hoja.addEventListener('touchend', (ev) => {
    if (!origen) return;
    origen.classList.remove('arrastrando');
    if (!moviendo) {           // toque simple: abrir la ficha
      const id = origen.dataset.carta;
      hoja.querySelectorAll('.destino').forEach((x) => x.classList.remove('destino'));
      origen = null;
      if (id) abrirFicha(id);
      return;
    }
    const t = ev.changedTouches[0];
    const bajo = document.elementFromPoint(t.clientX, t.clientY);
    soltarEn(bajo && bajo.closest('.hueco'));
    origen = null;
  });

  /* Sobre una carta se abre su ficha. El hueco vacío ya no abre el buscador
     del catálogo: las cartas entran desde la enciclopedia o desde la colección
     y caen en el primer hueco libre; para ponerlas en un sitio concreto se
     arrastran, que es lo que ya se hacía para recolocarlas. */
  hoja.addEventListener('click', (ev) => {
    const conCarta = ev.target.closest('.hueco[data-carta]');
    if (conCarta) abrirFicha(conCarta.dataset.carta);
  });
}

// ── Perfil ─────────────────────────────────────────────────────────────────

function vistaPerfil() {
  const u = sesion.usuario;
  vista.innerHTML = `
  <div class="wrap">
    <div class="head"><h1 class="title">Mi perfil</h1>
      <p class="subtitle">${esc(u.rol === 'admin' ? 'Administrador' : 'Usuario')}</p></div>

    <div class="panel">
      <h2 style="margin-top:0;font-size:1.05rem">Foto de perfil</h2>
      <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
        <span id="perfil-avatar" style="position:relative;overflow:hidden;display:grid;
              place-items:center;width:72px;height:72px;border-radius:50%;
              background:var(--bg3,#2a2f3a);font-weight:700;font-size:1.5rem">
          ${esc(iniciales(u))}
        </span>
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
  const avPerfil = $('#perfil-avatar');
  if (avPerfil) {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
    img.addEventListener('error', () => img.remove());
    img.src = 'https://lepayimio.es/perfil/foto';
    avPerfil.appendChild(img);
  }

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
    <a class="btn" href="/coleccion" data-ruta>Volver</a></div>`;
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
function ponerFotoDelPortal() {
  const av = document.querySelector('#avatar');
  if (!av || av.querySelector('.avatar-portal')) return;
  const img = document.createElement('img');
  img.className = 'avatar-portal';
  img.alt = '';
  img.decoding = 'async';
  img.addEventListener('error', () => img.remove());
  img.src = 'https://lepayimio.es/perfil/foto';
  av.appendChild(img);
}

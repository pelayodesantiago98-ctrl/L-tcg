/* ==== Zoom de las cartas: la carta ampliada deja sitio al panel ====
   La librería (perspective-card.js) pone la carta al 70% de la ventana y centrada, sin saber nada del panel
   (.panel-carta-album: precio, cantidad, deseada, álbum) que app.js pinta después, en el evento
   perspectivecard:opened. Por eso el panel tapaba la parte de abajo de la carta.
   Aquí la carta ocupa el hueco que queda ENTRE el borde de arriba y el panel, y se recoloca sola cuando el panel
   cambia de alto (al marcar deseada, al poner en álbum...) o cuando cambia la ventana.
   Adaptado de holonook.es —misma librería perspective-card.js, MIT—, que hace esto mismo con su propio pie de
   carta (.zcaption). Se carga justo después de perspective-card.js y antes de app.js: antes de que se cree
   ninguna carta. */
(() => {
  const PC = window.WTCPerspectiveCard?.ClickablePerspectiveCard;
  if (!PC) return;
  const ABIERTA = WTCPerspectiveCard.CSSCLASSES.open;
  const AIRE = 12;                                   // entre la carta y el panel
  // Alto del panel la última vez que se midió: la animación de apertura va ya a su sitio. La primera vez, un cálculo aproximado.
  let reserva = null;
  const panelAbierto = () => document.querySelector('dialog.perspective-card__dialog[open] .panel-carta-album');
  function altoPanel() {
    const panel = panelAbierto();
    if (panel) { const r = panel.getBoundingClientRect(); if (r.height) return reserva = Math.max(0, innerHeight - r.top); }
    return reserva ?? Math.min(200, innerHeight * .28);
  }

  // Tamaño y sitio de la carta ampliada (la librería lo usa al abrir, al terminar de abrir, al recolocar y al cerrar).
  Object.defineProperty(PC.prototype, 'openTargetRect', { configurable: true, get() {
    const [w, h] = this.startingDimensions, vw = innerWidth, vh = innerHeight;
    let arriba = Math.max(AIRE, vh * .03);
    // En pantallas estrechas la carta es casi tan ancha como la ventana: empieza debajo del botón de cerrar.
    if (vw < 600) {
      const x = document.querySelector('dialog.perspective-card__dialog[open] .perspective-card__close-button')?.getBoundingClientRect();
      arriba = Math.max(arriba, x && x.height ? x.bottom + 6 : 58);
    }
    const libre = vh - arriba - altoPanel() - AIRE;                   // alto disponible por encima del panel
    // Como mucho, lo de siempre (70% de la ventana); en pantallas estrechas puede usar más ancho (86%).
    const maxima = Math.min(vw * (vw < 600 ? .86 : .7) / w, vh * .7 / h);
    // Si el panel es enorme (pantalla muy baja), la carta no baja del 40% del alto: el panel se desplaza por dentro.
    const escala = Math.max(Math.min(maxima, libre / h), Math.min(maxima, vh * .4 / h));
    const ancho = w * escala, alto = h * escala;
    return { left: (vw - ancho) / 2, top: arriba + Math.max(0, (libre - alto) / 2), width: ancho, height: alto };
  } });

  // Con la carta ya abierta: nuevo tamaño y sitio. La animación de cierre sale de aquí (_resolvedScale).
  function ajustar(carta) {
    if (!carta || !carta.enlarged || carta.tweening || !carta.element.classList.contains(ABIERTA)) return;
    const r = carta.openTargetRect, s = carta.element.style;
    s.width = r.width + 'px'; s.height = r.height + 'px'; s.left = r.left + 'px'; s.top = r.top + 'px';
    carta._resolvedScale = r.width / carta.startingDimensions[0];
  }
  // La librería, al cambiar la ventana, solo recentra la carta: ahora también cambia su tamaño.
  const recolocar = PC.prototype.updatePosition;
  PC.prototype.updatePosition = function () {
    if (!this._ajustando && this.enlarged && this.element.classList.contains(ABIERTA)) {
      this._ajustando = true; ajustar(this); this._ajustando = false;
    }
    recolocar.call(this);                            // además actualiza el eje de inclinación
  };

  // El panel lo pinta app.js en este mismo evento: se mira cuando ha terminado.
  let observador = null;
  document.addEventListener('perspectivecard:opened', () => queueMicrotask(() => {
    const carta = PC._activeCard, panel = panelAbierto();
    observador?.disconnect(); observador = null;
    if (!carta) return;
    requestAnimationFrame(() => carta.element.classList.add('zoom-suave'));    // desde aquí, los cambios se animan
    if (!panel || !window.ResizeObserver) { carta.updatePosition(); return; }
    observador = new ResizeObserver(() => carta.updatePosition());
    observador.observe(panel);
  }));
  document.addEventListener('perspectivecard:close', () => {
    observador?.disconnect(); observador = null;
    document.querySelectorAll('.perspective-card.zoom-suave').forEach((el) => el.classList.remove('zoom-suave'));
  });
})();

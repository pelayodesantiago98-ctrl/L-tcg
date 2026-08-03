'use strict';
/*
 * Autenticación delegada en el portal.
 *
 * Antes esto firmaba sus propios JWT y guardaba contraseñas con bcrypt. Ya no:
 * quien dice quién eres es lepayimio.es, y aquí solo se comprueba la firma de
 * su cookie. Una base de contraseñas menos que proteger.
 *
 * La tabla `usuarios` se queda, porque la colección y los álbumes cuelgan de su
 * `id` y perderla sería perderlos. Pasa a ser un perfil local: el nombre que
 * viene del portal se busca ahí y, si no está, se crea sobre la marcha. El
 * campo clave_hash queda sin uso y sin valor.
 */
const sso = require('/usr/local/lib/lepayimio/sso');
const { db, ahora } = require('./db');

/*
 * Del nombre del portal al perfil local. Se busca sin distinguir mayúsculas
 * —la columna es COLLATE NOCASE— porque el portal dice "Lepayo" y aquí podría
 * estar guardado de otra forma, y crear un duplicado partiría la colección en
 * dos mitades que no se ven entre sí.
 */
const buscar = db.prepare('SELECT id, usuario, rol FROM usuarios WHERE sso_id = ?');
const crear = db.prepare(
  "INSERT INTO usuarios (usuario, nombre, clave_hash, rol, creado, sso_id) VALUES (?, ?, '', ?, ?, ?)"
);
/* El nombre visible se refresca en cada visita: si te lo cambias en el portal,
   aqui aparece cambiado sin tener que tocar nada mas. */
const renombrar = db.prepare('UPDATE usuarios SET usuario = ? WHERE id = ? AND usuario <> ?');
const tocar = db.prepare('UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?');

function perfilDe(id, nombre) {
  let u = buscar.get(id);
  if (!u) {
    /* Primer usuario en entrar: manda. Si ya hay alguien, el nuevo entra como
       usuario normal y que lo ascienda quien ya sea admin. */
    const hay = db.prepare('SELECT COUNT(*) n FROM usuarios').get().n;
    const info = crear.run(nombre, nombre, hay === 0 ? 'admin' : 'user', ahora(), id);
    u = buscar.get(id) || { id: info.lastInsertRowid, usuario: nombre, rol: 'user' };
  } else if (nombre && u.usuario !== nombre) {
    try { renombrar.run(nombre, u.id, nombre); u.usuario = nombre; } catch { /* da igual */ }
  }
  try { tocar.run(ahora(), u.id); } catch { /* no merece tumbar la peticion */ }
  return u;
}

/* Deja req.usuario si hay sesión del portal, y sigue igualmente si no la hay:
   las páginas públicas y las privadas usan el mismo camino y cada una decide. */
function conSesion(req, res, next) {
  const s = sso.sesion(req);
  req.usuario = null;
  if (s && s.id) {
    try {
      const u = perfilDe(String(s.id), String(s.nombre || s.id));
      req.usuario = { id: u.id, usuario: u.usuario, rol: u.rol };
    } catch (err) {
      console.error('No he podido resolver el perfil de ' + s.id + ': ' + err.message);
    }
  }
  next();
}

const exigeSesion = (req, res, next) => {
  if (!req.usuario) return res.status(401).json({ error: 'Hay que iniciar sesión.' });
  next();
};

const exigeAdmin = (req, res, next) => {
  if (!req.usuario) return res.status(401).json({ error: 'Hay que iniciar sesión.' });
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo para administradores.' });
  next();
};

module.exports = { conSesion, exigeSesion, exigeAdmin };

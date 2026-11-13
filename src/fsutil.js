import fs from 'node:fs';
import path from 'node:path';

const LOCK_STALE_MS = 10000;

/**
 * Construye un error con el formato obligatorio del proyecto:
 *   [ContextBase Error] <CODE> | <op> | <path> | <detalle accionable>
 *
 * El error lleva el codigo en `err.code` y el mensaje ya formateado, de modo que el
 * manejador de `bin/contextbase.js` lo imprime tal cual por stderr.
 */
export function cbError(code, op, target, detail) {
  const location = target === undefined || target === null || target === '' ? '-' : String(target);
  const cleanDetail = String(detail === undefined || detail === null ? '' : detail)
    .replace(/\s+/g, ' ')
    .trim();
  const err = new Error(`[ContextBase Error] ${code} | ${op} | ${location} | ${cleanDetail}`);
  err.code = code;
  err.op = op;
  err.path = location === '-' ? null : location;
  err.detail = cleanDetail;
  return err;
}

/**
 * Emite por stderr el formato obligatorio cuando el llamador NO puede lanzar el error
 * (por ejemplo, porque devuelve un objeto de resultado). Devuelve el mismo error.
 */
export function emitCbError(err) {
  const line =
    err && typeof err.message === 'string' && err.message.startsWith('[ContextBase Error]')
      ? err.message
      : cbError(err && err.code ? err.code : 'CB_UNSPECIFIED', (err && err.op) || 'unknown', null, (err && err.message) || String(err))
          .message;
  try {
    process.stderr.write(`${line}\n`);
  } catch {
    // stderr cerrado: el error ya viaja en el mensaje de la excepcion
  }
  return err;
}

let atomicSeq = 0;

/**
 * Escritura atómica: temporal + rename. Evita archivos a medio escribir si el proceso muere.
 * Si la escritura falla, el temporal se elimina y el error se reporta de forma accionable.
 */
export function writeAtomic(file, content) {
  const dir = path.dirname(file);
  atomicSeq += 1;
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.${atomicSeq}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // el temporal pudo no haberse creado: nada que limpiar
    }
    if (err && typeof err.code === 'string' && err.code.startsWith('CB_')) throw err;
    throw cbError(
      'CB_ATOMIC_WRITE',
      'writeAtomic',
      file,
      `no se pudo escribir de forma atomica (${err && err.message ? err.message : err}); verifica permisos y que ningun proceso tenga el archivo bloqueado.`
    );
  }
}

/** Token de propiedad del lock: pid + timestamp + aleatorio. */
function newLockToken() {
  return JSON.stringify({
    pid: process.pid,
    at: Date.now(),
    token: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
  });
}

function readLockOwner(lock) {
  try {
    return fs.readFileSync(lock, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Determina si el dueno del lock sigue vivo. Un lock stale cuyo proceso sigue existiendo
 * NO se roba: puede estar haciendo un trabajo largo y borrarle el lock rompe la exclusion.
 */
function isLockOwnerAlive(raw) {
  if (!raw) return false;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false; // lock vacio o ilegible: se trata como abandonado
  }
  if (!parsed || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return false;
  if (parsed.pid === process.pid) return true; // lock anidado del mismo proceso
  try {
    process.kill(parsed.pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM'); // EPERM = existe sin permiso => vivo
  }
}

/**
 * Roba un lock abandonado solo si su dueno ya no existe y el contenido sigue siendo
 * exactamente el mismo que se observo al inicio: nunca se borra el lock de otro proceso.
 */
function stealStaleLock(lock) {
  let before;
  try {
    before = fs.readFileSync(lock, 'utf8');
  } catch {
    return false;
  }
  let mtime;
  try {
    mtime = fs.statSync(lock).mtimeMs;
  } catch {
    return false;
  }
  if (Date.now() - mtime <= LOCK_STALE_MS) return false;
  if (isLockOwnerAlive(before)) return false;
  if (readLockOwner(lock) !== before) return false;
  try {
    fs.unlinkSync(lock);
    return true;
  } catch {
    return false;
  }
}

/**
 * Bloqueo asesor por archivo: dos agentes escribiendo el mismo registro no se pisan.
 * Un lock con más de LOCK_STALE_MS se considera abandonado.
 * El lock guarda un token de propiedad: al liberar solo se borra si el token sigue siendo
 * el propio, de modo que nunca se elimina el lock de otro proceso.
 */
export function withLock(file, fn, timeoutMs = 3000) {
  const lock = `${file}.lock`;
  const owner = newLockToken();
  const start = Date.now();
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lock, 'wx');
      try {
        fs.writeSync(fd, owner);
        fs.fsyncSync(fd);
      } catch {
        // si no se puede persistir el token, el lock sigue siendo exclusivo por el open 'wx'
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (stealStaleLock(lock)) continue;
      if (Date.now() - start > timeoutMs) {
        throw cbError(
          'CB_LOCK_BUSY',
          'withLock',
          lock,
          `Bloqueo ocupado por otro proceso (${timeoutMs} ms de espera); espera y reintenta, o elimina ${path.basename(lock)} a mano si el proceso murio.`
        );
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
    // Solo se libera el lock si el token de propiedad sigue intacto.
    if (readLockOwner(lock) === owner) {
      try {
        fs.unlinkSync(lock);
      } catch {}
    }
  }
}

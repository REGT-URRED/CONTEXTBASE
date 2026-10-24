import fs from 'node:fs';
import path from 'node:path';

const LOCK_STALE_MS = 10000;

/**
 * Escritura atómica: temporal + rename. Evita archivos a medio escribir si el proceso muere.
 */
export function writeAtomic(file, content) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Bloqueo asesor por archivo: dos agentes escribiendo el mismo registro no se pisan.
 * Un lock con más de LOCK_STALE_MS se considera abandonado.
 */
export function withLock(file, fn, timeoutMs = 3000) {
  const lock = `${file}.lock`;
  const start = Date.now();
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lock, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lock);
          continue;
        }
      } catch {}
      if (Date.now() - start > timeoutMs) throw new Error(`Bloqueo ocupado: ${path.basename(lock)}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(lock); } catch {}
  }
}

import { stripComments } from './redundancy.js';

/**
 * Fusion Quirurgica sobre JSONC.
 *
 * Objetivo: registrar la configuracion de ContextBase en un archivo `.jsonc` del usuario
 * SIN destruir sus comentarios ni el resto de su configuracion.
 *
 * En vez de reescribir el documento completo (parse -> JSON.stringify), se localiza el
 * fragmento exacto del valor que se quiere cambiar y se sustituye solo ese fragmento.
 * Comentarios, formato y claves ajenas sobreviven intactos.
 */

const SP = ' ';

function isWs(c) {
  return c !== undefined && /\s/.test(c);
}

function skipWs(s, i) {
  while (i < s.length) {
    const c = s[i];
    if (isWs(c)) {
      i += 1;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      const nl = s.indexOf('\n', i);
      i = nl === -1 ? s.length : nl;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end === -1 ? s.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function parseStringLiteral(s, i) {
  let j = i + 1;
  let out = '';
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') {
      const esc = s[j + 1];
      if (esc === 'n') out += '\n';
      else if (esc === 't') out += '\t';
      else if (esc === 'r') out += '\r';
      else if (esc === 'b') out += '\b';
      else if (esc === 'f') out += '\f';
      else if (esc === 'u') {
        out += String.fromCharCode(parseInt(s.slice(j + 2, j + 6), 16));
        j += 6;
        continue;
      } else out += esc;
      j += 2;
      continue;
    }
    if (c === '"') return { value: out, end: j + 1 };
    out += c;
    j += 1;
  }
  throw new Error('JSONC: cadena sin cerrar');
}

function parseLiteral(s, i) {
  let j = i;
  while (j < s.length && !',]}\n\r\t '.includes(s[j])) j += 1;
  const raw = s.slice(i, j);
  if (raw === 'true') return { value: true, end: j };
  if (raw === 'false') return { value: false, end: j };
  if (raw === 'null') return { value: null, end: j };
  const num = Number(raw);
  if (raw === '' || Number.isNaN(num)) throw new Error(`JSONC: literal invalido "${raw}"`);
  return { value: num, end: j };
}

/**
 * Parsea JSONC devolviendo el valor y la posicion de cada miembro y array.
 * `members` mapea ruta -> { key, valueStart, valueEnd }.
 * `objects` mapea ruta -> { open, close, members, path }.
 */
export function parseJsonc(raw) {
  const members = new Map();
  const objects = new Map();

  function parseValue(i, path) {
    i = skipWs(raw, i);
    const c = raw[i];
    if (c === '{') return parseObject(i, path);
    if (c === '[') return parseArray(i, path);
    if (c === '"') {
      const r = parseStringLiteral(raw, i);
      return { value: r.value, start: i, end: r.end };
    }
    const r = parseLiteral(raw, i);
    return { value: r.value, start: i, end: r.end };
  }

  function parseObject(i, path) {
    const open = i;
    const list = [];
    const value = {};
    i += 1;
    for (;;) {
      i = skipWs(raw, i);
      if (i >= raw.length) throw new Error('JSONC: objeto sin cerrar');
      if (raw[i] === '}') {
        i += 1;
        break;
      }
      if (raw[i] === ',') {
        i += 1;
        continue;
      }
      if (raw[i] !== '"') throw new Error(`JSONC: se esperaba clave en la posicion ${i}`);
      const keyRes = parseStringLiteral(raw, i);
      const key = keyRes.value;
      let j = skipWs(raw, keyRes.end);
      if (raw[j] !== ':') throw new Error(`JSONC: se esperaba ":" tras la clave "${key}"`);
      j = skipWs(raw, j + 1);
      const child = parseValue(j, path.concat([key]));
      value[key] = child.value;
      list.push({ key, valueStart: child.start, valueEnd: child.end });
      members.set(path.concat([key]).join(SP), {
        key,
        valueStart: child.start,
        valueEnd: child.end,
        parentPath: path,
      });
      i = child.end;
    }
    objects.set(path.join(SP), { open, close: i, members: list, path });
    return { value, start: open, end: i };
  }

  function parseArray(i, path) {
    const open = i;
    const list = [];
    const value = [];
    i += 1;
    for (;;) {
      i = skipWs(raw, i);
      if (i >= raw.length) throw new Error('JSONC: array sin cerrar');
      if (raw[i] === ']') {
        i += 1;
        break;
      }
      if (raw[i] === ',') {
        i += 1;
        continue;
      }
      const child = parseValue(i, path.concat(['[]']));
      value.push(child.value);
      list.push({ valueStart: child.start, valueEnd: child.end });
      i = child.end;
    }
    objects.set(path.concat(['[]']).join(SP), { open, close: i, items: list, path: path.concat(['[]']) });
    return { value, start: open, end: i };
  }

  const root = parseValue(0, []);
  return { value: root.value, members, objects };
}

function indentOf(raw, index) {
  const lineStart = raw.lastIndexOf('\n', index - 1) + 1;
  const m = raw.slice(lineStart, index).match(/^[ \t]*/);
  return m ? m[0] : '';
}

function serialize(value, indent) {
  const text = JSON.stringify(value, null, 2);
  if (!indent) return text;
  return text
    .split('\n')
    .map((l, idx) => (idx === 0 ? l : indent + l))
    .join('\n');
}

function buildNested(tail, value) {
  let acc = value;
  for (let i = tail.length - 1; i >= 1; i -= 1) acc = { [tail[i]]: acc };
  return acc;
}

function insertMember(raw, obj, key, value) {
  const last = obj.members[obj.members.length - 1];
  const baseIndent = indentOf(raw, obj.open);
  const childIndent = baseIndent + '  ';
  const body = serialize(value, childIndent)
    .split('\n')
    .map((l, idx) => (idx === 0 ? l : childIndent + l))
    .join('\n');
  const entry = `${JSON.stringify(key)}: ${body}`;

  if (!last) {
    return raw.slice(0, obj.open + 1) + '\n' + childIndent + entry + '\n' + baseIndent + raw.slice(obj.close - 1);
  }

  const tail = raw.slice(last.valueEnd);
  const afterWs = last.valueEnd + (tail.length - tail.replace(/^[\s]*/, '').length);
  const hasComma = raw[afterWs] === ',';
  const insertAt = hasComma ? afterWs + 1 : afterWs;
  const sep = hasComma ? '\n' + childIndent : ',\n' + childIndent;
  return raw.slice(0, insertAt) + sep + entry + raw.slice(insertAt);
}

/**
 * Establece `value` en la ruta `path` preservando el resto del documento.
 * Si la ruta no existe, se inserta el subarbol completo que falta.
 */
export function setJsoncPath(raw, path, value) {
  const parsed = parseJsonc(raw);

  const existing = parsed.members.get(path.join(SP));
  if (existing) {
    const indent = indentOf(raw, existing.valueStart);
    return raw.slice(0, existing.valueStart) + serialize(value, indent) + raw.slice(existing.valueEnd);
  }

  // Se busca el ancestro mas profundo que exista y sea un objeto navegable.
  let depth = 0;
  for (let d = path.length - 1; d >= 0; d -= 1) {
    const parent = parsed.objects.get(path.slice(0, d).join(SP));
    if (parent && parent.members) {
      depth = d;
      break;
    }
  }

  const nested = buildNested(path.slice(depth), value);

  if (depth === 0) {
    const rootObj = parsed.objects.get('');
    if (!rootObj) throw new Error('JSONC: la raiz no es un objeto');
    return insertMember(raw, rootObj, path[0], nested);
  }

  const parent = parsed.objects.get(path.slice(0, depth).join(SP));
  const childKey = path[depth];
  const childMember = parent.members.find((m) => m.key === childKey);
  if (childMember) {
    const indent = indentOf(raw, childMember.valueStart);
    return raw.slice(0, childMember.valueStart) + serialize(nested, indent) + raw.slice(childMember.valueEnd);
  }
  return insertMember(raw, parent, childKey, nested);
}

/**
 * Agrega un valor a un array JSONC en la ruta indicada, si aun no existe.
 * Devuelve el documento original cuando el valor ya estaba presente.
 */
export function appendJsoncArray(raw, path, item) {
  const parsed = parseJsonc(raw);
  const arr = parsed.objects.get(path.concat(['[]']).join(SP));
  if (!arr) return null;

  const target = JSON.stringify(item);
  for (const it of arr.items) {
    if (raw.slice(it.valueStart, it.valueEnd).trim() === target) return raw;
  }

  const last = arr.items[arr.items.length - 1];
  const baseIndent = indentOf(raw, arr.open);
  const childIndent = baseIndent + '  ';

  if (!last) {
    return raw.slice(0, arr.open + 1) + '\n' + childIndent + target + '\n' + baseIndent + raw.slice(arr.close - 1);
  }
  const tail = raw.slice(last.valueEnd);
  const afterWs = last.valueEnd + (tail.length - tail.replace(/^[\s]*/, '').length);
  const hasComma = raw[afterWs] === ',';
  const insertAt = hasComma ? afterWs + 1 : afterWs;
  const sep = hasComma ? '\n' + childIndent : ',\n' + childIndent;
  return raw.slice(0, insertAt) + sep + target + raw.slice(insertAt);
}

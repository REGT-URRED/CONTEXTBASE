import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const OPENCODE_DIR = path.join(HOME, '.config', 'opencode');

const SKILL_ROOTS = [
  ['.agents/skills', path.join(HOME, '.agents', 'skills')],
  ['.config/opencode/skills', path.join(OPENCODE_DIR, 'skills')],
  ['.gemini/config/skills', path.join(HOME, '.gemini', 'config', 'skills')],
  ['.claude/skills', path.join(HOME, '.claude', 'skills')],
];

// Familias globales que el escaneo no puede perder de vista: si una no aparece,
// se reporta igual con 0 para que el hueco sea visible.
const PRINCIPAL = [
  { id: 'superpowers', label: 'Superpowers', match: (name, pkg) => pkg === 'superpowers' },
  { id: 'ponytail', label: 'Ponytail', match: (name, pkg) => pkg === '@dietrichgebert/ponytail' || name === 'ponytail' || name.startsWith('ponytail-') },
  { id: 'antislop', label: 'Antislop', match: name => name === 'antislop' || name.startsWith('antislop-') },
  { id: 'contextbase', label: 'ContextBase', match: (name, pkg) => name === 'contextbase' || pkg === 'contextbase' },
  { id: 'officecli', label: 'OfficeCLI', match: (name, pkg) => name === 'officecli' || pkg === 'officecli' },
];

const REF_DIRS = [
  ['agents', path.join(OPENCODE_DIR, 'agents')],
  ['commands', path.join(OPENCODE_DIR, 'commands')],
];

const OPENCODE_CONFIG = path.join(OPENCODE_DIR, 'opencode.jsonc');
const AGENTS_MD = path.join(OPENCODE_DIR, 'AGENTS.md');

function listDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() || d.isSymbolicLink()).map(d => d.name); }
  catch { return []; }
}

function listFiles(dir, ext) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile() && d.name.endsWith(ext)).map(d => d.name); }
  catch { return []; }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// Directorios que empaquetan skills como <base>/<pkg>/skills o <base>/@scope/<pkg>/skills.
function nodeModuleHomes() {
  const homes = [
    ['opencode-npm', path.join(OPENCODE_DIR, 'node_modules')],
    ['plugin', path.join(OPENCODE_DIR, 'plugins')],
  ];
  if (process.platform === 'win32') {
    homes.push(['npm-global', path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'npm', 'node_modules')]);
  } else {
    homes.push(['npm-global', path.join(HOME, '.npm-global', 'lib', 'node_modules')]);
    homes.push(['npm-global-system', '/usr/lib/node_modules']);
  }
  return homes;
}

function packageSkillRoots(base, label) {
  const roots = [];
  for (const name of listDirs(base)) {
    if (name.startsWith('@')) {
      for (const sub of listDirs(path.join(base, name))) {
        const dir = path.join(base, name, sub, 'skills');
        if (isDir(dir)) roots.push([label + '/' + name + '/' + sub, dir, name + '/' + sub]);
      }
      continue;
    }
    const dir = path.join(base, name, 'skills');
    if (isDir(dir)) roots.push([label + '/' + name, dir, name]);
  }
  return roots;
}

// [etiqueta, ruta, paquete|null]. Tolerante: cualquier raiz ausente devuelve [].
function discoverSkillRoots() {
  const roots = SKILL_ROOTS.map(([label, dir]) => [label, dir, null]);
  for (const [label, base] of nodeModuleHomes()) roots.push(...packageSkillRoots(base, label));
  return roots;
}

// Quita comentarios solo fuera de strings: un regex global se comeria "https://" y romperia el JSON.
function stripComments(raw) {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') {
      let j = i + 1;
      while (j < raw.length) {
        if (raw[j] === '\\') { j += 2; continue; }
        if (raw[j] === '"') { j++; break; }
        j++;
      }
      out += raw.slice(i, j);
      i = j;
      continue;
    }
    if (c === '/' && raw[i + 1] === '/') {
      const nl = raw.indexOf('\n', i);
      i = nl === -1 ? raw.length : nl;
      continue;
    }
    if (c === '/' && raw[i + 1] === '*') {
      const end = raw.indexOf('*/', i + 2);
      i = end === -1 ? raw.length : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function readJsonc(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(stripComments(raw).replace(/,\s*([}\]])/g, '$1'));
  } catch { return null; }
}

export function scan() {
  const skills = {};
  const located = [];
  for (const [label, dir, pkg] of discoverSkillRoots()) {
    const names = listDirs(dir);
    skills[label] = names;
    for (const name of names) located.push({ name, label, pkg: pkg ? pkg.toLowerCase() : null });
  }

  const principals = PRINCIPAL.map(p => ({ id: p.id, label: p.label, count: 0, roots: [] }));
  const otherNames = new Set();
  for (const s of located) {
    // Comparacion sin distinguir mayusculas, igual que las referencias.
    const idx = PRINCIPAL.findIndex(p => p.match(s.name.toLowerCase(), s.pkg));
    if (idx < 0) { otherNames.add(s.name); continue; }
    const principal = principals[idx];
    principal.count += 1;
    if (!principal.roots.includes(s.label)) principal.roots.push(s.label);
  }
  const others = { count: otherNames.size, names: [...otherNames].sort() };

  const duplicated = [];
  const seen = new Map();
  for (const [label, names] of Object.entries(skills)) {
    for (const n of names) {
      if (!seen.has(n)) seen.set(n, []);
      seen.get(n).push(label);
    }
  }
  for (const [name, where] of seen) if (where.length > 1) duplicated.push({ name, where });

  const dangling = [];
  const knownSkills = new Set(Object.values(skills).flat().map(n => n.toLowerCase()));
  const knownAgents = new Set(listFiles(path.join(OPENCODE_DIR, 'agents'), '.md').map(f => f.replace(/\.md$/, '').toLowerCase()));
  for (const [label, dir] of REF_DIRS) {
    for (const file of listFiles(dir, '.md')) {
      let text = '';
      try { text = fs.readFileSync(path.join(dir, file), 'utf8'); } catch { continue; }
      const skillRefs = text.match(/skills[\\/]([a-z0-9-]+)/gi) || [];
      for (const ref of skillRefs) {
        const id = ref.split(/[\\/]/).pop().toLowerCase();
        if (!knownSkills.has(id)) dangling.push({ file: label + '/' + file, kind: 'skill', ref: id });
      }
      const agentRefs = text.match(/agent:\s*"([a-z0-9-]+)"/gi) || [];
      for (const ref of agentRefs) {
        const id = ref.replace(/.*"([^"]+)".*/, '$1');
        if (!knownAgents.has(id.toLowerCase())) dangling.push({ file: label + '/' + file, kind: 'agent', ref: id });
      }
    }
  }

  let blocks = [];
  try {
    const agentsMd = fs.readFileSync(AGENTS_MD, 'utf8');
    const matches = agentsMd.matchAll(/<!--\s*([a-z0-9-]+):(start|begin)\s*-->/gi);
    for (const m of matches) {
      const name = m[1];
      const close = new RegExp('<!--\\s*' + name + ':(end|/end)\\s*-->', 'i');
      const closedBySlash = new RegExp('<!--\\s*/\\s*' + name + '\\s*-->', 'i');
      if (!close.test(agentsMd) && !closedBySlash.test(agentsMd)) blocks.push({ block: name, issue: 'sin cierre' });
      const paths = (agentsMd.split(m[0])[1] || '').split(/<!--/)[0].match(/(?:~|\/)[^\s`"')]+/g) || [];
      for (const p of paths) {
        if (!/SKILL\.md$/.test(p)) continue;
        const expanded = p.replace(/^~/, HOME).replace(/\//g, path.sep);
        if (!fs.existsSync(expanded)) blocks.push({ block: name, issue: 'referencia rota: ' + p });
      }
    }
  } catch { blocks = []; }

  const mcp = { legacy: [], v2: [], duplicated: [], sameCommand: [] };
  const cfg = readJsonc(OPENCODE_CONFIG);
  if (cfg && cfg.mcp) {
    const isServer = v => v && typeof v === 'object' && (v.type || v.command || v.url);
    for (const [k, v] of Object.entries(cfg.mcp)) {
      if (k === 'servers' || k === 'timeout') continue;
      if (isServer(v)) mcp.legacy.push(k);
    }
    if (cfg.mcp.servers) for (const k of Object.keys(cfg.mcp.servers)) mcp.v2.push(k);
    const all = [...mcp.legacy, ...mcp.v2];
    mcp.duplicated = all.filter((n, i) => all.indexOf(n) !== i);
    const byCmd = new Map();
    for (const k of all) {
      const s = (cfg.mcp.servers && cfg.mcp.servers[k]) || cfg.mcp[k];
      const key = JSON.stringify(s.command || s.url || '');
      if (!key || key === '""') continue;
      if (!byCmd.has(key)) byCmd.set(key, []);
      byCmd.get(key).push(k);
    }
    for (const [, names] of byCmd) if (names.length > 1) mcp.sameCommand.push(names);
  }

  const total = duplicated.length + dangling.length + blocks.length + mcp.duplicated.length + mcp.sameCommand.length + mcp.legacy.length;
  return { skills, duplicated, dangling, blocks, mcp, total, principals, others };
}

export function render(result = scan()) {
  const lines = ['# Redundancia (0 redundancia)', '', '## Skills por ubicacion'];
  for (const [label, names] of Object.entries(result.skills)) lines.push('- ' + label + '=' + names.length);
  lines.push('', '## Skills principales');
  for (const p of result.principals) {
    const where = p.count ? '(' + p.roots.join(', ') + ')' : '(no encontrado)';
    lines.push('- ' + p.label + ': ' + p.count + '  ' + where);
  }
  lines.push('', 'Otros skills: ' + result.others.count);
  lines.push('', '## Skills duplicados entre ubicaciones');
  lines.push(result.duplicated.length ? result.duplicated.map(d => '- ' + d.name + ' -> ' + d.where.join(', ')).join('\n') : '(ninguno)');
  lines.push('', '## Referencias rotas en commands/agents');
  lines.push(result.dangling.length ? result.dangling.map(d => '- ' + d.file + ' -> ' + d.kind + ' "' + d.ref + '" inexistente').join('\n') : '(ninguna)');
  lines.push('', '## Bloques de AGENTS.md');
  lines.push(result.blocks.length ? result.blocks.map(b => '- ' + b.block + ': ' + b.issue).join('\n') : '(sin problemas)');
  lines.push('', '## MCP');
  lines.push('- entradas legacy fuera de mcp.servers: ' + (result.mcp.legacy.length ? result.mcp.legacy.join(', ') : 'ninguna'));
  lines.push('- nombres duplicados: ' + (result.mcp.duplicated.length ? result.mcp.duplicated.join(', ') : 'ninguno'));
  lines.push('- comandos identicos repetidos: ' + (result.mcp.sameCommand.length ? result.mcp.sameCommand.map(n => n.join('=')).join(' | ') : 'ninguno'));
  lines.push('', 'Total de problemas: ' + result.total);
  return lines.join('\n');
}

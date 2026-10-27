import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './fsutil.js';
import { loadGuarded } from './guard.js';
import { baseline } from './guard.js';
import { loadToolsState } from './registry.js';

function snapshotRoot(cwd) {
  return path.join(cwd, 'contextbase', 'snapshot');
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function copyFileSafe(src, dest) {
  try {
    if (!fs.existsSync(src)) return false;
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    return true;
  } catch {
    return false;
  }
}

export async function create(cwd, note = '') {
  const root = snapshotRoot(cwd);
  ensureDir(root);
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(root, id);
  ensureDir(dir);

  const guarded = loadGuarded(cwd);
  for (const rel of guarded) {
    copyFileSafe(path.join(cwd, rel), path.join(dir, rel));
  }

  try {
    const b = baseline(cwd);
    writeAtomic(path.join(dir, 'baseline.json'), JSON.stringify(b, null, 2));
  } catch {}

  try {
    const tools = loadToolsState(cwd);
    writeAtomic(path.join(dir, 'tools.json'), JSON.stringify(tools, null, 2));
  } catch {}

  writeAtomic(path.join(dir, 'meta.json'), JSON.stringify({ note: String(note || ''), created: new Date().toISOString() }, null, 2));

  prune(cwd, 5);
  return id;
}

export function prune(cwd, keep = 5) {
  const root = snapshotRoot(cwd);
  if (!fs.existsSync(root)) return;
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
  } catch { return; }
  while (dirs.length > keep) {
    const oldest = dirs.shift();
    try { fs.rmSync(path.join(root, oldest), { recursive: true, force: true }); } catch {}
  }
}

export function list(cwd) {
  const root = snapshotRoot(cwd);
  if (!fs.existsSync(root)) return [];
  prune(cwd, 5);
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse();
  } catch { return []; }
  const out = [];
  for (const id of dirs.slice(0, 5)) {
    let note = '';
    let created = null;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(root, id, 'meta.json'), 'utf8'));
      note = meta && meta.note ? meta.note : '';
      created = meta && meta.created ? meta.created : null;
    } catch {}
    out.push({ id, note, created });
  }
  return out;
}

export async function restore(cwd, id) {
  const root = snapshotRoot(cwd);
  let targetId = id;
  if (!targetId) {
    const l = list(cwd);
    if (!l.length) return { ok: false, error: 'no snapshots available', restored: [] };
    targetId = l[0].id;
  }
  const dir = path.join(root, targetId);
  if (!fs.existsSync(dir)) return { ok: false, error: 'snapshot not found', restored: [] };

  const guarded = loadGuarded(cwd);
  const restored = [];
  for (const rel of guarded) {
    const src = path.join(dir, rel);
    if (copyFileSafe(src, path.join(cwd, rel))) restored.push(rel);
  }
  return { ok: true, restored };
}
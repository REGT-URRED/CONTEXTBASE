import fs from 'node:fs';
import path from 'node:path';
import { analyzeProject } from './scanner.js';
import { writeContextBase } from './generator.js';
import { runMaintenance } from './maintenance.js';
import { injectAgentRules } from './rules.js';
import { refreshBaseline } from './guard.js';
import { installSkill } from './installer.js';
import { prepareStrandsContext } from './strands.js';

const BASE_FILES = ['fundamentos.md', 'changelog.md', 'tasklist.md'];
const STRANDS_CONTEXT = path.join('contextbase', 'strands', 'context.json');
const COMPONENTS_FILE = path.join('contextbase', 'componentes.md');
const STALE_SOURCES = ['tasklist.md', 'changelog.md', 'componentes.md', 'fundamentos.md'];
const COMPONENTS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function resolveProject(projectDir) {
  return path.resolve(projectDir || process.cwd());
}

function mtimeMs(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return null; }
}

function relative(projectDir, file) {
  return path.relative(projectDir, file).replace(/\\/g, '/');
}

export function strandsStale(projectDir) {
  const root = resolveProject(projectDir);
  const contextMtime = mtimeMs(path.join(root, STRANDS_CONTEXT));
  if (contextMtime === null) return true;
  const sourceTimes = STALE_SOURCES
    .map(name => mtimeMs(path.join(root, 'contextbase', name)))
    .filter(value => value !== null);
  if (sourceTimes.length === 0) return false;
  return contextMtime < Math.max(...sourceTimes);
}

export function componentsStale(projectDir) {
  const root = resolveProject(projectDir);
  const componentsMtime = mtimeMs(path.join(root, COMPONENTS_FILE));
  if (componentsMtime === null) return true;
  return (Date.now() - componentsMtime) > COMPONENTS_MAX_AGE_MS;
}

export function refreshStrands(projectDir) {
  const root = resolveProject(projectDir);
  try {
    if (!strandsStale(root)) return false;
    prepareStrandsContext(root);
    return true;
  } catch {
    return false;
  }
}

export function refreshComponents(projectDir) {
  const root = resolveProject(projectDir);
  try {
    if (!componentsStale(root)) return false;
    runMaintenance(root);
    return true;
  } catch {
    return false;
  }
}

export function silentInit(projectDir) {
  const root = resolveProject(projectDir);
  const contextDir = path.join(root, 'contextbase');
  fs.mkdirSync(contextDir, { recursive: true });

  const analysis = analyzeProject(root);
  const written = writeContextBase(root, analysis, { force: false });
  const files = written.filesWritten.slice();

  try {
    const maintenance = runMaintenance(root);
    if (maintenance && maintenance.file) files.push(relative(root, maintenance.file));
  } catch {}

  try { injectAgentRules(root); } catch {}
  try { refreshBaseline(root); } catch {}
  try { installSkill('global'); } catch {}

  try {
    const strands = prepareStrandsContext(root);
    for (const file of strands.files) files.push(relative(root, file));
  } catch {}

  return { created: true, files };
}

export function autoEnsure(projectDir) {
  const root = resolveProject(projectDir);
  const summary = { initialized: false, componentsRefreshed: false, strandsRefreshed: false };
  try {
    const contextDir = path.join(root, 'contextbase');
    const missing = !fs.existsSync(contextDir) || BASE_FILES.some(name => !fs.existsSync(path.join(contextDir, name)));
    if (missing) {
      silentInit(root);
      summary.initialized = true;
      return summary;
    }
    summary.componentsRefreshed = refreshComponents(root);
    summary.strandsRefreshed = refreshStrands(root);
  } catch {}
  return summary;
}

import fs from 'node:fs';
import path from 'node:path';
import { analyzeProject } from './scanner.js';
import { writeContextBase, syncFundamentos } from './generator.js';
import { runMaintenance } from './maintenance.js';
import { injectAgentRules, CONTEXTBASE_VERSION } from './rules.js';
import { refreshBaseline } from './guard.js';
import { installSkill } from './installer.js';
import { prepareStrandsContext, ensureStrandsSdk } from './strands.js';
import { autoConfigureProject, ensureGitExclude, hasStaleAgentConfig } from './autoconfig.js';
import { installGitHook } from './hooks.js';
import { autoPulseWeb } from './web.js';

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

function isTestEnv() {
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.execArgv.includes('--test');
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

export function rulesStale(projectDir) {
  const root = resolveProject(projectDir);
  const targets = ['AGENTS.md', 'CLAUDE.md', '.cursorrules', '.windsurfrules'];
  const marker = `<!-- CONTEXTBASE:v${CONTEXTBASE_VERSION} -->`;
  for (const rel of targets) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) return true;
    try {
      const text = fs.readFileSync(full, 'utf8');
      if (!text.includes(marker)) return true;
    } catch {
      return true;
    }
  }
  return false;
}

export function refreshStrands(projectDir) {
  const root = resolveProject(projectDir);
  try {
    if (!strandsStale(root)) return false;
    prepareStrandsContext(root);
    scheduleStrandsSdk(root);
    return true;
  } catch {
    return false;
  }
}

/**
 * Autogestion del SDK de Strands: si falta, se instala en segundo plano (no bloquea)
 * y se deja constancia en contextbase/strands/sdk.json. No reintenta mas de una vez
 * cada 30 minutos y se desactiva con CONTEXTBASE_STRANDS_AUTOINSTALL=0.
 */
export function scheduleStrandsSdk(projectDir) {
  const root = resolveProject(projectDir);
  if (isTestEnv()) return null;
  if (process.env.CONTEXTBASE_STRANDS_AUTOINSTALL === '0') return null;
  const stateFile = path.join(root, 'contextbase', 'strands', 'sdk.json');
  try {
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
    const last = Date.parse(state.lastAttempt || '') || 0;
    if (Date.now() - last < 1800000) return state;
    const res = ensureStrandsSdk(root, { mode: 'auto' });
    const record = { lastAttempt: new Date().toISOString(), action: res.action, installed: Boolean(res.installed), version: res.version || null, log: res.log || null };
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(record, null, 2) + '\n', 'utf8');
    return record;
  } catch {
    return null;
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

export function refreshRulesAndSync(projectDir) {
  const root = resolveProject(projectDir);
  try {
    if (!rulesStale(root)) return false;
    const analysis = analyzeProject(root);
    syncFundamentos(root, analysis);
    injectAgentRules(root);
    refreshBaseline(root);
    return true;
  } catch {
    return false;
  }
}

export function silentInit(projectDir, options = {}) {
  const root = resolveProject(projectDir);
  const contextDir = path.join(root, 'contextbase');
  fs.mkdirSync(contextDir, { recursive: true });

  const analysis = analyzeProject(root);
  const written = writeContextBase(root, analysis, { force: false });
  const files = written.filesWritten.slice();

  try { syncFundamentos(root, analysis); } catch {}

  try {
    const maintenance = runMaintenance(root);
    if (maintenance && maintenance.file) files.push(relative(root, maintenance.file));
  } catch {}

  try {
    if (!isTestEnv() || options.autoConfig) {
      const cfg = autoConfigureProject(root, options);
      for (const f of cfg.files) files.push(f);
    }
  } catch {}

  try { injectAgentRules(root); } catch {}
  try { refreshBaseline(root); } catch {}
  try { if (!isTestEnv() || options.installSkill) installSkill('all', root); } catch {}
  try { if (fs.existsSync(path.join(root, '.git'))) installGitHook(root, 'install'); } catch {}
  try { ensureGitExclude(root); } catch {}

  try {
    const strands = prepareStrandsContext(root);
    for (const file of strands.files) files.push(relative(root, file));
  } catch {}

  return { created: true, files };
}

export function autoEnsure(projectDir, options = {}) {
  const root = resolveProject(projectDir);
  const summary = {
    initialized: false,
    componentsRefreshed: false,
    strandsRefreshed: false,
    rulesRefreshed: false,
    agentsConfigured: false,
    gitHookInstalled: false,
    webPulsed: false
  };
  try {
    const contextDir = path.join(root, 'contextbase');
    const missing = !fs.existsSync(contextDir) || BASE_FILES.some(name => !fs.existsSync(path.join(contextDir, name)));
    if (missing) {
      silentInit(root, options);
      summary.initialized = true;
      summary.agentsConfigured = !isTestEnv() || Boolean(options.autoConfig);
      return summary;
    }
    summary.rulesRefreshed = refreshRulesAndSync(root);
    summary.componentsRefreshed = refreshComponents(root);
    summary.strandsRefreshed = refreshStrands(root);

    if (!isTestEnv() || options.autoConfig) {
      const needConfig = hasStaleAgentConfig(root) || Boolean(options.autoConfig);
      if (needConfig) {
        autoConfigureProject(root, options);
        summary.agentsConfigured = true;
      }
      if (fs.existsSync(path.join(root, '.git')) && !fs.existsSync(path.join(root, '.git', 'hooks', 'post-commit'))) {
        const hk = installGitHook(root, 'install');
        summary.gitHookInstalled = Boolean(hk && hk.ok);
      }
    }

    try {
      const pulsed = autoPulseWeb(root, options.deps);
      summary.webPulsed = Boolean(pulsed);
    } catch {}
  } catch {}
  return summary;
}

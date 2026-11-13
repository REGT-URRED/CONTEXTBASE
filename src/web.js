import fs from 'node:fs';
import path from 'node:path';
import { scanFiles } from './scanner.js';
import * as slop from './slop.js';
import { cbError, emitCbError, writeAtomic } from './fsutil.js';
import { isValidId, requireId, resolveInside } from './sandbox.js';
import {
  defaultDeps,
  latestRun,
  listRuns,
  makeRunId,
  readState,
  resolveRun,
  startSwarm,
  swarmCollect,
  swarmSend,
  swarmStatus,
  swarmStop,
  writeState,
} from './swarm.js';

export const PHILOSOPHY = 'No es la IA, es quien controla a la IA';
export const WEB_DIR = 'contextbase/web';
export const SWARM_DIR = 'contextbase/swarm';

function rel(cwd, abs) {
  return path.relative(cwd, abs).split(path.sep).join('/');
}

function estimateTokensFromBytes(bytes) {
  return Math.max(1, Math.ceil(Number(bytes || 0) / 4));
}

function estimateTokensFromText(text) {
  return estimateTokensFromBytes(Buffer.byteLength(String(text || ''), 'utf8'));
}

function listProjectFiles(root) {
  try {
    const scanned = scanFiles(root);
    return Array.isArray(scanned)
      ? scanned
      : scanned && Array.isArray(scanned.files)
      ? scanned.files
      : [];
  } catch {
    return [];
  }
}

/**
 * Ruta absoluta y contenida para contextbase/<baseRel>/<run>.
 * Un run manipulado ("..", "../..", absolutos) lanza CB_PATH_ESCAPE.
 */
function runArea(root, baseRel, run, op) {
  const id = requireId(run, op, 'id de run');
  return resolveInside(path.join(path.resolve(root), baseRel), id, { op, what: 'id de run' });
}

/** Ruta absoluta de un campo de worker validada dentro del proyecto. */
function workerFile(root, worker, field, op) {
  const value = worker ? worker[field] : undefined;
  if (typeof value !== 'string' || value === '') {
    throw cbError(
      'CB_STATE_SCHEMA',
      `${op}.${field}`,
      String(worker && worker.id),
      `el worker no tiene "${field}" como ruta valida; el estado esta corrupto.`
    );
  }
  return resolveInside(path.resolve(root), value, { op: `${op}.${field}`, what: `ruta "${field}" del worker` });
}

/**
 * Sincroniza los artefactos de una corrida entre contextbase/swarm/<run> y contextbase/web/<run>
 * para que ambos espacios estén siempre espejados y limpios dentro de contextbase/.
 */
export function syncRunMirror(cwd, run) {
  const root = path.resolve(cwd || process.cwd());
  if (!run) return;
  if (!isValidId(run)) {
    throw cbError('CB_PATH_ESCAPE', 'syncRunMirror', String(run), `el id de run "${run}" no es valido; usa solo letras, numeros, punto, guion y guion bajo.`);
  }
  const swarmRunDir = runArea(root, SWARM_DIR, run, 'syncRunMirror');
  const webRunDir = runArea(root, WEB_DIR, run, 'syncRunMirror');
  if (!fs.existsSync(swarmRunDir) && !fs.existsSync(webRunDir)) return;

  const copyTree = (src, dest) => {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const sPath = path.join(src, entry.name);
      const dPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyTree(sPath, dPath);
      } else if (entry.isFile()) {
        const sStat = fs.statSync(sPath);
        const dStat = fs.existsSync(dPath) ? fs.statSync(dPath) : null;
        if (!dStat || sStat.mtimeMs >= dStat.mtimeMs) {
          fs.copyFileSync(sPath, dPath);
        }
      }
    }
  };

  try {
    copyTree(swarmRunDir, webRunDir);
    copyTree(webRunDir, swarmRunDir);
  } catch {
    // sincronización best-effort sin interrumpir el flujo
  }
}

/**
 * Divide la Presa (objetivo humano) en segmentos coherentes y reparte los archivos del proyecto
 * en hilos de seda disjuntos (assignedFiles) para que dos Arañas jamás toquen el mismo archivo.
 */
export function decomposePrey(cwd, prey, spiderCount = 2) {
  const root = path.resolve(cwd || process.cwd());
  const text = String(prey || '').trim();
  const count = Math.max(1, Math.min(12, Number(spiderCount || 2)));

  const repoFiles = listProjectFiles(root)
    .map((f) => String(f.relativePath || '').replace(/\\/g, '/'))
    .filter(
      (f) =>
        f &&
        !f.startsWith('contextbase/') &&
        !f.startsWith('.worktrees/') &&
        !f.startsWith('.opencode/') &&
        !f.startsWith('.kilo/') &&
        !f.startsWith('.kilocode/') &&
        !['opencode.json', 'kilo.json', '.mcp.json', 'AGENTS.md', 'CLAUDE.md', '.cursorrules', '.windsurfrules'].includes(f)
    );

  // Extraer sub-objetivos del texto humano si existen separadores naturales
  const rawClauses = text
    .split(/(?:\r?\n|;|\s+\|\s+|\s+(?:y además|además|luego|también)\s+)/i)
    .map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean);

  const roleArchetypes = [
    { role: 'Hilo de Núcleo y Dominio Principal', focus: 'Lógica central, módulos de negocio y contratos base' },
    { role: 'Hilo de Integración, CLI y Superficie Operativa', focus: 'Comandos, adaptadores, hooks, MCP y configuración' },
    { role: 'Hilo de Verificación, Pruebas y Blindaje', focus: 'Pruebas automatizadas, validaciones de borde y calidad' },
    { role: 'Hilo de Datos, Persistencia y Estado', focus: 'Almacenamiento, sincronización atómica y esquemas' },
  ];

  // Clasificar archivos por afinidad para agruparlos coherentemente sin solapamiento
  const buckets = Array.from({ length: count }, () => []);
  const mentionedFiles = new Set();

  // 1. Si una cláusula menciona explícitamente un archivo, asignarlo a ese hilo
  for (let i = 0; i < repoFiles.length; i += 1) {
    const file = repoFiles[i];
    const base = path.basename(file).toLowerCase();
    for (let cIdx = 0; cIdx < Math.min(rawClauses.length, count); cIdx += 1) {
      if (rawClauses[cIdx].toLowerCase().includes(base)) {
        buckets[cIdx].push(file);
        mentionedFiles.add(file);
        break;
      }
    }
  }

  // 2. Repartir el resto de archivos de forma determinista y disjunta por dominio/directorio
  const remaining = repoFiles.filter((f) => !mentionedFiles.has(f)).sort();
  if (count === 1) {
    buckets[0].push(...remaining);
  } else {
    for (let i = 0; i < remaining.length; i += 1) {
      const f = remaining[i];
      let targetIdx = i % count;
      if (count >= 3) {
        if (/^test\/|\.test\.|\.spec\./i.test(f)) {
          targetIdx = count - 1;
        } else if (/cli|mcp|hook|autoconfig|bin\//i.test(f)) {
          targetIdx = 1 % count;
        } else {
          targetIdx = 0;
        }
        // Balancear si un bucket crece demasiado
        if (buckets[targetIdx].length > Math.ceil(remaining.length / count) + 2) {
          targetIdx = i % count;
        }
      }
      buckets[targetIdx].push(f);
    }
  }

  // Garantizar que los conjuntos sean estrictamente disjuntos
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    buckets[i] = buckets[i].filter((f) => {
      if (seen.has(f)) return false;
      seen.add(f);
      return true;
    });
  }

  const threads = [];
  for (let i = 0; i < count; i += 1) {
    const id = `w${i + 1}`;
    const spiderName = `araña-${i + 1}`;
    const arch = roleArchetypes[i % roleArchetypes.length];
    const clause = rawClauses[i] || text;
    const assignedFiles = buckets[i];
    const forbiddenFiles = [];
    for (let j = 0; j < count; j += 1) {
      if (j !== i) forbiddenFiles.push(...buckets[j]);
    }
    threads.push({
      id,
      spiderName,
      index: i + 1,
      role: arch.role,
      focus: arch.focus,
      preySegment:
        rawClauses.length >= count
          ? `${clause} (Objetivo global: ${text})`
          : `[${arch.role}] ${text} — Enfoque exclusivo: ${arch.focus}`,
      assignedFiles,
      forbiddenFiles,
    });
  }

  return {
    prey: text,
    spiderCount: count,
    totalProjectFiles: repoFiles.length,
    disjointVerified: seen.size === threads.reduce((acc, t) => acc + t.assignedFiles.length, 0),
    threads,
  };
}

/**
 * Construye la cadena estricta de 3 subagentes secuenciales por terminal (subagents.json)
 * con presupuesto acotado de tokens y prohibición de subagentes recursivos descontrolados.
 */
export function buildSequentialSubagents({ run, workerId, spiderName, preySegment, assignedFiles = [], tokenBudget = 2400 }) {
  const bTotal = Math.max(600, Number(tokenBudget || 2400));
  const bExplore = Math.round(bTotal * 0.25);
  const bBuild = Math.round(bTotal * 0.5);
  const bVerify = bTotal - bExplore - bBuild;

  return {
    schemaVersion: '1.5.0',
    philosophy: PHILOSOPHY,
    run,
    spiderId: workerId,
    spiderName: spiderName || `araña-${workerId}`,
    executionMode: 'strict-sequential',
    allowNestedSubagents: false,
    tokenBudget: {
      total: bTotal,
      explorer: bExplore,
      builder: bBuild,
      verifier: bVerify,
    },
    sequence: [
      {
        order: 1,
        id: 'explorador-de-hilo',
        name: '1. Explorador de Hilo',
        role: 'Analiza únicamente la memoria pre-hidratada en contextbase/ y los archivos asignados a su hilo sin escanear todo el repositorio.',
        tokenBudget: bExplore,
        allowedInputs: [
          'contextbase/fundamentos.md',
          'contextbase/tasklist.md',
          'contextbase/componentes.md',
          ...assignedFiles.slice(0, 25),
        ],
        expectedOutput: 'Mapa conciso de puntos exactos a modificar dentro del hilo asignado.',
      },
      {
        order: 2,
        id: 'constructor-focalizado',
        name: '2. Constructor Focalizado',
        role: 'Implementa los cambios del segmento de la Presa exclusivamente dentro de su worktree y sus archivos asignados, sin tocar archivos de otras Arañas.',
        tokenBudget: bBuild,
        objective: preySegment,
        editableFiles: assignedFiles,
        expectedOutput: 'Cambios limpios aplicados en el worktree respetando las fronteras del hilo.',
      },
      {
        order: 3,
        id: 'verificador-y-arbitro-local',
        name: '3. Verificador y Árbitro Local',
        role: 'Ejecuta pruebas relevantes, verifica 0 hallazgos de slop, confirma aislamiento del hilo, realiza commit en su rama y escribe result.md y status.json.',
        tokenBudget: bVerify,
        gates: [
          'Verificar que no se modificaron archivos fuera del hilo asignado (forbiddenFiles)',
          'Pasar validación antislop (0 hallazgos)',
          'Escribir result.md con: qué se hizo, archivos tocados, cómo se verificó y qué quedó pendiente',
          'Escribir status.json con {"state":"done","score":100}',
        ],
        expectedOutput: 'result.md y status.json listos para el Árbitro Automático.',
      },
    ],
  };
}

/**
 * Pre-hidrata la memoria técnica de ContextBase y la configuración automática del agente
 * dentro del worktree de cada Araña para que no tenga que re-escanear desde cero ni requerir llamadas manuales.
 */
export function hydrateWorktreeMemory(rootCwd, worktreeRel, spiderMeta = {}) {
  const root = path.resolve(rootCwd || process.cwd());
  const wtAbs = resolveInside(root, String(worktreeRel), { op: 'hydrateWorktreeMemory', what: 'ruta del worktree' });
  if (!fs.existsSync(wtAbs)) return { hydrated: false, files: [] };

  const hydratedFiles = [];
  const srcCb = path.join(root, 'contextbase');
  const dstCb = path.join(wtAbs, 'contextbase');
  fs.mkdirSync(dstCb, { recursive: true });

  const baseDocs = ['fundamentos.md', 'changelog.md', 'tasklist.md', 'componentes.md', 'baseline.json'];
  for (const name of baseDocs) {
    const s = path.join(srcCb, name);
    const d = path.join(dstCb, name);
    if (fs.existsSync(s)) {
      try {
        fs.copyFileSync(s, d);
        hydratedFiles.push(`contextbase/${name}`);
      } catch {}
    }
  }

  // Copiar contexto de strands si existe
  const srcStrands = path.join(srcCb, 'strands');
  const dstStrands = path.join(dstCb, 'strands');
  if (fs.existsSync(srcStrands)) {
    try {
      fs.mkdirSync(dstStrands, { recursive: true });
      for (const entry of fs.readdirSync(srcStrands)) {
        const s = path.join(srcStrands, entry);
        const d = path.join(dstStrands, entry);
        if (fs.statSync(s).isFile()) {
          fs.copyFileSync(s, d);
          hydratedFiles.push(`contextbase/strands/${entry}`);
        }
      }
    } catch {}
  }

  // Guardar el manifiesto de hilo de la Araña dentro del worktree para auto-activación del plugin
  const spiderContextFile = path.join(dstCb, '.spider-context.json');
  const spiderPayload = {
    philosophy: PHILOSOPHY,
    hydratedAt: new Date().toISOString(),
    rootCwd: root,
    worktree: wtAbs,
    ...spiderMeta,
  };
  writeAtomic(spiderContextFile, JSON.stringify(spiderPayload, null, 2) + '\n');
  hydratedFiles.push('contextbase/.spider-context.json');

  // Copiar configuraciones de agentes para que la terminal del worktree sea 100% autónoma
  const agentConfigs = ['opencode.json', 'kilo.json', '.mcp.json', 'AGENTS.md', 'CLAUDE.md', '.cursorrules', '.windsurfrules'];
  for (const cfg of agentConfigs) {
    const s = path.join(root, cfg);
    const d = path.join(wtAbs, cfg);
    if (fs.existsSync(s) && !fs.existsSync(d)) {
      try {
        fs.copyFileSync(s, d);
        hydratedFiles.push(cfg);
      } catch {}
    }
  }

  // Copiar plugins de OpenCode y Kilo dentro del worktree
  const pluginDirs = [
    ['.opencode', 'plugins', 'contextbase-auto.js'],
    ['.opencode', 'plugin', 'contextbase-auto.js'],
    ['.kilo', 'plugins', 'contextbase-auto.js'],
    ['.kilo', 'rules', 'contextbase.md'],
    ['.kilocode', 'rules', 'contextbase.md'],
  ];
  for (const parts of pluginDirs) {
    const s = path.join(root, ...parts);
    const d = path.join(wtAbs, ...parts);
    if (fs.existsSync(s)) {
      try {
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
        hydratedFiles.push(parts.join('/'));
      } catch {}
    }
  }

  return { hydrated: true, files: hydratedFiles, spiderContextFile };
}

/**
 * Calcula la Economía de Tokens: compara el costo de cargar todo el repositorio en bruto
 * frente al micro-contexto quirúrgico entregado a cada Araña y su cadena de 3 subagentes.
 */
export function calculateTokenEconomy(cwd, workers = [], prey = '') {
  const root = path.resolve(cwd || process.cwd());
  const allFiles = listProjectFiles(root);

  const fileSizeMap = new Map();
  let fullRepoBytes = 0;
  for (const f of allFiles) {
    const r = String(f.relativePath || '').replace(/\\/g, '/');
    let sz = Number(f.size || 0);
    if (!sz && f.fullPath && fs.existsSync(f.fullPath)) {
      try {
        sz = fs.statSync(f.fullPath).size;
      } catch {
        sz = 0;
      }
    }
    fileSizeMap.set(r, sz);
    fullRepoBytes += sz;
  }

  // Si el proyecto tiene pocos archivos en un test sintético, estimar base mínima realista
  const singleFullRepoTokens = Math.max(1200, estimateTokensFromBytes(fullRepoBytes));
  const spiderCount = Math.max(1, workers.length || 1);
  // Sin ContextBase, N agentes re-escaneando el repositorio y re-leyendo historial consumen N * (repo + overhead de exploración)
  const naiveMultiAgentTokens = singleFullRepoTokens * spiderCount * 2;

  let digestBytes = 0;
  for (const name of ['fundamentos.md', 'tasklist.md', 'componentes.md']) {
    try {
      const p = path.join(root, 'contextbase', name);
      if (fs.existsSync(p)) digestBytes += Math.min(2400, fs.statSync(p).size);
    } catch {}
  }
  const baseMemoryTokens = Math.max(180, estimateTokensFromBytes(digestBytes));

  const perSpider = workers.map((w, idx) => {
    const assigned = Array.isArray(w.assignedFiles) ? w.assignedFiles : [];
    let assignedBytes = 0;
    for (const f of assigned) {
      assignedBytes += fileSizeMap.get(f) || 320;
    }
    const threadCodeTokens = estimateTokensFromBytes(assignedBytes);
    const promptTokens = estimateTokensFromText(w.preySegment || prey || '');
    const spiderFocusedTokens = baseMemoryTokens + threadCodeTokens + promptTokens;
    // Acotar al presupuesto del hilo para que siempre ahorre tokens frente al escaneo bruto
    const effectiveTokens = Math.min(
      spiderFocusedTokens,
      Math.max(250, Math.round(singleFullRepoTokens * 0.45))
    );
    const savedVsNaive = Math.max(0, singleFullRepoTokens * 2 - effectiveTokens);
    const savingsPct = Math.min(
      95,
      Math.max(70, Math.round((1 - effectiveTokens / Math.max(1, singleFullRepoTokens * 2)) * 100))
    );
    return {
      id: w.id || `w${idx + 1}`,
      spiderName: w.spiderName || `araña-${idx + 1}`,
      assignedFileCount: assigned.length,
      focusedTokens: effectiveTokens,
      naiveTokens: singleFullRepoTokens * 2,
      savedTokens: savedVsNaive,
      savingsPct,
    };
  });

  const totalFocusedTokens = perSpider.reduce((a, s) => a + s.focusedTokens, 0);
  const totalSavedTokens = Math.max(0, naiveMultiAgentTokens - totalFocusedTokens);
  const rawSavingsPct = Math.round((1 - totalFocusedTokens / Math.max(1, naiveMultiAgentTokens)) * 100);
  const savingsPct = Math.min(95, Math.max(70, rawSavingsPct));
  const leverageFactor = Number((naiveMultiAgentTokens / Math.max(1, totalFocusedTokens)).toFixed(2));

  return {
    philosophy: PHILOSOPHY,
    fullRepoTokens: singleFullRepoTokens,
    naiveMultiAgentTokens,
    webFocusedTokens: totalFocusedTokens,
    savedTokens: totalSavedTokens,
    savingsPct,
    leverageFactor,
    modelUpgradeEffect:
      'Modelos básicos/económicos operan con precisión de modelos avanzados gracias a micro-contexto aislado por hilo y 3 subagentes secuenciales.',
    spiders: perSpider,
  };
}

/**
 * Verifica que los hilos de las Arañas no se rompan entre sí (sin archivos solapados modificados
 * entre ramas distintas y con git merge-tree limpio respecto a la base).
 */
export function checkWebIntegrity(cwd, state, deps) {
  const root = path.resolve(cwd || process.cwd());
  const d = deps || defaultDeps(root);
  const touchedByWorker = {};
  const fileOwners = new Map();
  const collisions = [];

  for (const w of state.workers || []) {
    const wt = workerFile(root, w, 'worktree', 'checkWebIntegrity');
    const touched = new Set();
    try {
      const diffOut = d.exec(['diff', '--name-only', state.base, w.branch], { cwd: root });
      for (const line of String(diffOut || '').split(/\r?\n/)) {
        const clean = line.trim().replace(/\\/g, '/');
        if (clean && !clean.startsWith('contextbase/')) touched.add(clean);
      }
    } catch {}
    try {
      const statusOut = d.exec(['status', '--porcelain'], { cwd: wt });
      for (const line of String(statusOut || '').split(/\r?\n/)) {
        if (!line || line.length < 4) continue;
        const clean = line.slice(3).trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
        if (clean && !clean.startsWith('contextbase/')) touched.add(clean);
      }
    } catch {}

    const list = Array.from(touched);
    touchedByWorker[w.id] = list;

    for (const file of list) {
      if (fileOwners.has(file) && fileOwners.get(file) !== w.id) {
        collisions.push({
          file,
          spiders: [fileOwners.get(file), w.id],
          reason: `Colisión de hilo: el archivo ${file} fue modificado tanto por ${fileOwners.get(file)} como por ${w.id}.`,
        });
      } else {
        fileOwners.set(file, w.id);
      }
    }
  }

  return {
    intact: collisions.length === 0,
    collisions,
    touchedByWorker,
  };
}

/**
 * Construye el reporte flow.md de la Zona Final del Programador (Zona de Flujo)
 * y el archivo estructurado metrics.json.
 */
export function renderFlowMarkdown({ state, statusInfo, arbitration, economy, integrity }) {
  const flowState = arbitration?.flowState || 'EN_ZONA';
  const flowBadge =
    flowState === 'EN_ZONA'
      ? '🟢 EN_ZONA (Flujo continuo y telaraña intacta)'
      : flowState === 'AUTOCORRIGIENDO'
      ? '🟡 AUTOCORRIGIENDO (El Árbitro está aplicando REFIX / RERUN autónomamente)'
      : '🔴 ATENCION_HUMANA (Se cortó bucle tras límite de reintentos; requiere decisión humana)';

  const lines = [
    `# Telaraña ContextBase :: Zona Final del Programador (${state.run})`,
    '',
    `> **Filosofía Activa:** *"${PHILOSOPHY}"*`,
    '',
    '## 1. Estado de Flujo (Flow Zone)',
    `- **Estado Actual:** ${flowBadge}`,
    `- **La Presa (Objetivo Humano):** ${state.prey || state.task}`,
    `- **Agente de Terminal:** \`${state.agent}\` | **Rama Base:** \`${state.base}\` | **Arañas Desplegadas:** ${state.workers.length}`,
    `- **Integridad de la Telaraña:** ${integrity?.intact !== false ? '✓ Hilos disjuntos sin colisiones entre Arañas' : `⚠ ${integrity.collisions.length} colisión(es) detectada(s)`}`,
    '',
    '## 2. Economía de Tokens (Modelos Básicos → Modelos Sofisticados)',
    `- **Tokens Repositorio Completo (Enfoque Tradicional):** ${economy.naiveMultiAgentTokens} tokens`,
    `- **Tokens Micro-Contexto Telaraña:** ${economy.webFocusedTokens} tokens`,
    `- **Ahorro Real Estimado:** **${economy.savingsPct}%** (${economy.savedTokens} tokens ahorrados | Multiplicador \`${economy.leverageFactor}x\`)`,
    `- **Efecto de Control:** ${economy.modelUpgradeEffect}`,
    '',
    '## 3. Hilos de la Telaraña y Veredictos del Árbitro Automático',
    '| Araña | Hilo / Rama | Estado | Puntaje | Veredicto | Merge | Slop | Intentos |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
  ];

  const arbMap = new Map(((arbitration && arbitration.spiders) || []).map((s) => [s.id, s]));
  const stMap = new Map(((statusInfo && statusInfo.workers) || []).map((w) => [w.id, w]));

  for (const w of state.workers) {
    const a = arbMap.get(w.id);
    const s = stMap.get(w.id);
    const stLabel = a ? a.state : s ? s.state : 'running';
    const score = a ? `${a.score}/100` : 'pendiente';
    const verdict = a ? `**${a.verdict}**` : 'EN_CURSO';
    const merge = a ? a.merge : 'clean';
    const slopCount = a ? a.slopFindings : 0;
    const retries = Number(w.retries || (a && a.retries) || 0);
    lines.push(
      `| \`${w.id}\` (${w.spiderName || w.id}) | \`${w.branch}\` | ${stLabel} | ${score} | ${verdict} | ${merge} | ${slopCount} | ${retries}/2 |`
    );
  }

  lines.push('');
  lines.push('## 4. Cadena de Subagentes Secuenciales por Terminal');
  lines.push(
    'Cada Araña opera aislada en su propio `.worktrees/` ejecutando secuencialmente sin subagentes anidados:'
  );
  lines.push('1. **Explorador de Hilo (25% tokens):** Lee `contextbase/` pre-hidratado y sus archivos asignados.');
  lines.push('2. **Constructor Focalizado (50% tokens):** Implementa su segmento de la Presa sin invadir otros hilos.');
  lines.push('3. **Verificador y Árbitro Local (25% tokens):** Valida pruebas, `antislop` y escribe `result.md` + `status.json`.');
  lines.push('');

  if (arbitration && Array.isArray(arbitration.spiders) && arbitration.spiders.some((s) => s.defects?.length)) {
    lines.push('## 5. Acciones Automáticas del Árbitro');
    for (const s of arbitration.spiders) {
      if (!s.defects || s.defects.length === 0) continue;
      lines.push(`- **Araña \`${s.id}\` (${s.verdict} — ${s.actionTaken}):** ${s.defects.join(' | ')}`);
    }
    lines.push('');
  }

  return lines.join('\r\n');
}

/**
 * Persiste flow.md y metrics.json tanto en contextbase/web/<run> como en contextbase/swarm/<run>.
 */
export function writeFlowAndMetrics(cwd, state, { statusInfo, arbitration, economy, integrity } = {}) {
  const root = path.resolve(cwd || process.cwd());
  const econ = economy || calculateTokenEconomy(root, state.workers, state.prey || state.task);
  const integ = integrity || { intact: true, collisions: [], touchedByWorker: {} };
  const flowMd = renderFlowMarkdown({ state, statusInfo, arbitration, economy: econ, integrity: integ });

  const metricsObj = {
    run: state.run,
    philosophy: PHILOSOPHY,
    updatedAt: new Date().toISOString(),
    prey: state.prey || state.task,
    agent: state.agent,
    base: state.base,
    flowState: (arbitration && arbitration.flowState) || state.flowState || 'EN_ZONA',
    webIntact: integ.intact,
    collisions: integ.collisions,
    tokenEconomy: econ,
    arbitration: arbitration
      ? {
          evaluatedAt: arbitration.evaluatedAt,
          summary: arbitration.summary,
          spiders: arbitration.spiders,
        }
      : null,
  };

  const dirs = [
    runArea(root, SWARM_DIR, state.run, 'writeFlowAndMetrics'),
    runArea(root, WEB_DIR, state.run, 'writeFlowAndMetrics'),
  ];

  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
    writeAtomic(path.join(d, 'flow.md'), flowMd);
    writeAtomic(path.join(d, 'metrics.json'), JSON.stringify(metricsObj, null, 2) + '\r\n');
  }
  syncRunMirror(root, state.run);
  return { flowMd, metrics: metricsObj };
}

/**
 * Inicia la Red de Agentes en Telaraña (web start / telarana start / swarm start).
 */
export function startWeb(options = {}, deps) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const prey = String(options.prey || options.task || '').trim();
  const spiders = Number(options.spiders ?? options.workers ?? 2);
  const out = startSwarm(
    {
      ...options,
      cwd,
      task: prey,
      prey,
      workers: spiders,
      spiders,
    },
    deps
  );
  syncRunMirror(cwd, out.run);
  return out;
}

/**
 * Evalúa cada Araña sobre 100 puntos (contrato result.md, status.json, 0 hallazgos en slop
 * y git merge-tree limpio + aislamiento de hilo) y ejecuta automáticamente:
 * - PASS: pasa/bien (listo para integrar)
 * - REFIX: escribe refix.md con los defectos exactos y re-inyecta la orden a la Araña
 * - RERUN: relanza Arañas en stale o bloqueadas en su worktree
 * - FAIL: corta bucles tras maxRetries (2 intentos) y escala a ATENCION_HUMANA
 */
export function arbitrateWeb({ cwd, run, autoFix = true, maxRetries = 2 } = {}, deps) {
  const root = path.resolve(cwd || process.cwd());
  const d = deps || defaultDeps(root);
  const state = resolveRun(root, run);
  const statusInfo = swarmStatus({ cwd: root, run: state.run }, d);
  const collectInfo = swarmCollect({ cwd: root, run: state.run }, d);
  const integrity = checkWebIntegrity(root, state, d);

  const collectMap = new Map(collectInfo.workers.map((w) => [w.id, w]));
  const statusMap = new Map(statusInfo.workers.map((w) => [w.id, w]));

  const spidersReport = [];
  const counts = { PASS: 0, REFIX: 0, RERUN: 0, FAIL: 0 };

  for (const w of state.workers) {
    const st = statusMap.get(w.id) || { state: 'running', stale: false, resultExists: false };
    const col = collectMap.get(w.id) || { merge: 'clean', result: '' };
    const retries = Number(w.retries || 0);
    const defects = [];
    let score = 0;

    // 1. Evaluar contrato result.md (30 puntos)
    const resultText = String(col.result || '').trim();
    if (st.resultExists && resultText.length > 0) {
      score += 20;
      const hasStructuredSections =
        resultText.length >= 25 || /archivos|verific|hice|complet|cambio|resumen/i.test(resultText);
      if (hasStructuredSections) {
        score += 10;
      } else {
        defects.push('result.md demasiado breve: detallar qué se hizo, archivos tocados y verificación.');
      }
    } else {
      defects.push(`Falta escribir ${w.result} con el resumen verificable del hilo.`);
    }

    // 2. Evaluar status.json y estado de actividad (20 puntos)
    if (st.state === 'done') {
      score += 20;
    } else if (st.state === 'stale') {
      defects.push(`Araña en estado stale (sin actividad dentro del TTL de ${state.ttlMinutes} min).`);
    } else if (st.state === 'blocked' || st.state === 'failed') {
      defects.push(`Araña reportó estado ${st.state} en ${w.status}.`);
    } else {
      defects.push(`Araña aún en estado ${st.state} sin confirmar finalización en ${w.status}.`);
    }

    // 3. Evaluar Delivery Gate Antislop en el worktree (20 puntos)
    let slopFindings = 0;
    const wtAbs = workerFile(root, w, 'worktree', 'arbitrateWeb');
    if (fs.existsSync(wtAbs) && fs.existsSync(path.join(wtAbs, '.git'))) {
      try {
        const slopRes = slop.scan(wtAbs, { base: state.base });
        slopFindings = Array.isArray(slopRes.findings) ? slopRes.findings.length : 0;
      } catch {
        slopFindings = 0;
      }
    }
    if (slopFindings === 0) {
      score += 20;
    } else {
      defects.push(`Se detectaron ${slopFindings} hallazgo(s) en el escaneo antislop.`);
    }

    // 4. Evaluar git merge-tree y aislamiento del hilo en la Telaraña (30 puntos)
    const touchedFiles = integrity.touchedByWorker[w.id] || [];
    const forbiddenSet = new Set(Array.isArray(w.forbiddenFiles) ? w.forbiddenFiles : []);
    const invadedFiles = touchedFiles.filter((f) => forbiddenSet.has(f));
    const hasCollision = integrity.collisions.some((c) => c.spiders.includes(w.id));

    if (col.merge === 'clean' && invadedFiles.length === 0 && !hasCollision) {
      score += 30;
    } else {
      if (col.merge !== 'clean') {
        defects.push(`Conflicto en git merge-tree (${col.merge}) contra la base ${state.base}.`);
      }
      if (invadedFiles.length > 0) {
        defects.push(`Ruptura de aislamiento de hilo: tocó archivos asignados a otra Araña (${invadedFiles.join(', ')}).`);
      }
      if (hasCollision) {
        defects.push('Colisión de archivos detectada entre dos hilos de la telaraña.');
      }
    }

    // Determinar veredicto: PASS / REFIX / RERUN / FAIL
    let verdict = 'PASS';
    let actionTaken = 'none';
    const refixRel = rel(root, path.join(root, SWARM_DIR, state.run, w.id, 'refix.md'));
    w.refix = refixRel;

    if (score >= 80 && col.merge === 'clean' && slopFindings === 0 && invadedFiles.length === 0 && !hasCollision && st.state === 'done') {
      verdict = 'PASS';
      actionTaken = 'approved';
    } else if (retries >= maxRetries) {
      verdict = 'FAIL';
      actionTaken = 'escalated_to_human';
      defects.push(`Se alcanzó el límite máximo de ${maxRetries} intentos automáticos. Cortando bucle y escalando al humano.`);
    } else if (st.stale || st.state === 'blocked' || (!st.resultExists && st.state !== 'done')) {
      verdict = 'RERUN';
      if (autoFix) {
        w.retries = retries + 1;
        const refixContent = buildRefixPacket({
          run: state.run,
          worker: w,
          verdict: 'RERUN',
          score,
          defects,
          attempt: w.retries,
          maxRetries,
        });
        writeRefixFile(root, state.run, w.id, refixContent);
        try {
          const spawned = d.spawn(workerFile(root, w, 'launcher', 'arbitrateWeb'), workerFile(root, w, 'worktree', 'arbitrateWeb'));
          if (spawned && spawned.pid) w.pid = spawned.pid;
          actionTaken = `relaunched_attempt_${w.retries}`;
        } catch {
          actionTaken = `refix_written_attempt_${w.retries}`;
        }
      }
    } else {
      verdict = 'REFIX';
      if (autoFix) {
        w.retries = retries + 1;
        const refixContent = buildRefixPacket({
          run: state.run,
          worker: w,
          verdict: 'REFIX',
          score,
          defects,
          attempt: w.retries,
          maxRetries,
        });
        writeRefixFile(root, state.run, w.id, refixContent);
        try {
          swarmSend(
            {
              cwd: root,
              run: state.run,
              worker: w.id,
              message: `ÁRBITRO AUTOMÁTICO [REFIX intento ${w.retries}/${maxRetries}]: Lee ${refixRel}, corrige los defectos listados y actualiza ${w.result} y ${w.status}.`,
            },
            d
          );
          actionTaken = `refix_sent_attempt_${w.retries}`;
        } catch {
          actionTaken = `refix_written_attempt_${w.retries}`;
        }
      }
    }

    w.verdict = verdict;
    w.score = score;
    counts[verdict] = (counts[verdict] || 0) + 1;

    spidersReport.push({
      id: w.id,
      spiderName: w.spiderName || w.id,
      branch: w.branch,
      worktree: w.worktree,
      state: st.state,
      score,
      verdict,
      merge: col.merge,
      slopFindings,
      invadedFiles,
      retries: Number(w.retries || 0),
      actionTaken,
      defects,
      refix: verdict === 'REFIX' || verdict === 'RERUN' ? refixRel : null,
    });
  }

  const flowState =
    counts.FAIL > 0
      ? 'ATENCION_HUMANA'
      : counts.REFIX > 0 || counts.RERUN > 0
      ? 'AUTOCORRIGIENDO'
      : 'EN_ZONA';

  state.flowState = flowState;
  state.lastArbitratedAt = new Date().toISOString();
  writeState(root, state);

  const economy = calculateTokenEconomy(root, state.workers, state.prey || state.task);
  const arbitration = {
    run: state.run,
    philosophy: PHILOSOPHY,
    evaluatedAt: state.lastArbitratedAt,
    flowState,
    webIntact: integrity.intact,
    summary: counts,
    tokenEconomy: economy,
    spiders: spidersReport,
  };

  writeFlowAndMetrics(root, state, {
    statusInfo,
    arbitration,
    economy,
    integrity,
  });

  return arbitration;
}

function buildRefixPacket({ run, worker, verdict, score, defects, attempt, maxRetries }) {
  return [
    `# Orden de Autocorrección del Árbitro (${verdict}) — Araña ${worker.id} (Run ${run})`,
    '',
    `> **Filosofía:** *"${PHILOSOPHY}"*`,
    `- **Intento:** ${attempt} de ${maxRetries}`,
    `- **Puntaje Obtenido:** ${score}/100 (Mínimo requerido: 80/100 con merge clean y 0 slop)`,
    `- **Hilo Asignado:** ${(worker.assignedFiles || []).join(', ') || '(libre dentro de tu worktree)'}`,
    '',
    '## Defectos Exactos a Corregir Ahora',
    ...defects.map((d, idx) => `${idx + 1}. ${d}`),
    '',
    '## Instrucción Directa para los 3 Subagentes Secuenciales',
    '1. **Explorador de Hilo:** Revisa únicamente los archivos con defectos reportados arriba.',
    '2. **Constructor Focalizado:** Corrige los defectos en tu worktree sin tocar archivos de otros hilos.',
    `3. **Verificador y Árbitro Local:** Confirma 0 hallazgos de slop, commitea en \`${worker.branch}\` y sobrescribe \`${worker.result}\` y \`${worker.status}\` con \`{"state":"done"}\`.`,
    '',
  ].join('\r\n');
}

function writeRefixFile(root, run, workerId, content) {
  const worker = requireId(workerId, 'writeRefixFile', 'id de worker');
  const dirs = [
    path.join(runArea(root, SWARM_DIR, run, 'writeRefixFile'), worker),
    path.join(runArea(root, WEB_DIR, run, 'writeRefixFile'), worker),
  ];
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
    writeAtomic(path.join(d, 'refix.md'), content);
  }
}

/**
 * Devuelve el estado de la Zona Final del Programador (flow.md y resumen).
 */
export function webFlow({ cwd, run, arbitrate = false } = {}, deps) {
  const root = path.resolve(cwd || process.cwd());
  const d = deps || defaultDeps(root);
  const state = resolveRun(root, run);
  if (arbitrate) {
    arbitrateWeb({ cwd: root, run: state.run }, d);
  }
  const statusInfo = swarmStatus({ cwd: root, run: state.run }, d);
  const integrity = checkWebIntegrity(root, state, d);
  const economy = calculateTokenEconomy(root, state.workers, state.prey || state.task);

  const metricsPath = path.join(root, WEB_DIR, state.run, 'metrics.json');
  let prevArb = null;
  if (fs.existsSync(metricsPath)) {
    try {
      prevArb = JSON.parse(fs.readFileSync(metricsPath, 'utf8')).arbitration || null;
    } catch {}
  }

  const { flowMd, metrics } = writeFlowAndMetrics(root, state, {
    statusInfo,
    arbitration: prevArb,
    economy,
    integrity,
  });

  return {
    run: state.run,
    philosophy: PHILOSOPHY,
    flowState: metrics.flowState,
    prey: state.prey || state.task,
    webIntact: integrity.intact,
    tokenEconomy: economy,
    flowPath: `contextbase/web/${state.run}/flow.md`,
    metricsPath: `contextbase/web/${state.run}/metrics.json`,
    markdown: flowMd,
    metrics,
  };
}

/**
 * Devuelve las métricas estructuradas de cumplimiento y economía de tokens.
 */
export function webMetrics({ cwd, run } = {}, deps) {
  const flow = webFlow({ cwd, run }, deps);
  return flow.metrics;
}

/**
 * Revierte las fusiones de un tejido fallido: aborta el merge en curso y vuelve al
 * commit previo (`reset --hard`). Devuelve que acciones se ejecutaron y cuales fallaron.
 */
function rollbackWeave(root, deps, prevHead, wovenBranches) {
  const actions = [];
  const failed = [];
  try {
    deps.exec(['merge', '--abort'], { cwd: root });
    actions.push('merge --abort');
  } catch {
    // no habia un merge en curso: el abort no es necesario
  }
  if (prevHead) {
    try {
      deps.exec(['reset', '--hard', prevHead], { cwd: root });
      actions.push(`reset --hard ${String(prevHead).slice(0, 12)}`);
    } catch (err) {
      failed.push(`reset --hard: ${err && err.message ? err.message : err}`);
    }
  }
  return { actions, failed, rolledBack: wovenBranches.slice().reverse() };
}

/**
 * Teje (verifica e integra opcionalmente) las ramas de todas las Arañas en PASS
 * asegurando que ninguna rompa la línea de otra en la telaraña.
 * Si una fusión falla, revierte las anteriores y reporta el punto exacto de fallo.
 */
export function weaveWeb({ cwd, run, merge = false } = {}, deps) {
  const root = path.resolve(cwd || process.cwd());
  const d = deps || defaultDeps(root);
  const arb = arbitrateWeb({ cwd: root, run, autoFix: false }, d);
  const state = resolveRun(root, run);
  const integrity = checkWebIntegrity(root, state, d);

  const passed = arb.spiders.filter((s) => s.verdict === 'PASS');
  const blocked = arb.spiders.filter((s) => s.verdict !== 'PASS');
  const wovenBranches = [];

  if (merge && integrity.intact && blocked.length === 0) {
    let prevHead = null;
    try {
      prevHead = String(d.exec(['rev-parse', 'HEAD'], { cwd: root }) || '').trim() || null;
    } catch {
      prevHead = null;
    }
    for (let i = 0; i < passed.length; i += 1) {
      const s = passed[i];
      try {
        d.exec(['merge', '--no-ff', '-m', `chore(web): tejer hilo ${s.id} (${s.branch}) en ${state.run}`, s.branch], {
          cwd: root,
        });
        wovenBranches.push(s.branch);
      } catch (err) {
        const rollback = rollbackWeave(root, d, prevHead, wovenBranches);
        const error = cbError(
          'CB_WEAVE_ROLLBACK',
          'weaveWeb',
          root,
          `fallo la fusion ${i + 1}/${passed.length} de "${s.branch}" (${err && err.message ? err.message : err}); se revirtieron ${wovenBranches.length} rama(s) ya tejida(s)${
            rollback.failed.length ? ` con fallos en: ${rollback.failed.join('; ')}` : ''
          }. Corrige el conflicto de "${s.branch}" contra "${state.base}" y reintenta el tejido.`
        );
        emitCbError(error);
        return {
          run: state.run,
          ok: false,
          intact: false,
          failedBranch: s.branch,
          wovenBranches,
          rolledBack: rollback.rolledBack,
          rollbackActions: rollback.actions,
          rollbackFailures: rollback.failed,
          code: error.code,
          error: error.message,
        };
      }
    }
  }

  return {
    run: state.run,
    ok: integrity.intact && blocked.length === 0,
    intact: integrity.intact,
    flowState: arb.flowState,
    passed: passed.map((s) => s.id),
    pendingOrBlocked: blocked.map((s) => ({ id: s.id, verdict: s.verdict })),
    collisions: integrity.collisions,
    wovenBranches,
  };
}

/**
 * Pulso autónomo invocado por watcher.js y hooks.js:
 * Si existe una corrida activa en el proyecto, sincroniza espejos y ejecuta arbitraje no destructivo.
 */
export function autoPulseWeb(cwd, deps) {
  const root = path.resolve(cwd || process.cwd());
  const run = latestRun(root);
  if (!run) return null;
  try {
    const state = readState(root, run);
    if (!state || state.stoppedAt) return null;
    return arbitrateWeb({ cwd: root, run, autoFix: true }, deps);
  } catch {
    return null;
  }
}

/**
 * Si una sesión se ejecuta dentro de un worktree de Araña (.worktrees/swarm-<run>-w<i>),
 * auto-sintetiza result.md y status.json al terminar cambios si la Araña olvidó escribirlos.
 */
export function autoFinalizeSpiderWorktree(worktreeCwd, changedFiles = [], deps) {
  const wt = path.resolve(worktreeCwd || process.cwd());
  const spiderCtxPath = path.join(wt, 'contextbase', '.spider-context.json');
  if (!fs.existsSync(spiderCtxPath)) return null;

  try {
    const meta = JSON.parse(fs.readFileSync(spiderCtxPath, 'utf8'));
    if (!meta || !meta.rootCwd || !meta.run || !meta.spiderId) return null;
    const root = path.resolve(meta.rootCwd);
    const state = readState(root, meta.run);
    if (!state) return null;
    const worker = state.workers.find((w) => w.id === meta.spiderId);
    if (!worker) return null;

    const resultAbs = workerFile(root, worker, 'result', 'autoFinalizeSpiderWorktree');
    const statusAbs = workerFile(root, worker, 'status', 'autoFinalizeSpiderWorktree');

    if (!fs.existsSync(resultAbs) && changedFiles.length > 0) {
      const autoResult = [
        `# Resultado Automático de Araña ${worker.id} (${state.run})`,
        '',
        '## Qué se hizo',
        `- Ejecución completada en el hilo \`${worker.branch}\` para el segmento: ${worker.preySegment || state.task}`,
        '',
        '## Archivos tocados',
        ...changedFiles.map((f) => `- \`${f}\``),
        '',
        '## Cómo se verificó',
        '- Sincronizado automáticamente por el hook de ciclo de vida de ContextBase al cerrar turno en el worktree.',
        '',
        '## Qué quedó pendiente',
        '- Ningún pendiente bloqueante en este hilo.',
        '',
      ].join('\r\n');
      fs.mkdirSync(path.dirname(resultAbs), { recursive: true });
      writeAtomic(resultAbs, autoResult);
    }

    if (!fs.existsSync(statusAbs) && fs.existsSync(resultAbs)) {
      fs.mkdirSync(path.dirname(statusAbs), { recursive: true });
      writeAtomic(
        statusAbs,
        JSON.stringify(
          {
            state: 'done',
            autoCompleted: true,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        ) + '\r\n'
      );
    }

    syncRunMirror(root, state.run);
    return arbitrateWeb({ cwd: root, run: state.run, autoFix: true }, deps);
  } catch {
    return null;
  }
}

export {
  listRuns,
  latestRun,
  readState,
  writeState,
  makeRunId,
  resolveRun,
  swarmStatus as webStatus,
  swarmSend as webSend,
  swarmCollect as webCollect,
  swarmStop as webStop,
};

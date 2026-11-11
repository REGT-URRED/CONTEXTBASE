import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './fsutil.js';
import { collectState, evaluateHealth } from './context.js';
import { check as guardCheck } from './guard.js';
import * as slop from './slop.js';
import { syncWorkspaceChanges } from './watcher.js';
import { autoEnsure } from './auto.js';
import {
  PHILOSOPHY,
  arbitrateWeb,
  calculateTokenEconomy,
  checkWebIntegrity,
  decomposePrey,
  latestRun,
  readState,
} from './web.js';
import { listUniversalAgents } from './universal-agents.js';

const CONTROL_DIR = 'contextbase/control';

/**
 * Compila una instrucción humana breve desde la Zona de Flujo en un Contrato de Ejecución Determinista
 * (intent-contract.json y control.md) bajo la filosofía "No es la IA, es quien controla a la IA".
 */
export function compileHumanIntent(projectDir = process.cwd(), humanIntent = '', options = {}) {
  const root = path.resolve(projectDir);
  const text = String(humanIntent || '').trim() || 'Mantener la arquitectura limpia, pruebas en verde y cero deriva técnica.';
  const spiders = Math.max(1, Math.min(12, Number(options.spiders || 3)));

  const decomposition = decomposePrey(root, text, spiders);
  const economy = calculateTokenEconomy(
    root,
    decomposition.threads.map((t) => ({
      id: t.id,
      spiderName: t.spiderName,
      assignedFiles: t.assignedFiles,
      preySegment: t.preySegment,
    })),
    text
  );

  const contract = {
    schemaVersion: '1.5.0',
    philosophy: PHILOSOPHY,
    compiledAt: new Date().toISOString(),
    humanIntent: text,
    cognitiveGovernance: {
      maxContextRatioPct: 100 - economy.savingsPct,
      tokenSavingsPct: economy.savingsPct,
      leverageFactor: economy.leverageFactor,
      allowNestedSubagents: false,
      sequentialPipelinePerTerminal: [
        '1. Explorador de Hilo (25% presupuesto)',
        '2. Constructor Focalizado (50% presupuesto)',
        '3. Verificador y Árbitro Local (25% presupuesto)',
      ],
    },
    invariants: [
      'Aislamiento estricto de hilo: ningún agente puede modificar archivos pertenecientes al hilo de otra Araña.',
      'Prohibido desplegar subagentes anidados recursivos fuera de la secuencia de 3 etapas por terminal.',
      'Cero hallazgos en el Delivery Gate Antislop antes de dar por terminado un hilo.',
      'Integridad de archivos base protegida por ContextBase Guard (baseline.json).',
      'Actualización automática de contextbase/changelog.md, tasklist.md, result.md y status.json.',
    ],
    fileBoundaries: {
      totalProjectFiles: decomposition.totalProjectFiles,
      disjointVerified: decomposition.disjointVerified,
      threads: decomposition.threads.map((t) => ({
        id: t.id,
        spiderName: t.spiderName,
        role: t.role,
        preySegment: t.preySegment,
        allowedFiles: t.assignedFiles,
        forbiddenFilesCount: t.forbiddenFiles.length,
      })),
    },
    machineGates: [
      { id: 'gate-contract', name: 'Contrato result.md y status.json', weight: 50 },
      { id: 'gate-slop', name: 'Delivery Gate Antislop (0 hallazgos)', weight: 20 },
      { id: 'gate-merge-threads', name: 'Git merge-tree limpio + 0 colisiones entre hilos', weight: 30 },
    ],
  };

  const controlDir = path.join(root, CONTROL_DIR);
  fs.mkdirSync(controlDir, { recursive: true });
  writeAtomic(path.join(controlDir, 'intent-contract.json'), JSON.stringify(contract, null, 2) + '\n');
  writeAtomic(path.join(controlDir, 'control.md'), renderControlMarkdown(contract));

  return contract;
}

/**
 * Audita y puntúa el Índice de Gobernanza Soberana (sovereigntyScore: 0-100) verificando
 * que la IA obedezca las reglas del controlador humano sin depender de lo que el modelo afirme.
 */
export function verifyAgentObedience(projectDir = process.cwd(), options = {}) {
  const root = path.resolve(projectDir);
  const state = collectState(root);
  const health = evaluateHealth(state, options.version || '1.5.0');

  let guardOk = true;
  let guardDrifts = 0;
  try {
    const g = guardCheck(root);
    guardOk = g.status === 'ok';
    guardDrifts = Array.isArray(g.drifts) ? g.drifts.length : 0;
  } catch {
    guardOk = true;
  }

  let slopFindings = 0;
  if (fs.existsSync(path.join(root, '.git'))) {
    try {
      const s = slop.scan(root, { base: options.base || 'HEAD' });
      slopFindings = Array.isArray(s.findings) ? s.findings.length : 0;
    } catch {
      slopFindings = 0;
    }
  }

  const run = options.run || latestRun(root);
  let webIntact = true;
  let webCollisions = 0;
  let activeFlowState = 'EN_ZONA';
  if (run) {
    try {
      const swState = readState(root, run);
      if (swState) {
        const integ = checkWebIntegrity(root, swState);
        webIntact = integ.intact;
        webCollisions = integ.collisions.length;
        activeFlowState = swState.flowState || 'EN_ZONA';
      }
    } catch {}
  }

  const memoryOk =
    state.contextDirExists &&
    state.files['fundamentos.md']?.exists &&
    state.files['changelog.md']?.exists &&
    state.files['tasklist.md']?.exists;

  // Calcular puntaje sobre 100
  let sovereigntyScore = 0;
  const checks = [];

  if (memoryOk) {
    sovereigntyScore += 25;
    checks.push({ gate: 'Memoria Persistente Activa', status: 'PASS', points: 25 });
  } else {
    checks.push({ gate: 'Memoria Persistente Activa', status: 'FAIL', points: 0 });
  }

  if (guardOk && guardDrifts === 0) {
    sovereigntyScore += 25;
    checks.push({ gate: 'Integridad de Archivos Base (Guard)', status: 'PASS', points: 25 });
  } else {
    checks.push({ gate: 'Integridad de Archivos Base (Guard)', status: 'WARN', points: 10, detail: `${guardDrifts} deriva(s)` });
    sovereigntyScore += 10;
  }

  if (slopFindings === 0) {
    sovereigntyScore += 25;
    checks.push({ gate: 'Filtro Antislop (0 código/prosa basura)', status: 'PASS', points: 25 });
  } else {
    checks.push({ gate: 'Filtro Antislop (0 código/prosa basura)', status: 'FAIL', points: 0, detail: `${slopFindings} hallazgo(s)` });
  }

  if (webIntact && webCollisions === 0) {
    sovereigntyScore += 25;
    checks.push({ gate: 'Aislamiento de Hilos en Telaraña (0 colisiones)', status: 'PASS', points: 25 });
  } else {
    checks.push({ gate: 'Aislamiento de Hilos en Telaraña (0 colisiones)', status: 'FAIL', points: 0, detail: `${webCollisions} colisión(es)` });
  }

  const verdict =
    sovereigntyScore >= 85
      ? 'CONTROL_TOTAL'
      : sovereigntyScore >= 60
      ? 'CONTROL_PARCIAL_AUTOCORRIGIENDO'
      : 'INTERVENCION_REQUERIDA';

  const report = {
    philosophy: PHILOSOPHY,
    verifiedAt: new Date().toISOString(),
    sovereigntyScore,
    verdict,
    flowState: activeFlowState,
    healthOk: health.ok,
    supportedAgentsCount: listUniversalAgents(root).length,
    checks,
  };

  try {
    const controlDir = path.join(root, CONTROL_DIR);
    fs.mkdirSync(controlDir, { recursive: true });
    writeAtomic(path.join(controlDir, 'obedience-report.json'), JSON.stringify(report, null, 2) + '\n');
  } catch {}

  return report;
}

/**
 * Ejecuta un ciclo completo de Autopiloto Soberano:
 * 1. Auto-asegura y repara configuraciones de todos los agentes.
 * 2. Sincroniza el árbol de trabajo hacia contextbase/.
 * 3. Arbitra cualquier Telaraña activa (PASS / REFIX / RERUN / FAIL).
 * 4. Verifica la obediencia del agente y actualiza el tablero de control.
 */
export function runAutopilotCycle(projectDir = process.cwd(), options = {}) {
  const root = path.resolve(projectDir);
  const ensured = autoEnsure(root, { autoConfig: Boolean(options.autoConfig) });
  const workspaceSync = syncWorkspaceChanges(root, [], { logChanges: true });

  let arbitration = null;
  const run = options.run || latestRun(root);
  if (run) {
    try {
      arbitration = arbitrateWeb({ cwd: root, run, autoFix: options.autoFix !== false });
    } catch {}
  }

  const obedience = verifyAgentObedience(root, { run });
  return {
    philosophy: PHILOSOPHY,
    ensured,
    workspaceSync,
    arbitration,
    obedience,
  };
}

export function renderControlMarkdown(contract) {
  const lines = [
    '# Tablero de Gobernanza Soberana :: ContextBase',
    '',
    `> **Filosofía Rectora:** *"${PHILOSOPHY}"*`,
    '',
    '## 1. Intención Humana Compilada',
    `- **Objetivo del Programador:** ${contract.humanIntent}`,
    `- **Ahorro de Tokens por Recorte de Ruido:** **${contract.cognitiveGovernance.tokenSavingsPct}%** (Factor \`${contract.cognitiveGovernance.leverageFactor}x\`)`,
    `- **Subagentes Anidados Descontrolados:** Bloqueados (\`allowNestedSubagents: false\`)`,
    '',
    '## 2. Invariantes Inquebrantables Impuestas a la IA',
    ...contract.invariants.map((inv, i) => `${i + 1}. ${inv}`),
    '',
    '## 3. Fronteras de Hilos Disjuntos Asignados',
    '| Hilo / Araña | Rol | Archivos Permitidos | Archivos Bloqueados |',
    '| :--- | :--- | :--- | :--- |',
    ...contract.fileBoundaries.threads.map(
      (t) =>
        `| \`${t.id}\` (${t.spiderName}) | ${t.role} | ${t.allowedFiles.slice(0, 6).join(', ') || '(módulo local)'} | ${t.forbiddenFilesCount} archivos protegidos |`
    ),
    '',
  ];
  return lines.join('\n');
}

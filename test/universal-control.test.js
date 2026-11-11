import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  UNIVERSAL_AGENT_PROFILES,
  buildUniversalLauncher,
  configureUniversalBridges,
  listUniversalAgents,
  registerCustomAgent,
} from '../src/universal-agents.js';
import {
  compileHumanIntent,
  runAutopilotCycle,
  verifyAgentObedience,
} from '../src/control.js';
import { startSwarm } from '../src/swarm.js';
import { runAgentsCommand, runControlCommand } from '../src/cli_extra.js';

function tmp(prefix = 'cb-univ-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeDeps(root) {
  return {
    exec(args) {
      if (args[0] === 'worktree' && args[1] === 'add') {
        fs.mkdirSync(path.join(root, args[2]), { recursive: true });
      }
      return '';
    },
    spawn() {
      return { pid: 7777 };
    },
  };
}

test('Adaptabilidad Universal: soporta 13+ agentes integrados, registro de agentes custom y lanzamiento universal de Telaraña', () => {
  const dir = tmp();
  const initialList = listUniversalAgents(dir);
  assert.ok(initialList.length >= 13);
  for (const id of ['opencode', 'kilo', 'claude', 'codex', 'aider', 'gemini', 'cursor', 'windsurf', 'cline', 'copilot', 'continue', 'goose', 'amp']) {
    assert.ok(UNIVERSAL_AGENT_PROFILES[id], `Falta perfil universal para ${id}`);
  }

  // Registrar un agente de código personalizado (ej. devin-cli o qwen-coder)
  const custom = registerCustomAgent(dir, {
    id: 'qwen-agent',
    displayName: 'Qwen Coder CLI',
    binary: 'qwen-cli',
    commandTemplate: 'qwen-cli --session {session} --task "{instruction}"',
  });
  assert.equal(custom.id, 'qwen-agent');
  assert.equal(fs.existsSync(path.join(dir, 'contextbase', 'agents.json')), true);

  // Desplegar Telaraña con el agente personalizado sin necesitar --universal porque ya está registrado en contextbase/agents.json
  const customSwarm = startSwarm(
    {
      cwd: dir,
      prey: 'Construir módulo universal con qwen-agent',
      spiders: 2,
      agent: 'qwen-agent',
      base: 'main',
    },
    fakeDeps(dir)
  );
  assert.equal(customSwarm.agent, 'qwen-agent');
  assert.equal(customSwarm.spiders.length, 2);
  const launcherContent = fs.readFileSync(path.join(dir, customSwarm.spiders[0].launcher), 'utf8');
  assert.ok(launcherContent.includes('qwen-cli --session'));

  // Desplegar Telaraña con Claude Code o Aider usando universal: true
  const claudeSwarm = startSwarm(
    {
      cwd: dir,
      prey: 'Auditar con Claude Code en modo universal',
      spiders: 2,
      agent: 'claude',
      universal: true,
      base: 'main',
    },
    fakeDeps(dir)
  );
  assert.equal(claudeSwarm.agent, 'claude');
  assert.equal(claudeSwarm.universal, true);
  const claudeLauncher = fs.readFileSync(path.join(dir, claudeSwarm.spiders[0].launcher), 'utf8');
  assert.ok(claudeLauncher.includes('claude --permission-mode acceptEdits'));

  // Configurar puentes universales (.clinerules, .roorules, .aider.conf.yml, .github/copilot-instructions.md, .vscode/mcp.json, .gemini/settings.json)
  const bridges = configureUniversalBridges(dir, { includeAll: true });
  assert.ok(bridges.includes('.clinerules'));
  assert.ok(bridges.includes('.aider.conf.yml'));
  assert.ok(bridges.includes('.github/copilot-instructions.md'));
  assert.ok(bridges.includes('.vscode/mcp.json'));
  assert.ok(bridges.includes('.gemini/settings.json'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Motor de Gobernanza Soberana: compileHumanIntent, verifyAgentObedience y runAutopilotCycle aplican "No es la IA, es quien controla a la IA"', () => {
  const dir = tmp('cb-ctrl-');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'engine.js'), 'export const engine = true;\n'.repeat(25));
  fs.writeFileSync(path.join(dir, 'src', 'api.js'), 'export const api = true;\n'.repeat(25));
  fs.writeFileSync(path.join(dir, 'src', 'ui.js'), 'export const ui = true;\n'.repeat(25));

  // 1. Compilar intención humana en contrato determinista
  const contract = compileHumanIntent(
    dir,
    'Separar lógica de engine.js; blindar api.js; optimizar ui.js',
    { spiders: 3 }
  );
  assert.equal(contract.philosophy, 'No es la IA, es quien controla a la IA');
  assert.equal(contract.cognitiveGovernance.allowNestedSubagents, false);
  assert.ok(contract.cognitiveGovernance.tokenSavingsPct >= 70);
  assert.equal(contract.fileBoundaries.disjointVerified, true);
  assert.equal(fs.existsSync(path.join(dir, 'contextbase', 'control', 'intent-contract.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'contextbase', 'control', 'control.md')), true);

  // 2. Ejecutar ciclo de Autopiloto Soberano (inicializa memoria, sincroniza y verifica obediencia)
  const cycle = runAutopilotCycle(dir, { autoConfig: true });
  assert.equal(cycle.obedience.sovereigntyScore, 100);
  assert.equal(cycle.obedience.verdict, 'CONTROL_TOTAL');

  fs.rmSync(dir, { recursive: true, force: true });
});

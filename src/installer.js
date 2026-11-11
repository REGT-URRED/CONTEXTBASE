import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { autoConfigureGlobal } from './autoconfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Instala la Skill de ContextBase en las ubicaciones globales y de proyecto
 * para OpenCode, Kilo Code, Claude Code, Antigravity/Gemini y .agents.
 */
export function installSkill(target = 'global', projectDir = process.cwd(), customHome = os.homedir()) {
  const sourceSkillPath = path.resolve(__dirname, '..', 'skills', 'contextbase', 'SKILL.md');
  if (!fs.existsSync(sourceSkillPath)) {
    throw new Error(`Archivo fuente de la skill no encontrado en: ${sourceSkillPath}`);
  }

  const skillContent = fs.readFileSync(sourceSkillPath, 'utf8');
  const installedPaths = [];

  function writeSkillAt(dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'SKILL.md');
      fs.writeFileSync(file, skillContent, 'utf8');
      installedPaths.push(file);
    } catch {}
  }

  if (target === 'global' || target === 'all') {
    // 1. Universal .agents/skills/contextbase (leido por OpenCode, Kilo y agentes modernos)
    writeSkillAt(path.join(customHome, '.agents', 'skills', 'contextbase'));

    // 2. OpenCode global (~/.config/opencode/skills/contextbase)
    writeSkillAt(path.join(customHome, '.config', 'opencode', 'skills', 'contextbase'));

    // 3. Kilo Code global (~/.kilo/skills/contextbase y ~/.config/kilo/skills/contextbase si existe)
    writeSkillAt(path.join(customHome, '.kilo', 'skills', 'contextbase'));
    if (fs.existsSync(path.join(customHome, '.config', 'kilo'))) {
      writeSkillAt(path.join(customHome, '.config', 'kilo', 'skills', 'contextbase'));
    }

    // 4. Antigravity / Gemini CLI Global
    writeSkillAt(path.join(customHome, '.gemini', 'config', 'skills', 'contextbase'));

    // 5. Claude Code global si existe ~/.claude
    if (fs.existsSync(path.join(customHome, '.claude'))) {
      writeSkillAt(path.join(customHome, '.claude', 'skills', 'contextbase'));
    }

    try {
      if (!process.env.NODE_TEST_CONTEXT) {
        autoConfigureGlobal({ homeDir: customHome });
      }
    } catch {}
  }

  if (target === 'workspace' || target === 'all') {
    const root = path.resolve(projectDir);
    writeSkillAt(path.join(root, '.agents', 'skills', 'contextbase'));
    writeSkillAt(path.join(root, '.opencode', 'skills', 'contextbase'));
    writeSkillAt(path.join(root, '.kilo', 'skills', 'contextbase'));
  }

  return installedPaths;
}

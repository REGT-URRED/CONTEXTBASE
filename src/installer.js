import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { autoConfigureGlobal } from './autoconfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILLS_ROOT = path.resolve(__dirname, '..', 'skills');

/**
 * Descubre todas las skills del paquete: cada subdirectorio de skills/ con un SKILL.md.
 * Una carpeta sin SKILL.md no es una skill y no se instala.
 */
function discoverSkills() {
  const skills = [];
  let entries = [];
  try {
    entries = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true });
  } catch {
    return skills;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(SKILLS_ROOT, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    try {
      skills.push({ name: entry.name, content: fs.readFileSync(file, 'utf8') });
    } catch { /* skill ilegible: se omite sin romper la instalacion del resto */ }
  }
  // Orden estable: la instalacion es reproducible entre corridas.
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Instala todas las Skills de ContextBase en las ubicaciones globales y de proyecto
 * para OpenCode, Kilo Code, Claude Code, Antigravity/Gemini y .agents.
 * Cada skill va bajo su propio nombre de directorio (<destino>/skills/<nombre>/SKILL.md).
 */
export function installSkill(target = 'global', projectDir = process.cwd(), customHome = os.homedir()) {
  const sourceSkillPath = path.resolve(SKILLS_ROOT, 'contextbase', 'SKILL.md');
  if (!fs.existsSync(sourceSkillPath)) {
    throw new Error(`Archivo fuente de la skill no encontrado en: ${sourceSkillPath}`);
  }

  const skills = discoverSkills();
  const installedPaths = [];

  function writeSkillAt(dir, content) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'SKILL.md');
      fs.writeFileSync(file, content, 'utf8');
      installedPaths.push(file);
    } catch {}
  }

  // Instala todas las skills bajo un mismo directorio de skills del agente.
  function writeSkillsUnder(skillsDir) {
    for (const skill of skills) {
      writeSkillAt(path.join(skillsDir, skill.name), skill.content);
    }
  }

  if (target === 'global' || target === 'all') {
    // 1. Universal .agents/skills (leido por OpenCode, Kilo y agentes modernos)
    writeSkillsUnder(path.join(customHome, '.agents', 'skills'));

    // 2. OpenCode global (~/.config/opencode/skills)
    writeSkillsUnder(path.join(customHome, '.config', 'opencode', 'skills'));

    // 3. Kilo Code global (~/.kilo/skills y ~/.config/kilo/skills si existe)
    writeSkillsUnder(path.join(customHome, '.kilo', 'skills'));
    if (fs.existsSync(path.join(customHome, '.config', 'kilo'))) {
      writeSkillsUnder(path.join(customHome, '.config', 'kilo', 'skills'));
    }

    // 4. Antigravity / Gemini CLI Global
    writeSkillsUnder(path.join(customHome, '.gemini', 'config', 'skills'));

    // 5. Claude Code global si existe ~/.claude
    if (fs.existsSync(path.join(customHome, '.claude'))) {
      writeSkillsUnder(path.join(customHome, '.claude', 'skills'));
    }

    try {
      if (!process.env.NODE_TEST_CONTEXT) {
        autoConfigureGlobal({ homeDir: customHome });
      }
    } catch {}
  }

  if (target === 'workspace' || target === 'all') {
    const root = path.resolve(projectDir);
    writeSkillsUnder(path.join(root, '.agents', 'skills'));
    writeSkillsUnder(path.join(root, '.opencode', 'skills'));
    writeSkillsUnder(path.join(root, '.kilo', 'skills'));
  }

  return installedPaths;
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function missionText() {
  const file = path.join(__dirname, 'prompts', 'mission-orchestration.md');
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
}

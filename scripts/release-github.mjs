import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: opts.stdio || 'inherit', windowsHide: true, ...opts });
}

console.log(`[release] version ${version} (${tag})`);

console.log('[release] running tests...');
run(process.execPath, ['--test']);

console.log('[release] building npm tarball...');
const packed = run('npm', ['pack', '--silent'], { stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' }).trim().split(/\r?\n/).pop();
const src = path.join(root, packed);
const stable = path.join(root, 'contextbase.tgz');
fs.copyFileSync(src, stable);
console.log(`[release] ${packed} -> contextbase.tgz`);

console.log('[release] publishing to GitHub Releases (requires writable GH_TOKEN)...');
try {
  run('gh', ['release', 'view', tag], { stdio: 'ignore' });
  run('gh', ['release', 'upload', tag, 'contextbase.tgz', '--clobber']);
  console.log(`[release] uploaded contextbase.tgz to existing release ${tag}`);
} catch {
  run('gh', ['release', 'create', tag, 'contextbase.tgz', '--title', tag, '--generate-notes']);
  console.log(`[release] created GitHub release ${tag} with contextbase.tgz`);
}

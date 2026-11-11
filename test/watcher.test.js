import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { syncWorkspaceChanges, startWatcher, isRelevantPath } from '../src/watcher.js';
import { runLifecycleHook } from '../src/hooks.js';
import { silentInit } from '../src/auto.js';

const GIT = ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false'];

function git(dir, args) {
  return execFileSync('git', [...GIT, ...args], { cwd: dir, encoding: 'utf8', windowsHide: true }).trim();
}

test('isRelevantPath filtra rutas internas y acepta codigo del proyecto', () => {
  assert.equal(isRelevantPath('contextbase/changelog.md'), false);
  assert.equal(isRelevantPath('.opencode/plugins/contextbase-auto.js'), false);
  assert.equal(isRelevantPath('kilo.json'), false);
  assert.equal(isRelevantPath('src/app.js'), true);
});

test('syncWorkspaceChanges y runLifecycleHook actualizan changelog, tasklist y strands automaticamente', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-watch-'));
  git(dir, ['init', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo-auto', version: '1.0.0' }, null, 2));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'export const x = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);

  silentInit(dir);

  const digest = await runLifecycleHook('session-start', dir);
  assert.ok(digest.includes('# ContextBase ::'));

  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'export const x = 2;\n// TODO: validar entrada de usuario\n');
  const syncRes = syncWorkspaceChanges(dir);
  assert.equal(syncRes.synced, true);
  assert.ok(syncRes.files.includes('src/index.js'));

  const changelog = fs.readFileSync(path.join(dir, 'contextbase', 'changelog.md'), 'utf8');
  assert.ok(changelog.includes('[auto] Sincronización automática de archivos modificados: src/index.js'));

  const tasklist = fs.readFileSync(path.join(dir, 'contextbase', 'tasklist.md'), 'utf8');
  assert.ok(tasklist.includes('validar entrada de usuario'));

  await runLifecycleHook('task-add', dir, ['Nueva tarea desde todowrite']);
  let updatedTasks = fs.readFileSync(path.join(dir, 'contextbase', 'tasklist.md'), 'utf8');
  assert.ok(updatedTasks.includes('- [ ] Nueva tarea desde todowrite'));

  await runLifecycleHook('task-done', dir, ['Nueva tarea desde todowrite']);
  updatedTasks = fs.readFileSync(path.join(dir, 'contextbase', 'tasklist.md'), 'utf8');
  assert.ok(updatedTasks.includes('- [x] Nueva tarea desde todowrite'));

  const watcher = startWatcher(dir, { debounceMs: 50 });
  watcher.trigger(['src/index.js']);
  assert.equal(watcher.getStats().closed, false);
  watcher.close();
  assert.equal(watcher.getStats().closed, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

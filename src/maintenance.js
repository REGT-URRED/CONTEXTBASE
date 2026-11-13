import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { writeAtomic } from './fsutil.js';

const MAX_DEPS_INVENTORY = 40;

/**
 * Presupuesto de red. `runMaintenance` corre dentro del event loop del MCP: un solo
 * comando colgado (npm outdated 45 s + pip 60 s + audit 60 s = 165 s) congela el
 * handshake y el host mata el proceso. 15 s por comando, corte total al primer
 * timeout y nada de red en contexto de test.
 */
const NET_TIMEOUT_MS = 15000;
const NET_BLOCK_TTL_MS = 10 * 60 * 1000;

const netState = { blockedUntil: 0, reason: null, timeouts: 0 };

function networkAllowed() {
  if (process.env.NODE_TEST_CONTEXT) return false;
  return Date.now() >= netState.blockedUntil;
}

function networkReason() {
  if (process.env.NODE_TEST_CONTEXT) return 'NODE_TEST_CONTEXT';
  return netState.reason;
}

function blockNetwork(reason) {
  netState.reason = reason;
  netState.blockedUntil = Date.now() + NET_BLOCK_TTL_MS;
}

function run(cmd, cwd, timeout = 30000) {
  const result = runDetailed(cmd, cwd, timeout);
  return result.stdout;
}

/**
 * Igual que `run` pero distingue un timeout de un "no esta instalado": ambos devuelven
 * stdout null y el presupuesto necesita saber cual fue para cortar el escaneo.
 */
function runDetailed(cmd, cwd, timeout) {
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout });
    return { stdout, timedOut: false };
  } catch (e) {
    // npm outdated / pip audit terminan con código != 0 en resultados positivos: devolver stdout si existe
    const stdout = e && typeof e.stdout === 'string' && e.stdout.trim().length > 0 ? e.stdout : null;
    const killed = Boolean(e && (e.killed || e.signal || e.code === 'ETIMEDOUT'));
    return { stdout, timedOut: !stdout && killed };
  }
}

/** Ejecuta un comando de red respetando el presupuesto. `skipped` = no se intento. */
function runNetwork(cmd, cwd) {
  if (!networkAllowed()) return { stdout: null, timedOut: false, skipped: true };
  const result = runDetailed(cmd, cwd, NET_TIMEOUT_MS);
  if (result.timedOut) {
    netState.timeouts += 1;
    blockNetwork(`timeout de red en "${cmd.split(' ')[0]}" (${NET_TIMEOUT_MS} ms)`);
  }
  return { ...result, skipped: false };
}

function networkBudget() {
  return {
    enabled: networkAllowed(),
    reason: networkReason(),
    timeouts: netState.timeouts
  };
}

/** Linea unica que reemplaza el escaneo cuando el presupuesto esta cerrado. */
function networkSkipLine(eco, what, reason) {
  return { eco, detail: `Escaneo de red omitido (${reason || 'presupuesto agotado'}): ${what}. Ejecutar manualmente.` };
}

function fileMtime(p) {
  try { return fs.statSync(p).mtime.toISOString().split('T')[0]; } catch { return null; }
}

function installedNodeVersion(projectDir, name) {
  const pkgPath = path.join(projectDir, 'node_modules', ...name.split('/'), 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try { return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || null; } catch { return null; }
}

function countSeverities(vulns) {
  const counts = {};
  for (const v of Object.values(vulns || {})) {
    const sev = v.severity || 'unknown';
    counts[sev] = (counts[sev] || 0) + 1;
  }
  return counts;
}

function pipInstalledVersions(projectDir) {
  const out = run('pip list --format json', projectDir, 30000);
  if (!out) return {};
  try {
    const map = {};
    for (const d of JSON.parse(out)) map[String(d.name).toLowerCase()] = d.version;
    return map;
  } catch { return {}; }
}

function parseRequirements(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.split(/[=><~!\[]/)[0].trim())
      .filter(Boolean);
  } catch { return []; }
}

function parseCargoLock(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const deps = [];
    const blocks = fs.readFileSync(file, 'utf8').split(/\[\[package\]\]/).slice(1);
    for (const b of blocks) {
      const name = b.match(/^name\s*=\s*"([^"]+)"/m);
      const version = b.match(/^version\s*=\s*"([^"]+)"/m);
      if (name) deps.push({ name: name[1], installed: version ? version[1] : null });
    }
    return deps.slice(0, MAX_DEPS_INVENTORY);
  } catch { return []; }
}

function parseGoMod(file) {
  try {
    const deps = [];
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([a-zA-Z0-9.\-\/]+)\s+(v[0-9][^\s]*)/);
      if (m && m[1].includes('.')) deps.push({ name: m[1], installed: m[2] });
    }
    return deps.slice(0, MAX_DEPS_INVENTORY);
  } catch { return []; }
}

/**
 * Inventario de componentes: manifiestos, última modificación y versión instalada.
 * Solo lectura local, sin red ni dependencias.
 */
function collectInventory(projectDir) {
  const manifests = [
    { name: 'package.json', eco: 'Node.js / npm', file: 'package.json' },
    { name: 'Python (pip)', eco: 'Python / pip', file: 'requirements.txt' },
    { name: 'Python (pyproject)', eco: 'Python / pip', file: 'pyproject.toml' },
    { name: 'Rust (cargo)', eco: 'Rust / cargo', file: 'Cargo.toml' },
    { name: 'Go (modules)', eco: 'Go', file: 'go.mod' }
  ];

  const inventory = [];
  for (const m of manifests) {
    const full = path.join(projectDir, m.file);
    if (!fs.existsSync(full)) continue;
    const row = { eco: m.eco, file: m.file, lastModified: fileMtime(full), deps: [] };
    if (m.file === 'package.json') {
      try {
        const pkg = JSON.parse(fs.readFileSync(full, 'utf8'));
        const names = [
          ...Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies })
        ].slice(0, MAX_DEPS_INVENTORY);
        row.deps = names.map(n => {
          const installed = installedNodeVersion(projectDir, n);
          return { name: n, ranges: { prod: pkg.dependencies?.[n], dev: pkg.devDependencies?.[n], optional: pkg.optionalDependencies?.[n] }, installed };
        });
      } catch { /* paquete corrupto: inventario vacío */ }
    }
    if (m.file === 'requirements.txt') {
      const installed = pipInstalledVersions(projectDir);
      row.deps = parseRequirements(full).map(n => ({ name: n, installed: installed[n.toLowerCase()] || null }));
    }
    if (m.file === 'Cargo.toml') row.deps = parseCargoLock(path.join(projectDir, 'Cargo.lock'));
    if (m.file === 'go.mod') row.deps = parseGoMod(full);
    inventory.push(row);
  }
  return inventory;
}

/**
 * Escaneo de desactualización (frescura) por ecosistema.
 */
function freshnessScan(projectDir) {
  const results = [];
  const npmProject = fs.existsSync(path.join(projectDir, 'package.json'));
  const pyProject = fs.existsSync(path.join(projectDir, 'requirements.txt')) || fs.existsSync(path.join(projectDir, 'pyproject.toml'));
  if (!npmProject && !pyProject) return results;
  if (!networkAllowed()) {
    const reason = networkReason() || 'presupuesto de red agotado';
    if (npmProject) results.push(networkSkipLine('Node.js / npm', '`npm outdated`', reason));
    if (pyProject) results.push(networkSkipLine('Python / pip', '`pip list --outdated`', reason));
    return results;
  }
  if (npmProject) {
    const npmOutdated = runNetwork('npm outdated --json --silent', projectDir);
    const out = npmOutdated.stdout;
    if (npmOutdated.skipped) {
      results.push(networkSkipLine('Node.js / npm', '`npm outdated`', networkReason()));
    } else if (out) {
      try {
        const data = JSON.parse(out);
        const outdated = Object.entries(data).map(([name, d]) => `- \`npm\` **${name}**: ${d.current ? `instalado ${d.current}` : 'no instalado'} → disponible ${d.latest || d.wanted || '?'}`).join('\n');
        results.push({ eco: 'Node.js / npm', detail: outdated || 'Todos los componentes están actualizados.' });
      } catch { results.push({ eco: 'Node.js / npm', detail: 'Salida no interpretable; revisar con `npm outdated`.' }); }
    } else {
      results.push({ eco: 'Node.js / npm', detail: 'No se pudo ejecutar `npm outdated` (sin red o sin npm). Verificar manualmente.' });
    }
  }
  if (pyProject) {
    const pipOutdated = runNetwork('pip list --outdated --format json', projectDir);
    const out = pipOutdated.stdout;
    if (pipOutdated.skipped) {
      results.push(networkSkipLine('Python / pip', '`pip list --outdated`', networkReason()));
    } else if (out) {
      try {
        const data = JSON.parse(out);
        const outdated = data.slice(0, 25).map(d => `- \`pip\` **${d.name}**: instalado ${d.version} → disponible ${d.latest_version}`).join('\n');
        results.push({ eco: 'Python / pip', detail: outdated || 'Todos los componentes están actualizados.' });
      } catch { results.push({ eco: 'Python / pip', detail: 'Salida no interpretable; revisar con `pip list --outdated`.' }); }
    } else {
      results.push({ eco: 'Python / pip', detail: 'No se pudo ejecutar `pip list --outdated` (sin pip o sin red). Verificar manualmente.' });
    }
  }
  return results;
}

/**
 * Verificación final de brechas de seguridad conocidas, por ecosistema.
 */
function securityScan(projectDir) {
  const results = [];
  const npmProject = fs.existsSync(path.join(projectDir, 'package.json'));
  const pyProject = fs.existsSync(path.join(projectDir, 'requirements.txt')) || fs.existsSync(path.join(projectDir, 'pyproject.toml'));
  const cargoProject = fs.existsSync(path.join(projectDir, 'Cargo.toml'));
  const goProject = fs.existsSync(path.join(projectDir, 'go.mod'));
  if (!npmProject && !pyProject && !cargoProject && !goProject) return results;

  if (!networkAllowed()) {
    const reason = networkReason() || 'presupuesto de red agotado';
    if (npmProject) results.push(networkSkipLine('Node.js / npm', '`npm audit`', reason));
    if (pyProject) results.push(networkSkipLine('Python / pip-audit', '`pip-audit`', reason));
    if (cargoProject) results.push(networkSkipLine('Rust / cargo audit', '`cargo audit`', reason));
    if (goProject) results.push(networkSkipLine('Go / govulncheck', '`govulncheck`', reason));
    return results;
  }

  if (npmProject) {
    const audit = runNetwork('npm audit --json --silent', projectDir);
    const out = audit.stdout;
    if (audit.skipped) {
      results.push(networkSkipLine('Node.js / npm', '`npm audit`', networkReason()));
    } else if (out) {
      try {
        const data = JSON.parse(out);
        const counts = countSeverities(data.vulnerabilities);
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        results.push({ eco: 'Node.js / npm', total, counts, detail: total > 0 ? Object.entries(counts).map(([s, n]) => `- ${s}: ${n}`).join('\n') : 'Sin vulnerabilidades conocidas reportadas.' });
      } catch { results.push({ eco: 'Node.js / npm', detail: 'Salida no interpretable; revisar con `npm audit`.' }); }
    } else {
      results.push({ eco: 'Node.js / npm', detail: 'No se pudo ejecutar `npm audit` (requiere lockfile o acceso a registro). Revisar manualmente.' });
    }
  }
  for (const checker of [
    { eco: 'Python / pip-audit', probe: 'pip-audit --version', cmd: 'pip-audit --format json --quiet' }
  ]) {
    if (!pyProject) continue;
    const probe = runNetwork(checker.probe, projectDir);
    if (probe.skipped) {
      results.push(networkSkipLine(checker.eco, `\`${checker.probe}\``, networkReason()));
      continue;
    }
    if (probe.stdout) {
      const runAudit = runNetwork(checker.cmd, projectDir);
      const out = runAudit.stdout;
      if (out) {
        try {
          const data = JSON.parse(out);
          const vulns = Array.isArray(data) ? data : (data.dependencies || []).filter(d => d.vulns?.length > 0);
          results.push({ eco: checker.eco, total: vulns.length, counts: {}, detail: vulns.length > 0 ? vulns.map(v => `- ${v.name || v.component?.name || 'componente'}: vulnerabilidades reportadas`).join('\n') : 'Sin vulnerabilidades conocidas reportadas.' });
        } catch { results.push({ eco: checker.eco, detail: 'Salida no interpretable; revisar manualmente.' }); }
      } else if (!runAudit.skipped) {
        results.push({ eco: checker.eco, total: 0, counts: {}, detail: 'Sin vulnerabilidades conocidas reportadas.' });
      } else {
        results.push(networkSkipLine(checker.eco, '`pip-audit`', networkReason()));
      }
    }
  }
  if (cargoProject) {
    const probe = runNetwork('cargo audit --version', projectDir);
    if (probe.skipped) {
      results.push(networkSkipLine('Rust / cargo audit', '`cargo audit`', networkReason()));
    } else if (probe.stdout) {
      const runAudit = runNetwork('cargo audit --json', projectDir);
      const out = runAudit.stdout;
      if (out) {
        try {
          const data = JSON.parse(out);
          const list = data.vulnerabilities?.list || [];
          const counts = {};
          for (const v of list) {
            const sev = String(v.advisory?.severity || 'unknown').toLowerCase();
            counts[sev] = (counts[sev] || 0) + 1;
          }
          results.push({ eco: 'Rust / cargo audit', total: list.length, counts, detail: list.length > 0 ? list.map(v => '- ' + (v.advisory?.id || 'advisory') + ': ' + (v.package?.name || '?')).join('\n') : 'Sin vulnerabilidades conocidas reportadas.' });
        } catch { results.push({ eco: 'Rust / cargo audit', detail: 'Salida no interpretable; revisar con cargo audit.' }); }
      } else if (runAudit.skipped) {
        results.push(networkSkipLine('Rust / cargo audit', '`cargo audit`', networkReason()));
      }
    }
  }
  if (goProject) {
    const probe = runNetwork('govulncheck -version', projectDir);
    if (probe.skipped) {
      results.push(networkSkipLine('Go / govulncheck', '`govulncheck`', networkReason()));
    } else if (probe.stdout) {
      const runAudit = runNetwork('govulncheck ./...', projectDir);
      const out = runAudit.stdout;
      if (out) {
        const hits = (out.match(/Vulnerability #\d+/g) || []).length;
        results.push({ eco: 'Go / govulncheck', total: hits, counts: {}, detail: hits > 0 ? hits + ' vulnerabilidades reportadas (revisar salida de govulncheck).' : 'Sin vulnerabilidades conocidas reportadas.' });
      } else if (runAudit.skipped) {
        results.push(networkSkipLine('Go / govulncheck', '`govulncheck`', networkReason()));
      }
    }
  }
  return results;
}

/**
 * Genera el contenido de contextbase/componentes.md
 */
export function generateComponentes(inventory, freshness, security) {
  const date = new Date().toISOString().split('T')[0];

  const invSection = inventory.length > 0
    ? inventory.map(i => {
        const depsStr = i.deps.length > 0
          ? i.deps.map(d => `  - ${d.name}${d.installed ? ` (instalado ${d.installed})` : ' (no instalado)'}`).join('\n')
          : '  - Sin dependencias declaradas.';
        return `- **${i.eco}** — manifiesto \`${i.file}\`, última modificación: ${i.lastModified || 'desconocida'}\n${depsStr}`;
      }).join('\n')
    : '- No se detectaron manifiestos de componentes (proyecto vanilla).';

  const freshSection = freshness.map(f => `- **${f.eco}**:\n${f.detail}`).join('\n') || '- No se detectaron ecosistemas con gestor de paquetes.';
  const secSection = security.map(s => `- **${s.eco}**: ${s.total !== undefined ? `total ${s.total}\n${s.detail}` : s.detail}`).join('\n') || '- No hay verificadores de seguridad disponibles para este ecosistema. Revisar manualmente.';
  const criticals = security.reduce((acc, s) => acc + ((s.counts?.critical || 0) + (s.counts?.high || 0)), 0);

  return `# Componentes y Seguridad Preventiva del Proyecto

Inventario vivo de componentes, frescura de versiones y verificación de brechas de seguridad. Regenerar con \`contextbase audit\`.

---

## Última verificación: ${date}

---

## Inventario de Componentes

${invSection}

---

## Estado de Actualización (frescura)

${freshSection}

---

## Brechas de Seguridad Detectadas

${secSection}

> ${criticals > 0 ? `⚠️ **Acción requerida:** ${criticals} vulnerabilidad(es) critical/high detectadas. Registrarlas en \`tasklist.md\` como tareas \`[ ]\` y corregirlas de inmediato.` : 'Sin vulnerabilidades critical/high pendientes.'}

---

## Mantenimiento Automático (regla para agentes)

1. Revisar este documento al iniciar un proyecto o sesión: conocer versión instalada y última actualización de cada componente previene brechas y trabajo a ciegas.
2. Regenerar con \`contextbase audit\` como verificación final de cada cambio cerrado.
3. Si aparecen vulnerabilidades critical/high: registrar en \`tasklist.md\` y corregirlas antes de continuar con nuevas funcionalidades.
---
*Generado automáticamente por ContextBase CLI el ${date}.*
`;
}

/**
 * Mantenimiento completo: inventario + frescura + seguridad -> contextbase/componentes.md
 *
 * `network` informa que hizo el presupuesto: el watcher y el MCP llaman a esta funcion
 * en cada latido y necesitan saber si hubo red, si se corto por timeout o por test.
 */
export function runMaintenance(projectDir) {
  const inventory = collectInventory(projectDir);
  const freshness = freshnessScan(projectDir);
  const security = securityScan(projectDir);
  const contextDir = path.join(projectDir, 'contextbase');
  fs.mkdirSync(contextDir, { recursive: true });
  const file = path.join(contextDir, 'componentes.md');
  writeAtomic(file, generateComponentes(inventory, freshness, security));
  return { file, inventory, freshness, security, network: networkBudget() };
}

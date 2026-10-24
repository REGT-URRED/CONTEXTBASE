import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const MAX_DEPS_INVENTORY = 40;

function run(cmd, cwd, timeout = 30000) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout });
  } catch (e) {
    // npm outdated / pip audit terminan con código != 0 en resultados positivos: devolver stdout si existe
    if (e && typeof e.stdout === 'string' && e.stdout.trim().length > 0) return e.stdout;
    return null;
  }
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
    inventory.push(row);
  }
  return inventory;
}

/**
 * Escaneo de desactualización (frescura) por ecosistema.
 */
function freshnessScan(projectDir) {
  const results = [];
  if (fs.existsSync(path.join(projectDir, 'package.json'))) {
    const out = run('npm outdated --json --silent', projectDir, 45000);
    if (out) {
      try {
        const data = JSON.parse(out);
        const outdated = Object.entries(data).map(([name, d]) => `- \`npm\` **${name}**: ${d.current ? `instalado ${d.current}` : 'no instalado'} → disponible ${d.latest || d.wanted || '?'}`).join('\n');
        results.push({ eco: 'Node.js / npm', detail: outdated || 'Todos los componentes están actualizados.' });
      } catch { results.push({ eco: 'Node.js / npm', detail: 'Salida no interpretable; revisar con `npm outdated`.' }); }
    } else {
      results.push({ eco: 'Node.js / npm', detail: 'No se pudo ejecutar `npm outdated` (sin red o sin npm). Verificar manualmente.' });
    }
  }
  if (fs.existsSync(path.join(projectDir, 'requirements.txt')) || fs.existsSync(path.join(projectDir, 'pyproject.toml'))) {
    const out = run('pip list --outdated --format json', projectDir, 60000);
    if (out) {
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
  if (fs.existsSync(path.join(projectDir, 'package.json'))) {
    const out = run('npm audit --json --silent', projectDir, 60000);
    if (out) {
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
    if (run(checker.probe, projectDir, 10000)) {
      const out = run(checker.cmd, projectDir, 120000);
      if (out) {
        try {
          const data = JSON.parse(out);
          const vulns = Array.isArray(data) ? data : (data.dependencies || []).filter(d => d.vulns?.length > 0);
          results.push({ eco: checker.eco, total: vulns.length, counts: {}, detail: vulns.length > 0 ? vulns.map(v => `- ${v.name || v.component?.name || 'componente'}: vulnerabilidades reportadas`).join('\n') : 'Sin vulnerabilidades conocidas reportadas.' });
        } catch { results.push({ eco: checker.eco, detail: 'Salida no interpretable; revisar manualmente.' }); }
      } else {
        results.push({ eco: checker.eco, total: 0, counts: {}, detail: 'Sin vulnerabilidades conocidas reportadas.' });
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
 */
export function runMaintenance(projectDir) {
  const inventory = collectInventory(projectDir);
  const freshness = freshnessScan(projectDir);
  const security = securityScan(projectDir);
  const contextDir = path.join(projectDir, 'contextbase');
  fs.mkdirSync(contextDir, { recursive: true });
  const file = path.join(contextDir, 'componentes.md');
  fs.writeFileSync(file, generateComponentes(inventory, freshness, security), 'utf8');
  return { file, inventory, freshness, security };
}

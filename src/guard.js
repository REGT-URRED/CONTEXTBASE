import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeAtomic } from './fsutil.js';

export const GUARDED_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
  '.windsurfrules',
  '.gemini/rules/contextbase.md',
  '.agents/rules/contextbase.md'
];

export const REPAIR_ALLOWLIST = {
  'AGENTS.md': 'https://raw.githubusercontent.com/REGT-URRED/CONTEXTBASE/main/AGENTS.md',
  'CLAUDE.md': 'https://raw.githubusercontent.com/REGT-URRED/CONTEXTBASE/main/CLAUDE.md',
  '.cursorrules': 'https://raw.githubusercontent.com/REGT-URRED/CONTEXTBASE/main/.cursorrules',
  '.windsurfrules': 'https://raw.githubusercontent.com/REGT-URRED/CONTEXTBASE/main/.windsurfrules'
};

export function loadGuarded(cwd) {
  const base = [...GUARDED_FILES];
  const file = path.join(cwd, 'contextbase', 'guarded.json');
  try {
    if (fs.existsSync(file)) {
      const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(arr)) {
        for (const x of arr) {
          if (typeof x === 'string' && !base.includes(x)) base.push(x);
        }
      }
    }
  } catch {}
  return base;
}

export function hashFile(p) {
  try {
    const buf = fs.readFileSync(p);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

function fileMtimeIso(p) {
  try { return fs.statSync(p).mtime.toISOString(); } catch { return null; }
}

function readBaselineFile(cwd) {
  const file = path.join(cwd, 'contextbase', 'baseline.json');
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.files && typeof parsed.files === 'object') return parsed;
  } catch {}
  return null;
}

export function baseline(cwd) {
  const file = path.join(cwd, 'contextbase', 'baseline.json');
  let b = readBaselineFile(cwd);
  if (!b) {
    b = { files: {}, created: new Date().toISOString() };
  }
  const guarded = loadGuarded(cwd);
  let changed = !readBaselineFile(cwd);
  for (const rel of guarded) {
    if (!(rel in b.files)) {
      const full = path.join(cwd, rel);
      b.files[rel] = { hash: hashFile(full), mtime: fileMtimeIso(full) };
      changed = true;
    }
  }
  if (changed || !fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeAtomic(file, JSON.stringify(b, null, 2));
  }
  return b;
}

const SUSPICIOUS_PATTERNS = [
  [/sk-[A-Za-z0-9]{20,}/, 'API key sk-'],
  [/ghp_[A-Za-z0-9]{30,}/, 'GitHub token ghp_'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token xox'],
  [/AKIA[0-9A-Z]{16}/, 'AWS key AKIA'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'PEM private key'],
  [/\bcurl\b[^\n]*https?:\/\//i, 'exfil URL via curl'],
  [/\bwget\b[^\n]*https?:\/\//i, 'exfil URL via wget'],
  [/ignore previous/i, 'instruction override'],
  [/disregard/i, 'instruction override']
];

export function scanSuspicious(text) {
  const reasons = [];
  const s = String(text || '');
  for (const [re, reason] of SUSPICIOUS_PATTERNS) {
    if (re.test(s)) reasons.push(reason);
  }
  return { suspicious: reasons.length > 0, reasons };
}

export function check(cwd) {
  const b = baseline(cwd);
  const guarded = loadGuarded(cwd);
  const drifts = [];
  for (const rel of guarded) {
    const full = path.join(cwd, rel);
    const exists = fs.existsSync(full);
    const nowHash = exists ? hashFile(full) : null;
    const base = (b.files && b.files[rel]) || null;
    const baseHash = base ? base.hash : null;

    let suspicious = false;
    let suspiciousReason = '';
    if (exists) {
      try {
        const content = fs.readFileSync(full, 'utf8');
        const scan = scanSuspicious(content);
        if (scan.suspicious) {
          suspicious = true;
          suspiciousReason = scan.reasons.join('; ');
        }
      } catch {}
    }

    if (suspicious) {
      drifts.push({ file: rel, kind: 'suspicious', reason: suspiciousReason });
      continue;
    }
    if (!exists && baseHash) {
      drifts.push({ file: rel, kind: 'missing', reason: 'file missing' });
      continue;
    }
    if (exists && baseHash !== nowHash) {
      if (baseHash === null) {
        drifts.push({ file: rel, kind: 'modified', reason: 'new file not in baseline' });
      } else {
        drifts.push({ file: rel, kind: 'modified', reason: 'hash mismatch' });
      }
    }
  }
  return { status: drifts.length ? 'drift' : 'ok', drifts };
}

export async function repair(cwd, file, source) {
  try {
    const rel = String(file || '').replace(/\\/g, '/');
    let url = REPAIR_ALLOWLIST[rel];
    if (source) {
      if (REPAIR_ALLOWLIST[rel] && source === REPAIR_ALLOWLIST[rel]) {
        url = source;
      } else if (Object.values(REPAIR_ALLOWLIST).includes(source)) {
        url = source;
      } else if (REPAIR_ALLOWLIST[source]) {
        url = REPAIR_ALLOWLIST[source];
      } else {
        return { ok: false, error: 'source not allowlisted' };
      }
    }
    if (!url) return { ok: false, error: 'no allowlisted source for file' };

    const res = await fetch(url);
    if (!res || !res.ok) return { ok: false, error: `HTTP ${res ? res.status : 'no response'}` };
    const text = await res.text();
    if (!text || !text.trim()) return { ok: false, error: 'empty content' };

    const full = path.join(cwd, rel);
    writeAtomic(full, text);

    const b = baseline(cwd);
    if (!b.files) b.files = {};
    b.files[rel] = { hash: hashFile(full), mtime: fileMtimeIso(full) };
    const bfile = path.join(cwd, 'contextbase', 'baseline.json');
    writeAtomic(bfile, JSON.stringify(b, null, 2));

    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
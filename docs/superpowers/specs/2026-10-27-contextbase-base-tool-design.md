# ContextBase Base Tool — Design

**Date:** 2026-10-27
**Status:** Approved decisions, pending final sign-off
**Author:** REGT (rafa)
**Scope:** Turn ContextBase from a memory CLI into a base tool that bootstraps and guards the agent environment.

## 1. Intent

New users lose hours wiring MCPs, skills and base rules before any real work. ContextBase already owns project memory and agent rules; it is the natural place to (a) bootstrap a working agent environment from zero, and (b) guard the base files agents depend on, every day, once installed. Two modes, one tool: Bootstrap (fresh) and Production (daily guard). Strands-style agent swarms are prepared now, implemented later.

## 2. Goals / Non-goals

Goals:
- Detect every CLI present; primary priority OpenCode > Claude Code > Kilo > others. Tool works for any CLI/desktop, CLI-first.
- Global base tools plus per-project tools/swarms, personalized by need. No pre-built agents nobody uses.
- Install only what is missing (idempotent), detecting via config MCP entry AND binary on PATH.
- Alert before/after install; user can keep or restore.
- Restore from last session point, not from zero.
- Guard base files (AGENTS.md, CLAUDE.md, .cursorrules, .windsurfrules) against malicious/unexpected modification; alert + restore.
- Auto-correct from official GitHub sources only.
- Prepare (not implement) a Strands agent-swarm hook point for autonomous multi-agent work.

Non-goals:
- Do not break cross-integration between tools. Integration contracts stay additive.
- Do not modify global config without consent.
- Do not implement Strands swarms in this phase (interface only).
- Do not fill Engram memory with install noise (record deltas only).

## 3. Decisions (locked)

1. **Install method:** hybrid. Versioned declarative registry (JSON) with `install`, `detect`, `verify` and explicit error handling/fallback per tool. No arbitrary user commands in v1.
2. **Config scope:** global for base tools; project-local for swarms and optional tools. Personalization by need.
3. **Multi-CLI:** detect all; primary order OpenCode > Claude Code > Kilo > others.
4. **Bootstrap vs init:** bootstrap runs init automatically when `contextbase/` is missing.
5. **Consent:** hybrid. Preview shows main and dangerous actions; the rest applies autonomously after auto-confirm.
6. **Snapshots:** bootstrap + manual, retention 5. Token-cheap: store full guarded files (small), report drift summaries only, never dump full content unless requested.
7. **Registry extensibility:** fixed registry with user enable/disable. Simple but functional.
8. **Restore/repair:** only guarded base files. Auto-correct from official GitHub repos (allowlist with repo URL + ref); no third-party sources.

## 4. Two modes

### 4.1 Bootstrap mode (everything at zero)
1. Detect CLIs + installed base tools (MCP config + PATH).
2. Show recommended set for the primary CLI (gentle-ai always; superpowers; oh-my-openclaude if Claude present).
3. User enables/disables entries from the fixed registry.
4. Preview: main actions + dangerous actions (global config writes, installs). Rest auto-confirms.
5. Install missing only; skip present; log skip.
6. Run init if `contextbase/` missing.
7. Snapshot baseline (last known good) of guarded files.
8. Record delta in changelog/tasklist; no Engram spam.

### 4.2 Production mode (already installed)
1. Integrity check of guarded files vs baseline hashes.
2. On drift/malicious change: alert immediately, offer restore-from-last-point, keep, or repair from official GitHub source.
3. Run main functions (status, audit, context) as today.
4. Optional: refresh missing tools (idempotent, consented).

## 5. Architecture (additive to existing src/)

New modules:
- `src/detect.js` — CLI + tool detection (PATH + MCP config parsers).
- `src/registry.js` — versioned tool registry, install/detect/verify, error handling.
- `src/bootstrap.js` — recommended sets, preview/consent, orchestration.
- `src/guard.js` — base-file hashing, drift detection, suspicious-content scan, repair.
- `src/snapshot.js` — capture/restore last known good point.
- `src/strands.js` — interface stub (prepare objective, no execution).

Extended:
- `src/cli.js` — new commands: `bootstrap`, `guard`, `snapshot`, `restore`, `tools`.
- `src/mcp.js` — new tools: `contextbase_bootstrap`, `contextbase_guard`, `contextbase_snapshot`, `contextbase_restore`, `contextbase_tools`.
- `src/context.js` — include guard status in digest.

Data files:
- `contextbase/baseline.json` — SHA-256 + mtime of guarded files at last good point, plus source provenance.
- `contextbase/tools.json` — enabled tools, installed versions, detection evidence.
- `contextbase/snapshot/` — last 5 points (gitignored).

## 6. Integrity / security layer

Guarded files: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, plus entries in `contextbase/guarded.json`.

Mechanism:
- On `status`/`guard`/MCP call: recompute SHA-256, compare to baseline.
- Drift: `missing`, `modified`, `suspicious` (API keys, tokens, exfil URLs, instruction overrides).
- On drift: alert with compact diff summary; offer restore, keep, or repair-from-official.
- Suspicious always alerts, never auto-accepts.

Repair:
- Allowlist of official repos per guarded file (e.g. ContextBase repo for its own injected block).
- `guard --repair` fetches official content, applies only that file, records provenance (repo + ref + hash).
- Network failure = alert only; never invent content.

Restore points:
- `snapshot` captures guarded files + baseline.json + tools.json into `contextbase/snapshot/<timestamp>/`.
- `restore` lists newest first; defaults to newest; only restores guarded files.
- Keep 5, prune older.

## 7. Token economics

- Baseline stores hashes, not content.
- `guard` and MCP responses return drift summary (file, status, 1-line reason), not file bodies.
- Full content only via explicit `--show` or MCP `includeContent: true`.
- Snapshots store full files (small, capped); no duplication in Engram.
- Digest `context` includes one-line guard status.

## 8. Idempotency rules

- Install: skip if detected (PATH or MCP config). Log skip.
- Guard: no-op if baseline matches.
- Snapshot: overwrite same-day point unless `--force`.
- All commands safe to re-run.

## 9. Consent model

- Bootstrap: preview of main + dangerous actions; rest auto-confirm.
- Global writes always listed in preview.
- Guard repair: explicit confirmation.
- No silent global config writes.

## 10. Strands preparation (future)

`src/strands.js` exposes:
- `prepareObjective(projectState)` -> objective descriptor (no execution).
- `isReady()` -> false until phase 2.
- Bootstrap prints: "swarm ready when enabled".

Phase 2: execute via Strands SDK, gated by user flag, per-project.

## 11. Commands (new/extended)

- `contextbase bootstrap [--cli=auto] [--tools=a,b] [--yes]`
- `contextbase guard [--json] [--check] [--repair] [--show]`
- `contextbase snapshot [--note=...]`
- `contextbase restore [id]`
- `contextbase tools list|enable <name>|disable <name>`
- Existing commands unchanged (API preserved).

## 12. MCP tools (new)

- `contextbase_bootstrap`, `contextbase_guard`, `contextbase_snapshot`, `contextbase_restore`, `contextbase_tools`.

## 13. Testing

- Detection: mock PATH/config fixtures.
- Guard: tamper fixtures (modified, missing, suspicious).
- Repair: mock official source fixture; network failure path.
- Snapshot/restore: round-trip.
- Idempotency: re-run produces no changes.
- Registry: detect/install/verify with missing tool and failure paths.
- Strands stub: interface only.

## 14. Migration / compatibility

- Existing projects: `status` creates baseline on first run if absent (no prompt).
- No breaking changes to existing commands or exports.
- `.gitignore` adds `contextbase/snapshot/`.

## 15. Residual risks

- Official repo content may change format; repair validates hash/provenance before writing.
- Global config writes vary by CLI; registry isolates schemas per CLI with tests.
- Auto-correct must never touch non-guarded files.

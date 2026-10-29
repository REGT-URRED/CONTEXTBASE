# ContextBase Swarm - Design

**Date:** 2026-10-29
**Status:** Approved shape, pending sign-off
**Author:** REGT (rafa)
**Scope:** Real per-project agent swarm: contextbase opens terminals, mints and hands out session ids, the main agent orchestrates, workers flow.

## 1. Intent

`src/strands.js` has been a stub with `ready:false` since the base-tool design. Real parallel work in the ENBAAT fork was done with git worktrees plus host subagents, and the recorded feedback is explicit: the swarm was advertised but not implemented, and `log`/`task` were unusable in parallel worktrees. This design closes both: real worker processes with real session ids, and per-worker namespaced memory.

## 2. Keystone decision

**The terminal is for the human. The file is for the machine.**

A TUI is a screen, not a contract. No orchestrator can read it reliably. Therefore:

- Worker input: `contextbase/swarm/<run>/<worker>/task.md`
- Worker output: `result.md` plus `status.json` (`running | done | blocked | failed`)
- The orchestrator reads files only, never the screen
- The terminal window exists so a human can watch and intervene

Any design that parses terminal output is rejected.

## 3. Verified facts (this machine, 2026-10-29)

- `opencode run --session <id>` creates the session if missing and appends if present; emits a JSON event stream carrying `sessionID`.
- Session ids must start with `ses`; anything else fails with `Expected a string starting with "ses"`.
- `opencode session list` lists created sessions as real top-level sessions.
- Verified sequentially across processes (same store, same background server). Not yet verified with a TUI holding the session open at the same time; that is the phase-0 spike.
- `claude` and `codex` are not installed here, so their session contract is unverifiable.

## 4. Components

| Unit | File | Responsibility |
|---|---|---|
| Agent contract | `src/swarm-agents.js` | Per-CLI capability table, session id minting, launcher file generation |
| Swarm core | `src/swarm.js` | Run state, task packets, start, status, send, collect, stop |
| CLI surface | `src/cli_extra.js` | `swarm start\|status\|send\|collect\|stop` replacing the stub |
| MCP surface | `src/mcp.js` | Five `contextbase_swarm_*` tools |

## 5. On-disk contract

`contextbase/swarm/<run>/state.json`

```json
{
  "run": "2026-10-29-a1b2",
  "base": "main",
  "agent": "opencode",
  "createdAt": "ISO",
  "workers": [
    {
      "id": "w1",
      "session": "ses_cb_20261029_a1b2_w1",
      "worktree": ".worktrees/swarm-2026-10-29-a1b2-w1",
      "branch": "swarm/2026-10-29-a1b2/w1",
      "scope": "2026-10-29-a1b2-w1",
      "pid": 12345,
      "task": "contextbase/swarm/2026-10-29-a1b2/w1/task.md",
      "result": "contextbase/swarm/2026-10-29-a1b2/w1/result.md",
      "status": "contextbase/swarm/2026-10-29-a1b2/w1/status.json"
    }
  ]
}
```

Per worker: `task.md` (assignment), `result.md` (worker writes), `status.json` (worker writes), `launch.cmd` / `launch.sh` (generated launcher).

## 6. Session ids

Minted locally as `ses_cb_<run>_<worker>`, sanitized to `[a-z0-9_]`. The CLI creates the session on first launch, so the orchestrator knows the id before the worker starts and can hand it to the human immediately.

## 7. Launching without shell quoting

User text never enters a command line. The generated launcher contains only fixed paths and the session id:

```
opencode --session ses_cb_... --prompt "Lee contextbase/swarm/<run>/<w>/task.md y ejecuta lo que indica. Al terminar escribe result.md y status.json en la misma carpeta."
```

All variable content lives in `task.md`. This kills quoting bugs, cmd.exe's 8191-char limit, and injection through task text.

Terminal spawn (Windows): `start` over the generated `.cmd` in a new window. POSIX: `tmux new-window` when available, otherwise a documented `unsupported` result. The spawn function is injected, so tests never open a window.

## 8. Worktrees

One `git worktree add .worktrees/swarm-<run>-<n> -b swarm/<run>/<n> <base>` per worker, created before spawn. N agents in one tree is the conflict guarantee already recorded in the feedback. Each worker also gets its own contextbase scope, so `log`/`task` never write the shared files.

## 9. Detecting a silent worker

Agents do not reliably write heartbeats. Status therefore derives from evidence the agent cannot fake by staying silent:

- `result.md` exists to `done`
- else `git -C <worktree> log -1 --format=%ct` and `git status --porcelain` count as activity
- else no activity within `ttl` (default 10 min) to `stale`

`stale` is the point of the feature: the usual swarm failure is not a crash, it is a worker that looks busy and does nothing.

## 10. Non-goals

- DAG scheduler with retries (the main agent is the scheduler)
- Streaming events through `opencode serve` (vendor coupling, no gain over state files)
- ACP integration
- Automatic merge of worker branches (dry-run report only)
- Non-opencode agents in v1; they are declared `unsupported` with a reason, not faked
- `--auto` (permission auto-approval) by default; opt-in flag only

## 11. Failure modes and responses

| Failure | Response |
|---|---|
| Session id rejected | Report the CLI's own error; do not silently retry with a new id |
| Worktree creation fails | Abort the run before any spawn; leave no half-state |
| Worker silent | `stale` after ttl, with the worktree evidence that justified it |
| Terminal closes | `pid` recorded; `status` marks `exited` when the process is gone |
| Orchestrator dies | `state.json` on disk is the recovery point; `status` reconstructs from it |

## 12. Open question

Phase 0 spike must confirm that a `run --session` call against a session held open by an interactive TUI does not conflict. If it does, `send` degrades to file-only delivery and the design says so in the output (`delivery: "file"`).

# afk-runner-web-board — Proposal

## Why

afk-runner is a terminal CLI: an operator away from the machine has no way to see how runs are doing. A run parked at a gate can wait hours and nothing reaches the operator — `listPendingGates()` (`afk-runner/src/run-index.ts`) computes exactly "runs waiting for you" and has zero product consumers; discovery today is polling `status`/`runs`/gate files. The runner's target state is an autonomous agent team a project owner supervises; the first supervision layer is a live, phone-first status board over the run portfolio.

## What Changes

- New read-only `serve` verb: `afk-runner serve [--host] [--port] [--token]` starts a zero-dependency HTTP server (Bun.serve) over the work dir.
- Token-gated static web page (single HTML file, vanilla JS + `EventSource`, no client build step) plus JSON API and an SSE stream that pushes a full portfolio snapshot on every detected change.
- Portfolio view (phone-first, sorted needs-you → running → recently finished): run cards with status, stage, round/cap, gate-pending mode + age, execution-half task progress line (`implement 7/12, t3 retrying`), tokens-first spend with honest cost bounds, wall time.
- Run-detail view: pipeline position, rounds with raised/open convergence, per-task walk with attempts, recent events feed, current gate file rendered read-only.
- Change detection by a polling mtime sweep over `runs/` (fs.watch later); per-run state = memo + fold of `events.ndjson` through the same kernel fold the drive loop uses.
- `serve` joins the config ladder as a config-consuming verb (`.afk-runner/config.json` → `AFK_RUNNER_WORKDIR`/env → compiled defaults).

No chat platform instances, task instances, or stored config are affected: the board reads run artifacts from disk and writes nothing — no DB rows, no config-context scope (per-user/group/thread) changes.

## Capabilities

### New Capabilities

- `afk-runner-web-board`: the standalone web board — the serve verb's HTTP/SSE surface, token auth, the pure fold→view projection (portfolio + run detail), the read-only fs seam, and live-update semantics. Without it, gate-pending and in-flight runs are invisible away from the terminal; the operator cannot supervise runs from a phone.

### Modified Capabilities

- `afk-runner-cli`: the verb table and the launch-configuration ladder requirement gain `serve` (read-only, config-consuming like every other verb). Without this, serve is not a sanctioned operator surface and its config resolution would be a per-verb special case.

## Impact

- `afk-runner/src/` — new `serve/` module (server, projection, watcher seam) + `cli.ts` verb routing; no changes to the drive loop, fold, or event schemas.
- Reuses, does not duplicate: `run-index.ts` roster readers, `accounting.ts` spend doctrine, `events.ts` torn-tail-tolerant reads, kernel `foldEvents` — the same surfaces `runs` and `analyze` already consume.
- Docs: `docs/architecture/afk-runner.md` gains a board section; specs `afk-runner-cli` delta.
- Zero new runtime dependencies (xstate + zod stay the whole set).

## Non-goals

- Settling gates from the browser (future 5th settle producer — the seam supports it; deliberately declined now).
- Push/chat notifications when a gate opens (the SSE projection is designed so a future notifier subscribes to the same view; declined now).
- Gantt timelines, historical analytics charts (`analyze` stays CLI), multi-workdir aggregation, fs.watch-based watching, a client build step, and run hierarchy (U1 remains on hold).

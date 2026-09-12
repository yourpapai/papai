# afk-runner-web-board — Design

## Context

The runner is a pure CLI over a work dir (`runs/<runId>/events.ndjson` + derived `state.json` memos + gate files). Every observation surface is poll-a-verb; `listPendingGates()` computes "runs waiting for you" with zero product consumers. The board is the first live, remote surface over that corpus. See proposal.md — Why.

## Goals / Non-Goals

**Goals**: phone-first glanceable portfolio; live updates without user action; strict read-only over run artifacts; zero new runtime dependencies; the projection reusable by future consumers (notifier, remote settle).

**Non-goals** (design-level): browser settle/steer paths, push notifications, fs.watch, a client build toolchain, multi-workdir aggregation, run hierarchy. These reuse the projection later without reshaping it.

## Decisions

**D1 — Standalone inside afk-runner, not a papai panel.** The runner is workspace-closed (copies, never imports) and runs over any repo; a papai-integrated panel would couple the board to papai's process and only cover papai-hosted runs. Alternative rejected: mounting the board in papai's existing `/admin` SPA + SSE collector — reuses auth/SSE but breaks standalone operation and drags papai's session model into the runner.

**D2 — Zero-dependency `Bun.serve`.** HTTP + SSE + static file serving are built into Bun; a server framework (Express/Fastify/Hono) adds nothing the verb needs. The workspace's dependency set stays `xstate + zod`. SSE over `fetch`-streamed responses needs no library.

**D3 — The projection is the pure core.** `foldEvents(pipelineMachine, readEvents(log))` (the same kernel fold the drive loop and `analyze` use) joined with the memo via `readAllRunStates` produces two pure view models: `RunView` (per run) and `PortfolioView` (sorted cards + totals). The server, sweep, and SSE are shells around it. Sorting (gate-pending → running → terminal) and card fields live here, unit-tested without I/O. This is the piece future consumers (a gate-open notifier, a remote-settle producer) subscribe to unchanged.

**D4 — Read-only fs seam, type-limited like `analyze`.** The server's injected fs exposes only `readFile`/`readdir`/`stat`; a type-level test pins write members absent. The board has no write path to get wrong. Git is not consulted in V1.

**D5 — Change detection: a polling mtime sweep.** A short-interval sweep stats `runs/*/events.ndjson` + `state.json`, refolds changed runs, rebuilds the portfolio snapshot, and pushes it. `fs.watch` is the later optimization; polling is portable (macOS/Linux), torn-tail-safe by construction (the existing `readEvents` tolerance applies per read), and trivially testable as a pure "scan → changed run ids" function. Full refold per change is fine at corpus scale (hundreds of events/run); an incremental fold snapshot keyed by event count is the noted optimization for multi-year log growth — deliberately not built now (U7 fell for the runner; a viewer may add it freely later).

**D6 — SSE pushes full snapshots.** On connect: current snapshot. On change: the whole `PortfolioView` again (KBs at portfolio scale). No client-side patch/merge logic; the client re-renders. Alternatives (event-tail streaming with client-side fold) rejected for V1: they duplicate the fold in the browser for no measurable gain.

**D7 — Token auth, loopback default.** Every route requires a token (header or query). No token configured → random token generated at boot, printed once as the ready-to-open URL. Default bind is loopback; `--host` widens deliberately (LAN phone access). Alternatives rejected: no-auth-localhost-only (breaks phone access safely), cookie sessions (a login flow is weight the V1 board doesn't earn).

**D8 — Config ladder reuse.** `serve` is a config-consuming verb: `resolveRunnerConfig` decides the work dir (`--workDir`-free; file-declared `workDir` relocates bookkeeping and the board follows it), exactly like `start`/`status`/`runs`/`analyze`.

**D9 — Client is one static page.** Vanilla JS + `EventSource`, no framework, no build step; the server serves it from a static asset beside the serve module. The client holds no state beyond the token and the selected run.

## Scope-model & tool-surface impact

None: the board persists nothing — no DB rows, no drizzle migration, no storage/config-context ids, no platform/task instances, no chat tool surface, so no tool_prefs gating applies. It reads run artifacts from disk only.

## Risks / Trade-offs

- [LAN exposure leaks spend + finding content] → loopback default, explicit `--host`, token on every route; `bun security` on the serve module.
- [Long logs make full refold slow over years] → portfolio scale keeps it sub-second today; incremental fold is the pre-designed escape (D5).
- [Polling sweep misses nothing but lags by one interval] → interval short enough to feel live (≤2s); acceptable for glanceable supervision.
- [Mutation gate on new serve code] → the logic lives in the pure projection (D3); shells stay thin.
- [TDD hook pipeline] → all new files under `afk-runner/src/**` are write-hook gated; test-first order: projection → sweep → routes/auth → static page.

## Migration Plan

Additive verb; no data migration. Rollback: revert the commit; the verb disappears and no artifact was ever written by it.

## Open Questions

None blocking. Serve flag parsing is pinned by its own tests (the front-door doc pin covers `start` flags only).

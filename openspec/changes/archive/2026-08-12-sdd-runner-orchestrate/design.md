## Context

The `sdd-runner/` workspace (introduced by `auto-sdd-pipeline`) contains fully unit-tested stage modules — intake, draft, review-loop, decompose, atomicity, gate, materialize, renderer — each validated with injected fakes. What does not exist is the composition layer: `cli.ts` is a parser returning a `CliCommand` union and stopping; `index.ts` is `export {}`; `saveRunState` is never called in `src/`; the L1 lifecycle events (`spawned`/`killed`/`done`+usage) are defined in `events.ts` but never emitted by any module; no `report` module exists; and a structural seam mismatch between `runAgent`'s outputPath contract and sdd-runner's persistence model would trip the diff guard on the first live agent run. See `proposal.md` — Why. The `sdd-automation` capability spec (delta-`ADDED` by `auto-sdd-pipeline`, design decisions D1–D18) already specifies all behavior; this design covers _how_ the wiring fulfills it, not new behavior.

## Goals / Non-Goals

**Goals:**

- A single orchestrator that sequences the stages against real deps, persists run state, and drives resume.
- One event-pump feeding both the `events.ndjson` persistence and the live renderer, covering all three altitudes.
- L1 lifecycle emission owned where the lifecycle is observed (the agent layer).
- The F1 outputPath seam fixed on the sdd-runner side, `review-loop` untouched.
- `report` synthesizing from the three D17 sources at report time.
- Composition correctness verified with fake-spawn tests, no live LLM required to land.

**Non-Goals:** (restating only design-level boundaries — see proposal for scope)

- No live dogfood; no attempt to make fake-spawn tests prove live compatibility (the owner runs that separately).
- No fix to the latent concurrent-run scratch collision (F2 — `.review-loop/` scratch is repo-root-relative under the no-worktree choice D18); single-run only.
- No full-screen TUI; the renderer keeps the cursor-block approach it already has.

## Decisions

### O1: Orchestrator owns sequencing and state; stage modules stay DI-pure

A new `orchestrator.ts` constructs the `OpenSpecDriver`, `AgentLayerDeps` (with `realSpawn`, real `execGit`), the event bus (O2), and the renderer; then calls `runIntake` → `runDraft` → `runReviewLoop` → `runDecompose` → `runAtomicity` → `presentGate`/`resumeGate` in order, persisting `RunState` (`saveRunState`) at each stage boundary and on halt. `stage-machine.ts` stays a thin enter/exit emitter — it is not promoted into a scheduler. _Alternative rejected:_ a state-table-driven executor — the stage functions already encapsulate their own retry/halt (`StageHaltError`), so a scheduler would duplicate that control flow.

### O2: Event subscription bus — one emit point, persist and render subscribe

The orchestrator owns an `emit(event)` function. `appendEvent(logPath, …)` becomes a _subscriber_ wired by the orchestrator; `renderer.render(event)` is a second subscriber. Stage-module deps change from `logPath` + direct `appendEvent` calls to a single `emit`. This unifies L2 (stage modules), L1 (agent-layer, O3), and L0 (opencode stdout lines forwarded through `line-handler`) at one pump. _Alternatives rejected:_ (a) tee inside `appendEvent` — couples the persistence primitive to rendering and forces every caller through it; (b) tailing `events.ndjson` from disk — adds latency and a crash window between write and render. The bus keeps persistence and rendering as siblings with no ordering dependency between them.

### O3: L1 emission lives in the agent layer

`agent-layer.ts` already observes spawn, retry (via `onRetryEvent`), and completion+usage (`AgentRunInfo.usage` from `runAgent`). It emits `spawned` before invoking `runAgent`, `retrying` (stall|validation) from the existing retry callback, and `done`+usage after a successful parse — these L1 variants exist in the schema but are currently never produced. _Alternative rejected:_ a composition-layer wrapper around `runStageAgent` — it would have to re-derive retry reason and usage the agent layer already holds.

### O4: F1 seam fix — absolute outputPath into sidecarDir; drop the duplicate persist

`runAgent` does `copyFile(agentFile, options.outputPath)` then reads it back. sdd-runner today passes a relative basename (`'depth.json'`) as `outputPath`, so the copy resolves against process cwd (repo root) and leaves a stray untracked file outside `openspec/changes/` — the diff guard (`agent-layer.ts:114`) flags it on the first agent run. Fix: pass `path.join(sidecarDir, basename)` (absolute) as `outputPath`; `runAgent` copies there and reads from there; the separate `persistSidecar` is deleted as redundant. The agent is still _prompted_ to write to `agentWritePath(cwd, basename)` (`<repoRoot>/.review-loop/<file>`, gitignored) — only the runner's copy target changes. `review-loop/src/*` untouched (D14). _Alternative rejected:_ a "no-copy" mode on `runAgent` — centralizes the fix but edits review-loop, breaking D14.

### O5: `report` reads three sources at report time (D17), pure over injected deps

`report.ts` exposes `buildReport({ readEvents, readChangeDir, execGit, runId, changeName, branch, pr })` → string. It reduces `events.ndjson` (replay for rounds/findings/convergence/gate trajectory/depth), reads the change folder (artifact existence + `tasks.md` checkbox state), and runs `git log <branch>` (per-section commits, verify presence). Honesty-by-construction: the body states what scrutiny did and did _not_ happen (e.g. "skeptic lens: not run — M profile"). _Alternative rejected:_ accumulating report data during the run — D17 deliberately chose read-at-report-time so resume and post-hoc reports share one code path.

### O6: Cost/duration aggregation is a pure reducer over L1 events

A small pure helper (in `events.ts` or a sibling) reduces the `done`+usage events into `{ inputTokens, outputTokens, reasoningTokens, costUsd, wallMs }` totals. The gate digest (`GateDigestInput`) and `report` both consume the same aggregate. No separate persistence path — the ndjson log is the single source.

### O7: `driftCheck` wired to a one-off resolver pass

`gate.ts` already calls `deps.driftCheck(editedFiles)` when specs/design changed. The orchestrator constructs that callback as a single `runStageAgent` invocation with role `resolver`, prompt scoped to reconciling `tasks.md` against the edited artifacts. Reuses the existing resolver seam; no new agent kind.

### O8: `--wait` blocks on stdin after presenting the gate

After `presentGate`, if `--wait` was passed, the orchestrator prints the digest and blocks reading stdin until EOF (the human edits `gate-<n>.md` in another shell and sends a line / Ctrl-D), then calls `resumeGate` inline in the same process. Without `--wait` it writes the file, prints the `gate resume <runId>` command, and exits — matching the spec's exit-and-resume scenario.

## Risks / Trade-offs

- **Live-only failures invisible to fake-spawn tests** (opencode stdout line format for L0, real provider timing against the inactivity watchdog, real `openspec` JSON shapes vs the driver's zod) → accepted: composition correctness is verified in-change; live compatibility is owner-verified separately. An env-gated `SDD_LIVE_SMOKE` smoke test is deferred, not excluded.
- **`emit`-dep refactor churn** across stage modules and their existing tests → mitigated by doing it test-first, one module at a time; the change is mechanical (assert `emit` called instead of file written).
- **L0 line-format coupling** to `opencode run --format json` stdout → L0 is debug-verbosity only; L1/L2 do not depend on L0 parsing, so a shape drift degrades only the noisiest view.
- **F2 latent (out of scope):** `.review-loop/<file>` scratch is repo-root-relative and shared across concurrent runs under the D18 no-worktree choice → documented; single-run dogfood does not exercise it.

## Migration Plan

Additive within `sdd-runner/`: new `orchestrator.ts`, `report.ts`, and the usage-aggregate helper; edited `cli.ts` (main), `index.ts` (entry), `agent-layer.ts` (L1 emit + O4), and stage modules (emit dep). Rollback = revert the additions and the emit-dep refactor; stage modules return to direct `appendEvent`. No DB, no runtime dependency, no papai surface touched. The change rides the same branch/PR as its `tasks.md` per apply guidance; archive is post-merge.

## Open Questions

None blocking. F2 (concurrent-scratch) is a documented out-of-scope limitation, not a deferrable unknown.

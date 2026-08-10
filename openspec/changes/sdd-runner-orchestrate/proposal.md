## Why

The `sdd-runner/` workspace ships unit-tested stage modules (intake, draft, review-loop, decompose, atomicity, gate, materialize, renderer) but no composition layer: `cli.ts` is an argument parser, `index.ts` is `export {}`, and `saveRunState`/L1 events/`report` are never called or emitted in `src/`. The `auto-sdd-pipeline` change deferred this wiring as tasks 8.4/8.5 — so the `sdd-automation` capability is fully specified and fully unit-tested in isolation with injected fakes, but has never actually run. This change closes that gap.

## What Changes

- **Orchestration module** (`sdd-runner/src/orchestrator.ts`): `runStart` / `runResume` / `runGateResume` sequencing intake → draft → review → decompose → atomicity → gate, wiring real deps (`realSpawn` from `review-loop/src/spawn.ts`, real git/shell exec) and persisting run state at stage transitions.
- **CLI dispatch**: `cli.ts` gains a `main()` that routes `parseCliArgs` output to the orchestrator; `index.ts` becomes the entry. Implements `--wait` stdin blocking on gate present.
- **Event subscription bus**: one `emit` point; `appendEvent` (persist → `events.ndjson`) and `renderer.render` subscribe. Unifies L0 (opencode stdout via `line-handler`), L1 (agent-layer), L2 (stage modules) at a single pump. Stage module deps move from direct `logPath`/`appendEvent` to `emit`.
- **L1 lifecycle emission**: `agent-layer.ts` emits `spawned` / `done`+usage (and `retrying` already wired) — the events exist in the schema but are never emitted today.
- **`runReport` module** (`sdd-runner/src/report.ts`): synthesize `report` / `--pr` body from `events.ndjson` + change folder + branch git log (design D17 of `auto-sdd-pipeline`).
- **F1 seam fix**: pass an absolute `outputPath` into `sidecarDir` so `runAgent`'s `copyFile` lands where sdd-runner wants it; delete the redundant `persistSidecar`. Today the relative basename copies to a stray `<repoRoot>/<file>` outside `openspec/changes/`, tripping the diff guard on the first live agent run. sdd-runner-side only; `review-loop` stays read-only per D14.
- **Cost/duration aggregation** over L1 usage events for the gate digest and `report`; **drift-check** callback wired to a one-off resolver pass.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The `sdd-automation` capability — delta-`ADDED` by `openspec/changes/auto-sdd-pipeline/specs/sdd-automation/spec.md` (not yet archived to `openspec/specs/`) — fully specifies the behavior. This change is implementation fulfillment and adds no spec-level requirements; `.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- No live-LLM dogfood run — manual, owner-run after wiring lands; not captured as a task.
- No new spec-level behavior; no edits to `review-loop/` or `mutation-improve/` (D14 read-only reuse).
- No papai runtime impact: no platform/task instances, no `tool_prefs`/capability gating, no scope-model effect. Run state stays gitignored under `.sdd-runner/`.

## Impact

- `sdd-runner/src/` (new `orchestrator.ts`, `report.ts`; `cli.ts`/`index.ts`/`agent-layer.ts`/stage modules edited); `tests/sdd-runner/**` (orchestrator + report tests with fake spawn; existing suites updated for the `emit` dep).
- `docs/architecture/sdd-pipeline.md` (minor note: wiring landed).
- No runtime dependencies beyond workspace-shared `zod`. No DB migrations. Affected platform/task instances: none. Config-context scope impact: none.

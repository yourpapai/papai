## Why

`sdd-runner`'s renderer is **append-only by design** (`sdd-runner/src/renderer.ts:93-103`). Every event writes one final line; nothing redraws in place. During a multi-minute agent spawn the operator sees exactly two lines — `<agent> spawned` then `<agent> done` — and silence in between. There is no live tool-call trace, no token/cost accumulator, no elapsed-time status line, no in-round aggregation. `review-loop` has a full dynamic-TUI engine (`review-loop/src/live-renderer.ts:58-249`: slots, status line, `setInterval` ticks, ANSI cursor primitives, EPIPE downgrade) that sdd-runner reuses **none of**.

The structural reason is the seam at `sdd-runner/src/agent-layer.ts:140-155`: the `runAgent({...})` call from `review-loop/src/agent-runner.ts` accepts an optional `reporter?: ProgressReporter` (`review-loop/src/agent-runner.ts:71`) that receives every `tool_use`, every token delta, every step finish from the opencode subprocess (dispatched by `review-loop/src/line-handler.ts:78-107`). Sdd-runner passes `onRetry` but **does not pass `reporter`**. The data needed to render live progress is being collected and thrown away — it lands only in per-agent log files.

Meanwhile `sdd-runner/src/events.ts:38-56` already defines `ToolUseEvent` and `StepFinishEvent` at altitude `L0`, and `sdd-runner/src/renderer.ts:71-72` already has handlers for both — but **no code in `sdd-runner/src` ever emits them**. The event model is ready; the wiring isn't.

Two aggravating factors surface in `sdd-runner`'s recent history:

1. `--verbosity` is parsed (`cli.ts:68-72`) but silently discarded — `index.ts:98` hardcodes `'normal'`, so `brief`/`debug` are unreachable through the CLI. Even if L0 telemetry were emitted, the renderer's altitude filter (`renderer.ts:52-56`) couldn't be raised to show it.
2. The dormant `renderGateScreen` and `--wait` flag were **deliberately pruned** in commit `fe3498040` ("placed for a live-watching TUI future that didn't ship") with the note: *"Re-adding them together when a real consumer materializes (most likely `/sdd:auto`) is cheaper than maintaining the dormant surface."* The consumer has now materialized — the operator running `bun run sdd-runner:start` is that consumer.

## What Changes

- **Reporter adapter** (`sdd-runner/src/agent-reporter.ts`): a `ProgressReporter` implementation that translates `review-loop` reporter calls into sdd-runner event-bus emissions. `slot()` parses the tool-call line and emits `tool_use`; `usage()` emits `step_finish` with the token + cost delta; `event()` is bridged so per-tool messages still surface. Other reporter methods (`live`, `clearLive`, `diff`, `issue`) are no-ops — sdd-runner's renderer drives its own slot block from the event bus, not from the reporter's slot imperative.
- **Wire the adapter** at `agent-layer.ts:140`: construct the reporter per `runStageAgent` call (label-scoped) and pass it as `reporter` in the `runAgent({...})` options. This single change unlocks every downstream rendering improvement.
- **Thread verbosity end-to-end**: parse → `StartOptions.verbosity` → `OrchestratorDeps` → `createRenderer`. `--verbosity debug` finally reaches the renderer's altitude filter.
- **Dynamic renderer** (`sdd-runner/src/live-renderer.ts`): a TTY-aware renderer that picks between an append-only `LineRenderer` (current behavior, non-TTY / `--verbosity brief`) and a new `DynamicRenderer` (TTY, `normal`/`debug`). The dynamic renderer redraws a fixed-position block: pipeline map (top — finally exercises the dormant `renderPipelineMap`), current agent slot (middle — driven by new L0 `tool_use` events), status line (bottom — stage, round, tokens, cost accumulator, elapsed). It reuses the ANSI cursor-block mechanic from `review-loop/src/live-renderer.ts` (`writeBlock`/`clearBlock`/`writeSafe`/`fit` shape), inlined into `sdd-runner` rather than imported cross-workspace.
- **Render usage on `DoneEvent`** (`renderer.ts:76`): show `${agent} done · in ${inputTokens} out ${outputTokens} · $${costUsd.toFixed(4)}` instead of bare `${agent} done`. Today the field is collected and dropped.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sdd-automation` (currently delta-ADDED by `openspec/changes/auto-sdd-pipeline/specs/sdd-automation/spec.md`, **not yet archived to `openspec/specs/`**): this change's `.openspec.yaml` sets `skip_specs: true` because the capability is not yet in `openspec/specs/`. The spec already requires "live progress" semantics for `/sdd:auto` — this change implements the sdd-runner half of that requirement. No spec text changes.

## Non-goals

- **No new shared workspace.** `shared-tui-renderer` (`openspec/changes/shared-tui-renderer/`, currently `no-tasks`) proposes extracting the shared `RendererStream` + ANSI primitives + `MIDDLE_DOT` constant into a `tui-renderer/` workspace. That refactor is orthogonal and explicitly forbade dynamic-block rendering in sdd-runner (`shared-tui-renderer/design.md:31`). This change duplicates ~30 lines of ANSI mechanic into `sdd-runner/src/live-renderer.ts` and leaves the consolidation to `shared-tui-renderer` whenever it lands. Accepting the duplication is cheaper than blocking on a stuck proposal.
- **No `--wait` re-introduction.** The deleted `--wait` mode (interactive gate editor) was a separate concern from progress rendering. It stays deleted.
- **No papai chat integration.** `/sdd:auto` remains an editor-side slash command (`.claude/commands/sdd-auto.md`, `.opencode/commands/sdd-auto.md`) shelling out to `bun run sdd-runner:start`. No papai runtime surface.
- **No changes to event-log shape.** `events.ndjson` gains L0 rows (already schema-valid per `SddEventSchema`); no migration. Replay (`replay.ts`) continues to ignore L0 events for `ReplayState` derivation — they're display-only.
- **No third-party TUI deps.** Pure TypeScript + ANSI escapes, matching `review-loop`'s policy.
- **No `budgetUsd` enforcement.** That's a separate gap (the field is parsed but never compared). This change surfaces cost in the status line; enforcing a halt-on-budget is out of scope.

## Impact

- **Code**:
  - `sdd-runner/src/agent-layer.ts` (construct + pass reporter at `runAgent` call),
  - `sdd-runner/src/agent-reporter.ts` (new — adapter),
  - `sdd-runner/src/renderer.ts` (split into `LineRenderer` + `DynamicRenderer` behind a `createRenderer(stream, verbosity, opts?)` picker; render usage on `done`),
  - `sdd-runner/src/live-renderer.ts` (new — dynamic block engine, inlined ANSI primitives),
  - `sdd-runner/src/index.ts` (thread verbosity, pick renderer based on TTY + verbosity),
  - `sdd-runner/src/cli.ts` (no change — already parses verbosity),
  - `sdd-runner/src/orchestrator.ts` (`StartOptions` gains `verbosity?`, threaded to harness).
- **Tests**:
  - `tests/sdd-runner/agent-reporter.test.ts` (new — adapter unit tests: slot→tool_use, usage→step_finish, no-ops),
  - `tests/sdd-runner/renderer.test.ts` (extend — line/dynamic picker, usage rendering, dynamic-block output assertions against an in-memory stream),
  - `tests/sdd-runner/agent-layer.test.ts` (extend — assert reporter is constructed and passed for every spawn; the mock spawn already writes to the agent's scratch path, no change needed there),
  - `tests/sdd-runner/orchestrator.test.ts` (extend — verbosity threads through `StartOptions`).
- **Docs**: `docs/architecture/sdd-pipeline.md` (note live rendering, verbosity modes, and the dynamic-vs-line picker).
- **Spec**: no change — the `sdd-automation` spec already requires live progress for `/sdd:auto`; this implements the sdd-runner half.
- **Affected platform/task instances**: none. **Config-context scope impact**: none.

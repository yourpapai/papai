## Context

See proposal.md — Why. Current state, established by tracing the cost data flow:

- `DynamicRenderer.track()` (`sdd-runner/src/live-renderer.ts:86-106`) accumulates the footer totals from raw event payloads only: `step_finish.costUsd` (opencode's own metering, 0 for unmetered models) **and** `done.usage.costUsd` — the latter being the sum of the former's deltas (`review-loop/src/line-handler.ts:72-75`), so both tokens and cost are double-counted for metered models today.
- The models.dev fallback resolver (`pricing.ts: resolveCost/loadDb`, wrapped as `buildResolveCost()` in `gate-digest.ts:229-236`) is only consumed by `presentGateAt`. `createRenderer(stream, verbosity, opts?)` (`renderer.ts:144`) has no pricing input.
- `step_finish` events carry no `model` field (`events.ts:46-56`); the agent→model association is recoverable from `spawned` events, the same approach `repriceEvents` uses (`usage-aggregate.ts:29-32`). `spawned` is always emitted before the agent's first `step_finish` (`agent-layer.ts:139` precedes `runAgent`).
- `buildHarness` (`index.ts:95`) is already async and constructs the renderer; `buildResolveCost()` already degrades to `() => null` on fetch/parse failure.

## Goals / Non-Goals

**Goals:**

- Live footer shows a cost figure for unmetered models when the pricing DB can resolve the model (primary or median fallback).
- Estimated figures are visually distinguishable from metered ones.
- Live totals count each token/dollar exactly once.
- Zero change to persisted events, gate digest, or LineRenderer output bytes.

**Non-Goals:**

- Emit-time repricing or event-schema changes (display-time only).
- Repricing the LineRenderer `done` line (it prints the raw metered `usage.costUsd`; the gate digest already reports the fallback-priced aggregate).
- Surfacing `cache_read`/`cache_write` pricing (consistent with `sdd-runner-cost-fallback`).

## Decisions

### D1 — Estimate at display time, not emit time

The resolver is injected into the renderer; `events.ndjson` keeps raw metered values. Alternative considered: reprice inside `agent-reporter`/`agent-layer` at emission. Rejected because (a) emission is synchronous while the DB load is async, pushing pricing knowledge into the agent layer; (b) persisted events would become indistinguishable from metered ones, collapsing the gate's `metered|estimated|unknown` marker to always-`metered` — a real information loss. Display-time estimation composes with the gate's aggregate-time reprice: same formula, same resolver, independent layers.

### D2 — Accumulate totals from `step_finish` only; `done` clears the slot

`track()` drops the `done` branch's totals accumulation (keeping `slots.delete`). This fixes the double-count and is what makes per-step estimation coherent: each delta is priced once, as it arrives. The alternative — accumulate from `done` only — would freeze the footer at zero for the entire duration of a long agent run, defeating the live display.

### D3 — Per-step estimation with a `spawned`-event agent→model map

`DynamicRenderer` keeps `agentModels: Map<string, string>` populated on `spawned`. On `step_finish` with `costUsd === 0` and any token field > 0, it resolves the model and computes `((input + reasoning) * cost.input + output * cost.output) / 1_000_000` — the exact `repriceEvent` formula, so live and gate figures agree. Unresolvable model or `resolveCost → null` contributes 0 (segment hidden, today's behavior). Alternative considered: adding `model` to the `step_finish` event schema (the data exists in `UsageDelta`). Rejected as an event-schema change for a display concern; the spawned-event map already carries the association and is replay-safe.

### D4 — `~$` marker, tracked as a sticky flag

The renderer records `costEstimated = true` the first time any estimate contributes to the total. `statusLine()` renders `~$X.XXXX` when the flag is set, `$X.XXXX` otherwise. A run mixing metered and estimated agents shows `~$` — conservative, matches the gate's tristate collapsing to `estimated`. Alternative considered: per-agent markers. Rejected — the footer is a single aggregate line; per-agent provenance is available in `events.ndjson`.

### D5 — Resolver threaded through `createRenderer` options

`RendererOptions` gains `resolveCost?: ResolveCostFn`; `createRenderer` passes it to `DynamicRenderer` only (LineRenderer output is byte-frozen). `buildHarness` calls `await buildResolveCost()` once and passes it in. One DB load per CLI invocation, shared with no one — the gate path keeps calling `buildResolveCost()` itself (cache TTL makes the second load a disk read). Alternative considered: sharing one resolver between renderer and gate via `OrchestratorDeps.resolveCost`. Rejected — `OrchestratorDeps.resolveCost` is a test seam for the gate; coupling the renderer's lifetime to it buys nothing.

## Risks / Trade-offs

- [Stale or missing pricing DB shows no cost, looking like a regression for metered-leaning users] → Degradation is identical to today's behavior (segment hidden); `buildResolveCost` already swallows fetch failures.
- [Median-fallback prices can over/understate the subscription model's true cost] → Inherent to the fallback accepted in `sdd-runner-cost-fallback`; the `~$` marker signals estimate status live, mirroring the gate's `estimated` marker.
- [Footer width grows with the new segment on narrow terminals] → Existing `fit()` truncation already caps every rendered line at `stream.columns`.

## Migration Plan

Pure dev-tooling change; no data migration. Old `events.ndjson` logs replay identically (renderer state derives from the same event stream). Rollback is a revert; no persisted state depends on the new code.

## Hook/TDD interactions

All edited files (`sdd-runner/src/live-renderer.ts`, `renderer.ts`, `index.ts`) are gateable implementation code mapped to `tests/sdd-runner/` by the TDD hook pipeline — test-first order: extend `tests/sdd-runner/live-renderer.test.ts` and `tests/sdd-runner/renderer.test.ts` with failing cases before touching `src/`. `oxlint` has `max-lines`/`max-lines-per-function` disabled repo-wide, so no line-budget pressure, but keep the new logic in small private methods per house style.

## Scope-model / gating impact

No new tool surface, no capability gating, no `tool_prefs` interaction. No persisted state keyed by any context id — the only state is in-memory renderer fields for the duration of the CLI process. No DB changes. No new dependencies (the pricing DB fetch already exists in `pricing.ts`).

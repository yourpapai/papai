## Why

`sdd-runner`'s live status line never shows a cost figure for unmetered models. On a `zai-coding-plan/glm-5.2` run the footer reads `in 47.1k / out 1.4k · 2m53s` with no `$` segment, even though the models.dev median-fallback pricing shipped in `sdd-runner-cost-fallback` would produce a non-zero estimate. Root cause: the fallback `ResolveCostFn` is wired only into the gate path (`presentGateAt` → `buildResolveCost` → `aggregateUsage`); the `DynamicRenderer` accumulates cost purely from raw event payloads, which are `costUsd: 0` when opencode doesn't meter the model, and `statusLine()` hides the segment when the total is zero. While tracing this we also found the live totals double-count: `track()` adds both per-step `step_finish` deltas and the cumulative `done.usage` (which is the sum of those same deltas), inflating tokens and cost for metered models.

## What Changes

- **Live cost estimate**: `DynamicRenderer` gains an optional `ResolveCostFn`. Per `step_finish` with `costUsd === 0` and tokens > 0, it estimates cost from the pricing DB using the agent→model map built from `spawned` events (same mapping `repriceEvents` uses), with the same formula as `repriceEvent`. The status line renders estimated cost with a `~$` prefix; metered cost keeps the plain `$` prefix.
- **Double-count fix**: live token/cost totals accumulate from `step_finish` deltas only; the `done` event stops contributing to totals (it still clears the agent slot). `done.usage` remains the authoritative per-agent figure for the LineRenderer `done` line and the gate aggregate.
- **Wiring**: `buildHarness` (already async) loads the pricing DB once via `buildResolveCost()` and threads the resolver through `createRenderer` into `DynamicRenderer`; on fetch failure the resolver degrades to `() => null` and the status line falls back to today's behavior (cost segment hidden).
- Events on disk stay raw (metered truth): no event-schema change, no emit-time repricing, gate digest semantics (`metered|estimated|unknown`) untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sdd-automation` (delta-ADDED by `openspec/changes/auto-sdd-pipeline/specs/sdd-automation/spec.md`, not yet archived to `openspec/specs/`): `skip_specs: true` per the precedent set by `sdd-runner-cost-fallback` and `sdd-veto-resolver-pass`. No event-schema or gate-protocol change; the live footer is a rendering concern below the spec's altitude contract.

## Non-goals

- No repricing of persisted events — `events.ndjson` keeps opencode-metered values; estimation is display-time only.
- No change to the LineRenderer `done` line format or the gate digest cost line.
- No cache_read/cache_write token pricing (unchanged from `sdd-runner-cost-fallback`).
- No effect on platform/task instances, the scope model, `tool_prefs`, or capability gating. Runner-internal dev tool.

## Impact

- **Code**: `sdd-runner/src/live-renderer.ts` (resolver dep, agent→model map, per-step estimate, `~$` marker, drop `done` from totals), `sdd-runner/src/renderer.ts` (`createRenderer` options gain `resolveCost`), `sdd-runner/src/index.ts` (`buildHarness` loads DB once and passes resolver).
- **Tests**: `tests/sdd-runner/live-renderer.test.ts` (estimated-cost cases: fallback used, metered untouched, resolver null → hidden, double-count regression), `tests/sdd-runner/renderer.test.ts` (option threading).
- **Docs**: `docs/architecture/sdd-pipeline.md` — note the live footer's estimated-cost segment.
- **Affected platform/task instances**: none. **Config-context scope impact**: none — runner-internal dev tool.

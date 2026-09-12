# Proposal: cached-token-accounting

## Why

opencode's `step_finish` event reports `tokens.input` as **uncached input only**; cache hits arrive in a sibling `tokens.cache: { read, write }` object that review-loop's event parser drops entirely (`review-loop/src/event-stream.ts:26`). In long SDD conversations ~95% of input tokens are cache reads (measured: 18.2M of 19.2M in one run), so every displayed `in N` figure, persisted `metrics.json` total, and per-token cost estimate undercounts real usage by an order of magnitude or more. The provider's own meter disagrees with the runner's, making budget decisions (`budgetUsd`) and run comparisons untrustworthy.

## What Changes

- Parse `tokens.cache.read` / `tokens.cache.write` from opencode `step_finish` events; keep `input` as uncached input (that is what opencode reports — no re-adding cached into it).
- Track cached tokens as **separate counters** end-to-end: `AgentUsage` (review-loop and sdd-runner event schema) gains `cachedReadTokens` / `cachedWriteTokens`; `input` stays uncached; nothing is summed into anything else.
- Thread the new counters through the whole data flow: `UsageDelta` (progress-log), sdd-runner `step_finish` L0 events + `done` usage, `RunStats`/`LabelStats`/persisted `metrics.json` (backward-compatible: new fields default 0, old files rehydrate), `aggregateUsage`/`repriceEvents`.
- Display: live lines and summaries render cached reads as their own segment (e.g. `in 1.0M · cached 18.2M / out 456k`); segments hidden when zero, per house convention.
- Cost estimation prices cached tokens with their own rates: `PriceEntry` and the models.dev resolver already model `cache_read`/`cache_write` (`sdd-runner/src/pricing.ts:30-34`) — wire them into `estimateCostUsd`, `repriceEvent`, the live-footer estimator, and the config `pricing` map (optional fields). Absent cache prices ⇒ cached tokens contribute 0 to estimates (never silently billed at full input rate).
- Old `events.ndjson` and `metrics.json` replay/rehydrate unchanged (missing fields read as 0).

Not in scope: changing opencode itself, metered-cost correction (`costUsd` from opencode is passed through untouched), the truncation-loop retry behavior from the skeptic-r3 failure (separate issue).

## Capabilities

None — dev-tooling accounting surface. Follows the `skip_specs: true` precedent of the two changes that own the adjacent behavior (`sdd-runner-cost-fallback`, `sdd-runner-live-cost-estimate`, both `skip_specs`). The only specced touchpoint, `sdd-automation`'s "L0 token/cost deltas" event-log requirement, is not altered semantically: the deltas remain token/cost deltas, now carrying two more nonnegative fields.

## Impact

- `review-loop/src/`: `event-stream.ts`, `line-handler.ts`, `agent-runner.ts` (AgentUsage), `progress-log.ts` (UsageDelta), `run-stats.ts`, `cost.ts`, `live-format.ts`, `summary.ts`, `trace-log.ts`/`loop-trace.ts` (usage pass-through), `config.example.json` (document optional cache prices).
- `sdd-runner/src/`: `events.ts` (AgentUsageSchema, StepFinishEvent), `agent-reporter.ts`, `usage-aggregate.ts` (formula), `live-renderer.ts` (footer totals + estimator), `renderer.ts` (done line), `pricing.ts` (pass-through only).
- `mutation-improve/`: consumes `runAgent`/`AgentUsage`; additive fields only, no behavior change expected beyond richer totals.
- Tests: `tests/review-loop/**`, `tests/sdd-runner/**` (TDD hook maps these paths).
- Persisted artifacts: `metrics.json` and `events.ndjson` gain optional fields; readers are schema-tolerant (`.default(0)`), so old runs replay fine and new runs read as 0 on old code.

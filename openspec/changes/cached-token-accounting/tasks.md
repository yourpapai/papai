# Tasks: cached-token-accounting

## 1. Event boundary (review-loop)

- [x] 1.1 Failing tests in `tests/review-loop/event-stream.test.ts`: `parseEventLine` on a real opencode `step_finish` line with `tokens.cache: { read: 8320, write: 0 }` yields `tokens.cacheRead = 8320`, `tokens.cacheWrite = 0`; absent `cache` object ⇒ both 0; malformed cache values ⇒ 0. Then extend `OpencodeEvent.step_finish.tokens` and `parseStepFinish` in `review-loop/src/event-stream.ts` to pass.

## 2. Usage accumulation (review-loop)

- [x] 2.1 Failing tests in `tests/review-loop/line-handler.test.ts`: `applyStepFinish`/`createLineHandler` accumulate `cachedReadTokens`/`cachedWriteTokens` on `ctx.usage` separately from `inputTokens`; `UsageDelta` reported to `reporter.usage` carries `cacheRead`/`cacheWrite`. Then extend `AgentUsage` (`review-loop/src/agent-runner.ts`), `applyStepFinish` (`line-handler.ts`), and `UsageDelta` (`progress-log.ts`).
- [x] 2.2 Failing tests for `runAgent`/retry paths in `tests/review-loop/agent-runner.test.ts`: `AgentRunResult.usage` and `AgentRunError.usage` include the cache counters summed across attempts. Then thread the fields through `runAgent`'s `buildUsage` (no logic change expected beyond field carry).

## 3. Stats and persistence (review-loop)

- [x] 3.1 Failing tests in `tests/review-loop/run-stats.test.ts`: `addUsage` with cache deltas updates per-label and totals `cachedRead`/`cachedWrite`; `persist()`/`rehydrate()` round-trip the new fields; rehydrating a pre-change `metrics.json` (no cache fields) yields 0 without error. Then extend `UsageInput`, `LabelStats`, `LabelStatsSchema`, `PersistedStatsSchema` (`.default(0)`) in `review-loop/src/run-stats.ts`.
- [x] 3.2 Failing tests in `tests/review-loop/cost.test.ts`: `estimateCostUsd` with `cacheRead`/`cacheWrite` rates prices cached terms; absent rates contribute 0; `matchPrice` unaffected. Then extend `PriceEntrySchema` + `estimateCostUsd` in `review-loop/src/cost.ts`, and price cache deltas in `RunStats.addUsage`.

## 4. Rendering (review-loop)

- [x] 4.1 Failing tests in `tests/review-loop/live-format.test.ts`: `formatLiveLine` renders `in X · cached Y / out Z` when cached > 0; byte-identical to current output when cached = 0. Then extend `LiveUsage` + `formatLiveLine` in `review-loop/src/live-format.ts` and pass `cachedReadTokens` from `liveLine` in `line-handler.ts`.
- [x] 4.2 Failing tests in `tests/review-loop/summary.test.ts` (and trace/loop-trace usage pass-through if covered): summary token line includes `/ cached N` segment when > 0, omits when 0; aggregate carries `cachedReadTokens`. Then extend `review-loop/src/summary.ts` aggregate + token line, and `loop-trace.ts`/`trace-log.ts` usage records additively.

## 5. sdd-runner events and replay

- [x] 5.1 Failing tests in `tests/sdd-runner/events.test.ts`: `AgentUsageSchema` and `StepFinishEvent.tokens` accept `cachedReadTokens`/`cachedWriteTokens` (`.default(0)`); old event lines without the fields still validate. Then extend schemas in `sdd-runner/src/events.ts`.
- [x] 5.2 Failing tests in `tests/sdd-runner/agent-reporter.test.ts`: `UsageDelta` with cache fields emits an L0 `step_finish` event carrying them. Then extend `buildStepFinishEvent` in `sdd-runner/src/agent-reporter.ts`.

## 6. sdd-runner aggregation, pricing, display

- [x] 6.1 Failing tests in `tests/sdd-runner/usage-aggregate.test.ts`: `aggregateUsage` sums cache counters; `repriceEvent`/`repriceEvents` price `cacheRead`/`cacheWrite` when the resolved cost carries them and contribute 0 when absent (metered `costUsd > 0` untouched). Then extend formulas in `sdd-runner/src/usage-aggregate.ts` using `ResolvedCost.cache_read`/`cache_write` from `pricing.ts`.
- [x] 6.2 Failing tests in `tests/sdd-runner/live-renderer.test.ts` + `renderer.test.ts`: footer token totals include cached reads as a separate segment hidden when 0; `done` line renders cached when > 0; estimation formula matches D4 (footer and gate agree). Then extend `sdd-runner/src/live-renderer.ts` and `renderer.ts`.

## 7. Config docs and full verification

- [x] 7.1 Document optional `"cacheRead"`/`"cacheWrite"` keys in the `pricing` map in `review-loop/config.example.json` (comment/example only, no code).
- [x] 7.2 Run `bun run review-loop:test`, `bun run sdd-runner:test` (or repo equivalents), plus `review-loop`/`sdd-runner` typecheck+lint; fix fallout. Full `bun run test` + `bun check:full` before handoff.

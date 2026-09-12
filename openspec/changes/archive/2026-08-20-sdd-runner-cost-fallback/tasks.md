## 1. Pricing module (design D1 + D2)

- [x] 1.1 Failing test in `tests/sdd-runner/pricing.test.ts`: `parseModelId("zai-coding-plan/glm-5.2")` returns `{ providerID: "zai-coding-plan", modelID: "glm-5.2" }` (split on first `/`); `parseModelId("openai/gpt-5")` returns `{ providerID: "openai", modelID: "gpt-5" }`. Verify: `bun test tests/sdd-runner/pricing.test.ts` (fails)
- [x] 1.2 Failing test in `tests/sdd-runner/pricing.test.ts`: with a synthetic `db` fixture where `db["paid"].models["m"].cost = { input: 5, output: 15 }` and `db["sub"].models["m"].cost = { input: 0, output: 0 }` and 6 other providers with mixed non-zero costs, `resolveCost("paid/m")` returns the paid entry (PRIMARY); `resolveCost("sub/m")` returns the median across the 7 non-zero entries (FALLBACK); `resolveCost("unknown/m")` returns `null` (LAST RESORT). Verify: `bun test tests/sdd-runner/pricing.test.ts` (fails)
- [x] 1.3 Failing test in `tests/sdd-runner/pricing.test.ts`: `loadDb()` uses a seeded temp cache file when fresh (mTime within TTL → no fetch); calls `fetch` when mtime is stale; swallows fetch failure and falls back to stale cache. Verify: `bun test tests/sdd-runner/pricing.test.ts` (fails)
- [x] 1.4 Implement `sdd-runner/src/pricing.ts`: `parseModelId`, `resolveCost(modelId, db)`, `loadDb({ cachePath, now, fetchImpl })` (DI for testability per `tests/AGENTS.md`), Zod subset schema for the `cost` object only. Verify: `bun test tests/sdd-runner/pricing.test.ts`; `bun run typecheck`

## 2. Event schema extension (design D3)

- [x] 2.1 Failing test in `tests/sdd-runner/events.test.ts`: `EventInputSchema.parse({ altitude: 'L1', type: 'done', agent: 'reviewer-r1', model: 'zai-coding-plan/glm-5.2', usage: { ... } })` succeeds; `EventInputSchema.parse({ altitude: 'L1', type: 'done', agent: 'reviewer-r1', usage: { ... } })` (no model) also succeeds (backward compat). Verify: `bun test tests/sdd-runner/events.test.ts` (fails)
- [x] 2.2 Add `model: z.string().min(1).optional()` to `DoneEvent` in `sdd-runner/src/events.ts`; thread `model` into the emit at `sdd-runner/src/agent-layer.ts:162` from `runStageAgent`'s already-known `modelFor(config, options.role)` result. Verify: `bun test tests/sdd-runner/events.test.ts`; `bun run typecheck`

## 3. Reprice pass (design D4 + D5)

- [x] 3.1 Failing test in `tests/sdd-runner/usage-aggregate.test.ts`: `repriceEvent(doneEventWithZeroCost, { input: 5, output: 15 })` recomputes `costUsd` from token counts (input + output fields); `repriceEvent(doneEventWithNonZeroCost, ...)` returns the event unchanged (skips when already metered); `repriceEvent(doneEventWithZeroTokens, ...)` returns unchanged (no division by zero). Verify: `bun test tests/sdd-runner/usage-aggregate.test.ts` (fails)
- [x] 3.2 Failing test in `tests/sdd-runner/usage-aggregate.test.ts`: `repriceEvents(events)` walks events in order, builds `Map<agent, model>` from `spawned` events, backfills missing `model` on pre-change `done` events from the map, applies `repriceEvent` per `done`. Verify: `bun test tests/sdd-runner/usage-aggregate.test.ts` (fails)
- [x] 3.3 Failing test in `tests/sdd-runner/usage-aggregate.test.ts`: `aggregateUsage(events)` calls `repriceEvents` before reducing; returns `{ ..., costUsd: <repriced sum>, costKnown: true }` when every repriced event had a non-null resolveCost; `{ ..., costUsd: 0, costKnown: false }` when at least one event fell through to LAST RESORT. The `AgentUsage` type gains `costKnown: boolean`. Verify: `bun test tests/sdd-runner/usage-aggregate.test.ts` (fails)
- [x] 3.4 Implement `repriceEvent`, `repriceEvents`, and rewire `aggregateUsage` in `sdd-runner/src/usage-aggregate.ts`; thread `resolveCost` via a module-level lazy-load of `loadDb()` (or DI for tests). Verify: `bun test tests/sdd-runner/usage-aggregate.test.ts`; `bun run typecheck`

## 4. Gate digest cost marker (design D4)

- [x] 4.1 Failing test in `tests/sdd-runner/gate-digest.test.ts`: `writeGateDigest({ ..., costUsd: 1.23, costKnown: true, capHitFired: true })` renders `### Cost / duration · $1.23 · <walls>s · metered`; `costUsd: 1.23, costKnown: false` renders `· estimated`; `costUsd: 0, costKnown: false` renders `· unknown`. Verify: `bun test tests/sdd-runner/gate-digest.test.ts` (fails)
- [x] 4.2 Extend `GateDigestInput` (`sdd-runner/src/gate-model.ts`) with `costKnown: boolean`; update `writeGateDigest` to render the marker; thread `costKnown` from `aggregateUsage` through `presentGateAt` (`sdd-runner/src/gate-digest.ts`). Verify: `bun test tests/sdd-runner/gate-digest.test.ts`; `bun run typecheck`

## 5. Orchestrator smoke + docs

- [x] 5.1 Failing test in `tests/sdd-runner/orchestrator.test.ts`: with a mocked `loadDb` returning a fixture where `resolveCost("zai-coding-plan/glm-5.2")` is non-zero, an end-to-end `runStart` (or focused `presentGateAt`) over a `done`-event stream of `costUsd: 0` events produces a gate MD whose cost line shows a non-zero `$X.XX · estimated`. Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (fails)
- [x] 5.2 Implement the wiring (no new logic — confirm `presentGateAt` consumes `aggregateUsage`'s new return shape correctly). Verify: `bun test tests/sdd-runner/orchestrator.test.ts`; `bun run typecheck`
- [x] 5.3 Update `docs/architecture/sdd-pipeline.md` Event model section: note the `done.model` field, the aggregate-time reprice pass, the three marker states (`metered` / `estimated` / `unknown`), and the network-failure degradation behavior. Verify: manual read
- [x] 5.4 Full verification: `bun test`, `bun run typecheck`, `bun run lint`, `openspec validate sdd-runner-cost-fallback --strict`. Update any other affected `docs/architecture/*.md` pages surfaced by the run.

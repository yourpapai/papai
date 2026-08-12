## Context

See `proposal.md` — Why. The cost pipeline today:

```
   opencode run subprocess
     └─ Session.getUsage (in opencode) computes costUsd from the configured
        provider's ModelsDev entry
     └─ writes costUsd into the JSONL stream sdd-runner parses
   sdd-runner agent-runner.ts
     └─ parses each step_finish / done record into AgentUsage
        (inputTokens, outputTokens, reasoningTokens, costUsd, wallMs)
   sdd-runner agent-layer.ts:162
     └─ emits L1 'done' event with the usage payload
   sdd-runner usage-aggregate.ts
     └─ sums costUsd across all done events (pure addition, no recompute)
   sdd-runner gate-digest.ts
     └─ formats costUsd to 2dp and renders into gate-<n>.md
```

For `zai-coding-plan/glm-5.2`, `Session.getUsage` reads `db["zai-coding-plan"].models["glm-5.2"].cost = { input: 0, output: 0 }` (subscription provider on models.dev), so every `done` event has `costUsd: 0` regardless of token volume. The bug is upstream in the data, not in opencode's logic — it correctly applies the (zero) price.

`models.dev/api.json` returns `Record<providerID, { models: Record<modelID, { cost: { input, output, cache_read?, cache_write? } }> }>`. GLM-5.2 has 99 provider entries; many have non-zero costs. The median of non-zero entries gives a defensible fallback price.

Two existing precedents in the repo:

1. **opencode's `ModelsDev` namespace** (`~/Projects/opencode/packages/opencode/src/provider/models.ts`) does exactly this fetch-and-cache. We deliberately do not import from it — sdd-runner must remain self-contained (opencode's package is `"private": true`, not on npm, and sdd-runner is destined for separate open-sourcing).
2. **`gatherAssumptions`** in `gate-digest.ts:112-131` already reads sidecars into a `Map<id, T>` with last-write-wins semantics — same pattern the median computation will use, just aggregating numbers instead of structs.

## Goals / Non-Goals

**Goals:**

- G1. After this change, every gate digest shows a non-zero cost when at least one non-subscription provider in `models.dev` serves the configured model — without requiring any upstream fix in opencode.
- G2. The cost figure is honest about its source: a `costKnown` marker distinguishes "this came from the provider's meter" (trustworthy) from "this is a median-of-nonzero fallback estimate" (defensible but approximate).
- G3. The fix is local to sdd-runner. No new third-party deps, no workspace dep on opencode, no fork of `Session.getUsage`.
- G4. Existing event logs (pre-change) reprice correctly when re-aggregated — old `done` events lacking the new `model` field are backfilled from the agent→model map reconstructed by replaying `spawned` events.

**Non-Goals:**

- N1. No upstream opencode fix. `Session.getUsage` keeps its current behavior; aggregate-time reprice is a no-op when emit-time cost is already non-zero, so the two layers compose.
- N2. No pricing of `cache_read` / `cache_write` until sdd-runner emits them as separate token classes — today `reasoningTokens` is rolled into input-side cost as `(inputTokens + reasoningTokens) / 1M * input_cost`, which preserves the existing simplification.
- N3. No BYOK-style per-config-context price override. A future change can layer custom pricing on top of `resolveCost`.
- N4. No live repricing during the run — repricing happens at `aggregateUsage` time, which is called from `presentGateAt` and `buildReport`. The live renderer's status-line cost (which reads `done` events directly) continues to show emit-time cost; it is documented as "metered cost" not "estimated cost."
- N5. No enforcement of `RunnerConfig.budgetUsd`. Threading the budget cap into the review loop is independent.

## Decisions

### D1. Direct fetch + own cache, no opencode workspace dep

**Decision.** Hand-roll a `ModelsDev` namespace in `sdd-runner/src/pricing.ts`:

```
   fetch("https://metrics.dev/api.json")
     → Zod-parse a strict subset: { providers: Record<providerID, {
                                        models: Record<modelID, {
                                          cost: { input: number, output: number,
                                                  cache_read?: number, cache_write?: number } }> }> }
     → write to ~/.cache/sdd-runner/models.json
     → 60-min TTL via file mtime (mirrors opencode's interval)
   resolveCost(modelId):
     parseModelId("zai-coding-plan/glm-5.2") → { providerID, modelID }  // split on first /
     PRIMARY:    db[providerID].models[modelID].cost  if input > 0 OR output > 0
     FALLBACK:   collect db[*].models[modelID].cost across all providers
                 filter input > 0 OR output > 0
                 if empty, return null
                 return { input: median(inputs), output: median(outputs),
                          cache_read: median(nonzero cache_reads) | undefined,
                          cache_write: median(nonzero cache_writes) | undefined }
     LAST RESORT: null  (caller preserves current $0)
```

**Rationale.** Three reasons not to import opencode's `ModelsDev`:

1. opencode's package is `"private": true` — not on npm, only resolvable via `workspace:*` or relative path. sdd-runner is destined for separate open-sourcing; a workspace dep on a private neighbor breaks that.
2. opencode's `models.ts` is a thin file (~90 lines) — replicating the fetch+cache+schema is small.
3. Importing the schema alone still drags in `Global.Path.cache` and `Installation.USER_AGENT` via transitive imports. Self-contained is simpler than chasing the import boundary.

The fetch URL, cache path, and TTL mirror opencode's choices — that's deliberate, so a future "share the cache file" optimization is non-breaking.

**Alternatives considered.**

- *Import opencode's `ModelsDev` namespace via workspace path.* Rejected for the reasons above.
- *Read opencode's existing cache at `~/.cache/opencode/models.json`.* Tempting (zero fetch cost when opencode is installed and recently run), but creates a hidden coupling: a user who uninstalls opencode silently loses pricing. Explicit own-cache is honest.
- *Bundle the models.dev data at build time via a Bun macro.* Rejected: data goes stale; the 60-min runtime refresh is a feature, not a cost.

### D2. Algorithm: primary → median-of-nonzero → null

**Decision.** Three-tier resolution. PRIMARY wins if the configured provider has a non-zero price (covers all normal paid providers — OpenAI, Anthropic, etc.). FALLBACK computes median across all providers serving that modelID (covers subscription providers like glm-5.2). LAST RESORT returns `null` (covers a hypothetical model with zero non-zero entries anywhere — preserve current `$0` behavior, mark `costKnown: false`).

**Rationale.** Median (not mean) because provider entries include outliers (a provider offering GLM-5.2 at $50/M tokens as a "premium" tier would skew the mean absurdly). Median is robust to that.

The cache-read and cache-write fields are computed separately and only if at least one non-zero value exists; otherwise the field is omitted from the result. This matches models.dev's optionality.

**Alternatives considered.**

- *Mean instead of median.* Rejected — outlier-sensitive.
- *Min instead of median (lower-bound estimate).* Tempting (the human sees "at least this much") but conflates bargain providers with the typical price. Median is the better central-tendency signal.
- *Use only the canonical lab's entry (e.g. `db["zhipuai"].models["glm-5.2"]`).* Rejected: the lab's own entry is also often $0 (subscription) or stale; the median across all 99 providers is a strictly richer signal.

### D3. Schema extension: add `model` to the `done` event

**Decision.**

```diff
   const DoneEvent = z.object({
     altitude: z.literal('L1'),
     type: z.literal('done'),
     agent: z.string().min(1),
+    model: z.string().min(1).optional(),
     usage: AgentUsageSchema,
   })
```

`agent-layer.ts:162` threads the model from `runStageAgent`'s already-known `modelFor(config, options.role)` call into the emit.

**Rationale.** Two paths to reprice a `done` event:

- **Stateless (chosen)**: each `done` event carries its own `model`. The reprice pass is a pure map over events.
- **Stateful**: walk events in order, maintain `Map<agent, model>` populated by `spawned` events, look up per `done`. Works for old event logs but introduces order-dependence and a hidden join.

Schema optionality (`model: z.string().min(1).optional()`) gives both paths a home: new events always carry `model`; old events lack it and the aggregator falls back to the spawned-map. This is the same optionality pattern `DepthEvent` uses for `disagreement` (`events.ts:153`).

**Alternatives considered.**

- *Make `model` required and migrate old event logs.* Rejected: old runs are gitignored per-run state; migrating them is busywork. Optional + backfill is cleaner.
- *Add `model` to `step_finish` too.* Rejected for now — `step_finish` events accumulate into the same `done` cost; repricing at `done` granularity is sufficient. If we later want per-step cost (e.g. for the live status line), `step_finish` can gain `model` in a follow-up.

### D4. Reprice at aggregate time, not at emit time

**Decision.** `usage-aggregate.ts` gains:

```
   repriceEvent(event, cost): SddEvent     // returns event with costUsd recomputed
                                          // only when event.costUsd === 0 && tokens > 0
   repriceEvents(events): events          // builds spawned-map, applies repriceEvent per done
   aggregateUsage(events): AgentUsage     // calls repriceEvents, then reduces as today
```

Emit-time cost stays as-is (zero for subscription providers). Aggregate-time reprice is the trust boundary. The `gate-digest.ts` `costUsd` field already flows from `aggregateUsage`; one wiring change at `gate-digest.ts:97` adds the `costKnown` marker.

`costKnown` is true when every repriced event had a non-null `resolveCost` result; false when at least one event fell through to LAST RESORT. The gate MD renders `· $0.00 · 2607s · unknown` in the false case, `· $1.23 · 2607s · estimated` when fallback-fired, and `· $1.23 · 2607s · metered` when emit-time cost was already non-zero.

**Rationale.** Three reasons not to reprice at emit:

1. The emit path is in the agent spawn loop (hot path); adding a network-or-cache lookup there risks latency on every agent done.
2. Live repricing would require the pricing module to be loaded at harness construction, complicating test isolation.
3. The aggregate-time boundary already exists; re-using it keeps the change small.

**Alternatives considered.**

- *Reprice at emit time.* Rejected for the reasons above.
- *Reprice in a new `report <runId>` post-process pass only (not in `aggregateUsage`).* Rejected: the gate digest is where the cost line matters most; if the gate shows $0 but the report shows $1.23, the human trusts the gate's $0 and proceeds blindly.

### D5. Failures degrade to current behavior

**Decision.** `fetch("https://metrics.dev/api.json")` failures (network down, HTTP error, JSON malformed, Zod parse fail) are swallowed, logged via `deps.stdout?.()` (same channel as `[event-bus]` errors), and `resolveCost` returns `null` for every call. The aggregate pass then preserves `costUsd: 0` and the gate renders `· $0.00 · <walls> · unknown`.

**Rationale.** Pricing is a comfort feature, never a correctness gate. A network failure during a run must not halt the pipeline. The cache file's mtime is the TTL — if the cache is fresh, no fetch happens; if stale and the fetch fails, we use the stale cache rather than returning null.

## Risks / Trade-offs

- **[Median drift]** The median across providers can diverge from what you actually pay (your configured provider might be cheaper or pricier than median). → *Mitigation*: the `costKnown: false` / `estimated` marker tells the human explicitly that this is a fallback estimate, not a meter read. PRIMARY per-provider lookup covers all paid-provider configurations correctly.
- **[Network dependency]** A run without network access falls back to the last-good cache, then to `$0 · unknown`. → *Mitigation*: documented; the cache survives 60 min without re-fetch; offline runs after cache expiry degrade gracefully.
- **[Models.dev schema drift]** If `models.dev/api.json` adds required fields or changes shape, our Zod subset parse fails. → *Mitigation*: the subset parses only the `cost` object inside `models[modelID]`; unknown fields are ignored by default in Zod. A breaking change to `cost` itself would surface as a parse error logged to stdout, not a silent regression.
- **[Schema migration for old events]** Pre-change `done` events lack `model`. → *Mitigation*: spawned-map backfill in `repriceEvents`. Tested explicitly.
- **[Status-line cost diverges from gate cost]** The live renderer's status line shows emit-time cost (always $0 for subscription providers); the gate digest shows repriced cost. → *Mitigation*: documented as a known asymmetry in `docs/architecture/sdd-pipeline.md`; the live figure is described as "metered cost" and the gate figure as "aggregate cost." A follow-up change could reprice the live status line via the same module if it becomes confusing.

## Migration Plan

No data migration. sdd-runner run state (`state.json`, `events.ndjson`) is gitignored per-run. Old runs without `done.model` reprice via the spawned-map backfill. New runs emit `model` from the start. The `~/.cache/sdd-runner/models.json` cache file is created on first run if absent. Rollback: `git revert`. No deployed artifacts, no production state.

## Hook/TDD Interactions

New code files the Write/Edit TDD hook pipeline will gate:

- `sdd-runner/src/pricing.ts` (new — fetch + cache + resolveCost) — test-first: failing tests for PRIMARY / FALLBACK / LAST RESORT; cache hit / miss / expired.
- `sdd-runner/src/events.ts` (schema extension) — test-first: failing test that `EventInputSchema.parse` accepts a `done` event with `model` and accepts a `done` event without `model` (backward compat).
- `sdd-runner/src/agent-layer.ts` (thread model into emit) — covered by the orchestrator smoke test.
- `sdd-runner/src/usage-aggregate.ts` (reprice pass) — test-first: failing tests for `repriceEvent` (skips when costUsd > 0; recomputes when 0); `repriceEvents` (builds spawned-map; backfills missing model; aggregates correctly).
- `sdd-runner/src/gate-digest.ts` (costKnown marker) — test-first: failing test that `writeGateDigest` renders the marker correctly for `costUsd > 0 / costUsd === 0 && costKnown / costUsd === 0 && !costKnown`.

Test order (literal order of work): pricing → events → usage-aggregate → gate-digest → orchestrator smoke. Each task in `tasks.md` follows the failing-test → implement → verify cadence.

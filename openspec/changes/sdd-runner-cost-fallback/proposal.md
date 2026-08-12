## Why

`sdd-runner` runs on `zai-coding-plan/glm-5.2`, a subscription provider whose `models.dev` entry carries `cost: { input: 0, output: 0 }`. Every `done` event in `events.ndjson` therefore records `costUsd: 0` regardless of token volume, and every gate digest reports `Cost / duration · $0.00 · <walls>`. On the run we just observed, 1.01M input + 67.3k output tokens reported as $0.00 — the cost line is supposed to be an indirect trust signal ("did real work happen?"), and it's currently zero for every subscription-model run. The data to price it correctly already exists at `https://metrics.dev/api.json` (the same source opencode uses, exposed at the `Record<providerID, Provider>` shape with per-provider per-model `cost` in USD per 1M tokens).

## What Changes

- **New pricing module** (`sdd-runner/src/pricing.ts`): lazy-fetches `https://metrics.dev/api.json`, caches to `~/.cache/sdd-runner/models.json` with a 60-min TTL, exposes `resolveCost(modelId): { input, output, cache_read?, cache_write? } | null`. Algorithm: PRIMARY `db[parseModel(modelId).providerID].models[modelID]?.cost` if any field is non-zero; FALLBACK median of non-zero entries across every provider that serves that modelID; LAST RESORT `null` (caller preserves current behavior).
- **Event schema extension**: add `model: string` to the `done` event (`events.ts` `DoneEventSchema`). Emitted at `agent-layer.ts:162` from `runStageAgent`'s already-known model selection. Old `events.ndjson` files lacking the field are backfilled at reprice time via an agent→model map built by replaying `spawned` events.
- **Reprice pass** in `usage-aggregate.ts`: a new `repriceEvent(event, cost)` helper and a `repriceEvents(events)` walk that, for any `done` event with `costUsd === 0` and tokens > 0, looks up the model and recomputes `costUsd = (inputTokens/1M * input) + (outputTokens/1M * output) + (reasoningTokens/1M * input)`. `aggregateUsage` calls `repriceEvents` before reducing.
- **Gate digest**: `### Cost / duration` line gains a `costKnown: boolean` marker (`· $0.00 · 2607s · estimated` vs. `· $1.23 · 2607s · metered`) so the human knows whether the figure is from the provider's meter or a fallback estimate.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sdd-automation` (currently delta-ADDED by `openspec/changes/auto-sdd-pipeline/specs/sdd-automation/spec.md`, **not yet archived to `openspec/specs/`**): `skip_specs: true` per the precedent set by `sdd-veto-resolver-pass`. The "Structured progress events" requirement's L1 altitude set gains a `model` field on the `done` event; the cost fallback is an implementation detail of the `aggregateUsage` reducer (no spec-level behavior change beyond event-field addition).

## Non-goals

- No source-level fix at the opencode `Session.getUsage` call site — that's upstream and slower. This change reprices at aggregate time inside sdd-runner; the upstream fix can land independently and the two compose without conflict (aggregate-time reprice is a no-op when emit-time cost is already non-zero).
- No new third-party dep — direct `fetch` against `models.dev/api.json`, hand-rolled Zod schema for the subset of fields we need (`cost` only; we ignore limits, modalities, options).
- No pricing of `cache_read` / `cache_write` tokens until sdd-runner emits them as separate fields — today `reasoningTokens` is folded into `inputTokens` for cost purposes; this change preserves that simplification.
- No BYOK-price override mechanism (a future change can layer per-context custom pricing on top of `resolveCost`).
- No effect on platform/task instances, scope model, `tool_prefs`, or capability gating. Runner-internal dev tool.

## Impact

- **Code**: `sdd-runner/src/pricing.ts` (new — fetch + cache + resolveCost), `sdd-runner/src/events.ts` (add `model: z.string()` to `DoneEventSchema`), `sdd-runner/src/agent-layer.ts` (`done` emit at line 162 threads the model), `sdd-runner/src/usage-aggregate.ts` (reprice helper + rewire `aggregateUsage`), `sdd-runner/src/gate-digest.ts` (`writeGateDigest` cost line gains the `costKnown` marker). File-by-file breakdown in design D2.
- **Tests**: `tests/sdd-runner/pricing.test.ts` (new — algorithm cases + cache hit/miss/expire), `tests/sdd-runner/usage-aggregate.test.ts` (reprice cases including backfill via spawned-event map), `tests/sdd-runner/orchestrator.test.ts` (smoke that `presentGateAt` produces a non-zero cost line on a glm-5.2-shaped event log when the models.dev fixture returns non-zero median).
- **Docs**: `docs/architecture/sdd-pipeline.md` Event model section — note the `done.model` field and the aggregate-time reprice.
- **Affected platform/task instances**: none. **Config-context scope impact**: none — runner-internal dev tool.

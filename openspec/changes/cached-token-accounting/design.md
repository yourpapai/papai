# Design: cached-token-accounting

## Context

See proposal.md — Why. Current state, established by tracing the usage data flow and a live repro (`opencode run --format json`):

- opencode `step_finish` parts carry `tokens: { total, input, output, reasoning, cache: { write, read } }` where `input` is **uncached** input. Verified against a live run: `{"total": 10080, "input": 1757, "output": 3, "reasoning": 0, "cache": {"write": 0, "read": 8320}}`.
- `review-loop/src/event-stream.ts:26` parses only `input/output/reasoning` — `cache` is dropped at the door. Everything downstream (`line-handler` → `AgentUsage`/`UsageDelta` → sdd `step_finish` L0 events → `RunStats`/`metrics.json` → renderer/summary/gate aggregates) can only ever see the uncached slice.
- `sdd-runner/src/pricing.ts:30-34` already parses `cache_read`/`cache_write` from models.dev into `ResolvedCost`, but no consumer uses them. `sdd-runner-live-cost-estimate` explicitly deferred cache pricing (Non-Goals); this change picks that up.
- Persisted readers today: `metrics.json` via `PersistedStatsSchema` (`run-stats.ts`), `events.ndjson` replay via `SddEvent` schemas (`sdd-runner/src/events.ts`), `trace-log.ts` per-run ledger. All are zod-validated records; old files lack any cache fields.

## Goals / Non-Goals

**Goals:**

- Cached reads/writes counted as first-class, separate counters from the opencode boundary to every display and persisted artifact; `input` stays uncached everywhere.
- One naming convention end-to-end (`cachedReadTokens`/`cachedWriteTokens` in camelCase surfaces, `cacheRead`/`cacheWrite` in pricing and compact event fields).
- Cost estimates use cache-specific rates when published; never invent a rate.
- Old `events.ndjson` / `metrics.json` replay and rehydrate with cache fields = 0; new files read as 0 on old code (forward-tolerant).
- Zero change to opencode-metered `costUsd` pass-through.

**Non-Goals:**

- Repricing or correcting opencode's own `cost` field (metered truth stays untouched).
- Changing `tokens.total` handling (unused today; stays unused).
- The skeptic-r3 truncation-loop retry behavior — separate failure mode, separate change.
- Retroactive re-derivation of cache counts for old runs (they were never captured; nothing to recover).

## Decisions

### D1 — Separate counters; never fold cache into input

`AgentUsage` (both review-loop `agent-runner.ts` and sdd `events.ts` schema) gains `cachedReadTokens`, `cachedWriteTokens` with `.default(0)`. `inputTokens` keeps its exact current meaning (uncached). Alternative considered: `inputTokens = input + cache.read` to match provider-side "input tokens" totals. Rejected — the user-facing contract of this change is *counted differently*; folding hides the cache ratio that explains cost, and it would silently change the meaning of every existing field, breaking the gate/summary formula consumers that already treat `inputTokens` as the priced-at-input-rate quantity.

### D2 — Parse `cache` at the event boundary with tolerant normalization

`event-stream.ts` `RawPart.tokens` gains optional `cache?: { read?: unknown; write?: unknown }`; `parseStepFinish` normalizes via `asNumber` (absent/malformed ⇒ 0), producing `OpencodeEvent.step_finish.tokens.cacheRead/cacheWrite`. No versioning sniffing: opencode has emitted `cache` since well before the pinned runner version, and `asNumber` already defines the degrade path.

### D3 — `UsageDelta`/`step_finish` L0 events carry the cache fields additively

`review-loop/src/progress-log.ts` `UsageDelta` and sdd `StepFinishEvent.tokens` gain `cacheRead`/`cacheWrite` (required in the emitter path, `.default(0)` in the replay schema so old `events.ndjson` lines validate). `agent-reporter.ts` maps them through. The `sdd-automation` event-log contract ("L0 token/cost deltas") is unchanged in kind.

### D4 — Pricing: dedicated optional rates; absent ⇒ cached tokens are free in estimates

`PriceEntrySchema` (`cost.ts`) gains optional `cacheRead`, `cacheWrite` (USD per 1M). `estimateCostUsd` extends to `input*input + output*output + cacheRead*cacheRead + cacheWrite*cacheWrite` (terms with no rate contribute 0). models.dev `ResolvedCost` already carries `cache_read`/`cache_write`; `usage-aggregate.ts` `repriceEvent` and the live-footer estimator use the same extended formula so gate and footer agree. Alternatives considered: (a) default cacheRead = 0.1 × input (Anthropic convention) when unpublished — rejected, invented numbers in a budget-gating tool are worse than a conservative 0 and the `~` marker already flags estimate status; (b) price cache at the input rate — rejected, overstates cost by 10× on cache-heavy runs, the exact failure this change exists to fix.

### D5 — Display: own segment, hidden when zero

`LiveUsage` and `formatLiveLine` gain `cached`; the line renders `in X · cached Y / out Z` when `cached > 0`, byte-identical to today when 0 (non-TTY LineRenderer output for cache-free runs must not change — tests pin exact bytes). Same rule for `summary.ts` (`in … / cached … / out … / reasoning …`) and the sdd footer/done lines. Shows reads only: `cached` = `cachedReadTokens`; `cachedWriteTokens` is tracked and persisted but not shown inline (write bursts are short-lived pricing detail; totals live in `metrics.json`). Alternative considered: showing `18.2Mⓒ` inline inside `in`. Rejected — breaks `formatTokenCount` composition and the `in`/`out` symmetry every consumer parses.

### D6 — `RunStats`/`metrics.json`: additive schema, rehydrate-and-persist round-trip

`LabelStats`/`UsageInput` gain `cachedRead`/`cachedWrite`; `PersistedStatsSchema` declares them `.default(0)` so old `metrics.json` rehydrates and new files keep old readers working (zod strips unknown on old code — actually old code's stricter record parse must not reject: fields are optional with defaults, old files lack them entirely ⇒ 0, which is truthful: those runs counted no cache). `--resume-run` therefore shows cache counters restarting at 0 for pre-change runs — accepted, same as any new field.

### D7 — Config `pricing` map documents the new keys

`config.example.json` pricing entries gain documented optional `"cacheRead"`/`"cacheWrite"` keys. No validation tightening beyond the schema addition.

## Risks / Trade-offs

- [Providers that meter cache reads as regular input would now *under*count cost when cache rates are unpublished] → Same class of estimation error the `~` marker already signals; documented in config example; provider meters (opencode `cost`) remain authoritative when present.
- [Byte-pinned renderer tests churn] → Only lines with `cached > 0` change format. Fixtures replayed in tests were recorded through the current parser, which dropped `cache`, so they carry 0 and stay byte-identical; new fixtures cover the `cached > 0` branch.
- [Two field-name conventions (`cachedReadTokens` vs `cacheRead`)] → Matches existing split (`inputTokens` in usage records, `input` in deltas/pricing); documented in D3/D4.
- [models.dev missing `cache_write` more often than `cache_read`] → Optional rates degrade per-term (D4), no all-or-nothing pricing decision.

## Migration Plan

Pure dev-tooling change; no coordinated deploy. Old artifacts replay with cache=0 (D3/D6). Rollback is a revert; new-field-tolerant readers mean post-revert runs on new `metrics.json` files also degrade to 0 rather than failing.

## Hook/TDD interactions

All edited files are gateable implementation code: `review-loop/src/**` maps to `tests/review-loop/**`, `sdd-runner/src/**` to `tests/sdd-runner/**`. Test-first order: parser fixtures (raw opencode line with `cache` object), then accumulator/`AgentUsage`, then `RunStats`/persist round-trip, then pricing formula, then rendering bytes, then sdd event/replay schemas, then `repriceEvents`/footer estimator. `max-lines` budget: `run-stats.ts` (160 lines) and `live-format.ts` (126) have headroom; `events.ts` grows by fields only.

## Scope-model / gating impact

None: dev-tooling CLIs, no papai runtime, no DB, no context-scoped state. No new dependencies.

<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: run accounting

## Context

See `proposal.md` — Why. What the approach has to work with:

```
  claude route                              opencode route
  ────────────                              ──────────────
  result line (per turn)                    session.get (per read)
    usage{input,output,                       tokens{input,output,reasoning}
          cache_creation,cache_read}          cost                ← 0 when unpriced
    total_cost_usd            ← real        step-finish events (per step)
  rate_limit_event (per turn)                 tokens{...}, cost
    {status, rateLimitType,
     resetsAt, overageStatus,
     overageResetsAt, isUsingOverage}
         │                                          │
  foldLine: keeps usage.total,               readTokensUsed: returns
  drops costUsd; tracker drops               usage.tokens, logs usage.cost
  the rate-limit line
         └──────────────┬───────────────────────────┘
                        ▼
             AgentSession.tokensUsed(): Promise<number>
                        ▼
   totalTokens(deps, carried) → AgentState.tokensSpent (persisted)
                        ▼
   run-detail.ts budgetLine: "412,000 of 5,000,000 tokens · attempt 1 of 3"
```

Three constraints shape everything below.

1. **`tokensSpent` is the only cross-job memory.** `carriedTokens` is captured
   once from the restored block and added to the running job's figure, because a
   job's session total is already cumulative across the phases it cascades
   through (`token-budget.ts`). Any second cumulative figure must be carried the
   same way or it will double-count for the same reason.
2. **The budget must not learn about pricing.** `types.ts` records the incident:
   OpenCode's `cost` reads `0` for a model its catalogue does not price, which is
   the ordinary case here, and a ceiling that silently never fires is worse than
   no ceiling. The ladder below is therefore strictly downstream of
   `withinBudget`.
3. **Recorded, never guessed.** The claude decoders are pinned to the fixture
   corpus and the OpenCode ones to `live-sdk.integration.ts`. A field this design
   wants but no recording carries is a task to record it, not a schema to write
   optimistically.

## Goals / Non-Goals

**Goals:**

- One place that turns "what a backend said about a turn" into "what it cost",
  with `unknown` a first-class outcome rather than `0`.
- The cost ladder identical on both backends, so a maintainer reading two runs'
  comments is reading the same figure computed the same way.
- Cross-job accumulation that cannot double-count, by construction rather than
  by care.
- The subscription's standing on the OAuth route reported from what the stream
  actually carries.

**Non-Goals (design-level, beyond the proposal's):**

- No change to `tokensUsed()`, `totalTokens`, `withinBudget` or `stopIfOverBudget`
  semantics. The ceiling behaves identically before and after.
- No live/streamed cost. The comment is written once, after the run
  (`agent-single-reply-comment`); a figure that changes mid-run has no reader.
- No `sdd-runner` behavior change. It gains one export and loses nothing.

## Decisions

### D1 — A second seam method, not a wider `tokensUsed()`

`AgentSession` gains `spend(): Promise<RunSpend>` beside `tokensUsed()`:

```ts
/** Cost buckets as a backend reports them, in tokens. Absent field ≠ zero. */
interface UsageBuckets {
  input: number
  output: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
}

interface RunSpend {
  /** What this session cost, or `null` when nothing could price it. Never 0-as-unknown. */
  usd: number | null
  /** Which rung answered, so a log explains the figure without a rerun. */
  source: 'backend' | 'catalogue' | 'none'
  /** Latest-wins per window, `[]` on a route or a stream that carries none. */
  windows: readonly RateLimitWindow[]
}
```

**Why not widen `tokensUsed()` to return a record?** Its callers are the ceiling
(`token-budget.ts`, `comment-intent.ts`), the salvage path (`turn-stop.ts`) and
`agent-handle.ts`. Every one of them wants the scalar, and constraint 2 says the
ceiling must not acquire a pricing dependency it could fail on. A second method
leaves that path byte-identical.

**Why not `costUsd(): Promise<number>` alone?** The rate-limit windows are
observed by the same adapter over the same stream and are wanted by the same
reader at the same instant. Two thunks would be two reads of one adapter's
accumulated state, and the pair can be sampled at different moments — the
failure `run-detail.ts` already records about reconciling the heartbeat's total
with the state's under a `max()`. One observation, sampled once.

**Alternative rejected: sum from the progress tracker.** `activity.ts` already
decodes per-step `cost` on the OpenCode route. Rejected for the reason
`sdk-contract.ts` records for `session.get`: a total summed from events is
whatever has arrived by the time it is asked for. The adapter's own fold (claude)
and the server's own accounting (OpenCode) are both race-free.

### D2 — The ladder, and where each rung comes from

```
  ① backend figure          claude:   Σ result.total_cost_usd   (fixture: 0.126837 on OAuth)
     source: 'backend'      opencode: session.get → cost         (0 ⇒ fall through)
            │
            ▼ (zero, or absent)
  ② catalogue reprice       costOfUsage(buckets, resolveCost(modelRef(openai), db))
     source: 'catalogue'    models.dev via sdd-runner/src/pricing.ts
            │
            ▼ (no priced row, or buckets unknowable — D5)
  ③ unpriced                usd: null, source: 'none'  →  rendered as "unpriced"
```

Rung ① first because it is the provider's own arithmetic over its own token
counts, and on the claude route it is the only rung that sees the `modelUsage`
split — the fixture's `result` line prices `claude-haiku-4-5` and
`claude-sonnet-5` separately, which a single `modelRef` reprice cannot do.

Rung ② is the one that closes the gap `types.ts` names. `resolveCost` already
falls back across providers by bare model id and reports `source: 'fallback'`
when it does; that tier is folded into `'catalogue'` here rather than surfaced —
the distinction between an exact row and a cross-provider median is real but is
detail for the log, not for a run comment.

### D3 — Reuse means extracting sdd-runner's arithmetic, not copying it

`repriceEvent` in `sdd-runner/src/usage-aggregate.ts` holds the arithmetic this
change needs, wrapped in sdd-runner's `DoneEvent` shape and its "already priced"
guard. The pure core is extracted and exported:

```ts
export const costOfUsage = (buckets: UsageBuckets, cost: Cost): number
```

`repriceEvent` then calls it, so sdd-runner's behavior is defined by the same
code that prices an agent run and the two cannot drift. `TOKEN_SCALE`, the
`cache_read ?? 0` / `cache_write ?? 0` handling and the reasoning-at-input-rate
convention travel with it unchanged.

**Why the cross-workspace import is acceptable here:** `model-metadata.ts` already
imports `loadDb`/`lookupModel` from `sdd-runner/src/pricing.js`, and records why
— one direction, one function wide, both workspaces developer tooling outside
papai's runtime. This extends an existing edge rather than opening one.

**Alternative rejected: a shared package.** Two importers over two functions do
not pay for a workspace, and `CLAUDE.md`'s minimality ladder asks the smaller
question first.

### D4 — Cumulative spend rides the `tokensSpent` pattern exactly

`AgentState` gains, beside `tokensSpent`:

```ts
usdSpent: z.number().min(0).default(0),
/** True once any turn on this issue could not be priced — makes the total a floor. */
usdUnpriced: z.boolean().default(false),
```

Both default, so no `STATE_VERSION` bump and no issue in flight is stranded —
the precedent `tokensSpent`, `stepsDone` and `changeName` record. `spendPatch`
in `token-budget.ts` writes all three together, which is what keeps the
already-fixed bug fixed: the three paths that write a state block after a job has
prompted (success, `failRun`, `failAnswer`) silently disagreed for as long as
they wrote the fields separately.

Accumulation mirrors `totalTokens(deps, carried)`:

```
usdSpent′    = carriedUsd + (run.usd ?? 0)
usdUnpriced′ = carriedUnpriced || run.usd === null
```

An unpriced turn contributes nothing to the sum and flips the flag, so the total
is a **floor** and says so. It never reads as a smaller true number.

### D5 — Unknown is preserved, not defaulted, at the decoder

`sessionUsageSchema` decodes `tokens.{input,output,reasoning}` and drops cache
buckets entirely; `activity.ts`'s `step-finish` schema does the same. Repricing
without them under-counts a cache-heavy run badly and silently. So:

- The schema is widened for the cache buckets as **`.optional()` without
  `.default(0)`**, deliberately unlike the `reasoning: z.number().default(0)`
  beside it. Absent means "the server did not say"; `0` means "the server said
  none". Only the second is priceable.
- A reprice missing a bucket the payload never carried refuses and returns
  `null` — fail closed, the doctrine `treeSpend` records in sdd-runner ("absent
  usage makes the ledger read unknown, never `$0` headroom").
- Whether the server populates them is a **recorded** question, not an assumed
  one: `live-sdk.integration.ts` asserts the shape, and if the field never lands
  the OpenCode route rests on rung ① and reports unpriced when that is `0`.

The claude route has no such gap — `usageSchema` already decodes
`cache_creation_input_tokens` and `cache_read_input_tokens`.

### D6 — Rate limits: the whole record, latest-wins per window

`rateLimitLineSchema` currently keeps one field of six. It is widened to decode
the recorded record whole, every field beyond `rateLimitType` lenient
(`.optional().catch(undefined)`) for the reason `pricing.ts`'s `ModelEntrySchema`
records: a malformed field must degrade to `undefined` for that field, never fail
its line.

```ts
interface RateLimitWindow {
  window: string          // pass-through: "five_hour", "seven_day", whatever a plan carries
  utilization?: number    // 0–1 fraction, as the provider states it (see D7)
  status?: string         // "allowed" | "allowed_warning" | … — never enumerated
  resetsAt?: number       // epoch seconds
  overageStatus?: string
  overageResetsAt?: number
  isUsingOverage?: boolean
}
```

**Remaining is derived, at the render, from `utilization` alone:**

```
remaining% = 100 − utilization × 100
```

A window whose `utilization` the provider did not state has a row without a
remaining figure — status and reset only. The fraction is never reconstructed
from a reset timestamp, from the elapsed share of a window, or from any other
window's figure; see the second half of D7.

The adapter keeps a `Map<window, RateLimitWindow>`, last line wins per window.
Latest-wins rather than first: the last turn of a run is the one whose standing
the maintainer will meet on the next run. A window the stream never carried has
no row — **a window is reported if and only if a stream carries it**, which is
what makes the weekly row a fact about the CLI pin rather than about this
renderer (D7).

`claude-progress.ts` keeps ignoring the line for *progress* purposes; the fold in
`claude-adapter.ts` is what accumulates it. The two readers stay separate because
one is a live log and the other is a run's final account.

### D7 — The pin move is the prerequisite, and it brings the remaining figure

The corpus is pinned to CLI 2.1.239, whose `rate_limit_event` carries one window
and no remaining fraction at all:

```json
{"status":"allowed","resetsAt":1787644800,"rateLimitType":"five_hour",
 "overageStatus":"allowed","overageResetsAt":1788220800,"isUsingOverage":false}
```

2.1.251 builds that line differently. Read off the shipped binary — the
constructor and its own schema, not a guess:

```js
// the emitted line's builder
{ status, resetsAt, rateLimitType,
  ...utilization !== undefined && { utilization },     // ← added since 2.1.239
  overageStatus, overageResetsAt,
  unifiedWindows }                                     // ← added since 2.1.239

// unifiedWindows' declared shape
{ five_hour?:                  { utilization, resetsAt },
  seven_day?:                  { utilization, resetsAt },
  seven_day_overage_included?: { utilization, resetsAt } }
```

and the emission site passes it (`unifiedWindows: dn(j$())`, where `j$()` returns
per-window raw utilization filtered to windows whose reset is still future).
Upstream, every figure is parsed from response headers —
`anthropic-ratelimit-unified-{5h,7d,overage}-{utilization,reset}` and
`-unified-status` — so `utilization` is a 0–1 fraction, which is what makes D6's
derivation a subtraction rather than an estimate.

So the weekly window is not a hypothetical this design defers: it arrives on the
same line as the five-hour one, on a CLI this repo can pin. **The prerequisite is
the pin, not a spike.** `.github/workflows/agent-pipeline.yml` installs
`@anthropic-ai/claude-code@2.1.239`; it moves to ≥ 2.1.251.

**What the pin move obliges.** `opencode-agent/CLAUDE.md` states the rule: the
census pins (`mcp_servers: []`, built-ins-only skills, no memory-file row) are
load-bearing, and *a CLI pin move must re-answer them at zero spend before any
credentialed turn*. So the bump carries the whole recorder census with it —
`facts.json`'s twelve pinned answers, the negative legs, and
`nativeProofWindows`, which reads `"five_hour"` today and is exactly the fact the
re-record revises. That is task group 1, and it gates the decoder work in group 3
because the decoder is written against the recording.

**Two things the recording, not the code read, has to settle.** The `utilization`
field is emitted *conditionally* (`utilization !== undefined`), and `j$()` drops
a window whose reset has passed — so whether this account's plan populates the
seven-day headers is an empirical question the credentialed proof turn answers,
not one the constructor answers. If a window never arrives it simply has no row,
which the absence clause in the spec already covers, and the five-hour figure is
unaffected.

**The anti-invention rule survives the good news, narrowed.** Remaining is
derived from a fraction the provider stated (D6). Nothing else is: no percentage
reconstructed from `resetsAt`, no weekly figure inferred from the overage window
— note `overageResetsAt` sits ~6.7 days out in the recording and is *not* the
weekly limit — and no row for a window the stream did not carry.

**Caveat worth carrying: `unifiedWindows` describes itself `@internal`.** It is
on the wire and stable enough to decode, but it is not a promised public
contract. That is an argument for keeping D6's leniency rule exactly as it is
rather than relaxing it now that the fields are known, and for re-recording the
corpus at every pin move — which the rule above already requires anyway.

### D8 — The per-run figure is derived, not plumbed

`reply-buffer.ts` already holds `entry` (the state the run began on) and `latest`
(the newest state a section was written from). So:

```
this run's spend = latest.usdSpent − entry.usdSpent
this run's tokens = latest.tokensSpent − entry.tokensSpent   (available, not rendered)
```

No new field crosses into the buffer for the money half, and the per-run figure
cannot disagree with the cumulative one — it is defined from it. Only the
windows need a channel, so `ReplyDeps` gains one thunk, wired in `contain.ts`
where the agent handle is in scope; `AgentHandle.rateLimits()` returns `[]` when
no session was ever booted, the honest answer for the many phases that never
prompt (the reasoning `AgentHandle.tokensUsed`'s `0` already records).

`RunDetailView` gains `spend: RunSpendView` and the render becomes:

```
**Budget:** 412,000 of 5,000,000 tokens · attempt 1 of 3
**Cost:** $1.87 this run · $12.40 on this issue
**Claude limits:** 5-hour 76% left · resets 14:00 UTC · 7-day 59% left · resets Tue
```

with the unpriced total rendering `≥ $12.40 (some turns unpriced)`, the cost line
omitted entirely when nothing on the issue has ever been priced, a window whose
`utilization` was not stated rendering status and reset without a percentage, and
the limits line omitted on any route that carried no window. A missing line beats a line
that says nothing — the rule `jobLine` already follows for a local run.

## Risks / Trade-offs

- **A wrong price reads as authoritative.** models.dev is a third-party catalogue
  and `resolveCost`'s fallback tier is a cross-provider median. → The figure is
  never a ceiling (constraint 2), `source` is logged per run, and the render is a
  cost report beside a token budget that remains the enforced bound.
- **`total_cost_usd` on the OAuth route is notional.** A subscription run is paid
  for by the plan, not per token; the fixture's `0.126837` is list price for work
  that cost no marginal money. → Rung ① is still the best available figure and
  the honest reading is "what this would have cost on the API"; the design does
  not claim it is billed. The distinction belongs in the docs line for
  `**Cost:**`, not in a second number.
- **Widening `rate_limit_info` couples a renderer to an unstable shape**, and
  `unifiedWindows` is self-described `@internal` (D7). → Every field but the
  window is lenient and optional; a moved or dropped field costs that field's
  clause and nothing else — a vanished `utilization` costs the percentage and
  keeps the row — and the corpus re-records at each pin.
- **The pin move is the largest piece of work here and touches the whole
  recorder census**, not just this change's surface: twelve pinned facts and the
  negative legs re-answer, and a census pin that moved for an unrelated reason
  surfaces as this change's failure. → It is task group 1, ahead of everything
  that reads a recording, and the census is re-answered at zero spend before any
  credentialed turn — the rule, not this change's invention.
- **The seven-day window may not arrive for a given plan or account** (D7). →
  The absence clause covers it: no row, no inferred figure, five-hour unaffected.
  The credentialed proof turn in group 1 is what establishes which windows this
  account actually sees.
- **The state grows two fields on a hot path.** → Both default and neither is
  read by the machine; `openspec/changes/*` precedent and `zod`'s unknown-key
  stripping make a rollback lose the figures and strand nothing.
- **Cache buckets may never arrive on the OpenCode route** (D5). → Rung ①
  already covers a priced model there; the honest `unpriced` render covers the
  rest, and the run comment stops claiming a number it cannot compute.

## Migration Plan

No migration. Both state fields default, so a block written before this change
parses and reads `$0.00 / not unpriced` — correct for an issue whose earlier jobs
were never accounted. Rollback drops the keys as unknown (zod strips them), which
loses accumulated dollars and strands nothing; the token ceiling is untouched in
both directions.

The CLI pin bump is the one ordering constraint that is not about tests: the
decoder is written against a recording, so the recording has to exist first.
Rolling the pin back after this ships would cost the remaining percentages and
leave the rest — status, reset, cost — working, because every field is optional.

Test-first order otherwise, per the Write/Edit TDD hook pipeline — every new
module (`run-spend.ts`, `rate-limit-windows.ts` or whatever the split lands as)
and every touched decoder is hook-gated, so each lands behind its failing test:

0. Pin bump and census re-record (group 1) — nothing that reads a recording
   starts before it.
1. `costOfUsage` extraction in `sdd-runner` + its test, with `repriceEvent`'s
   existing suite green and unchanged as the proof it is a pure extraction.
2. Decoder widening — claude `rate_limit_info` incl. `utilization` /
   `unifiedWindows` against the re-recorded corpus, OpenCode cache buckets
   against the live SDK lane.
3. The ladder, unit-tested per rung including both `null` paths.
4. Seam, adapters, handle, state, accumulation.
5. Render, last — so every figure it prints already has a test that produced it.

## Open Questions

- ~~Does the pinned OpenCode server populate cache buckets on `session.get`?~~
  **Answered — yes.** The recorded fixture in `adapters.test.ts` already carried
  `tokens: { …, cache: { read, write } }`, and the live lane now pins it against
  a real server (`checkTheUsageShape`, all four checks green on
  `opencode-ai@1.18.7`). Rung ② is reachable on the OpenCode route. D5's
  absent-is-not-zero rule stays exactly as written — it is now the guard for the
  day the server stops reporting them, rather than a hedge against never having.
- Should `source: 'catalogue'` distinguish `resolveCost`'s exact-row and
  cross-provider-median tiers in the log line? A log-detail question with no
  effect on the specs, the ladder or the render.

Not an open question, though it reads like one: *which* windows this account's
plan reports is settled by group 1's proof turn. The spec requires a row per
window the provider states, so either answer is a correct render rather than a
change of approach — which is why it is a task and not a deferral.

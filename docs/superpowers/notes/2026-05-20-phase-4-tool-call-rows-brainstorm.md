# Phase 4 — Tool-Call Rows + Idempotency Hardening, Brainstorm

**Date:** 2026-05-20
**Parent roadmap:** [`../plans/2026-05-19-central-llm-billing-roadmap.md`](../plans/2026-05-19-central-llm-billing-roadmap.md)
**Phase 2 (merged):** [`../plans/2026-05-19-phase-2-usage-recorder-plan.md`](../plans/2026-05-19-phase-2-usage-recorder-plan.md)
**Phase 3 (merged):** [`../plans/2026-05-19-phase-3-billing-dashboard-plan.md`](../plans/2026-05-19-phase-3-billing-dashboard-plan.md)

Open exploration before the per-phase design and plan land. The roadmap
lists Phase 4 as "proposed, not committed" with three bullet points:

> - New `tool_call_events` table mirroring `llm_usage_events` shape, keyed
>   by `turn_id`.
> - Switch `event_id` to a deterministic hash of
>   `(responseId, occurredAt, modelRole)` so the recorder is safe outside
>   the in-process bus (queue, retry).
> - Cross-process outbox columns: `forwarded_at`, `forward_attempts`,
>   `forward_error`. No worker yet — just the schema slot.

Three concerns again coupled but with different blast radius. The
brainstorm names them, surfaces options, and resolves the open
questions before the per-phase design doc.

## Trigger check

The roadmap puts Phase 4 behind a trigger:

> Phase 3 data shows tool-call cost is material, or the billing research
> moves toward a metering vendor and the outbox path is needed.

Phase 3 has only just shipped (`490de03` on `main`); we do not yet have
operator-derived "tool-call cost is material" evidence. The user has
asked to start Phase 4 now anyway. Two readings:

- **R1.** The trigger is informational; the user has made an explicit
  decision to start. Brainstorm proceeds.
- **R2.** Without operator evidence, we cannot justify the table shape
  empirically — risk of over-fitting the schema to a hypothesis.

**Recommendation:** R1, with R2 informing scope. Land a *narrow*
Phase 4 that mirrors `llm_usage_events` and reuses existing tool
lifecycle events (`tool:request`, `tool:execute_end`,
`tool:failure_classified`) rather than inventing rich new fields we
can't yet measure as useful. Outbox columns ship as inert schema slots
(per the roadmap). Determinism hardening can ship independently if the
table itself is contentious.

## Surface area survey

| Location                                  | Today                                                                        | Phase 4 implication                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/db/llm-usage-events-schema.ts:8-35`  | Drizzle table, 14 columns + 4 indexes; PK `event_id` text                    | Template for the new `tool_call_events` schema; outbox columns may be added here too (consistency)               |
| `src/db/migrations/035_llm_usage_events.ts` | Plain SQL `db.run(SQL)` migration, mirror pattern                          | Migration 037 follows shape; possibly migration 038 if we also add outbox columns to `llm_usage_events`         |
| `src/usage/recorder.ts:32-62`             | `recordUsage(payload)`; `eventId: crypto.randomUUID()` at insert            | Phase 4 swaps to deterministic hash here; tool-call recorder either lives here or in a sibling module           |
| `src/usage/index.ts:90-110`               | `initUsageRecorder()` subscribes once at startup; handles `llm:end`/`llm:error` only | Subscribes to additional event types OR a sibling `initToolCallRecorder()` ships alongside                |
| `src/llm-orchestrator-events.ts:114-125`  | `buildToolTelemetry(tools, routing)` returns `toolCount` (exposed count)     | This is roll-up only; per-call data needed for Phase 4 lives elsewhere                                          |
| `src/llm-orchestrator-events.ts:173`      | `responseId: result.response.id` already captured                            | Same `responseId` for all tool-calls in a turn (LLM-level id); turn-scoped, not call-scoped                     |
| `src/llm-orchestrator-events.ts:181`      | `stepsDetail: buildStepsDetail(result.steps)` in `llm:end` event             | Carries the full per-call breakdown post-hoc; alternative source if we don't add new bus events                 |
| `src/llm-orchestrator-invoke.ts:17-30`    | `buildToolCallStartHandler` emits `tool:request {toolName, toolCallId, args}` with `turnId` | Available real-time event for "tool started"                                                              |
| `src/llm-orchestrator-invoke.ts:70-90`    | `buildToolCallFinishHandler` emits `tool:execute_end {toolName, toolCallId, success, durationMs}` | Available real-time event for "tool finished"; full row data here                                  |
| `src/llm-orchestrator-invoke.ts:38-67`    | `emitFailureClassified` emits `tool:failure_classified` with errorType/Code | Adjunct event with structured failure info; recorder can correlate by `toolCallId`                              |
| `src/tools/wrap-tool-execution.ts:13-35`  | Wraps every tool; sees `(input, options)` with `options.toolCallId`         | Doesn't see `turnId`/`storageContextId`/`chatUserId` directly — those live in invoke.ts closure                |
| `src/debug/event-bus.ts:1-61`             | In-process pub/sub, synchronous, no try/catch around listener calls         | Same constraints as Phase 2: recorder must catch internally; no rethrow                                         |
| `src/debug/turn-assembly.ts:62-78`        | In-memory `recentToolFailures` ring buffer (1024)                            | Phase 3 dashboard already shows tool failures from here; do not duplicate into the new table — keep them complementary |
| `src/db/migrations/`                      | Highest existing: `036_drop_user_llm_config.ts`                              | Next number is `037`                                                                                            |
| `src/index.ts` (recorder init site)       | `initUsageRecorder()` called at startup (Phase 2)                            | New `initToolCallRecorder()` (if separate) wires in next to it                                                  |

Net: ~5 files touched in `src/` for the recorder + schema, plus the new
migration, plus tests. If we choose to retrofit `llm_usage_events` with
outbox columns or deterministic ids in the same phase, add ~3 more
file touches and a second migration.

## Open question A — Real-time bus events vs post-turn `stepsDetail`

Two sources for per-tool-call rows:

- **A1. Subscribe to `tool:execute_end`** (and `tool:failure_classified`).
  One row per call, written at call finish. Pro: real-time; failure
  rows separately classified. Con: two events to correlate
  (`tool:execute_end` carries duration/success; classifier carries
  errorType). Requires either a join or in-memory pairing keyed by
  `toolCallId`.
- **A2. Subscribe to `llm:end`** and unpack `stepsDetail`. One pass per
  turn, N rows written at end. Pro: single subscriber, all data in
  one shot, plus failure classification has settled by then. Con:
  needs careful inspection of `stepsDetail` shape to confirm it
  contains everything we want (duration? tool args size? failure type?).
  Looking at `buildStepsDetail` in `src/llm-orchestrator-steps.ts:28-58`:
  per step it has `toolCalls[].{ toolName, toolCallId, args, result?, error? }` —
  no duration, no failure classification.
- **A3. Hybrid.** Subscribe to `tool:execute_end` for the row baseline
  (has duration); enrich with `tool:failure_classified` via in-memory
  buffer keyed on `(turnId, toolCallId)`. Write the row when both have
  arrived OR a short watchdog fires.

Trade-offs:

- A1 ships earliest data (row exists by the time the turn ends) but
  the failure classifier event lands shortly after the execute_end
  event, so we either race the insert or wait briefly.
- A2 is the cleanest single-subscriber pattern (mirroring Phase 2) but
  the data on `stepsDetail` is post-hoc summarization; durations have
  to be threaded into `buildStepsDetail` if we want them in rows.
- A3 is correct but more code.

**Recommendation:** A2 with a small enrichment. Reasons:

1. Single-subscriber mirrors Phase 2's pattern; less infrastructure
   per insert.
2. `stepsDetail` already runs on every `llm:end`; piggybacking is
   free.
3. The missing fields (`durationMs`, `errorType`, `errorCode`,
   `retryable`, `recovered`) can be threaded into `buildStepsDetail`
   from a per-turn buffer that the orchestrator already maintains
   (or that we add — Phase 4 design decides). Alternative: extend
   `StepInput` to carry the metrics that `tool:execute_end` carries.

If the design call swings A3, the recorder uses a small `Map<turnId,
{ calls: Map<toolCallId, partial>, classifications: Map<toolCallId,
partial> }>` keyed by turnId, garbage-collected on `llm:end` /
`llm:error`. Doable but more state.

Tie-breaker: A2. Decided in design unless the orchestrator turns out
not to have per-call duration available at `llm:end`.

## Open question B — Schema fields

Mirror `llm_usage_events` columns where they make sense, add a few
tool-call-specific fields, drop the LLM-level ones.

Proposed columns:

| Column                  | Type     | Nullable | Notes                                                                                |
| ----------------------- | -------- | -------- | ------------------------------------------------------------------------------------ |
| `event_id`              | text PK  | no       | Deterministic hash (open question E) — `hash(turnId, toolCallId)`                    |
| `turn_id`               | text     | no       | The LLM turn this call belongs to. PK candidate but kept secondary; PK is event_id   |
| `occurred_at`           | int      | no       | epoch ms at call finish                                                              |
| `storage_context_id`    | text     | no       | same as the parent `llm:end` event                                                   |
| `context_type`          | text     | no       | `dm` / `group`                                                                       |
| `chat_user_id`          | text     | no       | same as parent                                                                       |
| `model`                 | text     | no       | the model whose `llm:end` produced this call (main / small)                          |
| `model_role`            | text     | no       | `main` / `small` — embeddings don't have tool calls, so never `embedding`            |
| `tool_name`             | text     | no       | e.g. `create_task`                                                                   |
| `tool_call_id`          | text     | no       | SDK-provided unique id within turn                                                   |
| `success`               | int      | no       | `0` / `1`                                                                            |
| `duration_ms`           | int      | yes      | from `tool:execute_end` if A1/A3; null if A2 + no thread-through                     |
| `error_type`            | text     | yes      | from `tool:failure_classified` (`schema_validation`, etc.)                           |
| `error_code`            | text     | yes      | from `tool:failure_classified`                                                       |
| `retryable`             | int      | yes      | `0`/`1`/null                                                                         |
| `recovered`             | int      | yes      | `0`/`1`/null                                                                         |
| `args_bytes`            | int      | yes      | JSON length of args; lets dashboard see argument-size amplifiers                     |
| `result_bytes`          | int      | yes      | JSON length of tool result; cost-amplifier signal                                    |
| `response_id`           | text     | yes      | parent LLM response id (turn-scoped, NOT per-call)                                   |
| `forwarded_at`          | int      | yes      | OUTBOX (Phase 4 part 3) — null on insert                                             |
| `forward_attempts`      | int      | no       | default 0                                                                            |
| `forward_error`         | text     | yes      | last forward error message, null when no attempts                                    |

Indexes:

- `(storage_context_id, occurred_at)` — primary subject lookup
- `(chat_user_id, occurred_at)` — secondary subject lookup
- `(turn_id)` — join to `llm_usage_events.turn_id`
- `(tool_name, occurred_at)` — tool-popularity queries
- `(forwarded_at)` — outbox poll (Phase 4 follow-on); partial index on
  `WHERE forwarded_at IS NULL` if SQLite version supports it (it does,
  3.8+).

Open subquestion: do we want a UNIQUE on `(turn_id, tool_call_id)`?
With deterministic `event_id = hash(turnId, toolCallId)`, that's already
enforced by the PK. No second unique needed.

Open subquestion: `args_bytes` / `result_bytes` — included or omitted?
The Phase 3 brainstorm explicitly called amplifier surfaces a future
research input. These two are cheap to record (the strings are
in scope at finish-handler time) and answer a real question. Include.

Open subquestion: do we record `args` / `result` content itself? **No.**
Phase 5's anonymity contract forbids content; Phase 4 should respect
the same envelope so the table is safe to surface in stats later.
Bytes only.

## Open question C — Recorder location: extend `src/usage/` or new `src/tool-usage/`?

- **C1. Extend `src/usage/`.** Add `tool-call-recorder.ts` + extend
  `recorder.ts` with a sibling `recordToolCall(payload)`. `index.ts`
  subscribes to both event types. One module, two tables.
- **C2. New `src/tool-usage/` module.** Parallel structure to
  `src/usage/`. One module per table.

**Recommendation:** C1. Same reasoning as Phase 2's "one usage module":
the table count is going to grow (phase 5 might add more), and one
module that owns "all usage-style insertion" stays coherent. The query
module is already in `src/usage/query.ts`; query helpers for the new
table go there too. The price is one slightly larger module; the
savings are one fewer subscriber to register and one fewer testing
surface to seed.

Module shape after Phase 4:

```
src/usage/
  index.ts           — subscribes once, dispatches to recorders by event type
  recorder.ts        — recordUsage(payload)               [Phase 2]
  tool-call-recorder.ts — recordToolCall(payload)        [Phase 4]
  query.ts           — list/detail helpers                [Phase 2; new tool-call helpers added Phase 4]
  types.ts           — UsageEvent, ToolCallEvent, RequestRow, ToolCallRow
  event-id.ts        — deterministic hash helper          [Phase 4 new]
```

## Open question D — Idempotency: deterministic event_id

Phase 2 used `crypto.randomUUID()` for `event_id` in `llm_usage_events`.
Phase 4 (per roadmap) switches to a deterministic hash. Three sub-questions:

1. **What to hash?**
   - Roadmap: `hash(responseId, occurredAt, modelRole)`.
   - But for `tool_call_events` we have `(turnId, toolCallId)` which is
     already unique within a deployment. `tool_call_id` is generated by
     the SDK and globally unique (UUID).
   - For `llm_usage_events`, `(responseId, modelRole)` is unique within
     a turn — but `responseId` can be null for some providers, so
     `(turnId, modelRole)` is a safer fallback.

   **Recommendation:** Two hash inputs depending on table:
   - `llm_usage_events`: `hash(turnId || responseId, occurredAt, modelRole)`
     where `turnId` is the fallback if `responseId` is null.
   - `tool_call_events`: `hash(turnId, toolCallId)`.

2. **Which hash function?**
   - `crypto.subtle.digest('SHA-256', …)` — async, returns ArrayBuffer.
     Awkward in synchronous recorder paths.
   - `crypto.createHash('sha256').update(…).digest('hex')` — Node-style
     sync API, Bun supports it.
   - `Bun.hash` — fast, non-crypto, 64-bit. Sufficient for "this
     identifier" purposes (we don't need cryptographic resistance,
     just collision-resistance within a deployment).
   - hand-rolled FNV / cyrb53 — no dependency, deterministic, ~10 lines.

   **Recommendation:** `crypto.createHash('sha256').update(input).digest('hex').slice(0, 32)`.
   Cryptographic but truncated; trades a little entropy for shorter
   primary keys. The codebase already uses `node:crypto` from `bun` for
   other purposes (e.g. JWT signing — confirm in design).

3. **Migration strategy for existing Phase 2 rows.**
   Existing `llm_usage_events` rows already have random UUIDs. Three options:
   - **D3a.** Leave them; new rows use deterministic ids. Mixed table.
   - **D3b.** Backfill — for each row, compute the deterministic id
     and update. Risk: collisions if `turnId+responseId+occurredAt` is
     not unique across the existing data (likely fine).
   - **D3c.** Only the *new* `tool_call_events` table uses deterministic
     ids; `llm_usage_events` keeps random UUIDs forever.

   **Recommendation:** D3a, soft. The hash switchover is a code change
   in `recordUsage()`; no migration needed for existing rows. Tests
   don't assert id shape (per Phase 2 brainstorm L), so changing the
   generator is invisible to fixture-based tests. Add a follow-up note
   in the design if D3b becomes desirable later.

   Counter-argument for D3c: deterministic-id semantics matter when
   the recorder runs outside the in-process bus. For `llm_usage_events`
   today, the recorder runs only in-process; switching is forward
   work for a future scenario. For `tool_call_events` it's also
   in-process today, but adopting determinism from day one keeps the
   two tables consistent. D3a is the recommendation because Phase 4 is
   a single PR and consistency across tables is a feature.

## Open question E — Outbox columns

Roadmap: "No worker yet — just the schema slot."

Columns:

- `forwarded_at` (int, nullable, indexed) — when the row was successfully
  forwarded to an external metering vendor.
- `forward_attempts` (int, default 0) — how many times we tried.
- `forward_error` (text, nullable) — last error.

Three sub-questions:

1. **One table or two?** Should we also retrofit `llm_usage_events`
   with the same outbox columns?
   - Pro: a future outbox worker needs both tables to ship to a metering
     vendor (LLM tokens + tool calls). Without the columns on
     `llm_usage_events`, we'd land them later in a separate phase.
   - Con: Phase 4 expands scope.
   - **Recommendation:** Yes, retrofit `llm_usage_events` in the same
     phase. Migration 038. The two changes are reviewed together as
     "outbox slots for both tables". Doubling the migration count
     keeps the schema in lockstep.

2. **Default for `forward_attempts`?** SQLite supports `DEFAULT 0` on
   INTEGER columns. Use it; the recorder doesn't have to mention this
   column on insert.

3. **Partial index on `forwarded_at IS NULL`?** SQLite >= 3.8. Bun
   bundles a modern SQLite. Confirm in design. If supported, the
   partial index keeps the "rows still to forward" query cheap as the
   table grows.

   ```sql
   CREATE INDEX idx_tool_call_outbox
     ON tool_call_events (occurred_at)
     WHERE forwarded_at IS NULL;
   ```

## Open question F — Failure path

Phase 2's recorder writes a row on `llm:error` (failure rows have
mostly null counts). What's the equivalent for `tool_call_events`?

- A tool can fail without the whole turn failing — the orchestrator
  catches and reports the failure back to the LLM, the LLM keeps
  going. So a `tool:execute_end` event with `success: false` IS the
  failure path; there's no separate top-level error event.
- `tool:failure_classified` enriches the row with `errorType` /
  `errorCode` etc.

**Decision:** No separate error subscription. Failure rows fall out
naturally from `success=0` rows. The classifier event optionally
enriches; if it doesn't fire (e.g. classifier missing), the row still
has `success=0` and `error_type=NULL`.

## Open question G — Subscribing at startup vs on-demand

Same constraint as Phase 2: the recorder subscribes unconditionally at
startup. The Phase 2 brainstorm (open question D) established that
the bus short-circuits when `listeners.size === 0`, and that having
one always-on subscriber removes the short-circuit — fine for
performance because `dispatch` is in-process Set iteration.

Phase 4 reuses Phase 2's `initUsageRecorder()` call site
(`src/index.ts:74-83`); the additional subscription is folded into the
same init function rather than adding a second `initToolCallRecorder()`.

## Open question H — In-memory state for stepsDetail enrichment

If A2 (subscribe to `llm:end` and unpack `stepsDetail`) is chosen but
`stepsDetail` lacks duration / classifier info, we need a per-turn
buffer.

```ts
// In src/usage/tool-call-buffer.ts
const buffer = new Map<string, { calls: Map<string, ToolCallPartial>; classifications: Map<string, FailurePartial> }>()
```

Lifecycle:

- `tool:request` → register `(turnId, toolCallId)` slot.
- `tool:execute_end` → fill `duration`, `success`, `argsBytes`,
  `resultBytes`.
- `tool:failure_classified` → fill `errorType`, `errorCode`,
  `retryable`, `recovered`.
- `llm:end` / `llm:error` → flush all rows for the turn to the
  recorder, delete the turn's slot.

Open subquestion: if `llm:end` never fires (process crash mid-turn),
the buffer leaks. Two mitigations:
- TTL: remove turn slots after 5 minutes regardless. The orchestrator's
  current call timeout is well under that.
- Periodic GC at next `llm:end` for any turn.

**Recommendation:** TTL via a single `setInterval(60_000)` that
iterates `buffer` and drops slots older than `Date.now() - 5*60*1000`.
Tested via fake timers.

Actually — simpler — flush on every `tool:execute_end`. If the
classifier event arrives later, drop it (or update the row by
`event_id` since the id is deterministic). The dashboard can show
"unclassified" for failures classified after-the-fact and we save
the per-turn buffer machinery entirely.

**Revised recommendation:** Flush on `tool:execute_end`. The classifier
event runs an UPDATE on the row if it arrives (rare race — classifier
usually fires within a few ms of execute_end). Deterministic event_id
makes the UPDATE keyless beyond `event_id`.

This collapses the design to:

- subscribe to `tool:execute_end` → INSERT with computed `event_id`
- subscribe to `tool:failure_classified` → UPDATE the row by
  `event_id`. If the row doesn't exist yet (classifier raced ahead),
  no-op or buffer for 100ms.

This is simpler than the per-turn buffer. Carry to design.

## Open question I — `storage_context_id`, `chat_user_id`, `context_type` on tool events

`tool:execute_end` event today carries `turnId` via the
`emitUser(type, contextId, data, turnId)` signature, but
`contextId` IS the `storage_context_id` (via `scope.userId`).
`chat_user_id` and `context_type` are NOT in the current event data.

Phase 2 added them to `llm:end` / `llm:error`. Same extension needed
for `tool:execute_end` and `tool:failure_classified`:

- `emitUser('tool:execute_end', contextId, { ..., chatUserId, contextType }, turnId)`
- `emitUser('tool:failure_classified', contextId, { ..., chatUserId, contextType }, turnId)`

Both events fire from `src/llm-orchestrator-invoke.ts` — `chatUserId`
and `contextType` are already in scope there (or threaded through from
`InvokeModelArgs`, which Phase 2 extended).

Cost: ~4 lines per emit site, two sites. Same shape as Phase 2.

Alternative: don't extend the event payloads; instead, the recorder
joins to a `llm_usage_events` row for the same `(turn_id)` to pick up
`chat_user_id` / `context_type` / `model`. Risks: race (tool event
arrives before `llm:end` writes the row), and the join is fragile.
**Don't do this.** Extend the events.

## Open question J — Failure-row dedup with `recentToolFailures`

Phase 3's debug dashboard has an in-memory ring buffer
(`src/debug/turn-assembly.ts:62-78`) for `tool:failure_classified`.
With Phase 4, every classifier event also writes a row.

- The dashboard's `recentToolFailures` is for *live SSE dashboarding*.
- Phase 4's `tool_call_events` is for *billing and historical
  analysis*.

They have different purposes and lifetimes. The brainstorm verdict is
to keep both. Phase 3's ring is 1024 deep and ephemeral; Phase 4's
table is persistent. The duplication is intentional.

Open subquestion: could we remove `recentToolFailures` in favor of a
query on `tool_call_events`? Maybe later — phase 4 doesn't touch the
ring buffer.

## Open question K — Test strategy

Two suites:

- `tests/db/migrations/037-tool-call-events.test.ts` (and `038-…` if
  retrofit happens). Asserts schema shape, indexes, defaults.
- `tests/usage/tool-call-recorder.test.ts`. Recorder writes a row on
  `tool:execute_end`; updates a row on `tool:failure_classified`;
  deterministic event_id is stable; outbox columns default correctly.

Plus extending `tests/usage/query.test.ts` if query helpers for the
new table land in this phase. Roadmap doesn't require it, but
Phase 3's pattern suggests landing read-side helpers next to the
write-side.

DI vs `setupTestDb()`: same call as Phase 2 — match the existing
pattern (no DI, use `setupTestDb()`).

## Open question L — Dashboard integration

Roadmap explicitly does NOT include dashboard work in Phase 4:

> Listed for visibility, not committed.

The dashboard can join `tool_call_events` against
`billing_subjects` in a follow-on phase. Phase 4 lands the schema,
recorder, and (deterministic event_id + outbox columns), full stop.

Open subquestion: do we land *any* query helper? Even a basic
`countToolCallsBySubject(windowMs)` makes the migration testable
end-to-end and gives Phase 3's billing tab a future hook. The Phase 2
brainstorm decision (Option H1: ship the minimal query surface that
Phase 3 needs) generalizes: ship the minimal query surface that a
*future* Phase 3-style consumer would need.

**Recommendation:** Ship two read helpers: `listToolCallsForTurn(turnId)`
and `summarizeToolCallsBySubject(windowMs)`. Both have tests against
seeded fixtures. Dashboard work is still out of scope.

## Things explicitly NOT to do in Phase 4

- No outbox worker. Schema columns only.
- No dashboard tab for tool-call details. Future phase.
- No removal of `recentToolFailures` ring buffer. Untouched.
- No removal or change of `llm:tool_result` events (telemetry, not
  billing).
- No content storage — bytes only, never `args`/`result` strings.
- No retroactive backfill. Phase-4-deploy-forward.
- No `bun` dependency additions. SHA-256 via `node:crypto`.
- No change to the wizard, the chat surface, or the LLM hot path
  beyond payload extensions to two events (`tool:execute_end`,
  `tool:failure_classified`).

## Risks identified by the brainstorm

1. **Event payload extensions touch the hot path.** Phase 2 already
   established the pattern; Phase 4 adds ~4 lines per emit site. Low
   risk if tests cover both events.

2. **Classifier-vs-execute_end race.** The classifier event can arrive
   before or after the recorder INSERT. The brainstorm verdict is
   to UPDATE on classifier, INSERT on execute_end. If UPDATE finds no
   row, it's a no-op — but a no-op means the row never gets the
   classifier fields. Mitigation: in the recorder, INSERT first, then
   UPDATE, with a small (≤100ms) in-memory queue for late-arriving
   classifier events. Design call.

3. **Deterministic id collisions.** `hash(turnId, toolCallId)` with
   SHA-256 truncated to 128 bits has birthday-collision probability
   ~10⁻¹⁹ per 1B rows. Safe. But if anyone ever recycles
   `(turnId, toolCallId)` pairs across deployments (they're UUIDs;
   they shouldn't), we get a PK violation. Acceptable — the recorder
   catches and logs.

4. **`stepsDetail` shape coupling.** If we go A2 (mentioned briefly
   above), changes to `buildStepsDetail` would break the recorder.
   Verdict above is to skip A2; the recorder reads from
   `tool:execute_end` events directly. Confirms low coupling to the
   step-detail format.

5. **Migration ordering with the open Phase 1→3 chain.** All three
   prior phases have shipped. No migration-ordering conflict.

6. **Outbox columns on `llm_usage_events`.** If we retrofit (migration
   038), the schema gains columns that no current code path uses. Risk
   is a future contributor seeing them as "unused" and removing them.
   Mitigation: comment in the migration SQL referencing the Phase 4
   roadmap entry. Doc updates touch CLAUDE.md's "Architecture" section
   for the schema.

7. **TDD hook policy.** Every src/ edit needs a failing test first.
   Sequencing: schema migration test → migration → recorder test →
   recorder → event payload tests → event payload extensions →
   integration tests. Same shape as Phase 2.

## Forward-compatibility check

- **Phase 5 (anonymous stats).** Adds aggregated counts per subject;
  `tool_call_events` is read-only fodder for those. No schema lock.
- **Future metering vendor.** Outbox columns are pre-positioned;
  worker is greenfield but the schema slot is ready.
- **Future Phase 3 dashboard extensions.** Read helpers shipped here
  are the foundation; dashboard work is a small additive lift later.

## Summary of decisions to lift into the per-phase design

1. **New table `tool_call_events`** with the column set listed in
   open question B. Migration 037.
2. **Retrofit `llm_usage_events` with outbox columns** in the same
   phase. Migration 038.
3. **Recorder subscribes to `tool:execute_end` (INSERT) and
   `tool:failure_classified` (UPDATE by event_id).** No per-turn
   buffer.
4. **Deterministic event_id** via
   `sha256(turnId || toolCallId).slice(0, 32)` for tool-call rows and
   `sha256(turnId || responseId || modelRole)` for usage rows. Existing
   usage rows keep their random UUIDs (no backfill).
5. **`emitUser('tool:execute_end', ...)` and
   `emitUser('tool:failure_classified', ...)` payloads gain
   `chatUserId` and `contextType`.** Plumbed in invoke.ts; both are
   already in scope.
6. **`src/usage/` extends** with `tool-call-recorder.ts`, `event-id.ts`,
   and additions to `index.ts` / `query.ts` / `types.ts`. No new
   sibling module.
7. **Two read helpers ship:** `listToolCallsForTurn(turnId)` and
   `summarizeToolCallsBySubject(windowMs)`. Dashboard wiring out of
   scope.
8. **No worker, no outbox poll, no dashboard.** Schema slots + recorder
   only.
9. **`args_bytes` / `result_bytes` recorded; raw values never recorded.**
   Bytes-only contract carried forward to Phase 5 anonymity work.
10. **Tests follow Phase 2 pattern** — `setupTestDb()` + migration
    chain runner, no DI, recorder unit tests, integration test that
    fires a fake `tool:execute_end` and asserts row shape.

## Out of brainstorm (carry to plan, not design)

- Exact test file locations and T-then-I ordering inside the
  implementation steps.
- Commit grouping when the diff lands (likely: migrations → schema →
  events extension → recorder → query → docs).
- Manual smoke checklist (fire one real LLM turn that triggers a
  tool call, eyeball the row).
- Whether to add a `bun knip` ignore for the new exports if the
  dashboard wiring is a deferred follow-on phase (same approach as
  Phase 2's `c0e8960` commit that marked usage module exports as
  "Phase-3-pending").

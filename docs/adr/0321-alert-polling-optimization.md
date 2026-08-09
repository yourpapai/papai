<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0321: Alert Polling Optimization — Change Gate, Edge-Triggered Firing, and Batched Per-Context Dispatch

## Status

Accepted

## Date

2026-08-07

## Context

Condition alerts (`alert_prompts`) are evaluated by a 5-minute poller (`pollAlertsOnce`). The original per-alert, per-context flow had three cost/quality problems:

1. **API load.** Every cycle, every delivery context fetched the full task list (`listProjects` + `listTasks` per project) independently, even when several contexts shared the same task instance. When any alert condition referenced `task.assignee` or `task.labels`, **every** task was re-fetched via `getTask` — even when nothing had changed.
2. **Alert semantics.** State-based conditions (`eq`, `neq`, `contains`, `overdue`) re-fired every cooldown period as long as the condition kept matching — "alert me when status = done" repeated forever.
3. **LLM cost.** Each firing alert ran its own full `dispatchExecution` generation, even when several alerts in the same delivery context fired in the same cycle.

Neither task provider supports webhooks or incremental fetch (`updatedSince`), and near-real-time latency is not a goal — so the 5-minute poll stays, and the optimization targets everything downstream of the raw fetch.

Source: spec `docs/superpowers/specs/2026-07-23-alert-polling-optimization-design.md`; plan `docs/superpowers/plans/2026-07-23-alert-polling-optimization.md`.

## Decision Drivers

- **Quiet cycles must be nearly free.** A cycle with no task changes costs only the unavoidable `listProjects`/`listTasks` calls — zero `getTask`, zero evaluation, zero LLM.
- **Edge-triggered semantics.** Fire when a task newly matches; stay silent while the same tasks keep matching; re-fire when a task leaves and re-enters the match.
- **One LLM generation per delivery context per cycle**, no matter how many alerts fire.
- **Share fetches per task instance** across delivery contexts on the same `configContextId`.
- **Preserve existing guarantees**: cooldown semantics, snapshot-based `changed_to`, and delivery-failure retry (no state writes on failure, so the diff survives to the next cycle).
- **Fail toward evaluation, never toward silence.** Enrichment failures abort the cycle rather than silently dropping tasks (which would cause match-set flapping).

## Considered Options

### Option 1 — Two-level pipeline with change gate, per-alert match sets, and batched firing (chosen)

Restructure the alert poller into a two-level grouping: eligible alerts are grouped by `configContextId` (task instance) for one shared fetch, then per delivery context (`storageContextId`) a snapshot-based **change gate** compares the fetched tasks against stored snapshots and skips the context entirely when nothing changed; per alert an **edge gate** (`matchedNow − matchedTaskIds`) decides firing; all newly-firing alerts in a context share one batched `dispatchExecution` call. Supporting pieces: a `matched_task_ids` column on `alert_prompts`, a `labels` entry in `SNAPSHOT_FIELDS`, a `change-gate.ts` module (`hasTaskChanges`, lightweight vs. rich snapshot field sets), and `enrichTasks` failing loudly on any `getTask` rejection.

- **Pros:** quiet cycles are nearly free; infinite re-fire is fixed; LLM calls collapse to one per context per cycle; fetch sharing is bounded by the number of distinct task instances, not contexts; failure modes are self-healing (no writes on failure → automatic retry).
- **Cons:** one-time re-fire after deploy (all stored match sets start empty); the lightweight change gate cannot see assignee/label changes, so contexts with rich-field alerts still pay `getTask` enrichment on every cycle the gate cannot prove quiet; an extra DB column and match-set bookkeeping.

### Option 2 — Keep per-context fetching, add edge-triggering only (rejected)

Add `matched_task_ids` and batched firing but leave the per-context fetch loop unchanged.

- **Pros:** smaller diff; fixes the semantic re-fire problem and LLM batching.
- **Cons:** leaves the dominant cost in place — every context still fetches the full task list and rich-field contexts still enrich every task every cycle; misses the "quiet cycles nearly free" goal.

### Option 3 — Push to event-driven / incremental fetch (rejected)

Add provider-side webhooks or an `updatedSince` contract.

- **Pros:** eliminates polling cost at the source.
- **Cons:** neither provider plugin supports it; a provider-contract change is out of scope (listed as a possible later extension, not a prerequisite); near-real-time latency is not a goal, so the 5-minute poll is acceptable.

## Decision

Implement Option 1. Concretely:

- `pollAlertsOnce` groups eligible alerts two levels deep — `configContextId` → `storageContextId` — with one `listProjects`/`listTasks` fetch per task instance (`src/deferred-prompts/poller-alerts.ts`).
- The change gate (`src/deferred-prompts/change-gate.ts`) compares fetched tasks against per-context snapshots over a lightweight field set (`status`, `priority`, `dueDate`, `project`), or the rich set (plus `assignee`, `labels`) when any alert in the context needs full tasks; no diff → skip evaluation and LLM entirely.
- `alert_prompts.matched_task_ids` (TEXT, JSON array, default `'[]'`) stores each alert's last match set; an alert fires only when `matchedNow − matchedTaskIds ≠ ∅`.
- All newly-firing alerts in a context share one `dispatchExecution` (merged numbered prompts, `mergeExecutionMetadata`, per-alert summary listing only newly matched tasks); the context's fire is all-or-nothing per cycle.
- `enrichTasks` throws on any `getTask` rejection; the instance cycle aborts before evaluation so no match-set or snapshot state is written.
- `SNAPSHOT_FIELDS` gains a `labels` entry (sorted, comma-joined label names).

## Consequences

### Positive

- Quiet cycles cost only the unavoidable list calls; `getTask` enrichment runs only when a context gated in by the lightweight check needs rich fields.
- State-based alerts fire once per new match instead of repeating every cooldown.
- LLM spend per context per cycle is one generation regardless of how many alerts fire.
- Fetch volume scales with distinct task instances, not delivery contexts.
- Failure paths preserve the pre-existing self-healing property: no state writes on failure, so the next cycle retries the same diff.

### Negative

- **One-time re-fire on deploy:** every alert's stored match set starts empty, so its first eligible cycle fires for all currently-matching tasks (cooldown still applies). Accepted over a permanent "prime silently" flag to avoid carrying the flag forever.
- Rich-field contexts (alerts on `task.assignee` / `task.labels`) cannot be proven quiet by the lightweight gate, so they still pay full enrichment per cycle once any change is suspected.
- A task whose snapshot fields are all null never writes snapshot rows, so the change gate keeps reporting "changed" for it — a deliberate fail-toward-evaluation choice that costs some evaluation cycles.

### Risks

- The batched fire is all-or-nothing per context: one alert's malformed prompt can block delivery of the whole batch for that cycle. Mitigation: LLM failure path sends a single error notice and marks the batch handled; delivery failure marks nothing and retries.

## Implementation Notes

- The migration landed as **069** (`src/db/migrations/069_alert_matched_task_ids.ts`), not 068 as planned — the 068 slot was taken by `068_identity_scoped_key_cleanup`; its test lives at `tests/db/migrations/069_alert_matched_task_ids.test.ts`.
- `enrichTasks` gained a `ProviderRequestScope` parameter beyond the planned signature.
- The poller moved into `src/deferred-prompts/poller-alerts.ts`; `poller.ts` re-exports `pollAlertsOnce` so existing imports keep working.
- Poller tests use `createAlertPrompt(..., cooldown = 0)` so a fired alert stays eligible within the same test — otherwise silence assertions pass vacuously.

## Related Decisions

- ADR-0302: Remove Deferred-Prompt Execution Modes — the unified proactive firing path this pipeline dispatches through.

## References

- Spec: `docs/superpowers/specs/2026-07-23-alert-polling-optimization-design.md`
- Plan: `docs/superpowers/plans/2026-07-23-alert-polling-optimization.md`

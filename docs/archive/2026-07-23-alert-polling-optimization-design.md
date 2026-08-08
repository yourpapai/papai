<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Alert polling optimization: change gate, edge-triggering, batched firing

**Date:** 2026-07-23
**Status:** Approved (design)

## Problem

Condition alerts (`alert_prompts`, event-based triggers) are evaluated by a 5-minute
poller (`pollAlertsOnce`, `src/deferred-prompts/poller.ts`). The current flow has three
cost/quality problems:

1. **API load.** Every cycle, every delivery context fetches the full task list
   (`listProjects` + `listTasks` per project). Contexts sharing the same task instance
   each fetch independently. When any alert condition references `task.assignee` or
   `task.labels`, **every** task is re-fetched via `getTask` — even when nothing changed.
2. **Alert semantics.** State-based conditions (`eq`, `neq`, `contains`, `overdue`)
   re-fire every cooldown period as long as the condition keeps matching — an
   "alert me when status = done" alert repeats forever every 60 minutes.
3. **LLM cost.** Each firing alert runs its own full `dispatchExecution` generation, even
   when several alerts in the same delivery context fire in the same cycle.

Neither provider plugin supports webhooks or incremental fetch (`updatedSince`), and
near-real-time latency is not a goal — so the 5-minute poll stays. The optimization
targets everything downstream of the raw fetch.

## Goals

- Quiet contexts (no task changes) cost only the unavoidable `listTasks` calls — zero
  `getTask`, zero evaluation, zero LLM.
- Alerts are **edge-triggered**: fire when a task newly matches, stay silent while the
  same tasks keep matching, re-fire only when a task leaves and re-enters the match.
- One LLM generation per delivery context per cycle, no matter how many alerts fire.
- Keep cooldown semantics, snapshot-based `changed_to`, and the existing
  delivery-failure retry guarantees.

### Non-goals (YAGNI)

- No `updatedSince`/incremental provider contract change (possible later extension).
- No webhooks / event-driven triggers.
- No per-alert poll intervals, no template-only alerts, no rich-field refresh cadence.

## Design

### Pipeline restructure (`src/deferred-prompts/poller.ts`)

`pollAlertsOnce` moves from per-context fetch to a two-level grouping:

```
group eligible alerts by configContextId (task instance)
  └─ per task instance:
      ├─ buildProviderFn(configContextId) once
      ├─ fetchAllTasks(provider) once            ← shared across delivery contexts
      └─ per delivery context (storageContextId):
          ├─ load snapshots (per context, as today)
          ├─ CHANGE GATE (see below) → skip context entirely when nothing changed
          ├─ enrichTasks once per instance when ≥1 gated-in context needs rich fields
          ├─ EDGE GATE per alert: newMatches = matchedNow − matchedTaskIds
          ├─ BATCH: one dispatchExecution per context for all newly-firing alerts
          └─ finalize per fired alert; advance snapshots per context
```

Eligibility (active + cooldown expired, `getEligibleAlertPrompts`) remains the pre-filter.

### Change gate

Compare the fetched lightweight task list against the context's stored snapshots
(`task_snapshots`, keyed `${taskId}:${field}`): task id set plus `status`, `priority`,
`dueDate`, `project` values.

- **No diff AND no alert in the context references rich fields** (`task.assignee`,
  `task.labels`): skip the context — no enrichment, no evaluation, no snapshot writes.
- **Rich-field alerts present**: a pure reassignment or label change is invisible in
  `TaskListItem`, so the lightweight gate cannot be trusted. The context enriches (all
  tasks via `getTask`, shared per instance when several gated-in contexts need it), then
  compares the enriched data against snapshots **including labels** (see snapshot change
  below). If still no diff: skip evaluation and LLM; snapshots unchanged.

### Edge-triggered match sets

`alert_prompts` gains a column:

```
matched_task_ids TEXT NOT NULL DEFAULT '[]'   -- JSON array of task IDs
```

Semantics:

- **Fire** when `matchedNow − matchedTaskIds ≠ ∅` (at least one newly-matching task).
- **Silent** while the same tasks keep matching — fixes the infinite re-fire problem.
- **Re-entry re-fires**: the stored set tracks last-evaluated `matchedNow`, so a task
  that leaves and later re-enters the match appears as new again.
- **Update rules:**
  - successful delivery → `matchedTaskIds := matchedNow` (+ `lastTriggeredAt`);
  - silent cycle (evaluated, no new matches) → `matchedTaskIds := matchedNow`;
  - delivery/LLM failure → **no write** — the diff survives to the next cycle, so retry
    is automatic (same self-healing property snapshots have today).
- **Cooldown unchanged.** Matches accumulating during cooldown are reported as one batch
  when the alert becomes eligible again; no events are lost, rate stays capped.
- **`changed_to` unchanged** — still snapshot-driven. The match-set gate sits on top and
  does not alter its semantics.

### Snapshots

`SNAPSHOT_FIELDS` (`src/deferred-prompts/snapshots.ts`) gains `labels`; the stored value
is the sorted, comma-joined label names. No schema change — the `field` column is free
text. Existing rows simply lack `labels` entries until the next rich cycle populates them.

### Batched firing

All newly-firing alerts in a delivery context share one `dispatchExecution` call:

- merged numbered prompt list (same format as `pollScheduledOnce`'s merge);
- `mergeExecutionMetadata` across firing alerts;
- combined matched-tasks summary: one section per alert — `Alert condition: <desc>` plus
  that alert's **newly** matched tasks only.

On success one message is delivered; each firing alert's `lastTriggeredAt` and
`matchedTaskIds` are updated; `deferred:alerted` / `notify:deferred_alert` events still
emit per alert. A context's fire is **all-or-nothing per cycle** — one LLM call, one
message — which keeps match-set and snapshot invariants trivial.

### Migration

One new migration adds `matched_task_ids` with default `'[]'`. Consequence: a **one-time
re-fire** — after deploy, every alert's stored set is empty, so its first eligible cycle
fires for all currently-matching tasks (cooldown still applies, so recently-fired alerts
stay quiet until eligible). After that cycle, edge semantics take over. Accepted over a
permanent "prime silently" flag to avoid a single bounded burst.

## Error handling

- **Fetch failure** (`listProjects`/`listTasks` throws): the whole task-instance group is
  skipped for the cycle; logged via the existing `Promise.allSettled` +
  `logSettledErrors` path. Unchanged.
- **Enrichment failure** (any `getTask` rejects): today `enrichTasks` silently drops
  failed tasks, which with match sets would cause flapping (a dropped task leaves
  `matchedNow`, re-enters next cycle, re-fires). `enrichTasks` now **throws** on any
  rejection → the context's cycle aborts before evaluation → no match-set writes, no
  snapshot advance → clean retry next cycle. Logged `warn` with taskId. One bad task
  costs a context one 5-minute cycle and self-heals.
- **LLM failure** (batched `dispatchExecution` throws): mirrors today's single-alert
  path — send the "something went wrong" text once; if that delivery succeeds, record
  history and mark **all** firing alerts handled (trigger time + match sets, no user
  events), matching `markAlertDelivered(…, emitNotifications=false)`. If the error text
  itself fails to deliver, nothing is marked → retry next cycle.
- **Delivery failure** (LLM succeeded, `sendProactiveMessage` fails): no trigger times,
  no match-set updates, no snapshot advance → full retry next cycle. Cooldown never eats
  a retry because `lastTriggeredAt` was never stamped.

## Testing

All under `tests/deferred-prompts/` (Bun, existing DI patterns):

- **Migration** — new column exists, defaults to `'[]'`, existing rows remain readable
  (pattern: `tests/db/deferred-prompt-delivery-migration.test.ts`).
- **Store** (`alerts.test.ts`) — `matchedTaskIds` round-trips through create/update; new
  `updateAlertMatchState` helper writes trigger time + match set atomically.
- **Change gate unit tests** — lightweight diff vs snapshots (no change / status change /
  new task / removed task / label-only change via the rich path); gate skips when no rich
  alerts exist, defers when they do.
- **Edge-trigger poller tests** (`poller.test.ts`):
  1. persistent `eq` match fires once, second poll silent;
  2. new task entering the match re-fires, summary contains only the new task;
  3. task leaving + re-entering re-fires;
  4. quiet context performs zero `getTask` / zero LLM calls (spy counts);
  5. two alerts in one context → exactly one `dispatchExecution`, both prompts merged;
  6. two contexts on the same task instance → one `listTasks` sweep (provider spies);
  7. delivery failure → no match-set write → next poll retries the same diff;
  8. enrichment rejection aborts the context, nothing written.
- **Existing tests** — first-fire behavior with an empty match set is unchanged, so most
  keep passing; any test asserting re-fire on a persistent match is updated to the new
  semantics. Full `bun run test` + lint/typecheck at the end.

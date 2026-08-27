# Design — alert task watch

## Context

The alert system today evaluates conditions over the *entire* task list of a task instance: `pollAlertsOnce` groups eligible alerts per config context + effective task instance (`poller-alerts-grouping.ts`), `fetchAllTasks` (`src/deferred-prompts/fetch-tasks.ts`) enumerates the instance via `listProjects`/`listTasks` (fallback `searchTasks`), and each context group gates evaluation on `hasTaskChanges` (`change-gate.ts`) before running `evaluateCondition` (`condition-eval.ts`) with matched-set edge semantics against per-context snapshots (`snapshots.ts`, keyed `${taskId}:${field}` per storage context id). Condition fields are declared in `types.ts` (`CONDITION_FIELDS`, `FIELD_OPERATORS`, recursive `and`/`or` schema). `getTask(taskId)` is a **required core** `TaskProvider` method (`src/providers/types.ts:108`) — no capability string gates it. See `proposal.md` for motivation.

Constraints that shape the approach:

- `hasTaskChanges` reports "changed" whenever the fetched-id set differs in size from the stored-snapshot id set — correct for whole-list fetches, wrong for a targeted fetch of a subset (it would always report changed).
- Providers classify failures into `ProviderError` codes (`src/providers/errors.ts`), including `task-not-found` / `not-found`, so "task is gone" is distinguishable from transport/auth failure at the poller layer.
- `p-limit` is already a dependency used throughout the poller.

## Goals / Non-Goals

**Goals:**

- Make `task.id eq` expressible through the existing `create_alert`/`update_reminder` condition schema, composable with all existing fields.
- Give pure per-task watches change-triggered firing semantics (any snapshot-visible change to a watched task).
- Skip whole-instance enumeration when an instance poll serves only pure watches.
- Keep composed-condition semantics and the whole-list path byte-for-byte in behavior.

**Non-Goals** (beyond proposal Non-goals):

- No new module, tool, DB table, or dependency — everything lands in existing files.
- No change to snapshot storage format, delivery, batching, or the proactive scope/lease model.
- No activity/history-based change detection (`getTaskHistory` stays untouched).

## Decisions

### D1 — `task.id` rides the existing leaf machinery, not a new condition kind

Add `'task.id'` to `CONDITION_FIELDS`, `FIELD_OPERATORS['task.id'] = ['eq']` in `types.ts`; add a `case 'task.id': return task.id` to `getFieldValue` in `condition-eval.ts`. The existing `eq` branch (`fieldValue === String(value)`) then matches exactly the task whose id equals the value, with number-or-string values coerced for free; `superRefine` in `types.ts` already emits the right operator/value errors per field. No schema branch, no new operator.

*Alternative considered:* a dedicated `watch` input shape on `create_alert` — rejected: parallel surface, more LLM confusion, and it would still need condition composition to be useful.

### D2 — Watch classification helpers live in `condition-eval.ts`

`extractWatchedTaskIds(condition): string[]` and `isPureWatchCondition(condition): boolean` are exported from `condition-eval.ts`, mirroring the existing tree-walk pattern (`extractFields` in `fetch-tasks.ts` is private and enrichment-specific; `condition-eval.ts` already owns condition-tree semantics). `isPureWatchCondition` = every leaf in the tree is `field='task.id'` and `op='eq'`; `extractWatchedTaskIds` collects the eq values from the same walk (nested `and`/`or` included).

### D3 — Pure watches use per-task field compare, NOT `hasTaskChanges`

A pure watch fires when a watched task differs from its stored snapshot on the change-gate field set (`LIGHTWEIGHT_SNAPSHOT_FIELDS`, or `RICH_SNAPSHOT_FIELDS` when the cycle carried enriched tasks — pure watches never *require* enrichment themselves, since `task.id` is not in `FIELDS_REQUIRING_FULL_TASK`). Comparison is per watched task via `snapshots.get(`${task.id}:${field}`)`.

*Why not reuse `hasTaskChanges`:* its fetched-vs-stored **set-size** check assumes the fetched set is the context's full task set. With a targeted fetch the fetched set is a subset of the stored ids, so it would report "changed" every cycle and destroy the semantics. Making `hasTaskChanges` accept a subset would loosen its contract for all existing callers for a concern that is genuinely different (per-task change, not per-context change).

Consequences handled by this decision:

- **Baseline:** a watched task with no stored snapshot establishes baseline this cycle without firing (snapshot writes already happen on every delivered/non-firing cycle via the existing `if (delivered) updateSnapshots(...)`).
- **Missing watched task:** skipped with a `warn`, not fatal (see D5).
- **Bookkeeping on fire:** reuse `updateAlertMatchState` exactly as today, with matched ids = watched ids present in the fetched set.

### D4 — Partition at the instance level, in `poller-alerts.ts`

`fetchAlertTasks` already spans all routable context groups of one instance poll. Extend that function: if **every** alert across **every** routable group `isPureWatchCondition`, fetch the **union** of `extractWatchedTaskIds` (deduped across groups and alerts) via the new targeted fetch and skip `fetchAllTasks` entirely (no `listProjects`/`listTasks`/`searchTasks`); otherwise keep the whole-list path verbatim (enrichment as today). The targeted fetch runs on the same pinned provider inside the same provider-request-scope lease — instance pinning (`taskInstanceId`, `pinnedBuildProviderFn`) is untouched.

In context-group evaluation (`executeAlertsForContext`), pure watches take the D3 per-task compare branch; non-watch alerts keep the matched-set edge path and the `hasTaskChanges` early return. When both kinds share a group (mixed instance), the early return stays: if the gate says nothing changed in the gated field set, no watched task changed either, so skipping is safe and preserves today's behavior exactly.

### D5 — `fetchWatchedTasks` in `fetch-tasks.ts`: skip not-found, reject the rest

`fetchWatchedTasks(provider, ids, scope)` calls `provider.getTask` per id under a small fixed module-level `p-limit` constant (alongside the existing `MAX_CONCURRENT_*` pattern), inside `runWithProviderRequestScope` — mirroring `enrichTasks` one file over. Per-id settlement: a failure classified as not-found (the provider error taxonomy's `task-not-found`/`not-found` codes, `src/providers/errors.ts`) is dropped with a `warn`; **any other error rejects the whole call**, which aborts that instance's cycle (no firing, no snapshot/state updates), consistent with how `enrichTasks` failure already aborts a cycle. `getTask` being a required core method means no capability gating is needed for the targeted path.

### D6 — No new tool surface; description-only discoverability

The LLM surface is the existing `create_alert` (and `update_reminder`) condition schema; there is no new tool, so **capability gating and `tool_prefs` (allow/ask/deny) semantics are unchanged** — `task.id` conditions are accepted wherever `create_alert` already runs. Tool/schema `.describe()` text in `src/tools/create-alert.ts` and `types.ts` (condition + cooldown descriptions) is updated to mention per-task watch so the model can discover the pattern.

### D7 — Scope model: no new persisted state

No DB changes, no migrations, no backfill — the condition is stored as JSON in the existing alert row, and `'task.id'` is just a new accepted enum value (old rows validate as before; new rows are only written by new code). Reused state and its keys:

- **Snapshots** (baseline + change detection): existing store keyed by **storage context id** (`getSnapshotsForUser(storageContextId)`) — watch baselines are therefore thread-scoped in Telegram/Mattermost groups and DM-scoped otherwise, identical to alert snapshots today.
- **Alert rows** (condition, `lastTriggeredAt`, `cooldownMinutes`, `matchedTaskIds`, `taskInstanceId` pin): keyed by **creating user id** as today.
- **Partitioning** (targeted vs whole-list): keyed by **config context id + effective task instance** as today.

## Risks / Trade-offs

- [Two evaluation branches (per-task compare vs matched-set edge) drift apart] → Both mixed-path and targeted-path pure-watch evaluation call one shared per-task change helper (D3); poller tests cover both paths against the same fixtures.
- [Delivery failure leaves snapshots stale, so a pure watch re-fires next cycle] → Same exposure and guard as existing alerts (`updateSnapshots` only after successful delivery-or-error-handling); not made worse by this change.
- [Instance with many watches on distinct tasks issues many `getTask` calls] → Fixed small `p-limit` constant + union dedupe across groups/alerts; worst case degrades to enrichment-like traffic, strictly below whole-list enumeration on large instances.
- [Deleted/inaccessible watched task warns every cycle] → Accepted (warn level, no fire, no abort); the user cancels the watch. An access-denied classification rejects the cycle rather than silently skipping, so a misconfigured token surfaces in logs.
- [Rollback after `task.id` alerts exist] → Old code's `getFieldValue` returns `undefined` for unknown fields, so such alerts simply never match and never fire — silent but safe; no data format to unwind.

## Migration Plan

Code-only; no feature flag needed. Deploy order is irrelevant (single process). Rollback = revert the commit; see the risk note above for the behavior of stranded `task.id` alerts.

## TDD / hook interactions

All files touched are under `src/` and `tests/`, so the Write/Edit TDD hook pipeline gates every edit — new test files included. Failing-test-first order (mirrors dependency bottom-up):

1. `tests/deferred-prompts/types.test.ts` — `task.id` accepted with `eq`, rejected with other ops / missing value, composes under `and`/`or`.
2. `tests/deferred-prompts/alerts.test.ts` (`evaluateCondition` block) — `task.id` predicate; `extractWatchedTaskIds` on nested trees; `isPureWatchCondition` truth tables.
3. `tests/deferred-prompts/fetch-tasks.test.ts` — `fetchWatchedTasks` calls `getTask` per id, bounded concurrency, not-found skipped with warn, other errors reject.
4. `tests/deferred-prompts/poller-alerts.test.ts` — partition + firing behaviors (pure-watch instance never calls `listProjects`/`listTasks`/`searchTasks`; fires on snapshot-visible change; no fire on baseline/unchanged cycles; cooldown respected; mixed group keeps whole-list path + early return; composed conditions keep matched-set edges).

Then implementation in the same order, then `bun run test tests/deferred-prompts`, `bun run typecheck && bun run lint`, full suite before finishing.

## Open Questions

- Exact value of the `fetchWatchedTasks` concurrency constant (3–5) — deferrable; any small fixed bound satisfies the spec, tunable after the first real instance data.

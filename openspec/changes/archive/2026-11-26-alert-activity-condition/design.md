## Context

The alert pipeline today: `alert_prompts` rows carry a field/op/value condition tree (`and`/`or` combinators over `task.*` leaves), `matched_task_ids`, `last_triggered_at` + `cooldown_minutes`, and (since 081) a `task_instance_id` pin. `pollAlertsOnce` groups eligible alerts by `(configContextId, effective task instance)`, partitions each instance on the **full active set** — an instance whose routable alerts are all pure `task.id eq` watches skips the whole-list fetch and does targeted `getTask` calls (poller-alerts.ts:188, fetch-tasks.ts:141) — evaluates non-watch conditions against the fetched task list with per-storage-context snapshots, and fires per context as one batched LLM dispatch whose summary wraps task fields as untrusted (`buildAlertSummary`).

The provider contract already exposes what we need: optional `getTaskHistory(taskId, { categories, limit, offset, reverse, start, end, author })` returning `Activity { id, timestamp, author?, category, field?, added?, removed? }`, capability-gated by `activities.read` and surfaced to the LLM as `get_task_history` (tools-builder.ts:199). `create_alert` is assembled provider-independently (`addDeferredPromptTools`), while the provider — and therefore the capability fact — is only known inside `buildTools`. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**

- Activity alerts ride the existing instance-grouped poll loop, partition, cooldown filter, and per-context fire batch — a third evaluation path, not a second poller.
- One cursor per alert row; no new tables, no per-(alert, task) cursor state.
- Zero behavioral change to pure-watch and field-value alert paths, including the partition-stability rule (partition computed on the active set, not the eligible subset).

**Non-Goals** (beyond the proposal's):

- No per-task cursors and no snapshot integration — the activity path neither reads nor writes `task_snapshots`.
- No changes to delivery modes, batching UX, or the proactive dispatch pipeline.
- No `update_reminder`-path capability gating (poll-time degradation covers it; see D6).

## Decisions

### D1: `kind`-discriminated activity leaf inside the existing condition union

Add `activityLeafSchema` (`kind: 'activity'`, required `taskId`, optional `categories`) as a fourth member of `alertConditionSchema`; the existing `z.lazy` recursion already lets it nest under `and`/`or`. Walkers discriminate structurally — `'and' in node` / `'or' in node` / `'kind' in node` / else field leaf — so `describeCondition`, `extractFields` (skips activity leaves; they need no task-list fields), and the evaluation walkers stay total functions over the widened union. `evaluateCondition` returns `false` for stray activity leaves: they are routed to the history path before list evaluation ever runs, so this is a defensive never-crash branch, not a semantic one.

**Alternative:** reuse the field/op shape with a synthetic `task.activity` field and `op: 'new'`. Rejected — it pollutes `FIELD_OPERATORS` typing and `alertsNeedFullTasks`, cannot express `categories` cleanly, and makes the mixed-tree refusal (D6) awkward to detect.

### D2: One nullable cursor column; NULL is the baseline marker

`alert_prompts.last_activity_cursor TEXT NULL` (migration `082_alert_activity_cursor`, `PRAGMA table_info` idempotence guard per the 069/081 pattern, registered after 081). `NULL` means "baseline not yet established": the first poll stores the newest timestamp seen and fires nothing; subsequent polls fire on entries strictly newer than the cursor; the cursor advances only after **successful delivery** (new `updateAlertActivityState(id, userId, lastTriggeredAt, lastActivityCursor)` sibling to `updateAlertMatchState` — baseline calls pass `lastTriggeredAt: null`). Cooldown falls out of the existing `getEligibleAlertPrompts` filter: an alert in cooldown is never polled, so entries arriving during cooldown are delivered (in bulk, one summary) when cooldown elapses — catch-up, not loss. Updating an alert's condition resets the cursor to NULL alongside the existing `matched_task_ids` reset in `updateAlertPrompt`, so a repointed watch re-baselines instead of firing on stale edges.

**Alternative:** per-(alert, task) cursors in a JSON blob or join table. Rejected — multi-task activity trees are rare and the spec fixes a single per-alert cursor (= max newest timestamp across the union).

**Alternative:** seed the cursor from creation time and pass `start` to `getTaskHistory`. Rejected — provider clocks skew against the bot clock; first-poll baseline stays on the provider's own timeline.

**Scope-model impact:** the only new persisted state lives on the `alert_prompts` row itself, inheriting its existing keys — `created_by_user_id`, delivery `storage_context_id` (thread-scoped where the platform threads), config context derived from delivery, and the `task_instance_id` pin. No new storage-context-, config-context-, or user-keyed store is introduced; `task_snapshots` (storage-context-keyed) is untouched.

### D3: Extend the instance partition to "targeted"; instance-level history dedup

Redefine the partition predicate (still computed over the full active set, preserving the existing mid-life stability rule) from "all pure-watch" to "all targeted": every routable alert is a pure watch **or** a pure-activity tree. A targeted instance performs no `listProjects`/`listTasks`/`searchTasks`: watched ids go through `getTask` as today; the deduped union of activity `taskId`s across the instance's routable contexts goes through `getTaskHistory` once per task per instance poll (mirroring `fetchWatchedTasks` dedup), with evaluation then split back per routable context. Mixed instances run the list fetch for their field alerts while activity alerts still take the history path. At poll time the capability is re-checked (`provider.getTaskHistory === undefined || !provider.capabilities.has('activities.read')`) — capability is only knowable against the resolved provider, and config can change after creation — and loss means `log.warn` + skip that alert with the cursor unchanged; the cycle never crashes and other alerts proceed. History calls run under `runWithProviderRequestScope` inside a p-limit (matching `WATCHED_TASK_FETCH_CONCURRENCY`).

**Alternative:** a separate activity poll loop. Rejected — it would duplicate instance grouping, routability checks, scoping, and cooldown filtering that the existing loop already owns.

### D4: Fetch `{ categories }` only; compare client-side

History lookups pass only the condition's categories (when present) — no `start`, no `limit` — sort returned entries by `Date.parse(timestamp)` (guarding unparseable values with skip + warn), and filter strictly newer-than-cursor client-side. Correctness over bandwidth: passing `start`/`limit` presumes every provider implements windowing semantics identically, and a `limit` window can silently skip entries older than the window while the cursor advances past them. The cost — refetching full history per poll on busy tasks — is bounded by poll cadence and can be optimized later without touching the spec.

### D5: Activity firings join the existing per-context fire batch

When activity alerts and field alerts fire in the same context in the same cycle, they merge into the single existing `fireAlertBatch` dispatch (one LLM call, one delivery, `markAlertsDelivered`-style state writes routed to `updateAlertActivityState` for activity alerts). The summary gains activity sections built by a sibling of `buildAlertSummary` sharing its helpers: the `EXTERNAL_DATA_FRAMING` preamble plus `wrapUntrusted` over every activity-derived value — author, category, field, added, removed — so none of it can pose as bot output.

**Alternative:** a second dispatch per context for activity alerts. Rejected — two proactive messages per cycle per context is a UX regression and doubles LLM calls.

### D6: Creation gating via an assembly-time boolean; shared tree validator on write paths

The capability fact (`capabilities.has('activities.read') && getTaskHistory !== undefined`) is computed once in `buildTools`, where the provider exists, and plumbed as a boolean — `buildTools` → `addProviderIndependentTools` → `addDeferredPromptTools` → `makeCreateAlertTool` → `executeCreate`. Tools never construct providers. The null-task-instance check stays where it already lives (`createAlert` reads context settings); either failure returns the standard `{ error }` guidance shape. The pure-tree rule (no activity leaf mixed with field leaves) is enforced by a shared validator applied wherever a condition is parsed for storage — `createAlert` and `updateAlertFields` — since both parse through `alertConditionSchema`. The update path gets no capability flag (it isn't threaded there by design); an activity condition attached via update to an incapable tracker simply hits the poll-time skip-and-warn degradation. Schema `.describe()` text and the `create_alert` description mention the activity kind so the LLM can discover it.

**Tool-prefs impact:** none by construction — `create_alert` is an existing registered tool, so its domain/risk classification, `resolveToolPermission` (`allow`/`ask`/`deny`, most-specific-wins), the `ask` confirmation flow, and preset handling apply to activity-kind calls identically; `deny` removes the whole tool. Guests never see `create_alert` (hardcoded read-only toolset), so activity alerts remain member-only. No new `TaskCapability` values, so provider/plugin surfaces are unchanged.

**Alternative:** resolve the provider inside `executeCreate` from context settings. Rejected — builds a provider inside the tool layer, which the tool conventions forbid, and duplicates the established assembly-time gating pattern (identity tools, sprint tools).

### D7: Module layout and dependencies

The activity evaluation path lives in a new sibling `src/deferred-prompts/poller-alerts-activity.ts` — `poller-alerts.ts` (284 lines) cannot absorb the path without breaching the repo's `max-lines` limit, and no existing module covers history-based evaluation (fetch-tasks.ts is list/getTask-shaped). **No new dependencies:** Zod (schema), p-limit (bounded history concurrency), drizzle (column), and `wrapUntrusted` (summary hygiene) are all already in use on this path.

## Risks / Trade-offs

- [Shared cursor skips older entries on the second task of a multi-leaf tree once a newer entry advances it] → accepted and spec'd; single-task leaves are the dominant shape, and per-task cursors would cost a table for a rare case.
- [Provider history ordering / timestamp variance] → client-side sort on `Date.parse`, skip-and-warn on unparseable entries; never compare raw strings.
- [Busy tasks refetch full history each poll] → accepted (D4); bounded by poll cadence; windowing is a later optimization behind the same spec.
- [Cooldown expiry delivers a burst of accumulated entries] → one merged summary per cycle via the existing batch — same shape field alerts already have.
- [Partition flip mid-life if an activity alert is created/cancelled] → same exposure as today's pure-watch partition; still computed over the full active set, so cooldown alone cannot flip it.
- [`poller-alerts.ts` max-lines pressure during wiring] → the sibling module is extracted from the start, not retrofitted.

## Migration Plan

Migration `082_alert_activity_cursor` is purely additive: nullable column, `PRAGMA table_info` guard makes double-run idempotent, no backfill — `NULL` is the meaningful "baseline pending" state, and pre-existing rows can't contain activity conditions anyway. Rollback: a previous build's drizzle schema does not map the column, so it is neither selected nor written; the column is inert. Deploy is the normal startup migration run; no feature flag needed since creation gating (D6) keeps the kind unreachable on incapable trackers.

## TDD / Hook Interactions

Every new file lands through the Write/Edit TDD hook pipeline (failing test first): `tests/db/migrations/082_alert_activity_cursor.test.ts` before the migration file, and `tests/deferred-prompts/poller-alerts.test.ts` extensions before `poller-alerts-activity.ts`. Suggested red-green order matching dependency bottoms-up: migration → `types.test.ts` (leaf accept/reject/nest/describe) → `alerts.test.ts` (cursor round-trip + update helper) → poller (baseline-no-fire, fire-on-new, no-refire, cooldown, categories pass-through, capability-loss skip, activity-only no-list-fetch) → tool gating tests (refused missing capability / null instance, accepted when present, mixed-tree refusal). Gate per proposal: `bun run test tests/db tests/deferred-prompts`, then `typecheck` + `lint`, full suite before commit.

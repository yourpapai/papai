# Design: Pin alerts to task instances

## Context

Today `alert_prompts` rows carry no task-instance binding. Alert polling (`src/deferred-prompts/poller-alerts.ts`) resolves the task provider from the delivery config context's *current* `context_settings.taskInstanceId`, so switching a context's instance (or deleting one) silently re-points existing alerts at a different tracker's task ids. Task instances already live in `task_instances` with encrypted provider configs resolved by `src/providers/resolver.ts` (`TaskProviderResolver.resolve(contextId)`); `context_settings.taskInstanceId` mirrors the `contextSettings` FK pattern in `src/db/instance-schema.ts`. See `proposal.md` for motivation and the file-by-file touch list; the behavior contract is in `specs/alert-task-instance-pinning/spec.md`.

## Goals / Non-Goals

**Goals:**
- Immutable per-alert pin to the creating task instance; evaluation always routes through the pin.
- Deterministic cancellation on the two paths that invalidate a pin (context switch, instance delete), plus poller detection as a catch-all.
- Zero behavior change for NULL-pinned alerts (legacy rows, unconfigured contexts).

**Non-Goals:**
- No backfill/migration of legacy rows to a pin (impossible — the creating instance is unknowable after the fact).
- No new condition kinds, targeted polling, or activity features (later sessions).
- No re-encryption or copying of provider credentials into alert rows.

## Decisions

### D1: Nullable FK column with cascade, no backfill

Add `task_instance_id TEXT NULL REFERENCES task_instances(id) ON DELETE CASCADE` to `alert_prompts` in `src/db/deferred-schema.ts` (mirroring the existing `contextSettings` FK pattern) plus idempotent migration `081_alert_task_instance_pin.ts` using the `columnExists` guard, exactly like `069_alert_matched_task_ids.ts`. Existing rows stay NULL — NULL is the sentinel for "resolve via delivery context", preserving today's semantics.

*Alternatives:* snapshotting the provider config on the alert (duplicates encrypted credentials, drifts from instance edits — rejected); a non-null column with a sentinel value (conflates legacy with unconfigured — rejected); a join table (one alert has exactly one instance — over-modeling).

### D2: Effective-instance resolution in the poller

`pollAlertsOnce` groups alerts by **effective** instance id: `alert.taskInstanceId ?? getContextSettings(configContextId)?.taskInstanceId ?? null`. NULL ⇒ today's grouping/behavior unchanged. `BuildProviderFn` (`src/deferred-prompts/proactive-llm-helpers.ts`) widens to `(contextId, taskInstanceId?)`; `src/runtime/production-background.ts` passes the pin through to a new `TaskProviderResolver.resolveForInstance(contextId, taskInstanceId)` that reuses `resolve`'s descriptor/config/validation path but takes the instance explicitly. Context-scoped fields (e.g. the YouTrack token) still come from `contextId` — the delivery context — so no credential crosses contexts. Missing/inactive instance ⇒ `null`.

*Alternative:* building a synthetic context for the pinned instance (breaks per-context credential scoping — rejected).

### D3: Auto-cancel on unresolvable pin

In `executeAlertsForInstance`, a non-null pin whose `resolveForInstance` returns `null` ⇒ set `status='cancelled'`, info log per alert, skip evaluation. Never fall back to the context's current instance.

### D4: Explicit cancel paths, FK cascade as integrity net only

- **Switch** (`src/debug/settings/context-task-instance-routes.ts` `handlePatch`): when old ≠ new `taskInstanceId`, cancel active alerts pinned to the old instance **whose delivery target resolves into `scope.scope.contextId`** (via `getConfigContextIdFromStorageContextId` over each alert's built delivery target).
- **Delete** (`src/debug/settings/admin/instances-routes.ts` `handleTaskInstanceDelete`): cancel **all** active alerts pinned to the instance, no context filter, **before** `deleteTaskInstance(id)` so cancellation (and its info logs) wins over the FK cascade.
- Shared helper `cancelActiveAlertsPinnedToInstance(taskInstanceId, configContextId?)` in `src/deferred-prompts/alerts.ts`; status write to `'cancelled'` is idempotent, so racing with poller detection is harmless.

### D5: Pin capture at creation

`createAlert`/`executeCreate` (`src/deferred-prompts/tool-handlers.ts`) derives the alert's config context from its delivery target and pins `getContextSettings(configContextId)?.taskInstanceId ?? null`. No new module is introduced — `alerts.ts` already owns alert persistence, and the resolver already owns instance resolution.

### Scope model & gating impact

- New persisted state: one column on `alert_prompts`, keyed by **task instance id** (platform-instance-agnostic) alongside the existing delivery-target fields (storage/config context). No change to which ids key live state; storage-context isolation is untouched.
- No new tool surfaces: `createAlert` keeps its existing capability gating and `tool_prefs` entry; only its persisted output gains a column. No allow/ask/deny changes.

### Dependencies

None new — drizzle + sqlite migrations and the existing resolver cover everything.

## Risks / Trade-offs

- [Poller races the switch/delete cancel paths] → Cancellation is an idempotent status write with an info log; worst case is a duplicate log line, never a wrong-instance evaluation.
- [FK cascade could delete an alert before the explicit cancel logs it] → Delete path cancels *before* calling `deleteTaskInstance`; cascade remains only as an integrity net (spec requirement).
- [Pinned instance + context-scoped token (YouTrack) can diverge if the delivery context rotates its token] → Accepted: the token is a property of the delivery context by design (D2); if resolution fails validation the pin auto-cancels rather than mis-evaluates.
- [NULL-pinned alerts still silently re-point on switch] → Intentional non-goal: that is today's documented behavior and the spec requires preserving it.

## Migration Plan

1. Ship migration `081` (idempotent `ALTER TABLE ... ADD COLUMN`, guarded by `columnExists`); register it last in `MIGRATIONS` (`src/db/index.ts`, after `migration080ReleaseAnnouncementBodies`). Extend `tests/db/migration-registration.test.ts` accordingly.
2. Roll-forward is safe on legacy rows (NULL pin ⇒ old behavior). Rollback: the column is nullable and inert — leaving it in place is harmless; an explicit `ALTER TABLE ... DROP COLUMN` also works on the supported SQLite version.
3. Deploy order is unconstrained: code paths that read the column treat NULL as legacy from the first release.

## Hook / TDD order of work

The Write/Edit TDD hook pipeline gates every new/edited test and source file under `src/` and `tests/`; write failing tests first, in this order:

1. `tests/db/migrations/081_alert_task_instance_pin.test.ts` (template: the 069 test) + `migration-registration` / `deferred-schema` extensions → then schema + migration + registration.
2. `tests/deferred-prompts/alerts.test.ts` (pin persisted, round-trip, cancel helper) → then `types.ts` + `alerts.ts`.
3. `tests/deferred-prompts/poller-alerts.test.ts` (routing to pinned provider, deleted-pin auto-cancel, NULL-pin parity) → then `resolver.ts`, `proactive-llm-helpers.ts`, `production-background.ts`, `poller-alerts.ts`.
4. `tests/debug/settings/context-task-instance-routes.test.ts` (switch cancels in-context old-pinned alerts; delete cancels before row removal) → then the two route files.

Final gate: `bun run test tests/db tests/deferred-prompts tests/debug/settings/context-task-instance-routes.test.ts`, then `bun run typecheck && bun run lint` (no lint-disable/type-ignore; split files if max-lines trips).

## Context

See proposal.md — Why. The provider request scope (`src/analytics/provider-request-scope.ts`) is an `AsyncLocalStorage` frame, fail-closed at every task-provider HTTP boundary (`requireProviderRequestScope`). Commit `3cd31fe74` wired all invocation paths except `src/scheduler.ts`; the alerts poller (`buildInstanceProvider` in `src/deferred-prompts/poller-alerts.ts`) is the established pattern for background jobs: per-execution scope from the scope factory, provider construction and all I/O inside `runWithProviderRequestScope`, explicit `NO_ANALYTICS_SCOPE` fallback. The analytics schema already reserves `invocation_mode='scheduler'` and `actor_role='system'`; the sessionizer excludes both from activity sessions. A recurring task's `userId` is a scoped storage-context id (`pi:<instance>:ctx:<native>`); `src/scheduler-recurring.ts` already derives a DM notification route from it.

## Goals / Non-Goals

**Goals:**

- Recurring task instances are created again (the production bug), for every provider and platform instance.
- Scheduler provider requests are attributable in analytics (owner + scheduler invocation).
- Zero behavior change to any other invocation path; no new persisted state, DB change, or dependency.

**Non-Goals:**

- Proposal Non-goals apply (no `createMissedTasks` re-attribution, no notification wrapping, no missed-occurrence backfill, no analytics semantics changes).

## Decisions

### D1: Extend `provider-scope-factory.ts`, no new module

Add `buildSchedulerProviderRequestScope(input, observeProviderRequest)` (pure, observer injected) plus `resolveSchedulerProviderRequestScope(input)` (wires the active analytics runtime), mirroring the existing `build`/`resolve` pairs for proactive and settings. The factory is the single validated home for scope construction (`createActorProviderRequestScope` runtime-copies and freezes); a scheduler-local builder would duplicate that seam. No existing module other than the factory covers scheduler scope construction.

Field mapping from the recurring task record:

- route via the existing `getRecurringNotificationRoute` logic (scoped-id parse first, delivery-routing fallback for legacy bare ids)
- `storageContextId` = task `userId`; `configContextId` = derived from it; `taskInstanceId`/`taskProvider` from context settings (matches proactive builder)
- `nativeContextId`/`chatUserId` = the DM peer id from the route; `contextType` = `'dm'` (recurring notifications are always DMs)
- `actorRole` = `'system'`, `invocationMode` = `'scheduler'`, `rawTurnId` = `null`
- `sourceEventId` = `scheduler:<recurringTaskId>:<randomUUID()>`

Fallback to `NO_ANALYTICS_SCOPE` when the route or platform instance is unresolvable — same doctrine as proactive/settings (never throw, never silently invent identity).

*Alternative considered:* `actorRole: 'member'` with the owner as actor (proactive style). Rejected: the scheduler, not the owner, initiates the call; `'system'` distinguishes bot-initiated from user-initiated attribution in downstream analytics, and the schema reserves the value for exactly this.

### D2: One scope per task execution, covering resolution through finalization

`executeRecurringTask` wraps provider resolution, `createTask`, and `finalizeCreatedRecurringTask` in a single `runWithProviderRequestScope`. Finalization includes `applyLabels` (`addTaskLabel` is provider I/O) — wrapping only `createTask` would leave the label calls frameless. Wrapping construction too follows the `buildInstanceProvider` precedent and guards providers that might do I/O when instantiated. Chat notification inside the lease is harmless (chat I/O is not scope-gated).

*Alternative considered:* one scope per tick — rejected: a tick spans tasks owned by different users; scope is per-actor by contract.

### D3: Inject scope resolution via `SchedulerDeps`

Extend `SchedulerDeps` with an optional scope resolver defaulting to `resolveSchedulerProviderRequestScope`, matching the poller's injectable `resolveScope` and the repo's DI-first convention — tests assert wiring without `mock.module()`. `createMissedTasks` stays unwrapped (see Non-goals): its sole caller, the `resume_recurring_task` tool, already executes inside `wrapToolExecution`'s actor scope; a scheduler frame there would re-attribute a user-initiated call.

### D4: No capability/tool-prefs or scope-model impact

No new tool surface — gating and `tool_prefs` are untouched. No new persisted state: the scope is ephemeral per execution, keyed by the owner's storage-context id; config-context-derived fields are read-only lookups. No DB migration, no new dependency (reuses `node:async_hooks` plumbing and existing factory).

## Risks / Trade-offs

- [Malformed source would make the validating constructor throw into the scheduler] → the builder only feeds fields it derived or looked up, and returns the sentinel on any unresolvable piece; factory tests pin every sentinel path.
- [Legacy unscoped owner ids fall back to unobserved execution] → functional but invisible to analytics; consistent with the proactive fallback doctrine and bounded by the same route parser the notification path uses.
- [`provider-scope-factory.ts` (216 lines) and `scheduler.ts` (209 lines) approach `max-lines` limits] → additions are small; if a limit trips, extract per the design signal (e.g. scheduler scope wiring into `scheduler-recurring.ts`).
- [Occurrences missed while the scheduler was broken are lost] → accepted Non-goal; users can regenerate instances via `resume_recurring_task`.

## Migration Plan

Single deploy; no data or config migration. Rollback is `git revert` — the scheduler returns to failing closed (the status quo), nothing else depends on the new builder.

## Open Questions

None blocking. (Whether recurring-task creation failures should ever alert owners is a separate, pre-existing gap.)

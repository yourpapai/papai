## Context

See proposal.md — Why. Live probe against the pinned production image (`ghcr.io/usekaneo/kaneo:2.7.2`): `GET /api/column/<valid-id>` + API key → 200; `GET /api/column/<unknown-id>` → **400** `Workspace ID could not be determined` (Kaneo resolves the workspace through the project); task creation in a valid project works. So a stale project reference presents as 400, and `classify-error.ts:81` maps every 400 to `providerError.validationFailed('unknown', …)`. `KaneoApiError` already carries the parsed `responseBody`; `classifyKaneoError(error, context)` already accepts `context.projectId` (unused by `column-resource.ts` list/create); `TaskProvider.classifyError(error): AppError` (`src/providers/types.ts:291`, implemented by the kaneo provider) is the existing bridge that lets `src/` consumers classify provider errors without importing plugin internals. Recurring run state (`last_run`/`next_run`) is only written by `markExecuted` on success; failures leave `next_run` in the past, so the tick re-selects the template every 60 seconds.

## Goals / Non-Goals

**Goals:**

- `project-not-found` guidance reaches every consumer of kaneo errors (chat, scheduler).
- A permanently-failing recurring template retries on its own schedule, not every tick, and the owner is told.
- Provider-agnostic scheduler policy via the existing `classifyError` contract; no migration, no new persisted state.

**Non-Goals:**

- Proposal Non-goals apply (no ops remediation of the live template, no transient-failure policy, no auto-disable, no once-only dedup, no localization, no YouTrack/GitHub classification changes).

## Decisions

### D1: Classify by 400-body marker + resource context, not status-only

In `classifyApiError`, a 400 whose response body contains the workspace-marker text (case-insensitive `workspace id could not be determined`) classifies through `classifyNotFound`, yielding `providerError.projectNotFound(context?.projectId ?? 'unknown')`. `column-resource.ts` `list`/`create` pass `{ projectId }` so the classified error names the project; `task-resource.ts` createTask passes its `projectId` context on the way out. Alternatives considered: treat every column-route 400 as project-not-found (too broad — column create/update validation errors share the route and must stay validation failures); probe the project with an extra `GET /project/:id` before creating (extra I/O per execution; classification should be free).

The marker is a string coupling to Kaneo's error copy; it is pinned by unit tests (marker present/absent) and by an e2e case against the pinned image, so a Kaneo copy change surfaces as a failing test, not silent misclassification. The e2e pin exposed a prerequisite client bug, now fixed: Kaneo serves this 400 as **plain text**, and `fetchResponseBody`'s json-first read consumed the body so the text fallback collapsed to the `'Unable to read response body'` sentinel — error bodies are now read text-first and `JSON.parse`d afterwards, preserving plain-text bodies for classification.

### D2: Scheduler detects permanence via `provider.classifyError`, no plugin imports

The scheduler catch branch calls the already-resolved provider's `classifyError(error)` and checks `code === 'project-not-found'`. First-party and contributed providers already implement the contract; nothing new crosses the plugin boundary. Alternatives considered: importing plugin error classes into `src/` (breaks plugin isolation), string-matching the error message in `src/` (fragile, duplicates classification).

### D3: Stateless schedule-advance backoff via a failed-execution record

New `recordFailedExecution(id)` in `src/recurring.ts`: sets `last_run = now`, computes `next_run` with the same `computeNextRun` path `markExecuted` uses, writes no occurrence row. Effect: the failed attempt consumes its slot (daily template retries tomorrow), and catch-up (`computeMissedDates`, derived from `last_run`) does not resurrect it — intended, since recreation would fail against the same missing project. Alternatives considered: exponential backoff or once-only notification (both need new columns + migration — declined), auto-disable `enabled='0'` (silently kills the template; the notified owner decides — declined).

### D4: Failure notice reuses the success-notice route and shape

`scheduler-recurring.ts` gains `notifyRecurringFailure` mirroring `notifyUser`: same `getRecurringNotificationRoute` DM route, hardcoded English copy stating task title, reason, and remedy ("update or disable"), `recordProactiveInHistory` for scoped ids, delivery failure logged without throwing. Notification runs after the schedule advance so a send failure can never resurrect the retry storm.

### D5: No capability/tool-prefs or scope-model impact

No new tool surface; gating untouched. No new persisted state — `last_run`/`next_run` are existing group-shared template columns; the failure notice is a DM, not durable. No DB migration, no new dependency.

## Risks / Trade-offs

- [Kaneo changes the 400 body copy → marker stops matching] → the behavior degrades to today's generic validationFailed (never worse), and the pinned e2e case fails loudly on the next image bump.
- [A legitimate validation 400 carries the marker text] → marker is a full distinct sentence Kaneo emits only for unresolvable workspace/project; unit tests pin both directions.
- [Owner notification once per failed attempt could annoy on frequent templates] → bounded by the template's own schedule (a daily template notifies daily); dedup declined in Non-goals as state-bearing.
- [Provider `classifyError` misclassifies for contributed providers] → policy keys on the standard `AppError.code` produced by the shared contract; providers that never emit `project-not-found` simply keep transient behavior.

## Migration Plan

Single deploy; no data or config migration. Rollback is `git revert` — worst case reverts to generic 400 classification and per-tick retries (the status quo).

## Open Questions

None blocking.

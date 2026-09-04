## Why

Production log (post `scheduler-provider-scope` release): a recurring task now reaches Kaneo and dies with `Kaneo API GET request failed with status 400`. Reproduced against the pinned production image (`ghcr.io/usekaneo/kaneo:2.7.2`): `GET /api/column/<unknown-projectId>` answers **400 "Workspace ID could not be determined"** (Kaneo resolves the workspace through the project; an unknown/invisible project is a 400, not a 404). The recurring template references a project that no longer exists in the owner's workspace — stale reference, previously masked by the scope bug. Two product gaps make this worse than it should be: every Kaneo 400 is classified as generic `validationFailed` (no actionable guidance anywhere), and a permanently-failing recurring template retries **every tick (60s) forever** with error logs only — no owner notification, no backoff.

## What Changes

- Kaneo error classification maps the project-missing 400 body marker to the existing `providerError.projectNotFound`, carrying the project id from the failing call's context; genuine validation 400s, 404s, 401/403, 429 semantics unchanged.
- The recurring scheduler, on a provider-classified `project-not-found` failure (via the existing `TaskProvider.classifyError` contract), records a failed execution: `lastRun`/`nextRun` advance per the template's schedule (occurrence consumed, no occurrence row) so the template retries on its schedule — not every tick — and DMs the owner a failure notice with actionable guidance through the existing recurring-notification route.
- Transient failures (network, 5xx, auth) keep today's retry-next-tick behavior.

## Capabilities

### New Capabilities

- `kaneo-provider-error-classification`: Kaneo's project-missing signal (400 with the workspace-marker body on a project-scoped request) SHALL classify as `project-not-found` with project id, surfaced through the provider `classifyError` contract for every consumer (chat tools, scheduler, alerts). Without it: all Kaneo 400s read as `validationFailed('unknown')` — chat users get "status 400" instead of "project no longer exists", and the scheduler cannot distinguish permanent from transient failure.
- `recurring-failure-handling`: the recurring scheduler SHALL treat provider-classified project-not-found as a permanent failure — advance the template's schedule (no per-tick retry storm), skip occurrence recording, and notify the owner once per failed scheduled attempt through the existing DM route. Without it: one stale template hammers the tracker every minute indefinitely and the owner never learns.

### Modified Capabilities

None — no existing spec under `openspec/specs/` covers kaneo error semantics or recurring failure policy.

## Impact

- Code: `plugins/task-provider-kaneo/classify-error.ts` (400-body marker), `plugins/task-provider-kaneo/column-resource.ts` + `task-resource.ts` (project-id context), `src/recurring.ts` (failed-execution recording), `src/scheduler.ts` / `src/scheduler-recurring.ts` (failure branch + owner notice), tests under `tests/plugins/task-provider-kaneo/`, `tests/`, and a pinned-image e2e case under `tests/e2e/`.
- Providers/platforms: classification is kaneo-specific (the 400 body marker); the scheduler policy is provider-agnostic — any provider whose `classifyError` yields `project-not-found` gets the same handling. All platform instances; recurring templates are group-shared durable assets keyed by config context, executed per owner — no scope-model change, no new persisted state (reuses `last_run`/`next_run`), no migration.
- Docs: `docs/architecture/behaviors.md` (recurring task failure behavior), `docs/architecture/plugins.md` only if the classification seam description needs it.

## Non-goals

- Re-pointing or disabling the one stale production template — operational remediation, not code.
- Backoff or notification policy for transient failures (network, 5xx, auth) — unchanged retry-next-tick; no new state.
- Auto-disabling recurring templates on permanent failure — silently killing a template is surprising; the owner decides after being notified. Declined.
- Once-only notification dedup or exponential backoff — requires new persisted state; per-schedule-attempt notification is bounded by the template's own schedule. Declined.
- Localizing the failure notice — the existing success notice is hardcoded English; consistency first. Declined.
- Classifying the marker 400 in other task-provider plugins (YouTrack, GitHub) — they have their own error contracts; nothing observed broken there.

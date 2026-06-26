<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0178: Kaneo Plugin Repair — Legacy Backfill, Task-Instance Status, and Inactive-Instance Filtering

## Status

Implemented

## Date

2026-06-01

## Context

The task-provider-as-plugin migration (ADR-0130 through ADR-0133) moved Kaneo from a bootstrapped core provider to the `task-provider-kaneo` plugin, with task instances stored in `task_instances` and per-context assignment in `context_settings.task_instance_id` (nullable since migration 062). Pre-plugin Kaneo users were left stranded by that migration: their Kaneo credential and workspace still lived in `user_config` under the plugin-era keys (`plugin:task-provider-kaneo:provider:credential` / `...:workspaceId`), but no `task_instances` row and no `context_settings` assignment existed. `TaskProviderResolver.resolve` therefore treated those contexts as unconfigured, and the plugin was never enabled for them — a silent, total regression for existing Kaneo users.

Two adjacent defects compounded this. First, the admin settings task-instance create route (`POST /settings/api/admin/task-instances`) defaulted new task instances to `pending` and exposed no status-editing PATCH, so every Kaneo instance an operator created was born permanently unusable (the resolver and assignment routes reject non-`active` instances) with no in-UI remediation path. Second, the group settings task-instance GET returned every instance regardless of status and the PATCH accepted any known instance id, so a group admin could assign a `pending` or `stopped` instance and silently land on a "not configured" context.

## Decision Drivers

- **Idempotency** — the repair runs on every startup and must be a strict no-op for already-repaired or never-Kaneo deployments.
- **Non-destructiveness** — never clobber an existing `context_settings` row, and never invent a second Kaneo task instance when one is already usable.
- **Graceful degradation** — unreadable encrypted instance rows (wrong `INSTANCE_CONFIG_KEY`) must be warned and skipped, not abort the repair, matching the instance-route convention.
- **Operator self-service** — admins must be able to start/stop a task instance from the settings UI without a process restart, and the group/DM assignment UI must never offer an unusable instance.
- **Single source of truth for "usable"** — `status === 'active'` is the one predicate shared by the resolver, the repair, and both assignment routes.

## Considered Options

### Option A — One-shot SQL migration script

- **Pros:** simple, explicit, reviewable in a migration file.
- **Cons:** cannot read env (`KANEO_CLIENT_URL`) at migration time; cannot enable the plugin (plugin state is a runtime registry, not a migration table); does not repair contexts created after the migration runs.
- **Rejected.**

### Option B — Runtime repair on first message per context

- **Pros:** lazy; only touches contexts actually used.
- **Cons:** races with plugin-eligibility checks; the first message would still fail before the repair completes; adds a hot-path branch to message handling.
- **Rejected.**

### Option C — Startup repair pass (chosen)

- **Pros:** runs once after plugin activation with env, DB, and plugin registry all available; idempotent; outside the message hot path.
- **Cons:** repairs only contexts whose legacy config already exists at boot; a context that gains Kaneo config later still uses the normal `/config` flow (acceptable — that is the post-plugin path).

## Decision

Three coordinated changes implement the repair.

### 1. Idempotent startup repair (`src/instances/kaneo-legacy-repair.ts`)

`runKaneoLegacyRepair()` is invoked from `src/index.ts` after `activatePlugins`, gated on `activatedPluginIds.includes('task-provider-kaneo')`. It:

- Scans `user_config` for contexts holding both legacy Kaneo keys (`plugin:task-provider-kaneo:provider:credential` and `...:workspaceId`) — the pre-plugin contexts that were never assigned a task instance.
- Splits candidates into contexts that already have a `context_settings` row (only the plugin is re-enabled for them) and contexts needing full backfill (assignment + enablement), so an existing row is never clobbered.
- Resolves a single usable Kaneo task instance via strict precedence: exactly one `active` Kaneo instance → reuse it; else exactly one `pending` instance whose stored config has a valid http(s) `baseUrl` (and `internalUrl` if present) → promote it to `active`; else create one `kaneo-default` instance (collision-suffixed `kaneo-default-2`, …) from `KANEO_CLIENT_URL`/`KANEO_INTERNAL_URL`. Ambiguous states (≥2 active, ≥2 pending, or no env `baseUrl`) skip repair for the backfill-needing contexts and warn rather than guess.
- For each backfill context, parses the scoped context id, writes `context_settings` (task instance + platform instance), and enables `task-provider-kaneo` for the context. Unreadable encrypted rows are warned and skipped via `listTaskInstancesSafe()`.
- Returns a `RepairSummary` (`repairedContexts`/`createdTaskInstances`/`promotedTaskInstances`/`skippedDueToAmbiguousTaskInstance`) logged at info.

### 2. Admin task-instance lifecycle (`src/debug/settings/admin/instances-routes.ts`, `client/settings/admin-fetchers.ts`, `client/settings/sections/admin/AdminInstancesSection.svelte`)

- `TaskInstanceCreateSchema.status` now defaults to `'active'` (platform instances still default to `'pending'`), so admin-created Kaneo instances are usable immediately. `InstancePatchSchema.status` remains editable via `PATCH /settings/api/admin/task-instances/:id`.
- A new `updateAdminTaskInstance` fetcher and a `toggleTaskStatus` action in `AdminInstancesSection` expose Start/Stop (`active` ↔ `stopped`) controls with a `task-status-<id>` testid; the active→stopped path confirms via a `pendingStop` dialog before toggling.

### 3. Active-only assignment surface (`src/debug/settings/group-routes.ts`, `src/debug/settings/context-task-instance-routes.ts`, `client/settings/sections/{GroupProviderSection,TaskProviderSection}.svelte`)

- The group and context (DM) task-instance GETs filter `listTaskInstancesSafe().instances` to `status === 'active'`; the PATCH rejects any non-`active` instance with `422 { error: 'inactive task instance' }`, with distinct `422` branches for unreadable (`'unreadable task instance'`) and unknown (`'unknown task instance'`) ids.
- Both SPA sections render an explicit empty-state when `available` is empty (e.g. "No active task instances are available for this group."), directing the user to an admin.

## Consequences

### Positive

- Pre-plugin Kaneo users are repaired automatically on the next startup after plugin activation, with no operator action and no data loss.
- Admin-created task instances are usable the moment they are created, and can be stopped/restarted from the UI without a process restart.
- Group and DM assignment surfaces can never offer or accept an inactive instance, eliminating the silent "not configured" failure mode.
- The repair is a strict no-op for deployments with no legacy Kaneo config, and degrades gracefully past unreadable encrypted rows.
- `'active'` is now the single shared predicate for task-instance usability across the resolver, the repair, and both assignment routes.

### Negative

- The repair only fires at startup; a context that gains legacy Kaneo config after boot is not repaired until the next restart (acceptable — post-plugin contexts use the normal `/config` flow).
- Promoting a `pending` instance requires its stored config to already contain a valid `baseUrl`; a `pending` instance with a malformed or missing config is left alone rather than rewritten from env, to avoid overwriting an operator's intended configuration.
- The default instance id is collision-suffixed only against existing ids at repair time; a concurrent writer creating `kaneo-default` between the check and the insert would still collide (SQLite serializes the startup path, so this is theoretical).

### Risks

- A deployment with multiple legacy active Kaneo instances and no unambiguous choice skips repair for all backfill-needing contexts rather than picking one; an operator must manually resolve the ambiguity. This is deliberate (never guess), but means those contexts stay unconfigured until remediated.
- The repair enables `task-provider-kaneo` for contexts that already have a `context_settings` row but were never plugin-enabled; if an operator had intentionally disabled the plugin for such a context, the repair would re-enable it. Mitigated by the presence of legacy Kaneo credential config being itself a strong signal the plugin should be on.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — the plugin activation/eligibility model the repair integrates with.
- ADR-0130 / ADR-0131 / ADR-0133: Task Provider as Plugin phases 1–3/5 — the migration that stranded legacy Kaneo users and made this repair necessary.
- ADR-0125: Multi-Provider Phase 2 Task Provider Resolver — the resolver whose `status === 'active'` predicate this work makes consistent across all surfaces.
- ADR-0152 / ADR-0155: Multi-Provider Review/Remediation — the instance-route graceful-degradation convention (`listTaskInstancesSafe`) the repair follows.

## Implementation Notes

Key files confirmed present:

- `src/instances/kaneo-legacy-repair.ts` — `runKaneoLegacyRepair` (line 168), `listLegacyConfiguredContextIds`, `resolveUsableKaneoTaskInstance`, `splitLegacyContexts`, `getUnusedDefaultKaneoTaskInstanceId`, `isValidKaneoPendingConfig`. Confirmed (200 lines).
- `src/index.ts` — repair wired at lines 196–199, gated on `activatedPluginIds.includes('task-provider-kaneo')`, after `activatePlugins` and before `warnUnresolvedTaskInstances`. Confirmed.
- `src/debug/settings/admin/instances-routes.ts` — `TaskInstanceCreateSchema.status` default `'active'` (line 48); `InstancePatchSchema.status` optional (line 53); `PlatformInstanceCreateSchema.status` stays `'pending'` (line 41). Confirmed.
- `client/settings/admin-fetchers.ts` — `updateAdminTaskInstance` (line 80). Confirmed.
- `client/settings/sections/admin/AdminInstancesSection.svelte` — `toggleTaskStatus` (line 169), `task-status-<id>` testid (line 322), `pendingStop` confirmation flow. Confirmed.
- `src/debug/settings/group-routes.ts` — GET filters `status === 'active'` (line 111); PATCH 422 `'inactive task instance'` (line 142), plus `'unreadable task instance'` (line 135) and `'unknown task instance'` (line 139) branches. Confirmed.
- `src/debug/settings/context-task-instance-routes.ts` — parallel active-only filter (line 38) and 422 `'inactive task instance'` (line 78); this DM-context route received the same hardening though the plan only scoped group-routes. Confirmed.
- `client/settings/sections/GroupProviderSection.svelte` — empty-state "No active task instances are available for this group." (line 76); `TaskProviderSection.svelte` carries the parallel DM empty-state (line 120). Confirmed.

Divergences from the plan, reconciled against the shipped code:

- The shipped repair uses `listTaskInstancesSafe()` and skips/warns unreadable encrypted rows; the plan used `listTaskInstances()`.
- Pending-instance promotion is gated on `isValidKaneoPendingConfig` (valid http(s) `baseUrl`/`internalUrl`); the plan promoted any single pending instance unconditionally.
- The default instance id is collision-suffixed (`kaneo-default-2`, …); the plan hardcoded `kaneo-default`.
- `splitLegacyContexts` re-enables the plugin for contexts that already have a `context_settings` row but only backfills assignment for those without one; the plan backfilled all candidates uniformly.
- The group PATCH error wording is `'inactive task instance'` (plan: `'unknown active task instance'`), with additional granular unreadable/unknown branches.
- The active-only hardening was applied to `context-task-instance-routes.ts` (DM) as well as `group-routes.ts`, where the plan scoped only group-routes.

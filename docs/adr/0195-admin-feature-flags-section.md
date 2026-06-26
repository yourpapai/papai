<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0195: Admin Feature Flags Section

## Status

Implemented

## Date

2026-06-12

## Context

The per-context reduction flags (`result_compaction`, `progressive_disclosure`, `semantic_tool_retrieval`) introduced by ADR-0183/0184 are stored as JSON under the reserved `tool_context_flags` config key. Until this work they had no runtime control surface: an operator had to edit SQLite directly and restart the bot, because the config cache is lazy and a direct DB write is invisible to a running process. The only first-class control was the `TOOL_CONTEXT_REDUCTION_DISABLED=true` env kill switch, which can only force every flag OFF globally.

What was needed was a super-admin-only "Feature flags" section in the settings UI that lists every known context (users + groups, across all platform instances) with per-row toggles. Writes go through `setConfigValue`, which already invalidates the per-context tool-descriptor cache (`tool_context_flags` is in `TOOL_ASSEMBLY_CONFIG_KEYS`), so a toggle takes effect on the context's next turn without a restart. `resolveReductionFlags` is unchanged — it continues to read only the per-context key, so the UI is a pure write surface, not a new resolution tier.

The approved spec `docs/superpowers/specs/2026-06-12-admin-feature-flags-section-design.md` (branch `context-pollution`) is the source of truth. Explicitly out of scope: bulk apply-to-all, global default flag values, audit history, non-super-admin exposure, and list pagination/search.

## Decision Drivers

- **Operator self-service** — toggle reduction flags per context without DB access or a restart.
- **No resolution changes** — `resolveReductionFlags` keeps reading only the per-context key; the UI must not become a new default tier.
- **Super-admin parity** — same `requireSuperAdmin` trust level as plugin approval (a global role, not per-instance).
- **Cache coherence** — writes must invalidate the cached tool descriptors so the next turn sees the new flags.
- **Strict input** — only literal JSON `true` enables a flag; missing/empty/corrupt JSON resolves to all OFF (no truthy coercion).
- **Deterministic enumeration** — groups after users, both sorted by label, so the snapshot is stable for tests.

## Considered Options

### Option A: Per-context toggles in the settings UI (chosen)

- **Pros:** fine-grained per-context control; no restart; reuses `setConfigValue` cache invalidation; super-admin gated; mirrors existing admin sections (`AdminPluginsConfigSection`, `AdminSystemSection`).
- **Cons:** no bulk action or global default in v1; list grows with the context roster (no pagination/search); per-row save only.

### Option B: Extend the env kill switch

- **Pros:** zero new UI surface; simplest to implement.
- **Cons:** requires a restart; no per-context control; can only force OFF, never selectively enable.

### Option C: Admin CLI / direct DB edits

- **Pros:** no new UI code.
- **Cons:** not self-service; the running process never sees a direct DB write (lazy cache); error-prone; no auth/audit boundary.

## Decision

Five coordinated changes implement the section:

### 1. Exported strict parser (`src/tools/feature-flags.ts`)

The existing private `parse` is extracted into the exported `parseReductionFlagsJson(raw: string | null): ReductionFlags` with unchanged semantics: only literal JSON `true` enables a flag; `null`/empty/`''`/corrupt JSON → `{ ...ALL_OFF }`; corrupt JSON logs a `warn`. `resolveReductionFlags` delegates to it (after the `TOOL_CONTEXT_REDUCTION_DISABLED` kill-switch short-circuit). No behavior change to resolution. The GET route reuses the same parser so the UI and the runtime can never drift on what "ON" means.

### 2. Snapshot/update module (`src/debug/admin-feature-flags.ts`)

`getAdminFeatureFlagsSnapshot()` returns `{ killSwitchEngaged: boolean, contexts: AdminFlagContextRow[] }`. `applyAdminFeatureFlagsUpdate(contextId, flags)` re-enumerates the known-context set, rejects an unknown `contextId` with `AdminFeatureFlagsError` (→ 422), writes via `setConfigValue(contextId, REDUCTION_FLAGS_CONFIG_KEY, JSON.stringify(flags))`, and returns the recomputed row. Enumeration walks `listPlatformInstancesSafe().instances`; per instance, `listUsers(instanceId)` produces user rows (label `username ?? platform_user_id`, `contextId` via `toScopedContextId`) and `listKnownGroupContextsForPlatform(instanceId)` produces group rows (label `displayName`, or `displayName — parentName` when `parentName` is present). `killSwitchEngaged` is `process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] === 'true'`. Rows are ordered users-first then by `label.localeCompare`. The wire shape uses snake_case keys exactly as the parser reads them (`result_compaction`, `progressive_disclosure`, `semantic_tool_retrieval`).

### 3. Route handler (`src/debug/settings/admin/feature-flags-routes.ts`)

`handleAdminFeatureFlagsRoutes(req, _url, pathname)` is wired in `src/debug/settings-api-router.ts` for the exact path `/settings/api/admin/feature-flags`. Handler order matches the other admin routes: `authenticate` (401) → `requireSuperAdmin` (403, `read` for GET / `write` for PATCH) → `requireCsrf` (403, PATCH only) → Zod body validation (422 invalid shape) → action → `settingsJson` response. `GET` returns the snapshot; `PATCH` writes; any other method → 405. `PatchBodySchema` validates `{ contextId: z.string().min(1), flags: FlagsSchema(strict) }`. Unknown `contextId` and `AdminFeatureFlagsError` both surface as 422; unexpected errors log via the route's pino child logger and return 500.

### 4. Client schemas + fetchers + Svelte section

- `client/admin/feature-flags-fetcher-schemas.ts` — `AdminFeatureFlagStateSchema`, `AdminFeatureFlagRowSchema`, `AdminFeatureFlagsSnapshotSchema` and their inferred types.
- `client/settings/admin-fetchers.ts` — `fetchAdminFeatureFlags()` (`getJson`) and `saveAdminFeatureFlags({ contextId, flags })` (`writeJson` PATCH; `X-Settings-CSRF` is added automatically by `settingsFetch`).
- `client/settings/sections/admin/AdminFeatureFlagsSection.svelte` — Svelte 5 runes: `$state` for snapshot/drafts/error/status, `$effect` initial load, per-row drafts with an `isDirty` gate, per-row Save; a kill-switch warning banner; `EmptyState` fallback. Wired into `client/settings/SettingsApp.svelte` as `{ id: 'feature-flags', label: 'Feature flags' }` in the super-admin sidebar and `<AdminFeatureFlagsSection />` inside the existing `{#if settingsSession.isSuperAdmin}` block.

### 5. Docs

`CLAUDE.md`'s Result compaction and Progressive disclosure paragraphs note the flags are "managed per context in the settings UI super-admin **Feature flags** section, `/settings/api/admin/feature-flags`". `src/tools/CLAUDE.md` needs no change (assembly semantics are untouched).

## Consequences

### Positive

- Operators toggle reduction flags per context without DB access or a restart; the context's next turn picks up the new flags via the existing `TOOL_ASSEMBLY_CONFIG_KEYS` invalidation.
- Super-admin gating matches the plugin-approval trust level; plain bot admins and plain users are 403.
- The shared strict parser keeps GET, PATCH, and runtime resolution symmetric — no drift on what "ON" means.
- The kill switch is surfaced in the UI, so toggling while disabled is honest (stored but inert until `TOOL_CONTEXT_REDUCTION_DISABLED` is unset).
- No new cache plumbing: the section reuses `setConfigValue` and its existing invalidation hook.

### Negative

- No bulk "apply to all" or global default in v1 (YAGNI per spec); large rosters require per-row save.
- No pagination/search of the context list; revisit if rosters grow.
- No audit history of flag changes.
- The client UI does not expose a Clear/unset action even though the server supports it (see Implementation Notes).

### Risks

- **Enumeration cost.** `listContextRows()` re-enumerates all platform instances, users, and known group contexts on every GET and PATCH. Fine at current scale, but unindexed roster growth could add latency.
- **Duplicate native ids.** A native id that exists as both a `users` row and a group context (e.g. a Telegram group chat id persisted in `users`) must collapse to one row or Svelte's `{#each}` throws `each_key_duplicate`. Handled by Map-keyed enumeration (see Implementation Notes).
- **Placeholder users.** Pending `placeholder-<uuid>` entries from the open-DM-access flow would pollute the list; filtered out.
- **Kill switch vs per-context flags are independent.** Toggles are stored while the kill switch is engaged and activate only when `TOOL_CONTEXT_REDUCTION_DISABLED` is unset; the UI banner communicates this, but a stale toggle can surprise an operator who expects "OFF now means OFF forever".

## Related Decisions

- **ADR-0183** — Tool-Context Reduction — Part 1: Feature Flags and Result Compaction. Defines the `tool_context_flags` key and `result_compaction` flag this section manages.
- **ADR-0184** — Tool-Context Reduction — Part 2: Progressive Disclosure and Semantic Tool Retrieval. Defines the other two flags.
- **ADR-0136** — Settings Web UI — Access Model. The `requireSuperAdmin` / context-scope model this section is gated by.
- **ADR-0137** — Settings Web UI — HTTP API. The route, `requireCsrf`, and `settingsJson` response patterns this handler follows.
- **ADR-0138** — Settings Web UI — Client SPA. The fetcher and Svelte-section conventions this section mirrors.
- **ADR-0188** — AI Output Settings UI. Sibling admin-section pattern for per-context AI settings.
- Config-unset follow-up: `docs/superpowers/plans/2026-06-25-config-unset.md` and `docs/superpowers/specs/2026-06-25-config-unset-design.md` added the `{action:'unset'}` Clear path (see Implementation Notes).

## Implementation Notes

Confirmed present in the working tree:

- `parseReductionFlagsJson` and `resolveReductionFlags` — `src/tools/feature-flags.ts:36` and `:53`.
- `getAdminFeatureFlagsSnapshot`, `applyAdminFeatureFlagsUpdate`, `applyAdminFeatureFlagsUnset`, `AdminFeatureFlagsError` — `src/debug/admin-feature-flags.ts:79`, `:86`, `:93`, `:33`.
- `handleAdminFeatureFlagsRoutes` with `requireSuperAdmin` + `requireCsrf` — `src/debug/settings/admin/feature-flags-routes.ts:33`, `:42`, `:55`, `:58`.
- Router wiring — `src/debug/settings-api-router.ts:50` (exact-path match on `/settings/api/admin/feature-flags`).
- Client schemas — `client/admin/feature-flags-fetcher-schemas.ts:8`, `:14`, `:22`.
- Fetchers — `client/settings/admin-fetchers.ts:175` (`fetchAdminFeatureFlags`), `:178` (`saveAdminFeatureFlags`).
- Section + app wiring — `client/settings/sections/admin/AdminFeatureFlagsSection.svelte`, `client/settings/SettingsApp.svelte:40`, `:67`, `:239`.

Divergences from the original 2026-06-12 plan:

- **Client schema location.** Schemas live in a dedicated `client/admin/feature-flags-fetcher-schemas.ts` (matching `client/admin/plugin-config-fetcher-schemas.ts`), not in `client/settings/fetcher-schemas.ts` as the plan draft suggested.
- **Duplicate-context collapse.** `listContextRows()` builds a `Map<string, AdminFlagContextRow>` keyed by `contextId` rather than pushing into an array. Group entries are inserted last and overwrite colliding user rows, so a native id that exists as both a `users` row and a group context collapses to one row — preventing Svelte's `{#each}` `each_key_duplicate` error. The group registry is treated as authoritative for group contexts.
- **Placeholder users filtered.** `listUsers(instance.id)` is filtered to drop entries whose `platform_user_id` starts with `placeholder-` (pending entries from the open-DM-access flow, ADR-0190).
- **Clear/unset action added by a later plan.** `PatchBodySchema` is a `z.union` of `{contextId, flags}` and `{contextId, action:'unset'}`; `applyAdminFeatureFlagsUnset` calls `unsetConfigValue(contextId, REDUCTION_FLAGS_CONFIG_KEY)` to remove the key entirely (revert to all-OFF defaults). This path was added by the 2026-06-25 config-unset plan, not the original 2026-06-12 plan. `AdminFeatureFlagsSection.svelte` does **not** yet expose a Clear button — only per-row Save — so the unset path is server-available but not UI-surfaced as of this ADR.
- **Route wiring.** `settings-api-router.ts` matches the exact pathname (`p === '/settings/api/admin/feature-flags'`) and delegates; any other path falls through.

Tests: `tests/tools/feature-flags.test.ts` (`parseReductionFlagsJson`), `tests/debug/admin-feature-flags.test.ts` (snapshot/update/unset), `tests/debug/settings/admin/feature-flags-routes.test.ts` (auth/CSRF/round-trip/422/405), `tests/client/settings/admin-fetchers.test.ts` (GET/PATCH fetchers).

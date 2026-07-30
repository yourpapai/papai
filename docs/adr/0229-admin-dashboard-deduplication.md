<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0229: Admin Dashboard Deduplication — Consolidate Controls into Settings

## Status

Implemented

## Date

2026-06-26

## Context

The `/admin` operator dashboard (ADR-0121) was born as a mixed surface: read-only stats/data views (Overview, Billing, Stats, Memos, Reminders, Identities) **and** four editable **control** sections. By June 2026 the settings-page admin section (`/settings/api/admin/*`, super-admin gated — ADRs 0136–0139) had grown a fully editable equivalent for every one of those four controls, so each existed in two places through two disjoint route namespaces (`/admin/*` + `/api/*` vs `/settings/api/admin/*`). The result was operator confusion (two places to change the same thing), duplicated client+server code, and a surface that contradicted its intended role: the dashboard is for **debugging and charts/statistics**, with **all controls consolidated under the settings admin section**.

The four duplicated controls, each with a confirmed settings equivalent:

| `/admin` control section    | Type                       | Settings canonical equivalent      |
| --------------------------- | -------------------------- | ---------------------------------- |
| System (LLM creds)          | edits creds                | `AdminSystemSection`               |
| Instances                   | full CRUD + apply          | `AdminInstancesSection` (CRUD)     |
| Groups                      | authorize / delete         | `AdminGroupsSection` (auth + remove) |
| Plugin Config               | edits admin plugin cfg     | `AdminPluginsConfigSection`        |

One parity gap gated the work: the operator Instances UI had an **apply** action (`POST /api/platform-instances/apply`) that reconciled the live `ChatRouter`, and settings had no equivalent. That capability had to be migrated into settings **before** the operator Instances surface and its `/api/*` router could be deleted, or live-router reconciliation would be lost.

## Decision Drivers

- **One control surface, not two.** Editing the same state from two UIs through two route namespaces is a correctness and UX hazard; settings (super-admin gated, CSRF-guarded) is the safer single home.
- **Lose-no-capability.** Deletion is gated behind parity checks; the Instances "apply" gap is migrated first, then the operator surface is torn down. No control loses a function.
- **Clean route ownership.** Operator UI uses `/admin/*` + `/api/*`; settings uses `/settings/api/admin/*`. The namespaces never share a route, so the removed controls' operator routes become cleanly orphaned and deletable.
- **Shared-module safety.** `src/instances/*`, `src/debug/instance-config-validation.ts`, and the apply/reconcile path in `src/debug/instance-route-support.ts` are imported by the **settings** instance routes and must survive the teardown. `knip` + the full suite are the backstop.
- **Per-unit reviewability.** One self-contained unit per removed control (UI + exclusive fetchers/schemas/stories/tests + exclusive server route/handler/tests); each unit leaves the app compiling.

## Considered Options

### Option 1 — Remove the four control sections (UI + exclusive server code); migrate Instances "apply" to settings first (chosen)

Migrate the apply route into settings, then delete each control section's client components/fetchers/schemas/stories/tests and its exclusive operator route/handler/tests, de-register the section ids, and prune now-orphaned exports via `knip`.

- **Pros:** settings becomes the single control home; removes four parallel client stacks and their operator route handlers; preserves every capability (apply migrated, Groups/Plugin-Config already supersets, System parity pre-satisfied); each unit is independently reviewable; the static graph stays clean because shared instance modules are preserved.
- **Cons:** the Instances apply migration is a build-up unit that must land before the teardown; touches the `/admin` nav/registry across four units; risks stale documentation references outside the targeted grep scope.

### Option 2 — Leave the duplication; let the dashboard keep its editable sections

Ship no dedup; accept two editable surfaces per control.

- **Pros:** no churn; no migration sequencing.
- **Cons:** leaves the correctness/UX hazard in place; the operator routes stay write-protected by the weaker `DEBUG_TOKEN` gate rather than the super-admin + CSRF gate settings uses; the code duplication persists and grows.

### Option 3 — Merge `/admin` and `/debug` into one dashboard as part of the cleanup

Collapse the two operator surfaces while consolidating controls.

- **Pros:** one fewer surface.
- **Cons:** explicitly out of scope (spec "Out of scope / deferred"); conflates read-only operator viewing with engineer live observability, which ADR-0121 split precisely to keep independently securable. Rejected.

## Decision

All six plan units shipped. `/admin` is now a read-only dashboard (Overview, Billing, Stats, Memos, Reminders, Identities); the four control sections and their exclusively-owned client + server code are gone; the Instances apply capability lives in settings; the shared instance modules are preserved.

### What shipped

1. **Unit 1 — Plugin Config removed.** Operator `/admin/plugin-config` branch and `src/debug/plugin-config-routes.ts` (the **operator** file) deleted; `PluginConfigSection`/`PluginConfigForm` + `plugin-config-fetchers*` client code deleted. The **settings** `src/debug/settings/admin/plugin-config-routes.ts` + `src/debug/admin-plugin-config.ts` are untouched and remain canonical.
2. **Unit 2 — System / LLM creds removed.** `/admin/llm` branch + handler deleted; `SystemSection`/`CredentialsForm` and the LLM-cred fetchers pruned. The plan's verify-then-branch step (Unit 2 Step 1) concluded `/admin/system` GET was consumed only by the removed section, so **that GET branch was removed too** — within the plan's explicitly allowed branch. Settings `AdminSystemSection` (`/settings/api/admin/system`) is the sole cred editor.
3. **Unit 3 — Groups removed.** `/auth/groups` + `/auth/groups/{id}` branches and `handleAuthGroups` deleted; `GroupsSection` + group-delete fetcher removed. The shared store delete helper remains (settings `AdminGroupsSection` is its other caller).
4. **Unit 4 — Instances "apply" migrated to settings (the one build-up unit).** New `POST /settings/api/admin/platform-instances/apply` route reusing `applyPlatformInstances(deps)` from `instance-route-support.ts`; settings fetcher `applyAdminPlatformInstances`; `ApplyInstancesResult`/`ApplyInstancesResultSchema` ported to a settings fetcher-schema file; Apply button in `AdminInstancesSection`.
5. **Unit 5 — Operator Instances UI + `/api/*` router torn down.** `src/debug/instance-routes.ts` deleted; `handleInstanceApiRoute` dispatch removed from `server.ts`; `InstancesSection` + `instance-fetchers*` client code deleted. `instance-route-support.ts` is **kept** (apply/reconcile/`defaultInstanceApiDeps`/`InstanceApiDeps` now serve the settings route).
6. **Unit 6 — Docs.** `CLAUDE.md` and `docs/architecture/overview.md` re-point admin control management at the settings admin section and describe `/admin` as read-only; `docs/deployment/dashboard-access.md` updated. Regression tests assert the removed operator routes now 404.

## Consequences

### Positive

- One editable home per admin control (settings, super-admin + CSRF gated); `/admin` is unambiguously a read-only operator view.
- Four parallel client stacks (sections, forms, fetchers, schemas, stories) and their operator route handlers + tests are deleted, shrinking the operator surface and its test matrix.
- The live-router reconcile (apply) capability survives the teardown, now reachable through the guarded settings route and exercised by five server tests + two client tests.
- The shared instance modules (`src/instances/*`, `instance-config-validation.ts`, `instance-route-support.ts` apply path) are preserved for the settings routes; `knip` confirms no orphaned exports.

### Negative

- Documentation drift persists **outside** the plan's `CLAUDE.md docs/` grep scope: the root `README.md` (e.g. lines 151, 329, 375, 634), `.env.example` (lines 37, 99–101), and the `task-provider-kaneo`/`task-provider-youtrack` plugin READMEs still reference `/admin#instances`, `/api/platform-instances`, and `/admin/llm` as live operator controls — routes that now 404. The plan did not enumerate these files, so they were not swept.
- Leftover MSW story fixtures in `client/stories/msw/handlers.ts` still mock the removed operator routes (`/admin/plugin-config`, `/api/platform-instances`, `/api/task-instances`, `/api/admins`); harmless (no live operator UI consumes them) but stale.
- `/admin/system` GET was removed, so any external tooling that read the operator system snapshot over HTTP (rather than via the DB) loses that endpoint. The bot itself reads creds/instances from the DB, not HTTP, so runtime is unaffected.

### Risks

- **Unswept doc references could mislead operators** into trying `/admin#instances` / `/admin/llm` for management; the routes 404, so the failure mode is a visible dead link rather than silent misconfiguration, but a follow-up doc sweep of `README.md`/`.env.example`/plugin READMEs is warranted.
- **`instance-route-support.ts` is now settings-only.** It survived the teardown because the migrated settings apply route depends on it; a future removal of settings instance management must re-evaluate its ownership.

## Related Decisions

- **ADR-0121: Debug/Admin Surface Split and Dashboard Redesign** — created the `/admin` vs `/debug` split; this ADR completes it by making `/admin` strictly read-only.
- **ADR-0136 / ADR-0137 / ADR-0138 / ADR-0139: Settings Web UI** (access model, HTTP API, client SPA, command retirement) — the settings SPA that becomes the canonical admin control home after this dedup.
- **ADR-0226: Backstage Phase 3.3 — Settings/Admin Sections Cleanup** — sibling cleanup of the settings admin sections that the dedup consolidates onto.
- **ADR-0153: Multi-Provider Review Cleanup** — established the detailed `ApplyInstancesResult` shape ported into the settings fetcher-schema.
- **ADR-0176: Backstage Phase 3.2 — Settings User Sections** — the kit the surviving `/admin` read-only sections render through.

## Implementation Notes

Verified present/absent against the shipped tree via `grep`/`glob`:

| File | Role | Evidence |
| --- | --- | --- |
| `client/admin/sections/` (dir) | Only the six read-only sections remain: Overview, Billing, Stats, Memos, Reminders, Identities. `PluginConfigSection`/`SystemSection`/`GroupsSection`/`InstancesSection` are gone. | `glob client/admin/sections/*.svelte` confirms. |
| `client/admin/components/` (dir) | No `PluginConfigForm`/`CredentialsForm`; only `AdminSidebarPanel`, `AdminTopBar`, `SubjectDetail`, `SubjectStatsPanel`, `StatsPanel`, `SubjectsTable`. | `glob client/admin/components/*.svelte` confirms. |
| `client/admin/admin.svelte.ts:10-15` | Section registry holds exactly the six read-only ids (`overview`/`billing`/`stats`/`memos`/`reminders`/`identities`). | `grep` confirms. |
| `client/admin/fetchers.ts`, `client/admin/fetcher-schemas.ts` | No LLM-cred or group-delete exports (`fetchLlmConfig`/`saveLlmConfig`/`removeGroup`/`deleteGroup`). | `grep client/admin` for those symbols returns nothing. |
| `src/debug/server.ts` | Operator control branches removed: no `/admin/llm`, `/admin/plugin-config`, `/auth/groups`, `handleInstanceApiRoute`, `handleAdminLlm*`, `handleAuthGroups`. Only `/admin` static + `/admin/subjects/*` + `/admin/identity/mappings` (kept read-only views) remain. | `grep` on `server.ts` for the removed symbols returns no matches. |
| `src/debug/instance-routes.ts` | Operator `/api/*` HTTP router deleted. | `glob src/debug/*.ts` — file absent. |
| `src/debug/plugin-config-routes.ts` | Operator plugin-config route file deleted. | `glob src/debug/*.ts` — file absent. |
| `src/debug/instance-route-support.ts:15,159,185-189` | **Preserved.** `InstanceApiDeps` `:15`, `reconcilePlatformInstances` `:159`, `applyPlatformInstances` `:185`, `defaultInstanceApiDeps` `:189`. | `read`/`grep` confirm. |
| `src/debug/settings/admin/instances-routes.ts:240,248,279` | **Unit 4 migration.** `POST /settings/api/admin/platform-instances/apply` branch `:240`; calls `applyPlatformInstances(deps)` `:248`; `deps: InstanceApiDeps = defaultInstanceApiDeps` default `:279`. | `grep`/`read` confirm. |
| `client/settings/admin-fetchers.ts:32,110-111` | `applyAdminPlatformInstances` fetcher; imports `ApplyInstancesResultSchema`/`ApplyInstancesResult` from `./fetcher-schemas-instances.js`. | `grep` confirms. |
| `client/settings/fetcher-schemas-instances.ts:21,35` | Ported `ApplyInstancesResultSchema` `:21` and `ApplyInstancesResult` `:35`. | `grep` confirms. |
| `client/settings/sections/admin/AdminInstancesSection.svelte:9,258` | Imports + calls `applyAdminPlatformInstances`. | `grep` confirms. |
| `tests/debug/settings/admin/instances-routes.test.ts:475-575` | Five apply-route tests: 200 result `:475`, non-admin 403 `:496`, no-CSRF 403 `:515`, body pass-through `:534`, DELETE 405 `:562`. | `grep` confirms. |
| `tests/client/settings/admin-fetchers.test.ts:241` | `applyAdminPlatformInstances POSTs to platform-instances/apply with CSRF and parses apply result`. | `grep` confirms. |
| `tests/client/settings/sections/admin/AdminInstancesSection.test.ts:739` | `clicking the apply button POSTs to the platform-instances/apply endpoint`. | `grep` confirms. |
| `tests/debug/server.test.ts:481,498` | Regression guards: `GET /auth/groups returns 404 (route removed)` `:481`; `/admin/llm` removal assertion `:498`. | `grep` confirms. |
| `docs/architecture/overview.md:52` | `/admin` described as read-only dashboard; admin controls + apply pointed at `/settings/api/admin/*`. | `grep` confirms. |
| `docs/deployment/dashboard-access.md:46` | `/admin (read-only dashboard: Overview, Billing, Stats, Memos, Reminders, Identities)`. | `grep` confirms. |

Plan-vs-implementation notes:

- **`/admin/system` GET was also removed.** The plan's Unit 2 Step 1 was an explicit verify-then-branch: keep `/admin/system` GET if a kept view consumes it, else remove it with the System section. The verify concluded it was consumed only by the removed `SystemSection`/`CredentialsForm`, so the GET branch was removed too — the allowed branch, not a divergence.
- **Instances apply wiring landed verbatim as planned.** The settings route reuses `applyPlatformInstances`/`defaultInstanceApiDeps` from `instance-route-support.ts` (not a reimplementation), and `ApplyInstancesResult`/`ApplyInstancesResultSchema` were ported to a settings-local schema file so the deleted operator copy is no longer referenced. The `instance-route-support.ts` helper set survives (the plan's Unit 5 Step 4 `knip`-driven pruning left the apply/reconcile path intact).
- **Docs scope was narrower than the residual drift.** The plan's Unit 6 grep targeted `CLAUDE.md` and `docs/`; both are updated (`overview.md`, `dashboard-access.md`, `CLAUDE.md`). Stale `/admin#instances`/`/admin/llm`/`/api/platform-instances` references in the **root `README.md`**, **`.env.example`**, and the **plugin READMEs** were outside that scope and persist — see Consequences.

The source plan `docs/superpowers/plans/2026-06-26-admin-dashboard-deduplication.md` and design `docs/superpowers/specs/2026-06-26-admin-dashboard-deduplication-design.md` are archived alongside this ADR to `docs/archive/`.

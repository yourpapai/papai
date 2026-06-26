<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Admin Dashboard Deduplication — Consolidate Controls into Settings

**Date:** 2026-06-26
**Status:** Approved design, pending implementation plan

## Problem

Admin controls are duplicated between two surfaces:

- The **`/admin` operator dashboard** (`client/admin/`) — a mix of read-only stats/data views
  AND editable control sections.
- The **settings-page admin section** (`client/settings/sections/admin/`) — the modern,
  super-admin-gated home for admin configuration.

Four control areas exist in BOTH, each with a fully editable equivalent already present in
settings. This is confusing (two places to change the same thing, via two different route
namespaces) and violates the intended separation: the dashboard should be for **debugging
and charts/statistics only**, with **all settings/controls consolidated under the settings
page admin section**.

## Goal

Remove the duplicated **control** sections from the `/admin` dashboard (UI + their
exclusively-owned client and server code), leaving `/admin` as a read-only operator
dashboard. Settings becomes the single home for admin controls. `/debug` is already pure
observability and is untouched.

## Surface inventory (verified)

`/admin` dashboard sections (`client/admin/sections/`, registered in `AdminApp.svelte`):

| `/admin` section       | Type                             | Settings equivalent (canonical)           | Verdict    |
| ---------------------- | -------------------------------- | ----------------------------------------- | ---------- |
| Overview               | read-only stats                  | —                                         | **keep**   |
| Billing                | read-only usage                  | —                                         | **keep**   |
| Stats                  | read-only charts                 | —                                         | **keep**   |
| Memos                  | read-only data view              | —                                         | **keep**   |
| Reminders              | read-only data view              | —                                         | **keep**   |
| Identities             | read-only data view              | —                                         | **keep**   |
| **System (LLM creds)** | control — edits creds            | `AdminSystemSection` (editable)           | **remove** |
| **Instances**          | control — full CRUD              | `AdminInstancesSection` (CRUD)            | **remove** |
| **Groups**             | control — authorize/delete       | `AdminGroupsSection` (authorize + remove) | **remove** |
| **Plugin Config**      | control — edits admin plugin cfg | `AdminPluginsConfigSection` (editable)    | **remove** |

Decisions taken during brainstorming:

- **Keep** the read-only data views (Memos, Reminders, Identities) on the dashboard — they are
  durable-record browsers (debugging views), not controls.
- **Full cleanup including backend** — also remove the now-orphaned operator-domain routes,
  not just the UI.

## Route ownership (verified — namespaces are cleanly separated)

The two surfaces never share an HTTP route. Operator UI uses `/admin/*` and `/api/*`; settings
uses `/settings/api/admin/*`. So the removed controls' operator routes become cleanly orphaned.

**Orphaned operator routes to remove (exclusive to the 4 removed sections):**

| Route(s)                                                                                                                                                        | Server owner                                                         | Belongs to    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------- |
| `GET/POST /admin/llm`                                                                                                                                           | `src/debug/server.ts:155` (+ its handler)                            | System        |
| `GET/POST /admin/plugin-config`                                                                                                                                 | `src/debug/server.ts:163` → `src/debug/plugin-config-routes.ts`      | Plugin Config |
| `/api/platform-instances*`, `/api/task-instances*`, `/api/admins*`, `/api/platform-provider-types`, `/api/task-provider-types`, `/api/platform-instances/apply` | `src/debug/instance-routes.ts`, `src/debug/instance-admin-routes.ts` | Instances     |
| `/auth/groups`, `/auth/groups/{id}` (DELETE)                                                                                                                    | `src/debug/server.ts:191-193` → `handleAuthGroups`                   | Groups        |

**MUST be preserved (shared with settings or with kept views):**

- `src/instances/*` (stores, `encryption.ts`, `types.ts`) and `src/debug/instance-config-validation.ts`
  — imported by the settings instance routes (`src/debug/settings/admin/instances-routes.ts`).
- `/admin/identity/mappings`, `/admin/subjects/*`, and the stats/billing routes — used by the
  **kept** Identities/Stats/Billing dashboard views.
- `src/debug/instance-route-support.ts` — **verify** at implementation time whether settings or
  any kept code imports it; remove only if exclusively used by the removed `/api/*` handlers.

## Parity checks (gating — run BEFORE deleting the corresponding section)

Removal must lose no capability. Two areas need a pre-deletion parity check; if a gap exists,
migrate the missing capability into the settings section first, then delete.

1. **System / LLM creds.** Settings `AdminSystemSection` must edit all five keys
   (`llm_apikey`, `llm_baseurl`, `main_model`, `small_model`, `embedding_model`) with the
   sensitive key (`llm_apikey`) masked, matching the `/admin` `CredentialsForm`. (Settings
   writes via `submitAdminSystem` → `POST /settings/api/admin/system`.)
2. **Instances "apply".** The `/admin` Instances UI has an apply action
   (`POST /api/platform-instances/apply`). Confirm the settings `AdminInstancesSection`
   provides an equivalent; if absent, migrate it before deleting the `/admin` section and the
   `/api/*` routes.

`Groups` and `Plugin Config` need no migration: settings `AdminGroupsSection` is a superset
(authorize + remove) of the `/admin` group-delete, and `AdminPluginsConfigSection` is the
canonical editable plugin-config surface (it even gained the Clear/unset control in the prior
config-unset work). **This also retires the deferred follow-up** to add a Clear button to the
`/admin` Plugin Config UI — that UI is being removed.

## Architecture / units

One self-contained unit per removed control (UI + exclusive client fetchers/schemas/stories/tests

- exclusive server route/handler/tests), preceded by its parity check. Each unit is independently
  reviewable and leaves the app working.

### Unit 1 — Remove Plugin Config (no parity migration needed)

- Delete: `client/admin/sections/PluginConfigSection.svelte`,
  `client/admin/components/PluginConfigForm.svelte`,
  `client/admin/plugin-config-fetchers.ts`, `client/admin/plugin-config-fetcher-schemas.ts`,
  and their `*.stories.svelte` + tests.
- Server: remove the `/admin/plugin-config` branch in `src/debug/server.ts` and delete
  `src/debug/plugin-config-routes.ts` (the **operator** one — NOT
  `src/debug/settings/admin/plugin-config-routes.ts`) + its tests.

### Unit 2 — Remove System / LLM creds (parity check 1 first)

- Parity check 1 (above). Migrate to `AdminSystemSection` if any key/masking is missing.
- Delete: `client/admin/sections/SystemSection.svelte`,
  `client/admin/components/CredentialsForm.svelte`, the LLM-cred fetchers in
  `client/admin/fetchers.ts` (prune, keep the rest) + their stories/tests.
- Server: remove the `/admin/llm` branch in `src/debug/server.ts` and its handler + tests.

### Unit 3 — Remove Instances (parity check 2 first)

- Parity check 2 (above). Migrate "apply" to `AdminInstancesSection` if absent.
- Delete: `client/admin/sections/InstancesSection.svelte`,
  `client/admin/instance-fetchers.ts`, `client/admin/instance-fetcher-schemas.ts` + stories/tests.
- Server: remove the `/api/platform-instances*`, `/api/task-instances*`, `/api/admins*`,
  `/api/platform-provider-types`, `/api/task-provider-types` branches in `src/debug/server.ts`
  and delete `src/debug/instance-routes.ts`, `src/debug/instance-admin-routes.ts` + tests.
  **Keep** `src/instances/*`, `src/debug/instance-config-validation.ts`. Verify
  `src/debug/instance-route-support.ts` is now unused before deleting it.

### Unit 4 — Remove Groups (no parity migration needed)

- Delete: `client/admin/sections/GroupsSection.svelte` + the group-delete fetcher in
  `client/admin/fetchers.ts` + stories/tests.
- Server: remove the `/auth/groups` and `/auth/groups/{id}` branches in `src/debug/server.ts`
  and the `handleAuthGroups` handler + tests (verify no other caller).

### Unit 5 — Nav + app shell

- `client/admin/AdminApp.svelte`: drop the four imports and `<...Section/>` renders.
- `client/admin/components/AdminSidebarPanel.svelte`: remove the four nav entries.
- `client/admin/admin.svelte.ts`: remove the four section ids from the `currentSection`
  union / section registry; update `client/admin/scrollspy.ts` if it enumerates sections.
- Prune `client/admin/fetchers.ts` and `client/admin/fetcher-schemas.ts` to drop only the
  now-unused exports (LLM creds, group delete), keeping stats/subjects/identity/overview/billing.
- Verify `bun run knip` is clean (no orphaned exports) after pruning.

### Unit 6 — Docs

- `CLAUDE.md`: update the operator-surface descriptions that reference the removed controls
  (`/admin#system` LLM creds, `/admin#instances`, `GET/POST /admin/llm`,
  `/api/platform-instances`/`/api/task-instances`/`/api/admins`, `/auth/groups`). Point admin
  cred/instance/group/plugin-config management at the **settings** admin section, and state that
  `/admin` is now a read-only dashboard (Overview/Billing/Stats/Memos/Reminders/Identities).
- Update any deployment docs that instruct using `/admin#system` for LLM creds.

## Data flow (after)

```
Admin configuration  -> settings SPA admin section (/settings/api/admin/*, super-admin gated)
Operator dashboard   -> /admin: read-only Overview/Billing/Stats + Memos/Reminders/Identities views
Engineer debugging   -> /debug (unchanged)
```

No data migration: settings already persists the same underlying state (system_config,
platform_instances/task_instances, authorized_groups, plugin admin config) through its own
routes; only the duplicate UI/route entry points are removed.

## Error handling / safety

- **Lose-no-capability:** the two parity checks gate deletion; migrate-then-delete if a gap
  exists. Do not delete a `/admin` control section until its settings equivalent is confirmed
  to cover it.
- **Shared-module safety:** never remove `src/instances/*`, `instance-config-validation.ts`, or
  routes used by kept views. `knip` + the full test suite are the backstop (a removed-but-still-
  imported symbol fails the build).
- **No external consumers:** the removed `/admin/*` and `/api/*` operator routes are UI-only
  (the bot reads creds/instances directly from the DB, not via HTTP; `/api/notify` is a
  separate token-gated plane and is NOT touched).

## Testing

- After each unit: `bun run test` (server) + `bun test:client` stay green; `bun run knip` clean;
  `bun check:full` 12/12.
- Delete the removed sections'/routes' tests and stories along with their subjects (a test for
  a deleted route/component should be removed, not left dangling).
- Add/keep a settings-side test asserting the migrated capability (only if a parity migration
  was required — e.g. System's full key set or Instances "apply").
- Bundle-isolation / `knip` confirm no orphaned exports remain after pruning shared files.

## Out of scope / deferred

- Merging `/admin` and `/debug` into a single dashboard (kept separate).
- Removing or restructuring the kept read-only views (Overview/Billing/Stats/Memos/Reminders/
  Identities) or their routes.
- Any change to the settings admin sections beyond a parity migration if a check fails.

<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Web UI — Surface Spec (HTTP API & Client SPA)

**Date:** 2026-05-28
**Status:** Draft spec
**Parent:** [`2026-05-28-settings-web-ui-design.md`](./2026-05-28-settings-web-ui-design.md)

## Scope

The user-facing surface of the settings UI, in two parts:

- **Part A — HTTP API Surface:** the `/settings/*` route family added to
  the existing `Bun.serve()` server (`src/debug/server.ts`), and how each
  route maps onto existing stores. This is an inventory + mapping spec,
  not a wire-format reference; field-level schemas come from the existing
  Zod definitions.
- **Part B — Client SPA:** the `client/settings/` single-page app — its
  place in the existing build pipeline, structure, sections (gated by
  role + selected context), and the session/CSRF bootstrap. Reuses the
  Svelte 5 + Bun-bundler stack already used by `client/admin/` and
  `client/debug/`.

Every write reuses existing validators and is gated by `requireScope`
(Access Model spec, Part B).

---

# Part A — HTTP API Surface

## Conventions

- Base path: `/settings/api`. Static SPA + auth at `/settings`,
  `/settings/auth/*` (see the Access Model spec).
- Auth: settings session cookie only (never `DEBUG_TOKEN`). Writes
  require the CSRF header.
- All reads mask sensitive values (reuse `maskSensitiveValue` /
  `maskConfig`). All writes validate before persisting.
- All context-scoped routes accept a `contextId` (query for GET, body for
  writes) and pass it through `requireScope` → validated `contextId`.
- Suggested implementation location: `src/debug/settings-routes.ts` (and
  sub-files), mirroring `src/debug/instance-routes.ts`. Wire into the
  path-prefix branch in `src/debug/server.ts` ahead of the
  `DEBUG_TOKEN` branch.

## Bootstrap

| Route                     | Method | Returns                                                                                                                           |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `/settings/api/bootstrap` | GET    | principal display, role flags (`isBotAdmin`, `isSuperAdmin`), context switcher options (personal + manageable groups), CSRF token |

Drives the SPA's initial render and section gating (Part B below).

## User tier (own context, or a managed group via `contextId`)

### Config fields

| Route                             | Method | Maps to                                                                                                 |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `/settings/api/config?contextId=` | GET    | `getConfigFieldsForContext` + per-field current values (masked) — `src/config-keys.ts`, `src/config.ts` |
| `/settings/api/config`            | PATCH  | `validateConfigField` (`src/config-editor/validation.ts`) → `setConfigValue` (`src/config.ts`)          |

Replaces the `cfg:` editor flow.

### Tools

| Route                            | Method | Maps to                                                                                                                                                                  |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/settings/api/tools?contextId=` | GET    | available tools for context + domain/tool status — `src/tools/tool-preferences.ts` (`getToolPrefs`, `getDomainStatus`), `src/tools/tool-metadata.ts` (`getToolMetadata`) |
| `/settings/api/tools/toggle`     | POST   | `toggleTool` / `toggleDomain` → `setToolPrefs`                                                                                                                           |

Replaces the `tgl:` flow. The GET must return the _computed available
set_ for the context (capability + context gated), not just the raw
denylist, so the UI shows only togglable tools.

### MCP endpoints

| Route                          | Method | Maps to                                                                                                                 |
| ------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `/settings/api/mcp?contextId=` | GET    | parsed endpoints (`parseMcpEndpoints`), headers masked — `src/mcp/user-endpoints.ts`                                    |
| `/settings/api/mcp`            | PUT    | validate each entry against `mcpEndpointConfigSchema` (`src/mcp/types.ts`) → write `mcp_endpoints` via `setConfigValue` |

Upgrade over today's raw-JSON editing: the SPA renders a structured
form; the server still validates with the same Zod schema. Editing this
key must invalidate the tool cache (already handled by
`TOOL_ASSEMBLY_CONFIG_KEYS` in `src/config.ts`).

### Plugins (per-context enablement)

| Route                              | Method | Maps to                                                                                                                                              |
| ---------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/settings/api/plugins?contextId=` | GET    | per-plugin eligibility + enabled state — `getPluginContextEligibility` (`src/plugins/registry.ts`), `getPluginContextState` (`src/plugins/store.ts`) |
| `/settings/api/plugins/toggle`     | POST   | `setPluginEnabledForContext` (verify required config present first)                                                                                  |
| `/settings/api/plugins/config`     | PATCH  | plugin config keys (`plugin:<id>:<key>`) via `setConfigValue`, validated against manifest `configRequirements`                                       |

Replaces the `plg:` flow. Approve/reject are admin-tier (below).

### Identity

| Route                               | Method     | Maps to                                                            |
| ----------------------------------- | ---------- | ------------------------------------------------------------------ |
| `/settings/api/identity?contextId=` | GET        | current mapping — `getIdentityMapping` (`src/identity/mapping.ts`) |
| `/settings/api/identity`            | PUT/DELETE | `setIdentityMapping` / `clearIdentityMapping`                      |

Replaces the `set_my_identity` / `clear_my_identity` tool path for manual
linking.

### Setup / onboarding

The `/setup` wizard collapses into the config + identity + task-instance
forms above. The Kaneo auto-provision step (`provisionAndConfigure`)
needs a dedicated action returning the generated credentials once
(OQ-H3):

| Route                           | Method | Maps to                                                                                |
| ------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `/settings/api/provision/kaneo` | POST   | `provisionAndConfigure` (group Kaneo bootstrap); returns generated email/password once |

## Group-admin tier (`contextId` = a managed group)

The user-tier routes above already accept a group `contextId` and are
gated by `requireScope(kind: 'group')`. Additional group-only routes:

| Route                                    | Method      | Maps to                                                          |
| ---------------------------------------- | ----------- | ---------------------------------------------------------------- |
| `/settings/api/group/members?contextId=` | GET         | `listGroupMembers` (`src/groups.ts`)                             |
| `/settings/api/group/members`            | POST/DELETE | `addGroupMember` / `removeGroupMember`                           |
| `/settings/api/group/task-instance`      | GET/PATCH   | context→task-instance mapping — `src/instances/context-store.ts` |

Replaces the `/group` in-group admin subcommands (`adduser`, `deluser`,
`users`).

## Bot-admin tier (`requireScope(kind: 'admin')`)

Much of this already exists under `DEBUG_TOKEN`-gated routes; the
settings layer exposes the same capabilities authorized by **bot-admin
principal status** instead. Two implementation options (OQ-H1):

- **(a)** Re-expose under `/settings/api/admin/*` thin wrappers that call
  the same store functions the existing `/api/*` and `/admin/*` handlers
  use.
- **(b)** Allow the SPA to call the existing `/api/*` + `/admin/*` routes,
  but teach `isAuthorizedRequest` to _also_ accept a bot-admin settings
  session for those routes.

**Resolved (OQ-H1): option (a)** — thin `/settings/api/admin/*`
wrappers. This preserves the strict prefix-based trust split from the
Access Model spec (no settings cookie ever satisfies a `DEBUG_TOKEN`
route). Option (b) is rejected: `isAuthorizedRequest` in
`src/debug/server.ts` is today a single global Bearer gate run at the top
of `routeRequest`, so teaching it to also accept settings sessions would
entangle the two trust domains — exactly what the Access Model spec
forbids. Mapping:

| Capability                 | Existing store / handler                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Platform instances CRUD    | `src/instances/platform-store.ts` (cf. `src/debug/instance-routes.ts`)                                      |
| Task instances CRUD        | `src/instances/task-store.ts`                                                                               |
| Provider type descriptors  | existing `/api/platform-provider-types`, `/api/task-provider-types`                                         |
| Admin roster               | `src/instances/admin-store.ts` (`addAdmin`/`removeAdmin`/`listAdmins`) — SA-gated                           |
| System LLM/system config   | `src/system-config.ts` (`setSystemConfig`); cf. `src/debug/admin-llm.ts`                                    |
| Authorized users           | `src/users.ts` (`addUser`/`removeUser`/`listUsers`)                                                         |
| Authorized groups          | `src/authorized-groups.ts`                                                                                  |
| Plugin approve/reject      | `src/plugins/store.ts` — SA-gated                                                                           |
| Plugin config (admin view) | existing `/admin/plugin-config` logic                                                                       |
| Announce                   | the `/announce` broadcast logic in `src/commands/admin.ts` (extract the broadcast into a reusable function) |

## Error & masking contract

- 401 when no/invalid session; 403 from `requireScope`; 422 on
  validation failure (carry the validator's message).
- Sensitive values never returned in plaintext; write-only.
- No free-form user content echoed beyond what the editor already shows;
  respect existing logging rules (never log codes, tokens, session ids).

---

# Part B — Client SPA

## Stack & build integration

- Same stack as existing clients: **Svelte 5**, compiled by
  `scripts/svelte-plugin.ts`, bundled (IIFE) by `scripts/build-client.ts`
  into `public/`.
- Add a third bundle entry to the `BUNDLES` array in
  `scripts/build-client.ts`: `client/settings/index.ts` →
  `settings.js` / `settings.css`, with `client/settings/settings.html`
  as the shell (mirror `client/admin/admin.html`: `<div id="app">`,
  strict CSP `default-src 'self'`).
- Served by the existing static handler (`handleClientFile` in
  `src/debug/server.ts`) for `/settings`, `/settings.js`, `/settings.css`
  — but note these are reachable only after auth bootstrap (Access Model
  spec); the static assets themselves can be public, the **data** is not.
- `bun check:bundle-isolation` must continue to pass — the dev-only
  stories harness must not leak into the new bundle.

## Entry & session bootstrap

1. `/settings?code=XXXX` loads `settings.html` → `settings.js`.
2. On mount, the app reads `code` from the query string and calls
   `POST /settings/auth/exchange` (Access Model spec). On success it
   discards the `code` from the URL (history replace) so it isn't
   bookmarked/leaked.
3. It then calls `GET /settings/api/bootstrap` (Part A above) to get role
   flags, the context switcher options, and the CSRF token, which it
   holds in memory (not localStorage) and sends on every write.
4. If there is no `code` and no valid session cookie, render a
   "request a new link via /config" message — no login form (auth
   originates in chat).

## Layout

Mirror the admin shell pattern (`client/admin/AdminApp.svelte`,
`AdminSidebarPanel.svelte`, hash navigation + scroll spy in
`scrollspy.ts`):

- `client/settings/SettingsApp.svelte` — root, mounts `#app`.
- A **context switcher** in the top bar: Personal | each managed group.
  Changing it re-fetches the active section for the new `contextId`.
- A sidebar whose visible sections depend on role flags from bootstrap.
- Section components under `client/settings/sections/`.
- Shared fetch helpers under `client/settings/fetchers.ts` that always
  attach the CSRF header on writes and the current `contextId`.
- Reuse `client/shared/*` UI primitives/types where they exist.

## Sections by tier

### Always (authorized user, scoped to selected context)

| Section       | Backing routes (Part A)                                         |
| ------------- | --------------------------------------------------------------- |
| Profile       | `/settings/api/config` (timezone et al.)                        |
| Task provider | `/settings/api/config` (creds), `/settings/api/provision/kaneo` |
| Tools         | `/settings/api/tools`, `/settings/api/tools/toggle`             |
| MCP           | `/settings/api/mcp` (structured form)                           |
| Plugins       | `/settings/api/plugins`, `.../toggle`, `.../config`             |
| Identity      | `/settings/api/identity`                                        |

### When selected context is a managed group (group admin / bot admin)

| Section        | Backing routes                      |
| -------------- | ----------------------------------- |
| Members        | `/settings/api/group/members`       |
| Group provider | `/settings/api/group/task-instance` |

### When `isBotAdmin` (admin area)

| Section            | Backing routes                                    |
| ------------------ | ------------------------------------------------- |
| Instances          | `/settings/api/admin/*` (platform/task instances) |
| System (LLM)       | `/settings/api/admin/*` (system config)           |
| Users              | `/settings/api/admin/*` (authorized users)        |
| Groups             | `/settings/api/admin/*` (authorized groups)       |
| Admins             | `/settings/api/admin/*` (roster; SA only)         |
| Plugins (approval) | `/settings/api/admin/*` (approve/reject; SA only) |
| Announce           | `/settings/api/admin/*`                           |

The admin sections can lift markup/logic from the existing
`client/admin/sections/*` components where the data shape matches, but
must call the new session-authorized routes (Part A, OQ-H1), not the
`DEBUG_TOKEN` ones.

## UX notes

- **MCP form** replaces raw-JSON editing: rows of
  `{ label, url, enabled, headers[], toolFilter }`, validated client-side
  for fast feedback but authoritative validation is server-side.
- **Tools** mirror the chat drill-down: domain list with
  on/off/partial → expand to per-tool toggles with risk indicators
  (`getToolMetadata` risk field).
- **Masked secrets**: sensitive fields show a masked placeholder and a
  "replace" affordance; empty submit = no change.
- **Session expiry**: on 401, prompt the user to request a new link via
  `/config`.
- Keep the strict CSP; no third-party scripts.

## Testing

- Client tests run under `bun test:client` (happy-dom) with
  `tests/client-setup.ts`; mirror `tests/client/admin/*` structure under
  `tests/client/settings/*`. Per TDD hooks, components in `client/` are
  test-gated.

---

## Open questions

### HTTP API

- OQ-H1 — **[RESOLVED 2026-05-28]** Admin-tier exposure: **thin
  `/settings/api/admin/*` wrappers** (rejected: teaching the existing
  global `isAuthorizedRequest` gate to also accept admin sessions, which
  would entangle the two trust domains). See §"Bot-admin tier".
- OQ-H2 — Whether group task-instance _creation_ (vs selection) is in
  scope for group admins or stays bot-admin-only.
- OQ-H3 — Kaneo auto-provision UX in a form world: one-time credential
  reveal, retry semantics (today the wizard tells the user to re-run
  `/setup`).

### Client SPA

- OQ-C1 — Reuse vs fork of `client/admin/sections/*` for the admin area
  (shared component lib vs copy). Affects whether `/admin` and the
  settings admin area converge long-term.
- OQ-C2 — Whether the operator `/admin` UI is eventually folded into the
  settings admin area (single surface) or kept separate for
  `DEBUG_TOKEN`-only deployments. Out of scope for the first slice but
  shapes component sharing.

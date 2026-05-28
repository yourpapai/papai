<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Web UI — HTTP API Surface Spec

**Date:** 2026-05-28
**Status:** Draft spec
**Parent:** [`2026-05-28-settings-web-ui-overview-design.md`](./2026-05-28-settings-web-ui-overview-design.md)

## Scope

The `/settings/*` route family added to the existing `Bun.serve()` server
(`src/debug/server.ts`), and how each route maps onto existing stores.
Routes are grouped by tier. Every write reuses existing validators and is
gated by `requireScope` (sub-spec 3). This is an inventory + mapping
spec, not a wire-format reference; field-level schemas come from the
existing Zod definitions.

## Conventions

- Base path: `/settings/api`. Static SPA + auth at `/settings`,
  `/settings/auth/*` (sub-spec 2).
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

| Route | Method | Returns |
| --- | --- | --- |
| `/settings/api/bootstrap` | GET | principal display, role flags (`isBotAdmin`, `isSuperAdmin`), context switcher options (personal + manageable groups), CSRF token |

Drives the SPA's initial render and section gating (sub-spec 5).

## User tier (own context, or a managed group via `contextId`)

### Config fields

| Route | Method | Maps to |
| --- | --- | --- |
| `/settings/api/config?contextId=` | GET | `getConfigFieldsForContext` + per-field current values (masked) — `src/config-keys.ts`, `src/config.ts` |
| `/settings/api/config` | PATCH | `validateConfigField` (`src/config-editor/validation.ts`) → `setConfigValue` (`src/config.ts`) |

Replaces the `cfg:` editor flow.

### Tools

| Route | Method | Maps to |
| --- | --- | --- |
| `/settings/api/tools?contextId=` | GET | available tools for context + domain/tool status — `src/tools/tool-preferences.ts` (`getToolPrefs`, `getDomainStatus`), `src/tools/tool-metadata.ts` (`getToolMetadata`) |
| `/settings/api/tools/toggle` | POST | `toggleTool` / `toggleDomain` → `setToolPrefs` |

Replaces the `tgl:` flow. The GET must return the *computed available
set* for the context (capability + context gated), not just the raw
denylist, so the UI shows only togglable tools.

### MCP endpoints

| Route | Method | Maps to |
| --- | --- | --- |
| `/settings/api/mcp?contextId=` | GET | parsed endpoints (`parseMcpEndpoints`), headers masked — `src/mcp/user-endpoints.ts` |
| `/settings/api/mcp` | PUT | validate each entry against `mcpEndpointConfigSchema` (`src/mcp/types.ts`) → write `mcp_endpoints` via `setConfigValue` |

Upgrade over today's raw-JSON editing: the SPA renders a structured
form; the server still validates with the same Zod schema. Editing this
key must invalidate the tool cache (already handled by
`TOOL_ASSEMBLY_CONFIG_KEYS` in `src/config.ts`).

### Plugins (per-context enablement)

| Route | Method | Maps to |
| --- | --- | --- |
| `/settings/api/plugins?contextId=` | GET | per-plugin eligibility + enabled state — `getPluginContextEligibility` (`src/plugins/registry.ts`), `getPluginContextState` (`src/plugins/store.ts`) |
| `/settings/api/plugins/toggle` | POST | `setPluginEnabledForContext` (verify required config present first) |
| `/settings/api/plugins/config` | PATCH | plugin config keys (`plugin:<id>:<key>`) via `setConfigValue`, validated against manifest `configRequirements` |

Replaces the `plg:` flow. Approve/reject are admin-tier (below).

### Identity

| Route | Method | Maps to |
| --- | --- | --- |
| `/settings/api/identity?contextId=` | GET | current mapping — `getIdentityMapping` (`src/identity/mapping.ts`) |
| `/settings/api/identity` | PUT/DELETE | `setIdentityMapping` / `clearIdentityMapping` |

Replaces the `set_my_identity` / `clear_my_identity` tool path for manual
linking.

### Setup / onboarding

The `/setup` wizard collapses into the config + identity + task-instance
forms above. The Kaneo auto-provision step (`provisionAndConfigure`)
needs a dedicated action returning the generated credentials once
(OQ-H3):

| Route | Method | Maps to |
| --- | --- | --- |
| `/settings/api/provision/kaneo` | POST | `provisionAndConfigure` (group Kaneo bootstrap); returns generated email/password once |

## Group-admin tier (`contextId` = a managed group)

The user-tier routes above already accept a group `contextId` and are
gated by `requireScope(kind: 'group')`. Additional group-only routes:

| Route | Method | Maps to |
| --- | --- | --- |
| `/settings/api/group/members?contextId=` | GET | `listGroupMembers` (`src/groups.ts`) |
| `/settings/api/group/members` | POST/DELETE | `addGroupMember` / `removeGroupMember` |
| `/settings/api/group/task-instance` | GET/PATCH | context→task-instance mapping — `src/instances/context-store.ts` |

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
  but teach `isAuthorizedRequest` to *also* accept a bot-admin settings
  session for those routes.

This spec recommends **(a)** to preserve the strict prefix-based trust
split from sub-spec 2 (no settings cookie ever satisfies a
`DEBUG_TOKEN` route). Mapping:

| Capability | Existing store / handler |
| --- | --- |
| Platform instances CRUD | `src/instances/platform-store.ts` (cf. `src/debug/instance-routes.ts`) |
| Task instances CRUD | `src/instances/task-store.ts` |
| Provider type descriptors | existing `/api/platform-provider-types`, `/api/task-provider-types` |
| Admin roster | `src/instances/admin-store.ts` (`addAdmin`/`removeAdmin`/`listAdmins`) — SA-gated |
| System LLM/system config | `src/system-config.ts` (`setSystemConfig`); cf. `src/debug/admin-llm.ts` |
| Authorized users | `src/users.ts` (`addUser`/`removeUser`/`listUsers`) |
| Authorized groups | `src/authorized-groups.ts` |
| Plugin approve/reject | `src/plugins/store.ts` — SA-gated |
| Plugin config (admin view) | existing `/admin/plugin-config` logic |
| Announce | the `/announce` broadcast logic in `src/commands/admin.ts` (extract the broadcast into a reusable function) |

## Error & masking contract

- 401 when no/invalid session; 403 from `requireScope`; 422 on
  validation failure (carry the validator's message).
- Sensitive values never returned in plaintext; write-only.
- No free-form user content echoed beyond what the editor already shows;
  respect existing logging rules (never log codes, tokens, session ids).

## Open questions

- OQ-H1 — Admin-tier exposure: thin `/settings/api/admin/*` wrappers
  (recommended) vs teaching existing routes to accept admin sessions.
- OQ-H2 — Whether group task-instance *creation* (vs selection) is in
  scope for group admins or stays bot-admin-only.
- OQ-H3 — Kaneo auto-provision UX in a form world: one-time credential
  reveal, retry semantics (today the wizard tells the user to re-run
  `/setup`).

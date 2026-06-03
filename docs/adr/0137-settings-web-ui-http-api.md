<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0137: Settings Web UI — HTTP API (Part A)

## Status

Implemented

## Date

2026-05-28 – 2026-06-02

## Context

papai's configuration surface was accessible only through chat-embedded
callback flows (`cfg:`, `tgl:`, `plg:`, `gsel:`) and a `DEBUG_TOKEN`-gated
operator admin panel. The access-model spec (migration `050_settings_auth`)
introduced session-authorized, scope-checked settings access with one-time
auth-code issuance and CSRF tokens — but no data routes existed under
`/settings/api/*` besides `/settings/api/session` (bootstrap). The settings
web UI needed a complete HTTP API family so the forthcoming SPA (Part B) could
read and write per-context config, tools, MCP endpoints, plugins, identity,
group membership, and bot-admin operations through the same session trust
domain — without ever satisfying a `DEBUG_TOKEN` route.

The design spec (`docs/superpowers/specs/2026-05-28-settings-web-ui-surface-design.md`,
Part A) defined the route inventory and store mappings. The implementation
plan (`docs/archive/2026-05-29-settings-web-ui-http-api.md`) broke the work
into 15 tasks.

## Decision Drivers

- **Trust-domain separation**: A settings session cookie must never satisfy a
  `DEBUG_TOKEN`-gated route. The two trust domains are strictly prefix-based.
- **Scope-gated access**: Every context-scoped route resolves a validated
  `contextId` through `requireScope` (personal, group, or admin kind) before
  touching storage.
- **CSRF on writes**: All write endpoints require the `X-Settings-CSRF` header
  synchronized with the session's synchronizer token.
- **No new stores**: Every handler delegates to existing store functions and
  validators — the same code paths the chat callback flows and the
  `DEBUG_TOKEN` handlers use.
- **Masking contract**: Sensitive values (API keys, tokens, headers) are never
  returned in plaintext. Reads mask; the client resubmits real values or the
  masked sentinel (treated as "no change").
- **Admin via thin wrappers**: The SPA's admin area reaches the same stores
  as the `DEBUG_TOKEN` handlers, but through new `/settings/api/admin/*`
  wrappers — not by teaching the existing global Bearer gate to accept
  settings sessions (which would entangle the two trust domains).

## Considered Options

### Option A: Teach `isAuthorizedRequest` to accept admin settings sessions

Allow the SPA to call existing `/api/*` + `/admin/*` routes with a settings
session that carries bot-admin status.

- **Pros**: No new route code; admin SPA sections reuse existing fetch calls.
- **Cons**: `isAuthorizedRequest` is a single global Bearer gate at the top of
  `routeRequest`. Accepting a second credential type there entangles the two
  trust domains — exactly what the Access Model spec forbids. A settings
  cookie could satisfy a `DEBUG_TOKEN` route.

### Option B: Thin `/settings/api/admin/*` wrappers (chosen)

New route handlers under `/settings/api/admin/*` call the same store functions
the `DEBUG_TOKEN` handlers use. Each is gated by `requireScope({ kind: 'admin' })`
or `requireSuperAdmin`.

- **Pros**: Strict prefix-based trust split preserved; no `DEBUG_TOKEN` route
  ever sees a settings cookie; thin wrappers add minimal code.
- **Cons**: Duplicated route surface (same capabilities exposed twice under
  different auth); wrappers must be kept in sync if store signatures change.

### Option C: Shared store service layer with route adapters

Extract a shared "admin service" layer that both `DEBUG_TOKEN` routes and
settings routes call.

- **Pros**: Single authoritative service for each admin capability.
- **Cons**: Refactor scope too large for this slice; existing `DEBUG_TOKEN`
  handlers are thin enough that the duplication risk is low; can evolve to
  this later without breaking the API contract.

## Decision

**Option B** — thin `/settings/api/admin/*` wrappers. Subsidiary decisions:

| Topic                | Decision                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Router               | New `settings-api-router.ts` dispatches `/settings/api/*` (excluding `/settings/api/session`, owned by `settings-router.ts`). Returns `null` for unowned subpaths so the 404 fallthrough still works.                                                        |
| Shared guards        | `respond.ts` centralizes `authenticate`, `requireCsrf`, `resolveContextScope`, `parseJsonBody`, `settingsJson` — every handler is a few lines of preamble + store call.                                                                                      |
| Context scope        | `resolveContextScope` maps a raw `contextId` (omitted → personal, group-matching → group) to a validated canonical `contextId`. Handlers always use the resolved value, never the raw client input.                                                          |
| Config routes        | `GET/PATCH /settings/api/config` — replaces `cfg:` flow. PATCH validates one field via `validateConfigField` and persists. Masked reads; empty submit on sensitive fields means "no change".                                                                 |
| Tools routes         | `GET /settings/api/tools` + `POST /settings/api/tools/toggle` — replaces `tgl:` flow. GET returns the computed available set (capability+context gated), grouped by domain with per-domain status and per-tool risk. Toggle flips a domain or a single tool. |
| MCP routes           | `GET/PUT /settings/api/mcp` — replaces raw-JSON editing. PUT validates each endpoint against `mcpEndpointConfigSchema`, restores masked headers from stored config, and writes via `setConfigValue` (which invalidates the tool cache).                      |
| Plugin routes        | `GET /settings/api/plugins`, `POST .../toggle`, `PATCH .../config` — replaces `plg:` flow. Toggle refuses to enable when config is missing. Config PATCH is validated against manifest `configRequirements`.                                                 |
| Identity routes      | `GET/PUT/DELETE /settings/api/identity` — replaces `set_my_identity`/`clear_my_identity` tool path for manual provider linking. Provider name derived from context's assigned task instance.                                                                 |
| Provision route      | `POST /settings/api/provision/kaneo` — one-time credential reveal (`email`, `password`, `kaneoUrl`, `workspaceId`). Returns `422` when registration is disabled or no Kaneo URL is configured.                                                               |
| Group routes         | `GET/POST/DELETE .../group/members`, `GET/PATCH .../group/task-instance` — replaces in-group `/group` admin subcommands. Task-instance creation stays bot-admin-only (OQ-H2 resolved: select only).                                                          |
| Admin instances      | `GET/POST/PATCH/DELETE` for platform/task instances, plus provider-type descriptors. Instance configs masked with `maskConfig`.                                                                                                                              |
| Admin system/access  | System LLM read/write (masked `llm_apikey`), authorized users CRUD, authorized groups CRUD.                                                                                                                                                                  |
| Admin roster/plugins | Roster management (SA-gated), plugin approve/reject (SA-gated, keyed to manifest hash), announce broadcast (bot-admin-gated, reuses extracted `broadcastMessage`).                                                                                           |
| Broadcast extraction | `broadcastMessage` extracted from `handleAnnounce` in `src/commands/admin.ts` into `src/commands/announce-broadcast.ts` — shared by the chat command and the settings announce route.                                                                        |
| Error codes          | `401` (no/invalid session), `403` (scope failure or bad CSRF), `400` (malformed JSON), `422` (validation failure, carries validator message), `405` (wrong method), `404` (unknown subpath), `429` (rate limited).                                           |
| Bootstrap            | `/settings/api/bootstrap` alias added; returns `display` (username or platform user ID), role flags, context switcher options, CSRF token.                                                                                                                   |

## Consequences

### Positive

- Settings web UI can fully replace chat callback flows (`cfg:`, `tgl:`, `plg:`,
  `gsel:`, `wizard_`) with structured HTTP endpoints — enabling a proper SPA.
- Trust domains remain strictly separate: no settings cookie ever satisfies a
  `DEBUG_TOKEN` route, and no `DEBUG_TOKEN` ever reaches a settings route.
- Every write goes through existing validators and `requireScope` — the same
  guard rails as the chat flows, with no bypass path.
- Masked reads and "no change on empty submit" prevent accidental credential
  exposure while preserving update ergonomics.
- The computed available tool set (capability+context gated) means the UI shows
  only togglable tools — not the raw denylist.

### Negative

- Admin capabilities are exposed twice: once under `DEBUG_TOKEN` routes and
  once under `/settings/api/admin/*`. Both must be kept in sync when store
  signatures change.
- The `settings-api-router.ts` dispatch table grows with every new route;
  a future refactor to a declarative route table could reduce boilerplate.
- The announce route depends on a live `ChatRouter` singleton, adding a
  runtime coupling between the settings layer and the chat router.

### Risks

- If a new admin store function is added without a corresponding settings
  wrapper, the SPA admin area silently falls behind the `DEBUG_TOKEN`
  surface. Mitigation: the CLAUDE.md module map documents the wrapper
  relationship; code review should flag missing wrappers.
- The one-time Kaneo credential reveal (`email`/`password`) in the provision
  response is not stored server-side for re-read. If the user closes the
  settings tab before copying, they must re-provision. This matches the
  existing wizard behavior (re-run `/setup`).

## Implementation Notes

Key modules:

| File                                                | Role                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/debug/settings-api-router.ts`                  | Dispatch `/settings/api/*` to handlers; returns `null` for unowned paths                     |
| `src/debug/settings/respond.ts`                     | Shared `authenticate`, `requireCsrf`, `resolveContextScope`, `parseJsonBody`, `settingsJson` |
| `src/debug/settings/config-routes.ts`               | `GET/PATCH /settings/api/config`                                                             |
| `src/debug/settings/tools-routes.ts`                | `GET /settings/api/tools`, `POST .../toggle`                                                 |
| `src/debug/settings/mcp-routes.ts`                  | `GET/PUT /settings/api/mcp`                                                                  |
| `src/debug/settings/plugins-routes.ts`              | `GET /settings/api/plugins`, `POST .../toggle`, `PATCH .../config`                           |
| `src/debug/settings/identity-routes.ts`             | `GET/PUT/DELETE /settings/api/identity`                                                      |
| `src/debug/settings/provision-routes.ts`            | `POST /settings/api/provision/kaneo`                                                         |
| `src/debug/settings/group-routes.ts`                | Group members + group task-instance                                                          |
| `src/debug/settings/admin/instances-routes.ts`      | Platform/task instances + provider types                                                     |
| `src/debug/settings/admin/system-access-routes.ts`  | System/LLM, users, groups                                                                    |
| `src/debug/settings/admin/roster-plugins-routes.ts` | Roster (SA), plugin approve/reject (SA), announce                                            |
| `src/commands/announce-broadcast.ts`                | Extracted reusable `broadcastMessage`                                                        |
| `src/debug/settings-router.ts`                      | Wire-up: delegates `/settings/api/*` to `settings-api-router.ts`                             |
| `src/debug/settings-routes.ts`                      | Bootstrap `display` + `/settings/api/bootstrap` alias                                        |

Integration points: `src/debug/server.ts` (path-prefix routing before
`DEBUG_TOKEN` check), `src/settings/scope-guard.ts` (`requireScope`),
`src/settings/request-auth.ts` (`authenticateSettingsRequest`, `verifyCsrf`),
`src/config.ts` + `src/config-keys.ts` (config fields), `src/tools/tool-preferences.ts`

- `src/tools/tool-metadata.ts` (tools), `src/mcp/types.ts` + `src/mcp/user-endpoints.ts`
  (MCP), `src/plugins/registry.ts` + `src/plugins/store.ts` (plugins),
  `src/identity/mapping.ts` (identity), `src/instances/` (instances, context-store,
  admin-store, encryption).

## Related Decisions

- ADR-0136: Settings Web UI — Access Model (session auth, scope guard, CSRF,
  one-time auth code — the foundation these routes build on).
- ADR-0138: Settings Web UI — Client SPA (Part B, consumes these routes).
- ADR-0123: Trusted-Local Plugin System — plugin registry, eligibility, and
  approval store reused by the plugin routes and admin approval wrapper.
- ADR-0009: Multi-Provider Task Tracker Support — provider type registries
  and instance model reused by the admin instance wrappers.

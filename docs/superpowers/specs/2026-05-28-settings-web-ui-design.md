<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Web UI — Overview & Architecture Spec

**Date:** 2026-05-28
**Status:** Draft spec (research output; no plan, no implementation yet)
**Branch:** `claude/chat-commands-settings-ui-TTKuC`

## Purpose of this document

This is the umbrella spec for replacing papai's interactive chat-command
configuration surface with a single, unified, permission-scoped **web
settings UI**. When a user sends `/config`, the bot replies with a URL
carrying a one-time code; opening it grants a per-user, scope-limited
session in which the user can change every setting they are permitted to
touch — personal preferences, tool toggles, MCP endpoints, plugin
enablement, group membership (group admins), and full administration
(bot admins).

This document records the agreed scope and decisions, and indexes the
scoped sub-specs that later planning sessions will deepen. It is
**spec-level**: it states decisions, data shapes, and boundaries, not
step-by-step implementation tasks.

## Agreed decisions (from this session)

- **D1 — Hosting:** The settings UI is served by the **existing debug
  server** (`src/debug/server.ts`, native `Bun.serve()`), under a new
  `/settings/*` route family. No separate listener. This means the
  settings auth domain and the operator `DEBUG_TOKEN` domain share one
  process and one bind; the access model (the Access Model spec) must
  keep the two trust domains strictly separate despite sharing a
  listener.
- **D2 — Command fate:** **Web UI only, hard removal.** Once the UI
  reaches parity, the interactive chat flows are removed, not kept as a
  fallback. The chat commands that survive become thin "here is your
  link" launchers (or are removed where redundant). See the Command
  Retirement spec.
- **D3 — Tiers:** The UI covers **all three permission tiers** in scope:
  regular user, group admin, bot admin. Each tier is detailed enough
  here to plan, but the deep design lives in the scoped sub-specs.
- **D4 — Deliverable shape:** This effort produces **scoped design
  specs only**. Implementation plans and code are deferred to later
  sessions, one per sub-spec where useful.

## Why this is tractable

The configuration _logic_ in papai is already platform-agnostic and
context-scoped. The chat commands are thin presentation/state-machine
layers over reusable stores. The migration is therefore mostly a new
**presentation + auth + transport** layer over existing modules, plus
the removal of the old chat-driven state machines.

Reusable backing modules (no business-logic rewrite expected):

| Concern                         | Module(s)                                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Per-context config get/set      | `src/config.ts`, `src/config-keys.ts`, `src/types/config.ts`                                                                              |
| Field validation                | `src/config-editor/validation.ts`                                                                                                         |
| Tool enable/disable             | `src/tools/tool-preferences.ts`, `src/tools/tool-metadata.ts`                                                                             |
| MCP endpoints                   | `src/mcp/user-endpoints.ts`, `src/mcp/types.ts` (`mcpEndpointConfigSchema`)                                                               |
| Plugins                         | `src/plugins/store.ts`, `src/plugins/registry.ts` (`getPluginContextEligibility`)                                                         |
| Authorization                   | `src/auth.ts` (`checkAuthorizationExtended`), `src/instances/admin-store.ts`, `src/users.ts`, `src/authorized-groups.ts`, `src/groups.ts` |
| Instances / system config       | `src/instances/*`, `src/system-config.ts`                                                                                                 |
| Context scoping                 | `src/chat/scoped-context.ts` (`toScopedContextId`, `getConfigContextIdFromStorageContextId`)                                              |
| Existing web server + admin API | `src/debug/server.ts`, `src/debug/instance-routes.ts`, `src/debug/admin-llm.ts`, etc.                                                     |
| Client build + Svelte stack     | `scripts/build-client.ts`, `scripts/svelte-plugin.ts`, `client/admin/*`                                                                   |

## What is being replaced

The interactive, callback-button chat flows routed through
`src/chat/interaction-router.ts`:

| Callback prefix    | Flow                              | Module                                        |
| ------------------ | --------------------------------- | --------------------------------------------- |
| `gsel:`            | personal-vs-group target selector | `src/group-settings/`                         |
| `cfg:` / `cfg:ai:` | config field editor               | `src/config-editor/`                          |
| `wizard_`          | setup wizard                      | `src/wizard/`                                 |
| `tgl:`             | tool enable/disable               | `src/chat/tool-toggle-interaction-handler.ts` |
| `plg:`             | plugin enable/disable             | `src/chat/plugin-interaction-handler.ts`      |

…and the corresponding commands in `src/commands/`: `/setup`, `/config`,
plus the management commands `/plugin`, `/group`/`/groups`,
`/user`/`/users`, `/announce`.

## Target architecture (high level)

```
/config (chat)  ──►  issue one-time code bound to (platformInstanceId, platformUserId, scope)
                       reply: https://<host>/settings?code=XXXX  (single-use, short TTL)
        │
        ▼
Browser GET /settings?code=XXXX
   POST /settings/auth/exchange {code}  ──►  httpOnly, SameSite session cookie (scoped principal)
        │
        ▼
Svelte SPA  (client/settings/)  ──►  /settings/api/*   (cookie-authenticated, CSRF-protected writes)
        │                                  │
        │                                  ▼
        │                         server resolves session → principal → scope guard per route
        ▼                                  │
   role-gated sections                     ▼
   (user / group-admin / bot-admin)   thin wrappers over existing stores
```

Key properties:

- **Two trust domains, one listener.** `/settings/*` uses per-user
  one-time-code sessions. `/debug` and `/admin` keep the operator
  `DEBUG_TOKEN` model. A leaked settings code must never grant operator
  scope, and `DEBUG_TOKEN` is never required to use `/settings`.
- **Server-side scope enforcement.** The SPA hides controls by role, but
  authority is enforced per request on the server by recomputing the
  principal's scope (mirroring `checkAuthorizationExtended`).
- **Validation reuse.** All write endpoints reuse the existing Zod
  schemas and `config-editor/validation.ts` rules; the SPA does not own
  validation truth.

## Scope by tier (summary; deepened in sub-specs)

**Regular user (own contexts only):**

- Profile / `timezone`
- Task-provider credentials (`kaneo_apikey`, `youtrack_token`) for own contexts
- Tools enable/disable (`tool_prefs`)
- MCP endpoints (form-based, replacing raw-JSON editing)
- Plugin enable/disable for own personal context
- Identity mapping (`set_my_identity` / `clear_my_identity` equivalents)
- Context switch between personal and each group they administer

**Group admin (managed groups + own):**

- Everything above, scoped to a selected managed group's _config context_
  (thread suffix stripped — see `getConfigContextIdFromStorageContextId`)
- Group member add/remove (`group_members`)
- Group task-instance selection / group-scoped config
- Per-context plugin enablement for managed groups

**Bot admin (everything):**

- All of `/admin` today: platform/task instances, admin roster, system
  LLM config, plugin approve/reject, authorized users & groups, announce
- Cross-context edits

## Cross-cutting concerns

- **Public reachability:** the link is only useful if the host is
  internet-reachable with TLS. Because hosting is on the existing debug
  server (D1), the deployment story (reverse proxy + TLS, and making the
  bind non-localhost for settings traffic) is an explicit open item; see
  the Access Model spec §"Exposure / TLS".
- **Per-instance identity:** codes and sessions bind to
  `(platformInstanceId, platformUserId)`; a code from one instance must
  not act in another.
- **TDD hooks:** every `src/`/`client/` change requires a passing test
  first (see `CLAUDE.md` → TDD Enforcement). Sub-spec implementation
  plans must be test-first.
- **No secret leakage:** sensitive config values stay masked in API
  responses, mirroring existing `maskConfig` / `maskSensitiveValue`
  behavior; CSP and logging rules from `src/debug/` carry over.

## Sub-spec index

This umbrella indexes three scoped sub-specs (consolidated from the
original six-document research output):

1. **This document** — overview, decisions, scope.
2. [`2026-05-28-settings-web-ui-access-model-design.md`](./2026-05-28-settings-web-ui-access-model-design.md)
   — **Access Model.** Part A: one-time code issuance, exchange,
   sessions, cookies, CSRF, rate limiting, trust isolation from
   `DEBUG_TOKEN`, exposure/TLS. Part B: principal resolution, scope
   guard, context switching, per-tier capability matrix.
3. [`2026-05-28-settings-web-ui-surface-design.md`](./2026-05-28-settings-web-ui-surface-design.md)
   — **Surface.** Part A: the `/settings/api/*` HTTP route surface and how
   each route maps onto existing stores. Part B: the `client/settings/`
   Svelte SPA structure, sections, and build-pipeline integration.
4. [`2026-05-28-settings-web-ui-command-retirement-design.md`](./2026-05-28-settings-web-ui-command-retirement-design.md)
   — **Command Retirement.** Hard removal of interaction
   routers/wizard/config-editor, command→launcher conversion, sequencing
   and parity gate.

> **Migration note:** these four documents supersede the original
> six-file set (`-overview-`, `-auth-session-`, `-permission-model-`,
> `-http-api-`, `-client-spa-`, `-command-retirement-`) that lived under
> `docs/`. Auth+session and permission+scope were merged into the Access
> Model spec; HTTP API and client SPA were merged into the Surface spec.

## Open questions (carried into sub-specs)

- OQ1 — **[RESOLVED 2026-05-28]** Exposure model: **reverse proxy** in
  front of the existing `127.0.0.1` bind; `/settings/*` public, operator
  paths restricted; new `SETTINGS_PUBLIC_BASE_URL` config. See Access
  Model spec §Exposure / TLS.
- OQ2 — **[RESOLVED 2026-05-28]** Session store: **SQLite-backed**
  (survives restart). See Access Model spec §Sessions.
- OQ3 — _(open)_ How `/setup`'s Kaneo auto-provisioning flow maps to a
  web form, including the credentials-return UX (Surface spec).
- OQ4 — _(open)_ Parity definition that gates hard removal (Command
  Retirement spec).

> **Also resolved this session** (sub-spec local IDs): OQ-A1 (SQLite
> sessions), OQ-A2 (synchronizer-token CSRF), OQ-A3 (reverse proxy),
> OQ-A4 (10 min code / 60 min sliding session) in the Access Model spec;
> OQ-H1 (thin `/settings/api/admin/*` wrappers) in the Surface spec.
> Still open: OQ-A5, OQ-P1, OQ-P2, OQ-H2, OQ-H3, OQ-C1, OQ-C2, OQ-R1,
> OQ-R2.

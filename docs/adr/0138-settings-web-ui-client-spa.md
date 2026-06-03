<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0138: Settings Web UI — Client SPA (Part B)

## Status

Implemented

## Date

2026-05-28 – 2026-06-02

## Context

papai's configuration surface was entirely chat-driven: `/set` for config
fields, `tgl:` callbacks for tool toggles, `plg:` for plugin enablement,
raw-JSON editing for MCP endpoints, and `/setup` wizard flows for identity
and task-provider provisioning. This forced users through multi-turn chat
conversations for what are fundamentally form-filling tasks. The bot admin
surface (`/admin` with `DEBUG_TOKEN`) was operator-only and inaccessible to
chat-authorized bot admins.

Part A (ADR-0137) delivered the `/settings/api/*` HTTP routes and the
access model (one-time code exchange, session cookie, CSRF, `requireScope`
gating). This decision covers the client SPA that consumes those routes,
replacing all chat-based config flows with a structured web UI.

The existing `client/admin/` SPA established the pattern: Svelte 5, Bun
IIFE bundle, hash navigation, scroll spy, shared UI primitives in
`client/shared/`. The new settings SPA must reuse that stack and add a
context switcher (personal vs managed-group) plus role-gated section
visibility.

## Decision Drivers

- **Chat is the wrong UX for forms**: Multi-turn wizard flows for
  config fields, tool toggles, and MCP endpoint editing cause friction
  and error recovery problems that a single-page form eliminates.
- **Trust domain separation**: The settings SPA must call
  session-authorized routes, never `DEBUG_TOKEN`-gated ones, even for
  admin capabilities (Access Model spec).
- **Build pipeline consistency**: A third bundle entry in the existing
  `BUNDLES` array avoids a separate build toolchain.
- **Static assets are public; data is session-gated**: The SPA shell,
  JS, and CSS must serve without `DEBUG_TOKEN`; the API routes behind
  them enforce authentication.
- **Reuse over duplication**: Shared primitives (`client/shared/ui/*`,
  `fetcher-helpers.ts`, `scrollspy.ts`) and the admin shell pattern
  reduce divergence and maintenance cost.
- **Context-aware gating**: Sections and data change based on whether
  the active context is personal or a managed group, and whether the
  user holds bot-admin or super-admin roles.

## Considered Options

### Option A: Extend the existing `client/admin/` SPA

Add settings sections to the admin UI behind the existing `DEBUG_TOKEN`
gate.

- **Pros**: No new bundle; single entry point for all operator surfaces.
- **Cons**: Breaks trust domain separation (settings cookie must never
  satisfy a `DEBUG_TOKEN` route); admin UI is operator-only, but
  settings must be accessible to any chat-authorized user.

### Option B: Separate settings SPA consuming `/settings/api/*` routes (chosen)

A dedicated `client/settings/` Svelte 5 SPA, Bun-bundled as a third IIFE,
authenticated via settings session (not `DEBUG_TOKEN`), with a context
switcher and role-gated sidebar.

- **Pros**: Clean trust domain separation; context switcher enables
  per-personal and per-group views; reuses shared UI primitives;
  session-gated data routes already validated in Part A.
- **Cons**: Third bundle to maintain; admin sections duplicated from
  `client/admin/` until future convergence.

### Option C: Server-rendered HTML pages

Generate settings pages server-side (e.g. EJS or similar), eliminating
the client bundle.

- **Pros**: No client build pipeline; simpler CSP.
- **Cons**: Breaks the existing SPA architecture pattern; loses reactive
  context switching; interactivity (tool toggles, MCP endpoint rows)
  requires partial-page reloads or client-side JS anyway.

## Decision

**Option B** with the following subsidiary decisions:

| Topic             | Decision                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundle            | Third entry in `scripts/build-client.ts` `BUNDLES` array: `client/settings/index.ts` → `public/settings.js` + `public/settings.css`. Isolation guard extended accordingly.         |
| Static serving    | `routeSettingsStatic()` in `src/debug/server.ts` serves `/settings`, `/settings.js`, `/settings.css` publicly (before `isSettingsPath` and `DEBUG_TOKEN` checks).                  |
| Session bootstrap | `?code=` query param → `POST /settings/auth/exchange`; no code → `GET /settings/api/bootstrap`. CSRF token held in-memory only, attached via `X-Settings-CSRF` header on writes.   |
| Context switcher  | Top-bar selector across personal + manageable group contexts. Changing context re-fetches the active section's data for the new `contextId`.                                       |
| Role gating       | Sidebar visibility driven by `principal.isBotAdmin` / `principal.isSuperAdmin` from bootstrap. Admin sections call `/settings/api/admin/*` routes, never `DEBUG_TOKEN` routes.     |
| Data layer        | `fetcher-schemas.ts` (Zod v4 schemas + inferred types) + `fetchers.ts` (CSRF-aware `settingsFetch` wrapper + typed per-route functions).                                           |
| Session store     | `session.svelte.ts`: `$state` reactive store with status (`loading`/`ready`/`unauthenticated`), 401 handler registration for session expiry.                                       |
| UI primitives     | All visual components from `client/shared/ui/*`; `ConfigFieldRow` shared across Profile and Task Provider sections; `scrollspy.ts` copied from admin pattern.                      |
| MCP form          | Structured row editor replacing raw-JSON editing; client-side validation for fast feedback, server-side `mcpEndpointConfigSchema` for authority.                                   |
| Tool toggles      | Domain-level on/off/partial status → expand to per-tool toggles with risk indicators (`read`/`write`/`destructive`/`open-world`).                                                  |
| Masked secrets    | Sensitive fields render masked placeholder with "replace" affordance; empty submit = no change.                                                                                    |
| Testing           | `tests/client/settings/` mirror of `client/settings/` under `bun test:client` (happy-dom). TDD hook-gated for all `.ts`/`.svelte` files under `client/`.                           |
| Admin sections    | Seven sections (Instances, System, Users, Groups, Admins, Plugins Approval, Announce). May lift markup from `client/admin/sections/*` but must call settings routes, not old ones. |
| HTML shell CSP    | `default-src 'self'` — no third-party scripts.                                                                                                                                     |

## Consequences

### Positive

- Replaces all chat-based config flows (`/set`, `tgl:`, `plg:`, `cfg:`,
  raw-JSON MCP editing, `/setup` wizard) with a single structured web UI.
- Trust domain separation is enforced: settings SPA never sends
  `DEBUG_TOKEN`; settings session cookie never satisfies operator routes.
- Context switcher gives group admins a scoped view of their managed
  groups without exposing bot-admin surfaces.
- Structured MCP endpoint form eliminates raw-JSON editing errors.
- Tool toggle surface mirrors the capability-gated computed set, not just
  the raw denylist, giving users an accurate view of what is available.
- Reuse of shared UI primitives and the admin shell pattern keeps the
  settings bundle maintainable and visually consistent.

### Negative

- Third bundle entry adds build-time cost and bundle-isolation guard
  maintenance.
- Admin sections are initially duplicated from `client/admin/` until a
  convergence pass (not in scope for this ADR).
- Session bootstrap adds a client-side code-exchange step before any UI
  renders; failures show only a "request a new link" message with no
  in-chat fallback.
- Context switcher re-fetches section data on every change, producing
  sequential API calls (no prefetch or parallel warm).

### Risks

- If the SPA shell is served publicly and a user bookmarks `/settings`
  without a session, the "request a new link" gate prevents data access
  but may confuse users who expect a login form.
- Admin section markup lifted from `client/admin/` may drift from its
  source if the admin UI evolves independently.
- The in-memory CSRF token is lost on page reload; the session cookie
  survives, but the CSRF must be re-acquired via bootstrap, adding one
  round-trip per reload.

## Implementation Notes

Key modules (`client/settings/`):

| File                 | Role                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `fetcher-schemas.ts` | Zod v4 schemas and inferred types for all `/settings/api/*` responses        |
| `fetchers.ts`        | CSRF-aware `settingsFetch`, 401 handler registry, typed per-route fetchers   |
| `session.svelte.ts`  | `$state` session store, bootstrap/exchange, context switch, expiry handling  |
| `SettingsApp.svelte` | Root shell: context switcher + sidebar + sections + scroll-spy gating        |
| `components/`        | `SettingsTopBar`, `SettingsSidebar`, `ConfigFieldRow` (shared re-usable row) |
| `sections/`          | Profile, TaskProvider, Tools, Mcp, Plugins, Identity, Members, GroupProvider |
| `sections/admin/`    | Instances, System, Users, Groups, Admins, PluginsApproval, Announce          |
| `index.ts`           | Mount entry: code extraction, bootstrap, history-replace, Svelte mount       |
| `scrollspy.ts`       | IntersectionObserver scroll-spy (mirrors admin pattern)                      |

Server wiring: `routeSettingsStatic()` in `src/debug/server.ts` inserted
before the `isSettingsPath` and `DEBUG_TOKEN` branches.

Build: third entry in `scripts/build-client.ts` `BUNDLES`;
`scripts/check-bundle-isolation.ts` extended for `public/settings.js`.

Spec: `docs/archive/2026-05-28-settings-web-ui-surface-design.md`.
Plan: `docs/archive/2026-05-29-settings-web-ui-client-spa.md`.

## Related Decisions

- ADR-0137: Settings Web UI — HTTP API & Access Model (Part A) — the
  `/settings/api/*` routes and session/CSRF machinery this SPA consumes.
- ADR-0123: Trusted-Local Plugin System — plugin eligibility and
  per-context enablement exposed via the Plugins section.
- ADR-0036: Centralized Scheduler Utility — the scheduler integration
  point referenced by plugin job contributions displayed in the Plugins
  section.

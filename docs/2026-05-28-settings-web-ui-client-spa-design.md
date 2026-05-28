<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Web UI — Client SPA Spec

**Date:** 2026-05-28
**Status:** Draft spec
**Parent:** [`2026-05-28-settings-web-ui-overview-design.md`](./2026-05-28-settings-web-ui-overview-design.md)

## Scope

The `client/settings/` single-page app: its place in the existing build
pipeline, structure, sections (gated by role + selected context), and the
session/CSRF bootstrap. Reuses the Svelte 5 + Bun-bundler stack already
used by `client/admin/` and `client/debug/`.

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
  — but note these are reachable only after auth bootstrap (sub-spec 2);
  the static assets themselves can be public, the **data** is not.
- `bun check:bundle-isolation` must continue to pass — the dev-only
  stories harness must not leak into the new bundle.

## Entry & session bootstrap

1. `/settings?code=XXXX` loads `settings.html` → `settings.js`.
2. On mount, the app reads `code` from the query string and calls
   `POST /settings/auth/exchange` (sub-spec 2). On success it discards the
   `code` from the URL (history replace) so it isn't bookmarked/leaked.
3. It then calls `GET /settings/api/bootstrap` to get role flags, the
   context switcher options, and the CSRF token, which it holds in
   memory (not localStorage) and sends on every write.
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

| Section | Backing routes (sub-spec 4) |
| --- | --- |
| Profile | `/settings/api/config` (timezone et al.) |
| Task provider | `/settings/api/config` (creds), `/settings/api/provision/kaneo` |
| Tools | `/settings/api/tools`, `/settings/api/tools/toggle` |
| MCP | `/settings/api/mcp` (structured form) |
| Plugins | `/settings/api/plugins`, `.../toggle`, `.../config` |
| Identity | `/settings/api/identity` |

### When selected context is a managed group (group admin / bot admin)

| Section | Backing routes |
| --- | --- |
| Members | `/settings/api/group/members` |
| Group provider | `/settings/api/group/task-instance` |

### When `isBotAdmin` (admin area)

| Section | Backing routes |
| --- | --- |
| Instances | `/settings/api/admin/*` (platform/task instances) |
| System (LLM) | `/settings/api/admin/*` (system config) |
| Users | `/settings/api/admin/*` (authorized users) |
| Groups | `/settings/api/admin/*` (authorized groups) |
| Admins | `/settings/api/admin/*` (roster; SA only) |
| Plugins (approval) | `/settings/api/admin/*` (approve/reject; SA only) |
| Announce | `/settings/api/admin/*` |

The admin sections can lift markup/logic from the existing
`client/admin/sections/*` components where the data shape matches, but
must call the new session-authorized routes (sub-spec 4 OQ-H1), not the
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

## Open questions

- OQ-C1 — Reuse vs fork of `client/admin/sections/*` for the admin area
  (shared component lib vs copy). Affects whether `/admin` and the
  settings admin area converge long-term.
- OQ-C2 — Whether the operator `/admin` UI is eventually folded into the
  settings admin area (single surface) or kept separate for
  `DEBUG_TOKEN`-only deployments. Out of scope for the first slice but
  shapes component sharing.

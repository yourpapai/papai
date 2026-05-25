<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard / Admin Split Design

**Date:** 2026-05-21  
**Status:** Implemented  
**Source notes:**

- [Detailed design note](../notes/dashboard-admin-split-design.md)
- [Implementation plan note](../notes/dashboard-admin-split-plan.md)

## Context

The current debug dashboard combines two separate responsibilities in one
`/dashboard` page: live engineering observability and operator/admin
backstage tasks. That mix makes the page noisy for both audiences, causes the
admin path to load live SSE machinery it does not need, and makes future admin
surfaces harder to organize.

The detailed design note is the source of truth for current-state analysis,
route allocation, shared client architecture, security constraints, and open
questions. The implementation plan note is the source of truth for sequencing
the split into reviewable phases.

## Goals

1. Split the existing dashboard into two purpose-built pages:
   - `/debug` for live engineering observability.
   - `/admin` for durable operator records and configuration.
2. Preserve the existing `DEBUG_TOKEN` authorization model and avoid any admin
   read/write security regression.
3. Keep `/dashboard` as a temporary redirect to `/debug` so existing bookmarks
   continue to work during the transition.
4. Extract a small shared client layer for common UI primitives, API types,
   fetch helpers, formatting helpers, and shared CSS.
5. Move each existing panel to the page that matches its audience, splitting
   mixed concerns such as context/wizard state from identity/authorized-group
   admin records.
6. Preserve existing route payload shapes while introducing the separate static
   bundles and route aliases needed by the new pages.

## Non-goals

- No multi-tenant auth or new authentication mechanism.
- No SPA router; v1 uses two static bundles and header links between pages.
- No broad design-system adoption beyond a small `client/shared/` extraction.
- No new admin mutations beyond the existing LLM credentials route.
- No charting or major stats redesign.

## Design summary

The split creates two client entrypoints and two static bundles:

- `/debug` serves `public/debug.{html,js,css}` and loads live SSE-driven
  observability state: sessions, traces, turns, notifications, tool failures,
  log explorer, and live wizard/config-editor context.
- `/admin` serves `public/admin.{html,js,css}` and loads REST-oriented operator
  data: LLM credentials, billing, anonymous stats, memos, reminders, identity
  mappings, and authorized groups.

Common UI and data helpers move under `client/shared/`, including the modal
primitive, panel shell, status dot, property/tree views, formatting helpers,
API types, fetcher helpers, and base CSS. The build script becomes a
multi-entrypoint builder so both bundles are produced consistently.

Server-side debug static handling changes from a single `/dashboard` bundle to
separate `/debug` and `/admin` static routes, with `/dashboard` redirecting to
`/debug` for compatibility.

## Implementation plan reference

Implementation should follow the phase plan rather than this summary. The plan
is intentionally bottom-up: extract shared primitives first, migrate the old
bundle to consume them, generalize the build, carve out `/debug`, add `/admin`,
move panels, add route aliases, then remove compatibility shims.

See [the implementation plan note](../notes/dashboard-admin-split-plan.md) for
phase dependencies, per-phase test expectations, verification commands, and
exit criteria.

## Testing approach

Use the implementation plan note as the authoritative test plan. At a high
level, coverage must include:

- shared client primitive behavior and fetch helper error handling;
- build script output for multiple bundles;
- `/debug`, `/admin`, and `/dashboard` redirect/static routes;
- debug app retaining only live observability panels;
- admin app rendering operator-only sections without opening the SSE feed;
- panel moves preserving existing data shapes and user-visible content;
- route alias and cleanup behavior during the compatibility window.

## References

- Detailed rules and rationale: [../notes/dashboard-admin-split-design.md](../notes/dashboard-admin-split-design.md)
- Work breakdown and sequencing: [../notes/dashboard-admin-split-plan.md](../notes/dashboard-admin-split-plan.md)

## Final note

Implemented on 2026-05-21. The shipped behavior now matches this design:
`/debug` serves the live observability UI, `/admin` serves the
operator/configuration UI, and `/dashboard` remains a compatibility
redirect to `/debug`.

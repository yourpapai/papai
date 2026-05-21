# Dashboard/Admin Split Design

**Date:** 2026-05-20
**Status:** Draft
**Source:** [`docs/design/dashboard-admin-split-design.md`](../../design/dashboard-admin-split-design.md)
**Companion plan:** [`docs/design/dashboard-admin-split-plan.md`](../../design/dashboard-admin-split-plan.md)

## Purpose

Split the current `/dashboard` experience into two focused surfaces:

- `/debug` for live engineering observability
- `/admin` for operator configuration and read-only admin records

The current single-page dashboard mixes both audiences, loads live SSE state
for users who may only need admin controls, and makes both workflows harder to
scan.

## Goals

1. Ship two distinct pages, `/debug` and `/admin`, each loading only the data
   and code it needs.
2. Preserve the current dark monospace visual identity and shared panel/model
   vocabulary without duplicating UI primitives.
3. Assign every existing dashboard panel to one destination and explicitly
   split the mixed-concern `ContextPanel`.
4. Upgrade the modal primitive so both pages can use inspection modals and
   future confirm dialogs.
5. Keep server routes and JSON shapes stable during the split.
6. Preserve the existing `DEBUG_TOKEN` security posture for admin reads and
   writes.
7. Document compact source-of-truth references for the data schemas behind each
   section.

## Non-goals

- No new admin mutation surfaces beyond the existing `/admin/llm` flow.
- No multi-tenant or role-based auth; one `DEBUG_TOKEN` remains the gate.
- No charting or design-system rewrite.
- No SPA router; use two static bundles and simple links/hash state.
- No API redesign; the split is a presentation and bundle-boundary change.

## Context

Today `client/debug/App.svelte`, `client/debug/dashboard.css`, and
`client/debug/dashboard.html` define one large `/dashboard` page built by
`scripts/build-client.ts`. That page combines SSE-driven debugging panels,
log exploration, billing, stats, credentials, memos, reminders, identity
mappings, and authorized groups. On the server side, `src/debug/server.ts`
already exposes a natural split between engineer-focused routes (`/events`,
`/logs`, `/turns/:id`) and operator-focused routes (`/billing/*`, `/stats/*`,
`/admin/llm`, `/auth/groups`, memo/reminder/identity lookups). The proposal is
therefore to split the client into two routes while keeping the existing backend
shapes intact.

Full verified-context grounding (layout, panel allocations, route list, schema
references) lives in
[`../notes/dashboard-admin-split-verified-context.md`](../notes/dashboard-admin-split-verified-context.md).

## Decisions

### D1. Split `/dashboard` into `/debug` and `/admin`

| URL          | Bundle                       | Audience | Data mode       | Notes                                |
| ------------ | ---------------------------- | -------- | --------------- | ------------------------------------ |
| `/debug`     | `public/debug.{html,js,css}` | engineer | SSE + REST      | live observability surface           |
| `/admin`     | `public/admin.{html,js,css}` | operator | REST only in v1 | config + records                     |
| `/dashboard` | redirect to `/debug`         | legacy   | —               | preserve bookmarks during transition |

`/admin` intentionally avoids SSE in v1 to reduce overhead for long-lived admin
sessions. Both pages remain behind the same top-level `DEBUG_TOKEN` gate.

### D2. Extract a small shared client layer

Create a shared layer for primitives and shared types instead of duplicating
code across two bundles.

Planned shared pieces:

- `client/shared/Modal.svelte`
- `client/shared/Confirm.svelte`
- `client/shared/StatusDot.svelte`
- `client/shared/PanelShell.svelte`
- `client/shared/PropertiesTable.svelte`
- `client/shared/TreeView.svelte`
- `client/shared/helpers.ts`
- `client/shared/api-types.ts`
- `client/shared/fetcher-helpers.ts`
- `client/shared/base.css`

`client/debug/` becomes observability-only. `client/admin/` becomes the new
admin bundle with section-focused views.

### D3. Reallocate current panels by audience

| Current area                                                                       | Destination | Notes                                      |
| ---------------------------------------------------------------------------------- | ----------- | ------------------------------------------ |
| Header, context chips, sessions, traces, turns, notifications, tool failures, logs | `/debug`    | stay live and SSE-driven                   |
| ContextPanel live wizard/editor state                                              | `/debug`    | extracted into a smaller live context card |
| ContextPanel identity mappings and authorized groups                               | `/admin`    | split into dedicated read-only sections    |
| Memos, reminders, billing, stats, credentials                                      | `/admin`    | moved off the engineer screen              |
| Subject stats modal content                                                        | `/admin`    | stays paired with billing detail           |

This preserves every existing panel but stops the engineer surface from carrying
operator-only inventory and configuration views.

### D4. Keep `/debug` focused on live observability

`/debug` keeps the current debugging identity but drops admin-heavy panels.
Layout intent:

- top header and context chips
- left sidebar for sessions and traces
- right-side grid for turns, notifications, tool failures, and live context
- large bottom log explorer

The page should feel roomier than the current three-column grid and reserve most
of its attention for active turn inspection and failures.

### D5. Make `/admin` a section-based operator surface

`/admin` uses a left navigation rail with one visible section at a time. Initial
sections:

- System
- Billing
- Stats
- Memos
- Reminders
- Identities
- Groups

Operational details preserved from the source design:

- `System` hosts the existing LLM credentials form and basic system metadata.
- `Billing` includes a window selector, subject list, and subject detail modal.
- `Stats` remains read-only and aggregate-oriented.
- `Memos`, `Reminders`, `Identities`, and `Groups` are read-only lookup surfaces.
- Hash-based deep links (for example `#billing`) preserve refresh/share state
  without introducing a router library.

### D6. Upgrade the modal primitive into a shared pattern

Promote `Modal.svelte` to a shared primitive with:

- `size?: 'sm' | 'md' | 'lg' | 'xl'`
- optional `footer` snippet
- existing click-outside close behavior
- added Escape-key handling

Two usage modes are explicitly supported:

- inspection modal for read-only detail views
- confirm dialog for future destructive admin actions

### D7. Keep one shared visual identity

Both pages share a common base theme extracted from the current dashboard CSS:

- dark background
- monospace font stack
- green success/accent and red error tokens
- shared `.panel`, badge, placeholder, and status classes

Each page then adds only its own layout CSS:

- `/debug`: observability grid and log explorer styles
- `/admin`: nav rail and section-container styles

### D8. Keep backend shapes and route ownership stable

The split does not redesign the server contract. `src/debug/server.ts` remains
responsible for route registration and keeps the existing route families intact:

- engineer: `/events`, `/logs`, `/logs/stats`, `/turns/:id`
- operator: `/billing/*`, `/stats/*`, `/admin/llm`, `/auth/groups`, and the
  existing memo/reminder/identity lookup routes

The only route-level change is adding `/debug` and `/admin` static entrypoints
and redirecting `/dashboard` to `/debug`.

## Source-of-truth schema references

### `/debug`

| File                              | Responsibility                                                     |
| --------------------------------- | ------------------------------------------------------------------ |
| `src/debug/schemas.ts`            | SSE event and debug payload schemas                                |
| `src/debug/turn-assembly.ts`      | turn, notification, and tool-failure shapes                        |
| `src/debug/state-collector.ts`    | periodic snapshot payloads                                         |
| `src/debug/log-buffer.ts`         | log entry and log-query shapes                                     |
| `client/debug/dashboard-types.ts` | current reactive client state bag, planned to move to shared types |

### `/admin`

| File                                          | Responsibility                                        |
| --------------------------------------------- | ----------------------------------------------------- |
| `src/debug/billing.ts`                        | billing windows and summary/detail models             |
| `src/debug/billing-routes.ts`                 | billing and admin-LLM response envelopes              |
| `src/debug/admin-llm.ts`                      | admin LLM credential request/response schemas         |
| `src/usage/types.ts`                          | request, subject-summary, and usage row types         |
| `src/stats/types.ts`                          | global and per-subject stats models                   |
| `src/system-config.ts`                        | system config keys and masking helpers                |
| `src/memos.ts`                                | memo model and archive filter                         |
| `src/types/recurring.ts` / `src/recurring.ts` | recurring task shapes and list entrypoints            |
| `src/deferred-prompts/scheduled.ts`           | deferred prompt shape                                 |
| `src/identity/mapping.ts`                     | identity mapping lookup shape                         |
| `src/authorized-groups.ts`                    | authorized group row shape                            |
| `client/debug/billing/fetchers.ts`            | current client-side billing/admin response validators |
| `client/debug/stats/fetchers.ts`              | current client-side stats response validators         |

### Shared

| File                         | Responsibility                                            |
| ---------------------------- | --------------------------------------------------------- |
| `src/debug/event-bus.ts`     | event names and debug emission surface                    |
| `src/auth.ts`                | storage-context scoping behavior relevant to subject keys |
| `client/shared/api-types.ts` | planned shared client-facing type home after the split    |

## Risks

- **Build complexity.** `scripts/build-client.ts` must produce two bundles
  cleanly without breaking CSS extraction.
- **CSS leakage.** Shared classes must move into a true shared base layer or one
  page will render partially unstyled.
- **Test fragility.** Existing tests that assert `/dashboard` HTML need to flip
  to `/debug` plus redirect coverage.
- **Security regression.** Adding new static routes must not weaken the single
  top-level `isAuthorizedRequest()` gate.

## Open questions

1. How long should `/dashboard` keep redirecting before removal?
2. Should `/admin` ever gain a filtered SSE stream for lightweight live updates?
3. If `/debug` and `/admin` eventually need separate access scopes, how should
   the token model evolve without rewriting route authorization?
4. How should client tests be split between `tests/client/debug/`,
   `tests/client/admin/`, and `tests/client/shared/` during the move?

## Out of scope

- charts and time-series visualizations
- admin action audit UI
- multi-operator RBAC
- i18n
- theme switching
- mobile-first layout

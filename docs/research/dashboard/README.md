<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard / Admin UI — Backend Data Surface

This folder catalogs every data structure the current `/dashboard` UI loads
from the server. It exists to support the in-progress
[dashboard / admin split](../../superpowers/specs/2026-05-21-dashboard-admin-split-design.md)
and the upcoming UI redesign.

The current `/dashboard` page consumes data from two channels:

1. **REST endpoints** served by `src/debug/server.ts` (one-shot fetches).
2. **SSE stream** at `/events` produced by `src/debug/state-collector.ts`
   (live in-memory state + event broadcast).

All endpoints are gated by `DEBUG_TOKEN` (when set) via a `Bearer` header.
The `POST /admin/llm` mutation additionally requires `DEBUG_TOKEN` to be
set in env (returns `401` otherwise).

## Files in this folder

| File                          | Scope                                                                 |
| ----------------------------- | --------------------------------------------------------------------- |
| `01-rest-endpoints.md`        | All REST routes, query params, response shapes.                       |
| `02-sse-events.md`            | SSE channel envelope + every event type + payload shape.              |
| `03-domain-types.md`          | Domain TS types and Zod schemas behind the routes.                    |
| `04-billing-and-admin-llm.md` | Billing aggregates, request rows, LLM credentials snapshot.           |
| `05-stats.md`                 | Anonymous global + per-subject stats payloads.                        |
| `06-dashboard-state.md`       | Client-side `DashboardState` aggregate (what the UI keeps in memory). |
| `07-endpoint-to-panel-map.md` | Which payload feeds which UI panel today.                             |

## Sources of truth (do not duplicate, link)

- Server schemas: `src/debug/schemas.ts`, `src/debug/turn-assembly.ts`,
  `src/debug/llm-trace-collector.ts`, `src/debug/billing.ts`,
  `src/debug/admin-llm.ts`, `src/stats/types.ts`, `src/usage/types.ts`.
- Domain types referenced by the UI: `src/types/recurring.ts`,
  `src/deferred-prompts/types.ts`, `src/memos.ts`,
  `src/identity/types.ts`, `src/system-config.ts`.
- Client mirrors: `client/debug/dashboard-types.ts`,
  `client/debug/billing/fetchers.ts`, `client/debug/stats/fetchers.ts`,
  `client/debug/handlers.ts`, `client/debug/handlers-extras.ts`,
  `client/debug/sse.ts`.

## Anonymity contract

`/stats/global` and `/stats/subject/:id` are constrained to anonymous,
aggregate-shaped data only (no message text, memo bodies, observation text,
attachment filenames, raw URLs/paths, usernames, workspace names, tags,
project names, status names, RRULE text, or any other free-form content).
High-cardinality identifiers are hashed using the
`stats_anonymity_salt` row in `system_config`. See the project root
`CLAUDE.md` for the full contract.

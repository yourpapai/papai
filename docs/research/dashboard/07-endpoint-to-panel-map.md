<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Which data flows into which UI panel

Panels live in `client/debug/components/`, `client/debug/billing/`, and
`client/debug/stats/`. Below is the source-of-data map for each.
Panel ownership informs which side of the `/debug` vs `/admin` split it
belongs in (see
[`2026-05-21-dashboard-admin-split-design.md`](../../superpowers/specs/2026-05-21-dashboard-admin-split-design.md)).

| Panel file                                                                      | Data sources                                                                          | Belongs to          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------- |
| `Header.svelte`                                                                 | `state.connected`, `state.stats`                                                      | both (shared shell) |
| `ContextChips.svelte` / `ContextPanel.svelte`                                   | `sessions`, `wizards`, `scheduler`, `pollers`, `messageCache`, `activeConfigEditors`  | `/debug`            |
| `SessionsList.svelte` / `SessionCard.svelte` / `SessionDetail.svelte`           | `sessions`                                                                            | `/debug`            |
| `TraceList.svelte` / `TraceDetail.svelte`                                       | `llmTraces` (SSE `llm:full`)                                                          | `/debug`            |
| `TurnsPanel.svelte` / `TurnDetail.svelte`                                       | `turns`, `GET /turns/:id`                                                             | `/debug`            |
| `NotificationsPanel.svelte`                                                     | `notifications`                                                                       | `/debug`            |
| `ToolFailuresPanel.svelte` / `FailureDetail.svelte`                             | `toolFailures`                                                                        | `/debug`            |
| `LogExplorer.svelte` / `LogDetail.svelte`                                       | `GET /logs`, `GET /logs/stats`, SSE `log:entry`, `state.logScopes`, `activeLogFilter` | `/debug`            |
| `RemindersPanel.svelte`                                                         | `recurringTasks`, `deferredPrompts` (via `/recurring`, `/deferred` + SSE)             | `/admin`            |
| `MemosPanel.svelte`                                                             | `memos` (via `/memos` + SSE)                                                          | `/admin`            |
| `PropertiesTable.svelte` / `TreeView.svelte` / `Modal.svelte`                   | generic; used by both                                                                 | shared primitives   |
| Identity mappings (rendered inline today)                                       | `identityMappings` (via `/identity` + SSE)                                            | `/admin`            |
| Authorized groups (rendered inline today)                                       | `authorizedGroups` (via `/auth/groups` + SSE)                                         | `/admin`            |
| `billing/BillingPanel.svelte` + `SubjectsTable.svelte` + `SubjectDetail.svelte` | `/billing/subjects`, `/billing/subject/:id`                                           | `/admin`            |
| `billing/CredentialsForm.svelte`                                                | `GET /admin/llm`, `POST /admin/llm`                                                   | `/admin`            |
| `stats/StatsPanel.svelte`                                                       | `/stats/global`                                                                       | `/admin`            |
| `stats/SubjectStatsPanel.svelte`                                                | `/stats/subject/:id`                                                                  | `/admin`            |

## Per-page split summary

### `/debug` page consumes

- SSE channel `GET /events` (the entire SSE surface — see
  [02-sse-events.md](./02-sse-events.md)).
- `GET /logs`, `GET /logs/stats`.
- `GET /turns/:turnId`.

### `/admin` page consumes

- `GET /recurring`, `GET /deferred`, `GET /memos`, `GET /identity`,
  `GET /auth/groups`.
- `GET /billing/subjects`, `GET /billing/subject/:id`.
- `GET /admin/llm`, `POST /admin/llm`.
- `GET /stats/global`, `GET /stats/subject/:id`.

The admin page does **not** need the SSE feed.
The debug page does **not** need any billing, stats, or admin-llm calls.
A few entities (`memos`, `recurringTasks`, `deferredPrompts`,
`identityMappings`, `authorizedGroups`) currently receive SSE patches in
the merged dashboard but will switch to pure REST + manual refresh after
the split (see design note).

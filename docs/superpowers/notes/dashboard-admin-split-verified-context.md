# Dashboard / Admin Split — Verified Context

**Source:** [`../../design/dashboard-admin-split-design.md`](../../design/dashboard-admin-split-design.md)
**Last updated in source:** 2026-05-20

## 2. Verified context — current state

This section was grounded in the following code, as of the date above.

### 2.1 Current bundle

- Entry: `client/debug/index.ts` mounts `App.svelte` into `#app`.
- `client/debug/App.svelte` composes **11 panels** + **6 modals** in one
  view; full file at the path.
- Build: `scripts/build-client.ts` emits `public/dashboard.{html,js,css}`
  with `naming: 'dashboard.js'` and inlines component-scoped CSS into
  one stylesheet.
- HTML template: `client/debug/dashboard.html`. Single `#app` mount, CSP
  `default-src 'self'`.

### 2.2 Current layout (from `client/debug/dashboard.css`)

```text
+---------------------------------------------------------------+
| Header  (connection · uptime · msgs/llm/tools · infra row)    |
+---------------------------------------------------------------+
| ContextChips  (all · dm · group:<id> · …)                     |
+----------------+----------------------------------------------+
|                |   panel-grid (3 cols, equal rows)            |
|  Sessions      |  +-----------+-----------+-----------+       |
|  List          |  | Turns     | Notifs    | Failures  |       |
|  ----          |  +-----------+-----------+-----------+       |
|  Trace         |  | Reminders | Memos     | Context   |       |
|  List          |  +-----------+-----------+-----------+       |
|                |  | Billing               | Stats     |       |
|                |  +-----------------------+-----------+       |
| (300 px)       +----------------------------------------------+
|                |   LogExplorer   (full-width, bottom row)     |
+----------------+----------------------------------------------+
```

CSS grid: `grid-template-columns: 300px 1fr`, `grid-template-rows: 1fr 1fr`,
with `panels` and `logs` rows on the right side and `sidebar` spanning both
rows on the left.

### 2.3 Modal pattern

Single primitive at `client/debug/components/Modal.svelte`: viewport-cover
backdrop, click-outside closes, `aria-label="Close"` X button, no size
variants, no footer slot. Six callers — SessionDetail, TraceDetail,
LogDetail, TurnDetail, FailureDetail, Billing subject (which also embeds
`SubjectStatsPanel` inside).

### 2.4 Concern allocation today

| Panel / area                | Lives in                                                           | Audience | Live data?       |
| --------------------------- | ------------------------------------------------------------------ | -------- | ---------------- |
| Header counters / infra     | `components/Header.svelte`                                         | engineer | yes (SSE)        |
| Context chips               | `components/ContextChips.svelte`                                   | engineer | derived          |
| Sessions list               | `components/SessionsList.svelte` + `SessionCard` + `SessionDetail` | engineer | yes (SSE)        |
| LLM trace list              | `components/TraceList.svelte` + `TraceDetail`                      | engineer | yes (SSE)        |
| Turns panel                 | `components/TurnsPanel.svelte` + `TurnDetail`                      | engineer | yes (SSE)        |
| Notifications               | `components/NotificationsPanel.svelte`                             | engineer | yes (SSE)        |
| Tool failures               | `components/ToolFailuresPanel.svelte` + `FailureDetail`            | engineer | yes (SSE)        |
| Log explorer                | `components/LogExplorer.svelte` + `LogDetail`                      | engineer | yes (SSE + REST) |
| Context: wizards / editors  | `components/ContextPanel.svelte` (mixed)                           | engineer | yes (SSE)        |
| Context: identity mappings  | `components/ContextPanel.svelte` (mixed)                           | operator | yes (SSE)        |
| Context: authorized groups  | `components/ContextPanel.svelte` (mixed)                           | operator | yes (SSE)        |
| Memos                       | `components/MemosPanel.svelte`                                     | operator | yes (SSE)        |
| Reminders (recurring + def) | `components/RemindersPanel.svelte`                                 | operator | yes (SSE)        |
| Billing                     | `billing/BillingPanel.svelte` + `SubjectsTable` + `SubjectDetail`  | operator | no (REST poll)   |
| LLM credentials form        | `billing/CredentialsForm.svelte` (only **write** surface today)    | operator | no (REST)        |
| Stats global                | `stats/StatsPanel.svelte`                                          | operator | no (REST)        |
| Stats per-subject           | `stats/SubjectStatsPanel.svelte` (rendered inside billing modal)   | operator | no (REST)        |

### 2.5 Server routes (`src/debug/server.ts`)

Static:

- `GET /dashboard`, `/dashboard.js`, `/dashboard.css` — static bundle from
  `public/`.

Engineer-side APIs (debug observability):

- `GET /events` — SSE stream of state/log/turn/notification/failure events.
- `GET /logs`, `GET /logs/stats` — log buffer search.
- `GET /turns/:id` — assembled turn lookup.

Operator-side APIs (admin data):

- `GET /recurring?userId=`, `GET /deferred?userId=`, `GET /memos?userId=`,
  `GET /identity?userId=&provider=` — per-user lookups (currently not
  surfaced in the UI; the UI uses SSE feeds instead).
- `GET /auth/groups` — authorized group list.
- `GET /billing/subjects`, `GET /billing/subject/:id` — billing aggregates.
- `GET /stats/global`, `GET /stats/subject/:id` — anonymous stats.
- `GET /admin/llm`, `POST /admin/llm` — system LLM credentials.
  The `POST` route requires `DEBUG_TOKEN` even if other routes are open;
  the `GET` is subject to the same single `DEBUG_TOKEN` gate as all routes.

All routes share one `isAuthorizedRequest()` check at the top of
`routeRequest`: if `DEBUG_TOKEN` is set, every request needs the bearer
token; otherwise all routes are open (loopback-only by hostname default).

## 4.3 Allocation of every current panel

| Current panel                 | Destination      | Component path                                           |
| ----------------------------- | ---------------- | -------------------------------------------------------- |
| Header                        | `/debug`         | `client/debug/components/Header.svelte`                  |
| ContextChips                  | `/debug`         | `client/debug/components/ContextChips.svelte`            |
| SessionsList + Card + Detail  | `/debug`         | `client/debug/components/Sessions*.svelte`               |
| TraceList + TraceDetail       | `/debug`         | `client/debug/components/Trace*.svelte`                  |
| TurnsPanel + TurnDetail       | `/debug`         | `client/debug/components/Turn*.svelte`                   |
| NotificationsPanel            | `/debug`         | `client/debug/components/NotificationsPanel.svelte`      |
| ToolFailuresPanel + Detail    | `/debug`         | `client/debug/components/Tool*.svelte` + `FailureDetail` |
| LogExplorer + LogDetail       | `/debug`         | `client/debug/components/Log*.svelte`                    |
| ContextPanel → wizards block  | `/debug` (split) | `client/debug/components/LiveContextCard.svelte` (new)   |
| ContextPanel → identity       | `/admin` (split) | `client/admin/sections/IdentitiesSection.svelte`         |
| ContextPanel → auth groups    | `/admin` (split) | `client/admin/sections/GroupsSection.svelte`             |
| MemosPanel                    | `/admin`         | `client/admin/sections/MemosSection.svelte`              |
| RemindersPanel                | `/admin`         | `client/admin/sections/RemindersSection.svelte`          |
| BillingPanel                  | `/admin`         | `client/admin/sections/BillingSection.svelte`            |
| CredentialsForm               | `/admin`         | `client/admin/components/CredentialsForm.svelte`         |
| SubjectsTable / SubjectDetail | `/admin`         | `client/admin/components/Subject*.svelte`                |
| StatsPanel                    | `/admin`         | `client/admin/sections/StatsSection.svelte`              |
| SubjectStatsPanel             | `/admin`         | `client/admin/components/SubjectStatsPanel.svelte`       |

## 5. Data schemas — source-of-truth files

These are the files a future UI generator should read first when
deciding shape / fields for any view. Every type listed is exported.

### 5.1 `/debug` page schemas

| File                                      | What it defines                                                                                                                                                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/debug/schemas.ts`                    | Every SSE event Zod schema: `Session`, `Wizard`, `LlmTrace`, `LogEntry`, `StateInitEvent`, `StateStatsEvent`, `CacheEvent`, `UserIdEvent`, `SchedulerTickEvent`, `PollerEvent`, `MessageCacheEvent`, plus token / step / tool-call detail sub-types. |
| `src/debug/turn-assembly.ts`              | `Turn`, `Notification`, `ToolFailure` (re-exported from `schemas.ts`).                                                                                                                                                                               |
| `src/debug/state-collector.ts`            | Shape of the periodic state snapshot dispatched as `state:init` / `state:stats`.                                                                                                                                                                     |
| `src/debug/state-collector-utils.ts`      | Session-summary projection used by the collector.                                                                                                                                                                                                    |
| `src/debug/llm-trace-collector.ts`        | LLM trace ring buffer shape.                                                                                                                                                                                                                         |
| `src/debug/log-buffer.ts`                 | Log entry shape and search params (`level`, `scope`, `turnId`, `q`, `limit`).                                                                                                                                                                        |
| `client/debug/dashboard-types.ts` (today) | Client-side `DashboardState` interface — the canonical reactive shape; will move to `client/shared/api-types.ts`.                                                                                                                                    |

### 5.2 `/admin` page schemas

| File                                       | What it defines                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/debug/billing.ts`                     | `BillingWindow`, `BillingSubject`, `BillingDetail`, `BILLING_DETAIL_LIMIT`.                                                                                                                                                                                                                      |
| `src/debug/billing-routes.ts`              | Response envelopes: `{ window, subjects }`, `{ window, subject, requests, truncated }`, admin-llm responses.                                                                                                                                                                                     |
| `src/debug/admin-llm.ts`                   | `AdminLlmKeyState`, `AdminLlmSnapshot`, `AdminLlmError`, request body schema for `POST /admin/llm`.                                                                                                                                                                                              |
| `src/usage/types.ts`                       | `ModelRole`, `ContextType`, `SubjectRoleTotals`, `SubjectSummary`, `RequestRow`, `ToolCallRow`, `ToolCallSubjectSummary`.                                                                                                                                                                        |
| `src/usage/query.ts`                       | Functions consumed by billing (subject lists + tool aggregates).                                                                                                                                                                                                                                 |
| `src/stats/types.ts`                       | `StatsWindow`, all `*Stats` sub-types, `GlobalStats`, `SubjectStats`, `Percentiles`.                                                                                                                                                                                                             |
| `src/stats/index.ts`                       | `getGlobalStats({ window })`, `getSubjectStats(id)` — entrypoints feeding the admin Stats section.                                                                                                                                                                                               |
| `src/system-config.ts`                     | `SystemConfigKey`, `SYSTEM_CONFIG_KEYS`, `SystemConfigEntry`, `maskSystemConfigValue`, `listSystemConfigEntries`.                                                                                                                                                                                |
| `src/memos.ts`                             | `Memo` interface, `ArchiveFilter`. `listMemos(userId, limit, state)` is the route handler input.                                                                                                                                                                                                 |
| `src/types/recurring.ts`                   | `TriggerType`, `RecurringTaskInput`, `RecurringTaskRecord`.                                                                                                                                                                                                                                      |
| `src/recurring.ts`                         | Re-exports + `listRecurringTasks(userId)`.                                                                                                                                                                                                                                                       |
| `src/deferred-prompts/scheduled.ts`        | `ScheduledPrompt` shape; `listScheduledPrompts(userId, status?)`.                                                                                                                                                                                                                                |
| `src/identity/mapping.ts`                  | `SetIdentityMappingParams`, `IdentityMappingDeps`, return shape of `getIdentityMapping`.                                                                                                                                                                                                         |
| `src/authorized-groups.ts`                 | `listAuthorizedGroups(): Array<{ group_id, added_by, added_at }>` — the literal admin row.                                                                                                                                                                                                       |
| `client/debug/billing/fetchers.ts` (today) | Runtime Zod schemas validating each `/billing/*` and `/admin/llm` response — the client-side schema source.                                                                                                                                                                                      |
| `client/debug/stats/fetchers.ts` (today)   | Runtime Zod schemas validating each `/stats/*` response.                                                                                                                                                                                                                                         |
| `client/debug/dashboard-types.ts` (today)  | Admin-side type bag: `BillingSubject`, `BillingDetail`, `BillingWindow`, `BillingRequestRow`, `BillingRoleTotals`, `AdminLlmSnapshot`, `AdminLlmKeyState`, `Memo`, `RecurringTask`, `DeferredPrompt`, `IdentityMappingEntry`, `AuthorizedGroupEntry`. Will move to `client/shared/api-types.ts`. |

### 5.3 Shared (used by both pages)

| File                         | What it defines                                                                |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `src/debug/event-bus.ts`     | Event names emitted to subscribers — defines what `/events` can emit.          |
| `src/debug/turn-assembly.ts` | Already listed; both pages may reference the turn-id shape (admin not yet).    |
| `src/auth.ts`                | `getThreadScopedStorageContextId` — explains why some billing rows are scoped. |

### 5.4 Why this list matters

A UI generator hitting "build me the X section" only needs:

1. the matching server file (defines the data),
2. the matching fetcher file (defines the wire shape),
3. the matching dashboard-types entry (defines the local reactive shape).

Keeping these three in lockstep (and using Zod at the boundary, as
`fetchers.ts` already does) is what lets us regenerate any section
without scanning the whole codebase.

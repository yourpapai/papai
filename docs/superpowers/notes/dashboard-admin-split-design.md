<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard / Admin Split — Design Spec

Status: approved
Owner: admin (`ADMIN_USER_ID`)
Last updated: 2026-05-20
Branch: `claude/split-dashboard-admin-zaoys`

Companion implementation plan: [`dashboard-admin-split-plan.md`](./dashboard-admin-split-plan.md).

## 1. Purpose

The single `/dashboard` page in `client/debug/` mixes two distinct audiences and
intents into one screen:

- a **live observability surface** for the engineer running the bot —
  connection status, log stream, turn timeline, LLM traces, tool failures,
  in-memory sessions, live wizard state;
- an **admin backstage surface** for the operator — system-wide LLM
  credentials, billing per subject, anonymous stats, memos / reminders
  inventory, identity mappings, authorized groups.

Cramming both into a 3-column panel grid forces compromises everywhere: the
engineer sees billing data they don't care about; the operator has to scan
through a live log river to find a credentials form. Visiting the page also
loads SSE state collectors and live event handlers when the operator only
wanted to rotate an API key.

This spec splits the page into two purpose-built routes:

- `/debug` — engineer surface; live, ephemeral, SSE-driven.
- `/admin` — operator surface; durable, configuration-and-records oriented.

Both keep the existing `DEBUG_TOKEN` auth surface. `/dashboard` is preserved
as a 301 redirect to `/debug` so external bookmarks don't break during the
transition window.

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

## 3. Goals and non-goals

### 3.1 Goals

1. Two distinct pages — `/debug` (engineer) and `/admin` (operator) — each
   loading only the code and data feeds it needs.
2. Shared visual identity (dark monospace theme, status dot, count badges,
   `.panel` shell) without duplicating CSS or types.
3. Clear, written allocation of every existing panel to one of the two
   pages, and an explicit plan for the panels that mix concerns
   (`ContextPanel`).
4. A modal primitive flexible enough for the two patterns we now have plus
   the two we'll need next — inspection modal and confirm dialog.
5. A documented list of files where data schemas live, so future UI
   generation (LLM-assisted or otherwise) can find the source of truth
   for every view.
6. Preserve every existing route, test, and JSON shape; no API breakage
   in this split.
7. Admin write surface stays gated by `DEBUG_TOKEN`. Admin **read** surfaces
   that today are open under the unified `DEBUG_TOKEN` gate stay gated the
   same way — no security regression.

### 3.2 Non-goals

- No new admin write operations beyond what `/admin/llm` already does.
  Identity mappings, authorized groups, memos and reminders stay read-only
  in `/admin` v1; mutations stay in chat / `/setup` / `/config`.
- No multi-tenant auth (still one `DEBUG_TOKEN`, one admin).
- No new charts. Stats stays as the existing `<dl>` lists; charts come
  later.
- No SPA routing library. Two static bundles, two HTML files, two
  entrypoints. The /admin page does not need to navigate to /debug at
  runtime (a header link is sufficient).
- No design-system refactor; we extract a tiny shared layer
  (`client/shared/`) rather than adopting a UI kit.

## 4. Target architecture

### 4.1 URLs and bundles

| URL          | Bundle                       | Audience | Loads SSE? | Notes                                                        |
| ------------ | ---------------------------- | -------- | ---------- | ------------------------------------------------------------ |
| `/debug`     | `public/debug.{html,js,css}` | engineer | yes        | live observability surface                                   |
| `/admin`     | `public/admin.{html,js,css}` | operator | no\*       | configuration + records; REST only on load                   |
| `/dashboard` | _redirect_ → `/debug`        | —        | —          | 301 with `Location: /debug` for one minor cycle, then remove |

\* `/admin` may open a **filtered** SSE later (e.g. `identity:set` events
only) but v1 polls on user action. Keeping it REST-only reduces blast
radius if someone leaves the tab open overnight.

### 4.2 Filesystem layout

```text
client/
  shared/                       # new — used by both bundles
    Modal.svelte                # primitive, gains size + footer
    Confirm.svelte              # thin wrapper around Modal (action dialog)
    StatusDot.svelte            # green dot / red dot
    PanelShell.svelte           # .panel + h2 + count badge
    PropertiesTable.svelte      # moved from components/
    TreeView.svelte             # moved from components/
    helpers.ts                  # formatTime, formatUptime, levelClass, levelName
    api-types.ts                # what's now dashboard-types.ts, decoupled
    fetcher-helpers.ts          # readBody / requireOk / errorMessageFrom

  debug/                        # rewritten; SSE-driven only
    debug.html                  # was dashboard.html
    index.ts                    # mounts DebugApp
    DebugApp.svelte             # composes Sessions / Traces / Turns / Notifications / Failures / Logs
    dashboard.svelte.ts         # renamed to debug.svelte.ts
    components/
      Header.svelte
      ContextChips.svelte
      SessionsList.svelte
      SessionCard.svelte
      SessionDetail.svelte
      TraceList.svelte
      TraceDetail.svelte
      TurnsPanel.svelte
      TurnDetail.svelte
      NotificationsPanel.svelte
      ToolFailuresPanel.svelte
      FailureDetail.svelte
      LogExplorer.svelte
      LogDetail.svelte
      LiveContextCard.svelte    # wizards + active config editors only
    handlers.ts                 # unchanged
    handlers-extras.ts          # trimmed: keep wizard/config-editor; drop identity / auth / memo / recurring / deferred
    handlers-helpers.ts
    sse.ts
    log-bootstrap.ts
    log-filter.ts
    debug.css                   # debug-only styles

  admin/                        # new bundle
    admin.html                  # `<div id="app"></div>` + admin.js + admin.css
    index.ts                    # mounts AdminApp
    admin.svelte.ts             # admin-side reactive state
    AdminApp.svelte             # left nav + section content area
    sections/
      SystemSection.svelte      # CredentialsForm + system info
      BillingSection.svelte     # window selector + SubjectsTable + SubjectDetail modal
      StatsSection.svelte       # window selector + StatsPanel
      MemosSection.svelte       # memos browser by userId
      RemindersSection.svelte   # recurring + deferred browser by userId
      IdentitiesSection.svelte  # identity mapping browser
      GroupsSection.svelte      # authorized groups list
    components/
      NavSidebar.svelte
      CredentialsForm.svelte    # moved from billing/, lives here now
      SubjectsTable.svelte
      SubjectDetail.svelte
      SubjectStatsPanel.svelte
      WindowSelect.svelte       # 24h/7d/30d/all and 1d/7d/30d/all
    fetchers.ts                 # merges billing/fetchers.ts + stats/fetchers.ts +
                                # new admin-data fetchers
    admin.css                   # admin-only styles

src/debug/
  server.ts                     # routes /debug, /admin, /dashboard→/debug, plus existing APIs
                                # no other change to routeRequest
```

### 4.3 Allocation of every current panel

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

### 4.4 `/debug` page layout

```text
+----------------------------------------------------------------------+
| Header  (connection · uptime · msgs/llm/tools · scheduler · pollers) |
+----------------------------------------------------------------------+
| ContextChips                                                          |
+--------------------+--------------------------------------------------+
|                    |   panel-grid (2 cols)                            |
|  SessionsList      |  +-------------------+----------------------+    |
|  ----              |  | TurnsPanel        | NotificationsPanel   |    |
|  TraceList         |  +-------------------+----------------------+    |
|                    |  | ToolFailuresPanel | LiveContextCard      |    |
|  (300 px)          |  +-------------------+----------------------+    |
|                    +--------------------------------------------------+
|                    |   LogExplorer   (full-width, ≥ 40 % of height)   |
+--------------------+--------------------------------------------------+
```

Differences from today: from three columns down to two on the right
(turns, notifications, failures, live-context only). Reminders / Memos /
Billing / Stats / full Context block move out.

Reasoning: the engineer rarely needs to look at memos to debug a live
session; removing them gives turns/notifications/failures more breathing
room and lets logs grow taller.

### 4.5 `/admin` page layout

```text
+----------------------------------------------------------------------+
| Topbar:  papai admin | connection dot (REST health probe) | tz/now   |
+--------+-------------------------------------------------------------+
|        |                                                             |
|  Nav   |   Section content (only one section visible at a time)      |
|        |                                                             |
|  • System         (default landing)                                  |
|  • Billing                                                            |
|  • Stats                                                              |
|  • Memos                                                              |
|  • Reminders                                                          |
|  • Identities                                                         |
|  • Groups                                                             |
|        |                                                             |
|  Footer:                                                             |
|   build SHA / link to /debug                                          |
+--------+-------------------------------------------------------------+
```

- Nav is a 200 px left rail; selection is reflected in `location.hash`
  (e.g. `/admin#billing`) so deep links and refreshes preserve the view
  without pulling in a router lib.
- "System" landing shows: required env presence summary (read-only from
  what the server reports), then `CredentialsForm`, then a tiny "active
  build" line. No SSE.
- Section bodies use a vertical scroll. Each section header has its own
  `<h2>` and an optional toolbar (window selector, search, refresh).
- Tables are full-width within the section, never inside a 1/3-column
  card. Long results paginate by clamping to the existing server-side
  limits (billing 500, stats already aggregates).

### 4.6 `/admin` sections in detail

- **System.** `CredentialsForm` (the only mutation surface in /admin
  today). Shows masked `llm_apikey`, plain `llm_baseurl`, `main_model`,
  `small_model`, `embedding_model`. Edit-and-save still calls
  `POST /admin/llm` with the same body shape.
- **Billing.** Window selector (`24h / 7d / 30d / all`), subjects table,
  row click opens **SubjectDetail modal** (size `lg`) containing
  request rows + `SubjectStatsPanel` (anonymous per-subject stats).
- **Stats.** Window selector (`1d / 7d / 30d / all`) + `StatsPanel`
  global view.
- **Memos.** "User ID" input + "Load" button. Browses memos by user with
  `state` filter (active / archived / all). New fetcher hits
  `GET /memos?userId=&state=`.
- **Reminders.** "User ID" input + "Load" button. Lists recurring tasks
  (`GET /recurring?userId=`) and deferred prompts (`GET /deferred?userId=`)
  side by side.
- **Identities.** "User ID" + provider select (defaults to `task-provider`).
  Lists current mappings. v1 read-only; clearing happens via chat tool.
- **Groups.** Lists authorized groups (`GET /auth/groups`). Read-only.

### 4.7 Modal pattern

Promote `Modal.svelte` into a shared primitive with three additions:

```svelte
interface Props {
  open: boolean
  title: string
  size?: 'sm' | 'md' | 'lg' | 'xl'   // new — default 'md'
  onClose: () => void
  body: Snippet
  footer?: Snippet                    // new — confirm-dialog actions
}
```

Two compositions:

- **Inspection modal** (default). Read-only. No footer snippet — body
  scrolls inside. Used by SessionDetail / TraceDetail / LogDetail /
  TurnDetail / FailureDetail / SubjectDetail.
- **Confirm dialog** (`size: 'sm'`, footer snippet with Cancel/Confirm
  buttons). New, used the moment we add the first destructive admin
  action (out of scope for v1 but reserved).

Sizes (max-width): `sm 360 px`, `md 640 px`, `lg 920 px`, `xl 1200 px`.
All keep the existing click-outside-to-close and Escape handling (Escape
is **missing today** — add it as part of the move).

### 4.8 Shared visual identity

Both pages share `client/shared/base.css` (extracted from
`client/debug/dashboard.css`):

- font stack: JetBrains Mono → Fira Code → Cascadia Code → monospace, 12 px.
- background `#0a0a0a`, foreground `#cccccc`.
- accent `#00ff88` (connected / active / counters), error `#ff4444`.
- panel = `background:#111; border:1px solid #222; border-radius:2px;`.
- `.count-badge`, `.placeholder`, `.status-error`, `.status-success` —
  kept identical so component code keeps using the same classnames.

`/debug` adds `debug.css` with grid layout + log-explorer styles.
`/admin` adds `admin.css` with sidebar nav + section container.

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

## 6. Open questions (Resolved & Aligned)

1. **`/dashboard` redirect duration.** Keep as a 301 redirect to `/debug` for at least two minor releases to ensure smooth transition of existing bookmarks. Server and smoke tests are updated in lock-step to assert 301.
2. **Admin SSE.** v1 remains strictly REST-polling. To prevent unnecessary SSE load, the `/admin` bundle does not establish an event stream connection. Toasts or indicators will be added in a future phase using filtered SSE if required.
3. **Auth scope.** For v1, parity is maintained. A single `DEBUG_TOKEN` gates both `/debug` and `/admin` routes uniformly.
4. **Tests directory layout.** Follow the mirrored pattern: `tests/client/debug/`, `tests/client/admin/`, and `tests/client/shared/`. Existing client test files are ported to these mirrored directories as panels are moved.

## 7. Risks

- **Build complexity.** `scripts/build-client.ts` becomes two builds (or
  one build with two entrypoints). Mitigation: factor the build helper to
  accept `{ entry, html, jsName, cssName }` and call it twice. Component
  CSS collection is already per-file.
- **CSS leakage.** Today all component-scoped CSS is concatenated into
  one stylesheet. Two bundles means two stylesheets — the shared
  classnames must be in the shared base, otherwise a panel can render
  unstyled on one page. Mitigation: extract `base.css` first, run both
  pages against it, then move debug-only and admin-only blocks.
- **Test fragility.** `tests/debug/server.test.ts` asserts the literal
  `/dashboard` HTML response. Flip to `/debug` + 301 from `/dashboard`
  in the same commit that adds the route.
- **DEBUG_TOKEN regression.** Splitting routes risks accidentally
  exempting a new admin endpoint from the central auth gate.
  Mitigation: keep one `isAuthorizedRequest()` call at the top of
  `routeRequest`; do not add per-route token checks. The phase plan calls
  this out explicitly.

## 8. Out of scope

- Charts and timeseries on stats. Existing `<dl>` lists are kept.
- Audit log of admin actions. Out for v1; `POST /admin/llm` already
  records `updatedBy` so the data is there when we add a panel.
- Role-based access control with multiple operator accounts.
- i18n; both pages stay English-only.
- Theme toggle; dark-only.
- Mobile layout; both pages assume ≥ 1024 px viewport.

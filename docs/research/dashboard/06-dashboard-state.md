<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# `DashboardState` — what the UI holds in memory

Source: `client/debug/dashboard-types.ts`. This is the single mutable
state object held by the dashboard (`client/debug/dashboard.svelte.ts`)
and progressively updated by SSE handlers plus REST fetches.

```ts
type DashboardStats = {
  startedAt: number
  totalMessages: number
  totalLlmCalls: number
  totalToolCalls: number
}

type DashboardState = {
  connected: boolean

  // Aggregate counters (mirrors state-collector `stats`)
  stats: DashboardStats

  // Live in-memory collections, capped per CAPS in handlers-helpers
  sessions: Map<string, Session> // by userId
  wizards: Map<string, DashboardWizard> // by userId
  scheduler: SchedulerInfo
  pollers: PollersInfo
  messageCache: MessageCacheInfo
  llmTraces: LlmTrace[] // newest first, cap CAPS.TRACE
  logs: LogEntry[] // FIFO, cap CAPS.LOG
  logScopes: Set<string>
  turns: Turn[] // newest first, cap CAPS.TURN
  notifications: Notification[] // newest first, cap CAPS.NOTIFICATION
  toolFailures: ToolFailure[] // newest first, cap CAPS.TOOL_FAILURE

  // REST-fetched + SSE-updated collections
  recurringTasks: RecurringTask[] // cap CAPS.RECURRING
  deferredPrompts: DeferredPrompt[] // cap CAPS.DEFERRED
  memos: Memo[] // cap CAPS.MEMO
  identityMappings: Map<string, IdentityMappingEntry> // by userId
  activeConfigEditors: Set<string> // userIds with open /config flows
  authorizedGroups: AuthorizedGroupEntry[]

  // UI filter / focus
  activeContext: string // currently selected user/group context
  activeLogFilter: { turnId?: string }

  // Billing panel
  billingWindow: BillingWindow
  billingSubjects: BillingSubject[]
  billingDetail: BillingDetail | null

  // Admin credentials form
  adminLlm: AdminLlmSnapshot | null

  // Stats panels
  statsWindow: StatsWindow
  globalStats: GlobalStats | null
  subjectStats: SubjectStats | null
}
```

## Where each slice is populated

| Slice                                | Initial source                         | Live updates                                         |
| ------------------------------------ | -------------------------------------- | ---------------------------------------------------- |
| `stats`                              | `state:init` → `state:stats`           | `state:stats`, `llm:full`, `tool:*`                  |
| `sessions`                           | `state:init`                           | `cache:load`, `cache:sync`, `cache:expire`           |
| `wizards`                            | `state:init`                           | `wizard:created`, `wizard:updated`, `wizard:deleted` |
| `scheduler`/`pollers`/`messageCache` | `state:init`                           | `scheduler:tick`, `poller:*`, `msgcache:sweep`       |
| `llmTraces`                          | `state:init` (`recentLlm`)             | `llm:full`                                           |
| `logs` / `logScopes`                 | (REST `/logs` for initial backfill)    | `log:entry`                                          |
| `turns`                              | `state:init` (`recentTurns`)           | `turn:start`, `turn:end`, `turn:summary`             |
| `notifications`                      | `state:init` (`recentNotifications`)   | `reply:sent`, `typing:*`, `notify:*`                 |
| `toolFailures`                       | `state:init` (`recentToolFailures`)    | `tool:failure_classified`                            |
| `recurringTasks`                     | REST `/recurring?userId=...`           | `recurring:*`                                        |
| `deferredPrompts`                    | REST `/deferred?userId=...`            | `deferred:*`                                         |
| `memos`                              | REST `/memos?userId=...`               | `memo:created`, `memo:archived`                      |
| `identityMappings`                   | REST `/identity?userId=...`            | `identity:set`, `identity:cleared`                   |
| `activeConfigEditors`                | (empty)                                | `config_editor:opened` / `:closed`                   |
| `authorizedGroups`                   | REST `/auth/groups`                    | `auth:group_authorized`, `auth:group_revoked`        |
| `billingSubjects`                    | REST `/billing/subjects?window=...`    | manual re-fetch on window change                     |
| `billingDetail`                      | REST `/billing/subject/:id?window=...` | manual re-fetch                                      |
| `adminLlm`                           | REST `/admin/llm`                      | manual re-fetch after `POST /admin/llm`              |
| `globalStats`                        | REST `/stats/global?window=...`        | manual re-fetch                                      |
| `subjectStats`                       | REST `/stats/subject/:id`              | manual re-fetch                                      |

`CAPS` are defined in `client/debug/handlers-helpers.ts`. The TRACE buffer
is bounded at `CAPS.TRACE` on the client (server cap: 65535). Other client
caps are smaller view-only limits.

## Live-state projections that differ from REST shapes

Several SSE handlers build a _reduced_ version of the REST entity because
the event payload only carries a subset of fields:

- `RecurringTask` (vs `RecurringTaskRecord` from `/recurring`)
- `DeferredPrompt` (vs `ScheduledPrompt` from `/deferred`)
- `IdentityMappingEntry` (vs `IdentityMapping` from `/identity`)

See [03-domain-types.md](./03-domain-types.md) for both shapes side-by-side.
The UI tolerates both because REST fetches overwrite the slice with the
canonical record, then SSE patches it in place.

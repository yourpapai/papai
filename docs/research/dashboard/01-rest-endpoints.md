<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# REST endpoints feeding the dashboard

All endpoints live in `src/debug/server.ts` (`routeRequest`).
All return JSON unless noted. All are gated by `Authorization: Bearer <DEBUG_TOKEN>`
(when `DEBUG_TOKEN` is set in env). Static `/dashboard*` files are served from
`public/`.

## Live observability

### `GET /events` — SSE

Content-Type: `text/event-stream`. Connection-scoped. See
[02-sse-events.md](./02-sse-events.md).

### `GET /logs`

Query params (all optional):

| Name     | Type    | Notes                                                       |
| -------- | ------- | ----------------------------------------------------------- |
| `level`  | integer | minimum pino level (entries with `level >= value` returned) |
| `scope`  | string  | exact pino `scope` match                                    |
| `turnId` | string  | exact `turnId` match                                        |
| `q`      | string  | case-insensitive substring match on `msg`                   |
| `limit`  | integer | default `100` (returns the _last_ N matches)                |

Response: `LogEntry[]` (see `LogEntry` in `src/debug/log-buffer.ts`):

```ts
type LogEntry = {
  level: number
  time: string
  scope?: string
  turnId?: string
  msg: string
  [key: string]: unknown // structured-logging extras
}
```

### `GET /logs/stats`

Response (`BufferStats`):

```ts
{
  count: number
  capacity: number
  oldest: string | null
  newest: string | null
}
```

### `GET /turns/:turnId`

Looks up an assembled turn in the in-memory ring buffer
(`recentTurns`, capacity 512). Returns 404 if missing.
Response: a single `Turn` — see [03-domain-types.md](./03-domain-types.md#turn).

## Per-user records (admin user only, today)

These endpoints all take `?userId=<platformUserId>` (required).
The debug server filters by the admin user via `state-collector` visibility
rules; today these REST routes accept any userId in the query but the
existing UI only passes `adminUserId`.

### `GET /recurring?userId=...`

Response: `RecurringTaskRecord[]` — see
[03-domain-types.md](./03-domain-types.md#recurringtaskrecord).

### `GET /deferred?userId=...`

Response: `ScheduledPrompt[]` — see
[03-domain-types.md](./03-domain-types.md#scheduledprompt).

### `GET /memos?userId=...&state=active|archived|...`

Default `state=active`. Limit hard-coded to 100.
Response: `readonly Memo[]` — see
[03-domain-types.md](./03-domain-types.md#memo).

### `GET /identity?userId=...&provider=task-provider`

Default `provider=task-provider`. Returns 404 if no mapping recorded yet.
Response: `IdentityMapping` — see
[03-domain-types.md](./03-domain-types.md#identitymapping).

### `GET /auth/groups`

Response: `Array<{ group_id: string; added_by: string; added_at: string }>`.

## Billing

### `GET /billing/subjects?window=24h|7d|30d|all`

Default `window=30d`. Returns 400 on unknown window.

Response:

```ts
{
  window: '24h' | '7d' | '30d' | 'all'
  subjects: BillingSubject[]   // see 04-billing-and-admin-llm.md
}
```

### `GET /billing/subject/:storageContextIdEncoded?window=...`

`storageContextIdEncoded` is URL-encoded; for groups it is
`<groupId>` or `<groupId>:<threadId>`. Returns 404 if no rows in window.

Response (`BillingDetail` envelope):

```ts
{
  window: BillingWindow
  subject: BillingSubject
  requests: BillingRequestRow[]   // capped at BILLING_DETAIL_LIMIT (500)
  truncated: boolean
}
```

## Admin LLM credentials

### `GET /admin/llm`

Returns the current snapshot of admin-owned `system_config` keys with
the `llm_apikey` value masked to `****<last4>`. Shape (`AdminLlmSnapshot`):

```ts
{
  llm_apikey: {
    value: string | null
    updatedAt: number | null
    updatedBy: string | null
  }
  llm_baseurl: {
    value: string | null
    updatedAt: number | null
    updatedBy: string | null
  }
  main_model: {
    value: string | null
    updatedAt: number | null
    updatedBy: string | null
  }
  small_model: {
    value: string | null
    updatedAt: number | null
    updatedBy: string | null
  }
  embedding_model: {
    value: string | null
    updatedAt: number | null
    updatedBy: string | null
  }
}
```

### `POST /admin/llm`

Hard-requires `DEBUG_TOKEN` to be set in env (separate from the
read auth) and `ADMIN_USER_ID` to be present.

Request body (`UpdateBodySchema`):

```ts
{
  key: 'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model' | 'embedding_model'
  value: string // non-empty after trim
}
```

Response:

```ts
{
  ok: true
  key: SystemConfigKey
  updatedAt: number
}
```

Errors:

| Status | Body shape          | Cause                              |
| ------ | ------------------- | ---------------------------------- |
| 400    | `{ error: string }` | bad JSON, unknown key, empty value |
| 401    | `{ error: string }` | `DEBUG_TOKEN` not set in env       |
| 503    | `{ error: string }` | `ADMIN_USER_ID` missing            |
| 500    | `{ error: string }` | uncaught failure                   |

## Stats (anonymous aggregates)

### `GET /stats/global?window=1d|7d|30d|all`

Default `30d`. Returns `GlobalStats` — see
[05-stats.md](./05-stats.md#globalstats).

### `GET /stats/subject/:storageContextIdEncoded`

Returns 404 when the subject id is not present in any storage block.
Returns `SubjectStats` — see [05-stats.md](./05-stats.md#subjectstats).

## Static bundles

| Path                               | File served             |
| ---------------------------------- | ----------------------- |
| `GET /dashboard`                   | `public/dashboard.html` |
| `GET /dashboard.js`                | `public/dashboard.js`   |
| `GET /dashboard.css`               | `public/dashboard.css`  |
| `GET /dashboard.*` / `dashboard-*` | other dashboard assets  |

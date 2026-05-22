<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Billing & Admin LLM credentials

Server modules:

- `src/usage/types.ts` — base aggregate types fed by `llm_usage_events`
  and `tool_call_events` tables.
- `src/usage/query.ts` — `listSubjects`, `getSubjectDetail`,
  tool-call summaries.
- `src/debug/billing.ts` — adds display-name decoration and the
  `BillingDetail` envelope (caps detail rows
  at 500, sets `truncated`).
- `src/debug/billing-routes.ts` — HTTP wiring.
- `src/debug/admin-llm.ts` — snapshot + update of `system_config` keys.
- `src/system-config.ts` — `SystemConfigKey` union, env seed,
  `maskSystemConfigValue` (api key → `****<last4>`).

Client mirrors live in `client/debug/billing/fetchers.ts`.

## Window enums

```ts
type BillingWindow = '24h' | '7d' | '30d' | 'all' // default '30d'
// internal:  24h=86_400_000  7d=604_800_000  30d=2_592_000_000  all=null
```

## Subject aggregates

```ts
type ModelRole = 'main' | 'small' | 'embedding'
type ContextType = 'dm' | 'group'

type SubjectRoleTotals = {
  inputTokens: number
  outputTokens: number
  calls: number
}

type SubjectSummary = {
  storageContextId: string
  contextType: ContextType
  totals: {
    main: SubjectRoleTotals
    small: SubjectRoleTotals
    embedding: SubjectRoleTotals
  }
  toolCalls: number // sum of llm_usage_events.toolCallCount
  lastActiveAt: number // max(occurredAt) over the window
}

type BillingSubject = SubjectSummary & {
  displayName: string | null
}
```

`displayName` is resolved by `resolveSubjectDisplayNames`
(`src/debug/subject-display-name.ts`):

- DM (`contextType === 'dm'`): `users.username` for that `platformUserId`.
- group (`contextType === 'group'`): the most recent
  `known_group_contexts.displayName` for the stripped `groupId`
  (`storageContextId.split(':')[0]`).
- otherwise: `null`.

## Subject detail

```ts
type BillingRequestRow = {
  eventId: string // sha-256 hash on the server
  occurredAt: number
  turnId: string | null
  chatUserId: string
  model: string
  modelRole: ModelRole
  inputTokens: number | null
  outputTokens: number | null
  stepCount: number
  toolCallCount: number
  messageCount: number
  durationMs: number
  finishReason: string | null
  error: string | null
}

type BillingDetail = {
  subject: BillingSubject
  requests: readonly BillingRequestRow[] // capped, ordered occurredAt DESC
  truncated: boolean
}
```

Server constant: `BILLING_DETAIL_LIMIT = 500`. `truncated === true`
means rows beyond the cap exist in the same window.

## Tool-call rows (Phase 4)

`tool_call_events` rows are not surfaced directly by the dashboard today,
but `src/usage/query.ts` exposes them as `ToolCallRow` / `ToolCallSubjectSummary`
for future panels:

```ts
type ToolCallRow = {
  eventId: string
  turnId: string
  occurredAt: number
  storageContextId: string
  contextType: ContextType
  chatUserId: string
  model: string
  modelRole: 'main' | 'small'
  toolName: string
  toolCallId: string
  success: boolean
  durationMs: number | null
  errorType: string | null
  errorCode: string | null
  retryable: boolean | null
  recovered: boolean | null
  argsBytes: number | null
  resultBytes: number | null
  responseId: string | null
}

type ToolCallSubjectSummary = {
  storageContextId: string
  contextType: ContextType
  totalCalls: number
  successCalls: number
  failureCalls: number
  argsBytesTotal: number
  resultBytesTotal: number
  durationMsTotal: number
}
```

## Admin LLM credentials snapshot

```ts
type SystemConfigKey = 'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model' | 'embedding_model'

type AdminLlmKeyState = {
  value: string | null // masked for llm_apikey → '****<last4>'
  updatedAt: number | null
  updatedBy: string | null // e.g. 'env' or the admin user id
}

type AdminLlmSnapshot = Record<SystemConfigKey, AdminLlmKeyState>
```

Required keys for full configuration:
`llm_apikey`, `llm_baseurl`, `main_model`.
`small_model` and `embedding_model` are optional.

## Mutation contract

`POST /admin/llm`:

```ts
// Request
{
  key: SystemConfigKey
  value: string
} // value must be non-empty after trim
// Response
{
  ok: true
  key: SystemConfigKey
  updatedAt: number
}
```

Errors and their causes are listed in [01-rest-endpoints.md](./01-rest-endpoints.md#post-adminllm).

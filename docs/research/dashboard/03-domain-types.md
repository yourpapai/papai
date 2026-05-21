<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Domain types referenced by the dashboard

All schemas are inferred from `zod` definitions on the server, plus a few
plain TS interfaces. The client mirrors them in `client/debug/dashboard-types.ts`
or has parallel Zod schemas in `client/debug/billing/fetchers.ts` and
`client/debug/stats/fetchers.ts`.

Sources are noted under each section.

## Sessions

**Source:** `src/debug/schemas.ts` — `SessionSchema`, `FactSchema`,
`InstructionSchema`, `HistoryMessageSchema`.

```ts
type Fact = {
  identifier: string
  title: string
  url: string
  lastSeen: string
}

type Instruction = {
  id: string
  text: string
  createdAt: string
}

type HistoryMessage = {
  role: string
  content: string
  tool_calls?: unknown
  tool_call_id?: string
}

type Session = {
  userId: string
  lastAccessed: number
  historyLength: number
  factsCount: number
  summary: string | null
  configKeys: string[]
  workspaceId: string | null
  // Optional, only present on full-snapshot queries
  facts?: Fact[]
  config?: Record<string, string | null>
  hasTools?: boolean
  instructionsCount?: number
  instructions?: Instruction[]
  history?: HistoryMessage[]
}
```

## Wizard

**Source:** `src/debug/schemas.ts` — `WizardSchema`.

```ts
type Wizard = {
  userId: string
  currentStep: number
  totalSteps: number
}
```

The client uses a `DashboardWizard` variant that allows `'---'` for
fields not yet delivered:

```ts
type DashboardWizard = {
  userId: string
  currentStep: number | '---'
  totalSteps: number | '---'
}
```

## Runtime status blocks

**Source:** `src/debug/schemas.ts`.

```ts
type SchedulerInfo = { running?: boolean; tickCount?: number }
type PollersInfo = { scheduledRunning?: boolean; alertsRunning?: boolean }
type MessageCacheInfo = { size?: number; pendingWrites?: number }
type TokenInfo = { inputTokens: number; outputTokens: number }
```

## LLM trace

**Source:** `src/debug/llm-trace-collector.ts` and the parser
`LlmTraceSchema` in `src/debug/schemas.ts`.

```ts
type LlmTrace = {
  timestamp: number | string
  userId: string
  model: string
  duration: number
  steps: number
  totalTokens: TokenInfo
  toolCalls?: LlmTraceToolCall[]
  error?: string
  responseId?: string
  actualModel?: string
  finishReason?: string
  messageCount?: number
  toolCount?: number
  exposedToolCount?: number
  fullToolCount?: number
  toolSchemaBytes?: number
  routingIntent?: string
  routingConfidence?: number
  routingReason?: string
  generatedText?: string
  stepsDetail?: StepDetail[]
}

type LlmTraceToolCall = {
  toolName: string
  durationMs: number
  success: boolean
  toolCallId?: string
  args?: unknown
  result?: unknown
  error?: string
}

type StepDetail = {
  stepNumber: number
  text?: string
  finishReason?: string
  toolCalls?: Array<{
    toolName: string
    toolCallId: string
    args: unknown
    result?: unknown
    error?: string
  }>
  usage?: TokenInfo
}
```

## Turn

**Source:** `src/debug/turn-assembly.ts`.

```ts
type Turn = {
  turnId: string
  scope: Scope
  startedAt: number
  endedAt?: number
  status: 'running' | 'ok' | 'error' | 'cancelled'
  incomingMessageCount: number
  toolCalls: TurnToolCall[]
  reply?: { durationMs: number }
  error?: string
}

type TurnToolCall = {
  name: string
  durationMs: number
  ok: boolean
  failureReason?: string
}

type Scope =
  | { kind: 'user'; userId: string }
  | { kind: 'group'; groupId: string; threadId?: string }
  | { kind: 'global' }
```

## Notification

**Source:** `src/debug/turn-assembly.ts`.

```ts
type Notification = {
  timestamp: number
  type: string // e.g. 'reply:sent', 'notify:*', 'typing:start'
  scope: Scope
  data: Record<string, unknown>
}
```

## ToolFailure

**Source:** `src/debug/turn-assembly.ts`. Built from
`tool:failure_classified` events.

```ts
type ToolFailure = {
  timestamp: number
  scope: Scope
  data: Record<string, unknown> // server-side payload kept verbatim
}
```

## LogEntry

**Source:** `src/debug/log-buffer.ts` and `LogEntrySchema` in
`src/debug/schemas.ts`.

```ts
type LogEntry = {
  level: number
  time: string | number
  msg: string
  scope?: string
  turnId?: string
  [key: string]: unknown // arbitrary structured fields
}
```

## RecurringTaskRecord

**Source:** `src/types/recurring.ts`. Returned by `GET /recurring`.

```ts
type TriggerType = 'cron' | 'on_complete'

type RecurringTaskRecord = {
  id: string
  userId: string
  projectId: string
  title: string
  description: string | null
  priority: string | null
  status: string | null
  assignee: string | null
  labels: string[]
  triggerType: TriggerType
  rrule: string | null
  dtstartUtc: string | null
  timezone: string
  enabled: boolean
  catchUp: boolean
  lastRun: string | null
  nextRun: string | null
  createdAt: string
  updatedAt: string
}
```

The dashboard's reduced `RecurringTask` projection (used in live state):

```ts
type RecurringTask = {
  id: string
  userId: string
  title: string
  rrule: string | null
  nextRun: string | null
  enabled: boolean
  lastRun: string | null
}
```

## ScheduledPrompt (deferred)

**Source:** `src/deferred-prompts/types.ts`. Returned by `GET /deferred`.

```ts
type DeferredAudience = 'personal' | 'shared'

type DeferredPromptDelivery = {
  contextId: string
  contextType: 'dm' | 'group'
  threadId: string | null
  audience: DeferredAudience
  mentionUserIds: string[]
  createdByUserId: string
  createdByUsername: string | null
}

type ExecutionMode = 'lightweight' | 'context' | 'full'

type ExecutionMetadata = {
  mode: ExecutionMode
  delivery_brief: string
  context_snapshot: string | null
}

type ScheduledPrompt = {
  type: 'scheduled'
  id: string
  createdByUserId: string
  createdByUsername: string | null
  deliveryTarget: DeferredPromptDelivery
  prompt: string
  fireAt: string
  rrule: string | null
  dtstartUtc: string | null
  timezone: string | null
  status: 'active' | 'completed' | 'cancelled'
  createdAt: string
  lastExecutedAt: string | null
  executionMetadata: ExecutionMetadata
}
```

`AlertPrompt` (`type: 'alert'`) is also defined in the same module and
returned by tool-level list operations; the dashboard `GET /deferred`
route currently returns scheduled prompts only.

The dashboard's reduced `DeferredPrompt` projection used in live state:

```ts
type DeferredPrompt = {
  id: string
  createdByUserId: string
  prompt: string
  fireAt: string
  rrule: string | null
  status: string
}
```

## Memo

**Source:** `src/memos.ts`. Returned by `GET /memos`.

```ts
type Memo = {
  id: string
  userId: string
  content: string
  summary: string | null
  tags: readonly string[]
  status: string // 'active' | 'archived' | …
  createdAt: string
  updatedAt: string
}
```

## IdentityMapping

**Source:** `src/identity/types.ts`. Returned by `GET /identity`.

```ts
type MatchMethod = 'auto' | 'manual_nl' | 'unmatched'

type IdentityMapping = {
  contextId: string
  providerName: string
  providerUserId: string | null
  providerUserLogin: string | null
  displayName: string | null
  matchedAt: string
  matchMethod: MatchMethod | null
  confidence: number | null
}
```

The dashboard live state uses a flatter projection populated from
SSE events:

```ts
type IdentityMappingEntry = {
  userId: string
  provider: string
  providerUserId: string | null
  providerUserLogin: string | null
  displayName: string | null
}
```

## AuthorizedGroupEntry

**Source:** `src/authorized-groups.ts`. Returned by `GET /auth/groups`.

```ts
type AuthorizedGroupEntry = {
  group_id: string
  added_by: string
  added_at: string
}
```

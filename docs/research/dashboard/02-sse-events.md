<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# SSE channel — `GET /events`

Implemented in `src/debug/state-collector.ts`. Each frame is wire-formatted as:

```
event: <type>
data: <DebugEvent JSON>

```

with `DebugEvent` (from `src/debug/event-bus.ts`):

```ts
type DebugEvent = {
  type: string
  timestamp: number
  data: Record<string, unknown>
  scope: Scope
  turnId?: string
}

type Scope =
  | { kind: 'user'; userId: string }
  | { kind: 'group'; groupId: string; threadId?: string }
  | { kind: 'global' }
```

The client unwraps `data` (or falls back to the whole envelope) before
dispatching to handlers — see `unwrapEnvelope` in `client/debug/sse.ts`.

## Visibility filtering

Events are filtered by `isVisibleToAdmin(scope, adminVisibility)` before
broadcast:

- `global` scope: always visible.
- `user` scope: visible if `userId === adminUserId`.
- `group` scope: visible if `groupId` is in `adminVisibility.groupIds`
  (the set is currently never populated outside tests, so groups are
  effectively invisible today).

## Initial snapshot

On `addClient`, the server first sends one `state:init` frame containing
the entire current snapshot:

```ts
// event: state:init
data: {
  sessions:             unknown[]              // each parsed via SessionSchema
  wizards:              unknown[]              // each parsed via WizardSchema
  scheduler:            SchedulerInfo
  pollers:              PollersInfo
  messageCache:         MessageCacheInfo
  stats: {
    startedAt?: number
    totalMessages?: number
    totalLlmCalls?: number
    totalToolCalls?: number
  }
  recentLlm:            unknown[]              // each parsed via LlmTraceSchema
  recentTurns:          unknown[]              // each parsed via TurnSchema
  recentNotifications:  unknown[]              // each parsed via NotificationSchema
  recentToolFailures:   unknown[]              // each parsed via ToolFailureSchema
}
```

Schemas live in `src/debug/schemas.ts` (`StateInitEventSchema`).

## Event types

Grouped by handler family. All payloads listed are the inner `data` object.

### Core lifecycle

| Type          | Payload (`data`)                                                                      | Source                                            |
| ------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `state:init`  | see above                                                                             | per-client connect                                |
| `state:stats` | `{ startedAt?, totalMessages?, totalLlmCalls?, totalToolCalls? }` (`StateStatsEvent`) | debounced 500 ms                                  |
| `llm:full`    | `LlmTrace`                                                                            | broadcast on `llm:end` / `llm:error` (re-emitted) |

### Cache / sessions

| Type           | Payload                              | Notes                                        |
| -------------- | ------------------------------------ | -------------------------------------------- |
| `cache:load`   | `{ userId: string; field?: string }` | session fetched                              |
| `cache:sync`   | `{ userId: string; field?: string }` | session field saved (e.g. `field='history'`) |
| `cache:expire` | `{ userId: string }`                 | session removed                              |

### Wizard

| Type             | Payload                                                       |
| ---------------- | ------------------------------------------------------------- |
| `wizard:created` | `{ userId: string; currentStep: number; totalSteps: number }` |
| `wizard:updated` | partial of the above with required `userId`                   |
| `wizard:deleted` | `{ userId: string }`                                          |

### Scheduler / pollers / message cache

| Type               | Payload                                                   |
| ------------------ | --------------------------------------------------------- |
| `scheduler:tick`   | `{ running?: boolean; tickCount?: number }`               |
| `poller:scheduled` | `{ scheduledRunning?: boolean; alertsRunning?: boolean }` |
| `poller:alerts`    | same                                                      |
| `msgcache:sweep`   | `{ size?: number; pendingWrites?: number }`               |

### LLM trace lifecycle (server-side internal)

These are consumed by `state-collector` to build `LlmTrace`, then
re-broadcast as `llm:full`. They are also broadcast as-is.

| Type              | Notable `data` fields                                                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llm:start`       | `userId`, `model`                                                                                                                                                                                                                            |
| `llm:tool_result` | `userId`, `toolName`, `durationMs`, `success`, `toolCallId`, `args`, `result`, `error`                                                                                                                                                       |
| `llm:end`         | many — see `buildEndTrace` (steps, tokenUsage, totalDuration, responseId, actualModel, finishReason, messageCount, toolCount, exposedToolCount, fullToolCount, toolSchemaBytes, routingIntent/Confidence/Reason, generatedText, stepsDetail) |
| `llm:error`       | `userId`, `model?`, `error`                                                                                                                                                                                                                  |

### Turn assembly

Stored in three ring buffers (`turn-assembly.ts`): turns (512),
notifications (2048), tool failures (1024).

| Type                           | Payload                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `turn:start`                   | `{ turnId: string; incomingMessageCount: number; scope: Scope }` (server uses event.scope) |
| `turn:end`                     | `{ turnId: string; status: 'ok'\|'error'\|'cancelled'; error?: string }`                   |
| `turn:summary`                 | full `Turn` (re-broadcast on `turn:end`)                                                   |
| `tool:failure_classified`      | `{ turnId, toolName, durationMs, ok, failureReason, ... }`                                 |
| `reply:sent`                   | arbitrary; recorded as `Notification`                                                      |
| `typing:start` / `typing:stop` | recorded as `Notification`                                                                 |
| `notify:scheduler_fired`       | recorded as `Notification`                                                                 |
| `notify:deferred_alert`        | recorded as `Notification`                                                                 |
| any other `notify:*`           | recorded as `Notification` (handler matches `startsWith('notify:')`)                       |

### Logging

| Type        | Payload    | Source                                |
| ----------- | ---------- | ------------------------------------- |
| `log:entry` | `LogEntry` | `logBufferStream` on every pino write |

### Recurring tasks (per-user)

| Type                | Payload (minimum used by UI)                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `recurring:created` | `{ taskId, userId, title=name, rrule?, nextRun? }` (server emits `{ taskId, name, schedule }`) |
| `recurring:updated` | `{ taskId, title?, rrule?, nextRun? }`                                                         |
| `recurring:paused`  | `{ taskId }`                                                                                   |
| `recurring:resumed` | `{ taskId }`                                                                                   |
| `recurring:deleted` | `{ taskId }`                                                                                   |
| `recurring:fired`   | observed in stream; not currently rendered                                                     |

### Deferred prompts (per-user)

| Type                 | Payload (minimum used by UI)                   |
| -------------------- | ---------------------------------------------- |
| `deferred:created`   | `{ promptId, userId, prompt, fireAt, rrule? }` |
| `deferred:updated`   | `{ promptId, prompt?, fireAt? }`               |
| `deferred:cancelled` | `{ promptId }`                                 |
| `deferred:fired`     | `{ promptId }`                                 |
| `deferred:alerted`   | observed in stream                             |

### Memos (per-user)

| Type            | Payload                                        |
| --------------- | ---------------------------------------------- |
| `memo:created`  | `{ memoId, userId, content, tags?: string[] }` |
| `memo:archived` | `{ memoIds: string[] }`                        |

### Identity mappings

| Type               | Payload                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `identity:set`     | `{ userId, provider, providerUserId?, providerUserLogin?, displayName? }` |
| `identity:cleared` | `{ userId }`                                                              |

### Config editor (DM-driven `/config` flow)

| Type                   | Payload                                    |
| ---------------------- | ------------------------------------------ |
| `config_editor:opened` | `{ userId }`                               |
| `config_editor:closed` | `{ userId }`                               |
| `config_editor:step`   | `{ userId, ... }` (not currently rendered) |

### Authorized groups

| Type                    | Payload                      |
| ----------------------- | ---------------------------- |
| `auth:group_authorized` | `{ groupId }` (global scope) |
| `auth:group_revoked`    | `{ groupId }` (global scope) |

### Message ingress (stats only)

`message:received` increments `stats.totalMessages` and schedules a
`state:stats` rebroadcast. The raw event is also broadcast.

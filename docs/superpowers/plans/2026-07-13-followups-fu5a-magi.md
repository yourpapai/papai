<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# FU5a · Component A (magi): report per-turn token usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thread ACP's per-turn token `usage` from `runRecordedTurn` up through the milestone `emit`/`HttpNotifier` push, so nerv's `/notify` receives a **per-turn delta** it can unconditionally `$inc` into `task.usageUsd` — with no double-counting and no reliance on ACP semantics nerv cannot control.

**Architecture:** ACP's `Usage` is **cumulative across the whole ACP-level session**, and magi resumes the _same_ ACP session id across an entire follow-up/resume lineage (not a fresh one per magi turn) — so the raw value on turn N is the running total for turns 1..N of that lineage, not turn N alone. magi therefore tracks a per-lineage "last cumulative snapshot" (on the lineage root's session row) and computes `usageDelta = max(0, current - previous)` per field on every turn, persists that delta on the row (mirroring the existing `lastMessage` pattern), and threads it into exactly the milestone emits that represent genuine turn completion — never into `finish.ts`'s separate, later, explicit-finish `done` emit, which would otherwise double-report an already-sent delta.

**Tech Stack:** Bun, TypeScript (strict, `tsgo`), `bun:sqlite`, `@agentclientprotocol/sdk` (ACP), `bun:test`, oxlint/oxfmt.

---

## Authoritative finding: ACP `Usage` is session-cumulative, and magi's lineage shares one ACP session

Read directly from `node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts` (SDK v0.28.1) in the magi repo:

```ts
/**
 * Token usage information for a prompt turn.
 * @experimental
 */
export type Usage = {
  /** Sum of all token types across session. */
  totalTokens: number
  /** Total input tokens across all turns. */
  inputTokens: number
  /** Total output tokens across all turns. */
  outputTokens: number
  /** Total thought/reasoning tokens */
  thoughtTokens?: number | null
  /** Total cache read tokens. */
  cachedReadTokens?: number | null
  /** Total cache write tokens. */
  cachedWriteTokens?: number | null
  _meta?: { [key: string]: unknown } | null
}
```

```ts
export type PromptResponse = {
  stopReason: StopReason
  /** UNSTABLE ... Token usage for this turn (optional). @experimental */
  usage?: Usage | null
  _meta?: { [key: string]: unknown } | null
}
```

The `PromptResponse.usage` doc comment says "for this turn", but every individual `Usage` field doc says **"across session"** / **"across all turns"** — the SDK's own docs contradict each other. The field-level docs are the operative contract (they describe what the _numbers_ mean, not the wrapper), so **`Usage` must be treated as cumulative-since-`session/new`**, not a per-turn delta. This was verified empirically too: a throwaway test (`runAcpSession` against `startStubAgent` configured with `usage: { totalTokens: 300, inputTokens: 200, outputTokens: 100 }`) confirmed the value round-trips byte-for-byte through the real ACP JSON-RPC wire protocol with no client-side stripping/reshaping — so whatever the backend reports arrives at magi unmodified.

**Critically, magi does not mint a fresh ACP session per turn.** Reading `src/session/lifecycle.ts`:

- `captureAcpSessionId` (`lifecycle.ts:234-241`) stores the ACP `sessionId` **only on the lineage root** (`if (root !== null && root.acpSessionId === null)`), captured once, on the very first turn.
- `resolveResumeId` (`lifecycle.ts:44-50`) always reads `root.acpSessionId` — i.e. **every** follow-up/resume turn in a lineage passes the _same_ ACP session id as `resumeSessionId`.
- `tryResumeSession`/`runLoadedSession` (`src/acp/resume.ts:59-87`) then issues `session/load` (not `session/new`) for that id and calls `session/prompt` on it — the _same_ underlying agent-side session that has been accumulating usage since the lineage's first turn.

So the spec's open assumption — _"magi mints a new child session per follow-up/resume, so each child's usage restarts at 0"_ — is **incorrect**: a magi _child session row_ (`Session.id`, minted fresh per follow-up/resume) is a bookkeeping id only; the underlying **ACP session** (and therefore its cumulative usage counter) persists across the whole lineage. The delta boundary is the **lineage**, not the child row: usage resets to "start fresh" only on the very first turn of a lineage (when `resolveResumeId` returns `undefined` and a brand-new ACP session is created via `session/new`).

**Design:** magi tracks the last-seen cumulative `Usage` **on the lineage root's session row** (a new `cumulative_usage_json` column, set every turn via `lineageIdOf(store, id)`), computes `usageDelta = max(0, current.field - previous.field)` per field, and persists that computed delta **on the turn's own row** (a new `usage_json` column, mirroring `last_message`) for the emit path to read. A first-ever lineage turn (no prior snapshot) emits the raw usage unchanged (nothing to subtract). This makes the magi→nerv wire contract unambiguous regardless of the SDK's self-contradictory docs: **the field name is `usage` on the wire, but the value magi puts there is always a positive per-turn delta**, ready for nerv's `$inc`.

## Design note: `finish.ts`'s `done` emit deliberately does NOT carry usage

The spec text names both `auto-finish.ts` and `finish.ts` as emit call sites to extend. Reading the actual control flow shows this would be a bug: `runAutoFinish` (`src/session/auto-finish.ts`) is called exactly once per lifecycle, immediately after the turn completes, and its **"connect a code host"** branch (dirty worktree, no forge token) emits `answer` **without transitioning the session to a terminal status** — the session stays `waiting_input` (or similar), transitionable (`TRANSITIONS['waiting_input']` includes `'finishing'`, `src/session/state.ts:40`). A user can later call the separate, explicit `finishSession` (`src/session/finish.ts`) on that _same session id_, which emits `done` — with **no new turn having run**. If both emits carried the row's stored usage, nerv would `$inc` the same delta twice for one turn. Component A therefore threads usage only into the emit call sites that are provably tied to a turn _just_ having completed (`RunTurnDeps.emit`/`AutoFinishDeps.emit`, reached from `resolveSessionAnswer`/`runAutoFinish`); `FinishSessionDeps.emit` (`finish.ts:16`) keeps its original 3-arg signature untouched, so its `done` emit structurally cannot carry a usage payload.

## Resolved payload shape

```ts
// src/notify/notifier.ts
export interface TokenUsage {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  thoughtTokens: number
  cachedReadTokens: number
  cachedWriteTokens: number
}

export interface Milestone {
  sessionId: string
  contextId: string
  kind: MilestoneKind
  text: string
  usage?: TokenUsage
}
```

ACP's optional/nullable fields (`thoughtTokens`, `cachedReadTokens`, `cachedWriteTokens`) are normalized to `0` when absent — magi's `TokenUsage` is always fully populated, never partially optional, so nerv never has to null-check individual fields. `_meta` is dropped (ACP extensibility bag, no defined meaning here). The POST body's `usage` key is present only when the milestone's `usage` is defined — `JSON.stringify` drops `undefined`-valued keys automatically, so no branching is needed in `HttpNotifier.notify`.

---

## File Structure

| File                                  | Responsibility                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/notify/notifier.ts` (modify)     | `TokenUsage` type, `Milestone.usage?`, `HttpNotifier.notify` POST body                                                  |
| `src/session/usage.ts` (new)          | Pure functions: ACP→magi normalization (`toTokenUsage`), delta math (`usageDelta`), JSON round-trip (`parseTokenUsage`) |
| `src/launcher/stub-agent.ts` (modify) | Test harness: `StubAgentOptions.usage` so tests can make the stub agent report ACP usage                                |
| `src/session/helpers.ts` (modify)     | `runRecordedTurn` returns normalized `usage`; `resolveSessionAnswer`'s notify callback threads it                       |
| `src/session/state.ts` (modify)       | `Session.usage: TokenUsage \| null`                                                                                     |
| `src/session/store-row.ts` (modify)   | `SessionRow.usage_json`, `rowToSession` mapping                                                                         |
| `src/session/store.ts` (modify)       | `usage_json`/`cumulative_usage_json` columns + migrations; `setUsage`, `getCumulativeUsage`, `setCumulativeUsage`       |
| `src/session/lifecycle.ts` (modify)   | `runSessionTurn` computes the lineage delta and persists it                                                             |
| `src/session/auto-finish.ts` (modify) | Threads the row's usage into the turn-terminal `emit` calls                                                             |
| `src/session/manager.ts` (modify)     | `emit()` accepts optional `usage` and includes it on the `Milestone`                                                    |

---

### Task 1: `TokenUsage` type + `Milestone`/`HttpNotifier` payload

**Files:**

- Modify: `src/notify/notifier.ts`
- Test: `tests/notify/notifier.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/notify/notifier.test.ts` (inside the existing `describe('HttpNotifier', ...)` block):

```ts
test('includes usage in the POST body when present', async (): Promise<void> => {
  let body: unknown = null
  const fake: HttpFetch = (_url, init): Promise<Response> => {
    body = JSON.parse(init.body)
    return Promise.resolve(new Response('{}', { status: 200 }))
  }
  const notifier = new HttpNotifier({ url: 'https://papai/api/notify', token: 'tok', httpFetch: fake })
  const usage: TokenUsage = {
    totalTokens: 300,
    inputTokens: 200,
    outputTokens: 100,
    thoughtTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
  }
  await notifier.notify({ sessionId: 's1', contextId: 'ctx-9', kind: 'answer', text: 'done', usage })
  expect(body).toEqual({ contextId: 'ctx-9', markdown: 'done', usage })
})

test('omits usage from the POST body when absent', async (): Promise<void> => {
  let body: unknown = null
  const fake: HttpFetch = (_url, init): Promise<Response> => {
    body = JSON.parse(init.body)
    return Promise.resolve(new Response('{}', { status: 200 }))
  }
  const notifier = new HttpNotifier({ url: 'https://papai/api/notify', token: 'tok', httpFetch: fake })
  await notifier.notify({ sessionId: 's1', contextId: 'ctx-9', kind: 'answer', text: 'done' })
  expect(body).toEqual({ contextId: 'ctx-9', markdown: 'done' })
  expect(Object.keys(body as Record<string, unknown>)).not.toContain('usage')
})
```

Add the `TokenUsage` import to the top of the file:

```ts
import type { HttpFetch } from '../../src/notify/notifier.js'
import type { TokenUsage } from '../../src/notify/notifier.js'
```

(These can be a single combined `import type { HttpFetch, TokenUsage } from '../../src/notify/notifier.js'` — keep it as one line.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/notify/notifier.test.ts`
Expected: FAIL — `TokenUsage` is not an exported member of `notifier.js`, and/or the two new assertions fail because `Milestone` has no `usage` field yet.

- [ ] **Step 3: Implement**

In `src/notify/notifier.ts`, add the `TokenUsage` interface after the `MilestoneKind` type (before `Milestone`):

```ts
export interface TokenUsage {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  thoughtTokens: number
  cachedReadTokens: number
  cachedWriteTokens: number
}

export interface Milestone {
  sessionId: string
  contextId: string
  kind: MilestoneKind
  text: string
  usage?: TokenUsage
}
```

Update `HttpNotifier.notify`'s payload construction:

```ts
  async notify(milestone: Milestone): Promise<void> {
    const markdown = milestone.kind === 'answer' ? milestone.text : `[${milestone.kind}] ${milestone.text}`
    const payload = { contextId: milestone.contextId, markdown, usage: milestone.usage }
    const init: HttpFetchInit = {
      method: 'POST',
      headers: { authorization: `Bearer ${this.options.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }
    try {
      const res = await this.http(this.options.url, init)
      if (!res.ok) {
        logger.warn({ status: res.status, sessionId: milestone.sessionId }, 'notify non-2xx')
      }
    } catch (error: unknown) {
      logger.warn(
        { sessionId: milestone.sessionId, error: error instanceof Error ? error.message : String(error) },
        'notify failed',
      )
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/notify/notifier.test.ts`
Expected: `6 pass` (the 4 existing tests + 2 new ones), `0 fail`.

- [ ] **Step 5: Typecheck + lint + format**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: all clean (no errors).

- [ ] **Step 6: Commit**

```bash
git add src/notify/notifier.ts tests/notify/notifier.test.ts
git commit -m "feat(notify): add optional per-turn TokenUsage to Milestone/HttpNotifier"
```

---

### Task 2: Pure usage normalization + delta math

**Files:**

- Create: `src/session/usage.ts`
- Test: `tests/session/usage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/session/usage.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import type * as acp from '@agentclientprotocol/sdk'

import type { TokenUsage } from '../../src/notify/notifier.js'
import { parseTokenUsage, toTokenUsage, usageDelta } from '../../src/session/usage.js'

function full(totalTokens: number, inputTokens: number, outputTokens: number): TokenUsage {
  return { totalTokens, inputTokens, outputTokens, thoughtTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0 }
}

describe('toTokenUsage', (): void => {
  test('normalizes ACP Usage, defaulting absent optional fields to 0', (): void => {
    const acpUsage: acp.Usage = { totalTokens: 10, inputTokens: 6, outputTokens: 4 }
    expect(toTokenUsage(acpUsage)).toEqual(full(10, 6, 4))
  })

  test('preserves populated optional fields', (): void => {
    const acpUsage: acp.Usage = {
      totalTokens: 10,
      inputTokens: 6,
      outputTokens: 4,
      thoughtTokens: 2,
      cachedReadTokens: 1,
      cachedWriteTokens: 1,
    }
    expect(toTokenUsage(acpUsage)).toEqual({
      totalTokens: 10,
      inputTokens: 6,
      outputTokens: 4,
      thoughtTokens: 2,
      cachedReadTokens: 1,
      cachedWriteTokens: 1,
    })
  })

  test('returns undefined for null or undefined usage', (): void => {
    expect(toTokenUsage(null)).toBeUndefined()
    expect(toTokenUsage(undefined)).toBeUndefined()
  })
})

describe('usageDelta', (): void => {
  test('returns the current usage unchanged when there is no prior snapshot (first turn of a lineage)', (): void => {
    expect(usageDelta(undefined, full(100, 60, 40))).toEqual(full(100, 60, 40))
  })

  test('returns the positive per-field delta against the prior cumulative snapshot', (): void => {
    expect(usageDelta(full(100, 60, 40), full(260, 160, 100))).toEqual(full(160, 100, 60))
  })

  test('clamps every field at 0 rather than emitting a negative delta on a counter regression', (): void => {
    expect(usageDelta(full(100, 60, 40), full(50, 30, 20))).toEqual(full(0, 0, 0))
  })
})

describe('parseTokenUsage', (): void => {
  test('round-trips a stringified TokenUsage', (): void => {
    const usage = full(10, 6, 4)
    expect(parseTokenUsage(JSON.stringify(usage))).toEqual(usage)
  })

  test('defaults every field to 0 for malformed JSON content', (): void => {
    expect(parseTokenUsage('{}')).toEqual(full(0, 0, 0))
    expect(parseTokenUsage('null')).toEqual(full(0, 0, 0))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/session/usage.test.ts`
Expected: FAIL — `Cannot find module '../../src/session/usage.js'`.

- [ ] **Step 3: Implement**

Create `src/session/usage.ts`:

```ts
import type * as acp from '@agentclientprotocol/sdk'

import type { TokenUsage } from '../notify/notifier.js'

// Normalizes ACP's optional/nullable Usage into magi's fully-populated TokenUsage,
// defaulting every optional field to 0. Returns undefined when the agent reported no
// usage at all for this PromptResponse (e.g. a backend that never populates the
// @experimental field) so callers can omit the milestone field entirely.
export function toTokenUsage(usage: acp.Usage | null | undefined): TokenUsage | undefined {
  if (usage === null || usage === undefined) {
    return undefined
  }
  return {
    totalTokens: usage.totalTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    thoughtTokens: usage.thoughtTokens ?? 0,
    cachedReadTokens: usage.cachedReadTokens ?? 0,
    cachedWriteTokens: usage.cachedWriteTokens ?? 0,
  }
}

// ACP's Usage is cumulative across every prompt() call sharing one ACP-level session id
// (see the SDK's per-field doc comments: "across session" / "across all turns"), and magi
// resumes the SAME acpSessionId for every follow-up/resume turn in a lineage (see
// lifecycle.ts's resolveResumeId, which always reads the lineage root's captured
// acpSessionId) -- so the raw `usage` on turn N is the running total for turns 1..N of the
// lineage, not turn N alone. This computes the positive per-field delta against the last
// cumulative snapshot seen for the lineage, clamping every field at 0 so a counter
// regression never produces a negative delta (which would under-count spend if propagated
// through an unconditional $inc downstream). `previous === undefined` (no prior snapshot,
// i.e. the lineage's first turn) returns `current` unchanged -- there is nothing to
// subtract yet.
export function usageDelta(previous: TokenUsage | undefined, current: TokenUsage): TokenUsage {
  if (previous === undefined) {
    return current
  }
  return {
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens),
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    thoughtTokens: Math.max(0, current.thoughtTokens - previous.thoughtTokens),
    cachedReadTokens: Math.max(0, current.cachedReadTokens - previous.cachedReadTokens),
    cachedWriteTokens: Math.max(0, current.cachedWriteTokens - previous.cachedWriteTokens),
  }
}

function readNumberField(parsed: unknown, field: string): number {
  if (typeof parsed !== 'object' || parsed === null) {
    return 0
  }
  const val = (parsed as Partial<Record<string, unknown>>)[field]
  return typeof val === 'number' ? val : 0
}

// Parses a TokenUsage previously serialized via JSON.stringify (see SessionStore.setUsage/
// setCumulativeUsage). Defensive against malformed/partial content the same way
// store-row.ts's parseProjectSpec is: every field independently defaults to 0 rather than
// throwing, so a corrupt row degrades to "no usage" instead of crashing the session read path.
export function parseTokenUsage(raw: string): TokenUsage {
  const parsed: unknown = JSON.parse(raw)
  return {
    totalTokens: readNumberField(parsed, 'totalTokens'),
    inputTokens: readNumberField(parsed, 'inputTokens'),
    outputTokens: readNumberField(parsed, 'outputTokens'),
    thoughtTokens: readNumberField(parsed, 'thoughtTokens'),
    cachedReadTokens: readNumberField(parsed, 'cachedReadTokens'),
    cachedWriteTokens: readNumberField(parsed, 'cachedWriteTokens'),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/session/usage.test.ts`
Expected: `9 pass`, `0 fail`.

- [ ] **Step 5: Typecheck + lint + format**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/session/usage.ts tests/session/usage.test.ts
git commit -m "feat(session): add ACP usage normalization + per-lineage delta math"
```

---

### Task 3: Test harness support — `StubAgentOptions.usage`

**Files:**

- Modify: `src/launcher/stub-agent.ts`

- [ ] **Step 1: Implement (harness-only change, no test of its own — exercised by Task 4)**

In `src/launcher/stub-agent.ts`, add `usage?: acp.Usage` to `StubAgentOptions`:

```ts
export interface StubAgentOptions {
  requestPermission?: boolean
  reply?: string
  hang?: boolean
  onPrompt?: (prompt: string) => void
  loadSession?: boolean
  failLoad?: boolean
  onLoad?: (sessionId: string) => void
  onNewSession?: (mcpServers: acp.McpServer[]) => void
  updateCount?: number
  updateDelayMs?: number
  usage?: acp.Usage
}
```

Thread it through `handlePrompt`'s plain-reply path into `sendReplyAndStop`:

```ts
  if (opts.requestPermission === true) {
    return handlePromptWithPermission(ctx, sessionId, reply)
  }

  return sendReplyAndStop(ctx.client, sessionId, reply, opts.usage)
}
```

Update `sendReplyAndStop`'s signature and return:

```ts
async function sendReplyAndStop(
  client: acp.AgentContext,
  sessionId: string,
  reply: string,
  usage?: acp.Usage,
): Promise<acp.PromptResponse> {
  await client.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: reply },
    },
  })

  return usage === undefined ? { stopReason: 'end_turn' } : { stopReason: 'end_turn', usage }
}
```

(`handlePromptWithPermission`'s own `sendReplyAndStop(ctx.client, sessionId, reply)` call is unchanged — the permission-flow stub path doesn't need usage for this plan's tests.)

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: clean (this file has no dedicated test; Task 4's tests exercise it).

- [ ] **Step 3: Commit**

```bash
git add src/launcher/stub-agent.ts
git commit -m "test(launcher): let the ACP stub agent report configurable token usage"
```

---

### Task 4: Thread usage through `runRecordedTurn`

**Files:**

- Modify: `src/session/helpers.ts`
- Test: `tests/session/helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/session/helpers.test.ts`, inside the `describe('helpers', ...)` block, after the existing `runRecordedTurn` test (around line 321):

```ts
test('runRecordedTurn normalizes the agent-reported usage into its return value', async (): Promise<void> => {
  tmpDir = mkdtempSync(join(tmpdir(), 'magi-helpers-usage-'))
  const socketPath = join(tmpDir, 'acp.sock')
  handle = await startStubAgent(socketPath, {
    reply: 'ok',
    usage: { totalTokens: 300, inputTokens: 200, outputTokens: 100 },
  })

  const result = await runRecordedTurn({
    socketPath,
    cwd: process.cwd(),
    prompt: 'do it',
    model: undefined,
    signal: new AbortController().signal,
    mcpServers: [],
    recorder: noopRecorder,
    permissionHandler: (): Promise<never> => Promise.reject(new Error('unused')),
    onSessionCreated: (): void => {},
    onUpdate: (): void => {},
    onPermissionResumed: (): void => {},
  })

  expect(result.usage).toEqual({
    totalTokens: 300,
    inputTokens: 200,
    outputTokens: 100,
    thoughtTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
  })
})

test('runRecordedTurn returns undefined usage when the agent reports none', async (): Promise<void> => {
  tmpDir = mkdtempSync(join(tmpdir(), 'magi-helpers-nousage-'))
  const socketPath = join(tmpDir, 'acp.sock')
  handle = await startStubAgent(socketPath, { reply: 'ok' })

  const result = await runRecordedTurn({
    socketPath,
    cwd: process.cwd(),
    prompt: 'do it',
    model: undefined,
    signal: new AbortController().signal,
    mcpServers: [],
    recorder: noopRecorder,
    permissionHandler: (): Promise<never> => Promise.reject(new Error('unused')),
    onSessionCreated: (): void => {},
    onUpdate: (): void => {},
    onPermissionResumed: (): void => {},
  })

  expect(result.usage).toBeUndefined()
})
```

`makeSession()` in this same file (around line 60-77) builds a full `Session` literal — add the new field:

```ts
function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'abc',
    project: 'demo',
    agent: 'stub',
    contextId: 'ctx',
    status: 'queued',
    prompt: 'hi',
    cwd: '',
    branch: null,
    prUrl: null,
    prNumber: null,
    lastMessage: null,
    usage: null,
    exitCode: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    projectSpec: demoSpec(),
    parentSessionId: null,
    acpSessionId: null,
    resumeState: 'live',
    idempotencyKey: null,
    ...overrides,
  }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/session/helpers.test.ts`
Expected: FAIL — TypeScript error first (`Session` missing `usage`, `result.usage` doesn't exist on the return type), then (once the type errors are visible) the two new assertions fail.

- [ ] **Step 3: Implement**

In `src/session/state.ts`, add `usage` to the `Session` interface (after `lastMessage`):

```ts
export interface Session {
  id: string
  project: string
  agent: string
  contextId: string
  status: SessionStatus
  prompt: string
  cwd: string
  branch: string | null
  prUrl: string | null
  prNumber: number | null
  lastMessage: string | null
  usage: TokenUsage | null
  exitCode: number | null
  createdAt: string
  updatedAt: string
  projectSpec: ProjectSpec | null
  parentSessionId: string | null
  acpSessionId: string | null
  resumeState: ResumeState
  idempotencyKey: string | null
}
```

Add the import at the top of `state.ts`:

```ts
import type { ProjectSpec } from '../project/config.js'
import type { TokenUsage } from '../notify/notifier.js'
```

In `src/session/helpers.ts`, add the `TokenUsage`/`toTokenUsage` imports and change `runRecordedTurn`'s return type + body:

```ts
import type { TokenUsage } from '../notify/notifier.js'
// ...
import { toTokenUsage } from './usage.js'
```

```ts
export async function runRecordedTurn(
  input: RunRecordedTurnInput,
): Promise<{ stopReason: StopReason; answer: string; usage: TokenUsage | undefined }> {
  const finalMessage = createFinalMessageAccumulator()
  try {
    input.recorder.record({ type: 'prompt', payload: { prompt: input.prompt, model: input.model } })
    const result = await runAcpSession({
      socketPath: input.socketPath,
      cwd: input.cwd,
      prompt: input.prompt,
      model: input.model,
      signal: input.signal,
      resumeSessionId: input.resumeSessionId,
      mcpServers: input.mcpServers,
      idleTimeoutMs: input.idleTimeoutMs,
      handlers: {
        onSessionCreated: input.onSessionCreated,
        onUpdate: tapOnUpdate(input.recorder, (n: SessionNotification): void => {
          finalMessage.push(n)
          input.onUpdate(n)
        }),
        onPermissionRequest: tapOnPermissionRequest(input.recorder, input.permissionHandler, input.onPermissionResumed),
      },
    })
    input.recorder.record({ type: 'result', payload: { stopReason: result.stopReason, usage: result.usage ?? null } })
    return { stopReason: result.stopReason, answer: finalMessage.text(), usage: toTokenUsage(result.usage) }
  } finally {
    input.recorder.close()
  }
}
```

Now `src/session/state.ts` importing from `src/notify/notifier.ts`, and `src/notify/notifier.ts` not importing anything from `session/*`, keeps `import/no-cycle` clean — no changes needed elsewhere for this step yet (the `Session.usage` field will be `null` everywhere until Task 5/6 wire it up; `rowToSession`/`SessionStore` don't populate it yet, which is fixed in the next task).

Also update `tests/session/lifecycle.test.ts`'s own full `Session` literal (around line 74) the same way — add `usage: null,` next to `lastMessage: null,`. Locate it via:

```bash
grep -n "lastMessage: null" tests/session/lifecycle.test.ts
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/session/helpers.test.ts tests/session/lifecycle.test.ts`
Expected: all pass (helpers.test.ts gains 2, lifecycle.test.ts unchanged count but compiles).

- [ ] **Step 5: Typecheck + lint + format**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: all clean. (`Session.usage` is now referenced but `SessionStore`/`rowToSession` don't set it yet — `store.get()` will type-error unless Task 5 lands in the same pass; if `tsgo` complains about `store-row.ts`'s object literal missing `usage`, proceed directly to Task 5 before committing this one, or land Tasks 4 and 5 as a single commit. Prefer keeping them separate commits by doing Task 5's `store-row.ts`/`store.ts` edits as part of this step if typecheck fails here — see Task 5.)

- [ ] **Step 6: Commit**

```bash
git add src/session/helpers.ts src/session/state.ts tests/session/helpers.test.ts tests/session/lifecycle.test.ts
git commit -m "feat(session): thread normalized ACP usage through runRecordedTurn"
```

---

### Task 5: Persist usage on the session store (per-row delta + per-lineage cumulative snapshot)

**Files:**

- Modify: `src/session/store-row.ts`
- Modify: `src/session/store.ts`
- Test: `tests/session/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/session/store.test.ts`:

```ts
import type { TokenUsage } from '../../src/notify/notifier.js'
```

```ts
test('a freshly created session has null usage', (): void => {
  const db = new Database(':memory:')
  const store = new SessionStore(db)
  store.create({
    id: 'sess-usage-fresh',
    project: 'proj-a',
    agent: 'agent-x',
    contextId: 'ctx',
    prompt: 'x',
    cwd: '',
    projectSpec: DEMO_SPEC,
  })
  expect(store.get('sess-usage-fresh')!.usage).toBeNull()
})

test('setUsage round-trips a per-turn delta through Session.usage', (): void => {
  const db = new Database(':memory:')
  const store = new SessionStore(db)
  store.create({
    id: 'sess-usage',
    project: 'proj-a',
    agent: 'agent-x',
    contextId: 'ctx',
    prompt: 'x',
    cwd: '',
    projectSpec: DEMO_SPEC,
  })
  const usage: TokenUsage = {
    totalTokens: 10,
    inputTokens: 6,
    outputTokens: 4,
    thoughtTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
  }
  store.setUsage('sess-usage', usage)
  expect(store.get('sess-usage')!.usage).toEqual(usage)
})

test('setCumulativeUsage/getCumulativeUsage round-trip, defaulting to null', (): void => {
  const db = new Database(':memory:')
  const store = new SessionStore(db)
  store.create({
    id: 'sess-cumulative',
    project: 'proj-a',
    agent: 'agent-x',
    contextId: 'ctx',
    prompt: 'x',
    cwd: '',
    projectSpec: DEMO_SPEC,
  })
  expect(store.getCumulativeUsage('sess-cumulative')).toBeNull()
  const usage: TokenUsage = {
    totalTokens: 300,
    inputTokens: 200,
    outputTokens: 100,
    thoughtTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
  }
  store.setCumulativeUsage('sess-cumulative', usage)
  expect(store.getCumulativeUsage('sess-cumulative')).toEqual(usage)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/session/store.test.ts`
Expected: FAIL — `store.setUsage`/`getCumulativeUsage`/`setCumulativeUsage` don't exist yet, and `Session.usage` is `undefined` (missing from `rowToSession`).

- [ ] **Step 3: Implement**

In `src/session/store-row.ts`, add `usage_json` to `SessionRow` and map it in `rowToSession`:

```ts
export interface SessionRow {
  id: string
  project: string
  agent: string
  context_id: string
  status: string
  prompt: string
  cwd: string
  branch: string | null
  pr_url: string | null
  pr_number: number | null
  last_message: string | null
  usage_json: string | null
  exit_code: number | null
  created_at: string
  updated_at: string
  project_spec: string | null
  parent_session_id: string | null
  acp_session_id: string | null
  resume_state: string
  idempotency_key: string | null
}
```

Add the import and the mapping:

```ts
import { parseTokenUsage } from './usage.js'
```

```ts
export function rowToSession(row: SessionRow): Session {
  const status = row.status
  if (!isSessionStatus(status)) {
    throw new Error(`Unknown session status: ${status}`)
  }
  const projectSpec: ProjectSpec | null = row.project_spec === null ? null : parseProjectSpec(row.project_spec)
  return {
    id: row.id,
    project: row.project,
    agent: row.agent,
    contextId: row.context_id,
    status,
    prompt: row.prompt,
    cwd: row.cwd,
    branch: row.branch,
    prUrl: row.pr_url,
    prNumber: row.pr_number,
    lastMessage: row.last_message,
    usage: row.usage_json === null ? null : parseTokenUsage(row.usage_json),
    exitCode: row.exit_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectSpec,
    parentSessionId: row.parent_session_id,
    acpSessionId: row.acp_session_id,
    resumeState: toResumeState(row.resume_state),
    idempotencyKey: row.idempotency_key,
  }
}
```

In `src/session/store.ts`, add the import, extend `SettableColumn`, add both migrations, and add the three new methods:

```ts
import type { TokenUsage } from '../notify/notifier.js'
// ... existing imports ...
import { parseTokenUsage } from './usage.js'
```

```ts
type SettableColumn =
  | 'branch'
  | 'pr_url'
  | 'last_message'
  | 'cwd'
  | 'acp_session_id'
  | 'resume_state'
  | 'usage_json'
  | 'cumulative_usage_json'
```

In the constructor's `migrations` array:

```ts
const migrations: ReadonlyArray<readonly [string, string]> = [
  ['last_message', 'last_message TEXT'],
  ['parent_session_id', 'parent_session_id TEXT'],
  ['acp_session_id', 'acp_session_id TEXT'],
  ['resume_state', "resume_state TEXT NOT NULL DEFAULT 'live'"],
  ['pr_number', 'pr_number INTEGER'],
  ['idempotency_key', 'idempotency_key TEXT'],
  ['usage_json', 'usage_json TEXT'],
  ['cumulative_usage_json', 'cumulative_usage_json TEXT'],
]
```

New methods, placed after `setResumeState`:

```ts
  setUsage(id: string, usage: TokenUsage): void {
    setField(this.db, 'usage_json', id, JSON.stringify(usage))
  }

  getCumulativeUsage(id: string): TokenUsage | null {
    const row = this.db
      .query<{ cumulative_usage_json: string | null }, SelectByIdParams>(
        'SELECT cumulative_usage_json FROM sessions WHERE id = $id',
      )
      .get({ $id: id })
    if (row === null || row.cumulative_usage_json === null) {
      return null
    }
    return parseTokenUsage(row.cumulative_usage_json)
  }

  setCumulativeUsage(id: string, usage: TokenUsage): void {
    setField(this.db, 'cumulative_usage_json', id, JSON.stringify(usage))
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/session/store.test.ts`
Expected: all pass (existing tests + 3 new ones).

- [ ] **Step 5: Typecheck + lint + format**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: all clean. This also resolves any typecheck gap left open at the end of Task 4 (`Session.usage` is now genuinely populated end to end).

- [ ] **Step 6: Commit**

```bash
git add src/session/store-row.ts src/session/store.ts tests/session/store.test.ts
git commit -m "feat(session): persist per-turn usage delta + per-lineage cumulative snapshot"
```

---

### Task 6: Wire the delta computation into `runSessionTurn`

**Files:**

- Modify: `src/session/lifecycle.ts`
- Test: `tests/session/lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/session/lifecycle.test.ts` a new `describe` block. It needs several new imports at the top of the file:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startStubAgent } from '../../src/launcher/stub-agent.js'
import type { LaunchedAgent } from '../../src/launcher/launcher.js'
import { PermissionEngine } from '../../src/permission/engine.js'
import { buildEphemeralProject } from '../../src/project/config.js'
import type { ProjectDefaults } from '../../src/project/config.js'
import { runSessionTurn } from '../../src/session/lifecycle.js'
import type { RunTurnDeps } from '../../src/session/lifecycle.js'
import { noopRecorder } from '../../src/session/transcript.js'
```

(`buildLaunchSpec, mcpServersFor, planFollowUp, resolveResumeId` stays in the existing import from `'../../src/session/lifecycle.js'` — add `runSessionTurn` to that same import line rather than duplicating it.)

```ts
const AUTONOMOUS_SPEC: ProjectSpec = {
  name: 'proj-autonomous',
  repoUrl: 'https://github.com/octo/proj-autonomous.git',
  baseBranch: 'main',
  permissionPreset: 'autonomous',
  agent: 'claude',
}

function autonomousDefaults(): ProjectDefaults {
  return { workspaceImage: 'img:1', agentEntrypoint: ['claude-code-acp'], egressAllowlistDomains: [] }
}

describe('runSessionTurn usage delta', (): void => {
  test('computes the delta against the lineage root's cumulative snapshot and persists both', async (): Promise<void> => {
    const db = new Database(':memory:')
    const store = new SessionStore(db)
    store.create({
      id: 'root',
      project: 'proj-autonomous',
      agent: 'claude',
      contextId: 'ctx',
      prompt: 'do it',
      cwd: '',
      projectSpec: AUTONOMOUS_SPEC,
    })
    store.setCumulativeUsage('root', {
      totalTokens: 100,
      inputTokens: 60,
      outputTokens: 40,
      thoughtTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
    })

    const tmpDir = mkdtempSync(join(tmpdir(), 'magi-lifecycle-usage-'))
    const socketPath = join(tmpDir, 'acp.sock')
    const handle = await startStubAgent(socketPath, {
      reply: 'ok',
      usage: { totalTokens: 260, inputTokens: 160, outputTokens: 100 },
    })

    try {
      const project = buildEphemeralProject(AUTONOMOUS_SPEC, autonomousDefaults())
      const launched: LaunchedAgent = { socketPath, cwd: process.cwd(), shutdown: (): Promise<void> => Promise.resolve() }
      const prepared = { worktreePath: process.cwd(), branch: 'acp/root', repoUrl: project.repoUrl }
      const deps: RunTurnDeps = {
        store,
        permissions: new PermissionEngine({}),
        makeRecorder: (): typeof noopRecorder => noopRecorder,
        transition: (id: string, to): void => store.updateStatus(id, to),
        emit: (): void => {},
      }

      await runSessionTurn(deps, 'root', launched, project, prepared, 'do it', undefined, new AbortController().signal)

      const session = store.get('root')
      expect(session!.usage).toEqual({
        totalTokens: 160,
        inputTokens: 100,
        outputTokens: 60,
        thoughtTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
      })
      expect(store.getCumulativeUsage('root')).toEqual({
        totalTokens: 260,
        inputTokens: 160,
        outputTokens: 100,
        thoughtTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
      })
    } finally {
      await handle.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/session/lifecycle.test.ts`
Expected: FAIL — `session.usage` is still `null` and `store.getCumulativeUsage('root')` is unchanged, because `runSessionTurn` doesn't compute/persist anything yet.

- [ ] **Step 3: Implement**

In `src/session/lifecycle.ts`, add imports:

```ts
import { usageDelta } from './usage.js'
```

Update `runSessionTurn`'s body:

```ts
export async function runSessionTurn(
  deps: RunTurnDeps,
  id: string,
  launched: LaunchedAgent,
  project: ProjectConfig,
  prepared: PreparedWorkspace,
  prompt: string,
  model: string | undefined,
  signal: AbortSignal,
  resumeSessionId?: string,
  mcpServers: acp.McpServer[] = [],
): Promise<void> {
  deps.transition(id, 'running')
  const handler = buildPermissionHandler(deps, id, project, prepared)
  const { stopReason, answer, usage } = await runRecordedTurn({
    socketPath: launched.socketPath,
    cwd: launched.cwd ?? prepared.worktreePath,
    prompt,
    model,
    signal,
    resumeSessionId,
    mcpServers,
    idleTimeoutMs: deps.idleTimeoutMs,
    recorder: deps.makeRecorder(id),
    permissionHandler: handler,
    onSessionCreated: (acpId: string): void => {
      captureAcpSessionId(deps, id, acpId)
    },
    onUpdate: (n: SessionNotification): void => {
      logger.debug({ id, kind: n.update.sessionUpdate }, 'update')
    },
    onPermissionResumed: (): void => {
      const current = deps.store.get(id)
      if (current !== null && current.status === 'waiting_permission') {
        deps.transition(id, 'running')
      }
    },
  })
  deps.store.setLastMessage(id, answer)
  if (usage !== undefined) {
    const rootId = lineageIdOf(deps.store, id)
    const previous = deps.store.getCumulativeUsage(rootId) ?? undefined
    deps.store.setCumulativeUsage(rootId, usage)
    deps.store.setUsage(id, usageDelta(previous, usage))
  }
  deps.transition(id, statusForStopReason(stopReason))
}
```

(`lineageIdOf` is already imported in `lifecycle.ts` — no new import needed for it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/session/lifecycle.test.ts`
Expected: all pass, including the new delta test.

- [ ] **Step 5: Typecheck + lint + format**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/session/lifecycle.ts tests/session/lifecycle.test.ts
git commit -m "feat(session): compute + persist the per-turn usage delta in runSessionTurn"
```

---

### Task 7: Thread usage into the turn-terminal milestone emits (not `finish.ts`)

**Files:**

- Modify: `src/session/helpers.ts` (`resolveSessionAnswer`)
- Modify: `src/session/auto-finish.ts`
- Modify: `src/session/lifecycle.ts` (`RunTurnDeps.emit` type)
- Modify: `src/session/manager.ts` (`SessionManager.emit`)
- Test: `tests/session/auto-finish.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/session/auto-finish.test.ts`:

```ts
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import type { MilestoneKind } from '../../src/notify/notifier.js'
import type { TokenUsage } from '../../src/notify/notifier.js'
import { runAutoFinish } from '../../src/session/auto-finish.js'
import type { AutoFinishDeps } from '../../src/session/auto-finish.js'
import { SessionStore } from '../../src/session/store.js'
import type { PreparedWorkspace, WorkspaceManager } from '../../src/workspace/workspace.js'
import type { ProjectConfig } from '../../src/project/config.js'

const DEMO_SPEC = {
  name: 'proj-a',
  repoUrl: 'https://github.com/octo/proj-a.git',
  baseBranch: 'main',
  permissionPreset: 'cautious' as const,
  agent: 'claude' as const,
}

const DEMO_PROJECT: ProjectConfig = {
  name: 'proj-a',
  repoUrl: 'https://github.com/octo/proj-a.git',
  baseBranch: 'main',
  permissionPreset: 'cautious',
  forge: { kind: 'github' },
}

function usage(totalTokens: number): TokenUsage {
  return { totalTokens, inputTokens: totalTokens, outputTokens: 0, thoughtTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0 }
}

describe('runAutoFinish usage threading', (): void => {
  test('carries the turn's stored usage delta on the clean-finish answer emit', async (): Promise<void> => {
    const db = new Database(':memory:')
    const store = new SessionStore(db)
    store.create({
      id: 'sess-clean',
      project: 'proj-a',
      agent: 'agent-x',
      contextId: 'ctx',
      prompt: 'x',
      cwd: '/tmp/w',
      projectSpec: DEMO_SPEC,
    })
    store.setBranch('sess-clean', 'acp/x')
    store.updateStatus('sess-clean', 'preparing')
    store.updateStatus('sess-clean', 'running')
    store.updateStatus('sess-clean', 'waiting_input')
    store.setLastMessage('sess-clean', 'all done')
    store.setUsage('sess-clean', usage(42))

    const emitted: Array<{ kind: MilestoneKind; usage: TokenUsage | undefined }> = []
    const ws: WorkspaceManager = {
      prepare: (): never => {
        throw new Error('unused')
      },
      prepareContinue: (): never => {
        throw new Error('unused')
      },
      finish: (): never => {
        throw new Error('unused')
      },
      isDirty: (): Promise<boolean> => Promise.resolve(false),
      cleanup: (): Promise<void> => Promise.resolve(),
    }
    const deps: AutoFinishDeps = {
      store,
      workspace: ws,
      forges: { forProject: (): never => { throw new Error('unused') } },
      emit: (_id: string, kind: MilestoneKind, _text: string, u?: TokenUsage): void => {
        emitted.push({ kind, usage: u })
      },
      transition: (id: string, to): void => store.updateStatus(id, to),
      failIfPossible: (): void => {},
    }

    const prepared: PreparedWorkspace = { worktreePath: '/tmp/w', branch: 'acp/x', repoUrl: DEMO_PROJECT.repoUrl }
    await runAutoFinish(deps, 'sess-clean', DEMO_PROJECT, prepared, undefined)

    expect(emitted).toEqual([{ kind: 'answer', usage: usage(42) }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/session/auto-finish.test.ts`
Expected: FAIL — TypeScript error (`AutoFinishDeps.emit` doesn't accept a 4th `usage` param yet), then (once compiling) the emitted `usage` is `undefined`.

- [ ] **Step 3: Implement**

In `src/session/helpers.ts`, update `resolveSessionAnswer`'s `notify` parameter type and thread `session.usage`:

```ts
import type { TokenUsage } from '../notify/notifier.js'
```

```ts
export function resolveSessionAnswer(
  store: SessionStore,
  id: string,
  notify: (kind: MilestoneKind, text: string, usage?: TokenUsage) => void,
): { session: Session; answer: string } | null {
  const session = store.get(id)
  if (session === null) {
    return null
  }
  const lm = session.lastMessage
  const textOrDefault = (fb: string): string => (lm !== null && lm.length > 0 ? lm : fb)
  const usage = session.usage ?? undefined
  if (session.status === 'failed') {
    notify('failed', textOrDefault('session failed'), usage)
    return null
  }
  if (session.status === 'cancelled') {
    notify('cancelled', 'session was cancelled', usage)
    return null
  }
  if (session.status !== 'waiting_input') {
    return null
  }
  return { session, answer: textOrDefault('agent finished a turn') }
}
```

In `src/session/lifecycle.ts`, widen `RunTurnDeps.emit`:

```ts
export interface RunTurnDeps {
  store: SessionStore
  permissions: PermissionEngine
  makeRecorder: (sessionId: string) => TranscriptRecorder
  transition: (id: string, to: SessionStatus) => void
  emit: (id: string, kind: MilestoneKind, text: string, usage?: TokenUsage) => void
  idleTimeoutMs?: number
}
```

Add `import type { TokenUsage } from '../notify/notifier.js'` to `lifecycle.ts`.

In `src/session/auto-finish.ts`, rewrite the file's emit-threading:

```ts
import type { ForgeProvider } from '../forge/provider.js'
import type { MilestoneKind, TokenUsage } from '../notify/notifier.js'
import type { ProjectConfig } from '../project/config.js'
import type { PreparedWorkspace, WorkspaceManager } from '../workspace/workspace.js'
import { autoPublishDirty } from './auto-publish.js'
import { resolveSessionAnswer, safeCleanup } from './helpers.js'
import type { Session, SessionStatus } from './state.js'
import type { SessionStore } from './store.js'

export interface AutoFinishDeps {
  store: SessionStore
  workspace: WorkspaceManager
  forges: ForgeProvider
  emit: (id: string, kind: MilestoneKind, text: string, usage?: TokenUsage) => void
  transition: (id: string, to: SessionStatus) => void
  failIfPossible: (id: string) => void
}

async function finishClean(
  deps: AutoFinishDeps,
  id: string,
  project: ProjectConfig,
  prepared: PreparedWorkspace,
  answer: string,
  usage: TokenUsage | undefined,
): Promise<void> {
  deps.emit(id, 'answer', answer, usage)
  await safeCleanup(id, deps.workspace, prepared, project)
  deps.transition(id, 'done')
}

async function publishDirty(
  deps: AutoFinishDeps,
  id: string,
  project: ProjectConfig,
  prepared: PreparedWorkspace,
  session: Session,
  answer: string,
  forgeToken: string,
  usage: TokenUsage | undefined,
): Promise<void> {
  deps.transition(id, 'finishing')
  const outcome = await autoPublishDirty(
    deps.workspace,
    deps.forges,
    deps.store,
    project,
    id,
    session,
    prepared,
    answer,
    forgeToken,
  )
  if (outcome.kind === 'done') {
    deps.transition(id, 'done')
    deps.emit(id, 'answer', `${answer}\n\n— Branch \`${session.branch}\` · PR: ${outcome.prUrl}`, usage)
  } else {
    deps.failIfPossible(id)
    deps.emit(id, 'failed', `${answer}\n\n— Publish failed: ${outcome.message}`, usage)
  }
}

export async function runAutoFinish(
  deps: AutoFinishDeps,
  id: string,
  project: ProjectConfig,
  prepared: PreparedWorkspace | null,
  forgeToken: string | undefined,
): Promise<void> {
  const resolved = resolveSessionAnswer(deps.store, id, (kind, text, usage): void => {
    deps.emit(id, kind, text, usage)
  })
  if (resolved === null) {
    return
  }
  const { session, answer } = resolved
  const usage = session.usage ?? undefined
  if (prepared === null) {
    deps.emit(id, 'answer', answer, usage)
    deps.transition(id, 'done')
    return
  }
  const dirty = await deps.workspace.isDirty(prepared)
  if (!dirty) {
    await finishClean(deps, id, project, prepared, answer, usage)
    return
  }
  if (forgeToken === undefined || forgeToken.length === 0) {
    const msg = answer + '\n\n— Uncommitted changes remain. Connect a code host and finish the session to push them.'
    deps.emit(id, 'answer', msg, usage)
    return
  }
  await publishDirty(deps, id, project, prepared, session, answer, forgeToken, usage)
}
```

In `src/session/manager.ts`, widen the private `emit` method (this satisfies `RunTurnDeps.emit`/`AutoFinishDeps.emit`'s new 4-arg shape and remains structurally assignable to `FinishSessionDeps.emit`'s unchanged 3-arg `(id, kind: 'done', text) => void` shape — a function with an extra optional trailing parameter and a wider `kind` type is assignable to a function type expecting fewer/narrower parameters):

```ts
import type { MilestoneKind, Notifier, TokenUsage } from '../notify/notifier.js'
```

```ts
  private emit(id: string, kind: MilestoneKind, text: string, usage?: TokenUsage): void {
    const s = this.store.get(id)
    if (s !== null) {
      void this.notifier.notify({ sessionId: id, contextId: s.contextId, kind, text, usage })
    }
  }
```

No change to `src/session/finish.ts` — `FinishSessionDeps.emit` keeps its original `(id: string, kind: 'done', text: string) => void` signature, and `finishSession`'s `deps.emit(id, 'done', ...)` call is untouched, so it structurally cannot pass a `usage` argument. This is deliberate (see the "Design note" above the task list): `finish.ts`'s `done` emit is a separate, later, explicit user action, not a fresh turn completion, and must never re-report a delta already sent by `auto-finish.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/session/auto-finish.test.ts tests/session/helpers.test.ts tests/session/lifecycle.test.ts tests/session/manager.test.ts`
Expected: all pass.

- [ ] **Step 5: Typecheck + lint + format**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/session/helpers.ts src/session/auto-finish.ts src/session/lifecycle.ts src/session/manager.ts tests/session/auto-finish.test.ts
git commit -m "feat(session): thread the turn's usage delta into terminal milestone emits"
```

---

### Task 8: End-to-end regression — lineage delta + no double-count via `finish.ts`

**Files:**

- Test: `tests/session/manager.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/session/manager.test.ts` a new test in (or near) the existing follow-up describe block. It needs a spy `Notifier` capturing milestones; add near the top of the file, alongside other test helpers:

```ts
function spyNotifier(): { notifier: Notifier; milestones: Milestone[] } {
  const milestones: Milestone[] = []
  return {
    notifier: {
      notify: (m: Milestone): Promise<void> => {
        milestones.push(m)
        return Promise.resolve()
      },
    },
    milestones,
  }
}
```

(`Milestone` type is already imported in this file — `import type { Milestone, Notifier } from '../../src/notify/notifier.js'`; the file currently only imports `Notifier`, so extend that import to include `Milestone` and `TokenUsage`.)

```ts
import type { Milestone, Notifier, TokenUsage } from '../../src/notify/notifier.js'
```

New test:

```ts
test('a follow-up turn reports only the incremental usage delta, and finish never re-reports it', async (): Promise<void> => {
  const db = new Database(':memory:')
  const store = new SessionStore(db)
  const { notifier, milestones } = spyNotifier()
  const manager = new SessionManager(
    store,
    new StubRuntime({ reply: 'first done', usage: { totalTokens: 100, inputTokens: 60, outputTokens: 40 } }),
    workspaceStub(),
    new PermissionEngine({}),
    demoDefaults(),
    forgeStub(),
    notifier,
  )

  const first = manager.startSession({
    projectSpec: demoProject(),
    agent: 'claude',
    contextId: 'ctx-usage',
    prompt: 'start',
  })
  await pollTerminal(manager, first.id)

  const firstAnswer = milestones.find((m): boolean => m.sessionId === first.id && m.kind === 'answer')
  expect(firstAnswer?.usage).toEqual({
    totalTokens: 100,
    inputTokens: 60,
    outputTokens: 40,
    thoughtTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
  })

  const followManager = new SessionManager(
    store,
    new StubRuntime({ reply: 'second done', usage: { totalTokens: 260, inputTokens: 160, outputTokens: 100 } }),
    workspaceStub(),
    new PermissionEngine({}),
    demoDefaults(),
    forgeStub(),
    notifier,
  )
  const followUp = followManager.followUpSession(first.id, { parentSessionId: first.id, prompt: 'continue' })
  expect(followUp).not.toBeNull()
  await pollTerminal(followManager, followUp!.id)

  const followAnswer = milestones.find((m): boolean => m.sessionId === followUp!.id && m.kind === 'answer')
  expect(followAnswer?.usage).toEqual({
    totalTokens: 160,
    inputTokens: 100,
    outputTokens: 60,
    thoughtTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
  })

  const doneMilestones = milestones.filter((m): boolean => m.kind === 'done')
  for (const m of doneMilestones) {
    expect(m.usage).toBeUndefined()
  }
})
```

This test uses `workspaceStub()`/`forgeStub()` helper names as placeholders for whatever fixture-building this file already uses to construct a clean (non-dirty) `WorkspaceManager`/`ForgeProvider` for `SessionManager`'s constructor — inspect the existing tests in `tests/session/manager.test.ts` (there are already many `new SessionManager(store, new StubRuntime(...), <workspace>, new PermissionEngine({}), demoDefaults(), <forges>, notifier)` call sites) and reuse the exact same workspace/forge fixture values/functions already defined in this file rather than inventing new ones — match the existing pattern exactly so this test's plumbing is consistent with its neighbors.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/session/manager.test.ts -t "incremental usage delta"`
Expected: FAIL before Tasks 1-7 land; once they do, this is a pure regression test that should already pass — run it to confirm it's green, not red, since by this point in the plan all the underlying wiring exists. If it fails, the failure means one of Tasks 1-7's wiring has a gap (most likely: the follow-up's `resumeSessionId` isn't reaching `runSessionTurn`, or `lineageIdOf` isn't resolving `followUp.id` back to `first.id`) — debug against `resolveResumeId`/`lineageIdOf` before proceeding.

- [ ] **Step 3: No implementation step — this task is pure verification**

If Step 2 fails, do not add new production code speculatively: use `superpowers:systematic-debugging` to find which prior task's wiring is incomplete, fix it there (amend that task's file, not this test), and rerun.

- [ ] **Step 4: Run full targeted suite**

Run: `bun test tests/session/manager.test.ts`
Expected: all pass (existing tests + the new one), no regressions in the rest of the file.

- [ ] **Step 5: Typecheck + lint + format**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add tests/session/manager.test.ts
git commit -m "test(session): verify lineage-level usage delta end to end, finish never re-reports it"
```

---

### Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: `n pass`, `0 fail`, where `n` = baseline `586` + this plan's new tests (2 notifier + 9 usage.ts + 2 helpers + 3 store + 1 lifecycle + 1 auto-finish + 1 manager = 19 new tests → expect `605 pass`, `0 fail`). If the actual new-test count differs because a step above added/removed an assertion, treat `605` as an estimate, not a hard gate — the hard gate is `0 fail`.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: clean, no errors.

- [ ] **Step 3: Lint**

Run: `bun run lint`
Expected: clean, no errors (denyWarnings is on — any warning fails the run).

- [ ] **Step 4: Format check**

Run: `bun run format:check`
Expected: clean.

- [ ] **Step 5: Confirm the working tree matches exactly the 9 task commits**

Run: `git log --oneline -10 && git status --short`
Expected: `git status --short` is empty (everything committed); the log shows exactly this plan's 9 commits on top of wherever the branch started.

---

## Handoff to nerv (Component B, out of scope for this plan)

nerv's `POST /notify` handler now receives an additive optional `usage: TokenUsage` field (see the payload shape above) whenever a magi milestone represents genuine turn completion (`answer`/`failed`/`cancelled` reached via `resolveSessionAnswer`/`runAutoFinish`), and never on `finish.ts`'s explicit-finish `done` milestone. nerv's own plan must price this **already-delta'd** value via `domain/cost.ts` and `$inc` it directly into `task.usageUsd` — it must **not** attempt its own cumulative-vs-delta reasoning against ACP semantics, since magi has fully absorbed that ambiguity at the source.

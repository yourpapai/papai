<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Agent Interruption & Steering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user steer, halt, or force-abort an in-flight LLM turn over chat by sending a mid-run message (injected at the next tool-step boundary) or the `/stop` command, without discarding completed work.

**Architecture:** Approach A — in-loop hooks. A new in-memory `RunRegistry` (keyed by `storageContextId`, mirroring `QueueRegistry`) holds a per-run `RunControl` (steer queue, stop flag, `AbortController`, completed-effects log). `processMessage` begins/ends the run; `invokeModel` reads it to (1) inject queued steer messages via a composed `prepareStep`, (2) end the loop deterministically via a dynamic `stopWhen` condition, and (3) accept a force-abort `AbortSignal`. `bot.ts` routes mid-run messages into the steer queue with an instant code-generated ack; the new `/stop` command escalates graceful-stop → force-abort. Group threads are serialized to one run each.

**Tech Stack:** Bun + TypeScript (strict, `.js` import suffixes), Vercel AI SDK v6 (`ai@^6`), Zod v4, Bun test runner (DI-first, isolation-clean).

---

## Background the engineer must know

- **The agent loop is one `generateText` call.** `src/llm-orchestrator-invoke.ts` calls `deps.generateText({ stopWhen: deps.stepCountIs(25), prepareStep?, experimental_onToolCallFinish, ... })`. There is no papai-owned step loop. We hook the SDK, never rewrite the loop.
- **AI SDK v6 facts (verified):** `prepareStep` may return `{ messages }` to rewrite the next step's conversation; `stopWhen` accepts an array of conditions incl. custom `() => boolean`; `abortSignal` passed to `generateText` is forwarded to tools and makes the call reject with an `AbortError` when aborted.
- **Only one `prepareStep` may be passed.** Progressive disclosure already uses it conditionally (`createDisclosurePrepareStep`). We compose, never add a second.
- **Keying:** everything is keyed by `storageContextId`. `processMessage(contextId, ...)` and `invokeModel`'s `contextId` are that same key; `bot.ts` uses `auth.storageContextId`. The `RunRegistry` uses it too, so DMs and separate group threads are independent.
- **Commands bypass the queue** (Grammy `bot.command` etc.), so `/stop` reaches a running turn. Non-command text flows `bot.ts handleMessage → enqueueMessage → MessageQueue → processCoalescedMessage → deps.processMessage`.
- **`normal` mode only.** Proactive runs (`src/deferred-prompts/proactive-llm.ts`) never call `runRegistry.begin`, so `invokeModel` sees no run and is a reference-identical pass-through for them — no special-casing needed, but we add a regression test.
- **Conventions:** SPDX header on every new file (copy from any existing `src/` file); `.js` in imports; `error instanceof Error ? error.message : String(error)`; structured pino logs; **no** `eslint-disable`/`@ts-ignore` (hook-blocked); every new `src/` file is **test-first** (the write-hook rejects a new impl file with no test, as the team hit on `embed-types`).

## File structure

**New files (each one responsibility):**

| File                                              | Responsibility                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/run-control/types.ts`                        | `RunControl`, `InjectedMessage`, `EffectRecord` types + `RunAbortedError` |
| `src/run-control/registry.ts`                     | `RunRegistry` class + `runRegistry` singleton (begin/get/end/clear)       |
| `src/run-control/summary.ts`                      | `buildStopSummary()` — code-generated partial-state summary               |
| `src/run-control/steering-prepare-step.ts`        | `createSteeringPrepareStep()` + `composePrepareSteps()`                   |
| `src/run-control/stop-condition.ts`               | `createStopRequestedCondition()` — dynamic `stopWhen`                     |
| `src/commands/stop.ts`                            | `/stop` command (graceful → force-abort escalation)                       |
| `tests/run-control/registry.test.ts`              | RunRegistry lifecycle                                                     |
| `tests/run-control/summary.test.ts`               | summary builder                                                           |
| `tests/run-control/steering-prepare-step.test.ts` | injection + composition                                                   |
| `tests/run-control/stop-condition.test.ts`        | stop condition                                                            |
| `tests/run-control/invoke-wiring.test.ts`         | invokeModel wiring (fake `generateText`)                                  |
| `tests/commands/stop.test.ts`                     | `/stop` command                                                           |

**Modified files:**

| File                             | Change                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/llm-orchestrator-invoke.ts` | compose steering prepareStep, dynamic stopWhen, abortSignal, effect recording, AbortError catch |
| `src/llm-orchestrator.ts`        | `processMessage`: begin/end run, post stop summary, re-enqueue leftover steers                  |
| `src/bot.ts`                     | mid-run routing + ack in `handleMessage`; register `/stop`                                      |
| `src/commands/help.ts`           | list `/stop`                                                                                    |
| `src/message-queue/queue.ts`     | serialize different-user group flush (one-run-per-thread)                                       |
| `src/system-prompt.ts`           | static steering fragment                                                                        |

---

## Task 1: RunControl types + RunRegistry

**Files:**

- Create: `src/run-control/types.ts`, `src/run-control/registry.ts`
- Test: `tests/run-control/registry.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/run-control/registry.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { createMockReply } from '../utils/test-helpers.js'
import { RunRegistry } from '../../src/run-control/registry.js'

describe('RunRegistry', () => {
  let registry: RunRegistry

  beforeEach(() => {
    registry = new RunRegistry()
  })

  test('begin creates a run retrievable by contextId', () => {
    const { reply } = createMockReply()
    const run = registry.begin('ctx-1', { turnId: 't1', reply })
    expect(run.contextId).toBe('ctx-1')
    expect(run.turnId).toBe('t1')
    expect(run.stopRequested).toBe(false)
    expect(run.steerQueue).toEqual([])
    expect(run.completedEffects).toEqual([])
    expect(registry.get('ctx-1')).toBe(run)
  })

  test('get returns undefined for unknown context', () => {
    expect(registry.get('nope')).toBeUndefined()
  })

  test('end removes the run and returns leftover steer messages', () => {
    const { reply } = createMockReply()
    const run = registry.begin('ctx-1', { turnId: 't1', reply })
    run.steerQueue.push({ text: 'only project X' })
    const leftover = registry.end('ctx-1')
    expect(leftover).toEqual([{ text: 'only project X' }])
    expect(registry.get('ctx-1')).toBeUndefined()
  })

  test('end on unknown context returns empty array', () => {
    expect(registry.end('nope')).toEqual([])
  })

  test('one run per context — second begin replaces the first', () => {
    const { reply } = createMockReply()
    registry.begin('ctx-1', { turnId: 't1', reply })
    const second = registry.begin('ctx-1', { turnId: 't2', reply })
    expect(registry.get('ctx-1')).toBe(second)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/run-control/registry.test.ts`
Expected: FAIL — `Cannot find module '../../src/run-control/registry.js'`.

- [ ] **Step 3: Write `src/run-control/types.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from '../chat/types.js'

/** A side-effecting tool action that completed during a run. */
export type EffectRecord = { toolName: string }

/** A user message captured mid-run, to be injected at the next step boundary. */
export type InjectedMessage = { text: string }

/** Live control surface for a single in-flight LLM run, keyed by storageContextId. */
export type RunControl = {
  readonly contextId: string
  readonly turnId: string
  readonly reply: ReplyFn
  readonly abortController: AbortController
  steerQueue: InjectedMessage[]
  stopRequested: boolean
  completedEffects: EffectRecord[]
}

/** Thrown by invokeModel when the user force-aborted the run. */
export class RunAbortedError extends Error {
  readonly effects: ReadonlyArray<EffectRecord>
  constructor(effects: ReadonlyArray<EffectRecord>) {
    super('Run force-aborted by user')
    this.name = 'RunAbortedError'
    this.effects = effects
  }
}
```

- [ ] **Step 4: Write `src/run-control/registry.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from '../chat/types.js'
import { logger } from '../logger.js'
import type { InjectedMessage, RunControl } from './types.js'

const log = logger.child({ scope: 'run-control:registry' })

export class RunRegistry {
  private runs = new Map<string, RunControl>()

  begin(contextId: string, opts: { turnId: string; reply: ReplyFn }): RunControl {
    const run: RunControl = {
      contextId,
      turnId: opts.turnId,
      reply: opts.reply,
      abortController: new AbortController(),
      steerQueue: [],
      stopRequested: false,
      completedEffects: [],
    }
    this.runs.set(contextId, run)
    log.debug({ contextId, turnId: opts.turnId }, 'Run started')
    return run
  }

  get(contextId: string): RunControl | undefined {
    return this.runs.get(contextId)
  }

  /** Remove the run; return any steer messages that were never injected. */
  end(contextId: string): InjectedMessage[] {
    const run = this.runs.get(contextId)
    this.runs.delete(contextId)
    if (run === undefined) return []
    log.debug({ contextId, turnId: run.turnId, leftover: run.steerQueue.length }, 'Run ended')
    return run.steerQueue
  }

  /** Test-only: drop all runs (singleton reset between tests in a file). */
  clear(): void {
    this.runs.clear()
  }
}

export const runRegistry = new RunRegistry()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/run-control/registry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/run-control/types.ts src/run-control/registry.ts tests/run-control/registry.test.ts
git commit -m "feat(run-control): add RunControl types and RunRegistry"
```

---

## Task 2: Stop summary builder

**Files:**

- Create: `src/run-control/summary.ts`
- Test: `tests/run-control/summary.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/run-control/summary.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildStopSummary } from '../../src/run-control/summary.js'

describe('buildStopSummary', () => {
  test('graceful stop with no effects', () => {
    const s = buildStopSummary([], { forced: false })
    expect(s).toBe('🛑 Stopped. No actions had been taken yet.')
  })

  test('graceful stop lists effects with counts', () => {
    const s = buildStopSummary(
      [{ toolName: 'update_task' }, { toolName: 'update_task' }, { toolName: 'add_comment' }],
      {
        forced: false,
      },
    )
    expect(s).toBe('🛑 Stopped. Completed 3 actions: update_task ×2, add_comment.')
  })

  test('forced stop warns about an in-flight action', () => {
    const s = buildStopSummary([{ toolName: 'update_task' }], { forced: true })
    expect(s).toBe(
      '🛑 Stopped immediately. Completed 1 action: update_task. An in-flight action may have been cut off — verify recent changes.',
    )
  })

  test('forced stop with no recorded effects still warns', () => {
    const s = buildStopSummary([], { forced: true })
    expect(s).toBe('🛑 Stopped immediately. An in-flight action may have been cut off — verify recent changes.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/run-control/summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/run-control/summary.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { EffectRecord } from './types.js'

/** Build the user-facing summary posted after a run is stopped. Deterministic, code-generated. */
export function buildStopSummary(effects: ReadonlyArray<EffectRecord>, opts: { forced: boolean }): string {
  const head = opts.forced ? '🛑 Stopped immediately.' : '🛑 Stopped.'
  const forcedTail = ' An in-flight action may have been cut off — verify recent changes.'

  if (effects.length === 0) {
    return opts.forced ? `${head}${forcedTail}` : `${head} No actions had been taken yet.`
  }

  const counts = new Map<string, number>()
  for (const effect of effects) counts.set(effect.toolName, (counts.get(effect.toolName) ?? 0) + 1)
  const parts = [...counts.entries()].map(([name, n]) => (n === 1 ? name : `${name} ×${n}`))
  const done = `Completed ${effects.length} action${effects.length === 1 ? '' : 's'}: ${parts.join(', ')}.`

  return opts.forced ? `${head} ${done}${forcedTail}` : `${head} ${done}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/run-control/summary.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/run-control/summary.ts tests/run-control/summary.test.ts
git commit -m "feat(run-control): add stop summary builder"
```

---

## Task 3: Steering prepareStep + composer

**Files:**

- Create: `src/run-control/steering-prepare-step.ts`
- Test: `tests/run-control/steering-prepare-step.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/run-control/steering-prepare-step.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createMockReply } from '../utils/test-helpers.js'
import { RunRegistry } from '../../src/run-control/registry.js'
import { composePrepareSteps, createSteeringPrepareStep } from '../../src/run-control/steering-prepare-step.js'

function makeRun() {
  const { reply } = createMockReply()
  return new RunRegistry().begin('ctx', { turnId: 't', reply })
}

describe('createSteeringPrepareStep', () => {
  test('returns undefined when steer queue is empty', () => {
    const run = makeRun()
    const step = createSteeringPrepareStep(run)
    expect(
      step({
        stepNumber: 0,
        steps: [],
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).toBeUndefined()
  })

  test('appends queued steer messages and drains the queue', () => {
    const run = makeRun()
    run.steerQueue.push({ text: 'only project X' })
    const step = createSteeringPrepareStep(run)
    const base = [{ role: 'user', content: 'close stale tasks' }]
    const result = step({ stepNumber: 1, steps: [], messages: base })
    expect(result).toEqual({
      messages: [...base, { role: 'user', content: 'only project X' }],
    })
    expect(run.steerQueue).toEqual([])
  })
})

describe('composePrepareSteps', () => {
  test('steering only: forwards injected messages', () => {
    const run = makeRun()
    run.steerQueue.push({ text: 'steer' })
    const composed = composePrepareSteps(createSteeringPrepareStep(run), undefined)
    const result = composed({
      stepNumber: 1,
      steps: [],
      messages: [{ role: 'user', content: 'a' }],
    })
    expect(result?.messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'steer' },
    ])
    expect(result?.activeTools).toBeUndefined()
  })

  test('merges steering messages with disclosure activeTools', () => {
    const run = makeRun()
    run.steerQueue.push({ text: 'steer' })
    const disclosure = () => ({ activeTools: ['get_current_time'] })
    const composed = composePrepareSteps(createSteeringPrepareStep(run), disclosure)
    const result = composed({ stepNumber: 1, steps: [], messages: [] })
    expect(result?.messages).toEqual([{ role: 'user', content: 'steer' }])
    expect(result?.activeTools).toEqual(['get_current_time'])
  })

  test('disclosure open-all ({}) preserves steering messages and sets no activeTools', () => {
    const run = makeRun()
    run.steerQueue.push({ text: 'steer' })
    const disclosure = () => ({})
    const composed = composePrepareSteps(createSteeringPrepareStep(run), disclosure)
    const result = composed({ stepNumber: 1, steps: [], messages: [] })
    expect(result?.messages).toEqual([{ role: 'user', content: 'steer' }])
    expect(result?.activeTools).toBeUndefined()
  })

  test('both empty: returns undefined', () => {
    const run = makeRun()
    const composed = composePrepareSteps(createSteeringPrepareStep(run), () => ({}))
    expect(composed({ stepNumber: 0, steps: [], messages: [] })).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/run-control/steering-prepare-step.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/run-control/steering-prepare-step.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { RunControl } from './types.js'

/** Minimal shape of the AI SDK prepareStep argument we rely on. */
export type PrepareStepArg = {
  stepNumber: number
  messages: ModelMessage[]
} & Record<string, unknown>
export type PrepareStepResult = {
  messages?: ModelMessage[]
  activeTools?: string[]
}
export type PrepareStep = (arg: PrepareStepArg) => PrepareStepResult | undefined

/** Inject any queued steer messages as user turns at the next step boundary, then drain the queue. */
export function createSteeringPrepareStep(run: RunControl): PrepareStep {
  return ({ messages }) => {
    if (run.steerQueue.length === 0) return undefined
    const injected: ModelMessage[] = run.steerQueue.map((m) => ({
      role: 'user',
      content: m.text,
    }))
    run.steerQueue = []
    return { messages: [...messages, ...injected] }
  }
}

/**
 * Merge steering injection with an optional disclosure prepareStep into the single hook the SDK allows.
 * Steering owns `messages`; disclosure owns `activeTools`. The same arg is forwarded to disclosure
 * (it bases activeTools on stepNumber/steps, not on the injected messages).
 */
export function composePrepareSteps(steering: PrepareStep, disclosure: PrepareStep | undefined): PrepareStep {
  return (arg) => {
    const steerResult = steering(arg)
    const disclosureResult = disclosure?.(arg)
    const hasMessages = steerResult?.messages !== undefined
    const hasActiveTools = disclosureResult?.activeTools !== undefined
    if (!hasMessages && !hasActiveTools) return undefined
    return {
      ...(hasMessages ? { messages: steerResult!.messages } : {}),
      ...(hasActiveTools ? { activeTools: disclosureResult!.activeTools } : {}),
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/run-control/steering-prepare-step.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/run-control/steering-prepare-step.ts tests/run-control/steering-prepare-step.test.ts
git commit -m "feat(run-control): add steering prepareStep and composer"
```

---

## Task 4: Stop-requested condition

**Files:**

- Create: `src/run-control/stop-condition.ts`
- Test: `tests/run-control/stop-condition.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/run-control/stop-condition.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createMockReply } from '../utils/test-helpers.js'
import { RunRegistry } from '../../src/run-control/registry.js'
import { createStopRequestedCondition } from '../../src/run-control/stop-condition.js'

describe('createStopRequestedCondition', () => {
  test('reflects the live stopRequested flag', () => {
    const { reply } = createMockReply()
    const run = new RunRegistry().begin('ctx', { turnId: 't', reply })
    const condition = createStopRequestedCondition(run)
    expect(condition()).toBe(false)
    run.stopRequested = true
    expect(condition()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/run-control/stop-condition.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/run-control/stop-condition.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunControl } from './types.js'

/**
 * A stopWhen condition that ends the loop after the current step when a deterministic
 * stop was requested. Assignable to the AI SDK StopCondition (sync boolean is allowed).
 */
export function createStopRequestedCondition(run: RunControl): () => boolean {
  return () => run.stopRequested
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/run-control/stop-condition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/run-control/stop-condition.ts tests/run-control/stop-condition.test.ts
git commit -m "feat(run-control): add stop-requested stopWhen condition"
```

---

## Task 5: Wire steering, stopWhen, abortSignal, and effect recording into invokeModel

**Files:**

- Modify: `src/llm-orchestrator-invoke.ts:240-250` (the `deps.generateText({...})` call) and imports
- Test: `tests/run-control/invoke-wiring.test.ts`

The strategy: a **fake `deps.generateText`** that captures its options object and returns (or throws). The test then invokes `captured.prepareStep`, checks `captured.stopWhen`, fires `captured.experimental_onToolCallFinish`, and asserts the wiring — no real LLM, fully deterministic.

- [ ] **Step 1: Write the failing test**

`tests/run-control/invoke-wiring.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createMockReply, mockLogger } from '../utils/test-helpers.js'
import { invokeModel } from '../../src/llm-orchestrator-invoke.js'
import { runRegistry } from '../../src/run-control/registry.js'
import { RunAbortedError } from '../../src/run-control/types.js'
import type { InvokeModelArgs } from '../../src/llm-orchestrator-types.js'

type Captured = Record<string, any>

function buildArgs(
  captured: { opts?: Captured },
  generateText: (opts: Captured) => Promise<any>,
): InvokeModelArgs & {
  reply: undefined
  turnId: string
} {
  return {
    contextId: 'ctx-1',
    chatUserId: 'user-1',
    contextType: 'dm',
    mainModel: 'main',
    model: {} as any,
    provider: null,
    tools: {},
    enabledToolNames: new Set<string>(),
    messages: [{ role: 'user', content: 'hi' }] as any,
    deps: {
      generateText: (async (opts: Captured) => {
        captured.opts = opts
        return generateText(opts)
      }) as any,
      stepCountIs: ((n: number) => ({ kind: 'stepCount', n })) as any,
      buildOpenAI: (() => ({})) as any,
      resolve: () => null,
      maybeAutoProvision: async () => false,
    },
    reply: undefined,
    turnId: 't1',
  }
}

const okResult = { text: 'done', toolCalls: [], response: { messages: [] } }

describe('invokeModel run-control wiring', () => {
  beforeEach(() => {
    mockLogger()
    runRegistry.clear()
  })
  afterEach(() => {
    runRegistry.clear()
  })

  test('no active run: stopWhen is the bare stepCount, no abortSignal, no steering prepareStep', async () => {
    const captured: { opts?: Captured } = {}
    await invokeModel(buildArgs(captured, async () => okResult))
    expect(captured.opts?.stopWhen).toEqual({ kind: 'stepCount', n: 25 })
    expect(captured.opts?.abortSignal).toBeUndefined()
    expect(captured.opts?.prepareStep).toBeUndefined()
  })

  test('active run: stopWhen is an array including a live stop condition; abortSignal present', async () => {
    const { reply } = createMockReply()
    const run = runRegistry.begin('ctx-1', { turnId: 't1', reply })
    const captured: { opts?: Captured } = {}
    await invokeModel(buildArgs(captured, async () => okResult))

    expect(Array.isArray(captured.opts?.stopWhen)).toBe(true)
    expect(captured.opts?.stopWhen[0]).toEqual({ kind: 'stepCount', n: 25 })
    const liveCondition = captured.opts?.stopWhen[1] as () => boolean
    expect(liveCondition()).toBe(false)
    run.stopRequested = true
    expect(liveCondition()).toBe(true)

    expect(captured.opts?.abortSignal).toBe(run.abortController.signal)
  })

  test('active run: prepareStep injects queued steer messages', async () => {
    const { reply } = createMockReply()
    const run = runRegistry.begin('ctx-1', { turnId: 't1', reply })
    run.steerQueue.push({ text: 'only project X' })
    const captured: { opts?: Captured } = {}
    await invokeModel(buildArgs(captured, async () => okResult))

    const result = captured.opts?.prepareStep({
      stepNumber: 1,
      steps: [],
      messages: [{ role: 'user', content: 'a' }],
    })
    expect(result.messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'only project X' },
    ])
  })

  test('active run: onToolCallFinish records completed effects', async () => {
    const { reply } = createMockReply()
    const run = runRegistry.begin('ctx-1', { turnId: 't1', reply })
    const captured: { opts?: Captured } = {}
    await invokeModel(buildArgs(captured, async () => okResult))

    captured.opts?.experimental_onToolCallFinish({
      toolName: 'update_task',
      toolCallId: 'c1',
      output: {},
    })
    expect(run.completedEffects).toEqual([{ toolName: 'update_task' }])
  })

  test('force-abort: aborted signal turns AbortError into RunAbortedError carrying effects', async () => {
    const { reply } = createMockReply()
    const run = runRegistry.begin('ctx-1', { turnId: 't1', reply })
    run.completedEffects.push({ toolName: 'update_task' })
    const captured: { opts?: Captured } = {}

    const args = buildArgs(captured, async (opts) => {
      run.abortController.abort()
      const err = new Error('Aborted')
      err.name = 'AbortError'
      throw err
    })

    await expect(invokeModel(args)).rejects.toBeInstanceOf(RunAbortedError)
  })

  test('non-abort errors pass through unchanged', async () => {
    runRegistry.begin('ctx-1', {
      turnId: 't1',
      reply: createMockReply().reply,
    })
    const captured: { opts?: Captured } = {}
    const args = buildArgs(captured, async () => {
      throw new Error('boom')
    })
    await expect(invokeModel(args)).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/run-control/invoke-wiring.test.ts`
Expected: FAIL — current `invokeModel` passes a bare `stopWhen` and ignores the registry.

- [ ] **Step 3: Edit imports in `src/llm-orchestrator-invoke.ts`**

After the existing import of `createDisclosurePrepareStep` (line 18), add:

```typescript
import { runRegistry } from './run-control/registry.js'
import { composePrepareSteps, createSteeringPrepareStep } from './run-control/steering-prepare-step.js'
import { createStopRequestedCondition } from './run-control/stop-condition.js'
import { RunAbortedError } from './run-control/types.js'
```

- [ ] **Step 4: Replace the `deps.generateText({...})` call (lines 240-250)**

Replace this exact block:

```typescript
const result = await deps.generateText({
  model,
  system: systemPrompt,
  messages,
  tools,
  timeout: 1_200_000,
  stopWhen: deps.stepCountIs(25),
  experimental_onToolCallStart: buildToolCallStartHandler(ctx),
  experimental_onToolCallFinish: buildToolCallFinishHandler(ctx),
  ...(disclosure === undefined
    ? {}
    : {
        prepareStep: createDisclosurePrepareStep(disclosure, contextId, turnId),
      }),
})
```

with:

```typescript
const run = runRegistry.get(contextId)
const disclosureStep = disclosure === undefined ? undefined : createDisclosurePrepareStep(disclosure, contextId, turnId)
const prepareStep =
  run === undefined ? disclosureStep : composePrepareSteps(createSteeringPrepareStep(run), disclosureStep)
const stopWhen = run === undefined ? deps.stepCountIs(25) : [deps.stepCountIs(25), createStopRequestedCondition(run)]
const finishHandler = buildToolCallFinishHandler(ctx)
let result: Awaited<ReturnType<typeof deps.generateText>>
try {
  result = await deps.generateText({
    model,
    system: systemPrompt,
    messages,
    tools,
    timeout: 1_200_000,
    stopWhen,
    ...(run === undefined ? {} : { abortSignal: run.abortController.signal }),
    experimental_onToolCallStart: buildToolCallStartHandler(ctx),
    experimental_onToolCallFinish: (event) => {
      if (run !== undefined) run.completedEffects.push({ toolName: event.toolName })
      finishHandler?.(event)
    },
    ...(prepareStep === undefined ? {} : { prepareStep }),
  })
} catch (error) {
  if (run !== undefined && run.abortController.signal.aborted) {
    log.info({ contextId, turnId }, 'Run force-aborted by user')
    throw new RunAbortedError(run.completedEffects)
  }
  throw error
}
```

Note: `stopWhen` typed as `StopCondition | StopCondition[]` is accepted by `generateText`; the array form is documented. The `experimental_onToolCallFinish` event exposes `toolName` (AI SDK v6). `finishHandler` may be `undefined` (the SDK type is optional), hence the optional call.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/run-control/invoke-wiring.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck the changed file**

Run: `bun run typecheck`
Expected: no errors. (If `event.toolName` complains, the onToolCallFinish event in v6 is typed with `toolName: string`; confirm by reading `node_modules/ai` types — do not add `@ts-ignore`.)

- [ ] **Step 7: Commit**

```bash
git add src/llm-orchestrator-invoke.ts tests/run-control/invoke-wiring.test.ts
git commit -m "feat(run-control): wire steering, stop, abort, and effect recording into invokeModel"
```

---

## Task 6: Run lifecycle + stop summary + leftover re-enqueue in processMessage

**Files:**

- Modify: `src/llm-orchestrator.ts` — `processMessage` (lines 235-284) and imports
- Test: covered by Task 5's registry behavior + a new lifecycle test here

This wraps the turn so `invokeModel` (Task 5) sees a live run, posts the stop summary on graceful/forced stop, and re-runs leftover steer messages as a fresh turn. It is the piece that guarantees `RunRegistry.end()` runs on every exit path.

- [ ] **Step 1: Write the failing test**

`tests/run-control/process-message-lifecycle.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createMockReply, mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { processMessage } from '../../src/llm-orchestrator.js'
import { runRegistry } from '../../src/run-control/registry.js'

describe('processMessage run lifecycle', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    runRegistry.clear()
  })
  afterEach(() => runRegistry.clear())

  test('the run is registered during the turn and removed after (every exit path cleans up)', async () => {
    const { reply, formattedCalls } = createMockReply()
    let sawRunDuringTurn = false

    // deps.processMessage path is exercised via the real processMessage; we stub generateText
    // to observe the registry mid-turn and return a normal result.
    const deps = {
      generateText: async () => {
        sawRunDuringTurn = runRegistry.get('dm-user-1') !== undefined
        return { text: 'ok', toolCalls: [], response: { messages: [] } }
      },
      stepCountIs: (n: number) => ({ kind: 'stepCount', n }),
      buildOpenAI: () => ({}),
      resolve: () => null,
      maybeAutoProvision: async () => false,
    }

    await processMessage(reply, 'dm-user-1', 'user-1', null, 'hello', 'dm', undefined, deps as any, [], 't1')

    expect(sawRunDuringTurn).toBe(true)
    expect(runRegistry.get('dm-user-1')).toBeUndefined()
  })
})
```

Note: this test depends on LLM config being resolvable in the test DB. If `resolveLlmForTurn` returns null under the bare test DB (no `system_config` LLM creds), the turn short-circuits before `callLlm`. Seed creds first using the project's existing helper for LLM config, or assert the weaker invariant that `runRegistry.get(...)` is `undefined` after the call (cleanup always holds). Prefer reading `tests/llm-orchestrator*.test.ts` for the established way to seed LLM creds and follow that exact pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/run-control/process-message-lifecycle.test.ts`
Expected: FAIL — no run is registered (cleanup assertion may pass, but `sawRunDuringTurn` is false).

- [ ] **Step 3: Edit imports in `src/llm-orchestrator.ts`**

Add near the other local imports:

```typescript
import { runRegistry } from './run-control/registry.js'
import { buildStopSummary } from './run-control/summary.js'
import { RunAbortedError } from './run-control/types.js'
```

- [ ] **Step 4: Wrap the turn body in `processMessage` (lines 255-284)**

Replace this block:

```typescript
  const startedAt = Date.now()
  try {
    const result = await callLlm({
      ...invocationSource,
      history: [...turn.baseHistory, turn.modelMessage],
      deps,
      configId,
      resolvedLlm,
      turnId: resolvedTurnId,
    })
    appendAssistantTurnHistory(
      contextId,
      configId,
      resolvedLlm.mainModel,
      turn.baseHistory,
      turn.historyMessage,
      result.response.messages,
      contextType,
    )
  } catch (error) {
    await handleLlmTurnError({
      ...invocationSource,
      mainModel: resolvedLlm.mainModel,
      startedAt,
      baseHistory: turn.baseHistory,
      error,
      turnId: resolvedTurnId,
    })
  }
}
```

with:

```typescript
  const startedAt = Date.now()
  const run = runRegistry.begin(contextId, { turnId: resolvedTurnId, reply })
  let leftover: { text: string }[] = []
  try {
    const result = await callLlm({
      ...invocationSource,
      history: [...turn.baseHistory, turn.modelMessage],
      deps,
      configId,
      resolvedLlm,
      turnId: resolvedTurnId,
    })
    appendAssistantTurnHistory(
      contextId,
      configId,
      resolvedLlm.mainModel,
      turn.baseHistory,
      turn.historyMessage,
      result.response.messages,
      contextType,
    )
    if (run.stopRequested) await reply.formatted(buildStopSummary(run.completedEffects, { forced: false }))
  } catch (error) {
    if (error instanceof RunAbortedError) {
      await reply.formatted(buildStopSummary(error.effects, { forced: true }))
    } else {
      await handleLlmTurnError({
        ...invocationSource,
        mainModel: resolvedLlm.mainModel,
        startedAt,
        baseHistory: turn.baseHistory,
        error,
        turnId: resolvedTurnId,
      })
    }
  } finally {
    leftover = runRegistry.end(contextId)
  }

  // Any steer message that never reached a step boundary becomes a fresh turn (never dropped).
  if (leftover.length > 0) {
    const text = leftover.map((m) => m.text).join('\n\n')
    await processMessage(reply, contextId, chatUserId, username, text, contextType, configContextId, deps, [], undefined)
  }
}
```

Note: the recursive `processMessage` call uses the resolved `deps` object directly (already a `LlmOrchestratorDeps`). `resolveDeps` accepts it unchanged. The leftover turn starts with a fresh 25-step budget and full history — exactly the spec's "clarification ends the run; the answer is a fresh turn."

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/run-control/process-message-lifecycle.test.ts`
Expected: PASS (run observed during turn, gone after).

- [ ] **Step 6: Run the orchestrator suite for regressions**

Run: `bun test tests/llm-orchestrator.test.ts tests/run-control/`
Expected: PASS. (If pre-existing orchestrator tests stub `callLlm`/`generateText`, the added begin/end is transparent to them.)

- [ ] **Step 7: Commit**

```bash
git add src/llm-orchestrator.ts tests/run-control/process-message-lifecycle.test.ts
git commit -m "feat(run-control): manage run lifecycle, stop summary, and leftover re-enqueue in processMessage"
```

---

## Task 7: Mid-run routing + ack in bot.ts

**Files:**

- Modify: `src/bot.ts` — `handleMessage` (lines 162-192) and imports
- Test: `tests/bot-steering.test.ts`

When a run is active for the context, a qualifying message is pushed to the steer queue with an instant ack instead of starting a new turn. By this point `shouldIgnoreGroupMessage` has already enforced the group gate (mention/reply-to-bot), so any message reaching the routing check qualifies.

- [ ] **Step 1: Write the failing test**

`tests/bot-steering.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createDmMessage, createMockReply, mockLogger, setupTestDb } from './utils/test-helpers.js'
import { setupBot } from '../src/bot.js'
import { createMockChatForBot } from './utils/test-helpers.js'
import { runRegistry } from '../src/run-control/registry.js'

describe('mid-run steering routing', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    runRegistry.clear()
  })
  afterEach(() => runRegistry.clear())

  test('a message during an active run is pushed to the steer queue with an ack and does not enqueue a turn', async () => {
    const { chat, getMessageHandler } = createMockChatForBot()
    const enqueueCalls: unknown[] = []
    setupBot(chat, 'admin-1', {
      enqueueMessage: (item) => void enqueueCalls.push(item),
    } as any)
    const handler = getMessageHandler()

    // Simulate an active run for the DM user's storage context.
    const { reply: runReply } = createMockReply()
    const run = runRegistry.begin('authorized-dm-user', {
      turnId: 't1',
      reply: runReply,
    })

    const { reply, textCalls } = createMockReply()
    await handler!({ ...createDmMessage('authorized-dm-user'), text: 'only project X' }, reply)

    expect(run.steerQueue).toEqual([{ text: 'only project X' }])
    expect(textCalls.some((c) => c.includes('folding'))).toBe(true)
    expect(enqueueCalls).toHaveLength(0)
  })
})
```

Note: adapt the context-id / auth setup to the exact helpers in `tests/bot.test.ts` (it constructs authorized DM users and the message handler). Read that file first and mirror its `createMockChatForBot` + authorized-user setup so `auth.storageContextId` equals the id you pass to `runRegistry.begin`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/bot-steering.test.ts`
Expected: FAIL — the message is enqueued, steer queue stays empty.

- [ ] **Step 3: Edit imports in `src/bot.ts`**

Add with the other local imports:

```typescript
import { runRegistry } from './run-control/registry.js'
```

- [ ] **Step 4: Insert the routing check in `handleMessage`**

Replace this block (lines 173-191):

```typescript
  if (shouldIgnoreGroupMessage(msg)) return
  const voiceStagedIds = msg.contextType === 'group' ? findVoiceStagedIds(auth.storageContextId, msg.messageId) : []
  const { newAttachmentIds, activeAttachments } = await resolveMessageAttachments(chat, msg, auth.storageContextId)
  let queueMessage = enqueueMessage
  if (deps.enqueueMessage !== undefined) queueMessage = deps.enqueueMessage
  queueMessage(
    {
      text: buildPromptWithReplyContext(msg, activeAttachments, auth.storageContextId),
      userId: msg.user.id,
      username: msg.user.username,
      storageContextId: auth.storageContextId,
      configContextId: auth.configContextId,
      contextType: msg.contextType,
      newAttachmentIds,
      voiceStagedIds,
    },
    reply,
    (coalescedItem): Promise<void> => processCoalescedMessage(coalescedItem, deps),
  )
}
```

with:

```typescript
  if (shouldIgnoreGroupMessage(msg)) return
  const voiceStagedIds = msg.contextType === 'group' ? findVoiceStagedIds(auth.storageContextId, msg.messageId) : []
  const { newAttachmentIds, activeAttachments } = await resolveMessageAttachments(chat, msg, auth.storageContextId)
  const steerText = buildPromptWithReplyContext(msg, activeAttachments, auth.storageContextId)

  const activeRun = runRegistry.get(auth.storageContextId)
  if (activeRun !== undefined) {
    activeRun.steerQueue.push({ text: steerText })
    log.debug(
      { storageContextId: auth.storageContextId, turnId: activeRun.turnId },
      'Mid-run message routed to steer queue',
    )
    await reply.text('✋ folding that into the current run…')
    return
  }

  let queueMessage = enqueueMessage
  if (deps.enqueueMessage !== undefined) queueMessage = deps.enqueueMessage
  queueMessage(
    {
      text: steerText,
      userId: msg.user.id,
      username: msg.user.username,
      storageContextId: auth.storageContextId,
      configContextId: auth.configContextId,
      contextType: msg.contextType,
      newAttachmentIds,
      voiceStagedIds,
    },
    reply,
    (coalescedItem): Promise<void> => processCoalescedMessage(coalescedItem, deps),
  )
}
```

Note (limitation to record in the spec's spirit, not a blocker): mid-run **attachments** are not forwarded into the steer turn in v1 — only `steerText` is injected. New attachments sent mid-run are ignored until the next fresh turn.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/bot-steering.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the bot suite for regressions**

Run: `bun test tests/bot.test.ts tests/bot-steering.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/bot.ts tests/bot-steering.test.ts
git commit -m "feat(run-control): route mid-run messages to the steer queue with an ack"
```

---

## Task 8: One-run-per-thread serialization in the message queue

**Files:**

- Modify: `src/message-queue/queue.ts` — `enqueue` different-user branch (lines 57-68) + extract a shared `runCoalesced`
- Test: `tests/message-queue/serialization.test.ts`

Today a different user's message in a group force-flushes and dispatches the first user's turn **fire-and-forget** (`invokeHandlerWithEvents` in `index.ts`), so two same-thread runs can overlap. Route that flush through `handlerChain` so a thread runs one turn at a time. Combined with Task 7's routing, this gives one-run-per-thread.

- [ ] **Step 1: Write the failing test**

`tests/message-queue/serialization.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createMockReply, mockLogger } from '../utils/test-helpers.js'
import { MessageQueue } from '../../src/message-queue/queue.js'
import type { QueueItem } from '../../src/message-queue/types.js'

function groupItem(userId: string, text: string): QueueItem {
  return {
    text,
    userId,
    username: userId,
    storageContextId: 'group-1:thread-1',
    configContextId: 'group-1',
    contextType: 'group',
    newAttachmentIds: [],
    voiceStagedIds: [],
  }
}

describe('MessageQueue one-run-per-thread serialization', () => {
  test('a different-user flush does not start a second handler until the first completes', async () => {
    mockLogger()
    const queue = new MessageQueue('group-1:thread-1')
    const active: string[] = []
    let maxConcurrent = 0

    queue.setHandler(async (coalesced) => {
      active.push(coalesced.userId)
      maxConcurrent = Math.max(maxConcurrent, active.length)
      await new Promise((r) => setTimeout(r, 20))
      active.pop()
    })

    const { reply } = createMockReply()
    // Alice buffers, then Bob (different user) arrives — old behavior dispatched Alice fire-and-forget.
    queue.enqueue(groupItem('alice', 'one'), reply)
    queue.enqueue(groupItem('bob', 'two'), reply)

    // Wait for the debounce + both handler runs.
    await new Promise((r) => setTimeout(r, 100))
    expect(maxConcurrent).toBe(1)
  })
})
```

Note: this is one of the few timing tests; keep the bound generous (100 ms) and assert only `maxConcurrent === 1`. Do not assert exact ordering of `turn:end` events.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-queue/serialization.test.ts`
Expected: FAIL — `maxConcurrent` is 2 (Alice runs concurrently with Bob).

- [ ] **Step 3: Extract a shared handler runner in `queue.ts`**

Replace `flushAndHandle` (lines 107-145) with a thin wrapper over a new `runCoalesced`:

```typescript
  private async flushAndHandle(): Promise<void> {
    const result = this.flush()
    if (result !== null) await this.runCoalesced(result)
  }

  private async runCoalesced(result: CoalescedItem): Promise<void> {
    if (this.handler === null) return
    const startTime = Date.now()
    try {
      await this.handler(result)
      this.emitScoped(
        'turn:end',
        result.userId,
        { turnId: result.turnId, status: 'ok', duration: Date.now() - startTime },
        result.turnId,
        result.contextType,
      )
    } catch (error) {
      log.error(
        {
          storageContextId: this.storageContextId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Handler error during flush',
      )
      this.emitScoped(
        'turn:end',
        result.userId,
        {
          turnId: result.turnId,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        },
        result.turnId,
        result.contextType,
      )
    }
  }
```

- [ ] **Step 4: Chain the different-user flush instead of returning it for fire-and-forget**

Replace the different-user branch in `enqueue` (lines 57-68):

```typescript
if (isGroup && hasBufferedItems && isDifferentUser) {
  const flushed = this.forceFlush()
  this.messages.push({ item, reply })
  this.lastUserId = item.userId
  this.emitScoped('queue:enqueue', item.userId, {
    storageContextId: this.storageContextId,
    userId: item.userId,
    bufferedCount: this.messages.length,
  })
  this.resetTimer()
  return flushed
}
```

with:

```typescript
if (isGroup && hasBufferedItems && isDifferentUser) {
  const flushed = this.forceFlush()
  if (flushed !== null) {
    // Serialize: run the previous user's turn on the handler chain rather than
    // concurrently, so a thread runs one turn at a time (one-run-per-thread).
    this.handlerChain = this.handlerChain.then(() => this.runCoalesced(flushed))
  }
  this.messages.push({ item, reply })
  this.lastUserId = item.userId
  this.emitScoped('queue:enqueue', item.userId, {
    storageContextId: this.storageContextId,
    userId: item.userId,
    bufferedCount: this.messages.length,
  })
  this.resetTimer()
  return null
}
```

Because `enqueue` now returns `null` here, `index.ts`'s `if (coalesced !== null) invokeHandlerWithEvents(...)` branch (line 130) is no longer taken for this path — the chained run already emits `turn:end`. Leave `index.ts` as-is; the branch is dead but harmless.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/message-queue/serialization.test.ts`
Expected: PASS (`maxConcurrent === 1`).

- [ ] **Step 6: Run the full message-queue suite and reconcile old assertions**

Run: `bun test tests/message-queue/`
Expected: PASS. **If a pre-existing test asserted concurrent different-user dispatch** (e.g. that both handlers were "in flight" together, or that `enqueue` returns the flushed item), update it to assert serialization (`maxConcurrent === 1`, or `enqueue` returns `null` for the different-user branch). Read each failing assertion and change it to encode the new one-run-per-thread contract; do not weaken it to vacuous.

- [ ] **Step 7: Commit**

```bash
git add src/message-queue/queue.ts tests/message-queue/serialization.test.ts
git commit -m "feat(message-queue): serialize different-user group flush for one-run-per-thread"
```

---

## Task 9: `/stop` command

**Files:**

- Create: `src/commands/stop.ts`
- Modify: `src/bot.ts` (`registerCommands`, line 122-131) + import; `src/commands/help.ts`
- Test: `tests/commands/stop.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/commands/stop.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createAuth, createDmMessage, createMockReply, mockLogger } from '../utils/test-helpers.js'
import { registerStopCommand } from '../../src/commands/stop.js'
import { runRegistry } from '../../src/run-control/registry.js'
import type { CommandHandler } from '../../src/chat/types.js'

function capture(): { handler: CommandHandler; register: any } {
  let handler: CommandHandler | undefined
  const register = {
    registerCommand: (_name: string, h: CommandHandler) => void (handler = h),
  }
  return {
    get handler() {
      return handler!
    },
    register,
  } as any
}

describe('/stop command', () => {
  beforeEach(() => {
    mockLogger()
    runRegistry.clear()
  })
  afterEach(() => runRegistry.clear())

  test('no active run: replies that nothing is running', async () => {
    const c = capture()
    registerStopCommand(c.register as any)
    const { reply, textCalls } = createMockReply()
    await c.handler(createDmMessage('user-1'), reply, createAuth({ storageContextId: 'user-1' }))
    expect(textCalls.some((t) => /nothing is running/i.test(t))).toBe(true)
  })

  test('first /stop on an active run sets stopRequested and acks winding down', async () => {
    const c = capture()
    registerStopCommand(c.register as any)
    const run = runRegistry.begin('user-1', {
      turnId: 't1',
      reply: createMockReply().reply,
    })
    const { reply, textCalls } = createMockReply()
    await c.handler(createDmMessage('user-1'), reply, createAuth({ storageContextId: 'user-1' }))
    expect(run.stopRequested).toBe(true)
    expect(run.abortController.signal.aborted).toBe(false)
    expect(textCalls.some((t) => /winding down/i.test(t))).toBe(true)
  })

  test('second /stop while stopping force-aborts', async () => {
    const c = capture()
    registerStopCommand(c.register as any)
    const run = runRegistry.begin('user-1', {
      turnId: 't1',
      reply: createMockReply().reply,
    })
    run.stopRequested = true
    const { reply, textCalls } = createMockReply()
    await c.handler(createDmMessage('user-1'), reply, createAuth({ storageContextId: 'user-1' }))
    expect(run.abortController.signal.aborted).toBe(true)
    expect(textCalls.some((t) => /immediately/i.test(t))).toBe(true)
  })

  test('unauthorized user is rejected without touching the run', async () => {
    const c = capture()
    registerStopCommand(c.register as any)
    const run = runRegistry.begin('user-1', {
      turnId: 't1',
      reply: createMockReply().reply,
    })
    const { reply, textCalls } = createMockReply()
    await c.handler(createDmMessage('user-1'), reply, createAuth({ storageContextId: 'user-1', allowed: false }))
    expect(run.stopRequested).toBe(false)
    expect(textCalls).toHaveLength(0)
  })
})
```

Note: confirm `createAuth` accepts `{ storageContextId, allowed }` overrides (read `tests/utils/test-helpers.ts`); if the option names differ, mirror the exact helper signature.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/commands/stop.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/commands/stop.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { logger } from '../logger.js'
import { runRegistry } from '../run-control/registry.js'

const log = logger.child({ scope: 'commands:stop' })

export function registerStopCommand(chat: Readonly<ChatProvider>): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return

    const run = runRegistry.get(auth.storageContextId)
    if (run === undefined) {
      await reply.text('Nothing is running right now.')
      return
    }

    if (run.stopRequested) {
      run.abortController.abort()
      log.info(
        {
          storageContextId: auth.storageContextId,
          turnId: run.turnId,
          userId: msg.user.id,
        },
        '/stop force-abort',
      )
      await reply.text('🛑 Stopping immediately…')
      return
    }

    run.stopRequested = true
    log.info(
      {
        storageContextId: auth.storageContextId,
        turnId: run.turnId,
        userId: msg.user.id,
      },
      '/stop graceful',
    )
    await reply.text('🛑 winding down after this step…')
  }

  chat.registerCommand('stop', handler)
}
```

- [ ] **Step 4: Register `/stop` in `src/bot.ts`**

Add the import with the other command imports:

```typescript
import { registerStopCommand } from './commands/stop.js'
```

In `registerCommands` (line 122-131), add after `registerDashboardCommand(observedChat)`:

```typescript
registerStopCommand(observedChat)
```

- [ ] **Step 5: List `/stop` in help**

In `src/commands/help.ts`, add a line describing `/stop` to the help text (read the file's existing command list — lines ~12-20 — and add `/stop` with: "Stop or steer the running task. Send `/stop` to halt gracefully; send it again to stop immediately."). Match the surrounding formatting exactly.

- [ ] **Step 6: Run tests + the command/help suites**

Run: `bun test tests/commands/stop.test.ts tests/commands/help.test.ts`
Expected: PASS. (If `help.test.ts` snapshots the command list, update the expected text to include `/stop`.)

- [ ] **Step 7: Commit**

```bash
git add src/commands/stop.ts src/bot.ts src/commands/help.ts tests/commands/stop.test.ts
git commit -m "feat(commands): add /stop command with graceful and force-abort escalation"
```

---

## Task 10: System-prompt steering fragment

**Files:**

- Modify: `src/system-prompt.ts` — `assembleSystemPrompt` (line 183-214)
- Test: `tests/system-prompt.test.ts` (add a case)

- [ ] **Step 1: Write the failing test**

Add to `tests/system-prompt.test.ts` (read the file and follow its existing pattern for calling `buildProviderlessSystemPrompt`/`buildSystemPrompt`):

```typescript
import { describe, expect, test } from 'bun:test'

import { buildProviderlessSystemPrompt } from '../src/system-prompt.js'

describe('system prompt steering fragment', () => {
  test('includes the mid-run instruction guidance', () => {
    const prompt = buildProviderlessSystemPrompt('user-1', new Set<string>(), {
      askPermissionAvailable: true,
      contextType: 'dm',
    })
    expect(prompt).toContain('mid-run instruction')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/system-prompt.test.ts`
Expected: FAIL — the phrase is absent.

- [ ] **Step 3: Add the fragment constant and push it**

In `src/system-prompt.ts`, add a module-level constant near the other fragment text constants:

```typescript
const STEERING_FRAGMENT =
  'STEERING: A mid-run instruction from the user may arrive between your tool steps. ' +
  'Fold an unambiguous correction into your current work and continue. If the user asks you to stop ' +
  '("stop", "never mind"), wind down promptly and report what you have already done. ' +
  'Ask a brief clarifying question only if you genuinely cannot proceed.'
```

In `assembleSystemPrompt`, add the fragment to `parts` right after the disclosure fragment push (line 191), so it is always present:

```typescript
const parts: string[] = [intro]
if (options.progressiveDisclosure === true) parts.push(buildDisclosureFragment(enabledToolNames))
parts.push(STEERING_FRAGMENT)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/system-prompt.test.ts`
Expected: PASS. (If other prompt snapshot tests exist and compare exact text, update their expected strings to include the new fragment.)

- [ ] **Step 5: Commit**

```bash
git add src/system-prompt.ts tests/system-prompt.test.ts
git commit -m "feat(system-prompt): add mid-run steering guidance fragment"
```

---

## Task 11: Full verification + docs

**Files:**

- Modify: `CLAUDE.md`, `src/commands/CLAUDE.md` (document `/stop` and steering)
- No new logic

- [ ] **Step 1: Run the full server-side suite**

Run: `bun run test`
Expected: PASS. Investigate and fix any regression (do not skip tests).

- [ ] **Step 2: Lint, typecheck, format**

Run: `bun run lint && bun run typecheck && bun run format`
Expected: 0 errors. Fix the underlying issue for any `max-lines`/`max-lines-per-function` (split a file/extract a function — never delete blank lines).

- [ ] **Step 3: Mutation-test the control-flow modules**

Run: `bun test:mutate:file src/run-control/summary.ts src/run-control/steering-prepare-step.ts src/run-control/stop-condition.ts src/run-control/registry.ts`
Expected: surviving mutants reviewed; add tests where a mutant reveals a coverage gap (e.g. the count-vs-singular branch in the summary, the empty-queue early return).

- [ ] **Step 4: Update docs**

- In `CLAUDE.md`, add a bullet under "Notable non-obvious behaviors" describing mid-run steering + `/stop` (steer-with-ack default; one-run-per-thread; `/stop` graceful → force-abort; no buttons).
- In `src/commands/CLAUDE.md`, add `/stop` to the "Current Command Behavior" list.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md src/commands/CLAUDE.md
git commit -m "docs: document agent interruption and steering"
```

---

## Self-Review (completed during authoring)

**Spec coverage:**

- UX contract (unified injection, steer-with-ack) → Tasks 3, 6, 10.
- Three-rung stop ladder: soft (typed) → model via fragment (Task 10) + injection (Tasks 3/6); hard `/stop` → `stopRequested`/`stopWhen` (Tasks 4, 5, 9); force-abort → `AbortSignal` (Tasks 5, 9).
- Code-generated acks + partial-state summary → Tasks 2, 6, 9.
- One-run-per-thread, no owner, any-member steer → Tasks 7 (routing), 8 (serialization).
- `/stop` on all platforms, no buttons → Task 9.
- Graceful-at-boundary + leftover re-enqueue + cleanup-in-finally → Tasks 5, 6.
- Abort-vs-real-error distinction → Task 5.
- Proactive exclusion → automatic (no `begin` in proactive path); Task 5's "no active run" test is the regression guard.

**Type consistency:** `RunControl`, `InjectedMessage`, `EffectRecord`, `RunAbortedError` defined in Task 1 and used identically in Tasks 2-9. `runRegistry` singleton imported the same way everywhere. `composePrepareSteps`/`createSteeringPrepareStep`/`createStopRequestedCondition` signatures match between definition (Tasks 3-4) and use (Task 5). `buildStopSummary(effects, { forced })` matches between Task 2 and Task 6.

**Placeholders:** none. Where a test must align with existing helpers (LLM-cred seeding in Task 6, authorized-user setup in Tasks 7-9, snapshot updates in Tasks 9-10), the step names the exact file to mirror and the exact assertion to encode — these are alignment instructions, not "figure it out" placeholders.

**Known v1 limitations (documented, not gaps):** mid-run attachments are not forwarded into the steer turn (Task 7 note); `EffectRecord` captures `toolName` only — richer per-entity detail (e.g. specific task IDs) can be layered onto the summary later without interface changes.

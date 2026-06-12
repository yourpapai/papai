<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Prompt Regression Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 0 of the prompt optimization roadmap: a deterministic, layered prompt regression harness with assembly fixtures and scripted orchestrator trace fixtures.

**Architecture:** Add a test-only harness under `tests/prompt-regression/`. Assembly fixtures validate prompt/context/tool assembly; trace fixtures validate scripted orchestrator behavior with fake model/tool traces. The harness introduces no runtime behavior changes and uses TypeScript fixtures with explicit pending metadata for known future-phase gaps.

**Tech Stack:** Bun test runner, TypeScript, existing papai test helpers, Vercel AI SDK types via existing orchestrator dependencies.

---

## Scope

This plan implements `docs/superpowers/specs/2026-06-12-prompt-regression-harness-design.md`.

It must not change:

- production prompt wording
- tool result envelopes
- confirmation behavior
- permission behavior
- orchestration behavior
- tool-context reduction flag state

## File Structure

Create:

- `tests/prompt-regression/harness/fixture-types.ts`
  Shared fixture interfaces, pending metadata validation, and fixture result types.
- `tests/prompt-regression/harness/fixture-loader.ts`
  Loads fixture arrays from TypeScript modules, partitions runnable and pending fixtures, validates metadata.
- `tests/prompt-regression/harness/assertions.ts`
  Small assertion helpers for `mustContain`, `mustNotContain`, exact arrays, and pending metadata.
- `tests/prompt-regression/harness/context-builders.ts`
  Test-only builders for deterministic provider/context/tool preference setup.
- `tests/prompt-regression/harness/assembly-runner.ts`
  Runs assembly fixtures against `buildSystemPrompt`, `buildProviderlessSystemPrompt`, and enabled tool names.
- `tests/prompt-regression/harness/scripted-model.ts`
  Small fake `generateText` helper for trace tests.
- `tests/prompt-regression/harness/trace-runner.ts`
  Runs trace fixtures through scripted steps and classification assertions.
- `tests/prompt-regression/fixtures/assembly/baseline.fixture.ts`
  Initial runnable and pending assembly fixtures.
- `tests/prompt-regression/fixtures/trace/baseline.fixture.ts`
  Initial runnable and pending trace fixtures.
- `tests/prompt-regression/assembly.test.ts`
  Bun test entrypoint for assembly fixtures.
- `tests/prompt-regression/trace.test.ts`
  Bun test entrypoint for trace fixtures.
- `tests/prompt-regression/harness/fixture-loader.test.ts`
  Unit tests for pending metadata validation and fixture partitioning.
- `tests/prompt-regression/harness/assertions.test.ts`
  Unit tests for shared assertion helpers.
- `tests/prompt-regression/harness/scripted-model.test.ts`
  Unit tests for trace scripting.

Modify only if the implementation proves it necessary:

- `src/system-prompt.ts`
  Add a small export only if a prompt sub-builder must be tested directly. Prefer not to modify this file in Phase 0.
- `src/llm-orchestrator-invoke.ts`
  Add a small export only if trace behavior cannot be tested through current dependency injection. Prefer not to modify this file in Phase 0.

## Task 1: Fixture Types, Assertions, And Loader

**Files:**

- Create: `tests/prompt-regression/harness/fixture-types.ts`
- Create: `tests/prompt-regression/harness/assertions.ts`
- Create: `tests/prompt-regression/harness/fixture-loader.ts`
- Test: `tests/prompt-regression/harness/assertions.test.ts`
- Test: `tests/prompt-regression/harness/fixture-loader.test.ts`

- [ ] **Step 1: Write failing assertion helper tests**

Create `tests/prompt-regression/harness/assertions.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { assertContainsAll, assertContainsNone, normalizePromptText } from './assertions.js'

describe('prompt regression assertions', () => {
  test('normalizePromptText trims trailing spaces and collapses repeated blank lines', () => {
    const input = 'A  \\n\\n\\nB\\n'

    expect(normalizePromptText(input)).toBe('A\\n\\nB')
  })

  test('assertContainsAll reports missing required text', () => {
    expect(() => assertContainsAll('hello world', ['hello', 'missing'])).toThrow('Expected text to contain "missing"')
  })

  test('assertContainsNone reports forbidden text', () => {
    expect(() => assertContainsNone('hello secret world', ['secret'])).toThrow('Expected text not to contain "secret"')
  })
})
```

- [ ] **Step 2: Write failing fixture loader tests**

Create `tests/prompt-regression/harness/fixture-loader.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { partitionFixtures, validateFixtureMeta } from './fixture-loader.js'
import type { AssemblyFixture } from './fixture-types.js'

const runnableFixture: AssemblyFixture = {
  kind: 'assembly',
  meta: {
    id: 'assembly-runnable',
    description: 'Runnable fixture',
    ownerArea: 'prompt',
    roadmapPhase: 'phase-0',
  },
  setup: { contextType: 'dm', provider: 'kaneo' },
  expected: {},
}

const pendingFixture: AssemblyFixture = {
  kind: 'assembly',
  meta: {
    id: 'assembly-pending',
    description: 'Pending fixture',
    ownerArea: 'safety',
    roadmapPhase: 'phase-0',
    pending: {
      reason: 'Current prompt does not yet isolate this untrusted content channel.',
      expectedFixPhase: 'phase-3',
      unskipWhen: 'Safety Boundary Spec introduces trust-boundary rendering.',
    },
  },
  setup: { contextType: 'dm', provider: 'kaneo' },
  expected: {},
}

describe('validateFixtureMeta', () => {
  test('accepts runnable fixture metadata', () => {
    expect(() => validateFixtureMeta(runnableFixture.meta)).not.toThrow()
  })

  test('accepts pending fixture metadata with reason, phase, and unskip condition', () => {
    expect(() => validateFixtureMeta(pendingFixture.meta)).not.toThrow()
  })

  test('rejects pending metadata with an empty reason', () => {
    expect(() =>
      validateFixtureMeta({
        ...pendingFixture.meta,
        pending: { ...pendingFixture.meta.pending!, reason: '' },
      }),
    ).toThrow('Pending fixture assembly-pending must include a reason')
  })
})

describe('partitionFixtures', () => {
  test('partitions runnable and pending fixtures', () => {
    const result = partitionFixtures([runnableFixture, pendingFixture])

    expect(result.runnable.map((f) => f.meta.id)).toEqual(['assembly-runnable'])
    expect(result.pending.map((f) => f.meta.id)).toEqual(['assembly-pending'])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
bun test tests/prompt-regression/harness/assertions.test.ts tests/prompt-regression/harness/fixture-loader.test.ts
```

Expected: FAIL with module resolution errors for `./assertions.js`, `./fixture-loader.js`, and `./fixture-types.js`.

- [ ] **Step 4: Implement fixture types**

Create `tests/prompt-regression/harness/fixture-types.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type PromptRegressionOwnerArea =
  | 'prompt'
  | 'context'
  | 'tools'
  | 'orchestration'
  | 'safety'
  | 'tool-context-reduction'

export type PromptRegressionPhase = 'phase-0' | 'phase-1' | 'phase-2' | 'phase-3' | 'phase-4' | 'phase-5'

export interface PromptRegressionFixtureMeta {
  readonly id: string
  readonly description: string
  readonly ownerArea: PromptRegressionOwnerArea
  readonly roadmapPhase: PromptRegressionPhase
  readonly pending?: {
    readonly reason: string
    readonly expectedFixPhase: Exclude<PromptRegressionPhase, 'phase-0'>
    readonly unskipWhen: string
  }
}

export type PromptRegressionContextType = 'dm' | 'group' | 'proactive' | 'providerless'
export type PromptRegressionProvider = 'kaneo' | 'youtrack' | 'providerless'

export interface PromptRegressionSetup {
  readonly contextType: PromptRegressionContextType
  readonly provider: PromptRegressionProvider
  readonly contextId?: string
  readonly chatUserId?: string
  readonly enabledTools?: readonly string[]
  readonly deniedTools?: readonly string[]
  readonly askTools?: readonly string[]
  readonly memory?: 'none' | 'compacted' | 'long-term' | 'compacted-and-long-term' | 'stale'
  readonly flags?: Readonly<Record<string, boolean>>
}

export interface PromptTextExpectations {
  readonly sectionOrder?: readonly string[]
  readonly mustContain?: readonly string[]
  readonly mustNotContain?: readonly string[]
}

export interface ToolExpectations {
  readonly include?: readonly string[]
  readonly exclude?: readonly string[]
}

export interface AssemblyFixture {
  readonly kind: 'assembly'
  readonly meta: PromptRegressionFixtureMeta
  readonly setup: PromptRegressionSetup
  readonly expected: {
    readonly prompt?: PromptTextExpectations
    readonly tools?: ToolExpectations
  }
}

export type TraceFinalClassification =
  | 'completes_action'
  | 'asks_clarification'
  | 'asks_confirmation'
  | 'declines_unsafe_action'
  | 'reports_retryable_failure'
  | 'reports_non_retryable_failure'
  | 'requests_permission'
  | 'answers_without_tools'

export type TraceScriptStep =
  | { readonly type: 'assistant_text'; readonly text: string }
  | {
      readonly type: 'tool_call'
      readonly toolName: string
      readonly toolCallId: string
      readonly input: unknown
      readonly output?: unknown
      readonly error?: string
    }

export interface TraceFixture {
  readonly kind: 'trace'
  readonly meta: PromptRegressionFixtureMeta
  readonly setup: PromptRegressionSetup
  readonly script: readonly TraceScriptStep[]
  readonly expected: {
    readonly toolCalls?: readonly string[]
    readonly forbiddenToolCalls?: readonly string[]
    readonly finalClassification: TraceFinalClassification
    readonly finalReplyMustContain?: readonly string[]
  }
}

export type PromptRegressionFixture = AssemblyFixture | TraceFixture
```

- [ ] **Step 5: Implement assertion helpers**

Create `tests/prompt-regression/harness/assertions.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function normalizePromptText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function assertContainsAll(text: string, expected: readonly string[] = []): void {
  for (const needle of expected) {
    if (!text.includes(needle)) throw new Error(`Expected text to contain "${needle}"`)
  }
}

export function assertContainsNone(text: string, forbidden: readonly string[] = []): void {
  for (const needle of forbidden) {
    if (text.includes(needle)) throw new Error(`Expected text not to contain "${needle}"`)
  }
}

export function assertExactArray(label: string, actual: readonly string[], expected: readonly string[]): void {
  const actualJson = JSON.stringify([...actual])
  const expectedJson = JSON.stringify([...expected])
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${label} ${expectedJson}, received ${actualJson}`)
  }
}
```

- [ ] **Step 6: Implement fixture loader**

Create `tests/prompt-regression/harness/fixture-loader.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PromptRegressionFixture, PromptRegressionFixtureMeta } from './fixture-types.js'

export interface FixturePartition<T extends PromptRegressionFixture> {
  readonly runnable: readonly T[]
  readonly pending: readonly T[]
}

export function validateFixtureMeta(meta: PromptRegressionFixtureMeta): void {
  if (meta.id.trim() === '') throw new Error('Fixture id must not be empty')
  if (meta.description.trim() === '') throw new Error(`Fixture ${meta.id} must include a description`)
  if (meta.pending === undefined) return
  if (meta.pending.reason.trim() === '') throw new Error(`Pending fixture ${meta.id} must include a reason`)
  if (meta.pending.unskipWhen.trim() === '') {
    throw new Error(`Pending fixture ${meta.id} must include an unskip condition`)
  }
}

export function partitionFixtures<T extends PromptRegressionFixture>(fixtures: readonly T[]): FixturePartition<T> {
  const runnable: T[] = []
  const pending: T[] = []

  for (const fixture of fixtures) {
    validateFixtureMeta(fixture.meta)
    if (fixture.meta.pending === undefined) runnable.push(fixture)
    else pending.push(fixture)
  }

  return { runnable, pending }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
bun test tests/prompt-regression/harness/assertions.test.ts tests/prompt-regression/harness/fixture-loader.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tests/prompt-regression/harness/assertions.test.ts \
  tests/prompt-regression/harness/fixture-loader.test.ts \
  tests/prompt-regression/harness/fixture-types.ts \
  tests/prompt-regression/harness/assertions.ts \
  tests/prompt-regression/harness/fixture-loader.ts
git commit -m "test: add prompt regression fixture foundations"
```

## Task 2: Assembly Harness And Baseline Fixtures

**Files:**

- Create: `tests/prompt-regression/harness/context-builders.ts`
- Create: `tests/prompt-regression/harness/assembly-runner.ts`
- Create: `tests/prompt-regression/fixtures/assembly/baseline.fixture.ts`
- Create: `tests/prompt-regression/assembly.test.ts`

- [ ] **Step 1: Write the failing assembly test entrypoint**

Create `tests/prompt-regression/assembly.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { runAssemblyFixture } from './harness/assembly-runner.js'
import { partitionFixtures } from './harness/fixture-loader.js'
import { assemblyFixtures } from './fixtures/assembly/baseline.fixture.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('prompt regression assembly fixtures', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  const { runnable, pending } = partitionFixtures(assemblyFixtures)

  for (const fixture of runnable) {
    test(fixture.meta.id, () => {
      expect(() => runAssemblyFixture(fixture)).not.toThrow()
    })
  }

  test('pending assembly fixtures are documented', () => {
    expect(pending.map((fixture) => fixture.meta.id)).toContain('assembly-tool-context-reduction-flags-on')
  })
})
```

- [ ] **Step 2: Write the initial assembly fixtures**

Create `tests/prompt-regression/fixtures/assembly/baseline.fixture.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AssemblyFixture } from '../../harness/fixture-types.js'

export const assemblyFixtures: readonly AssemblyFixture[] = [
  {
    kind: 'assembly',
    meta: {
      id: 'assembly-dm-kaneo-normal-tools',
      description: 'DM with task provider includes core workflow and task guidance.',
      ownerArea: 'prompt',
      roadmapPhase: 'phase-0',
    },
    setup: {
      contextType: 'dm',
      provider: 'kaneo',
      enabledTools: ['create_task', 'update_task', 'web_fetch', 'save_instruction', 'delete_task'],
    },
    expected: {
      prompt: {
        mustContain: ['You are papai', '<current_time>', 'WORKFLOW:', 'DUE DATES', 'WEB FETCH'],
        mustNotContain: ['task tracker tools are unavailable'],
      },
      tools: {
        include: ['create_task', 'update_task', 'web_fetch'],
        exclude: ['delete_project'],
      },
    },
  },
  {
    kind: 'assembly',
    meta: {
      id: 'assembly-providerless-dm',
      description: 'Providerless DM explains that task tracker tools are unavailable.',
      ownerArea: 'prompt',
      roadmapPhase: 'phase-0',
    },
    setup: {
      contextType: 'providerless',
      provider: 'providerless',
      enabledTools: ['web_fetch', 'get_current_time'],
    },
    expected: {
      prompt: {
        mustContain: ['task tracker tools are unavailable', 'must not pretend', '/config'],
        mustNotContain: ['create_task', 'update_task'],
      },
      tools: { include: ['web_fetch', 'get_current_time'], exclude: ['create_task'] },
    },
  },
  {
    kind: 'assembly',
    meta: {
      id: 'assembly-ask-gated-tool-preference',
      description: 'Ask-gated tools are listed with _permission_reason requirements.',
      ownerArea: 'prompt',
      roadmapPhase: 'phase-0',
    },
    setup: {
      contextType: 'dm',
      provider: 'kaneo',
      enabledTools: ['delete_task', 'ask_permission'],
      askTools: ['delete_task'],
    },
    expected: {
      prompt: {
        mustContain: ['Some tools require user permission', '_permission_reason', 'delete_task'],
      },
      tools: { include: ['delete_task'], exclude: [] },
    },
  },
  {
    kind: 'assembly',
    meta: {
      id: 'assembly-memory-trust-labels',
      description: 'Memory setup expects low-trust compact and long-term memory labels.',
      ownerArea: 'context',
      roadmapPhase: 'phase-0',
    },
    setup: {
      contextType: 'dm',
      provider: 'kaneo',
      enabledTools: ['create_task'],
      memory: 'compacted-and-long-term',
    },
    expected: {
      prompt: {
        mustContain: ['You are papai'],
      },
    },
  },
  {
    kind: 'assembly',
    meta: {
      id: 'assembly-tool-context-reduction-flags-on',
      description: 'Tool-context reduction flag-on prompt compatibility is tracked for later graduation.',
      ownerArea: 'tool-context-reduction',
      roadmapPhase: 'phase-0',
      pending: {
        reason: 'Flag-on disclosure behavior is already merged but needs dedicated graduation fixtures.',
        expectedFixPhase: 'phase-4',
        unskipWhen: 'Tool-Context Reduction Graduation Spec defines flag-on fixture assertions.',
      },
    },
    setup: {
      contextType: 'dm',
      provider: 'kaneo',
      enabledTools: ['search_tools', 'load_tool', 'expand_result'],
      flags: { progressive_disclosure: true, result_compaction: true, semantic_tool_retrieval: true },
    },
    expected: {},
  },
]
```

- [ ] **Step 3: Run assembly test to verify it fails**

Run:

```bash
bun test tests/prompt-regression/assembly.test.ts
```

Expected: FAIL with module resolution errors for `assembly-runner.js` and `context-builders.js`.

- [ ] **Step 4: Implement context builders**

Create `tests/prompt-regression/harness/context-builders.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskProvider } from '../../../src/providers/types.js'
import { setToolPrefs, type ToolPrefs } from '../../../src/tools/tool-preferences.js'
import { createMockProvider } from '../../tools/mock-provider.js'
import type { PromptRegressionSetup } from './fixture-types.js'

export interface BuiltPromptRegressionContext {
  readonly contextId: string
  readonly chatUserId: string
  readonly provider: TaskProvider | null
  readonly enabledToolNames: ReadonlySet<string>
}

function buildToolPrefs(setup: PromptRegressionSetup): ToolPrefs {
  const toolOverrides: Record<string, 'allow' | 'deny' | 'ask'> = {}
  for (const name of setup.deniedTools ?? []) toolOverrides[name] = 'deny'
  for (const name of setup.askTools ?? []) toolOverrides[name] = 'ask'
  return { domainDefaults: {}, toolOverrides }
}

export function buildPromptRegressionContext(setup: PromptRegressionSetup): BuiltPromptRegressionContext {
  const contextId = setup.contextId ?? `ctx-${setup.contextType}-${setup.provider}`
  const chatUserId = setup.chatUserId ?? 'user-prompt-regression'
  const provider = setup.provider === 'providerless' ? null : createMockProvider()
  const enabledToolNames = new Set(setup.enabledTools ?? ['get_current_time'])

  const prefs = buildToolPrefs(setup)
  if (Object.keys(prefs.toolOverrides).length > 0) setToolPrefs(contextId, prefs)

  return { contextId, chatUserId, provider, enabledToolNames }
}
```

- [ ] **Step 5: Implement assembly runner**

Create `tests/prompt-regression/harness/assembly-runner.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildProviderlessSystemPrompt, buildSystemPrompt } from '../../../src/system-prompt.js'
import { assertContainsAll, assertContainsNone, normalizePromptText } from './assertions.js'
import { buildPromptRegressionContext } from './context-builders.js'
import type { AssemblyFixture } from './fixture-types.js'

export interface AssemblyFixtureResult {
  readonly prompt: string
  readonly enabledToolNames: readonly string[]
}

export function evaluateAssemblyFixture(fixture: AssemblyFixture): AssemblyFixtureResult {
  const ctx = buildPromptRegressionContext(fixture.setup)
  const prompt =
    ctx.provider === null
      ? buildProviderlessSystemPrompt(ctx.contextId, ctx.enabledToolNames, { askPermissionAvailable: true })
      : buildSystemPrompt(ctx.provider, ctx.contextId, ctx.enabledToolNames, { askPermissionAvailable: true })

  return {
    prompt: normalizePromptText(prompt),
    enabledToolNames: [...ctx.enabledToolNames].toSorted(),
  }
}

export function runAssemblyFixture(fixture: AssemblyFixture): AssemblyFixtureResult {
  const result = evaluateAssemblyFixture(fixture)
  const expectedPrompt = fixture.expected.prompt
  const expectedTools = fixture.expected.tools

  assertContainsAll(result.prompt, expectedPrompt?.mustContain)
  assertContainsNone(result.prompt, expectedPrompt?.mustNotContain)

  for (const name of expectedTools?.include ?? []) {
    if (!result.enabledToolNames.includes(name)) throw new Error(`Expected active tool ${name}`)
  }
  for (const name of expectedTools?.exclude ?? []) {
    if (result.enabledToolNames.includes(name)) throw new Error(`Expected inactive tool ${name}`)
  }

  return result
}
```

- [ ] **Step 6: Run assembly fixtures**

Run:

```bash
bun test tests/prompt-regression/assembly.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/prompt-regression/assembly.test.ts \
  tests/prompt-regression/fixtures/assembly/baseline.fixture.ts \
  tests/prompt-regression/harness/context-builders.ts \
  tests/prompt-regression/harness/assembly-runner.ts
git commit -m "test: add prompt assembly regression fixtures"
```

## Task 3: Scripted Trace Harness

**Files:**

- Create: `tests/prompt-regression/harness/scripted-model.ts`
- Create: `tests/prompt-regression/harness/scripted-model.test.ts`
- Create: `tests/prompt-regression/harness/trace-runner.ts`

- [ ] **Step 1: Write failing scripted model tests**

Create `tests/prompt-regression/harness/scripted-model.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildScriptedTrace, classifyFinalReply } from './scripted-model.js'
import type { TraceScriptStep } from './fixture-types.js'

describe('buildScriptedTrace', () => {
  test('extracts tool call sequence and final assistant text', () => {
    const script: readonly TraceScriptStep[] = [
      {
        type: 'tool_call',
        toolName: 'create_task',
        toolCallId: 'call-1',
        input: { title: 'Ship it' },
        output: { id: 't1' },
      },
      { type: 'assistant_text', text: 'Created [Ship it](https://example.test/t1).' },
    ]

    const trace = buildScriptedTrace(script)

    expect(trace.toolCalls.map((call) => call.toolName)).toEqual(['create_task'])
    expect(trace.finalText).toBe('Created [Ship it](https://example.test/t1).')
  })
})

describe('classifyFinalReply', () => {
  test('classifies clarification questions', () => {
    expect(classifyFinalReply('I found two matching tasks. Which one?')).toBe('asks_clarification')
  })

  test('classifies confirmation questions', () => {
    expect(classifyFinalReply('Delete "Auth bug"? This is permanent.')).toBe('asks_confirmation')
  })
})
```

- [ ] **Step 2: Run scripted model tests to verify they fail**

Run:

```bash
bun test tests/prompt-regression/harness/scripted-model.test.ts
```

Expected: FAIL with module resolution error for `./scripted-model.js`.

- [ ] **Step 3: Implement scripted model helper**

Create `tests/prompt-regression/harness/scripted-model.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TraceFinalClassification, TraceScriptStep } from './fixture-types.js'

export interface ScriptedToolCall {
  readonly toolName: string
  readonly toolCallId: string
  readonly input: unknown
  readonly output?: unknown
  readonly error?: string
}

export interface ScriptedTrace {
  readonly toolCalls: readonly ScriptedToolCall[]
  readonly finalText: string
}

export function buildScriptedTrace(script: readonly TraceScriptStep[]): ScriptedTrace {
  const toolCalls: ScriptedToolCall[] = []
  let finalText = ''

  for (const step of script) {
    if (step.type === 'assistant_text') {
      finalText = step.text
    } else {
      toolCalls.push({
        toolName: step.toolName,
        toolCallId: step.toolCallId,
        input: step.input,
        output: step.output,
        error: step.error,
      })
    }
  }

  return { toolCalls, finalText }
}

export function classifyFinalReply(text: string): TraceFinalClassification {
  const lower = text.toLowerCase()
  if (lower.includes('which one') || lower.includes('which task')) return 'asks_clarification'
  if (lower.includes('delete') && lower.includes('?')) return 'asks_confirmation'
  if (lower.includes('permission')) return 'requests_permission'
  if (lower.includes('try again') || lower.includes('rate-limiting')) return 'reports_retryable_failure'
  if (lower.includes('cannot') || lower.includes('not configured')) return 'reports_non_retryable_failure'
  if (lower.includes('unsafe') || lower.includes('cannot do that')) return 'declines_unsafe_action'
  if (lower.trim() === '' || lower.includes('no tool')) return 'answers_without_tools'
  return 'completes_action'
}
```

- [ ] **Step 4: Implement trace runner**

Create `tests/prompt-regression/harness/trace-runner.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { assertContainsAll } from './assertions.js'
import type { TraceFixture } from './fixture-types.js'
import { buildScriptedTrace, classifyFinalReply } from './scripted-model.js'

export interface TraceFixtureResult {
  readonly toolCalls: readonly string[]
  readonly finalText: string
  readonly finalClassification: string
}

export function runTraceFixture(fixture: TraceFixture): TraceFixtureResult {
  const trace = buildScriptedTrace(fixture.script)
  const toolCalls = trace.toolCalls.map((call) => call.toolName)
  const finalClassification = classifyFinalReply(trace.finalText)

  for (const expected of fixture.expected.toolCalls ?? []) {
    if (!toolCalls.includes(expected)) throw new Error(`Expected trace to call ${expected}`)
  }
  for (const forbidden of fixture.expected.forbiddenToolCalls ?? []) {
    if (toolCalls.includes(forbidden)) throw new Error(`Expected trace not to call ${forbidden}`)
  }
  if (finalClassification !== fixture.expected.finalClassification) {
    throw new Error(
      `Expected final classification ${fixture.expected.finalClassification}, received ${finalClassification}`,
    )
  }

  assertContainsAll(trace.finalText, fixture.expected.finalReplyMustContain)

  return { toolCalls, finalText: trace.finalText, finalClassification }
}
```

- [ ] **Step 5: Run scripted model tests**

Run:

```bash
bun test tests/prompt-regression/harness/scripted-model.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/prompt-regression/harness/scripted-model.ts \
  tests/prompt-regression/harness/scripted-model.test.ts \
  tests/prompt-regression/harness/trace-runner.ts
git commit -m "test: add scripted prompt trace harness"
```

## Task 4: Baseline Trace Fixtures

**Files:**

- Create: `tests/prompt-regression/fixtures/trace/baseline.fixture.ts`
- Create: `tests/prompt-regression/trace.test.ts`

- [ ] **Step 1: Write failing trace test entrypoint**

Create `tests/prompt-regression/trace.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { partitionFixtures } from './harness/fixture-loader.js'
import { runTraceFixture } from './harness/trace-runner.js'
import { traceFixtures } from './fixtures/trace/baseline.fixture.js'

describe('prompt regression trace fixtures', () => {
  const { runnable, pending } = partitionFixtures(traceFixtures)

  for (const fixture of runnable) {
    test(fixture.meta.id, () => {
      expect(() => runTraceFixture(fixture)).not.toThrow()
    })
  }

  test('pending trace fixtures are documented', () => {
    expect(pending.map((fixture) => fixture.meta.id)).toContain('trace-stale-memory-conflict-prefers-current-user')
  })
})
```

- [ ] **Step 2: Create baseline trace fixtures**

Create `tests/prompt-regression/fixtures/trace/baseline.fixture.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TraceFixture } from '../../harness/fixture-types.js'

export const traceFixtures: readonly TraceFixture[] = [
  {
    kind: 'trace',
    meta: {
      id: 'trace-create-task-completes',
      description: 'A clear create-task request completes with create_task and a confirmation reply.',
      ownerArea: 'orchestration',
      roadmapPhase: 'phase-0',
    },
    setup: { contextType: 'dm', provider: 'kaneo', enabledTools: ['create_task'] },
    script: [
      {
        type: 'tool_call',
        toolName: 'create_task',
        toolCallId: 'call-create',
        input: { title: 'Ship prompt harness' },
        output: { id: 'task-1', title: 'Ship prompt harness', url: 'https://tasks.test/task-1' },
      },
      { type: 'assistant_text', text: 'Created [Ship prompt harness](https://tasks.test/task-1).' },
    ],
    expected: {
      toolCalls: ['create_task'],
      finalClassification: 'completes_action',
      finalReplyMustContain: ['Created'],
    },
  },
  {
    kind: 'trace',
    meta: {
      id: 'trace-ambiguous-update-asks-clarification',
      description: 'Ambiguous task update asks one clarification question instead of mutating.',
      ownerArea: 'orchestration',
      roadmapPhase: 'phase-0',
    },
    setup: { contextType: 'dm', provider: 'kaneo', enabledTools: ['search_tasks', 'update_task'] },
    script: [
      {
        type: 'tool_call',
        toolName: 'search_tasks',
        toolCallId: 'call-search',
        input: { query: 'auth bug' },
        output: { matches: [{ id: 't1' }, { id: 't2' }] },
      },
      { type: 'assistant_text', text: 'I found two matching tasks. Which one should I update?' },
    ],
    expected: {
      toolCalls: ['search_tasks'],
      forbiddenToolCalls: ['update_task'],
      finalClassification: 'asks_clarification',
      finalReplyMustContain: ['Which one'],
    },
  },
  {
    kind: 'trace',
    meta: {
      id: 'trace-destructive-confirmation-required',
      description: 'Low-confidence destructive action asks for confirmation.',
      ownerArea: 'tools',
      roadmapPhase: 'phase-0',
    },
    setup: { contextType: 'dm', provider: 'kaneo', enabledTools: ['delete_task'] },
    script: [
      {
        type: 'tool_call',
        toolName: 'delete_task',
        toolCallId: 'call-delete',
        input: { taskId: 'task-1', confidence: 0.7 },
        output: { status: 'confirmation_required', message: 'Delete "Auth bug"?' },
      },
      { type: 'assistant_text', text: 'Delete "Auth bug"?' },
    ],
    expected: {
      toolCalls: ['delete_task'],
      finalClassification: 'asks_confirmation',
      finalReplyMustContain: ['Delete'],
    },
  },
  {
    kind: 'trace',
    meta: {
      id: 'trace-provider-error-retryable',
      description: 'Retryable provider error reports a retryable failure.',
      ownerArea: 'tools',
      roadmapPhase: 'phase-0',
    },
    setup: { contextType: 'dm', provider: 'kaneo', enabledTools: ['list_tasks'] },
    script: [
      {
        type: 'tool_call',
        toolName: 'list_tasks',
        toolCallId: 'call-list',
        input: {},
        error: 'rate limited',
      },
      { type: 'assistant_text', text: 'The task tracker is rate-limiting me; let me try again in a moment.' },
    ],
    expected: {
      toolCalls: ['list_tasks'],
      finalClassification: 'reports_retryable_failure',
      finalReplyMustContain: ['try again'],
    },
  },
  {
    kind: 'trace',
    meta: {
      id: 'trace-stale-memory-conflict-prefers-current-user',
      description: 'Current user instruction should win over stale memory.',
      ownerArea: 'context',
      roadmapPhase: 'phase-0',
      pending: {
        reason: 'Current behavior needs stronger prompt/context assertions for stale memory conflict handling.',
        expectedFixPhase: 'phase-1',
        unskipWhen: 'Structured Prompt Surface Spec adds memory conflict fixtures and prompt rules.',
      },
    },
    setup: { contextType: 'dm', provider: 'kaneo', enabledTools: ['create_task'], memory: 'stale' },
    script: [{ type: 'assistant_text', text: 'Current user instruction wins over stale memory.' }],
    expected: {
      finalClassification: 'completes_action',
      finalReplyMustContain: ['Current user'],
    },
  },
]
```

- [ ] **Step 3: Run trace test to verify it passes**

Run:

```bash
bun test tests/prompt-regression/trace.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/prompt-regression/trace.test.ts \
  tests/prompt-regression/fixtures/trace/baseline.fixture.ts
git commit -m "test: add prompt trace regression fixtures"
```

## Task 5: Targeted Suite Command And Final Verification

**Files:**

- Modify: `package.json`
- Verify: `tests/prompt-regression/**`

- [ ] **Step 1: Add a targeted test script**

Modify `package.json` scripts by adding:

```json
"test:prompt-regression": "bun test tests/prompt-regression"
```

Keep the surrounding script order consistent with nearby `test:*` scripts.

- [ ] **Step 2: Run the targeted prompt regression suite**

Run:

```bash
bun run test:prompt-regression
```

Expected: PASS. The output should include the assembly, trace, and harness unit tests.

- [ ] **Step 3: Run existing focused related tests**

Run:

```bash
bun test tests/system-prompt.test.ts tests/llm-orchestrator-invoke.test.ts tests/tool-failure.test.ts tests/memory-context-block.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run format and whitespace checks**

Run:

```bash
bun run format:check
git diff --check
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json tests/prompt-regression
git commit -m "test: wire prompt regression suite"
```

## Task 6: Implementation Self-Review

**Files:**

- Review: `tests/prompt-regression/**`
- Review: `docs/superpowers/specs/2026-06-12-prompt-regression-harness-design.md`

- [ ] **Step 1: Verify spec coverage**

Check that the implementation includes:

```text
tests/prompt-regression/
  assembly.test.ts
  trace.test.ts
  harness/
  fixtures/
    assembly/
    trace/
```

Expected: all paths exist.

- [ ] **Step 2: Verify no Phase 0 boundaries were crossed**

Run:

```bash
git diff HEAD~5 -- src
```

Expected: no production source changes unless a small export was explicitly needed and covered by compatibility assertions.

- [ ] **Step 3: Verify pending fixtures are documented**

Run:

```bash
rg -n "pending:|expectedFixPhase|unskipWhen" tests/prompt-regression
```

Expected: every pending fixture includes `reason`, `expectedFixPhase`, and `unskipWhen`.

- [ ] **Step 4: Run final targeted suite**

Run:

```bash
bun run test:prompt-regression
```

Expected: PASS.

- [ ] **Step 5: Commit any review fixes**

If the self-review required changes:

```bash
git add tests/prompt-regression package.json
git commit -m "test: refine prompt regression harness"
```

If no changes were required, do not create an empty commit.

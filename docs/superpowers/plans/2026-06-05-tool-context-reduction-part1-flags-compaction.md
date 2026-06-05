<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tool-Context Reduction — Part 1: Feature Flags + Result Compaction (F) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behind a per-context feature flag (default OFF), replace oversized tool results with a query-aware SMALL_MODEL summary plus a handle, and let the model page the full raw result on demand via an `expand_result` tool.

**Architecture:** A new per-context flag layer (reserved config key, mirroring `tool_prefs`) gates the feature. A per-turn compaction wrap layer composes _after_ `applyToolPreferences` in `prepareLlmInvocation` (so it sees the current turn's user intent, which the cached descriptor wrap cannot). On a tool's successful result, a pure size-gate decides whether to compact; over-threshold results are summarized (SMALL_MODEL → `main_model` fallback → deterministic truncation) and stored in a per-context TTL/LRU result store keyed by a handle, returning a compact envelope. The always-on `expand_result` tool pages the stored raw result.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Zod v4, Vercel AI SDK v6 (`ai`, `@ai-sdk/openai-compatible`), Drizzle/SQLite, pino. Tests: `bun test` with DI-first helpers in `tests/utils/test-helpers.ts`.

This is Part 1 of 2. Part 2 covers Progressive Disclosure (C) + Semantic Tool Retrieval (B). Spec: `docs/superpowers/specs/2026-06-05-tool-context-reduction-design.md`.

---

## Spec deviations (intentional, vs §5.3 of the spec)

1. **Compaction is a per-turn wrap layer, not a modification of the cached `wrapToolExecution`.** The descriptor `ToolSet` is cached per context in `getOrCreateDescriptors` (`src/llm-orchestrator-tools.ts:25-56`); the cached builtin wrap therefore cannot carry per-turn user intent. Instead we add `applyResultCompaction(tools, ctx)` and call it per-turn right after `applyToolPreferences` (`src/llm-orchestrator-tools.ts:121`), which already runs every turn. `wrapToolExecution` is left unchanged.
2. **`expand_result` is registered as a flag-gated provider-independent tool** (always available when the compaction flag is ON, independent of Part 2's disclosure), so it works in this part alone.

---

## File structure

**Create:**

- `src/tools/feature-flags.ts` — per-context + global resolution of the three reduction flags (Part 2 reads the same module).
- `src/tools/compaction/types.ts` — `CompactedEnvelope`, `CompactionContext`, type guards.
- `src/tools/compaction/size-gate.ts` — pure: serialize, measure, threshold + double-compaction/non-serializable guards.
- `src/tools/compaction/result-store.ts` — per-context TTL/LRU store: `put`, `get`, page helper.
- `src/tools/compaction/summarizer.ts` — DI SMALL_MODEL summarizer with truncation fallback.
- `src/tools/compaction/wrap-compaction.ts` — `applyResultCompaction(tools, ctx)` per-turn wrap.
- `src/tools/compaction/expand-result.ts` — `makeExpandResultTool(contextId)`.
- Tests mirroring each under `tests/tools/...`.

**Modify:**

- `src/tools/feature-flags.ts` is consumed by `src/llm-orchestrator-tools.ts` (wire compaction) and `src/tools/provider-independent-tools-builder.ts` (register `expand_result`).
- `src/config-keys.ts` — none required (reserved key is non-user-visible, like `tool_prefs`).

**Constants (all in `src/tools/compaction/constants.ts`, created in Task 3):**

- `COMPACTION_THRESHOLD_BYTES = 8_000`
- `COMPACTION_PREVIEW_BYTES = 600`
- `RESULT_STORE_MAX_ENTRIES = 64`
- `RESULT_STORE_TTL_MS = 30 * 60_000`
- `EXPAND_DEFAULT_LIMIT_BYTES = 4_000`

---

### Task 1: Feature-flag module

**Files:**

- Create: `src/tools/feature-flags.ts`
- Test: `tests/tools/feature-flags.test.ts`

The reserved per-context config key holds JSON `{ progressive_disclosure?, result_compaction?, semantic_tool_retrieval? }`. Resolution: per-context value → global env kill-switch → `false`. The global env var `TOOL_CONTEXT_REDUCTION_DISABLED=true` forces all flags OFF (kill switch). Reads use the same `getCachedConfig` path as `tool_prefs`, keyed by the **config** context id.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/feature-flags.test.ts
import { describe, expect, it, mock, beforeEach } from 'bun:test'

const getCachedConfig = mock((_c: string, _k: string): string | null => null)
mock.module('../../src/cache.js', () => ({ getCachedConfig }))

const { resolveReductionFlags, REDUCTION_FLAGS_CONFIG_KEY } = await import('../../src/tools/feature-flags.js')

describe('resolveReductionFlags', () => {
  beforeEach(() => {
    getCachedConfig.mockReset()
    getCachedConfig.mockImplementation(() => null)
    delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
  })

  it('defaults every flag to false when no config present', () => {
    const flags = resolveReductionFlags('ctx-1')
    expect(flags).toEqual({
      progressiveDisclosure: false,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
  })

  it('reads per-context overrides from the reserved key', () => {
    getCachedConfig.mockImplementation((_c, k) =>
      k === REDUCTION_FLAGS_CONFIG_KEY ? JSON.stringify({ result_compaction: true }) : null,
    )
    expect(resolveReductionFlags('ctx-1').resultCompaction).toBe(true)
  })

  it('kill switch forces every flag OFF regardless of config', () => {
    process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] = 'true'
    getCachedConfig.mockImplementation(() => JSON.stringify({ result_compaction: true, progressive_disclosure: true }))
    expect(resolveReductionFlags('ctx-1')).toEqual({
      progressiveDisclosure: false,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
  })

  it('ignores corrupt JSON and returns all-false', () => {
    getCachedConfig.mockImplementation(() => '{not json')
    expect(resolveReductionFlags('ctx-1').resultCompaction).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/feature-flags.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/feature-flags.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/feature-flags.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getCachedConfig } from '../cache.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tools:feature-flags' })

/** Reserved, non-user-visible config key holding the per-context reduction flags JSON. */
export const REDUCTION_FLAGS_CONFIG_KEY = 'tool_context_flags'

export interface ReductionFlags {
  progressiveDisclosure: boolean
  resultCompaction: boolean
  semanticToolRetrieval: boolean
}

const ALL_OFF: ReductionFlags = {
  progressiveDisclosure: false,
  resultCompaction: false,
  semanticToolRetrieval: false,
}

function killSwitchEngaged(): boolean {
  return process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] === 'true'
}

function parse(raw: string | null): ReductionFlags {
  if (raw === null || raw.trim() === '') return { ...ALL_OFF }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...ALL_OFF }
    const rec = parsed as Record<string, unknown>
    return {
      progressiveDisclosure: rec['progressive_disclosure'] === true,
      resultCompaction: rec['result_compaction'] === true,
      semanticToolRetrieval: rec['semantic_tool_retrieval'] === true,
    }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Corrupt reduction flags; all OFF')
    return { ...ALL_OFF }
  }
}

/** Resolve the three reduction flags for a storage context id. Kill switch wins. */
export function resolveReductionFlags(storageContextId: string): ReductionFlags {
  if (killSwitchEngaged()) return { ...ALL_OFF }
  const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
  return parse(getCachedConfig(configContextId, REDUCTION_FLAGS_CONFIG_KEY))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/feature-flags.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/feature-flags.ts tests/tools/feature-flags.test.ts
git commit -m "feat(tools): per-context reduction feature flags with kill switch"
```

---

### Task 2: Compaction types + constants

**Files:**

- Create: `src/tools/compaction/types.ts`
- Create: `src/tools/compaction/constants.ts`
- Test: `tests/tools/compaction/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/compaction/types.test.ts
import { describe, expect, it } from 'bun:test'

import { isCompactedEnvelope } from '../../../src/tools/compaction/types.js'

describe('isCompactedEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    expect(
      isCompactedEnvelope({
        _compacted: true,
        handle: 'res_ab12',
        summary: 'short',
        totalBytes: 40000,
        preview: 'head',
        hint: 'call expand_result',
      }),
    ).toBe(true)
  })

  it('accepts a truncation envelope (summary null)', () => {
    expect(
      isCompactedEnvelope({ _compacted: true, handle: 'res_x', summary: null, totalBytes: 9, preview: 'p', hint: 'h' }),
    ).toBe(true)
  })

  it('rejects non-envelopes', () => {
    expect(isCompactedEnvelope({ ok: true })).toBe(false)
    expect(isCompactedEnvelope(null)).toBe(false)
    expect(isCompactedEnvelope({ _compacted: false })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/compaction/types.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/compaction/constants.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const COMPACTION_THRESHOLD_BYTES = 8_000
export const COMPACTION_PREVIEW_BYTES = 600
export const RESULT_STORE_MAX_ENTRIES = 64
export const RESULT_STORE_TTL_MS = 30 * 60_000
export const EXPAND_DEFAULT_LIMIT_BYTES = 4_000
```

```ts
// src/tools/compaction/types.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { JSONValue } from 'ai'

export interface CompactedEnvelope {
  [key: string]: JSONValue | undefined
  _compacted: true
  handle: string
  summary: string | null
  totalBytes: number
  preview: string
  hint: string
}

export interface CompactionContext {
  storageContextId: string
  /** Latest user message text, used to make summaries query-aware. */
  userIntent: string
  enabled: boolean
}

export function isCompactedEnvelope(value: unknown): value is CompactedEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_compacted' in value &&
    (value as Record<string, unknown>)['_compacted'] === true &&
    'handle' in value &&
    typeof (value as Record<string, unknown>)['handle'] === 'string'
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/compaction/types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/compaction/types.ts src/tools/compaction/constants.ts tests/tools/compaction/types.test.ts
git commit -m "feat(compaction): envelope types and tuning constants"
```

---

### Task 3: Size-gate (pure decision)

**Files:**

- Create: `src/tools/compaction/size-gate.ts`
- Test: `tests/tools/compaction/size-gate.test.ts`

`evaluateForCompaction(result)` returns `{ compact: false }` when: result is `undefined`/`null`, a `ToolFailureResult`, an already-`_compacted` envelope, not JSON-serializable, or its serialized byte length ≤ threshold. Otherwise `{ compact: true, serialized, totalBytes }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/compaction/size-gate.test.ts
import { describe, expect, it } from 'bun:test'

import { evaluateForCompaction } from '../../../src/tools/compaction/size-gate.js'

describe('evaluateForCompaction', () => {
  it('does not compact small results', () => {
    expect(evaluateForCompaction({ ok: 1 }).compact).toBe(false)
  })

  it('compacts results over the byte threshold', () => {
    const big = { rows: Array.from({ length: 2000 }, (_, i) => ({ i, v: 'xxxxxxxxxx' })) }
    const out = evaluateForCompaction(big)
    expect(out.compact).toBe(true)
    if (out.compact) expect(out.totalBytes).toBeGreaterThan(8_000)
  })

  it('never compacts a tool-failure result', () => {
    const failure = {
      success: false,
      error: 'boom',
      toolName: 't',
      toolCallId: 'c',
      timestamp: 'now',
      errorType: 'tool-execution',
      errorCode: 'unknown',
      userMessage: 'u',
      agentMessage: 'a',
      retryable: false,
      padding: 'z'.repeat(20_000),
    }
    expect(evaluateForCompaction(failure).compact).toBe(false)
  })

  it('never re-compacts an already-compacted envelope', () => {
    const env = { _compacted: true, handle: 'res_x', summary: null, totalBytes: 99_999, preview: 'p', hint: 'h' }
    expect(evaluateForCompaction(env).compact).toBe(false)
  })

  it('skips non-serializable results', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(evaluateForCompaction(circular).compact).toBe(false)
  })

  it('skips null and undefined', () => {
    expect(evaluateForCompaction(null).compact).toBe(false)
    expect(evaluateForCompaction(undefined).compact).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/compaction/size-gate.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/compaction/size-gate.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isToolFailureResult } from '../../tool-failure.js'
import { COMPACTION_THRESHOLD_BYTES } from './constants.js'
import { isCompactedEnvelope } from './types.js'

export type CompactionDecision = { compact: false } | { compact: true; serialized: string; totalBytes: number }

export function evaluateForCompaction(result: unknown): CompactionDecision {
  if (result === undefined || result === null) return { compact: false }
  if (isToolFailureResult(result)) return { compact: false }
  if (isCompactedEnvelope(result)) return { compact: false }
  let serialized: string
  try {
    serialized = JSON.stringify(result)
  } catch {
    return { compact: false }
  }
  if (serialized === undefined) return { compact: false }
  const totalBytes = Buffer.byteLength(serialized, 'utf8')
  if (totalBytes <= COMPACTION_THRESHOLD_BYTES) return { compact: false }
  return { compact: true, serialized, totalBytes }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/compaction/size-gate.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/compaction/size-gate.ts tests/tools/compaction/size-gate.test.ts
git commit -m "feat(compaction): pure size-gate with failure/envelope/non-serializable guards"
```

---

### Task 4: Per-context result store (TTL + LRU)

**Files:**

- Create: `src/tools/compaction/result-store.ts`
- Test: `tests/tools/compaction/result-store.test.ts`

A module-level `Map<contextId, Map<handle, Entry>>`. `putResult` generates a handle `res_<hex>` from a monotonic counter (no `Math.random`/`Date.now` in hot deterministic paths — counter keeps tests deterministic; TTL uses an injected clock). `getResultPage` returns a byte window. Eviction: per-context max entries (LRU by insertion/access order) + TTL on read.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/compaction/result-store.test.ts
import { describe, expect, it, beforeEach } from 'bun:test'

import {
  putResult,
  getResultPage,
  clearResultStoreForTesting,
  __setResultStoreClockForTesting,
} from '../../../src/tools/compaction/result-store.js'

describe('result-store', () => {
  let now = 1_000
  beforeEach(() => {
    clearResultStoreForTesting()
    now = 1_000
    __setResultStoreClockForTesting(() => now)
  })

  it('stores and pages a raw string by byte window', () => {
    const handle = putResult('ctx-1', 'abcdefghij')
    expect(handle).toMatch(/^res_/)
    const page = getResultPage('ctx-1', handle, 0, 4)
    expect(page).toEqual({ found: true, chunk: 'abcd', nextOffset: 4, done: false })
    const tail = getResultPage('ctx-1', handle, 8, 4)
    expect(tail).toEqual({ found: true, chunk: 'ij', nextOffset: 10, done: true })
  })

  it('reports not found for unknown handle', () => {
    expect(getResultPage('ctx-1', 'res_missing', 0, 4)).toEqual({ found: false })
  })

  it('expires entries past TTL', () => {
    const handle = putResult('ctx-1', 'data')
    now += 30 * 60_000 + 1
    expect(getResultPage('ctx-1', handle, 0, 4)).toEqual({ found: false })
  })

  it('isolates handles per context', () => {
    const handle = putResult('ctx-1', 'data')
    expect(getResultPage('ctx-2', handle, 0, 4)).toEqual({ found: false })
  })

  it('evicts oldest when exceeding max entries', () => {
    const handles: string[] = []
    for (let i = 0; i < 65; i++) handles.push(putResult('ctx-1', `v${i}`))
    expect(getResultPage('ctx-1', handles[0]!, 0, 4)).toEqual({ found: false })
    expect(getResultPage('ctx-1', handles[64]!, 0, 4).found).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/compaction/result-store.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/compaction/result-store.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { RESULT_STORE_MAX_ENTRIES, RESULT_STORE_TTL_MS } from './constants.js'

interface Entry {
  raw: string
  createdAt: number
}

type ResultPage = { found: false } | { found: true; chunk: string; nextOffset: number; done: boolean }

const store = new Map<string, Map<string, Entry>>()
let counter = 0
let clock: () => number = () => Date.now()

export function __setResultStoreClockForTesting(fn: () => number): void {
  clock = fn
}
export function clearResultStoreForTesting(): void {
  store.clear()
  counter = 0
}

function contextMap(contextId: string): Map<string, Entry> {
  let m = store.get(contextId)
  if (m === undefined) {
    m = new Map()
    store.set(contextId, m)
  }
  return m
}

export function putResult(contextId: string, raw: string): string {
  const m = contextMap(contextId)
  counter += 1
  const handle = `res_${counter.toString(16)}`
  m.set(handle, { raw, createdAt: clock() })
  while (m.size > RESULT_STORE_MAX_ENTRIES) {
    const oldest = m.keys().next().value
    if (oldest === undefined) break
    m.delete(oldest)
  }
  return handle
}

export function getResultPage(contextId: string, handle: string, offset: number, limit: number): ResultPage {
  const m = store.get(contextId)
  const entry = m?.get(handle)
  if (m === undefined || entry === undefined) return { found: false }
  if (clock() - entry.createdAt > RESULT_STORE_TTL_MS) {
    m.delete(handle)
    return { found: false }
  }
  const start = Math.max(0, offset)
  const chunk = entry.raw.slice(start, start + Math.max(0, limit))
  const nextOffset = start + chunk.length
  return { found: true, chunk, nextOffset, done: nextOffset >= entry.raw.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/compaction/result-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/compaction/result-store.ts tests/tools/compaction/result-store.test.ts
git commit -m "feat(compaction): per-context TTL+LRU result store with injected clock"
```

---

### Task 5: Query-aware summarizer (DI model + truncation fallback)

**Files:**

- Create: `src/tools/compaction/summarizer.ts`
- Test: `tests/tools/compaction/summarizer.test.ts`

`summarizeResult({ serialized, totalBytes, toolName, userIntent }, deps)` calls the injected `generateText` with a prompt that includes `toolName` + `userIntent` + a bounded slice of `serialized`, returning `{ summary }`. On any error/empty text, returns `{ summary: null }` (the caller then uses deterministic truncation). The default deps build the model from `getSystemConfig` creds with `small_model` → `main_model` fallback.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/compaction/summarizer.test.ts
import { describe, expect, it, mock } from 'bun:test'

import { summarizeResult, type SummarizerDeps } from '../../../src/tools/compaction/summarizer.js'

function depsReturning(text: string | null): SummarizerDeps {
  return {
    generate: mock(async (opts: { system: string; prompt: string }) => {
      if (text === null) throw new Error('model down')
      return { text, _system: opts.system, _prompt: opts.prompt }
    }) as unknown as SummarizerDeps['generate'],
  }
}

describe('summarizeResult', () => {
  it('returns a model summary and passes tool name + intent into the prompt', async () => {
    const deps = depsReturning('Three overdue tasks in Auth.')
    const out = await summarizeResult(
      { serialized: '{"rows":[...]}', totalBytes: 40000, toolName: 'list_tasks', userIntent: 'overdue in Auth' },
      deps,
    )
    expect(out.summary).toBe('Three overdue tasks in Auth.')
    const call = (deps.generate as unknown as { mock: { calls: Array<[{ prompt: string }]> } }).mock.calls[0]![0]
    expect(call.prompt).toContain('list_tasks')
    expect(call.prompt).toContain('overdue in Auth')
  })

  it('returns summary:null when the model throws', async () => {
    const out = await summarizeResult(
      { serialized: 'x', totalBytes: 9, toolName: 't', userIntent: 'i' },
      depsReturning(null),
    )
    expect(out.summary).toBeNull()
  })

  it('returns summary:null when the model returns empty text', async () => {
    const out = await summarizeResult(
      { serialized: 'x', totalBytes: 9, toolName: 't', userIntent: 'i' },
      depsReturning('   '),
    )
    expect(out.summary).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/compaction/summarizer.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/compaction/summarizer.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'

import { logger } from '../../logger.js'
import { getSystemConfig } from '../../system-config.js'

const log = logger.child({ scope: 'compaction:summarizer' })

const PROMPT_INPUT_BUDGET = 12_000

export interface SummarizerDeps {
  generate: (opts: { model: unknown; system: string; prompt: string }) => Promise<{ text: string }>
}

export interface SummarizeInput {
  serialized: string
  totalBytes: number
  toolName: string
  userIntent: string
}

function buildModel(): unknown | null {
  const apiKey = getSystemConfig('llm_apikey')
  const baseUrl = getSystemConfig('llm_baseurl')
  const model = getSystemConfig('small_model') ?? getSystemConfig('main_model')
  if (apiKey === null || baseUrl === null || model === null) return null
  return createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL: baseUrl })(model)
}

const defaultDeps: SummarizerDeps = {
  generate: async ({ model, system, prompt }) => {
    const result = await generateText({ model: model as Parameters<typeof generateText>[0]['model'], system, prompt })
    return { text: result.text }
  },
}

const SYSTEM = [
  'You compress a large tool result into a concise, faithful summary for an AI agent.',
  'Keep only what is relevant to the user intent and the tool that produced it.',
  'Preserve concrete identifiers, counts, names, and statuses the agent will need.',
  'Do not invent data. Output prose only, no preamble.',
].join(' ')

export async function summarizeResult(
  input: SummarizeInput,
  deps: SummarizerDeps = defaultDeps,
): Promise<{ summary: string | null }> {
  const model = deps === defaultDeps ? buildModel() : {}
  if (model === null) return { summary: null }
  const slice = input.serialized.slice(0, PROMPT_INPUT_BUDGET)
  const prompt = [
    `Tool: ${input.toolName}`,
    `User intent: ${input.userIntent}`,
    `Total bytes: ${input.totalBytes}`,
    'Result (possibly truncated):',
    slice,
  ].join('\n')
  try {
    const { text } = await deps.generate({ model, system: SYSTEM, prompt })
    const trimmed = text.trim()
    return { summary: trimmed === '' ? null : trimmed }
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error), tool: input.toolName },
      'Summarize failed',
    )
    return { summary: null }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/compaction/summarizer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/compaction/summarizer.ts tests/tools/compaction/summarizer.test.ts
git commit -m "feat(compaction): query-aware SMALL_MODEL summarizer with fallback"
```

---

### Task 6: `expand_result` tool

**Files:**

- Create: `src/tools/compaction/expand-result.ts`
- Test: `tests/tools/compaction/expand-result.test.ts`

`makeExpandResultTool(contextId)` returns an AI SDK tool. On a found handle it returns the page; on a missing/expired handle it returns a structured `ToolFailureResult` (`errorCode: 'expired'`, retryable) via the shared builder, telling the agent to re-run the source tool.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/compaction/expand-result.test.ts
import { describe, expect, it, beforeEach } from 'bun:test'

import {
  putResult,
  clearResultStoreForTesting,
  __setResultStoreClockForTesting,
} from '../../../src/tools/compaction/result-store.js'
import { makeExpandResultTool } from '../../../src/tools/compaction/expand-result.js'
import { getToolExecutor } from '../../utils/test-helpers.js'

describe('expand_result tool', () => {
  beforeEach(() => {
    clearResultStoreForTesting()
    __setResultStoreClockForTesting(() => 1_000)
  })

  it('pages a stored result', async () => {
    const handle = putResult('ctx-1', 'abcdefghij')
    const exec = getToolExecutor(makeExpandResultTool('ctx-1'))
    const out = (await exec({ handle, offset: 0, limit: 4 })) as { chunk: string; done: boolean }
    expect(out.chunk).toBe('abcd')
    expect(out.done).toBe(false)
  })

  it('returns a structured failure for an unknown handle', async () => {
    const exec = getToolExecutor(makeExpandResultTool('ctx-1'))
    const out = (await exec({ handle: 'res_missing' })) as { success: boolean; errorCode: string; retryable: boolean }
    expect(out.success).toBe(false)
    expect(out.errorCode).toBe('expired')
    expect(out.retryable).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/compaction/expand-result.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/compaction/expand-result.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../../logger.js'
import { EXPAND_DEFAULT_LIMIT_BYTES } from './constants.js'
import { getResultPage } from './result-store.js'

const log = logger.child({ scope: 'tool:expand_result' })

export function makeExpandResultTool(contextId: string): ToolSet[string] {
  return tool({
    description:
      'Page through the full raw content of a previously compacted tool result. Pass the handle from a _compacted result. Use offset/limit to read in windows.',
    inputSchema: z.object({
      handle: z.string().min(1).describe('The handle from the compacted result envelope, e.g. res_ab12'),
      offset: z.number().int().min(0).default(0).describe('Byte offset to start from'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(16_000)
        .default(EXPAND_DEFAULT_LIMIT_BYTES)
        .describe('Maximum characters to return'),
    }),
    execute: async ({ handle, offset, limit }) => {
      const page = getResultPage(contextId, handle, offset, limit)
      if (!page.found) {
        log.warn({ contextId, handle }, 'expand_result handle not found or expired')
        return {
          success: false as const,
          error: 'Result handle not found or expired',
          toolName: 'expand_result',
          toolCallId: handle,
          timestamp: new Date().toISOString(),
          errorType: 'tool-execution' as const,
          errorCode: 'expired' as const,
          userMessage: 'That cached result is no longer available.',
          agentMessage: 'The compacted result expired. Re-run the original tool to get fresh data.',
          retryable: true,
        }
      }
      log.debug({ contextId, handle, nextOffset: page.nextOffset, done: page.done }, 'expand_result page served')
      return { chunk: page.chunk, nextOffset: page.nextOffset, done: page.done }
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/compaction/expand-result.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/compaction/expand-result.ts tests/tools/compaction/expand-result.test.ts
git commit -m "feat(compaction): expand_result paging tool"
```

---

### Task 7: Per-turn compaction wrap layer

**Files:**

- Create: `src/tools/compaction/wrap-compaction.ts`
- Test: `tests/tools/compaction/wrap-compaction.test.ts`

`applyResultCompaction(tools, ctx, deps?)` returns a new `ToolSet` whose every executable tool is wrapped so that, after a successful execution, the result is run through the size-gate; over-threshold results are summarized + stored, and a `CompactedEnvelope` is returned. When `ctx.enabled === false` it returns `tools` unchanged. `expand_result` itself is never wrapped (guard by name) to avoid double compaction of pages.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/compaction/wrap-compaction.test.ts
import { describe, expect, it, beforeEach, mock } from 'bun:test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import {
  clearResultStoreForTesting,
  __setResultStoreClockForTesting,
} from '../../../src/tools/compaction/result-store.js'
import { applyResultCompaction } from '../../../src/tools/compaction/wrap-compaction.js'
import { isCompactedEnvelope } from '../../../src/tools/compaction/types.js'
import { getToolExecutor } from '../../utils/test-helpers.js'

function toolReturning(value: unknown): ToolSet[string] {
  return tool({ description: 'x', inputSchema: z.object({}), execute: async () => value })
}

const summarizerDeps = {
  summarize: mock(async () => ({ summary: 'SUMMARY' })),
}

describe('applyResultCompaction', () => {
  beforeEach(() => {
    clearResultStoreForTesting()
    __setResultStoreClockForTesting(() => 1_000)
    summarizerDeps.summarize.mockReset()
    summarizerDeps.summarize.mockImplementation(async () => ({ summary: 'SUMMARY' }))
  })

  const ctx = { storageContextId: 'ctx-1', userIntent: 'find things', enabled: true }
  const big = { rows: Array.from({ length: 2000 }, (_, i) => ({ i, v: 'xxxxxxxxxx' })) }

  it('passes through unchanged when disabled', async () => {
    const wrapped = applyResultCompaction({ t: toolReturning(big) }, { ...ctx, enabled: false }, summarizerDeps)
    const out = await getToolExecutor(wrapped['t']!)({})
    expect(isCompactedEnvelope(out)).toBe(false)
  })

  it('does not compact small results', async () => {
    const wrapped = applyResultCompaction({ t: toolReturning({ ok: 1 }) }, ctx, summarizerDeps)
    const out = await getToolExecutor(wrapped['t']!)({})
    expect(out).toEqual({ ok: 1 })
  })

  it('compacts large results into an envelope with a summary and handle', async () => {
    const wrapped = applyResultCompaction({ t: toolReturning(big) }, ctx, summarizerDeps)
    const out = await getToolExecutor(wrapped['t']!)({})
    expect(isCompactedEnvelope(out)).toBe(true)
    if (isCompactedEnvelope(out)) {
      expect(out.summary).toBe('SUMMARY')
      expect(out.handle).toMatch(/^res_/)
      expect(out.totalBytes).toBeGreaterThan(8_000)
    }
  })

  it('falls back to truncation (summary null) when summarizer returns null', async () => {
    summarizerDeps.summarize.mockImplementation(async () => ({ summary: null }))
    const wrapped = applyResultCompaction({ t: toolReturning(big) }, ctx, summarizerDeps)
    const out = await getToolExecutor(wrapped['t']!)({})
    if (isCompactedEnvelope(out)) {
      expect(out.summary).toBeNull()
      expect(out.preview.length).toBeGreaterThan(0)
    } else {
      throw new Error('expected compacted envelope')
    }
  })

  it('never wraps expand_result', async () => {
    const wrapped = applyResultCompaction({ expand_result: toolReturning(big) }, ctx, summarizerDeps)
    const out = await getToolExecutor(wrapped['expand_result']!)({})
    expect(isCompactedEnvelope(out)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/compaction/wrap-compaction.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/compaction/wrap-compaction.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions, ToolSet } from 'ai'

import { logger } from '../../logger.js'
import { COMPACTION_PREVIEW_BYTES } from './constants.js'
import { putResult } from './result-store.js'
import { evaluateForCompaction } from './size-gate.js'
import { summarizeResult } from './summarizer.js'
import type { CompactedEnvelope, CompactionContext } from './types.js'

const log = logger.child({ scope: 'compaction:wrap' })

export interface WrapCompactionDeps {
  summarize: (input: {
    serialized: string
    totalBytes: number
    toolName: string
    userIntent: string
  }) => Promise<{ summary: string | null }>
}

const defaultDeps: WrapCompactionDeps = {
  summarize: (input) => summarizeResult(input),
}

const NEVER_COMPACT = new Set(['expand_result'])

async function compact(
  result: unknown,
  toolName: string,
  ctx: CompactionContext,
  deps: WrapCompactionDeps,
): Promise<unknown> {
  const decision = evaluateForCompaction(result)
  if (!decision.compact) return result
  const handle = putResult(ctx.storageContextId, decision.serialized)
  const { summary } = await deps.summarize({
    serialized: decision.serialized,
    totalBytes: decision.totalBytes,
    toolName,
    userIntent: ctx.userIntent,
  })
  const preview = decision.serialized.slice(0, COMPACTION_PREVIEW_BYTES)
  log.info(
    {
      contextId: ctx.storageContextId,
      tool: toolName,
      totalBytes: decision.totalBytes,
      mode: summary === null ? 'truncated' : 'summary',
    },
    'Tool result compacted',
  )
  const envelope: CompactedEnvelope = {
    _compacted: true,
    handle,
    summary,
    totalBytes: decision.totalBytes,
    preview,
    hint: 'This result was compacted. Call expand_result with this handle (offset/limit) to read the full raw content.',
  }
  return envelope
}

export function applyResultCompaction(
  tools: ToolSet,
  ctx: CompactionContext,
  deps: WrapCompactionDeps = defaultDeps,
): ToolSet {
  if (!ctx.enabled) return tools
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    if (t === undefined || t.execute === undefined || NEVER_COMPACT.has(name)) {
      if (t !== undefined) out[name] = t
      continue
    }
    const inner = t.execute.bind(t)
    out[name] = {
      ...t,
      execute: async (input: unknown, options: ToolExecutionOptions) => {
        const result = await inner(input, options)
        return compact(result, name, ctx, deps)
      },
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/compaction/wrap-compaction.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/compaction/wrap-compaction.ts tests/tools/compaction/wrap-compaction.test.ts
git commit -m "feat(compaction): per-turn result-compaction wrap layer"
```

---

### Task 8: Register `expand_result` when compaction flag is ON

**Files:**

- Modify: `src/tools/provider-independent-tools-builder.ts` (the `addProviderIndependentTools` function, around line 79-108)
- Test: `tests/tools/provider-independent-expand-result.test.ts`

`expand_result` must be present in the tool set whenever the compaction flag resolves ON for the context, independent of Part 2. Add it in `addProviderIndependentTools`, gated on `resolveReductionFlags(contextId).resultCompaction` and a defined `contextId`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/provider-independent-expand-result.test.ts
import { describe, expect, it, mock, beforeEach } from 'bun:test'

const resolveReductionFlags = mock(() => ({
  progressiveDisclosure: false,
  resultCompaction: false,
  semanticToolRetrieval: false,
}))
mock.module('../../src/tools/feature-flags.js', () => ({
  resolveReductionFlags,
  REDUCTION_FLAGS_CONFIG_KEY: 'tool_context_flags',
}))

const { addProviderIndependentTools } = await import('../../src/tools/provider-independent-tools-builder.js')

const baseOpts = {
  chatUserId: 'u1',
  contextId: 'u1',
  mode: 'normal' as const,
  contextType: 'dm' as const,
  username: null,
  stagedDownloadFn: undefined,
}

describe('expand_result registration', () => {
  beforeEach(() => resolveReductionFlags.mockReset())

  it('omits expand_result when compaction flag is OFF', () => {
    resolveReductionFlags.mockReturnValue({
      progressiveDisclosure: false,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
    const tools: Record<string, unknown> = {}
    addProviderIndependentTools(tools, baseOpts)
    expect(tools['expand_result']).toBeUndefined()
  })

  it('adds expand_result when compaction flag is ON', () => {
    resolveReductionFlags.mockReturnValue({
      progressiveDisclosure: false,
      resultCompaction: true,
      semanticToolRetrieval: false,
    })
    const tools: Record<string, unknown> = {}
    addProviderIndependentTools(tools, baseOpts)
    expect(tools['expand_result']).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/provider-independent-expand-result.test.ts`
Expected: FAIL — `expand_result` is `undefined` in the ON case.

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `src/tools/provider-independent-tools-builder.ts` (with the other imports):

```ts
import { resolveReductionFlags } from './feature-flags.js'
import { makeExpandResultTool } from './compaction/expand-result.js'
```

Then, inside `addProviderIndependentTools`, immediately after the `tools['get_current_time'] = ...` line (currently line 83), add:

```ts
if (contextId !== undefined && resolveReductionFlags(contextId).resultCompaction) {
  tools['expand_result'] = makeExpandResultTool(contextId)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/provider-independent-expand-result.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/provider-independent-tools-builder.ts tests/tools/provider-independent-expand-result.test.ts
git commit -m "feat(compaction): register expand_result when compaction flag is on"
```

---

### Task 9: Wire compaction into the per-turn invocation path

**Files:**

- Modify: `src/llm-orchestrator-tools.ts` — `prepareLlmInvocation` (lines 104-138) and `LlmInvocationOptions`/`InvocationSource` if needed.
- Test: `tests/llm-orchestrator-tools-compaction.test.ts`

After `applyToolPreferences` builds `fullTools`, compose `applyResultCompaction` using a `CompactionContext` whose `enabled` comes from `resolveReductionFlags(contextId).resultCompaction` and whose `userIntent` is `opts.userText`. `enabledToolNames` is computed from the compacted tool set (names are unchanged by compaction, so the set is identical, but compute after to stay correct if that ever changes).

- [ ] **Step 1: Write the failing test**

```ts
// tests/llm-orchestrator-tools-compaction.test.ts
import { describe, expect, it, mock, beforeEach } from 'bun:test'

const resolveReductionFlags = mock(() => ({
  progressiveDisclosure: false,
  resultCompaction: true,
  semanticToolRetrieval: false,
}))
const applyResultCompaction = mock((tools: unknown, _ctx: unknown) => tools)
mock.module('../src/tools/feature-flags.js', () => ({
  resolveReductionFlags,
  REDUCTION_FLAGS_CONFIG_KEY: 'tool_context_flags',
}))
mock.module('../src/tools/compaction/wrap-compaction.js', () => ({ applyResultCompaction }))

// Minimal stubs for descriptor build + memory so prepareLlmInvocation runs.
mock.module('../src/cache.js', () => ({
  getCachedTools: () => ({ list_tasks: { description: 'd', execute: async () => ({}) } }),
  setCachedTools: () => {},
}))
mock.module('../src/conversation.js', () => ({
  buildMessagesWithMemory: (_c: string, h: unknown) => ({ messages: h, memoryMsg: null }),
}))
mock.module('../src/llm-orchestrator-validation.js', () => ({ validateToolResults: (m: unknown) => m }))
mock.module('../src/llm-orchestrator-config.js', () => ({ resolveTimezone: () => 'UTC' }))

const { prepareLlmInvocation } = await import('../src/llm-orchestrator-tools.js')

describe('prepareLlmInvocation compaction wiring', () => {
  beforeEach(() => {
    resolveReductionFlags.mockReset()
    applyResultCompaction.mockReset()
    applyResultCompaction.mockImplementation((tools: unknown) => tools)
  })

  it('applies compaction with enabled=true and the user text as intent', async () => {
    resolveReductionFlags.mockReturnValue({
      progressiveDisclosure: false,
      resultCompaction: true,
      semanticToolRetrieval: false,
    })
    await prepareLlmInvocation({
      contextId: 'ctx-1',
      configId: 'ctx-1',
      chatUserId: 'u1',
      username: null,
      contextType: 'dm',
      provider: { capabilities: new Set(), traits: new Set() } as never,
      history: [],
      userText: 'find overdue tasks',
      stagedDownloadFn: undefined,
      askPermission: undefined,
    })
    expect(applyResultCompaction).toHaveBeenCalledTimes(1)
    const ctxArg = applyResultCompaction.mock.calls[0]![1] as { enabled: boolean; userIntent: string }
    expect(ctxArg.enabled).toBe(true)
    expect(ctxArg.userIntent).toBe('find overdue tasks')
  })

  it('applies compaction with enabled=false when the flag is OFF', async () => {
    resolveReductionFlags.mockReturnValue({
      progressiveDisclosure: false,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
    await prepareLlmInvocation({
      contextId: 'ctx-1',
      configId: 'ctx-1',
      chatUserId: 'u1',
      username: null,
      contextType: 'dm',
      provider: { capabilities: new Set(), traits: new Set() } as never,
      history: [],
      userText: 'hi',
      stagedDownloadFn: undefined,
      askPermission: undefined,
    })
    const ctxArg = applyResultCompaction.mock.calls[0]![1] as { enabled: boolean }
    expect(ctxArg.enabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/llm-orchestrator-tools-compaction.test.ts`
Expected: FAIL — `applyResultCompaction` not called (not yet wired).

- [ ] **Step 3: Write minimal implementation**

In `src/llm-orchestrator-tools.ts`, add imports near the existing tool imports:

```ts
import { resolveReductionFlags } from './tools/feature-flags.js'
import { applyResultCompaction } from './tools/compaction/wrap-compaction.js'
```

Then, in `prepareLlmInvocation`, replace the block that currently reads:

```ts
const fullTools = applyToolPreferences(descriptors, contextId, askPermission)
const enabledToolNames = new Set(Object.keys(fullTools))
```

with:

```ts
const prefTools = applyToolPreferences(descriptors, contextId, askPermission)
const flags = resolveReductionFlags(contextId)
const fullTools = applyResultCompaction(prefTools, {
  storageContextId: contextId,
  userIntent: opts.userText,
  enabled: flags.resultCompaction,
})
const enabledToolNames = new Set(Object.keys(fullTools))
```

Confirm `opts.userText` exists on `LlmInvocationOptions` (it does — `src/llm-orchestrator-tools.ts:66`), and that `prepareLlmInvocation` destructures `opts` (currently it destructures specific fields at line 111; add `userText` there if not already destructured, or reference `opts.userText` directly as shown).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/llm-orchestrator-tools-compaction.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm-orchestrator-tools.ts tests/llm-orchestrator-tools-compaction.test.ts
git commit -m "feat(orchestrator): apply per-turn result compaction behind the flag"
```

---

### Task 10: Regression guard — flag OFF is byte-identical

**Files:**

- Test: `tests/llm-orchestrator-tools-compaction.test.ts` (add a case)

When `resultCompaction` is OFF, `applyResultCompaction` must be a pure pass-through (same object reference for the toolset), so behavior matches today exactly.

- [ ] **Step 1: Add the failing test**

```ts
// add inside the describe block in tests/tools/compaction/wrap-compaction.test.ts
it('returns the same toolset reference when disabled (no wrapping)', () => {
  const tools = { t: toolReturning({ ok: 1 }) }
  const out = applyResultCompaction(tools, { storageContextId: 'c', userIntent: 'x', enabled: false }, summarizerDeps)
  expect(out).toBe(tools)
})
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `bun test tests/tools/compaction/wrap-compaction.test.ts`
Expected: PASS already (Task 7 returns `tools` unchanged when disabled). If it FAILS, fix `applyResultCompaction` to `return tools` (same reference) on the disabled branch.

- [ ] **Step 3: Commit**

```bash
git add tests/tools/compaction/wrap-compaction.test.ts
git commit -m "test(compaction): assert flag-off is reference-identical pass-through"
```

---

### Task 11: Full-suite + lint/type/format gate

**Files:** none (verification only).

- [ ] **Step 1: Run the compaction + flags suites**

Run: `bun test tests/tools/feature-flags.test.ts tests/tools/compaction/ tests/llm-orchestrator-tools-compaction.test.ts tests/tools/provider-independent-expand-result.test.ts`
Expected: all PASS.

- [ ] **Step 2: Lint, typecheck, format on the changed files**

Run: `bun run lint && bun run typecheck && bun run format:check`
Expected: PASS for all files created/modified by this plan. (Pre-existing unrelated failures in other in-flight files are out of scope — do not modify them; if the whole-repo gate is red from unrelated WIP, scope the check to this plan's files.)

- [ ] **Step 3: Mutation-test the pure cores**

Run: `bun test:mutate:file src/tools/compaction/size-gate.ts src/tools/feature-flags.ts`
Expected: surviving mutants addressed or justified.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "chore(compaction): lint/type/format/mutation cleanup for part 1"
```

---

## Self-review (writing-plans)

**Spec coverage (F portion of `2026-06-05-tool-context-reduction-design.md`):**

- §5.3 size-gate → Task 3. summarizer (query-aware, SMALL*MODEL→main fallback, truncation fallback) → Task 5. result-store (TTL/LRU, per-context, `res*`handle) → Task 4. compacted envelope → Task 2/7.`expand_result` (paging, expired→failure) → Task 6. Per-turn wrap (deviation noted) → Task 7/9.
- §5.4 flags (three booleans, per-context override, global kill switch) → Task 1. `result_compaction` toggle wired → Task 9; `expand_result` gating → Task 8.
- §7 error handling: summarizer failure→truncation (Task 5/7), expired handle→`ToolFailureResult` (Task 6), failures/non-serializable/double-compaction never compacted (Task 3), flag-OFF identical (Task 10).
- §7 telemetry: `compaction:applied` log with `mode`/`totalBytes` (Task 7). (Debug event-bus emission deferred to Part 2's integration task to avoid touching the event schema twice; logged here.)
- Anonymity: logs carry tool name + sizes + mode only, never result content (Task 7 log fields).

**Out of scope (Part 2):** progressive disclosure (C), `search_tools`/`load_tool`, `prepareStep`, `ToolRetriever`/embeddings (B), `progressive_disclosure`/`semantic_tool_retrieval` flag behavior, discovery preamble, debug event-bus events.

**Placeholder scan:** none — every code step contains complete code.

**Type consistency:** `ReductionFlags` field names (`resultCompaction` etc.) consistent across Tasks 1/8/9. `CompactedEnvelope`/`CompactionContext` consistent across Tasks 2/7/9. `applyResultCompaction(tools, ctx, deps?)` signature consistent Tasks 7/9/10. `getResultPage`/`putResult` signatures consistent Tasks 4/6/7. `summarizeResult`/`SummarizerDeps` consistent Tasks 5/7.

**Open items to confirm during execution:** exact line numbers in `provider-independent-tools-builder.ts` and `llm-orchestrator-tools.ts` may have shifted; anchor on the function names and the quoted surrounding lines rather than absolute line numbers.

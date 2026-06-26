<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# PR #151 Review-Fix Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 9 valid findings from wKich's review of PR #151 (compaction + progressive-disclosure features), per the approved spec `docs/superpowers/specs/2026-06-11-pr151-review-fixes-design.md`.

**Architecture:** Eight independent fixes to the tool-compaction and progressive-disclosure subsystems: SDK toolCallId pass-through, single per-turn flag snapshot, true LRU result store, prompt/preference consistency for injected meta-tools, proactive-mode gating, BYOK-aware embedding retrieval with usage recording, a shared memoized LLM model builder, and a meta-only-churn stall guard.

**Tech Stack:** Bun, TypeScript (strict, `.js` import extensions), Vercel AI SDK, Zod v4, bun:test.

**Repo rules that apply to every task:**

- TDD hooks: write the failing test BEFORE touching the implementation file in `src/` — the write-hook pipeline blocks implementation edits with no failing test, then runs targeted tests + coverage after each write.
- Every new file needs the BUSL-1.1 header (`//` style for `.ts`).
- Never add lint-disable / `@ts-ignore` comments — hook policy blocks them.
- Run a targeted file with `bun test tests/path/to/file.test.ts`; full suite with `bun run test`.
- Each task ends with its own commit.

---

### Task 1 (F1/#6): `expand_result` failure uses the SDK toolCallId

**Files:**

- Modify: `src/tools/compaction/expand-result.ts:31-49`
- Test: `tests/tools/compaction/expand-result.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/tools/compaction/expand-result.test.ts`, extend the `isFailureResult` guard to carry `toolCallId` and add a test inside `describe('expand_result tool', ...)`:

```typescript
function isFailureResult(v: unknown): v is {
  success: boolean
  errorCode: string
  retryable: boolean
  toolCallId: string
} {
  return (
    typeof v === 'object' && v !== null && 'success' in v && 'errorCode' in v && 'retryable' in v && 'toolCallId' in v
  )
}
```

```typescript
it('uses the SDK toolCallId in failure results, not the handle', async () => {
  const exec = getToolExecutor(makeExpandResultTool('ctx-1'))
  const out: unknown = await exec({ handle: 'res_missing' }, { toolCallId: 'call_42', messages: [] })
  assert(isFailureResult(out), 'Expected a structured failure result')
  expect(out.toolCallId).toBe('call_42')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/compaction/expand-result.test.ts`
Expected: FAIL — `toolCallId` is `'res_missing'` (the handle), not `'call_42'`.

- [ ] **Step 3: Implement**

In `src/tools/compaction/expand-result.ts`, change the `execute` signature and the failure's `toolCallId`:

```typescript
    execute: ({ handle, offset, limit }, opts) => {
      // getToolExecutor and some SDK paths bypass schema parsing, so defaults are applied here too
      const resolvedOffset = offset ?? 0
      const resolvedLimit = limit ?? EXPAND_DEFAULT_LIMIT_BYTES
      const page = getResultPage(contextId, handle, resolvedOffset, resolvedLimit)
      if (!page.found) {
        log.warn({ contextId, handle }, 'expand_result handle not found or expired')
        const failure: ToolFailureResult = {
          success: false,
          error: 'Result handle not found or expired',
          toolName: 'expand_result',
          toolCallId: opts?.toolCallId ?? '',
          timestamp: new Date().toISOString(),
          errorType: 'tool-execution',
          errorCode: 'expired',
          userMessage: 'That cached result is no longer available.',
          agentMessage: 'The compacted result expired. Re-run the original tool to get fresh data.',
          retryable: true,
        }
        return failure
      }
      log.debug({ contextId, handle, nextOffset: page.nextOffset, done: page.done }, 'expand_result page served')
      return { chunk: page.chunk, nextOffset: page.nextOffset, done: page.done }
    },
```

(Only `toolCallId` and the `(args, opts)` signature change in this task; message wording changes in Task 3.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/compaction/expand-result.test.ts`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add tests/tools/compaction/expand-result.test.ts src/tools/compaction/expand-result.ts
git commit -m "fix(compaction): expand_result failures carry the SDK toolCallId"
```

---

### Task 2 (F2/#9): `maybeApplyDisclosure` takes the resolved flag instead of re-resolving

**Files:**

- Modify: `src/tools/disclosure/wire.ts`
- Modify: `src/llm-orchestrator-tools.ts:130`
- Test: `tests/tools/disclosure/wire.test.ts`

- [ ] **Step 1: Find all callers**

Run: `grep -rn "maybeApplyDisclosure" src/ tests/`
Expected callers: `src/tools/disclosure/wire.ts` (definition), `src/llm-orchestrator-tools.ts` (only src caller), `tests/tools/disclosure/wire.test.ts`. If any other test file calls it, update it the same way as Step 2.

- [ ] **Step 2: Rewrite the tests to drive the new signature**

In `tests/tools/disclosure/wire.test.ts`, keep the `mock.module` of `feature-flags.js` at the top (it now proves the flag is NOT re-resolved) and update every `maybeApplyDisclosure(...)` call to pass the new 4th argument. Replace the two shown tests; apply the same `{ enabled: true }` 4th arg to any remaining tests in the file that exercise the ON path:

```typescript
describe('maybeApplyDisclosure', () => {
  beforeEach(() => {
    resolveReductionFlags.mockReset()
  })

  it('is a pass-through when enabled is false', () => {
    const tools: ToolSet = { get_current_time: d(), list_tasks: d() }
    const out = maybeApplyDisclosure(tools, 'ctx-1', new LexicalToolRetriever(), { enabled: false })
    expect(out.tools).toBe(tools)
    expect(out.disclosure).toBeUndefined()
  })

  it('adds meta tools and a session when enabled is true', () => {
    const tools: ToolSet = { get_current_time: d(), list_tasks: d() }
    const out = maybeApplyDisclosure(tools, 'ctx-1', new LexicalToolRetriever(), { enabled: true })
    expect(out.tools['search_tools']).toBeDefined()
    expect(out.tools['load_tool']).toBeDefined()
    assert.ok(out.disclosure !== undefined)
    expect(out.disclosure.allNames.has('list_tasks')).toBe(true)
  })

  it('never re-resolves reduction flags itself', () => {
    const tools: ToolSet = { get_current_time: d() }
    maybeApplyDisclosure(tools, 'ctx-1', new LexicalToolRetriever(), {
      enabled: true,
    })
    maybeApplyDisclosure(tools, 'ctx-1', new LexicalToolRetriever(), {
      enabled: false,
    })
    expect(resolveReductionFlags).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/tools/disclosure/wire.test.ts`
Expected: FAIL — TypeScript/behavior mismatch (current signature has no 4th parameter and resolves flags itself).

- [ ] **Step 4: Implement**

Replace `src/tools/disclosure/wire.ts` body (drop the `feature-flags.js` import):

```typescript
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { CORE_TOOL_NAMES } from './core.js'
import { makeLoadToolTool } from './load-tool.js'
import { createDisclosureSession, type DisclosureSession } from './registry.js'
import { makeSearchToolsTool } from './search-tools.js'
import type { ToolRetriever } from './tool-retriever.js'

/** A no-op stub tool used as a placeholder key to pre-register meta-tool names in the session. */
function makePlaceholder(): ToolSet[string] {
  return tool({
    description: 'placeholder',
    inputSchema: z.object({}),
    execute: () => ({}),
  })
}

export function maybeApplyDisclosure(
  tools: ToolSet,
  contextId: string,
  retriever: ToolRetriever,
  opts: { enabled: boolean },
): { tools: ToolSet; disclosure: DisclosureSession | undefined } {
  if (!opts.enabled) return { tools, disclosure: undefined }
  // Pre-populate meta-tool keys so that the session's allNames snapshot includes them.
  const withMeta: ToolSet = {
    ...tools,
    search_tools: makePlaceholder(),
    load_tool: makePlaceholder(),
  }
  const session = createDisclosureSession(withMeta, CORE_TOOL_NAMES)
  // Overwrite placeholders with real implementations bound to the session.
  withMeta['search_tools'] = makeSearchToolsTool(session, retriever, contextId, tools)
  withMeta['load_tool'] = makeLoadToolTool(session, contextId)
  return { tools: withMeta, disclosure: session }
}
```

In `src/llm-orchestrator-tools.ts` (`buildFullToolSet`), update the call:

```typescript
const { tools: disclosedTools, disclosure } = maybeApplyDisclosure(compacted, contextId, retriever, {
  enabled: flags.progressiveDisclosure,
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/tools/disclosure/wire.test.ts && bun test tests/tools/disclosure/ tests/llm-orchestrator-system-prompt.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/disclosure/wire.ts src/llm-orchestrator-tools.ts tests/tools/disclosure/wire.test.ts
git commit -m "fix(disclosure): one reduction-flag snapshot per turn"
```

---

### Task 3 (F3/#2): Result store true LRU + neutral unavailability message

**Files:**

- Modify: `src/tools/compaction/result-store.ts:50-63`
- Modify: `src/tools/compaction/expand-result.ts` (failure wording)
- Test: `tests/tools/compaction/result-store.test.ts`, `tests/tools/compaction/expand-result.test.ts`

- [ ] **Step 1: Write the failing LRU test**

Add to `tests/tools/compaction/result-store.test.ts` (import `RESULT_STORE_MAX_ENTRIES` from `'../../../src/tools/compaction/constants.js'`):

```typescript
it('a read-refreshed entry survives overflow eviction (LRU, not FIFO)', () => {
  const first = putResult('ctx-1', 'v0')
  const second = putResult('ctx-1', 'v1')
  for (let i = 2; i < RESULT_STORE_MAX_ENTRIES; i++) putResult('ctx-1', `v${i}`)
  // Store is at cap. Reading the oldest entry refreshes its recency.
  expect(getResultPage('ctx-1', first, 0, 4)).toMatchObject({ found: true })
  putResult('ctx-1', 'overflow')
  // The read entry survives; the never-read second-oldest entry is evicted instead.
  expect(getResultPage('ctx-1', first, 0, 4)).toMatchObject({ found: true })
  expect(getResultPage('ctx-1', second, 0, 4)).toEqual({ found: false })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/compaction/result-store.test.ts`
Expected: FAIL — `first` is evicted (FIFO), `{ found: false }`.

- [ ] **Step 3: Implement LRU refresh**

In `src/tools/compaction/result-store.ts`, `getResultPage`, after the TTL check and before computing the page, refresh insertion order:

```typescript
export function getResultPage(contextId: string, handle: string, offset: number, limit: number): ResultPage {
  const m = store.get(contextId)
  const entry = m?.get(handle)
  if (m === undefined || entry === undefined) return { found: false }
  if (clock() - entry.createdAt > RESULT_STORE_TTL_MS) {
    m.delete(handle)
    if (m.size === 0) store.delete(contextId)
    return { found: false }
  }
  // Refresh recency so putResult's insertion-order eviction behaves as LRU.
  m.delete(handle)
  m.set(handle, entry)
  const start = Math.max(0, offset)
  const chunk = entry.raw.slice(start, start + Math.max(0, limit))
  const nextOffset = start + chunk.length
  return {
    found: true,
    chunk,
    nextOffset,
    done: nextOffset >= entry.raw.length,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/compaction/result-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing message-wording test**

Add to `tests/tools/compaction/expand-result.test.ts`:

```typescript
it('does not claim expiry for an unknown handle (could be eviction)', async () => {
  const exec = getToolExecutor(makeExpandResultTool('ctx-1'))
  const out: unknown = await exec({ handle: 'res_missing' })
  assert(isFailureResult(out), 'Expected a structured failure result')
  const failure = out as unknown as { error: string; agentMessage: string }
  expect(failure.error).toBe('Result handle not found, expired, or evicted')
  expect(failure.agentMessage).toBe(
    'The compacted result is no longer available (expired or evicted). Re-run the original tool to get fresh data.',
  )
})
```

Run: `bun test tests/tools/compaction/expand-result.test.ts` — expected FAIL on the old wording.

- [ ] **Step 6: Implement wording**

In `src/tools/compaction/expand-result.ts`, update the failure literal (and the log line):

```typescript
log.warn({ contextId, handle }, 'expand_result handle not found (expired or evicted)')
const failure: ToolFailureResult = {
  success: false,
  error: 'Result handle not found, expired, or evicted',
  toolName: 'expand_result',
  toolCallId: opts?.toolCallId ?? '',
  timestamp: new Date().toISOString(),
  errorType: 'tool-execution',
  errorCode: 'expired',
  userMessage: 'That cached result is no longer available.',
  agentMessage:
    'The compacted result is no longer available (expired or evicted). Re-run the original tool to get fresh data.',
  retryable: true,
}
```

`errorCode` stays `'expired'` (event-consumer stability). If other existing tests in this file assert the old `error`/`agentMessage` strings, update them to the new strings.

- [ ] **Step 7: Run tests, then commit**

Run: `bun test tests/tools/compaction/`
Expected: PASS.

```bash
git add src/tools/compaction/result-store.ts src/tools/compaction/expand-result.ts tests/tools/compaction/result-store.test.ts tests/tools/compaction/expand-result.test.ts
git commit -m "fix(compaction): true LRU result store and neutral unavailability message"
```

---

### Task 4 (F4/#4): Ask line excludes post-preferences injected meta-tools

**Files:**

- Modify: `src/tools/disclosure/core.ts`
- Modify: `src/system-prompt.ts:187-195` (`buildAskToolsLine`)
- Test: `tests/tools/disclosure/core.test.ts`, `tests/system-prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/tools/disclosure/core.test.ts`:

```typescript
it('DISCLOSURE_INJECTED_TOOL_NAMES is exactly the post-preferences injected names', async () => {
  const { DISCLOSURE_INJECTED_TOOL_NAMES } = await import('../../../src/tools/disclosure/core.js')
  expect([...DISCLOSURE_INJECTED_TOOL_NAMES].toSorted()).toEqual(['load_tool', 'search_tools'])
})
```

(Match the file's existing import style — if it imports statically at the top, add `DISCLOSURE_INJECTED_TOOL_NAMES` to that import instead of a dynamic import.)

Add to `tests/system-prompt.test.ts`, in the same `describe` block as the existing `'appends safety-net line for partially-disabled domain tools'` test (it has `provider`, `setupTestDb`, and `setToolPrefs` available):

```typescript
test('ask line omits injected meta-tools but keeps expand_result', () => {
  const contextId = 'frag-ask-meta-ctx'
  setToolPrefs(contextId, {
    domainDefaults: {},
    toolOverrides: {
      search_tools: 'ask',
      load_tool: 'ask',
      expand_result: 'ask',
    },
  })
  const enabled = new Set(['create_task', 'get_current_time', 'search_tools', 'load_tool', 'expand_result'])
  const prompt = buildSystemPrompt(provider, contextId, enabled)
  expect(prompt).toContain('expand_result')
  expect(prompt).not.toContain('- search_tools')
  expect(prompt).not.toContain('- load_tool')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/tools/disclosure/core.test.ts tests/system-prompt.test.ts`
Expected: FAIL — `DISCLOSURE_INJECTED_TOOL_NAMES` does not exist; ask line currently lists `search_tools`/`load_tool`.

- [ ] **Step 3: Implement**

In `src/tools/disclosure/core.ts`, add after `META_TOOL_NAMES`:

```typescript
/**
 * Names injected AFTER applyToolPreferences (wire.ts), so stored ask/deny overrides
 * cannot wrap them. The system prompt must not advertise preference gating for these.
 * expand_result is NOT here: it is part of the cached descriptors and preference
 * overrides on it are honored.
 */
export const DISCLOSURE_INJECTED_TOOL_NAMES: ReadonlySet<string> = new Set(['search_tools', 'load_tool'])
```

In `src/system-prompt.ts`, add the import and filter:

```typescript
import { DISCLOSURE_INJECTED_TOOL_NAMES } from './tools/disclosure/core.js'
```

```typescript
function buildAskToolsLine(prefs: ToolPrefs, exposed: ReadonlySet<string>): string | null {
  const askNames = [...exposed]
    .filter((name) => !DISCLOSURE_INJECTED_TOOL_NAMES.has(name))
    .filter((name) => resolveToolPermission(prefs, name) === 'ask')
    .toSorted()
  if (askNames.length === 0) return null
  return [
    'Some tools require user permission before each call. Listed tools must include',
    '`_permission_reason` (one sentence, present tense) describing why the call is needed:',
    askNames.map((n) => `  - ${n}`).join('\n'),
  ].join('\n')
}
```

`buildUnavailableLine` needs no change — metadata-less names are already skipped there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/tools/disclosure/core.test.ts tests/system-prompt.test.ts tests/system-prompt-disclosure.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/core.ts src/system-prompt.ts tests/tools/disclosure/core.test.ts tests/system-prompt.test.ts
git commit -m "fix(disclosure): ask line no longer advertises ungated injected meta-tools"
```

---

### Task 5 (F5/#1): Proactive mode does not register `expand_result`

**Files:**

- Modify: `src/tools/provider-independent-tools-builder.ts:86`
- Test: `tests/tools/provider-independent-tools-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside `describe('expand_result registration', ...)` in `tests/tools/provider-independent-tools-builder.test.ts`:

```typescript
it('omits expand_result in proactive mode even when compaction flag is ON', () => {
  resolveReductionFlags.mockReturnValue({
    progressiveDisclosure: false,
    resultCompaction: true,
    semanticToolRetrieval: false,
  })
  const tools: ToolSet = {}
  addProviderIndependentTools(tools, {
    ...baseOpts,
    mode: 'proactive' as const,
  })
  expect(tools['expand_result']).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/provider-independent-tools-builder.test.ts`
Expected: FAIL — `expand_result` is defined.

- [ ] **Step 3: Implement**

In `src/tools/provider-independent-tools-builder.ts`, change line 86:

```typescript
// Proactive runs never apply result compaction, so the pager must not be offered there.
if (contextId !== undefined && mode === 'normal' && resolveReductionFlags(contextId).resultCompaction) {
  tools['expand_result'] = makeExpandResultTool(contextId)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/provider-independent-tools-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/provider-independent-tools-builder.ts tests/tools/provider-independent-tools-builder.test.ts
git commit -m "fix(compaction): do not register expand_result on the proactive path"
```

---

### Task 6 (F6/#3 + #5 hardening): BYOK-aware retriever with usage recording

**Files:**

- Modify: `src/tools/disclosure/embedding-tool-retriever.ts` (full rewrite of factory + hardening in class)
- Modify: `src/llm-orchestrator-tools.ts:129` (caller)
- Test: `tests/tools/disclosure/embedding-tool-retriever.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/tools/disclosure/embedding-tool-retriever.test.ts`, add hardening tests to the `EmbeddingToolRetriever` describe block:

```typescript
it('falls back to lexical ranking when the query embed throws', async () => {
  const embed = mock((_text: string): Promise<number[] | null> => Promise.reject(new Error('network down')))
  const r = new EmbeddingToolRetriever({
    embed,
    lexical: new LexicalToolRetriever(),
    cache: new Map(),
  })
  const out = await r.rank('list tasks', briefs, 5)
  expect(out.length).toBeGreaterThan(0)
})

it('treats a throwing brief embed as missing and falls back to lexical', async () => {
  const embedFn = (text: string): Promise<number[] | null> =>
    text === 'show my tasks' ? Promise.resolve(taskVec) : Promise.reject(new Error('boom'))
  const r = new EmbeddingToolRetriever({
    embed: mock(embedFn),
    lexical: new LexicalToolRetriever(),
    cache: new Map(),
  })
  const out = await r.rank('show my tasks', briefs, 5)
  expect(out.length).toBeGreaterThan(0)
})
```

Then REPLACE the existing `getToolRetriever` describe block (currently driven by `systemConfigCacheForTesting` global config) with DI-based tests. Remove the now-unused `SYSTEM_CONFIG_KEYS`/`systemConfigCacheForTesting` imports if nothing else in the file uses them:

```typescript
import type { EffectiveLlmConfigResult } from '../../../src/llm-config-resolver.js'
import type { EmbeddingCallContext } from '../../../src/embeddings.js'
import {
  clearBriefEmbeddingCachesForTesting,
  getToolRetriever,
  type ToolRetrieverFactoryDeps,
} from '../../../src/tools/disclosure/embedding-tool-retriever.js'

const okConfig: EffectiveLlmConfigResult = {
  ok: true,
  source: 'byok',
  llmApiKey: 'byok-key',
  llmBaseUrl: 'http://byok-llm',
  mainModel: 'main-1',
  smallModel: 'small-1',
  embeddingModel: 'embed-1',
}

const missingConfig: EffectiveLlmConfigResult = {
  ok: false,
  type: 'missing',
  source: 'global',
  missing: ['llm_apikey'],
}

const callContext: EmbeddingCallContext = {
  storageContextId: 'ctx-1',
  contextType: 'dm',
  chatUserId: 'u1',
}

describe('getToolRetriever', () => {
  beforeEach(() => {
    clearBriefEmbeddingCachesForTesting()
  })

  it('returns the lexical retriever when config resolution fails', () => {
    const deps: ToolRetrieverFactoryDeps = {
      resolveConfig: mock(() => missingConfig),
      embedText: mock(() => Promise.resolve(null)),
    }
    const r = getToolRetriever('cfg-ctx', callContext, deps)
    expect(r).toBeInstanceOf(LexicalToolRetriever)
  })

  it('resolves per-context BYOK credentials and forwards the call context to embedText', async () => {
    const resolveConfig = mock((_id: string) => okConfig)
    const embedText = mock((_text: string, _key: string, _url: string, _model: string, _ctx?: EmbeddingCallContext) =>
      Promise.resolve<number[] | null>(taskVec),
    )
    const r = getToolRetriever('cfg-ctx', callContext, {
      resolveConfig,
      embedText,
    })
    await r.rank('show my tasks', briefs, 2)
    expect(resolveConfig).toHaveBeenCalledWith('cfg-ctx')
    expect(embedText).toHaveBeenCalledWith('show my tasks', 'byok-key', 'http://byok-llm', 'embed-1', callContext)
  })

  it('does not share brief caches across endpoints with the same model name', async () => {
    const otherEndpoint: EffectiveLlmConfigResult = {
      ...okConfig,
      llmBaseUrl: 'http://other-llm',
    }
    const embedA = mock((_t: string) => Promise.resolve<number[] | null>(taskVec))
    const rA = getToolRetriever('cfg-a', callContext, {
      resolveConfig: mock(() => okConfig),
      embedText: embedA,
    })
    await rA.rank('show my tasks', briefs, 2)
    const briefEmbedsA = embedA.mock.calls.length

    const embedB = mock((_t: string) => Promise.resolve<number[] | null>(webVec))
    const rB = getToolRetriever('cfg-b', callContext, {
      resolveConfig: mock(() => otherEndpoint),
      embedText: embedB,
    })
    await rB.rank('show my tasks', briefs, 2)
    // Endpoint B must embed the briefs itself (cache miss), not reuse endpoint A's vectors.
    expect(embedB.mock.calls.length).toBe(briefEmbedsA)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/tools/disclosure/embedding-tool-retriever.test.ts`
Expected: FAIL — new exports missing, old signature takes no arguments, throwing embeds propagate.

- [ ] **Step 3: Implement**

Replace `src/tools/disclosure/embedding-tool-retriever.ts` (imports + class hardening + factory):

```typescript
import { cosineSimilarity } from 'ai'

import { type EmbeddingCallContext, tryGetEmbedding } from '../../embeddings.js'
import { resolveEffectiveLlmConfig } from '../../llm-config-resolver.js'
import { logger } from '../../logger.js'
import type { ToolBrief } from './tool-brief.js'
import { LexicalToolRetriever, type RankedBrief, type ToolRetriever } from './tool-retriever.js'

const log = logger.child({ scope: 'disclosure:embedding-retriever' })

export interface EmbeddingRetrieverDeps {
  embed: (text: string) => Promise<number[] | null>
  lexical: ToolRetriever
  cache: Map<string, number[]>
}

export class EmbeddingToolRetriever implements ToolRetriever {
  private readonly deps: EmbeddingRetrieverDeps
  constructor(deps: EmbeddingRetrieverDeps) {
    this.deps = deps
  }

  async rank(query: string, briefs: ToolBrief[], limit: number): Promise<RankedBrief[]> {
    if (query.trim() === '') return []
    const queryVec = await this.safeEmbed(query)
    if (queryVec === null) return this.deps.lexical.rank(query, briefs, limit)
    const vecs = await Promise.all(briefs.map((brief) => this.embedBrief(brief)))
    const scored: RankedBrief[] = []
    for (let i = 0; i < briefs.length; i++) {
      const vec = vecs[i]
      if (vec === null || vec === undefined) continue
      if (vec.length !== queryVec.length) continue
      scored.push({ ...briefs[i]!, score: cosineSimilarity(queryVec, vec) })
    }
    if (scored.length === 0) return this.deps.lexical.rank(query, briefs, limit)
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    return scored.slice(0, limit)
  }

  // Injected embed implementations may reject; semantic ranking must degrade, not fail.
  private async safeEmbed(text: string): Promise<number[] | null> {
    try {
      return await this.deps.embed(text)
    } catch (error) {
      log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Embedding call threw; treating as unavailable',
      )
      return null
    }
  }

  private embedBrief(brief: ToolBrief): Promise<number[] | null> {
    const cached = this.deps.cache.get(brief.name)
    if (cached !== undefined) return Promise.resolve(cached)
    return this.safeEmbed(`${brief.name}. ${brief.summary} (${brief.domain})`).then((vec) => {
      if (vec !== null) this.deps.cache.set(brief.name, vec)
      return vec
    })
  }
}

const briefEmbeddingCaches = new Map<string, Map<string, number[]>>()

export function clearBriefEmbeddingCachesForTesting(): void {
  briefEmbeddingCaches.clear()
}

export interface ToolRetrieverFactoryDeps {
  resolveConfig: typeof resolveEffectiveLlmConfig
  embedText: typeof tryGetEmbedding
}

const defaultFactoryDeps: ToolRetrieverFactoryDeps = {
  resolveConfig: resolveEffectiveLlmConfig,
  embedText: tryGetEmbedding,
}

export function getToolRetriever(
  configContextId: string,
  callContext: EmbeddingCallContext,
  deps: ToolRetrieverFactoryDeps = defaultFactoryDeps,
): ToolRetriever {
  const lexical = new LexicalToolRetriever()
  const resolved = deps.resolveConfig(configContextId)
  if (!resolved.ok) return lexical
  // Key per endpoint+model: two endpoints can serve the same model name with
  // incompatible vector spaces of equal dimension.
  const cacheKey = `${resolved.llmBaseUrl}:${resolved.embeddingModel}`
  let cache = briefEmbeddingCaches.get(cacheKey)
  if (cache === undefined) {
    cache = new Map<string, number[]>()
    briefEmbeddingCaches.set(cacheKey, cache)
  }
  return new EmbeddingToolRetriever({
    embed: (text) =>
      deps.embedText(text, resolved.llmApiKey, resolved.llmBaseUrl, resolved.embeddingModel, callContext),
    lexical,
    cache,
  })
}
```

(Note: `getSystemConfig` import is gone.)

In `src/llm-orchestrator-tools.ts`, add the import and update the caller in `buildFullToolSet`:

```typescript
import { getConfigContextIdFromStorageContextId } from './chat/scoped-context.js'
```

```typescript
const retriever = flags.semanticToolRetrieval
  ? getToolRetriever(getConfigContextIdFromStorageContextId(contextId), {
      storageContextId: contextId,
      contextType,
      chatUserId,
    })
  : new LexicalToolRetriever()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/tools/disclosure/embedding-tool-retriever.test.ts && bun test tests/tools/disclosure/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/embedding-tool-retriever.ts src/llm-orchestrator-tools.ts tests/tools/disclosure/embedding-tool-retriever.test.ts
git commit -m "fix(disclosure): BYOK-aware tool retrieval with usage recording and throw-safe embeds"
```

---

### Task 7 (F7/#8): Shared memoized model builder + per-context summarizer

**Files:**

- Create: `src/llm-model-builder.ts`
- Create: `tests/llm-model-builder.test.ts`
- Modify: `src/tools/compaction/summarizer.ts`
- Modify: `src/tools/compaction/wrap-compaction.ts`
- Modify: `src/conversation.ts:6,17-26`
- Modify: `src/llm-orchestrator.ts:48-49`
- Test: `tests/tools/compaction/summarizer.test.ts`, `tests/tools/compaction/wrap-compaction.test.ts`

- [ ] **Step 1: Write the failing model-builder test**

Create `tests/llm-model-builder.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

import {
  buildChatModel,
  clearModelBuilderCacheForTesting,
  getOpenAICompatibleProvider,
  type ModelBuilderDeps,
} from '../src/llm-model-builder.js'
import { fetchWithoutTimeout } from '../src/utils/fetch.js'

function makeDeps(): ModelBuilderDeps & { create: ReturnType<typeof mock> } {
  const create = mock((opts: Parameters<typeof createOpenAICompatible>[0]) => createOpenAICompatible(opts))
  return { create }
}

describe('llm-model-builder', () => {
  beforeEach(() => {
    clearModelBuilderCacheForTesting()
  })

  it('memoizes the provider per apiKey+baseUrl', () => {
    const deps = makeDeps()
    const a = getOpenAICompatibleProvider('k1', 'http://x', deps)
    const b = getOpenAICompatibleProvider('k1', 'http://x', deps)
    expect(b).toBe(a)
    expect(deps.create).toHaveBeenCalledTimes(1)
  })

  it('wires fetchWithoutTimeout into the provider', () => {
    const deps = makeDeps()
    getOpenAICompatibleProvider('k1', 'http://x', deps)
    expect(deps.create.mock.calls[0]![0]).toMatchObject({
      apiKey: 'k1',
      baseURL: 'http://x',
      fetch: fetchWithoutTimeout,
    })
  })

  it('creates distinct providers for different credentials', () => {
    const deps = makeDeps()
    const a = getOpenAICompatibleProvider('k1', 'http://x', deps)
    const b = getOpenAICompatibleProvider('k2', 'http://x', deps)
    expect(b).not.toBe(a)
    expect(deps.create).toHaveBeenCalledTimes(2)
  })

  it('evicts the oldest provider past the cap', () => {
    for (let i = 0; i < 32; i++) getOpenAICompatibleProvider(`k${i}`, 'http://x')
    getOpenAICompatibleProvider('k-extra', 'http://x')
    const deps = makeDeps()
    getOpenAICompatibleProvider('k0', 'http://x', deps)
    expect(deps.create).toHaveBeenCalledTimes(1)
  })

  it('buildChatModel returns a model bound to the requested model name', () => {
    const model = buildChatModel('k1', 'http://x', 'small-model-1')
    expect(model).toMatchObject({ modelId: 'small-model-1' })
  })
})
```

Run: `bun test tests/llm-model-builder.test.ts` — expected FAIL (module does not exist).

- [ ] **Step 2: Implement the model builder**

Create `src/llm-model-builder.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

import { fetchWithoutTimeout } from './utils/fetch.js'

export interface ModelBuilderDeps {
  create: typeof createOpenAICompatible
}

const defaultDeps: ModelBuilderDeps = { create: createOpenAICompatible }

// BYOK alternates credentials across turns; a single-entry cache would thrash.
const MAX_CACHED_PROVIDERS = 32
const providerCache = new Map<string, OpenAICompatibleProvider>()

export function clearModelBuilderCacheForTesting(): void {
  providerCache.clear()
}

export function getOpenAICompatibleProvider(
  apiKey: string,
  baseUrl: string,
  deps: ModelBuilderDeps = defaultDeps,
): OpenAICompatibleProvider {
  const key = `${apiKey}:${baseUrl}`
  const cached = providerCache.get(key)
  if (cached !== undefined) return cached
  const provider = deps.create({
    name: 'openai-compatible',
    apiKey,
    baseURL: baseUrl,
    fetch: fetchWithoutTimeout,
  })
  if (providerCache.size >= MAX_CACHED_PROVIDERS) {
    const oldest = providerCache.keys().next().value
    if (oldest !== undefined) providerCache.delete(oldest)
  }
  providerCache.set(key, provider)
  return provider
}

export function buildChatModel(
  apiKey: string,
  baseUrl: string,
  modelName: string,
  deps: ModelBuilderDeps = defaultDeps,
): LanguageModel {
  return getOpenAICompatibleProvider(apiKey, baseUrl, deps)(modelName)
}
```

Run: `bun test tests/llm-model-builder.test.ts` — expected PASS.

- [ ] **Step 3: Write the failing summarizer tests**

In `tests/tools/compaction/summarizer.test.ts`:

- The file's top-level `mock.module('../../../src/llm-config-resolver.js', ...)` (returns a missing config) stays.
- Add to the imports: `buildSummarizerDeps` from the summarizer module.
- Existing tests that pass explicit `deps` keep working (signature stays compatible: second param).
- Add:

```typescript
describe('buildSummarizerDeps', () => {
  it('returns null when per-context config resolution fails', () => {
    expect(buildSummarizerDeps('cfg-ctx')).toBeNull()
  })
})

describe('summarizeResult with null deps', () => {
  it('returns a null summary', async () => {
    const out = await summarizeResult({ serialized: 'x', totalBytes: 10, toolName: 't', userIntent: 'i' }, null)
    expect(out.summary).toBeNull()
  })
})
```

If the file has an existing test exercising the no-deps default path (the old `'global'` fallback), replace it with the two tests above.

Run: `bun test tests/tools/compaction/summarizer.test.ts` — expected FAIL (`buildSummarizerDeps` not exported; `null` not accepted).

- [ ] **Step 4: Implement the summarizer change**

Replace `buildDefaultDeps`/`summarizeResult` in `src/tools/compaction/summarizer.ts`:

```typescript
import { generateText } from 'ai'

import { buildChatModel } from '../../llm-model-builder.js'
import { resolveEffectiveLlmConfig } from '../../llm-config-resolver.js'
import { logger } from '../../logger.js'
```

(drop the `createOpenAICompatible` and `LanguageModel` imports)

```typescript
/** Resolves per-context (BYOK-aware) credentials once; callers should build this once per turn. */
export function buildSummarizerDeps(configContextId: string): SummarizerDeps | null {
  const resolved = resolveEffectiveLlmConfig(configContextId)
  if (!resolved.ok) return null
  const model = buildChatModel(resolved.llmApiKey, resolved.llmBaseUrl, resolved.smallModel)
  return {
    generate: async (opts) => {
      const result = await generateText({
        model,
        system: opts.system,
        prompt: opts.prompt,
      })
      return { text: result.text }
    },
  }
}

export async function summarizeResult(
  input: SummarizeInput,
  deps: SummarizerDeps | null,
): Promise<{ summary: string | null }> {
  if (deps === null) return { summary: null }

  const slice = input.serialized.slice(0, PROMPT_INPUT_BUDGET)
  const prompt = [
    `Tool: ${input.toolName}`,
    `User intent: ${input.userIntent}`,
    `Total bytes: ${input.totalBytes}`,
    'Result (possibly truncated):',
    slice,
  ].join('\n')

  try {
    const { text } = await deps.generate({ system: SYSTEM, prompt })
    const trimmed = text.trim()
    return { summary: trimmed === '' ? null : trimmed }
  } catch (error) {
    log.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        tool: input.toolName,
      },
      'Summarize failed',
    )
    return { summary: null }
  }
}
```

- [ ] **Step 5: Update wrap-compaction to build deps once per turn**

In `src/tools/compaction/wrap-compaction.ts`, replace the `defaultDeps` constant with a per-turn builder (add the scoped-context import):

```typescript
import { getConfigContextIdFromStorageContextId } from '../../chat/scoped-context.js'
import { buildSummarizerDeps, summarizeResult } from './summarizer.js'
```

```typescript
// Resolve credentials and build the summarizer model once per turn, not per oversized result.
function buildTurnDeps(storageContextId: string): WrapCompactionDeps {
  const summarizerDeps = buildSummarizerDeps(getConfigContextIdFromStorageContextId(storageContextId))
  return { summarize: (input) => summarizeResult(input, summarizerDeps) }
}

export function applyResultCompaction(tools: ToolSet, ctx: CompactionContext, deps?: WrapCompactionDeps): ToolSet {
  if (!ctx.enabled) return tools
  const resolvedDeps = deps ?? buildTurnDeps(ctx.storageContextId)
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    if (t === undefined) continue
    if (t.execute === undefined || NEVER_COMPACT.has(name)) {
      out[name] = t
      continue
    }
    const inner = t.execute.bind(t)
    out[name] = {
      ...t,
      execute: (input: unknown, options: ToolExecutionOptions): Promise<unknown> =>
        Promise.resolve(inner(input, options)).then((result) => compact(result, name, ctx, resolvedDeps)),
    }
  }
  return out
}
```

(`compact` itself is unchanged.) Run `bun test tests/tools/compaction/` and fix any wrap-compaction test that constructed the old `defaultDeps` path — DI tests passing explicit `deps` are unaffected.

- [ ] **Step 6: Migrate conversation.ts and llm-orchestrator.ts**

`src/conversation.ts` — drop the `createOpenAICompatible` import and the local `buildModel`, delegate to the shared helper:

```typescript
import { buildChatModel } from './llm-model-builder.js'
```

```typescript
const defaultConversationDeps: ConversationDeps = {
  buildModel: (apiKey, baseUrl, modelName) => buildChatModel(apiKey, baseUrl, modelName),
}
```

`src/llm-orchestrator.ts` — in `defaultDeps`, replace the inline `createOpenAICompatible` call (the type in `llm-orchestrator-types.ts:18` is `ReturnType<typeof createOpenAICompatible>`, which `getOpenAICompatibleProvider` satisfies):

```typescript
import { getOpenAICompatibleProvider } from './llm-model-builder.js'
```

```typescript
  buildOpenAI: (apiKey: string, baseURL: string) => getOpenAICompatibleProvider(apiKey, baseURL),
```

Remove the now-unused `createOpenAICompatible` and `fetchWithoutTimeout` imports from `llm-orchestrator.ts` if nothing else in the file uses them.

- [ ] **Step 7: Run the affected suites**

Run: `bun test tests/llm-model-builder.test.ts tests/tools/compaction/ tests/conversation.test.ts`
Expected: PASS. (`tests/tools/compaction/wrap-compaction.test.ts` passes explicit DI deps in every test, so it is unaffected by the default-deps change.)

- [ ] **Step 8: Commit**

```bash
git add src/llm-model-builder.ts tests/llm-model-builder.test.ts src/tools/compaction/summarizer.ts src/tools/compaction/wrap-compaction.ts src/conversation.ts src/llm-orchestrator.ts tests/tools/compaction/summarizer.test.ts tests/tools/compaction/wrap-compaction.test.ts
git commit -m "fix(llm): shared memoized model builder; per-context summarizer credentials"
```

---

### Task 8 (F8/#7): Meta-only-churn secondary stall guard

**Files:**

- Modify: `src/tools/disclosure/prepare-step.ts`
- Test: `tests/tools/disclosure/prepare-step.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/tools/disclosure/prepare-step.test.ts` (inside the existing describe; `freshSession`, `emitUser`, `DISCLOSURE_STALL_STEPS` already in scope):

```typescript
const metaStep = { toolCalls: [{ toolName: 'search_tools' }] }
const realStep = { toolCalls: [{ toolName: 'list_tasks' }] }

it('opens all tools when the last N completed steps are meta-only churn after a load', () => {
  const session = freshSession()
  session.markLoaded(['list_tasks'])
  const prep = createDisclosurePrepareStep(session, 'ctx-1')
  const out = prep({ stepNumber: 5, steps: [realStep, metaStep, metaStep] })
  expect(out).toEqual({})
  expect(emitUser).toHaveBeenCalledTimes(1)
})

it('does not churn-fallback when a recent step called a real tool', () => {
  const session = freshSession()
  session.markLoaded(['list_tasks'])
  const prep = createDisclosurePrepareStep(session, 'ctx-1')
  const out = prep({ stepNumber: 5, steps: [metaStep, realStep] })
  expect(out.activeTools).toBeDefined()
  expect(emitUser).not.toHaveBeenCalled()
})

it('a step with zero tool calls does not count toward churn', () => {
  const session = freshSession()
  session.markLoaded(['list_tasks'])
  const prep = createDisclosurePrepareStep(session, 'ctx-1')
  const out = prep({ stepNumber: 5, steps: [{ toolCalls: [] }, metaStep] })
  expect(out.activeTools).toBeDefined()
})

it('stays open after a churn fallback even when a later step looks healthy', () => {
  const session = freshSession()
  session.markLoaded(['list_tasks'])
  const prep = createDisclosurePrepareStep(session, 'ctx-1')
  expect(prep({ stepNumber: 5, steps: [metaStep, metaStep] })).toEqual({})
  expect(prep({ stepNumber: 6, steps: [metaStep, metaStep, realStep] })).toEqual({})
  expect(emitUser).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/tools/disclosure/prepare-step.test.ts`
Expected: FAIL — churn cases return `activeTools` today.

- [ ] **Step 3: Implement**

Replace the body of `src/tools/disclosure/prepare-step.ts`:

```typescript
import { emitUser } from '../../debug/event-bus.js'
import { logger } from '../../logger.js'
import { DISCLOSURE_INJECTED_TOOL_NAMES, DISCLOSURE_STALL_STEPS } from './core.js'
import type { DisclosureSession } from './registry.js'

const log = logger.child({ scope: 'disclosure:prepare-step' })

type CompletedStep = { toolCalls?: ReadonlyArray<{ toolName: string }> }
type PrepareStepArg = { stepNumber: number; steps?: readonly CompletedStep[] }
type PrepareStepResult = { activeTools?: string[] }

function isMetaOnlyStep(step: CompletedStep): boolean {
  const calls = step.toolCalls ?? []
  if (calls.length === 0) return false
  return calls.every((c) => DISCLOSURE_INJECTED_TOOL_NAMES.has(c.toolName))
}

/** True when the trailing window is nothing but search/load churn — discovery without progress. */
function isMetaChurn(steps: readonly CompletedStep[] | undefined): boolean {
  if (steps === undefined || steps.length < DISCLOSURE_STALL_STEPS) return false
  return steps.slice(-DISCLOSURE_STALL_STEPS).every((step) => isMetaOnlyStep(step))
}

export function createDisclosurePrepareStep(
  session: DisclosureSession,
  contextId: string,
  turnId?: string,
): (arg: PrepareStepArg) => PrepareStepResult {
  // Latch: once opened, stay open for the turn — re-narrowing would strip tools mid-flow.
  let fallbackOpen = false
  return ({ stepNumber, steps }) => {
    const preLoadStall = !session.hasLoaded() && stepNumber >= DISCLOSURE_STALL_STEPS
    if (fallbackOpen || preLoadStall || isMetaChurn(steps)) {
      if (!fallbackOpen) {
        fallbackOpen = true
        emitUser('disclosure:fallback', contextId, { stepNumber }, turnId)
        log.warn({ contextId, stepNumber, turnId }, 'Disclosure stalled; opening all tools')
      }
      return {}
    }
    return { activeTools: session.activeToolNames() }
  }
}
```

Behavior parity: the existing pre-load tests still pass — the `fallbackOpen` latch reproduces the old "fires once, keeps returning `{}`" behavior (`hasLoaded()` stays false in those tests).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/tools/disclosure/prepare-step.test.ts && bun test tests/tools/disclosure/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/prepare-step.ts tests/tools/disclosure/prepare-step.test.ts
git commit -m "fix(disclosure): catch post-load search/load churn with a latched stall guard"
```

---

### Task 9: Documentation updates + full verification

**Files:**

- Modify: `CLAUDE.md` (Tools section, result-compaction and progressive-disclosure paragraphs)
- Modify: `src/tools/CLAUDE.md` (Assembly section)

- [ ] **Step 1: Update CLAUDE.md**

In the root `CLAUDE.md` result-compaction paragraph, change:

- "the flag-gated `expand_result` tool pages the stored raw result" → "the flag-gated `expand_result` tool (registered only in `normal` mode — proactive runs never compact) pages the stored raw result".

In the progressive-disclosure paragraph, change:

- "a stall fallback opens all tools after 2 steps with no real loads (`disclosure:fallback` event)" → "a latched stall fallback opens all tools after 2 steps with no real loads, or when the last 2 completed steps were nothing but `search_tools`/`load_tool` churn (`disclosure:fallback` event)".

In `src/tools/CLAUDE.md` Assembly section:

- In the result-compaction bullet, change "(registered in `provider-independent-tools-builder.ts` only when the flag is ON)" → "(registered in `provider-independent-tools-builder.ts` only when the flag is ON and `mode` is `normal`)".
- In the progressive-disclosure bullet, change "after `DISCLOSURE_STALL_STEPS` (2) with no real loads it returns `{}` (all tools) and emits `disclosure:fallback` once — loading always-on names does not count" → "after `DISCLOSURE_STALL_STEPS` (2) with no real loads, or when the trailing 2 completed steps contain only `search_tools`/`load_tool` calls, it latches open (`{}`, all tools) and emits `disclosure:fallback` once — loading always-on names does not count".

- [ ] **Step 2: Full verification**

Run: `bun build:client` (if not already built) then `bun run test`
Expected: all server suites PASS.

Run: `bun check:full`
Expected: lint/typecheck/format/knip pass.

Run: `bun test:mutate:changed`
Expected: no surviving mutants in the touched files (CI gate).

- [ ] **Step 3: Commit and push**

```bash
git add CLAUDE.md src/tools/CLAUDE.md
git commit -m "docs: reflect proactive gating, LRU store, and churn stall guard"
git push
```

---

## Out of Scope (from the approved spec)

- #10 first-sentence regex (wontfix, cosmetic).
- Proactive-path compaction/disclosure parity.
- Migrating `src/embeddings.ts`'s own provider cache to the model builder.
- Threaded PR replies (user decision: just fix).

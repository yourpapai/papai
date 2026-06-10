<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tool-Context Reduction — Part 2: Progressive Disclosure (C) + Semantic Tool Retrieval (B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behind the per-context `progressive_disclosure` flag (default OFF), show the model only a minimal always-on core plus `search_tools`/`load_tool`/`expand_result`, and let it discover and explicitly load the tools it needs mid-task via AI SDK v6 `prepareStep`/`activeTools`. `search_tools` results are ranked by a `ToolRetriever` (embedding-backed when an embedding model is configured, lexical fallback otherwise).

**Architecture:** A turn-scoped `DisclosureSession` (created in `prepareLlmInvocation`, never cached) tracks the set of loaded tool names. `search_tools` returns ranked briefs (no JSON schemas); `load_tool` appends to the session. `invokeModel` attaches a `prepareStep` that returns `activeTools = CORE ∪ META ∪ loaded`, so only loaded tool schemas are serialized each step. A stall fallback opens all tools if the model never loads anything. The full descriptor set is still registered as `generateText`'s `tools`, so execution, permissions, and Part 1 compaction are unchanged.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Zod v4, Vercel AI SDK v6 (`ai` — `prepareStep`, `activeTools`, `cosineSimilarity`), `@ai-sdk/openai-compatible`, pino. Tests: `bun test`, DI-first.

This is Part 2 of 2. **Depends on Part 1** (`feature-flags.ts`, `compaction/*`, `expand_result` registration). Spec: `docs/superpowers/specs/2026-06-05-tool-context-reduction-design.md`.

---

## Spec refinements (vs §5.1–5.2 of the spec)

1. **Briefs derive `summary` from each tool's own `.description`** and `domain` from `getToolMetadata(name)?.domain`. `TOOL_METADATA` (`src/tools/tool-metadata.ts:57`) holds `{ domain, operation, risk }` only — there is no separate summary field — and `getToolMetadata` already infers `domain: 'mcp'`/`'plugin'` for namespaced tools.
2. **`enabledToolNames` passed to the system prompt stays the full registered set** (so capability fragments like DUE*DATES are present and the model knows what it \_can* load); a new discovery preamble tells it the tools are unloaded. `activeTools` — not `enabledToolNames` — controls what is callable per step.
3. **CORE vs META** (matching the spec's self-reviewed split): `CORE_TOOL_NAMES = {get_current_time}`; `META_TOOL_NAMES = {search_tools, load_tool, expand_result}`. `expand_result` is registered by Part 1 (compaction flag); `search_tools`/`load_tool` are registered here (disclosure flag).

---

## File structure

**Create:**

- `src/tools/disclosure/core.ts` — `CORE_TOOL_NAMES`, `META_TOOL_NAMES`, `DISCLOSURE_STALL_STEPS`.
- `src/tools/disclosure/tool-brief.ts` — `ToolBrief`, `buildBriefs(tools)`.
- `src/tools/disclosure/tool-retriever.ts` — `ToolRetriever`, `LexicalToolRetriever`, `EmbeddingToolRetriever`, `getToolRetriever()`.
- `src/tools/disclosure/registry.ts` — `DisclosureSession`, `createDisclosureSession(...)`.
- `src/tools/disclosure/search-tools.ts` — `makeSearchToolsTool(session, retriever, contextId)`.
- `src/tools/disclosure/load-tool.ts` — `makeLoadToolTool(session, contextId)`.
- `src/tools/disclosure/prepare-step.ts` — `createDisclosurePrepareStep(session, contextId)`.
- `src/tools/disclosure/wire.ts` — `maybeApplyDisclosure(tools, contextId, retriever)` → `{ tools, disclosure }`.
- Tests mirroring each under `tests/tools/disclosure/...` plus an orchestrator integration test.

**Modify:**

- `src/system-prompt.ts` — add a discovery-preamble fragment + a `progressiveDisclosure` option on `buildSystemPrompt`/`buildProviderlessSystemPrompt`.
- `src/llm-orchestrator-types.ts` — add `disclosure?: DisclosureSession` to `InvokeModelArgs`.
- `src/llm-orchestrator-tools.ts` — create the session + add meta-tools in `prepareLlmInvocation`; return `disclosure`.
- `src/llm-orchestrator.ts` — pass `disclosure` through to `invokeModelWithTyping`.
- `src/llm-orchestrator-invoke.ts` — attach `prepareStep` and pass the disclosure flag to the prompt builder.

---

### Task 1: Core / meta constants

**Files:**

- Create: `src/tools/disclosure/core.ts`
- Test: `tests/tools/disclosure/core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/disclosure/core.test.ts
import { describe, expect, it } from 'bun:test'

import {
  CORE_TOOL_NAMES,
  META_TOOL_NAMES,
  ALWAYS_ON_TOOL_NAMES,
  DISCLOSURE_STALL_STEPS,
} from '../../../src/tools/disclosure/core.js'

describe('disclosure core constants', () => {
  it('keeps get_current_time as the only domain-essential core', () => {
    expect([...CORE_TOOL_NAMES]).toEqual(['get_current_time'])
  })

  it('exposes the three meta tools', () => {
    expect([...META_TOOL_NAMES].toSorted()).toEqual(['expand_result', 'load_tool', 'search_tools'])
  })

  it('ALWAYS_ON is the union of core and meta', () => {
    expect(ALWAYS_ON_TOOL_NAMES.has('get_current_time')).toBe(true)
    expect(ALWAYS_ON_TOOL_NAMES.has('search_tools')).toBe(true)
    expect(ALWAYS_ON_TOOL_NAMES.size).toBe(4)
  })

  it('uses a small positive stall threshold', () => {
    expect(DISCLOSURE_STALL_STEPS).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/disclosure/core.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/disclosure/core.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Domain-essential tools that are always active under progressive disclosure. */
export const CORE_TOOL_NAMES: ReadonlySet<string> = new Set(['get_current_time'])

/** Disclosure machinery, always active. expand_result is registered by the compaction flag. */
export const META_TOOL_NAMES: ReadonlySet<string> = new Set(['search_tools', 'load_tool', 'expand_result'])

export const ALWAYS_ON_TOOL_NAMES: ReadonlySet<string> = new Set([...CORE_TOOL_NAMES, ...META_TOOL_NAMES])

/** Steps with zero load_tool activity after which disclosure opens all tools (fail-safe). */
export const DISCLOSURE_STALL_STEPS = 2
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/disclosure/core.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/core.ts tests/tools/disclosure/core.test.ts
git commit -m "feat(disclosure): core/meta tool-name constants and stall threshold"
```

---

### Task 2: Tool briefs

**Files:**

- Create: `src/tools/disclosure/tool-brief.ts`
- Test: `tests/tools/disclosure/tool-brief.test.ts`

`buildBriefs(tools)` maps each tool to `{ name, summary, domain }`: `summary` = first sentence of the tool's `.description` (capped at 160 chars; empty when no description), `domain` = `getToolMetadata(name)?.domain ?? 'other'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/disclosure/tool-brief.test.ts
import { describe, expect, it } from 'bun:test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { buildBriefs } from '../../../src/tools/disclosure/tool-brief.js'

const t = (description: string): ToolSet[string] =>
  tool({ description, inputSchema: z.object({}), execute: async () => ({}) })

describe('buildBriefs', () => {
  it('uses the first sentence of the description as the summary', () => {
    const briefs = buildBriefs({
      list_tasks: t('List tasks in a project. Supports filters and paging.'),
    })
    expect(briefs[0]).toEqual({
      name: 'list_tasks',
      summary: 'List tasks in a project.',
      domain: 'task',
    })
  })

  it('derives mcp domain for namespaced tools and tolerates empty descriptions', () => {
    const briefs = buildBriefs({ mcp_github__get_issue: t('') })
    expect(briefs[0]!.domain).toBe('mcp')
    expect(briefs[0]!.summary).toBe('')
  })

  it('caps very long single-sentence summaries', () => {
    const long = `${'word '.repeat(60)}done`
    const briefs = buildBriefs({ web_fetch: t(long) })
    expect(briefs[0]!.summary.length).toBeLessThanOrEqual(160)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/disclosure/tool-brief.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/disclosure/tool-brief.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import { getToolMetadata } from '../tool-metadata.js'

export interface ToolBrief {
  name: string
  summary: string
  domain: string
}

const SUMMARY_CAP = 160

function firstSentence(description: string | undefined): string {
  if (description === undefined) return ''
  const trimmed = description.trim()
  if (trimmed === '') return ''
  const match = trimmed.match(/^.*?[.!?](\s|$)/s)
  const sentence = (match === null ? trimmed : match[0]).trim()
  return sentence.length > SUMMARY_CAP ? `${sentence.slice(0, SUMMARY_CAP - 1)}…` : sentence
}

export function buildBriefs(tools: ToolSet): ToolBrief[] {
  const briefs: ToolBrief[] = []
  for (const [name, t] of Object.entries(tools)) {
    if (t === undefined) continue
    briefs.push({
      name,
      summary: firstSentence(t.description),
      domain: getToolMetadata(name)?.domain ?? 'other',
    })
  }
  return briefs
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/disclosure/tool-brief.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/tool-brief.ts tests/tools/disclosure/tool-brief.test.ts
git commit -m "feat(disclosure): tool-brief builder from descriptions + metadata"
```

---

### Task 3: Lexical retriever

**Files:**

- Create: `src/tools/disclosure/tool-retriever.ts` (lexical impl + interface; embedding impl added in Task 4)
- Test: `tests/tools/disclosure/lexical-retriever.test.ts`

Lexical scoring: lowercase token overlap across `name + summary + domain`, plus a small substring bonus. Deterministic ordering; empty query → `[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/disclosure/lexical-retriever.test.ts
import { describe, expect, it } from 'bun:test'

import { LexicalToolRetriever } from '../../../src/tools/disclosure/tool-retriever.js'
import type { ToolBrief } from '../../../src/tools/disclosure/tool-brief.js'

const briefs: ToolBrief[] = [
  { name: 'list_tasks', summary: 'List tasks in a project.', domain: 'task' },
  { name: 'web_fetch', summary: 'Fetch a public web page.', domain: 'web' },
  { name: 'save_memo', summary: 'Save a personal note.', domain: 'memo' },
]

describe('LexicalToolRetriever', () => {
  const r = new LexicalToolRetriever()

  it('ranks the most relevant brief first', async () => {
    const out = await r.rank('list my tasks', briefs, 2)
    expect(out[0]!.name).toBe('list_tasks')
    expect(out.length).toBe(2)
  })

  it('returns empty for an empty query', async () => {
    expect(await r.rank('   ', briefs, 5)).toEqual([])
  })

  it('returns no matches as empty when nothing overlaps', async () => {
    expect(await r.rank('zzzzz', briefs, 5)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/disclosure/lexical-retriever.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/disclosure/tool-retriever.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolBrief } from './tool-brief.js'

export type RankedBrief = ToolBrief & { score: number }

export interface ToolRetriever {
  rank(query: string, briefs: ToolBrief[], limit: number): Promise<RankedBrief[]>
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length > 1)
}

export class LexicalToolRetriever implements ToolRetriever {
  rank(query: string, briefs: ToolBrief[], limit: number): Promise<RankedBrief[]> {
    const qTokens = new Set(tokenize(query))
    if (qTokens.size === 0) return Promise.resolve([])
    const qText = query.toLowerCase()
    const scored: RankedBrief[] = []
    for (const brief of briefs) {
      const haystack = `${brief.name} ${brief.summary} ${brief.domain}`.toLowerCase()
      const hTokens = tokenize(haystack)
      let overlap = 0
      for (const tok of hTokens) if (qTokens.has(tok)) overlap += 1
      const substringBonus = qText.length > 2 && haystack.includes(qText) ? 1 : 0
      const score = overlap + substringBonus
      if (score > 0) scored.push({ ...brief, score })
    }
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    return Promise.resolve(scored.slice(0, limit))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/disclosure/lexical-retriever.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/tool-retriever.ts tests/tools/disclosure/lexical-retriever.test.ts
git commit -m "feat(disclosure): ToolRetriever interface + lexical implementation"
```

---

### Task 4: Embedding retriever + selector

**Files:**

- Modify: `src/tools/disclosure/tool-retriever.ts` (add `EmbeddingToolRetriever` + `getToolRetriever`)
- Test: `tests/tools/disclosure/embedding-retriever.test.ts`

`EmbeddingToolRetriever` takes `{ embed, lexical, cache }` where `embed(text) => Promise<number[] | null>`. It embeds the query (null → fall back to lexical), embeds each brief (cached by `name` in the provided `Map`), and ranks by `cosineSimilarity`. If no brief embeds, falls back to lexical. `getToolRetriever()` returns an `EmbeddingToolRetriever` wired to `tryGetEmbedding` when `embedding_model` + creds are present, else a `LexicalToolRetriever`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/disclosure/embedding-retriever.test.ts
import { describe, expect, it, mock } from 'bun:test'

import { EmbeddingToolRetriever, LexicalToolRetriever } from '../../../src/tools/disclosure/tool-retriever.js'
import type { ToolBrief } from '../../../src/tools/disclosure/tool-brief.js'

const briefs: ToolBrief[] = [
  { name: 'list_tasks', summary: 'List tasks.', domain: 'task' },
  { name: 'web_fetch', summary: 'Fetch web page.', domain: 'web' },
]

// Fake embeddings: tasks → [1,0]; web → [0,1]; query "tasks" → [1,0].
const vectors: Record<string, number[]> = {
  list_tasks: [1, 0],
  web_fetch: [0, 1],
  q_tasks: [1, 0],
  q_web: [0, 1],
}

describe('EmbeddingToolRetriever', () => {
  it('ranks by cosine similarity to the query embedding', async () => {
    const embed = mock(async (text: string) => {
      if (text.includes('List tasks')) return vectors['list_tasks']!
      if (text.includes('Fetch web')) return vectors['web_fetch']!
      return vectors['q_tasks']!
    })
    const r = new EmbeddingToolRetriever({
      embed,
      lexical: new LexicalToolRetriever(),
      cache: new Map(),
    })
    const out = await r.rank('show my tasks', briefs, 2)
    expect(out[0]!.name).toBe('list_tasks')
  })

  it('caches brief embeddings across calls (embeds each brief once)', async () => {
    const embed = mock(async (text: string) =>
      text.includes('Fetch web') ? vectors['web_fetch']! : vectors['list_tasks']!,
    )
    const cache = new Map<string, number[]>()
    const r = new EmbeddingToolRetriever({
      embed,
      lexical: new LexicalToolRetriever(),
      cache,
    })
    await r.rank('tasks', briefs, 2)
    const callsAfterFirst = embed.mock.calls.length
    await r.rank('tasks again', briefs, 2)
    // second call only embeds the query, not the two briefs again.
    expect(embed.mock.calls.length).toBe(callsAfterFirst + 1)
  })

  it('falls back to lexical when the query embedding is null', async () => {
    const embed = mock(async () => null)
    const lexical = new LexicalToolRetriever()
    const r = new EmbeddingToolRetriever({ embed, lexical, cache: new Map() })
    const out = await r.rank('list tasks', briefs, 2)
    expect(out[0]!.name).toBe('list_tasks') // lexical handled it
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/disclosure/embedding-retriever.test.ts`
Expected: FAIL — `EmbeddingToolRetriever` / `getToolRetriever` not exported yet.

- [ ] **Step 3: Write minimal implementation**

Append to `src/tools/disclosure/tool-retriever.ts`:

```ts
import { cosineSimilarity } from 'ai'

import { tryGetEmbedding } from '../../embeddings.js'
import { getSystemConfig } from '../../system-config.js'

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
    const queryVec = await this.deps.embed(query)
    if (queryVec === null) return this.deps.lexical.rank(query, briefs, limit)
    const scored: RankedBrief[] = []
    for (const brief of briefs) {
      const vec = await this.embedBrief(brief)
      if (vec === null) continue
      scored.push({ ...brief, score: cosineSimilarity(queryVec, vec) })
    }
    if (scored.length === 0) return this.deps.lexical.rank(query, briefs, limit)
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    return scored.slice(0, limit)
  }

  private async embedBrief(brief: ToolBrief): Promise<number[] | null> {
    const cached = this.deps.cache.get(brief.name)
    if (cached !== undefined) return cached
    const vec = await this.deps.embed(`${brief.name}. ${brief.summary} (${brief.domain})`)
    if (vec !== null) this.deps.cache.set(brief.name, vec)
    return vec
  }
}

const briefEmbeddingCache = new Map<string, number[]>()

export function getToolRetriever(): ToolRetriever {
  const apiKey = getSystemConfig('llm_apikey')
  const baseUrl = getSystemConfig('llm_baseurl')
  const embeddingModel = getSystemConfig('embedding_model')
  const lexical = new LexicalToolRetriever()
  if (apiKey === null || baseUrl === null || embeddingModel === null) return lexical
  return new EmbeddingToolRetriever({
    embed: (text) => tryGetEmbedding(text, apiKey, baseUrl, embeddingModel),
    lexical,
    cache: briefEmbeddingCache,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/disclosure/embedding-retriever.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/tool-retriever.ts tests/tools/disclosure/embedding-retriever.test.ts
git commit -m "feat(disclosure): embedding-backed retriever with lexical fallback and brief cache"
```

---

### Task 5: DisclosureSession registry

**Files:**

- Create: `src/tools/disclosure/registry.ts`
- Test: `tests/tools/disclosure/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/disclosure/registry.test.ts
import { describe, expect, it } from 'bun:test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { createDisclosureSession } from '../../../src/tools/disclosure/registry.js'
import { CORE_TOOL_NAMES } from '../../../src/tools/disclosure/core.js'

const stub = (): ToolSet[string] =>
  tool({
    description: 'x',
    inputSchema: z.object({}),
    execute: async () => ({}),
  })

function sessionWith(names: string[]) {
  const tools: ToolSet = {}
  for (const n of names) tools[n] = stub()
  return createDisclosureSession(tools, CORE_TOOL_NAMES)
}

describe('DisclosureSession', () => {
  it('activeToolNames starts as core ∪ meta only', () => {
    const s = sessionWith(['get_current_time', 'search_tools', 'load_tool', 'list_tasks', 'web_fetch'])
    expect(s.activeToolNames().toSorted()).toEqual(['get_current_time', 'load_tool', 'search_tools'])
  })

  it('load adds known names and reports unknown ones', () => {
    const s = sessionWith(['get_current_time', 'search_tools', 'load_tool', 'list_tasks'])
    const res = s.markLoaded(['list_tasks', 'nope'])
    expect(res).toEqual({ loaded: ['list_tasks'], unknown: ['nope'] })
    expect(s.activeToolNames()).toContain('list_tasks')
    expect(s.hasLoaded()).toBe(true)
  })

  it('load is idempotent and never returns names outside allNames', () => {
    const s = sessionWith(['get_current_time', 'search_tools', 'load_tool', 'list_tasks'])
    s.markLoaded(['list_tasks'])
    s.markLoaded(['list_tasks'])
    const active = s.activeToolNames()
    expect(active.filter((n) => n === 'list_tasks').length).toBe(1)
    expect(active.every((n) => s.allNames.has(n))).toBe(true)
  })

  it('hasLoaded is false before any successful load', () => {
    const s = sessionWith(['get_current_time', 'search_tools', 'load_tool'])
    s.markLoaded(['unknown_only'])
    expect(s.hasLoaded()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/disclosure/registry.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/disclosure/registry.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import { ALWAYS_ON_TOOL_NAMES } from './core.js'

export interface DisclosureSession {
  readonly coreNames: ReadonlySet<string>
  readonly allNames: ReadonlySet<string>
  activeToolNames(): string[]
  markLoaded(names: readonly string[]): { loaded: string[]; unknown: string[] }
  hasLoaded(): boolean
}

export function createDisclosureSession(fullTools: ToolSet, coreNames: ReadonlySet<string>): DisclosureSession {
  const allNames = new Set(Object.keys(fullTools))
  const loaded = new Set<string>()

  const activeToolNames = (): string[] => {
    const active = new Set<string>()
    for (const n of coreNames) if (allNames.has(n)) active.add(n)
    for (const n of ALWAYS_ON_TOOL_NAMES) if (allNames.has(n)) active.add(n)
    for (const n of loaded) if (allNames.has(n)) active.add(n)
    return [...active]
  }

  const markLoaded = (names: readonly string[]): { loaded: string[]; unknown: string[] } => {
    const ok: string[] = []
    const unknown: string[] = []
    for (const n of names) {
      if (allNames.has(n)) {
        if (!loaded.has(n)) loaded.add(n)
        ok.push(n)
      } else {
        unknown.push(n)
      }
    }
    return { loaded: ok, unknown }
  }

  return {
    coreNames,
    allNames,
    activeToolNames,
    markLoaded,
    hasLoaded: () => loaded.size > 0,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/disclosure/registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/registry.ts tests/tools/disclosure/registry.test.ts
git commit -m "feat(disclosure): turn-scoped DisclosureSession registry"
```

---

### Task 6: `search_tools` tool

**Files:**

- Create: `src/tools/disclosure/search-tools.ts`
- Test: `tests/tools/disclosure/search-tools.test.ts`

Returns ranked briefs (`{ name, summary, domain, alreadyLoaded }`) with **no input schemas**. Emits `disclosure:search` (query length + result count only — never the query text or content). Briefs are built from the session's registered tools minus the always-on set (no point surfacing always-active tools).

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/disclosure/search-tools.test.ts
import { describe, expect, it, mock } from 'bun:test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

const emitUser = mock(() => {})
mock.module('../../../src/debug/event-bus.js', () => ({ emitUser }))

const { makeSearchToolsTool } = await import('../../../src/tools/disclosure/search-tools.js')
const { createDisclosureSession } = await import('../../../src/tools/disclosure/registry.js')
const { CORE_TOOL_NAMES } = await import('../../../src/tools/disclosure/core.js')
const { LexicalToolRetriever } = await import('../../../src/tools/disclosure/tool-retriever.js')
const { getToolExecutor } = await import('../../utils/test-helpers.js')

const d = (desc: string): ToolSet[string] =>
  tool({
    description: desc,
    inputSchema: z.object({}),
    execute: async () => ({}),
  })

describe('search_tools', () => {
  it('returns ranked briefs without input schemas', async () => {
    const tools: ToolSet = {
      get_current_time: d('Get the time.'),
      search_tools: d('search'),
      load_tool: d('load'),
      list_tasks: d('List tasks in a project.'),
      web_fetch: d('Fetch a web page.'),
    }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const exec = getToolExecutor(makeSearchToolsTool(session, new LexicalToolRetriever(), 'ctx-1'))
    const out = (await exec({ query: 'list tasks', limit: 5 })) as {
      results: Array<Record<string, unknown>>
    }
    expect(out.results[0]).toEqual({
      name: 'list_tasks',
      summary: 'List tasks in a project.',
      domain: 'task',
      alreadyLoaded: false,
    })
    expect(out.results.every((r) => !('inputSchema' in r))).toBe(true)
    expect(emitUser).toHaveBeenCalled()
  })

  it('does not surface always-on tools as discoverable', async () => {
    const tools: ToolSet = {
      get_current_time: d('Get the time now.'),
      search_tools: d('search'),
      load_tool: d('load'),
    }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const exec = getToolExecutor(makeSearchToolsTool(session, new LexicalToolRetriever(), 'ctx-1'))
    const out = (await exec({ query: 'time', limit: 5 })) as {
      results: unknown[]
    }
    expect(out.results).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/disclosure/search-tools.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/disclosure/search-tools.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { emitUser } from '../../debug/event-bus.js'
import { logger } from '../../logger.js'
import { ALWAYS_ON_TOOL_NAMES } from './core.js'
import type { DisclosureSession } from './registry.js'
import { buildBriefs } from './tool-brief.js'
import type { ToolRetriever } from './tool-retriever.js'

const log = logger.child({ scope: 'tool:search_tools' })

export function makeSearchToolsTool(
  session: DisclosureSession,
  retriever: ToolRetriever,
  contextId: string,
  toolsForBriefs: ToolSet = {},
): ToolSet[string] {
  return tool({
    description:
      'Find tools by intent. Most tools are NOT loaded; call this with a short natural-language query, then load_tool the names you need before using them.',
    inputSchema: z.object({
      query: z.string().min(1).describe('What you are trying to do, e.g. "list overdue tasks"'),
      limit: z.number().int().min(1).max(20).default(8).describe('Maximum tools to return'),
    }),
    execute: async ({ query, limit }) => {
      const discoverable = buildBriefs(toolsForBriefs).filter((b) => !ALWAYS_ON_TOOL_NAMES.has(b.name))
      const ranked = await retriever.rank(query, discoverable, limit)
      const loadedNow = new Set(session.activeToolNames())
      const results = ranked.map((b) => ({
        name: b.name,
        summary: b.summary,
        domain: b.domain,
        alreadyLoaded: loadedNow.has(b.name),
      }))
      emitUser('disclosure:search', contextId, {
        queryLength: query.length,
        resultCount: results.length,
      })
      log.debug({ contextId, queryLength: query.length, resultCount: results.length }, 'search_tools served')
      return { results }
    },
  })
}
```

> Note: `toolsForBriefs` is the full registered tool set; the wiring task (Task 9) passes it in. The test passes the session's tools via the same object used to create the session.

Adjust the test's `makeSearchToolsTool(session, new LexicalToolRetriever(), 'ctx-1')` call to pass the tools as the 4th arg: `makeSearchToolsTool(session, new LexicalToolRetriever(), 'ctx-1', tools)`. Update both `exec` setups in the test accordingly before running.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/disclosure/search-tools.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/search-tools.ts tests/tools/disclosure/search-tools.test.ts
git commit -m "feat(disclosure): search_tools tool returning ranked schema-less briefs"
```

---

### Task 7: `load_tool` tool

**Files:**

- Create: `src/tools/disclosure/load-tool.ts`
- Test: `tests/tools/disclosure/load-tool.test.ts`

Batch load. Emits `disclosure:load` (counts only). Returns `{ loaded, unknown, nowActive }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/disclosure/load-tool.test.ts
import { describe, expect, it, mock } from 'bun:test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

const emitUser = mock(() => {})
mock.module('../../../src/debug/event-bus.js', () => ({ emitUser }))

const { makeLoadToolTool } = await import('../../../src/tools/disclosure/load-tool.js')
const { createDisclosureSession } = await import('../../../src/tools/disclosure/registry.js')
const { CORE_TOOL_NAMES } = await import('../../../src/tools/disclosure/core.js')
const { getToolExecutor } = await import('../../utils/test-helpers.js')

const d = (): ToolSet[string] =>
  tool({
    description: 'x',
    inputSchema: z.object({}),
    execute: async () => ({}),
  })

describe('load_tool', () => {
  it('loads known tools and reports unknown ones, returning the new active count', async () => {
    const tools: ToolSet = {
      get_current_time: d(),
      search_tools: d(),
      load_tool: d(),
      list_tasks: d(),
      get_task: d(),
    }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const exec = getToolExecutor(makeLoadToolTool(session, 'ctx-1'))
    const out = (await exec({
      names: ['list_tasks', 'get_task', 'bogus'],
    })) as {
      loaded: string[]
      unknown: string[]
      nowActive: number
    }
    expect(out.loaded.toSorted()).toEqual(['get_task', 'list_tasks'])
    expect(out.unknown).toEqual(['bogus'])
    expect(session.activeToolNames()).toContain('list_tasks')
    expect(out.nowActive).toBe(session.activeToolNames().length)
    expect(emitUser).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/disclosure/load-tool.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/disclosure/load-tool.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { emitUser } from '../../debug/event-bus.js'
import { logger } from '../../logger.js'
import type { DisclosureSession } from './registry.js'

const log = logger.child({ scope: 'tool:load_tool' })

export function makeLoadToolTool(session: DisclosureSession, contextId: string): ToolSet[string] {
  return tool({
    description:
      'Activate one or more tools by name so you can call them. Pass every tool you expect to need in one call to avoid extra round-trips.',
    inputSchema: z.object({
      names: z.array(z.string().min(1)).min(1).describe('Tool names from search_tools results to activate'),
    }),
    execute: async ({ names }) => {
      const { loaded, unknown } = session.markLoaded(names)
      const nowActive = session.activeToolNames().length
      emitUser('disclosure:load', contextId, {
        loadedCount: loaded.length,
        unknownCount: unknown.length,
        nowActive,
      })
      log.debug(
        {
          contextId,
          loadedCount: loaded.length,
          unknownCount: unknown.length,
          nowActive,
        },
        'load_tool served',
      )
      return { loaded, unknown, nowActive }
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/disclosure/load-tool.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/load-tool.ts tests/tools/disclosure/load-tool.test.ts
git commit -m "feat(disclosure): load_tool batch activation tool"
```

---

### Task 8: `prepareStep` factory with stall fallback

**Files:**

- Create: `src/tools/disclosure/prepare-step.ts`
- Test: `tests/tools/disclosure/prepare-step.test.ts`

Returns a function `({ stepNumber }) => { activeTools } | {}`. Normally returns `{ activeTools: session.activeToolNames() }`. If the model has not loaded anything by `DISCLOSURE_STALL_STEPS`, returns `{}` (all tools active) and emits `disclosure:fallback` once.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/disclosure/prepare-step.test.ts
import { describe, expect, it, mock } from 'bun:test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

const emitUser = mock(() => {})
mock.module('../../../src/debug/event-bus.js', () => ({ emitUser }))

const { createDisclosurePrepareStep } = await import('../../../src/tools/disclosure/prepare-step.js')
const { createDisclosureSession } = await import('../../../src/tools/disclosure/registry.js')
const { CORE_TOOL_NAMES } = await import('../../../src/tools/disclosure/core.js')

const d = (): ToolSet[string] =>
  tool({
    description: 'x',
    inputSchema: z.object({}),
    execute: async () => ({}),
  })

function freshSession() {
  const tools: ToolSet = {
    get_current_time: d(),
    search_tools: d(),
    load_tool: d(),
    list_tasks: d(),
  }
  return createDisclosureSession(tools, CORE_TOOL_NAMES)
}

describe('createDisclosurePrepareStep', () => {
  it('returns the active tool subset on early steps', () => {
    const session = freshSession()
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    const out = prep({ stepNumber: 0 }) as { activeTools?: string[] }
    expect(out.activeTools).toBeDefined()
    expect(out.activeTools!.toSorted()).toEqual(['get_current_time', 'load_tool', 'search_tools'])
  })

  it('opens all tools (returns {}) once stalled with no loads, emitting fallback once', () => {
    const session = freshSession()
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    emitUser.mockReset()
    expect(prep({ stepNumber: 2 })).toEqual({})
    expect(prep({ stepNumber: 3 })).toEqual({})
    expect(emitUser).toHaveBeenCalledTimes(1)
  })

  it('does not fall back once a tool has been loaded', () => {
    const session = freshSession()
    session.markLoaded(['list_tasks'])
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    const out = prep({ stepNumber: 5 }) as { activeTools?: string[] }
    expect(out.activeTools).toContain('list_tasks')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/disclosure/prepare-step.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/disclosure/prepare-step.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { emitUser } from '../../debug/event-bus.js'
import { logger } from '../../logger.js'
import { DISCLOSURE_STALL_STEPS } from './core.js'
import type { DisclosureSession } from './registry.js'

const log = logger.child({ scope: 'disclosure:prepare-step' })

type PrepareStepArg = { stepNumber: number }
type PrepareStepResult = { activeTools?: string[] }

export function createDisclosurePrepareStep(
  session: DisclosureSession,
  contextId: string,
): (arg: PrepareStepArg) => PrepareStepResult {
  let fallbackEmitted = false
  return ({ stepNumber }) => {
    if (!session.hasLoaded() && stepNumber >= DISCLOSURE_STALL_STEPS) {
      if (!fallbackEmitted) {
        fallbackEmitted = true
        emitUser('disclosure:fallback', contextId, { stepNumber })
        log.warn({ contextId, stepNumber }, 'Disclosure stalled with no loads; opening all tools')
      }
      return {}
    }
    return { activeTools: session.activeToolNames() }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/disclosure/prepare-step.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/prepare-step.ts tests/tools/disclosure/prepare-step.test.ts
git commit -m "feat(disclosure): prepareStep factory with stall fallback"
```

---

### Task 9: Disclosure wiring helper

**Files:**

- Create: `src/tools/disclosure/wire.ts`
- Test: `tests/tools/disclosure/wire.test.ts`

`maybeApplyDisclosure(tools, contextId, retriever)`: if `resolveReductionFlags(contextId).progressiveDisclosure` is OFF → `{ tools, disclosure: undefined }`. If ON → add `search_tools` + `load_tool` to a copy of `tools`, create the session over that full set, and return `{ tools: withMeta, disclosure: session }`. The retriever is chosen by the caller (Task 11) so `semantic_tool_retrieval` can downgrade it to lexical.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/disclosure/wire.test.ts
import { describe, expect, it, mock, beforeEach } from 'bun:test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

const resolveReductionFlags = mock(() => ({
  progressiveDisclosure: false,
  resultCompaction: false,
  semanticToolRetrieval: false,
}))
mock.module('../../../src/tools/feature-flags.js', () => ({
  resolveReductionFlags,
  REDUCTION_FLAGS_CONFIG_KEY: 'tool_context_flags',
}))

const { maybeApplyDisclosure } = await import('../../../src/tools/disclosure/wire.js')
const { LexicalToolRetriever } = await import('../../../src/tools/disclosure/tool-retriever.js')

const d = (): ToolSet[string] =>
  tool({
    description: 'x',
    inputSchema: z.object({}),
    execute: async () => ({}),
  })

describe('maybeApplyDisclosure', () => {
  beforeEach(() => resolveReductionFlags.mockReset())

  it('is a pass-through when the flag is OFF', () => {
    resolveReductionFlags.mockReturnValue({
      progressiveDisclosure: false,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
    const tools: ToolSet = { get_current_time: d(), list_tasks: d() }
    const out = maybeApplyDisclosure(tools, 'ctx-1', new LexicalToolRetriever())
    expect(out.tools).toBe(tools)
    expect(out.disclosure).toBeUndefined()
  })

  it('adds meta tools and a session when the flag is ON', () => {
    resolveReductionFlags.mockReturnValue({
      progressiveDisclosure: true,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
    const tools: ToolSet = { get_current_time: d(), list_tasks: d() }
    const out = maybeApplyDisclosure(tools, 'ctx-1', new LexicalToolRetriever())
    expect(out.tools['search_tools']).toBeDefined()
    expect(out.tools['load_tool']).toBeDefined()
    expect(out.disclosure).toBeDefined()
    expect(out.disclosure!.allNames.has('list_tasks')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/disclosure/wire.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/disclosure/wire.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import { resolveReductionFlags } from '../feature-flags.js'
import { CORE_TOOL_NAMES } from './core.js'
import { makeLoadToolTool } from './load-tool.js'
import { createDisclosureSession, type DisclosureSession } from './registry.js'
import { makeSearchToolsTool } from './search-tools.js'
import type { ToolRetriever } from './tool-retriever.js'

export function maybeApplyDisclosure(
  tools: ToolSet,
  contextId: string,
  retriever: ToolRetriever,
): { tools: ToolSet; disclosure: DisclosureSession | undefined } {
  if (!resolveReductionFlags(contextId).progressiveDisclosure) return { tools, disclosure: undefined }
  const withMeta: ToolSet = { ...tools }
  const session = createDisclosureSession(withMeta, CORE_TOOL_NAMES)
  withMeta['search_tools'] = makeSearchToolsTool(session, retriever, contextId, withMeta)
  withMeta['load_tool'] = makeLoadToolTool(session, contextId)
  // Recreate the session so allNames includes the meta tools just added.
  const finalSession = createDisclosureSession(withMeta, CORE_TOOL_NAMES)
  withMeta['search_tools'] = makeSearchToolsTool(finalSession, retriever, contextId, withMeta)
  withMeta['load_tool'] = makeLoadToolTool(finalSession, contextId)
  return { tools: withMeta, disclosure: finalSession }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/disclosure/wire.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/wire.ts tests/tools/disclosure/wire.test.ts
git commit -m "feat(disclosure): maybeApplyDisclosure wiring helper"
```

---

### Task 10: Discovery preamble in the system prompt

**Files:**

- Modify: `src/system-prompt.ts` — add a `DISCLOSURE` preamble constant, include it via an `AssembleOptions.progressiveDisclosure` flag, and add the option to `buildSystemPrompt` / `buildProviderlessSystemPrompt`.
- Test: `tests/system-prompt-disclosure.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/system-prompt-disclosure.test.ts
import { describe, expect, it } from 'bun:test'

import { buildProviderlessSystemPrompt } from '../src/system-prompt.js'

describe('discovery preamble', () => {
  const enabled = new Set(['get_current_time', 'search_tools', 'load_tool'])

  it('includes the discovery preamble when progressiveDisclosure is true', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-1', enabled, {
      askPermissionAvailable: false,
      progressiveDisclosure: true,
    })
    expect(prompt).toContain('search_tools')
    expect(prompt).toContain('load_tool')
    expect(prompt.toLowerCase()).toContain('not loaded')
  })

  it('omits the preamble when progressiveDisclosure is false', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-1', enabled, {
      askPermissionAvailable: false,
      progressiveDisclosure: false,
    })
    expect(prompt.toLowerCase()).not.toContain('most tools are not loaded')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/system-prompt-disclosure.test.ts`
Expected: FAIL — `progressiveDisclosure` option not accepted / preamble absent.

- [ ] **Step 3: Write minimal implementation**

In `src/system-prompt.ts`:

(a) Add the constant near the other fragment constants:

```ts
const DISCLOSURE = `TOOL DISCOVERY — Most tools are not loaded right now. To use a tool you must first find and load it:
1. Call search_tools with a short natural-language description of what you want to do.
2. Call load_tool with the names you need (pass several at once to avoid extra steps).
3. Then call the loaded tool(s) normally.
Always-available tools: get_current_time, search_tools, load_tool, expand_result. If a result says it was compacted, use expand_result with its handle to read more.`
```

(b) Extend `AssembleOptions`:

```ts
interface AssembleOptions {
  readonly askPermissionAvailable: boolean
  readonly deferredFragmentText?: string
  readonly progressiveDisclosure?: boolean
}
```

(c) In `assembleSystemPrompt`, right after `const parts: string[] = [intro]`, insert:

```ts
if (options.progressiveDisclosure === true) parts.push(DISCLOSURE)
```

(d) Extend the public builders to accept and forward the flag. Replace the `buildSystemPrompt` overload that takes options and the `buildProviderlessSystemPrompt` signature so the options object includes `progressiveDisclosure?: boolean`, and pass it into `assembleSystemPrompt`'s options. Concretely, change the options type in both places from `{ askPermissionAvailable: boolean }` to `{ askPermissionAvailable: boolean; progressiveDisclosure?: boolean }`, and where `AssembleOptions` is constructed set `progressiveDisclosure: args[1]?.progressiveDisclosure` (in `buildSystemPrompt`) and `progressiveDisclosure: options.progressiveDisclosure` (in `buildProviderlessSystemPrompt`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/system-prompt-disclosure.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/system-prompt.ts tests/system-prompt-disclosure.test.ts
git commit -m "feat(disclosure): discovery preamble in system prompt behind option"
```

---

### Task 11: Thread the session through the invocation path

**Files:**

- Modify: `src/llm-orchestrator-types.ts` (add `disclosure?` to `InvokeModelArgs`).
- Modify: `src/llm-orchestrator-tools.ts` (`prepareLlmInvocation`: choose retriever, call `maybeApplyDisclosure`, return `disclosure`).
- Modify: `src/llm-orchestrator.ts` (pass `disclosure` to `invokeModelWithTyping`).
- Modify: `src/llm-orchestrator-invoke.ts` (`invokeModel`: attach `prepareStep`, pass `progressiveDisclosure` to the prompt builder).
- Test: `tests/llm-orchestrator-disclosure-wiring.test.ts`

The retriever choice honors `semantic_tool_retrieval`: when OFF, force `LexicalToolRetriever`; when ON, `getToolRetriever()`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/llm-orchestrator-disclosure-wiring.test.ts
import { describe, expect, it, mock, beforeEach } from 'bun:test'

const resolveReductionFlags = mock(() => ({
  progressiveDisclosure: true,
  resultCompaction: false,
  semanticToolRetrieval: false,
}))
mock.module('../src/tools/feature-flags.js', () => ({
  resolveReductionFlags,
  REDUCTION_FLAGS_CONFIG_KEY: 'tool_context_flags',
}))
mock.module('../src/cache.js', () => ({
  getCachedTools: () => ({
    list_tasks: { description: 'List tasks.', execute: async () => ({}) },
  }),
  setCachedTools: () => {},
  getCachedConfig: () => null,
  setCachedConfig: () => {},
  clearCachedToolsByPrefix: () => {},
}))
mock.module('../src/tools/index.js', () => ({
  buildToolDescriptors: async () => ({}),
  buildProviderlessToolDescriptors: async () => ({}),
  applyToolPreferences: (tools: unknown) => tools,
}))
mock.module('../src/conversation.js', () => ({
  buildMessagesWithMemory: (_c: string, h: unknown) => ({
    messages: h,
    memoryMsg: null,
  }),
}))
mock.module('../src/llm-orchestrator-validation.js', () => ({
  validateToolResults: (m: unknown) => m,
}))
mock.module('../src/llm-orchestrator-config.js', () => ({
  resolveTimezone: () => 'UTC',
}))

const { prepareLlmInvocation } = await import('../src/llm-orchestrator-tools.js')

describe('prepareLlmInvocation disclosure wiring', () => {
  beforeEach(() => {
    resolveReductionFlags.mockReset()
    resolveReductionFlags.mockReturnValue({
      progressiveDisclosure: true,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
  })

  it('returns a disclosure session and injects meta tools when the flag is ON', async () => {
    const out = await prepareLlmInvocation({
      contextId: 'ctx-1',
      configId: 'ctx-1',
      chatUserId: 'u1',
      username: null,
      contextType: 'dm',
      provider: { capabilities: new Set(), traits: new Set() } as never,
      history: [],
      userText: 'find tasks',
      stagedDownloadFn: undefined,
      askPermission: undefined,
    })
    expect(out.disclosure).toBeDefined()
    expect(out.tools['search_tools']).toBeDefined()
    expect(out.tools['load_tool']).toBeDefined()
  })

  it('returns no disclosure session when the flag is OFF', async () => {
    resolveReductionFlags.mockReturnValue({
      progressiveDisclosure: false,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
    const out = await prepareLlmInvocation({
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
    expect(out.disclosure).toBeUndefined()
    expect(out.tools['search_tools']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/llm-orchestrator-disclosure-wiring.test.ts`
Expected: FAIL — `out.disclosure` undefined / `search_tools` missing.

- [ ] **Step 3: Write minimal implementation**

(a) `src/llm-orchestrator-types.ts` — add to `InvokeModelArgs`:

```ts
import type { DisclosureSession } from './tools/disclosure/registry.js'
// ...
export type InvokeModelArgs = {
  // ...existing fields...
} & Partial<Record<'progressReporter', AiProgressReporter>> &
  Partial<Record<'disclosure', DisclosureSession>>
```

(b) `src/llm-orchestrator-tools.ts` — add imports and update `prepareLlmInvocation`. Add:

```ts
import { resolveReductionFlags } from './tools/feature-flags.js'
import { maybeApplyDisclosure } from './tools/disclosure/wire.js'
import { getToolRetriever, LexicalToolRetriever } from './tools/disclosure/tool-retriever.js'
import type { DisclosureSession } from './tools/disclosure/registry.js'
```

Part 1 landed the compaction wiring inside the `buildFullToolSet` helper (not directly in `prepareLlmInvocation`). It already resolves `const flags = resolveReductionFlags(contextId)` before its `applyResultCompaction` call and ends with `return { tools, enabledToolNames: new Set(Object.keys(tools)) }`. Apply disclosure there, after `applyResultCompaction` (the `flags` const is already in scope — do not resolve it twice):

```ts
const retriever = flags.semanticToolRetrieval ? getToolRetriever() : new LexicalToolRetriever()
const { tools: disclosedTools, disclosure } = maybeApplyDisclosure(tools, contextId, retriever)
return {
  tools: disclosedTools,
  enabledToolNames: new Set(Object.keys(disclosedTools)),
  disclosure,
}
```

(replacing the previous `return { tools, enabledToolNames: new Set(Object.keys(tools)) }`). Widen `buildFullToolSet`'s declared return type with `disclosure: DisclosureSession | undefined`. Then in `prepareLlmInvocation`, destructure `disclosure` from the `buildFullToolSet(opts)` result and return it:

```ts
return { tools, validatedMessages, enabledToolNames, disclosure }
```

Update `prepareLlmInvocation`'s declared return type to include `disclosure: DisclosureSession | undefined`.

(c) `src/llm-orchestrator.ts` — destructure and pass through:

```ts
const { tools, validatedMessages, enabledToolNames, disclosure } = await prepareLlmInvocation(
  buildLlmInvocationOpts(args, configId, provider, deps.stagedDownloadFn),
)
// ...
const result = await invokeModelWithTyping(reply, {
  // ...existing fields...
  disclosure,
  turnId,
})
```

(d) `src/llm-orchestrator-invoke.ts` — import the factory and attach `prepareStep`; pass the flag to the prompt:

```ts
import { createDisclosurePrepareStep } from './tools/disclosure/prepare-step.js'
```

In `invokeModel`, after destructuring `args` (add `disclosure` to the destructure), change the system-prompt construction to pass `progressiveDisclosure: disclosure !== undefined`:

```ts
const systemPrompt =
  provider === null
    ? buildProviderlessSystemPrompt(contextId, enabledToolNames, {
        askPermissionAvailable: true,
        progressiveDisclosure: disclosure !== undefined,
      })
    : buildSystemPrompt(provider, contextId, enabledToolNames, {
        askPermissionAvailable: true,
        progressiveDisclosure: disclosure !== undefined,
      })
```

and add `prepareStep` to the `deps.generateText({...})` call:

```ts
const result = await deps.generateText({
  model,
  system: systemPrompt,
  messages,
  tools,
  timeout: 1_200_000,
  stopWhen: deps.stepCountIs(25),
  ...(disclosure === undefined ? {} : { prepareStep: createDisclosurePrepareStep(disclosure, contextId) }),
  experimental_onToolCallStart: buildToolCallStartHandler(ctx),
  experimental_onToolCallFinish: buildToolCallFinishHandler(ctx),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/llm-orchestrator-disclosure-wiring.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm-orchestrator-types.ts src/llm-orchestrator-tools.ts src/llm-orchestrator.ts src/llm-orchestrator-invoke.ts tests/llm-orchestrator-disclosure-wiring.test.ts
git commit -m "feat(disclosure): thread DisclosureSession into generateText prepareStep"
```

---

### Task 12: Integration — activeTools widens across a scripted loop

**Files:**

- Test: `tests/tools/disclosure/disclosure-loop.test.ts`

Drive a `prepareStep` + session through a simulated multi-step loop and assert: step 0 active = always-on only; after `load_tool` the active set widens; the model's hallucinated call to an unloaded tool is excluded from active.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/disclosure/disclosure-loop.test.ts
import { describe, expect, it, mock } from 'bun:test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

mock.module('../../../src/debug/event-bus.js', () => ({ emitUser: () => {} }))

const { createDisclosureSession } = await import('../../../src/tools/disclosure/registry.js')
const { createDisclosurePrepareStep } = await import('../../../src/tools/disclosure/prepare-step.js')
const { CORE_TOOL_NAMES } = await import('../../../src/tools/disclosure/core.js')

const d = (): ToolSet[string] =>
  tool({
    description: 'x',
    inputSchema: z.object({}),
    execute: async () => ({}),
  })

describe('disclosure loop', () => {
  it('widens activeTools only after load and never includes unloaded tools', () => {
    const tools: ToolSet = {
      get_current_time: d(),
      search_tools: d(),
      load_tool: d(),
      list_tasks: d(),
      web_fetch: d(),
    }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const prep = createDisclosurePrepareStep(session, 'ctx-1')

    const step0 = prep({ stepNumber: 0 }) as { activeTools: string[] }
    expect(step0.activeTools).not.toContain('list_tasks')
    expect(step0.activeTools).not.toContain('web_fetch')

    session.markLoaded(['list_tasks'])
    const step1 = prep({ stepNumber: 1 }) as { activeTools: string[] }
    expect(step1.activeTools).toContain('list_tasks')
    expect(step1.activeTools).not.toContain('web_fetch') // never loaded
  })
})
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `bun test tests/tools/disclosure/disclosure-loop.test.ts`
Expected: PASS (relies on Tasks 5+8; if FAIL, fix the offending unit).

- [ ] **Step 3: Commit**

```bash
git add tests/tools/disclosure/disclosure-loop.test.ts
git commit -m "test(disclosure): activeTools widening across a scripted loop"
```

---

### Task 13: Regression — flag OFF means no prepareStep, all tools active

**Files:**

- Test: `tests/llm-orchestrator-disclosure-wiring.test.ts` (add a case)

- [ ] **Step 1: Add the failing/confirming test**

```ts
// add inside the describe block
it('OFF: enabledToolNames equals the descriptor tools (no meta injected)', async () => {
  resolveReductionFlags.mockReturnValue({
    progressiveDisclosure: false,
    resultCompaction: false,
    semanticToolRetrieval: false,
  })
  const out = await prepareLlmInvocation({
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
  expect([...out.enabledToolNames].toSorted()).toEqual(['list_tasks'])
  expect(out.disclosure).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify**

Run: `bun test tests/llm-orchestrator-disclosure-wiring.test.ts`
Expected: PASS. (When `disclosure` is undefined, `invokeModel` omits `prepareStep`, so the SDK leaves all tools active — today's behavior.)

- [ ] **Step 3: Commit**

```bash
git add tests/llm-orchestrator-disclosure-wiring.test.ts
git commit -m "test(disclosure): flag-off keeps full eager tool set"
```

---

### Task 14: Full gate + mutation + manual smoke

**Files:** none (verification) + optional `docs/deployment` note.

- [ ] **Step 1: Run all new suites**

Run: `bun test tests/tools/disclosure/ tests/system-prompt-disclosure.test.ts tests/llm-orchestrator-disclosure-wiring.test.ts`
Expected: all PASS.

- [ ] **Step 2: Lint / typecheck / format on changed files**

Run: `bun run lint && bun run typecheck && bun run format:check`
Expected: PASS for files created/modified by this plan. (Unrelated pre-existing WIP failures are out of scope — do not modify those files.)

- [ ] **Step 3: Mutation-test the pure cores**

Run: `bun test:mutate:file src/tools/disclosure/registry.ts src/tools/disclosure/tool-retriever.ts src/tools/disclosure/prepare-step.ts`
Expected: surviving mutants addressed or justified.

- [ ] **Step 4: Manual smoke (real model)**

Set a test context's flags JSON to `{ "progressive_disclosure": true, "result_compaction": true, "semantic_tool_retrieval": true }` and confirm in `/debug`: step-0 request carries ~4 tool schemas; `disclosure:search`/`disclosure:load` events fire; a large `list_tasks`/`web_fetch` result shows `compaction:applied`. Toggle the flag OFF and confirm the full eager tool set returns.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore(disclosure): gate + mutation cleanup for part 2"
```

---

## Self-review (writing-plans)

**Spec coverage (B + C portions):**

- §5.1 CORE/META split → Task 1. `DisclosureSession` (core ∪ meta ∪ loaded, idempotent, validates names) → Task 5. `search_tools` (ranked schema-less briefs, batch awareness) → Task 6. `load_tool` (batch, idempotent, unknown partition) → Task 7. `prepareStep`/`activeTools` integration → Tasks 8/11. Discovery preamble → Task 10.
- §5.2 `ToolRetriever` interface + Lexical + Embedding (reuse `tryGetEmbedding`/`cosineSimilarity`, per-process brief cache, available-check fallback) → Tasks 3/4. Briefs from metadata+description → Task 2.
- §5.4 flags: `progressive_disclosure` gating → Tasks 9/11; `semantic_tool_retrieval` selecting embedding vs lexical → Task 11.
- §6 data flow (activeTools widens step by step; unloaded tools excluded) → Task 12.
- §7 error handling: model never loads → stall fallback opens all tools (Task 8); `load_tool` unknown names partitioned (Task 7); retriever embedding failure → lexical (Task 4); flag-OFF identical (Task 13).
- §7 telemetry: `disclosure:search` / `disclosure:load` / `disclosure:fallback` via `emitUser`, counts/lengths only — never query text or content (Tasks 6/7/8), preserving the anonymity contract.

**Dependencies on Part 1:** `feature-flags.ts` (Task 1 of Part 1), `expand_result` registration + compaction wiring (it composes before disclosure in `prepareLlmInvocation`, so meta tools are added on top of the already-compacted set and are themselves never compacted).

**Placeholder scan:** none — every code step contains complete code. The one editing nuance (Task 6's `toolsForBriefs` 4th arg) is called out explicitly with the test adjustment.

**Type consistency:** `ToolBrief {name,summary,domain}` and `RankedBrief = ToolBrief & {score}` consistent Tasks 2/3/4/6. `DisclosureSession` methods (`activeToolNames`, `markLoaded`, `hasLoaded`, `allNames`) consistent Tasks 5/6/7/8/9/12. `createDisclosurePrepareStep(session, contextId)` consistent Tasks 8/11/12. `maybeApplyDisclosure(tools, contextId, retriever) → {tools, disclosure}` consistent Tasks 9/11. `prepareLlmInvocation` return gains `disclosure` consistently Tasks 11/13. Flag field names (`progressiveDisclosure`, `semanticToolRetrieval`) match Part 1's `ReductionFlags`.

**Open items to confirm during execution:** the AI SDK v6 `prepareStep` parameter object also carries `steps`/`messages`/`model`; the factory only reads `stepNumber` and returns `{ activeTools }` | `{}`, which is assignment-compatible — confirm against the installed `ai` types and widen the param type if the compiler requires the full shape. Anchor edits on function names and quoted surrounding lines, not absolute line numbers.

## Drift Log

| Date       | Category               | Item                                                                                                                                                                                                | Decision                                                                                                                                                                                |
| ---------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-10 | In-plan, stale anchors | Task 11(b) insertion point in `src/llm-orchestrator-tools.ts`                                                                                                                                       | Part 1 placed compaction wiring inside `buildFullToolSet` (which already resolves `flags`); rewrote step to apply disclosure there and thread `disclosure` outward                      |
| 2026-06-10 | In-plan, stale anchors | Task 11 test mock set                                                                                                                                                                               | Mirrored `tests/llm-orchestrator-tools-compaction.test.ts`: added `getCachedConfig`/`setCachedConfig`/`clearCachedToolsByPrefix` to the `cache.js` mock and a `src/tools/index.js` mock |
| 2026-06-10 | Verified, no change    | All other anchors (feature-flags shape, `tryGetEmbedding`, `getSystemConfig`, `getToolMetadata`, `emitUser`, system-prompt builders, AI SDK 6.0.184 `prepareStep`/`activeTools`/`cosineSimilarity`) | Confirmed against current code 2026-06-10; no edits needed                                                                                                                              |
| 2026-06-10 | Out-of-plan audit      | Branch diff vs master (29 files)                                                                                                                                                                    | Entirely Part 1 (compaction) output — this plan's declared dependency, tracked by the Part 1 plan; not drift                                                                            |

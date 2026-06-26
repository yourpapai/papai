<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Consolidate `recall` + `search_memory` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `search_memory` the single memory-retrieval tool — backed by the recall cascade, with `kind`/`include_stale` filters threaded in and `provenance` in the output — and delete the `recall` tool.

**Architecture:** `runRecallCascade` (`src/long-term-memory/recall-cascade.ts`) gains optional `kind`/`includeStale` inputs applied across its layers; `makeSearchMemoryTool` (`src/tools/memory.ts`) calls the cascade instead of `searchMemoryRecords` and returns records with `provenance` (no `mode`). The `recall` tool, its registration, its `tool-metadata` entry, and the `recall`-named system-prompt fragment/test are removed/retargeted. The cascade engine, promotion pipeline, sweeps, and capture path are otherwise untouched.

**Tech Stack:** Bun, TypeScript (strict), Zod v4, Vercel AI SDK. Spec: `docs/superpowers/specs/2026-06-18-consolidate-recall-search-memory-design.md`.

---

## Write-hook & ordering notes (read first)

- Editing an implementation file (`src/**` non-test) runs ONLY that file's MAPPED test (`src/foo.ts` → `tests/.../foo.test.ts`) via Bun (transpiles, no typecheck) and blocks on a failing test. Editing a test file verifies its changed tests pass.
- The **commit** pre-hook runs project-wide `bun typecheck` + lint + format on the result (NOT tests). So every commit must be type-clean repo-wide; in particular the commit that deletes `src/tools/recall.ts` must remove every import of it first.
- Where a mapped test asserts old behavior, use the 3-move sequence: edit the test to a state that passes against the OLD impl, edit the impl, then re-add the new-behavior assertions. Each task notes when this applies.
- **Commit at the end of every task.** Whole-file deletes use `git rm` (Bash); the write-hook does not fire on deletes.

## File structure

**Production modified:**

- `src/long-term-memory/recall-cascade.ts` — add `kind`/`includeStale` to `RunRecallCascadeInput`, thread through layers.
- `src/tools/memory.ts` — `makeSearchMemoryTool` runs the cascade; add `toPublicHit`; new description + `include_stale` field.
- `src/tools/provider-independent-tools-builder.ts` — remove `recall` import + registration.
- `src/tools/tool-metadata.ts` — remove the `recall` entry.
- `src/system-prompt.ts` — retarget the memory fragment from `recall` to `search_memory`.

**Production deleted:** `src/tools/recall.ts`.

**Tests:** extend `recall-cascade.test.ts`; update `memory.test.ts`; replace the recall describe in `provider-independent-tools-builder.test.ts`; repoint `stop-rediscovering.acceptance.test.ts`; delete `recall.test.ts`; rename+update `system-prompt-recall.test.ts` → `system-prompt-memory-search.test.ts`.

**Docs:** `CLAUDE.md`, `src/tools/CLAUDE.md` (and `README.md` only if it names `recall`).

**Untouched (verify only):** `promotion*.ts`, `capture*.ts`, `scheduler-instance.ts`, `searchMemoryRecords` (still used by `forget_memory`).

---

## Task 1: Thread `kind`/`includeStale` into the cascade

**Files:**

- Modify: `src/long-term-memory/recall-cascade.ts`
- Test: `tests/long-term-memory/recall-cascade.test.ts`

The change is additive (optional inputs), so existing cascade tests stay green; do the impl first, then add tests.

- [ ] **Step 1: Edit `src/long-term-memory/recall-cascade.ts`.**

Change the types import to add `MemoryKind` and `MemoryStatus`:

```ts
import type { MemoryRecord, MemoryScope } from './types.js'
```

→

```ts
import type { MemoryKind, MemoryRecord, MemoryScope, MemoryStatus } from './types.js'
```

Add the two optional fields to `RunRecallCascadeInput`:

```ts
export type RunRecallCascadeInput = Readonly<{
  storageContextId: string
  configContextId: string
  contextType: ContextType
  query: string
  limit?: number
}>
```

→

```ts
export type RunRecallCascadeInput = Readonly<{
  storageContextId: string
  configContextId: string
  contextType: ContextType
  query: string
  limit?: number
  kind?: MemoryKind
  includeStale?: boolean
}>
```

Add a `byKind` helper next to `tag` (after the `tag` definition):

```ts
const byKind = (records: readonly MemoryRecord[], kind: MemoryKind | undefined): readonly MemoryRecord[] =>
  kind === undefined ? records : records.filter((record) => record.kind === kind)
```

Replace `searchActiveHybrid` to accept `statuses` + `kind`:

```ts
const searchActiveHybrid = (
  scope: MemoryScope,
  query: string,
  queryEmbedding: readonly number[] | null,
  limit: number,
): readonly MemoryRecord[] => {
  if (queryEmbedding === null) {
    const active = listMemoryRecords({
      scopeId: scope.scopeId,
      scopeType: scope.scopeType,
      status: 'active',
      limit: 500,
    })
    return rankCandidatesByQuery(active, query, null, { limit })
  }
  const semantic = rankRecordsBySimilarity(scope, queryEmbedding, { statuses: ['active'], limit })
  if (semantic.length > 0) return semantic
  const active = listMemoryRecords({ scopeId: scope.scopeId, scopeType: scope.scopeType, status: 'active', limit: 500 })
  return rankCandidatesByQuery(active, query, null, { limit })
}
```

→

```ts
const searchActiveHybrid = (
  scope: MemoryScope,
  query: string,
  queryEmbedding: readonly number[] | null,
  limit: number,
  statuses: readonly MemoryStatus[],
  kind: MemoryKind | undefined,
): readonly MemoryRecord[] => {
  const keyword = (): readonly MemoryRecord[] => {
    const active = listMemoryRecords({ scopeId: scope.scopeId, scopeType: scope.scopeType, statuses, limit: 500 })
    return rankCandidatesByQuery(byKind(active, kind), query, null, { limit })
  }
  if (queryEmbedding === null) return keyword()
  const semantic = byKind(rankRecordsBySimilarity(scope, queryEmbedding, { statuses, limit }), kind)
  if (semantic.length > 0) return semantic
  return keyword()
}
```

Add `kind` to `scheduleLayerThree` (new param + `byKind` on the sibling candidates):

```ts
const scheduleLayerThree = (
  scope: MemoryScope,
  query: string,
  queryEmbedding: readonly number[] | null,
  storageContextId: string,
  limit: number,
  deps: RunRecallCascadeDeps,
): readonly RecallHit[] => {
  const siblings = rankCandidatesByQuery(
    listProvisionalRecords({ ...scope, excludeThreadContextId: storageContextId, limit: 200 }),
    query,
    queryEmbedding,
    { limit },
  )
  for (const record of siblings) deps.schedulePromotion(record, scope)
  return tag(siblings, 'other-thread')
}
```

→

```ts
const scheduleLayerThree = (
  scope: MemoryScope,
  query: string,
  queryEmbedding: readonly number[] | null,
  storageContextId: string,
  limit: number,
  kind: MemoryKind | undefined,
  deps: RunRecallCascadeDeps,
): readonly RecallHit[] => {
  const siblings = rankCandidatesByQuery(
    byKind(listProvisionalRecords({ ...scope, excludeThreadContextId: storageContextId, limit: 200 }), kind),
    query,
    queryEmbedding,
    { limit },
  )
  for (const record of siblings) deps.schedulePromotion(record, scope)
  return tag(siblings, 'other-thread')
}
```

Rewrite the body of `runRecallCascade` to compute `statuses` and pass `kind` through:

```ts
const limit = input.limit ?? RECALL_DEFAULT_LIMIT
const scope = resolveMemoryScope({ storageContextId: input.storageContextId, contextType: input.contextType })
const queryEmbedding = await deps.getEmbedding(input.query, input.configContextId)

if (input.contextType === 'dm') {
  return { records: dedupe(tag(searchActiveHybrid(scope, input.query, queryEmbedding, limit), 'group'), limit) }
}

const layer1 = rankCandidatesByQuery(
  listProvisionalRecords({ ...scope, threadContextId: input.storageContextId, limit: 100 }),
  input.query,
  queryEmbedding,
  { limit },
)
const layer2 = searchActiveHybrid(scope, input.query, queryEmbedding, limit)
const combined: RecallHit[] = [...tag(layer1, 'current'), ...tag(layer2, 'group')]

if (dedupe(combined, limit).length < limit) {
  combined.push(...scheduleLayerThree(scope, input.query, queryEmbedding, input.storageContextId, limit, deps))
}

return { records: dedupe(combined, limit) }
```

→

```ts
const limit = input.limit ?? RECALL_DEFAULT_LIMIT
const scope = resolveMemoryScope({ storageContextId: input.storageContextId, contextType: input.contextType })
const queryEmbedding = await deps.getEmbedding(input.query, input.configContextId)
const statuses: readonly MemoryStatus[] = input.includeStale === true ? ['active', 'stale'] : ['active']

if (input.contextType === 'dm') {
  const active = searchActiveHybrid(scope, input.query, queryEmbedding, limit, statuses, input.kind)
  return { records: dedupe(tag(active, 'group'), limit) }
}

const layer1 = rankCandidatesByQuery(
  byKind(listProvisionalRecords({ ...scope, threadContextId: input.storageContextId, limit: 100 }), input.kind),
  input.query,
  queryEmbedding,
  { limit },
)
const layer2 = searchActiveHybrid(scope, input.query, queryEmbedding, limit, statuses, input.kind)
const combined: RecallHit[] = [...tag(layer1, 'current'), ...tag(layer2, 'group')]

if (dedupe(combined, limit).length < limit) {
  combined.push(
    ...scheduleLayerThree(scope, input.query, queryEmbedding, input.storageContextId, limit, input.kind, deps),
  )
}

return { records: dedupe(combined, limit) }
```

- [ ] **Step 2: Run the cascade suite — existing tests still green (new inputs are optional).**

Run: `bun test tests/long-term-memory/recall-cascade.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Append two tests to `tests/long-term-memory/recall-cascade.test.ts`** (inside the existing `describe`, before its closing `})`). The `base` helper there defaults to a group/provisional record.

```ts
test('kind filter restricts results across layers', async () => {
  saveMemoryRecord(base({ id: 'k-fact', status: 'active', threadContextId: null, kind: 'fact' }))
  saveMemoryRecord(base({ id: 'k-pref', status: 'active', threadContextId: null, kind: 'preference' }))
  const out = await runRecallCascade(
    {
      storageContextId: 'g:thread:z',
      configContextId: 'g',
      contextType: 'group',
      query: 'friday deploy schedule',
      limit: 8,
      kind: 'preference',
    },
    { getEmbedding: () => Promise.resolve(null), schedulePromotion: () => undefined },
  )
  const ids = out.records.map((r) => r.id)
  expect(ids).toContain('k-pref')
  expect(ids).not.toContain('k-fact')
})

test('include_stale extends the active layer to stale records', async () => {
  saveMemoryRecord(base({ id: 's-stale', status: 'stale', threadContextId: null }))
  const without = await runRecallCascade(
    {
      storageContextId: 'g:thread:z',
      configContextId: 'g',
      contextType: 'group',
      query: 'friday deploy schedule',
      limit: 8,
    },
    { getEmbedding: () => Promise.resolve(null), schedulePromotion: () => undefined },
  )
  expect(without.records.map((r) => r.id)).not.toContain('s-stale')
  const withStale = await runRecallCascade(
    {
      storageContextId: 'g:thread:z',
      configContextId: 'g',
      contextType: 'group',
      query: 'friday deploy schedule',
      limit: 8,
      includeStale: true,
    },
    { getEmbedding: () => Promise.resolve(null), schedulePromotion: () => undefined },
  )
  expect(withStale.records.map((r) => r.id)).toContain('s-stale')
})
```

- [ ] **Step 4: Run + commit.**

Run: `bun test tests/long-term-memory/recall-cascade.test.ts`
Expected: PASS (5 tests).

```bash
git add src/long-term-memory/recall-cascade.ts tests/long-term-memory/recall-cascade.test.ts
git commit -m "feat(memory): thread kind/include_stale filters through the recall cascade"
```

---

## Task 2: `search_memory` runs the cascade (`src/tools/memory.ts`)

**Files:**

- Modify: `src/tools/memory.ts`
- Test: `tests/tools/memory.test.ts`

3-move: the existing `search_memory` test asserts `{ mode: 'keyword' }`, which the new output drops.

- [ ] **Step 1 (move A): in `tests/tools/memory.test.ts`, delete the `mode` assertion** from the `search_memory returns active scoped keyword matches` test:

```ts
expect(result).toMatchObject({ mode: 'keyword' })
assertMemoryRecordsResult(result)
expect(result.records.map((record) => record.id)).toEqual(['mem-user-match'])
```

→

```ts
assertMemoryRecordsResult(result)
expect(result.records.map((record) => record.id)).toEqual(['mem-user-match'])
```

Run: `bun test tests/tools/memory.test.ts` — expect PASS (old tool still returns those records; `mode` no longer asserted).

- [ ] **Step 2 (move B): edit `src/tools/memory.ts`.**

Add imports (after the existing `import { resolveMemoryScope } ...` line / with the other imports):

```ts
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { runRecallCascade, type RecallHit } from '../long-term-memory/recall-cascade.js'
```

Add a `toPublicHit` mapper right after `toPublicRecord`:

```ts
type PublicHit = PublicMemoryRecord & Readonly<{ provenance: RecallHit['provenance'] }>

const toPublicHit = (hit: RecallHit): PublicHit => ({ ...toPublicRecord(hit), provenance: hit.provenance })
```

Replace the whole `makeSearchMemoryTool`:

```ts
export function makeSearchMemoryTool(input: MemoryToolContext): ToolSet[string] {
  return tool({
    description: 'Search long-term memory in the current user or group scope by keyword.',
    inputSchema: z.object({
      query: z.string().min(1).max(500).describe('Keyword query to search for in memory records'),
      include_stale: z.boolean().optional().describe('Include stale memories in addition to active memories'),
      kind: optionalKindSchema,
      limit: limitSchema,
    }),
    execute: ({ query, include_stale: includeStale, kind, limit }) => {
      const scope = memoryScope(input)
      const records = searchMemoryRecords({ ...scope, query, includeStale: includeStale ?? false, kind, limit }).map(
        toPublicRecord,
      )
      log.debug(
        { scopeId: scope.scopeId, scopeType: scope.scopeType, includeStale, kind, limit, count: records.length },
        'Memory searched via tool',
      )
      return { mode: 'keyword', records }
    },
  })
}
```

→

```ts
export function makeSearchMemoryTool(input: MemoryToolContext): ToolSet[string] {
  return tool({
    description:
      'Search everything known in this conversation, the shared group memory, and other conversations (priority-ordered), by keyword or meaning. Optionally filter by kind or include stale memories.',
    inputSchema: z.object({
      query: z.string().min(1).max(500).describe('What to search for in memory'),
      include_stale: z.boolean().optional().describe('Include stale memories in addition to active memories'),
      kind: optionalKindSchema,
      limit: limitSchema,
    }),
    execute: async ({ query, include_stale: includeStale, kind, limit }) => {
      const configContextId = getConfigContextIdFromStorageContextId(input.storageContextId)
      const { records } = await runRecallCascade({
        storageContextId: input.storageContextId,
        configContextId,
        contextType: input.contextType,
        query,
        limit,
        kind,
        includeStale: includeStale ?? false,
      })
      log.debug(
        { storageContextId: input.storageContextId, kind, limit, count: records.length },
        'Memory searched via tool',
      )
      return { records: records.map(toPublicHit) }
    },
  })
}
```

(`searchMemoryRecords` stays imported — `makeForgetMemoryTool` still uses it.)

Run: `bun test tests/tools/memory.test.ts` — expect PASS (DM keyword cascade returns `['mem-user-match']`; the group-thread test still returns the `Dana` record).

- [ ] **Step 3 (move C): append new behavior tests to `tests/tools/memory.test.ts`** (inside the `memory tools` describe). These exercise provenance, the `kind` filter, `include_stale`, and group cross-thread surfacing:

```ts
test('search_memory tags results with provenance', async () => {
  saveMemoryRecord(memoryRecordInput({ id: 'mem-prov', scopeId: 'user-1', content: 'Use concise release notes.' }))
  const tool = makeSearchMemoryTool({ storageContextId: 'user-1', contextType: 'dm' })
  const result = await getToolExecutor(tool)({ query: 'concise' })
  assertMemoryRecordsResult(result)
  const records = result.records as readonly Readonly<{ id: string; provenance: string }>[]
  expect(records.find((r) => r.id === 'mem-prov')?.provenance).toBe('group')
})

test('search_memory filters by kind', async () => {
  saveMemoryRecord(
    memoryRecordInput({ id: 'mem-fact', scopeId: 'user-1', content: 'release notes are concise', kind: 'fact' }),
  )
  saveMemoryRecord(
    memoryRecordInput({
      id: 'mem-pref',
      scopeId: 'user-1',
      content: 'release notes are concise',
      kind: 'preference',
    }),
  )
  const tool = makeSearchMemoryTool({ storageContextId: 'user-1', contextType: 'dm' })
  const result = await getToolExecutor(tool)({ query: 'concise', kind: 'preference' })
  assertMemoryRecordsResult(result)
  const ids = result.records.map((r) => r.id)
  expect(ids).toContain('mem-pref')
  expect(ids).not.toContain('mem-fact')
})

test('search_memory includes stale only when asked', async () => {
  saveMemoryRecord(
    memoryRecordInput({ id: 'mem-old', scopeId: 'user-1', content: 'concise legacy note', status: 'stale' }),
  )
  const tool = makeSearchMemoryTool({ storageContextId: 'user-1', contextType: 'dm' })
  const base = await getToolExecutor(tool)({ query: 'concise' })
  assertMemoryRecordsResult(base)
  expect(base.records.map((r) => r.id)).not.toContain('mem-old')
  const withStale = await getToolExecutor(tool)({ query: 'concise', include_stale: true })
  assertMemoryRecordsResult(withStale)
  expect(withStale.records.map((r) => r.id)).toContain('mem-old')
})
```

Run: `bun test tests/tools/memory.test.ts` — expect PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/tools/memory.ts tests/tools/memory.test.ts
git commit -m "feat(memory): search_memory uses the recall cascade (provenance, kind, include_stale)"
```

---

## Task 3: Remove the `recall` tool

**Files:**

- Modify: `src/tools/provider-independent-tools-builder.ts`, `src/tools/tool-metadata.ts`
- Delete: `src/tools/recall.ts`, `tests/tools/recall.test.ts`
- Test: `tests/tools/provider-independent-tools-builder.test.ts`, `tests/long-term-memory/stop-rediscovering.acceptance.test.ts`

One type-clean commit: the `recall.ts` delete requires every importer gone first. Do the test/importer edits, then delete.

- [ ] **Step 1: Replace the `recall registration` describe in `tests/tools/provider-independent-tools-builder.test.ts`** (lines ~59–83) with a `search_memory` one. Against the current builder (recall still registered, search_memory also registered) these pass immediately:

```ts
describe('search_memory registration', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
  })

  it('registers search_memory in normal mode for a group context', () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-mem-group', 'normal', 'group'))
    expect(tools['search_memory']).toBeDefined()
  })

  it('registers search_memory in normal mode for a dm context', () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-mem-dm', 'normal', 'dm'))
    expect(tools['search_memory']).toBeDefined()
  })

  it('registers search_memory in proactive mode (mode-independent)', () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-mem-proactive', 'proactive', 'group'))
    expect(tools['search_memory']).toBeDefined()
  })
})
```

Run: `bun test tests/tools/provider-independent-tools-builder.test.ts` — expect PASS.

- [ ] **Step 2: Repoint `tests/long-term-memory/stop-rediscovering.acceptance.test.ts`.**

Change the import (line ~13):

```ts
import { makeRecallMemoryTool } from '../../src/tools/recall.js'
```

→

```ts
import { makeSearchMemoryTool } from '../../src/tools/memory.js'
```

Change the tool construction (line ~88) `makeRecallMemoryTool({ storageContextId: 'g:thread:z', contextType: 'group' })` →
`makeSearchMemoryTool({ storageContextId: 'g:thread:z', contextType: 'group' })`. The executor result is `{ records }` (no `mode`); if the test destructures or asserts a `mode` field, drop that — keep the assertions that the promoted fact appears in `records`. Run `bun test tests/long-term-memory/stop-rediscovering.acceptance.test.ts` — expect PASS.

- [ ] **Step 3: Delete the recall tool test.**

```bash
git rm tests/tools/recall.test.ts
```

- [ ] **Step 4: Edit `src/tools/provider-independent-tools-builder.ts`** — remove the import and the registration block:

```ts
import { makeRecallMemoryTool } from './recall.js'
```

(delete that import line)

```ts
if (contextId !== undefined && contextType !== undefined && mode === 'normal') {
  tools['recall'] = makeRecallMemoryTool({ storageContextId: contextId, contextType })
}
```

(delete that block)

Run: `bun test tests/tools/provider-independent-tools-builder.test.ts` — expect PASS (search_memory still registered via `addMemoryTools`).

- [ ] **Step 5: Edit `src/tools/tool-metadata.ts`** — remove the `recall` entry:

```ts
  search_memory: read('memory'),
  recall: read('memory'),
```

→

```ts
  search_memory: read('memory'),
```

Run: `bun test tests/tools/tool-metadata.test.ts` — expect PASS (no `recall` assertion there).

- [ ] **Step 6: Delete the recall tool source, then commit.**

```bash
git rm src/tools/recall.ts
grep -rn "tools/recall\|makeRecallMemoryTool" src tests
# expected: no matches
bun typecheck
# expected: clean (no dangling recall.js imports)
git add src/tools/provider-independent-tools-builder.ts src/tools/tool-metadata.ts tests/tools/provider-independent-tools-builder.test.ts tests/long-term-memory/stop-rediscovering.acceptance.test.ts
git commit -m "refactor(tools): remove recall tool (search_memory is now the single retriever)"
```

(The `git rm` of `recall.ts` and `recall.test.ts` are already staged by their `git rm`; the `git add` stages the rest.)

---

## Task 4: Retarget the memory system-prompt fragment

**Files:**

- Modify: `src/system-prompt.ts`
- Test: rename `tests/system-prompt-recall.test.ts` → `tests/system-prompt-memory-search.test.ts`

- [ ] **Step 1: Edit `src/system-prompt.ts`.**

```ts
const MEMORY_RECALL = `MEMORY RECALL
You can recall prior knowledge with the recall tool, which searches in priority order: this conversation, then shared group memory, then other conversations. Use it before re-asking the user or assuming nothing is known.`
```

→

```ts
const MEMORY_SEARCH = `MEMORY SEARCH
You can look up what is already known with the search_memory tool, which searches in priority order: this conversation, then shared group memory, then other conversations. Use it before re-asking the user or assuming nothing is known.`
```

And the fragment registration:

```ts
  { text: MEMORY_RECALL, requiredTools: ['recall'] },
```

→

```ts
  { text: MEMORY_SEARCH, requiredTools: ['search_memory'] },
```

Run the mapped prompt suite: `bun test tests/system-prompt.test.ts` — expect PASS (no assertion on this fragment there).

- [ ] **Step 2: Rename and update the fragment test.**

```bash
git mv tests/system-prompt-recall.test.ts tests/system-prompt-memory-search.test.ts
```

Edit `tests/system-prompt-memory-search.test.ts` — point the enabled-tool set at `search_memory` and update wording:

```ts
describe('recall preamble', () => {
```

→

```ts
describe('memory search preamble', () => {
```

```ts
test('present only when the recall tool is enabled', () => {
  const withRecall = buildProviderlessSystemPrompt('g:thread:a', new Set(['recall']), {
    askPermissionAvailable: true,
    contextType: 'group',
  })
  const without = buildProviderlessSystemPrompt('g:thread:a', new Set(['create_task']), {
    askPermissionAvailable: true,
    contextType: 'group',
  })
  expect(withRecall.toLowerCase()).toContain('priority order')
  expect(without.toLowerCase()).not.toContain('priority order')
})
```

→

```ts
test('present only when the search_memory tool is enabled', () => {
  const withSearch = buildProviderlessSystemPrompt('g:thread:a', new Set(['search_memory']), {
    askPermissionAvailable: true,
    contextType: 'group',
  })
  const without = buildProviderlessSystemPrompt('g:thread:a', new Set(['create_task']), {
    askPermissionAvailable: true,
    contextType: 'group',
  })
  expect(withSearch.toLowerCase()).toContain('priority order')
  expect(without.toLowerCase()).not.toContain('priority order')
})
```

Run: `bun test tests/system-prompt-memory-search.test.ts` — expect PASS.

- [ ] **Step 3: Commit.**

```bash
git add src/system-prompt.ts tests/system-prompt-recall.test.ts tests/system-prompt-memory-search.test.ts
git commit -m "refactor(prompt): retarget memory fragment from recall to search_memory"
```

---

## Task 5: Documentation

**Files:** `CLAUDE.md`, `src/tools/CLAUDE.md`, (`README.md` if needed)

- [ ] **Step 1: Update `CLAUDE.md`.** Grep: `grep -n "recall" CLAUDE.md`. In the cross-thread memory bridge paragraph, change the "(2) **Recall** — the `recall` tool …" clause to "(2) **Retrieval** — the `search_memory` tool runs the server-side cascade (`recall-cascade.ts`): current-thread provisional → active group memory → sibling-thread provisional, with optional `kind`/`include_stale` filters." Remove any other standalone `recall` tool mention in the Tools section (the read tool is now `search_memory`).

- [ ] **Step 2: Update `src/tools/CLAUDE.md` and check README.** Grep: `grep -n "recall\|search_memory" src/tools/CLAUDE.md README.md`. If `src/tools/CLAUDE.md` names a `recall` tool, change it to describe `search_memory` as the single cascade-backed retriever. Touch `README.md` only if it names the `recall` tool.

- [ ] **Step 3: Format + commit.**

```bash
bunx oxfmt CLAUDE.md src/tools/CLAUDE.md
git add CLAUDE.md src/tools/CLAUDE.md
git commit -m "docs: search_memory is the single cascade-backed memory retriever"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: No dangling recall references.**

Run: `grep -rn "makeRecallMemoryTool\|tools/recall\|'recall'\|\"recall\"" src tests`
Expected: no matches (the only `recall` left in code is `recall-cascade`/`runRecallCascade`/`RecallHit`, which are the retained engine — those are fine).

- [ ] **Step 2: Static checks.**

Run: `bun typecheck` — expect no errors.
Run: `bun knip` — expect clean (confirms `recall.ts` removal left no unused exports; `searchMemoryRecords` still used by `forget_memory`).
Run: `bun run format:check` — expect clean.
Run: `bunx oxlint $(git diff --name-only <baseline>..HEAD | grep -E '\.(ts|svelte)$' | tr '\n' ' ')` — expect 0 errors on changed files.

- [ ] **Step 3: Test suites.**

Run: `bun test tests/tools/ tests/long-term-memory/ tests/system-prompt.test.ts tests/system-prompt-memory-search.test.ts`
Expected: all PASS.

- [ ] **Step 4: Manual sanity (optional).** In a group thread, `search_memory` returns provisional + active + sibling hits with `provenance` and honors `kind`/`include_stale`; in a DM it returns active records with the same filters. The agent no longer has a separate `recall` tool.

- [ ] **Step 5: Commit any verification fixes (only if Steps 1–3 surfaced changes).**

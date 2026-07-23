<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Context-tools clarity & discoverability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the description/organization gaps in the four always-on context tools (`get_current_time`, `search_tools`, `load_tool`, `expand_result`) by adding conditional payload guidance, rewording descriptions, bounding a leaky schema, and renaming two mis-named constants — without adding any standing system-prompt tokens.

**Architecture:** Guidance lives where it costs nothing on the happy path: **result payloads** carry a `hint`/`warning` field only in the failure case, and **descriptions** are reworded (never grown). Two byte-named constants that are actually character counts are renamed for correctness. One unbounded integer field gets a sane `.max()` so the provider stops seeing `MAX_SAFE_INTEGER`.

**Tech Stack:** TypeScript (strict), Bun test runner (`bun:test`), Zod v4, Vercel AI SDK `tool()` factory.

**Spec:** `docs/superpowers/specs/2026-07-23-context-tools-clarity-design.md`

## Global Constraints

- Runtime **Bun**; validation **Zod v4**; **use `.js` extension in import paths**.
- **Never add lint-disable or type-ignore comments** — fix the underlying issue.
- Every `.ts`/`.md` file carries the BUSL-1.1 header (a pre-commit hook enforces it). All files touched here already have it; new files must include it.
- **No addition to the always-on system prompt.** All new guidance is conditional payload or reworded description.
- Happy-path payload shapes must stay byte-identical: new `hint`/`warning` fields appear **only** in the empty/failure branch.
- Test invocation: `bun test <path>` for a file, `bun test <path> -t "<name substring>"` for one test.
- Full gate before final sign-off: `bun run lint` and `bun run typecheck` (both must exit 0).

---

### Task 1: Rename byte-named char constants (H)

Pure refactor. `COMPACTION_PREVIEW_BYTES` and `EXPAND_DEFAULT_LIMIT_BYTES` are fed to string `.slice()` / used as a character limit, so they are character counts, not bytes. `COMPACTION_THRESHOLD_BYTES` is left untouched — it correctly gates on `Buffer.byteLength`.

**Files:**
- Modify: `src/tools/compaction/constants.ts`
- Modify: `src/tools/compaction/expand-result.ts` (import + 2 uses)
- Modify: `src/tools/compaction/wrap-compaction.ts` (import + 1 use)
- Test: `tests/tools/compaction/constants.test.ts` (import + assertions)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `EXPAND_DEFAULT_LIMIT_CHARS: number` and `COMPACTION_PREVIEW_CHARS: number` exported from `src/tools/compaction/constants.js` (replacing the `…_BYTES` names). Task 2 consumes `EXPAND_DEFAULT_LIMIT_CHARS`.

- [ ] **Step 1: Update the failing test to the new names**

In `tests/tools/compaction/constants.test.ts`, replace the two identifiers in both the import block and the assertions. Final file body (lines 8–32):

```typescript
import {
  COMPACTION_THRESHOLD_BYTES,
  COMPACTION_PREVIEW_CHARS,
  RESULT_STORE_MAX_ENTRIES,
  RESULT_STORE_TTL_MS,
  EXPAND_DEFAULT_LIMIT_CHARS,
} from '../../../src/tools/compaction/constants.js'

describe('compaction constants', () => {
  it('exports positive numeric constants', () => {
    expect(COMPACTION_THRESHOLD_BYTES).toBeGreaterThan(0)
    expect(COMPACTION_PREVIEW_CHARS).toBeGreaterThan(0)
    expect(RESULT_STORE_MAX_ENTRIES).toBeGreaterThan(0)
    expect(RESULT_STORE_TTL_MS).toBeGreaterThan(0)
    expect(EXPAND_DEFAULT_LIMIT_CHARS).toBeGreaterThan(0)
    expect(Number.isInteger(RESULT_STORE_MAX_ENTRIES)).toBe(true)
  })

  it('has preview chars smaller than threshold bytes', () => {
    expect(COMPACTION_PREVIEW_CHARS).toBeLessThan(COMPACTION_THRESHOLD_BYTES)
  })

  it('has expand default limit smaller than threshold bytes', () => {
    expect(EXPAND_DEFAULT_LIMIT_CHARS).toBeLessThan(COMPACTION_THRESHOLD_BYTES)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/tools/compaction/constants.test.ts`
Expected: FAIL — module has no export named `COMPACTION_PREVIEW_CHARS` / `EXPAND_DEFAULT_LIMIT_CHARS`.

- [ ] **Step 3: Rename the constants in `constants.ts`**

In `src/tools/compaction/constants.ts`, rename the two lines (leave `COMPACTION_THRESHOLD_BYTES`, `RESULT_STORE_MAX_ENTRIES`, `RESULT_STORE_TTL_MS` as-is):

```typescript
export const COMPACTION_PREVIEW_CHARS = 600
export const EXPAND_DEFAULT_LIMIT_CHARS = 4_000
```

- [ ] **Step 4: Update the two consumers**

In `src/tools/compaction/wrap-compaction.ts` — the import (line 10) and the use (line 60):

```typescript
import { COMPACTION_PREVIEW_CHARS } from './constants.js'
```
```typescript
  const preview = decision.serialized.slice(0, COMPACTION_PREVIEW_CHARS)
```

In `src/tools/compaction/expand-result.ts` — the import (line 11), the `.default(...)` (line 28), and the `resolvedLimit` fallback (line 34):

```typescript
import { EXPAND_DEFAULT_LIMIT_CHARS } from './constants.js'
```
```typescript
        .default(EXPAND_DEFAULT_LIMIT_CHARS)
```
```typescript
      const resolvedLimit = limit ?? EXPAND_DEFAULT_LIMIT_CHARS
```

- [ ] **Step 5: Run the constants test and a broad compaction test to verify green**

Run: `bun test tests/tools/compaction/constants.test.ts`
Expected: PASS (3 tests).

Run: `grep -rn "COMPACTION_PREVIEW_BYTES\|EXPAND_DEFAULT_LIMIT_BYTES" src tests`
Expected: no output (no stale references remain).

- [ ] **Step 6: Commit**

```bash
git add src/tools/compaction/constants.ts src/tools/compaction/expand-result.ts src/tools/compaction/wrap-compaction.ts tests/tools/compaction/constants.test.ts
git commit -m "refactor(compaction): rename char-count constants from _BYTES to _CHARS"
```

---

### Task 2: Bound `expand_result.offset` (D)

Add a generous, readable upper bound to the `offset` field so schema serialization stops emitting `maximum: 9007199254740991` (`MAX_SAFE_INTEGER`) to the provider.

**Files:**
- Modify: `src/tools/compaction/constants.ts` (add one export)
- Modify: `src/tools/compaction/expand-result.ts` (import + `.max()` on `offset`)
- Test: `tests/tools/compaction/expand-result-offset.test.ts` (create)

**Interfaces:**
- Consumes: `EXPAND_DEFAULT_LIMIT_CHARS` from Task 1 (already imported in the file).
- Produces: `EXPAND_MAX_OFFSET_CHARS: number` exported from `src/tools/compaction/constants.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/tools/compaction/expand-result-offset.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { EXPAND_MAX_OFFSET_CHARS } from '../../../src/tools/compaction/constants.js'
import { makeExpandResultTool } from '../../../src/tools/compaction/expand-result.js'
import { schemaValidates } from '../../utils/test-helpers.js'

describe('expand_result offset bound', () => {
  it('accepts an offset at the maximum', () => {
    const t = makeExpandResultTool('ctx-1')
    expect(schemaValidates(t, { handle: 'res_ab12', offset: EXPAND_MAX_OFFSET_CHARS })).toBe(true)
  })

  it('rejects an offset above the maximum', () => {
    const t = makeExpandResultTool('ctx-1')
    expect(schemaValidates(t, { handle: 'res_ab12', offset: EXPAND_MAX_OFFSET_CHARS + 1 })).toBe(false)
  })

  it('does not leave the offset schema unbounded at MAX_SAFE_INTEGER', () => {
    expect(EXPAND_MAX_OFFSET_CHARS).toBeLessThan(Number.MAX_SAFE_INTEGER)
    expect(EXPAND_MAX_OFFSET_CHARS).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/tools/compaction/expand-result-offset.test.ts`
Expected: FAIL — module has no export named `EXPAND_MAX_OFFSET_CHARS`.

- [ ] **Step 3: Add the constant**

In `src/tools/compaction/constants.ts`, append:

```typescript
export const EXPAND_MAX_OFFSET_CHARS = 100_000_000
```

- [ ] **Step 4: Apply the bound to the schema**

In `src/tools/compaction/expand-result.ts`, extend the constants import (line 11) and add `.max(...)` to the `offset` field (line ~22):

```typescript
import { EXPAND_DEFAULT_LIMIT_CHARS, EXPAND_MAX_OFFSET_CHARS } from './constants.js'
```
```typescript
      offset: z.number().int().min(0).max(EXPAND_MAX_OFFSET_CHARS).default(0).describe('Character offset to start from'),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/tools/compaction/expand-result-offset.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/tools/compaction/constants.ts src/tools/compaction/expand-result.ts tests/tools/compaction/expand-result-offset.test.ts
git commit -m "fix(expand_result): bound offset so schema stops emitting MAX_SAFE_INTEGER"
```

---

### Task 3: `load_tool` unknown-name warning (B)

Add a `warning` field to the result **only** when one or more requested names were not recognized. Happy path (`unknown: []`) stays byte-identical.

**Files:**
- Modify: `src/tools/disclosure/load-tool.ts`
- Test: `tests/tools/disclosure/load-tool.test.ts` (extend)

**Interfaces:**
- Consumes: `session.markLoaded(names) → { loaded: string[]; unknown: string[] }` and `session.activeToolNames(): string[]` (existing, unchanged).
- Produces: `load_tool` result gains an optional `warning?: string`, present iff `unknown.length > 0`.

- [ ] **Step 1: Write the failing tests**

In `tests/tools/disclosure/load-tool.test.ts`, widen the `LoadOut` interface to allow the optional field, then add two tests inside the `describe('load_tool', …)` block.

Change the interface (lines 25–29) to:

```typescript
interface LoadOut {
  loaded: string[]
  unknown: string[]
  nowActive: number
  warning?: string
}
```

Add these two tests after the existing `'reports an all-unknown batch…'` test:

```typescript
  it('adds a warning naming the unrecognized tools', async () => {
    const tools: ToolSet = { get_current_time: d(), search_tools: d(), load_tool: d(), list_tasks: d() }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const exec = getToolExecutor(makeLoadToolTool(session, 'ctx-1'))
    const out: unknown = await exec({ names: ['list_tasks', 'bogus'] })
    assert.ok(isLoadOut(out))
    expect(out.warning).toBeDefined()
    expect(out.warning).toContain('bogus')
  })

  it('omits the warning when every name is recognized', async () => {
    const tools: ToolSet = { get_current_time: d(), search_tools: d(), load_tool: d(), list_tasks: d() }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const exec = getToolExecutor(makeLoadToolTool(session, 'ctx-1'))
    const out: unknown = await exec({ names: ['list_tasks'] })
    assert.ok(isLoadOut(out))
    expect(out.warning).toBeUndefined()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/tools/disclosure/load-tool.test.ts -t "warning"`
Expected: FAIL — `out.warning` is `undefined` in the first new test.

- [ ] **Step 3: Add the conditional warning**

In `src/tools/disclosure/load-tool.ts`, replace the `execute` body's return (currently `return { loaded, unknown, nowActive }`) with:

```typescript
    execute: ({ names }) => {
      const { loaded, unknown } = session.markLoaded(names)
      const nowActive = session.activeToolNames().length
      emitUser('disclosure:load', contextId, { loadedCount: loaded.length, unknownCount: unknown.length, nowActive })
      log.debug({ contextId, loadedCount: loaded.length, unknownCount: unknown.length, nowActive }, 'load_tool served')
      const result = { loaded, unknown, nowActive }
      if (unknown.length === 0) return result
      return {
        ...result,
        warning: `Not activated (unrecognized): ${unknown.join(', ')}. Use search_tools for exact names.`,
      }
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/tools/disclosure/load-tool.test.ts`
Expected: PASS (4 tests — 2 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/load-tool.ts tests/tools/disclosure/load-tool.test.ts
git commit -m "feat(load_tool): warn when requested tool names are unrecognized"
```

---

### Task 4: `search_tools` empty-result hint + domain map + `limit` policy (A + C + F)

On a miss, return a `hint` listing the domains actually present in the current context's discoverable set (deduped, sorted). Rewrite the `limit` schema description into an actionable policy. Happy path (non-empty `results`) stays byte-identical.

**Files:**
- Modify: `src/tools/disclosure/search-tools.ts`
- Test: `tests/tools/disclosure/search-tools.test.ts` (extend)

**Interfaces:**
- Consumes: `retriever.rank(query, discoverable, limit)`, `session.activeToolNames()`, `buildBriefs(toolsForBriefs)` (existing). `discoverable` is the already-computed `ToolBrief[]` with `.domain: string`.
- Produces: `search_tools` result gains an optional `hint?: string`, present iff `results.length === 0`. Existing `results` shape unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/tools/disclosure/search-tools.test.ts`, extend `SearchOut` to carry the optional hint and add two tests. Change the interface (lines 34–36) to:

```typescript
interface SearchOut {
  results: SearchResult[]
  hint?: string
}
```

Add these tests inside `describe('search_tools', …)`:

```typescript
  it('returns a hint listing available domains when nothing matches', async () => {
    const tools: ToolSet = {
      get_current_time: d('Get the time.'),
      search_tools: d('search'),
      load_tool: d('load'),
      list_tasks: d('List tasks in a project.'),
      web_fetch: d('Fetch a web page.'),
    }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const exec = getToolExecutor(makeSearchToolsTool(session, new LexicalToolRetriever(), 'ctx-1', tools))
    const out: unknown = await exec({ query: 'zzzznomatchzzz', limit: 5 })
    assert.ok(isSearchOut(out))
    expect(out.results).toEqual([])
    expect(out.hint).toBeDefined()
    // Domains come from the discoverable tools (task, web) — never from always-on tools.
    expect(out.hint).toContain('task')
    expect(out.hint).toContain('web')
  })

  it('omits the hint when there are matching results', async () => {
    const tools: ToolSet = {
      get_current_time: d('Get the time.'),
      search_tools: d('search'),
      load_tool: d('load'),
      list_tasks: d('List tasks in a project.'),
    }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const exec = getToolExecutor(makeSearchToolsTool(session, new LexicalToolRetriever(), 'ctx-1', tools))
    const out: unknown = await exec({ query: 'list tasks', limit: 5 })
    assert.ok(isSearchOut(out))
    expect(out.results.length).toBeGreaterThan(0)
    expect(out.hint).toBeUndefined()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/tools/disclosure/search-tools.test.ts -t "hint"`
Expected: FAIL — `out.hint` is `undefined` in the empty-result test.

- [ ] **Step 3: Add the conditional hint and reword the `limit` description**

In `src/tools/disclosure/search-tools.ts`:

Reword the `limit` field description in `inputSchema`:

```typescript
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(8)
        .describe('Maximum tools to return (default 8). Raise it when a first search returns nothing relevant.'),
```

In the `try` block, replace `return { results }` (after building `results`) with the empty-branch hint. The full block becomes:

```typescript
        const ranked = await retriever.rank(query, discoverable, limit)
        const loadedNow = new Set(session.activeToolNames())
        const results = ranked.map((b) => ({
          name: b.name,
          summary: b.summary,
          domain: b.domain,
          alreadyLoaded: loadedNow.has(b.name),
        }))
        emitUser('disclosure:search', contextId, { queryLength: query.length, resultCount: results.length })
        log.debug({ contextId, queryLength: query.length, resultCount: results.length }, 'search_tools served')
        if (results.length > 0) return { results }
        const domains = [...new Set(discoverable.map((b) => b.domain))].sort()
        return {
          results,
          hint: `No tool matched. Retry with different wording or a domain keyword: ${domains.join(', ')}.`,
        }
```

Note: `limit` in the schema stays `.min(1)`, so `limit: 5` in the tests always yields a non-empty `ranked` unless the retriever scores nothing. The `LexicalToolRetriever` returns `[]` when no brief scores > 0 (e.g. the nonsense query `'zzzznomatchzzz'`), which is exactly the miss branch under test.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/tools/disclosure/search-tools.test.ts`
Expected: PASS (5 tests — 3 existing + 2 new). The existing `'does not surface always-on tools…'` test queries `'time'` against a tool set whose only discoverable briefs are filtered out, so it still returns `results: []`; it asserts only `results`, so the added `hint` key does not break it.

- [ ] **Step 5: Commit**

```bash
git add src/tools/disclosure/search-tools.ts tests/tools/disclosure/search-tools.test.ts
git commit -m "feat(search_tools): hint available domains on empty results; sharpen limit description"
```

---

### Task 5: `get_current_time` reframe as fallback (E + G)

Reword the description so it agrees with `system-prompt.ts:21` (the injected `<current_time>` line is authoritative; this tool is the fallback). Drop the redundant `.describe('No arguments required.')` on the empty input schema. No output-shape change.

**Files:**
- Modify: `src/tools/get-current-time.ts`
- Test: `tests/tools/get-current-time.test.ts` (extend; existing assertions must stay green)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no shape change. `makeGetCurrentTimeTool(userId?)` still returns `{ datetime, timezone, formatted }`.

- [ ] **Step 1: Write the failing test**

In `tests/tools/get-current-time.test.ts`, add a test asserting the description now frames the tool as a fallback referencing `<current_time>`. Match the file's existing import/describe style (it uses `bun:test` + `node:assert/strict`). Add inside the top-level `describe`:

```typescript
  test('describes itself as a fallback to the injected current_time line', () => {
    const tool = makeGetCurrentTimeTool('user-1')
    assert(typeof tool.description === 'string', 'description should be a string')
    expect(tool.description).toContain('<current_time>')
    expect(tool.description.toLowerCase()).toContain('fallback')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/tools/get-current-time.test.ts -t "fallback"`
Expected: FAIL — current description contains neither `<current_time>` nor `fallback`.

- [ ] **Step 3: Reword the description and drop the dead schema note**

In `src/tools/get-current-time.ts`, replace the `description` and `inputSchema` inside `makeGetCurrentTimeTool` (lines 59–61):

```typescript
    description:
      'Fallback for the current date and time in the user\'s timezone. Each user message normally begins with an authoritative <current_time> line — prefer that when present. Call this only when it is absent, e.g. to resolve relative dates like "tomorrow" or "next Monday".',
    inputSchema: z.object({}),
```

- [ ] **Step 4: Run the full file to verify new + existing tests pass**

Run: `bun test tests/tools/get-current-time.test.ts`
Expected: PASS — the new `fallback` test plus all existing assertions (ISO shape, no trailing `Z`, timezone resolution, formatted string) stay green, proving the reword introduced no shape change.

- [ ] **Step 5: Commit**

```bash
git add src/tools/get-current-time.ts tests/tools/get-current-time.test.ts
git commit -m "docs(get_current_time): reframe as fallback to injected current_time line"
```

---

### Task 6: Full gate

**Files:** none (verification only).

- [ ] **Step 1: Run lint**

Run: `bun run lint`
Expected: exit 0.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Run the touched test files together**

Run: `bun test tests/tools/compaction/constants.test.ts tests/tools/compaction/expand-result-offset.test.ts tests/tools/disclosure/load-tool.test.ts tests/tools/disclosure/search-tools.test.ts tests/tools/get-current-time.test.ts`
Expected: all PASS.

- [ ] **Step 4: Confirm no stale byte-named constants remain**

Run: `grep -rn "COMPACTION_PREVIEW_BYTES\|EXPAND_DEFAULT_LIMIT_BYTES" src tests`
Expected: no output.

---

## Self-Review

**Spec coverage:**
- A (empty-result hint) → Task 4 ✓
- B (load_tool warning) → Task 3 ✓
- C (domain map) → Task 4, dynamically derived from `discoverable` ✓
- D (bound offset) → Task 2 ✓
- E (get_current_time fallback reframe) → Task 5 ✓
- F (limit policy) → Task 4 ✓
- G (drop "No arguments required.") → Task 5, Step 3 ✓
- H (constant renames) → Task 1 ✓
- Out-of-scope items (live-tool renames, systemic serializer fix, other tools' descriptions, prompt additions) → none introduced ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code and exact commands. ✓

**Type consistency:**
- `EXPAND_DEFAULT_LIMIT_CHARS` / `COMPACTION_PREVIEW_CHARS` named identically in Task 1 definition and Task 1 Step 4 consumers. ✓
- `EXPAND_MAX_OFFSET_CHARS` defined in Task 2 Step 3, consumed in Task 2 Steps 1 & 4. ✓
- `warning?: string` (Task 3) and `hint?: string` (Task 4) match between the interface widening in the test and the implementation return. ✓
- `session.markLoaded`/`activeToolNames` signatures match `src/tools/disclosure/registry.ts`. ✓

**Ordering:** Task 1 (rename) precedes Task 2 (which imports `EXPAND_DEFAULT_LIMIT_CHARS` alongside the new constant), so Task 2 never references a stale name. ✓

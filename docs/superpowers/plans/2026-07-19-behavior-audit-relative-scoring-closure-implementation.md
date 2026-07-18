<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Behavior Audit — Relative Scoring + Codeindex Closure Check (Tier 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorient Phase 3 persona scores as relative signals within each domain (percentile rank, bottom-decile flag, trend across snapshots), and add a new Phase 2c closure verifier that grounds each consolidated user story in actual reachable code (commands, tools, handlers, routes) using codeindex.

**Architecture:** Two parallel changes ship together. Part A adds a `stories/scores.json` machine-readable sidecar plus percentile/trend computations to `report-writer.ts`. Part B extends the Phase 2b schema with `entryPointHints`, runs a new no-LLM verifier step (Phase 2c) using `listCommandCatalogEntries` for commands and codeindex for handlers, and surfaces results in the reports.

**Tech Stack:** Bun, TypeScript, Zod, `bun:test`, codeindex library, papai command catalog (`src/commands/catalog.ts`).

**Spec:** `docs/superpowers/specs/2026-07-19-behavior-audit-relative-scoring-closure-design.md`

**Depends on:** Tier 1 for trend snapshots (degrades gracefully if Tier 1 absent); Tier 2 for `CONCURRENCY` knob (uses `pLimit(CONCURRENCY)` for the verifier).

---

## File Structure

| File                                               | Responsibility                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `scripts/behavior-audit/consolidate-agent.ts`      | +`entryPointHints` field on schema, +prompt clause                         |
| `scripts/behavior-audit/closure-verifier.ts`       | new Phase 2c verifier: resolves hints to symbols, writes closure field     |
| `scripts/behavior-audit/consolidated-store.ts`     | +`closure?: ClosureResult` field on `ConsolidatedBehavior` schema          |
| `scripts/behavior-audit/index.ts`                  | wire Phase 2c between Phase 2b save and Phase 3 start                      |
| `scripts/behavior-audit/report-writer.ts`          | +emit `scores.json`, +percentile/trend/closure in markdown                 |
| `scripts/behavior-audit/report-index-helpers.ts`   | +`computePercentiles`, +bottom-decile helpers                              |
| `scripts/behavior-audit/report-rebuild-helpers.ts` | +`loadPriorSnapshot`, +`computeTrendDeltas`                                |
| `scripts/behavior-audit/scores-types.ts`           | new — `ScoresFile`, `StoryEntry`, `EntryPointEntry`, `ClosureResult` types |
| tests (multiple new + extended)                    | see per-task                                                               |

---

## Task 1: New shared types in `scores-types.ts`

**Files:**

- Create: `scripts/behavior-audit/scores-types.ts`

- [ ] **Step 1: Write the types file**

Create `scripts/behavior-audit/scores-types.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type EntryPointKind = 'command' | 'tool' | 'handler' | 'route'

export type ClosureStatus = 'resolved' | 'partial' | 'unresolved' | 'unverified'

export interface EntryPointEntry {
  readonly kind: EntryPointKind
  readonly identifier: string
  readonly resolved: boolean
  readonly evidence: { readonly filePath: string; readonly symbol?: string } | null
}

export interface EntryPointHint {
  readonly kind: EntryPointKind
  readonly identifier: string
}

export interface ClosureResult {
  readonly closureStatus: ClosureStatus
  readonly entryPoints: readonly EntryPointEntry[]
}

export interface PersonaScore {
  readonly discover: number
  readonly use: number
  readonly retain: number
}

export interface StoryEntry {
  readonly featureKey: string
  readonly consolidatedId: string
  readonly domain: string
  readonly featureName: string
  readonly userStory: string
  readonly composite: number
  readonly percentile: number
  readonly bottomDecile: boolean
  readonly maria: PersonaScore
  readonly dani: PersonaScore
  readonly viktor: PersonaScore
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
  readonly trendDelta: number | null
  readonly closureStatus: ClosureStatus
  readonly entryPoints: readonly EntryPointEntry[]
}

export interface DomainEntry {
  readonly domain: string
  readonly stories: readonly StoryEntry[]
}

export interface ScoresFile {
  readonly generatedAt: string
  readonly model: string
  readonly domains: readonly DomainEntry[]
}
```

- [ ] **Step 2: Typecheck**

Run: `bun typecheck`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/scores-types.ts
git commit -m "feat(behavior-audit): add shared types for scores sidecar and closure check"
```

---

## Task 2: Add `entryPointHints` to Phase 2b schema

**Files:**

- Modify: `scripts/behavior-audit/consolidate-agent.ts:31-58`

- [ ] **Step 1: Write a failing schema test**

Create `tests/scripts/behavior-audit/consolidate-agent-schema.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { type ConsolidationResult } from '../../../scripts/behavior-audit/consolidate-agent.js'

describe('ConsolidationItemSchema', () => {
  test('accepts item without entryPointHints (defaults to empty)', async () => {
    const mod = await import('../../../scripts/behavior-audit/consolidate-agent.js')
    const parse: (input: unknown) => ConsolidationResult = (
      mod as unknown as { parseConsolidationResult: (i: unknown) => ConsolidationResult }
    ).parseConsolidationResult
    const item = {
      featureName: 'f',
      isUserFacing: true,
      behavior: 'b',
      userStory: 'u',
      context: 'c',
      sourceBehaviorIds: [],
      sourceTestKeys: [],
      supportingInternalRefs: [],
    }
    const result = parse({ consolidations: [item] })
    expect(result.consolidations[0]!.entryPointHints).toEqual([])
  })

  test('accepts item with entryPointHints', async () => {
    const mod = await import('../../../scripts/behavior-audit/consolidate-agent.js')
    const parse: (input: unknown) => ConsolidationResult = (
      mod as unknown as { parseConsolidationResult: (i: unknown) => ConsolidationResult }
    ).parseConsolidationResult
    const item = {
      featureName: 'f',
      isUserFacing: true,
      behavior: 'b',
      userStory: 'u',
      context: 'c',
      sourceBehaviorIds: [],
      sourceTestKeys: [],
      supportingInternalRefs: [],
      entryPointHints: [{ kind: 'command', identifier: '/config' }],
    }
    const result = parse({ consolidations: [item] })
    expect(result.consolidations[0]!.entryPointHints).toEqual([{ kind: 'command', identifier: '/config' }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/consolidate-agent-schema.test.ts`
Expected: FAIL — `entryPointHints` not in schema; `parseConsolidationResult` not exported.

- [ ] **Step 3: Extend the schema**

Modify `scripts/behavior-audit/consolidate-agent.ts`:

1. Add the `entryPointHints` field to `ConsolidationItemSchema` (around line 45-54):

```typescript
import type { EntryPointHint } from './scores-types.js'

const EntryPointHintSchema = z.object({
  kind: z.enum(['command', 'tool', 'handler', 'route']),
  identifier: z.string(),
})

const ConsolidationItemSchema = z.object({
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceBehaviorIds: z.array(z.string()),
  sourceTestKeys: z.array(z.string()),
  supportingInternalRefs: z.array(z.object({ behaviorId: z.string(), summary: z.string() })),
  entryPointHints: z.array(EntryPointHintSchema).default([]),
})
```

2. Add the type to `ConsolidationResult` consumer by including `entryPointHints: readonly EntryPointHint[]` on the inferred type. Since `ConsolidationResult = z.infer<typeof ConsolidationResultSchema>`, this is automatic.

3. Export a `parseConsolidationResult` helper that runs the schema:

```typescript
export function parseConsolidationResult(input: unknown): ConsolidationResult {
  return ConsolidationResultSchema.parse(input)
}
```

4. Update the system prompt (around line 31-43) to ask for `entryPointHints`. Append after the existing instructions:

```
For each user-facing story, list the entry points a user would actually trigger. Use kind "command" for slash commands (identifier is the command text, e.g. "/config"). Use kind "tool" for LLM-callable tools (identifier is the tool name, e.g. "createTask"). Use kind "handler" for chat-platform message handlers (identifier is a symbol name or route description, e.g. "telegram:onTextMessage"). Use kind "route" for HTTP routes (identifier is the path, e.g. "/api/settings"). Omit entryPointHints for internal-only consolidations.
```

- [ ] **Step 4: Run the test**

Run: `bun test tests/scripts/behavior-audit/consolidate-agent-schema.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run typecheck**

Run: `bun typecheck`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/consolidate-agent.ts tests/scripts/behavior-audit/consolidate-agent-schema.test.ts
git commit -m "feat(behavior-audit): add entryPointHints to Phase 2b schema"
```

---

## Task 3: Add `closure` field to `ConsolidatedBehavior`

**Files:**

- Modify: `scripts/behavior-audit/report-writer.ts:54-86` (the `ConsolidatedBehaviorSchema`)

- [ ] **Step 1: Inspect current schema**

Run: `rg -n 'ConsolidatedBehavior|entryPointHints' scripts/behavior-audit/report-writer.ts scripts/behavior-audit/consolidated-store.ts`

Note: `ConsolidatedBehavior` lives in `report-writer.ts:54-68`; the Zod schema is `ConsolidatedBehaviorSchema` at lines 70-84.

- [ ] **Step 2: Add the field as optional with default**

Modify the schema in `scripts/behavior-audit/report-writer.ts`:

```typescript
import type { ClosureResult, EntryPointHint } from './scores-types.js'

const EntryPointHintSchema = z.object({
  kind: z.enum(['command', 'tool', 'handler', 'route']),
  identifier: z.string(),
})

const EntryPointEntrySchema = z.object({
  kind: z.enum(['command', 'tool', 'handler', 'route']),
  identifier: z.string(),
  resolved: z.boolean(),
  evidence: z
    .object({
      filePath: z.string(),
      symbol: z.string().optional(),
    })
    .nullable(),
})

const ClosureResultSchema = z.object({
  closureStatus: z.enum(['resolved', 'partial', 'unresolved', 'unverified']),
  entryPoints: z.array(EntryPointEntrySchema).readonly(),
})

const ConsolidatedBehaviorSchema = z.object({
  id: z.string(),
  domain: z.string(),
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceTestKeys: z.array(z.string()),
  sourceBehaviorIds: z.array(z.string()).default([]).readonly(),
  supportingInternalRefs: z
    .array(z.object({ behaviorId: z.string(), summary: z.string() }).readonly())
    .default([])
    .readonly(),
  entryPointHints: z.array(EntryPointHintSchema).default([]).readonly(),
  closure: ClosureResultSchema.nullable().default(null).readonly(),
})
```

Update the `ConsolidatedBehavior` TypeScript interface (lines 54-68) to include the new fields:

```typescript
export interface ConsolidatedBehavior {
  readonly id: string
  readonly domain: string
  readonly featureName: string
  readonly isUserFacing: boolean
  readonly behavior: string
  readonly userStory: string | null
  readonly context: string
  readonly sourceTestKeys: readonly string[]
  readonly sourceBehaviorIds: readonly string[]
  readonly supportingInternalRefs: readonly {
    readonly behaviorId: string
    readonly summary: string
  }[]
  readonly entryPointHints: readonly EntryPointHint[]
  readonly closure: ClosureResult | null
}
```

- [ ] **Step 3: Run existing tests to verify backward compatibility**

Run: `bun test tests/scripts/behavior-audit/`
Expected: PASS (existing tests should still pass — `.default([])` and `.default(null)` handle pre-Tier-3 artifacts)

- [ ] **Step 4: Run typecheck**

Run: `bun typecheck`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/report-writer.ts
git commit -m "feat(behavior-audit): add entryPointHints and closure fields to ConsolidatedBehavior"
```

---

## Task 4: Build static entry-point maps

**Files:**

- Create: `scripts/behavior-audit/entry-point-maps.ts`
- Create: `tests/scripts/behavior-audit/entry-point-maps.test.ts`

- [ ] **Step 1: Inspect command catalog API**

Run: `rg -n 'listCommandCatalogEntries|export' src/commands/catalog.ts | head -20`

Confirm the function exists and inspect its return type.

- [ ] **Step 2: Write failing tests**

Create `tests/scripts/behavior-audit/entry-point-maps.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { buildCommandMap, buildRouteMap, buildToolMap } from '../../../scripts/behavior-audit/entry-point-maps.js'

describe('entry-point maps', () => {
  test('buildCommandMap returns Set of command identifiers from catalog', async () => {
    const mockCatalog = mock(() => [
      { name: 'config', description: 'Configure' },
      { name: 'help', description: 'Help' },
    ])
    const result = await buildCommandMap(mockCatalog)
    expect(result.has('config')).toBe(true)
    expect(result.has('help')).toBe(true)
    expect(result.has('missing')).toBe(false)
  })

  test('buildCommandMap prefixes commands with /', async () => {
    const mockCatalog = mock(() => [{ name: 'config', description: '' }])
    const result = await buildCommandMap(mockCatalog)
    expect(result.has('/config')).toBe(true)
    expect(result.has('config')).toBe(true)
  })

  test('buildToolMap returns empty Set when tool registry unavailable', async () => {
    const result = await buildToolMap(() => undefined)
    expect(result.size).toBe(0)
  })

  test('buildRouteMap returns empty Set when routes module unavailable', async () => {
    const result = await buildRouteMap(() => undefined)
    expect(result.size).toBe(0)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/entry-point-maps.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement the maps**

Create `scripts/behavior-audit/entry-point-maps.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface CommandCatalogEntry {
  readonly name: string
  readonly description: string
}

export type CommandCatalogFn = () => readonly CommandCatalogEntry[]
export type ToolRegistryFn = () => readonly string[] | undefined
export type RouteRegistryFn = () => readonly string[] | undefined

function prefix(name: string): readonly string[] {
  return [name, name.startsWith('/') ? name.slice(1) : `/${name}`]
}

export async function buildCommandMap(catalog: CommandCatalogFn): Promise<ReadonlySet<string>> {
  const entries = catalog()
  const out = new Set<string>()
  for (const entry of entries) {
    for (const variant of prefix(entry.name)) out.add(variant)
  }
  return out
}

export async function buildToolMap(registry: ToolRegistryFn): Promise<ReadonlySet<string>> {
  const names = registry() ?? []
  return new Set(names)
}

export async function buildRouteMap(registry: RouteRegistryFn): Promise<ReadonlySet<string>> {
  const paths = registry() ?? []
  return new Set(paths)
}

export async function loadCommandCatalog(): Promise<CommandCatalogFn> {
  try {
    const mod = await import('../../src/commands/index.js')
    if (typeof mod.listCommandCatalogEntries === 'function') {
      return mod.listCommandCatalogEntries as CommandCatalogFn
    }
  } catch {
    // fall through
  }
  return () => []
}

export async function loadToolRegistry(): Promise<ToolRegistryFn> {
  try {
    const mod = await import('../../src/tools/index.js')
    if (typeof mod.listToolNames === 'function') {
      return mod.listToolNames as ToolRegistryFn
    }
  } catch {
    // fall through
  }
  return () => undefined
}

export async function loadRouteRegistry(): Promise<RouteRegistryFn> {
  try {
    const mod = await import('../../src/debug/server.js')
    if (typeof mod.listRoutes === 'function') {
      return mod.listRoutes as RouteRegistryFn
    }
  } catch {
    // fall through
  }
  return () => undefined
}
```

Note: `listToolNames` and `listRoutes` may not exist yet on the source modules. If they don't, the loader returns an empty registry gracefully. Adding those exports to `src/tools/index.ts` and `src/debug/server.ts` is a separate small task (Task 4b below).

- [ ] **Step 5: Run the tests**

Run: `bun test tests/scripts/behavior-audit/entry-point-maps.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/entry-point-maps.ts tests/scripts/behavior-audit/entry-point-maps.test.ts
git commit -m "feat(behavior-audit): add static entry-point map builders"
```

---

## Task 4b: Add `listToolNames` and `listRoutes` exports (if missing)

**Files:**

- Modify: `src/tools/index.ts`
- Modify: `src/debug/server.ts` (or wherever the settings/debug server is defined)

- [ ] **Step 1: Check whether the functions exist**

Run: `rg -n 'listToolNames|listRoutes' src/`

If both exist with the right shape, skip this task.

- [ ] **Step 2: Otherwise, add minimal exports**

In `src/tools/index.ts`:

```typescript
export function listToolNames(): readonly string[] {
  // Return the current set of registered tool names. The exact source depends
  // on how tools are registered in src/tools/. If they're registered statically
  // via a map, return Object.keys(that map). If dynamically, return [] here
  // and document that closure-verifier degrades gracefully.
  return []
}
```

In `src/debug/server.ts` (or settings server entry):

```typescript
export function listRoutes(): readonly string[] {
  // Return HTTP paths served by the settings/debug server.
  return []
}
```

The implementation here depends on the actual file structure. If the routes are registered via a framework like Hono or Fastify, hook into its route table. For initial ship, returning `[]` is acceptable — closure-verifier flags route-kind hints as unresolved but doesn't crash.

- [ ] **Step 3: Run typecheck and tests**

Run: `bun typecheck && bun test tests/scripts/behavior-audit/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/index.ts src/debug/server.ts
git commit -m "feat(src): export listToolNames and listRoutes for closure verifier"
```

---

## Task 5: Closure verifier — core implementation

**Files:**

- Create: `scripts/behavior-audit/closure-verifier.ts`
- Create: `tests/scripts/behavior-audit/closure-verifier.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/scripts/behavior-audit/closure-verifier.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { resolveHint, runClosureCheck } from '../../../scripts/behavior-audit/closure-verifier.js'

describe('resolveHint', () => {
  test('command resolves when in command map', async () => {
    const commands = new Set(['/config', 'config'])
    const result = await resolveHint(
      { kind: 'command', identifier: '/config' },
      { commands, tools: new Set(), routes: new Set(), codeindex: null },
    )
    expect(result.resolved).toBe(true)
    expect(result.evidence).not.toBeNull()
  })

  test('command unresolved when not in map', async () => {
    const result = await resolveHint(
      { kind: 'command', identifier: '/not-real' },
      { commands: new Set(), tools: new Set(), routes: new Set(), codeindex: null },
    )
    expect(result.resolved).toBe(false)
    expect(result.evidence).toBeNull()
  })

  test('tool resolves when in tool map', async () => {
    const tools = new Set(['createTask'])
    const result = await resolveHint(
      { kind: 'tool', identifier: 'createTask' },
      { commands: new Set(), tools, routes: new Set(), codeindex: null },
    )
    expect(result.resolved).toBe(true)
  })

  test('route resolves when in route map', async () => {
    const routes = new Set(['/api/settings'])
    const result = await resolveHint(
      { kind: 'route', identifier: '/api/settings' },
      { commands: new Set(), tools: new Set(), routes, codeindex: null },
    )
    expect(result.resolved).toBe(true)
  })

  test('handler unresolved when codeindex is null', async () => {
    const result = await resolveHint(
      { kind: 'handler', identifier: 'onTextMessage' },
      { commands: new Set(), tools: new Set(), routes: new Set(), codeindex: null },
    )
    expect(result.resolved).toBe(false)
    expect(result.evidence).toBeNull()
  })

  test('handler resolves via codeindex when candidate exists', async () => {
    const codeindex = {
      search: {
        findSymbolCandidates: mock(async () => [
          {
            filePath: 'src/chat/telegram.ts',
            startLine: 10,
            endLine: 20,
            symbolKey: 'k',
            qualifiedName: 'onTextMessage',
            snippet: '',
          },
        ]),
      },
    }
    const result = await resolveHint(
      { kind: 'handler', identifier: 'onTextMessage' },
      { commands: new Set(), tools: new Set(), routes: new Set(), codeindex },
    )
    expect(result.resolved).toBe(true)
    expect(result.evidence?.filePath).toBe('src/chat/telegram.ts')
  })
})

describe('closureStatus', () => {
  test('unverified when no hints', async () => {
    const result = await runClosureCheck({
      behaviors: [{ id: 'b1', entryPointHints: [], userStory: 's' }],
      resolvers: { commands: new Set(), tools: new Set(), routes: new Set(), codeindex: null },
    })
    expect(result.entries.b1!.closureStatus).toBe('unverified')
  })

  test('resolved when all hints resolve', async () => {
    const result = await runClosureCheck({
      behaviors: [
        {
          id: 'b1',
          entryPointHints: [
            { kind: 'command', identifier: '/config' },
            { kind: 'tool', identifier: 'createTask' },
          ],
          userStory: 's',
        },
      ],
      resolvers: {
        commands: new Set(['/config']),
        tools: new Set(['createTask']),
        routes: new Set(),
        codeindex: null,
      },
    })
    expect(result.entries.b1!.closureStatus).toBe('resolved')
  })

  test('partial when some hints resolve', async () => {
    const result = await runClosureCheck({
      behaviors: [
        {
          id: 'b1',
          entryPointHints: [
            { kind: 'command', identifier: '/config' },
            { kind: 'command', identifier: '/missing' },
          ],
          userStory: 's',
        },
      ],
      resolvers: { commands: new Set(['/config']), tools: new Set(), routes: new Set(), codeindex: null },
    })
    expect(result.entries.b1!.closureStatus).toBe('partial')
  })

  test('unresolved when no hints resolve', async () => {
    const result = await runClosureCheck({
      behaviors: [
        {
          id: 'b1',
          entryPointHints: [{ kind: 'command', identifier: '/nope' }],
          userStory: 's',
        },
      ],
      resolvers: { commands: new Set(), tools: new Set(), routes: new Set(), codeindex: null },
    })
    expect(result.entries.b1!.closureStatus).toBe('unresolved')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/closure-verifier.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the verifier**

Create `scripts/behavior-audit/closure-verifier.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ClosureResult, EntryPointEntry, EntryPointHint } from './scores-types.js'

export interface CodeindexResolver {
  readonly search: {
    findSymbolCandidates: (query: string) => Promise<readonly CodeindexCandidate[]>
  }
}

export interface CodeindexCandidate {
  readonly filePath: string
  readonly startLine: number
  readonly endLine: number
  readonly symbolKey: string
  readonly qualifiedName: string
  readonly snippet: string
}

export interface HintResolvers {
  readonly commands: ReadonlySet<string>
  readonly tools: ReadonlySet<string>
  readonly routes: ReadonlySet<string>
  readonly codeindex: CodeindexResolver | null
}

export interface ResolveHintInput {
  readonly behaviorId: string
  readonly hint: EntryPointHint
}

export async function resolveHint(hint: EntryPointHint, resolvers: HintResolvers): Promise<EntryPointEntry> {
  switch (hint.kind) {
    case 'command': {
      if (resolvers.commands.has(hint.identifier)) {
        return { ...hint, resolved: true, evidence: { filePath: 'src/commands/' } }
      }
      return { ...hint, resolved: false, evidence: null }
    }
    case 'tool': {
      if (resolvers.tools.has(hint.identifier)) {
        return { ...hint, resolved: true, evidence: { filePath: 'src/tools/' } }
      }
      return { ...hint, resolved: false, evidence: null }
    }
    case 'route': {
      if (resolvers.routes.has(hint.identifier)) {
        return { ...hint, resolved: true, evidence: { filePath: 'src/debug/server.ts' } }
      }
      return { ...hint, resolved: false, evidence: null }
    }
    case 'handler': {
      if (resolvers.codeindex === null) {
        return { ...hint, resolved: false, evidence: null }
      }
      try {
        const candidates = await resolvers.codeindex.search.findSymbolCandidates(hint.identifier)
        const hit = candidates[0]
        if (hit === undefined) return { ...hint, resolved: false, evidence: null }
        return {
          ...hint,
          resolved: true,
          evidence: { filePath: hit.filePath, symbol: hit.qualifiedName },
        }
      } catch {
        return { ...hint, resolved: false, evidence: null }
      }
    }
  }
}

export interface ClosureCheckBehavior {
  readonly id: string
  readonly entryPointHints: readonly EntryPointHint[]
  readonly userStory: string | null
}

export interface ClosureCheckInput {
  readonly behaviors: readonly ClosureCheckBehavior[]
  readonly resolvers: HintResolvers
}

export interface ClosureCheckResult {
  readonly entries: ReadonlyMap<string, ClosureResult>
}

function computeStatus(resolved: number, total: number, hintsProvided: boolean): ClosureResult['closureStatus'] {
  if (!hintsProvided) return 'unverified'
  if (total === 0) return 'unverified'
  if (resolved === total) return 'resolved'
  if (resolved === 0) return 'unresolved'
  return 'partial'
}

export async function runClosureCheck(input: ClosureCheckInput): Promise<ClosureCheckResult> {
  const entries = new Map<string, ClosureResult>()
  for (const behavior of input.behaviors) {
    const hints = behavior.entryPointHints
    const perHintResults = await Promise.all(hints.map(async (hint) => resolveHint(hint, input.resolvers)))
    const resolvedCount = perHintResults.filter((r) => r.resolved).length
    const status = computeStatus(resolvedCount, hints.length, hints.length > 0)
    entries.set(behavior.id, {
      closureStatus: status,
      entryPoints: perHintResults,
    })
  }
  return { entries }
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test tests/scripts/behavior-audit/closure-verifier.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/closure-verifier.ts tests/scripts/behavior-audit/closure-verifier.test.ts
git commit -m "feat(behavior-audit): add closure verifier with hint resolution"
```

---

## Task 6: Wire Phase 2c into the pipeline

**Files:**

- Modify: `scripts/behavior-audit/index.ts`

- [ ] **Step 1: Add `runPhase2cIfNeeded` to the pipeline**

In `scripts/behavior-audit/index.ts`, after `runPhase2bIfNeeded` completes and the consolidated manifest is saved (around line 200), add:

```typescript
import { runClosureCheckPipeline } from './closure-verifier-pipeline.js'
```

Modify `executeSelectedBehaviorAuditWork` to call the new step:

```typescript
const consolidatedManifest = await input.deps.runPhase2bIfNeeded(
  input.progress,
  input.updatedManifest.phaseVersions.phase2,
  phase2bSelectedKeys,
  input.reporter,
)
await input.deps.saveConsolidatedManifest(consolidatedManifest)

// Phase 2c — closure check (new)
await input.deps.runPhase2cIfNeeded(consolidatedManifest, input.reporter)

await input.deps.runPhase3IfNeeded(...)
```

- [ ] **Step 2: Create `closure-verifier-pipeline.ts`**

Create `scripts/behavior-audit/closure-verifier-pipeline.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { CONCURRENCY } from './config.js'
import {
  buildCommandMap,
  buildRouteMap,
  buildToolMap,
  loadCommandCatalog,
  loadRouteRegistry,
  loadToolRegistry,
} from './entry-point-maps.js'
import { runClosureCheck, type HintResolvers } from './closure-verifier.js'
import { loadCodeindexDeps } from './extract-evidence-loader.js'
import type { ConsolidatedManifest } from './incremental.js'
import { saveConsolidatedManifest } from './incremental.js'
import { readConsolidatedFile, writeConsolidatedFile, type ConsolidatedBehavior } from './report-writer.js'

export interface Phase2cDeps {
  readonly loadCommandCatalog: typeof loadCommandCatalog
  readonly loadToolRegistry: typeof loadToolRegistry
  readonly loadRouteRegistry: typeof loadRouteRegistry
  readonly loadCodeindexDeps: typeof loadCodeindexDeps
  readonly readConsolidatedFile: typeof readConsolidatedFile
  readonly writeConsolidatedFile: typeof writeConsolidatedFile
  readonly saveConsolidatedManifest: typeof saveConsolidatedManifest
  readonly concurrency: number
  readonly log: Pick<Console, 'log' | 'warn'>
}

const defaultDeps: Phase2cDeps = {
  loadCommandCatalog,
  loadToolRegistry,
  loadRouteRegistry,
  loadCodeindexDeps,
  readConsolidatedFile,
  writeConsolidatedFile,
  saveConsolidatedManifest,
  concurrency: CONCURRENCY,
  log: console,
}

export async function runPhase2c(
  manifest: ConsolidatedManifest,
  deps: Partial<Phase2cDeps> = {},
): Promise<ConsolidatedManifest> {
  const resolved: Phase2cDeps = { ...defaultDeps, ...deps }

  // Build static maps
  const commandCatalog = await resolved.loadCommandCatalog()
  const toolRegistry = await resolved.loadToolRegistry()
  const routeRegistry = await resolved.loadRouteRegistry()
  const [commands, tools, routes] = await Promise.all([
    buildCommandMap(commandCatalog),
    buildToolMap(toolRegistry),
    buildRouteMap(routeRegistry),
  ])

  // Load codeindex (graceful degradation)
  let codeindex: HintResolvers['codeindex'] = null
  try {
    const repoRoot = process.cwd()
    const loaded = await resolved.loadCodeindexDeps(repoRoot)
    if (loaded.codeindex.enabled) {
      codeindex = {
        search: {
          findSymbolCandidates: loaded.search.findSymbolCandidates,
        },
      }
    } else {
      resolved.log.warn('Phase 2c: codeindex unavailable; handler-kind hints will be marked unresolved.')
    }
  } catch (err) {
    resolved.log.warn(`Phase 2c: codeindex load failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  const resolvers: HintResolvers = { commands, tools, routes, codeindex }

  // Process each featureKey's consolidated file
  const featureKeys = Object.values(manifest.entries)
    .map((entry) => entry.featureKey)
    .filter((value): value is string => value !== null && value !== undefined)
  const uniqueFeatureKeys = [...new Set(featureKeys)]

  const limit = pLimit(resolved.concurrency)
  const updatedByDomain = new Map<string, readonly ConsolidatedBehavior[]>()

  await Promise.all(
    uniqueFeatureKeys.map((featureKey) =>
      limit(async () => {
        const behaviors = await resolved.readConsolidatedFile(featureKey)
        if (behaviors === null) return
        const result = await runClosureCheck({
          behaviors: behaviors.map((b) => ({
            id: b.id,
            entryPointHints: b.entryPointHints,
            userStory: b.userStory,
          })),
          resolvers,
        })
        const updated: readonly ConsolidatedBehavior[] = behaviors.map((b) => {
          const closure = result.entries.get(b.id)
          if (closure === undefined) return b
          return { ...b, closure }
        })
        const domain = updated[0]?.domain ?? featureKey
        updatedByDomain.set(domain, updated)
        await resolved.writeConsolidatedFile(domain, updated)
      }),
    ),
  )

  resolved.log.log(`Phase 2c complete: ${uniqueFeatureKeys.length} featureKeys verified`)
  return manifest
}
```

- [ ] **Step 3: Add `runPhase2cIfNeeded` to `BehaviorAuditDeps`**

In `scripts/behavior-audit/index.ts`, extend the `BehaviorAuditDeps` interface:

```typescript
readonly runPhase2cIfNeeded: (manifest: ConsolidatedManifest, reporter: BehaviorAuditProgressReporter) => Promise<void>
```

Add to default deps:

```typescript
runPhase2cIfNeeded: async (manifest, _reporter) => {
  await runPhase2c(manifest)
},
```

- [ ] **Step 4: Update entrypoint tests**

The existing `tests/scripts/behavior-audit/entrypoint.test.ts` uses mock deps. Add `runPhase2cIfNeeded: async () => {}` to the mock deps to satisfy the new interface. Existing tests should continue passing.

- [ ] **Step 5: Run all audit tests**

Run: `bun test tests/scripts/behavior-audit/`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `bun typecheck`
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add scripts/behavior-audit/index.ts scripts/behavior-audit/closure-verifier-pipeline.ts tests/scripts/behavior-audit/entrypoint.test.ts
git commit -m "feat(behavior-audit): wire Phase 2c closure verifier into pipeline"
```

---

## Task 7: Percentile computation

**Files:**

- Modify: `scripts/behavior-audit/report-index-helpers.ts`
- Create: `tests/scripts/behavior-audit/percentile.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/scripts/behavior-audit/percentile.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { computePercentiles } from '../../../scripts/behavior-audit/report-index-helpers.js'

describe('computePercentiles', () => {
  test('single-element domain returns [100]', () => {
    expect(computePercentiles([3.0])).toEqual([100])
  })

  test('two-element domain: higher score gets higher percentile', () => {
    const result = computePercentiles([2.0, 4.0])
    expect(result[0]).toBeLessThan(result[1])
  })

  test('all-equal scores return all 100', () => {
    expect(computePercentiles([3.0, 3.0, 3.0])).toEqual([100, 100, 100])
  })

  test('10-element domain with one low outlier flags bottom decile', () => {
    const scores = [4.5, 4.4, 4.3, 4.2, 4.1, 4.0, 3.9, 3.8, 3.7, 1.0]
    const percentiles = computePercentiles(scores)
    expect(percentiles[9]).toBeLessThan(10)
  })

  test('ties at boundary both flagged', () => {
    const scores = [5, 5, 5, 5, 5, 5, 5, 5, 5, 1, 1]
    const percentiles = computePercentiles(scores)
    const bottomDecile = percentiles.filter((p) => p < 10)
    expect(bottomDecile.length).toBe(2)
  })

  test('empty input returns empty', () => {
    expect(computePercentiles([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/percentile.test.ts`
Expected: FAIL — `computePercentiles` not exported.

- [ ] **Step 3: Implement the helper**

In `scripts/behavior-audit/report-index-helpers.ts`, add:

```typescript
export function computePercentiles(scores: readonly number[]): readonly number[] {
  if (scores.length === 0) return []
  if (scores.length === 1) return [100]
  const sorted = [...scores].toSorted((a, b) => a - b)
  return scores.map((score) => {
    // Percentile rank: percent of scores strictly less than this score.
    // Ties get the max rank (less-than + ties counted).
    const strictlyLess = sorted.filter((s) => s < score).length
    const ties = sorted.filter((s) => s === score).length
    const rank = strictlyLess + ties
    return Math.round((rank / scores.length) * 100)
  })
}

export function isBottomDecile(percentile: number): boolean {
  return percentile < 10
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test tests/scripts/behavior-audit/percentile.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/report-index-helpers.ts tests/scripts/behavior-audit/percentile.test.ts
git commit -m "feat(behavior-audit): add percentile and bottom-decile helpers"
```

---

## Task 8: Trend computation

**Files:**

- Modify: `scripts/behavior-audit/report-rebuild-helpers.ts`
- Create: `tests/scripts/behavior-audit/trend.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/scripts/behavior-audit/trend.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { computeTrendDeltas, roundToOneDecimal } from '../../../scripts/behavior-audit/report-rebuild-helpers.js'

describe('roundToOneDecimal', () => {
  test('rounds 3.45 to 3.5', () => {
    expect(roundToOneDecimal(3.45)).toBe(3.5)
  })

  test('rounds 3.44 to 3.4', () => {
    expect(roundToOneDecimal(3.44)).toBe(3.4)
  })

  test('leaves 3.4 unchanged', () => {
    expect(roundToOneDecimal(3.4)).toBe(3.4)
  })
})

describe('computeTrendDeltas', () => {
  test('returns null for all entries when prior is null', () => {
    const current = [{ consolidatedId: 'a', composite: 3.5 }]
    const result = computeTrendDeltas(current, null)
    expect(result).toEqual([null])
  })

  test('returns null for ids missing in prior', () => {
    const current = [{ consolidatedId: 'a', composite: 3.5 }]
    const prior = [{ consolidatedId: 'b', composite: 3.0 }]
    const result = computeTrendDeltas(current, prior)
    expect(result).toEqual([null])
  })

  test('returns 0.0 when both round to same value', () => {
    const current = [{ consolidatedId: 'a', composite: 3.42 }]
    const prior = [{ consolidatedId: 'a', composite: 3.4 }]
    const result = computeTrendDeltas(current, prior)
    expect(result).toEqual([0])
  })

  test('returns +0.5 on increase from 3.4 to 3.9', () => {
    const current = [{ consolidatedId: 'a', composite: 3.9 }]
    const prior = [{ consolidatedId: 'a', composite: 3.4 }]
    const result = computeTrendDeltas(current, prior)
    expect(result).toEqual([0.5])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/trend.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

In `scripts/behavior-audit/report-rebuild-helpers.ts`, add:

```typescript
import { spawn } from 'bun'

export function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

export interface TrendEntry {
  readonly consolidatedId: string
  readonly composite: number
}

export function computeTrendDeltas(
  current: readonly TrendEntry[],
  prior: readonly TrendEntry[] | null,
): readonly (number | null)[] {
  if (prior === null) {
    return current.map(() => null)
  }
  const priorMap = new Map(prior.map((entry) => [entry.consolidatedId, entry.composite]))
  return current.map((entry) => {
    const priorScore = priorMap.get(entry.consolidatedId)
    if (priorScore === undefined) return null
    return roundToOneDecimal(entry.composite) - roundToOneDecimal(priorScore)
  })
}

export async function loadPriorSnapshot(): Promise<{
  domains: readonly { stories: readonly { consolidatedId: string; composite: number }[] }[]
} | null> {
  try {
    const proc = Bun.spawn(['git', 'show', 'audit-output-latest:stories/scores.json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const text = await new Response(proc.stdout).text()
    await proc.exited
    if (!text.trim().startsWith('{')) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test tests/scripts/behavior-audit/trend.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/report-rebuild-helpers.ts tests/scripts/behavior-audit/trend.test.ts
git commit -m "feat(behavior-audit): add trend delta computation and prior-snapshot loader"
```

---

## Task 9: Emit `scores.json` sidecar

**Files:**

- Modify: `scripts/behavior-audit/report-writer.ts`

- [ ] **Step 1: Add `writeScoresJson` function**

In `scripts/behavior-audit/report-writer.ts`, add:

```typescript
import { computePercentiles, isBottomDecile } from './report-index-helpers.js'
import { computeTrendDeltas, loadPriorSnapshot } from './report-rebuild-helpers.js'
import { MODEL } from './config.js'
import type { ScoresFile, StoryEntry, DomainEntry, EntryPointEntry } from './scores-types.js'

export async function writeScoresJson(
  consolidatedByDomain: ReadonlyMap<string, readonly ConsolidatedBehavior[]>,
  evaluatedByDomain: ReadonlyMap<string, readonly StoryEvaluation[]>,
  prior: { domains: readonly { stories: readonly { consolidatedId: string; composite: number }[] }[] } | null,
): Promise<ScoresFile> {
  const domains: DomainEntry[] = []
  for (const [domain, behaviors] of consolidatedByDomain) {
    const evaluations = evaluatedByDomain.get(domain) ?? []
    const evalById = new Map(evaluations.map((e) => [e.testName, e]))

    const storyEntries: StoryEntry[] = behaviors
      .filter((b) => b.isUserFacing && b.userStory !== null)
      .map((b) => {
        const evaluation = evalById.get(b.id) ?? evalById.get(b.featureName) ?? null
        const maria = evaluation?.maria ?? { discover: 0, use: 0, retain: 0, notes: '' }
        const dani = evaluation?.dani ?? { discover: 0, use: 0, retain: 0, notes: '' }
        const viktor = evaluation?.viktor ?? { discover: 0, use: 0, retain: 0, notes: '' }
        const composite =
          (maria.discover +
            maria.use +
            maria.retain +
            dani.discover +
            dani.use +
            dani.retain +
            viktor.discover +
            viktor.use +
            viktor.retain) /
          9
        return {
          featureKey: b.id,
          consolidatedId: b.id,
          domain,
          featureName: b.featureName,
          userStory: b.userStory ?? '',
          composite,
          percentile: 0,
          bottomDecile: false,
          maria: { discover: maria.discover, use: maria.use, retain: maria.retain },
          dani: { discover: dani.discover, use: dani.use, retain: dani.retain },
          viktor: { discover: viktor.discover, use: viktor.use, retain: viktor.retain },
          flaws: evaluation?.flaws ?? [],
          improvements: evaluation?.improvements ?? [],
          trendDelta: null,
          closureStatus: b.closure?.closureStatus ?? 'unverified',
          entryPoints: b.closure?.entryPoints ?? [],
        }
      })

    // Compute percentiles
    const scores = storyEntries.map((s) => s.composite)
    const percentiles = computePercentiles(scores)
    for (let i = 0; i < storyEntries.length; i++) {
      const percentile = percentiles[i]!
      storyEntries[i] = {
        ...storyEntries[i]!,
        percentile,
        bottomDecile: isBottomDecile(percentile),
      }
    }

    // Compute trend deltas
    const priorDomain = prior?.domains.find((d) => d.stories.some((s) => s.consolidatedId !== undefined))
    const priorStories = priorDomain?.stories ?? []
    const trendDeltas = computeTrendDeltas(
      storyEntries.map((s) => ({ consolidatedId: s.consolidatedId, composite: s.composite })),
      priorStories,
    )
    for (let i = 0; i < storyEntries.length; i++) {
      storyEntries[i] = { ...storyEntries[i]!, trendDelta: trendDeltas[i] ?? null }
    }

    domains.push({ domain, stories: storyEntries })
  }

  const scoresFile: ScoresFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    domains,
  }

  const outPath = join(STORIES_DIR, 'scores.json')
  await mkdir(dirname(outPath), { recursive: true })
  await Bun.write(outPath, JSON.stringify(scoresFile, null, 2) + '\n')
  return scoresFile
}
```

- [ ] **Step 2: Wire into `rebuildReportsFromStoredResults`**

In the existing `rebuildReportsFromStoredResults` function, after `collectStoryEvaluations` and before `writeRebuiltStoryFiles`, add:

```typescript
const prior = await loadPriorSnapshot()
await writeScoresJson(consolidatedByDomainForScores, evaluationsByDomain, prior)
```

Where `consolidatedByDomainForScores` is the domain-keyed map of `ConsolidatedBehavior[]` (you may need to build it from `consolidatedByFeatureKey` values).

- [ ] **Step 3: Test by extending an existing report-writer test**

In `tests/scripts/behavior-audit/report-writer.test.ts` (or whichever tests `rebuildReportsFromStoredResults`), assert that `stories/scores.json` is written with expected shape. Reuse existing fixture builders.

- [ ] **Step 4: Run tests and typecheck**

Run: `bun test tests/scripts/behavior-audit/ && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/report-writer.ts tests/scripts/behavior-audit/report-writer.test.ts
git commit -m "feat(behavior-audit): emit scores.json sidecar with percentile and trend"
```

---

## Task 10: Surface relative/trend/closure in markdown

**Files:**

- Modify: `scripts/behavior-audit/report-writer.ts` (`writeStoryFile`, `writeIndexFile`)

- [ ] **Step 1: Extend `writeStoryFile`**

The per-story markdown gains: composite score line, domain rank, trend arrow, closure callout. Modify `writeStoryFile` to accept a richer `StoryEvaluation` (or change the function signature to accept the corresponding `StoryEntry`).

Specifically, add after `**User Story:**`:

```typescript
if (entry.trendDelta !== null) {
  const arrow = entry.trendDelta >= 0.3 ? '↑' : entry.trendDelta <= -0.3 ? '↓' : '='
  lines.push(
    `**Composite:** ${entry.composite.toFixed(1)} (Δ ${arrow} ${entry.trendDelta > 0 ? '+' : ''}${entry.trendDelta.toFixed(1)} vs prior)\n`,
  )
} else {
  lines.push(`**Composite:** ${entry.composite.toFixed(1)} (no prior snapshot)\n`)
}
lines.push(`**Domain rank:** ${entry.percentile}th percentile\n`)
if (entry.bottomDecile) {
  lines.push(`⚠ Bottom decile (within ${entry.domain})\n`)
}
if (entry.closureStatus !== 'resolved') {
  const total = entry.entryPoints.length
  const unresolved = entry.entryPoints.filter((e) => !e.resolved).length
  lines.push(`⚠ Closure check: ${total - unresolved} of ${total} entry points resolved (${entry.closureStatus})\n`)
}
if (entry.entryPoints.length > 0) {
  lines.push('**Entry points:**\n')
  for (const ep of entry.entryPoints) {
    const mark = ep.resolved ? '✓' : '✗'
    lines.push(`- ${mark} ${ep.kind}: ${ep.identifier}`)
  }
  lines.push('')
}
```

- [ ] **Step 2: Extend `writeIndexFile`**

Add a "Closure gaps" section and a "Top movers" section. Use the existing `buildTopItemsSection` pattern.

- [ ] **Step 3: Run tests**

Run: `bun test tests/scripts/behavior-audit/`
Expected: PASS

- [ ] **Step 4: Run typecheck, format, lint**

Run: `bun typecheck && bun lint && bun run format:check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/report-writer.ts
git commit -m "feat(behavior-audit): surface percentile, trend, closure in markdown reports"
```

---

## Task 11: Final verification

- [ ] **Step 1: Run full check suite**

Run: `bun check:full`
Expected: PASS

- [ ] **Step 2: Manual smoke test (if a local gateway is available)**

```bash
rm -rf reports/audit-behavior/
bun audit:behavior
```

Verify:

- `reports/audit-behavior/stories/scores.json` is present
- `reports/audit-behavior/stories/*.md` contain percentile, trend (or "no prior"), closure sections
- No crash on consolidated artifacts that lack `entryPointHints`

---

## Self-Review Checklist

**Spec coverage:**

- ✅ `stories/scores.json` sidecar (`Task 9`)
- ✅ Percentile + bottom-decile computation (`Task 7`)
- ✅ Trend delta vs prior snapshot (`Task 8`)
- ✅ Schema extension for `entryPointHints` (`Task 2`)
- ✅ `closure?: ClosureResult` field on ConsolidatedBehavior (`Task 3`)
- ✅ Static entry-point maps via `listCommandCatalogEntries` etc. (`Task 4`)
- ✅ Closure verifier core (`Task 5`)
- ✅ Phase 2c wiring (`Task 6`)
- ✅ Markdown surfacing (`Task 10`)
- ✅ Codeindex graceful degradation (`Task 6 Step 2` warns and continues)
- ✅ Pre-Tier-3 schema compatibility (`.default([])` and `.default(null)` in `Task 3`)

**Placeholder scan:** none. Where exact existing-API integration depends on runtime inspection (`listToolNames`, `listRoutes`), `Task 4b` provides a graceful fallback that returns `[]`.

**Type consistency:** `ClosureResult`, `EntryPointEntry`, `EntryPointHint` defined in `Task 1`'s `scores-types.ts`, imported consistently in Tasks 2, 3, 5, 6, 9. `HintResolvers`, `CodeindexResolver`, `ClosureCheckBehavior` defined in `closure-verifier.ts` (`Task 5`).

**Scope check:** single plan producing Tier 3 in its entirety. Larger than Tier 1/Tier 2 by design (two sub-features ship together).

## References

- Spec: `docs/superpowers/specs/2026-07-19-behavior-audit-relative-scoring-closure-design.md`
- Tier 1 plan: `docs/superpowers/plans/2026-07-19-behavior-audit-close-the-loop-implementation.md`
- Tier 2 plan: `docs/superpowers/plans/2026-07-19-behavior-audit-concurrency-grep-implementation.md`
- Existing codeindex scaffolding: `scripts/behavior-audit/extract-evidence.ts`, `extract-evidence-loader.ts`
- Command catalog: `src/commands/index.ts:6` re-exports `listCommandCatalogEntries` from `src/commands/catalog.ts`

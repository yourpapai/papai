# Tool Introspection Production Usage And Knip Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/context` expose the live direct tool catalog in production, then remove the remaining `knip` ignores by narrowing test-only exports instead of treating tests as proof of production usage.

**Architecture:** Keep the existing `/context` token snapshot and chat renderers for the high-level summary, and add command-level follow-up pages that are built from the live direct `ToolSet` with `buildToolMetadata(...)`, `findToolMetadata(...)`, and `formatToolSchema(...)`. Remove the remaining ignored exports by shrinking production surfaces: delete the YouTrack bundle-cache reset export, stop exporting behavior-audit clustering internals that only tests consume, remove `emptyAgentUsage`, and then tighten `knip.jsonc` so the root workspace describes shipped code instead of tests.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK `ToolSet`, Zod v4, Bun test runner, Knip.

**Execution Note:** Commit steps are included for teams that want granular history. During actual execution, only run the commit steps if the user has explicitly asked for commits in that session.

---

## Scope Check

This should stay as one implementation plan. The `/context` production wiring and the remaining `knip` ignores are coupled: once tests stop counting as production entrypoints, the only acceptable fix is to make the introspection helpers part of the real runtime path and shrink the remaining exported seams.

## File Structure

- Create: `src/commands/context-tool-catalog.ts`
  Build paginated markdown tool-catalog pages from the live direct `ToolSet` using the existing metadata and schema-format helpers.
- Create: `tests/commands/context-tool-catalog.test.ts`
  Verify catalog grouping, schema formatting, hyphen-normalized lookup, and pagination.
- Modify: `src/commands/context.ts`
  Build the direct tool catalog for `/context` and send the follow-up pages after the existing summary response.
- Modify: `tests/commands/context.test.ts`
  Assert `/context` now emits live direct tool details in production-facing replies.
- Modify: `src/providers/youtrack/bundle-cache.ts`
  Remove `clearBundleCache` from the exported production surface.
- Delete: `tests/providers/youtrack/test-helpers.ts`
  Remove the test-only re-export of `clearBundleCache`.
- Modify: `tests/providers/youtrack/bundle-cache.test.ts`
  Stop depending on cache-reset exports; isolate tests with unique configs/project IDs and remove the reset-export test.
- Modify: `tests/providers/youtrack/index.test.ts`
  Stop using the reset helper by generating a unique config per test.
- Modify: `tests/providers/youtrack/operations/statuses.test.ts`
  Stop using the reset helper by generating a unique config per test.
- Modify: `tests/providers/youtrack/fetch-mock-utils.ts`
  Add a test-only unique-config helper so provider tests can avoid global cache collisions without touching production exports.
- Modify: `scripts/behavior-audit/consolidate-keywords-clustering.ts`
  Keep only exports that production scripts actually consume.
- Modify: `scripts/behavior-audit/consolidate-keywords-helpers.ts`
  Stop re-exporting clustering internals that only tests use.
- Modify: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
  Replace imports of production-only internals with local reference helpers or public-surface assertions.
- Modify: `scripts/behavior-audit/phase-stats.ts`
  Remove `emptyAgentUsage` from the exported production surface.
- Modify: `tests/scripts/behavior-audit/phase-stats.test.ts`
  Inline the zero-valued usage fixture instead of importing a production constant that runtime code does not use.
- Modify: `knip.jsonc`
  Remove tests from the root production `entry`/`project` patterns and delete the matching `ignoreIssues` entries after the code changes land.

---

### Task 1: Wire Real Tool Introspection Into `/context`

**Files:**

- Create: `tests/commands/context-tool-catalog.test.ts`
- Create: `src/commands/context-tool-catalog.ts`
- Modify: `src/commands/context.ts`
- Modify: `tests/commands/context.test.ts`

- [x] **Step 1: Write the failing tool-catalog helper tests**

Create `tests/commands/context-tool-catalog.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { buildContextToolCatalogPages } from '../../src/commands/context-tool-catalog.js'

const tools: ToolSet = {
  create_task: tool({
    description: 'Create a new task.',
    inputSchema: z.object({
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task details'),
    }),
    execute: async () => ({ id: 'TASK-1' }),
  }),
  web_fetch: tool({
    description: 'Fetch a public URL.',
    inputSchema: z.object({
      url: z.string().describe('Public HTTPS URL'),
    }),
    execute: async () => ({ status: 'ok' }),
  }),
}

describe('buildContextToolCatalogPages', () => {
  test('formats live tool metadata, classification, and schema details', () => {
    const pages = buildContextToolCatalogPages(tools)

    expect(pages).toHaveLength(1)
    expect(pages[0]).toContain('## Active tools')
    expect(pages[0]).toContain('`create_task`')
    expect(pages[0]).toContain('task / create / write')
    expect(pages[0]).toContain('title (string) *required* - Task title')
    expect(pages[0]).toContain('`web_fetch`')
    expect(pages[0]).toContain('web / read / open-world')
  })

  test('keeps hyphen-normalized lookup working through findToolMetadata', () => {
    const hyphenated: ToolSet = {
      add_task_relation: tool({
        description: 'Add a relation.',
        inputSchema: z.object({ taskId: z.string().describe('Task ID') }),
        execute: async () => ({ ok: true }),
      }),
    }

    const pages = buildContextToolCatalogPages(hyphenated, ['add-task-relation'])

    expect(pages[0]).toContain('`add_task_relation`')
    expect(pages[0]).not.toContain('`add-task-relation`')
  })

  test('paginates long catalogs instead of emitting one oversized block', () => {
    const largeToolSet = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `list_tasks_${String(index)}`,
        tool({
          description: `Tool ${String(index)}`,
          inputSchema: z.object({ query: z.string().describe('Query text') }),
          execute: async () => [],
        }),
      ]),
    ) satisfies ToolSet

    const pages = buildContextToolCatalogPages(largeToolSet)

    expect(pages.length).toBeGreaterThan(1)
    expect(pages.every((page) => page.length <= 3500)).toBe(true)
  })
})
```

- [x] **Step 2: Run the helper tests to verify they fail**

Run: `bun test tests/commands/context-tool-catalog.test.ts`

Expected: FAIL because `src/commands/context-tool-catalog.ts` does not exist yet.

- [x] **Step 3: Implement the catalog builder on top of the existing helpers**

Create `src/commands/context-tool-catalog.ts`:

```typescript
import type { ToolSet } from 'ai'

import { buildToolMetadata, findToolMetadata, getToolMetadata, TOOL_METADATA } from '../tools/tool-metadata.js'
import { formatToolSchema } from '../tools/tool-schema-format.js'

const DEFAULT_PAGE_LIMIT = 3500

const formatClassification = (toolName: string): string => {
  const classification = getToolMetadata(toolName)
  return classification === undefined
    ? 'uncategorized'
    : `${classification.domain} / ${classification.operation} / ${classification.risk}`
}

const formatToolEntry = (toolName: string, tools: ReturnType<typeof buildToolMetadata>): string | null => {
  const metadata = findToolMetadata(tools, toolName)
  if (metadata === undefined) return null

  const description = metadata.description.length > 0 ? metadata.description : '_No description provided._'
  const executable = metadata.executable ? '' : ' _not locally executable_'

  return [
    `### \`${metadata.name}\``,
    `${formatClassification(toolName)}${executable}`,
    description,
    '',
    'Parameters:',
    formatToolSchema(metadata.inputSchema, '  '),
  ].join('\n')
}

const paginate = (entries: readonly string[], pageLimit: number): readonly string[] =>
  entries.reduce<readonly string[]>(
    (pages, entry) => {
      const current = pages.at(-1) ?? '## Active tools'
      const separator = current === '## Active tools' ? '\n\n' : '\n\n---\n\n'
      const candidate = `${current}${separator}${entry}`

      if (candidate.length <= pageLimit) {
        return [...pages.slice(0, -1), candidate]
      }

      return [...pages, `## Active tools\n\n${entry}`]
    },
    ['## Active tools'],
  )

export function buildContextToolCatalogPages(
  tools: ToolSet,
  preferredOrder: readonly string[] = Object.keys(TOOL_METADATA),
): readonly string[] {
  const catalog = buildToolMetadata(tools)
  const orderedNames = [...new Set([...preferredOrder, ...catalog.map((tool) => tool.name)])]
  const entries = orderedNames.flatMap((toolName) => {
    const entry = formatToolEntry(toolName, catalog)
    return entry === null ? [] : [entry]
  })

  return entries.length === 0 ? ['## Active tools\n\n_No active tools._'] : paginate(entries, DEFAULT_PAGE_LIMIT)
}
```

- [x] **Step 4: Run the helper tests to verify they pass**

Run: `bun test tests/commands/context-tool-catalog.test.ts`

Expected: PASS.

- [x] **Step 5: Extend `/context` to send the live direct tool catalog**

Modify `src/commands/context.ts` and `tests/commands/context.test.ts`:

```typescript
// src/commands/context.ts
import { buildContextToolCatalogPages } from './context-tool-catalog.js'

function buildDirectContextTools(contextId: string, provider: TaskProvider | null): ToolSet {
  if (provider === null) return {}
  return makeTools(provider, {
    storageContextId: contextId,
    chatUserId: contextId,
    mode: 'normal',
    contextType: 'dm',
  })
}

async function handleContextCommand(/* existing args */): Promise<void> {
  // existing snapshot build path
  const provider = safeBuildProvider(auth.storageContextId)
  const snapshot = await buildContextSnapshot(auth.storageContextId, deps)
  const directTools = buildDirectContextTools(auth.storageContextId, provider)
  const toolCatalogPages = buildContextToolCatalogPages(directTools)

  const rendered = chat.renderContext(snapshot)
  await sendContextResponse(reply, rendered)

  for (const page of toolCatalogPages) {
    await reply.formatted(page)
  }
}

// tests/commands/context.test.ts
test('sends live direct tool pages after the summary response', async () => {
  const provider = createMockProvider()
  void mock.module('../../src/providers/factory.js', () => ({
    buildProviderForUser: (): typeof provider => provider,
  }))
  const { registerContextCommand } = await import('../../src/commands/context.js')

  const commands = new Map<string, CommandHandler>()
  const chat = createMockChat({ commandHandlers: commands })
  registerContextCommand(chat, snapshotDeps())

  const handler = captureCommand(commands)
  const { reply, textCalls } = createMockReply()

  await handler(createDmMessage('user1'), reply, {
    allowed: true,
    isBotAdmin: false,
    isGroupAdmin: false,
    storageContextId: 'user1',
  })

  expect(textCalls.some((call) => call.includes('mock renderContext'))).toBe(true)
  expect(textCalls.some((call) => call.includes('## Active tools'))).toBe(true)
  expect(textCalls.some((call) => call.includes('`create_task`'))).toBe(true)
  expect(textCalls.some((call) => call.includes('title'))).toBe(true)
})
```

- [x] **Step 6: Run the command tests**

Run: `bun test tests/commands/context-tool-catalog.test.ts tests/commands/context.test.ts`

Expected: PASS, and the existing `/context` summary behavior still passes while new tool pages are emitted.

- [x] **Step 7: Commit**

```bash
git add tests/commands/context-tool-catalog.test.ts src/commands/context-tool-catalog.ts src/commands/context.ts tests/commands/context.test.ts
git commit -m "feat: surface live tool definitions in context output"
```

---

### Task 2: Remove The YouTrack Bundle-Cache Reset Export

**Files:**

- Modify: `src/providers/youtrack/bundle-cache.ts`
- Delete: `tests/providers/youtrack/test-helpers.ts`
- Modify: `tests/providers/youtrack/bundle-cache.test.ts`
- Modify: `tests/providers/youtrack/index.test.ts`
- Modify: `tests/providers/youtrack/operations/statuses.test.ts`
- Modify: `tests/providers/youtrack/fetch-mock-utils.ts`

- [x] **Step 1: Write the failing cache-isolation test updates first**

Modify the provider tests so they stop importing the reset export and instead build unique configs:

```typescript
// tests/providers/youtrack/fetch-mock-utils.ts
let configCounter = 0

export function createUniqueConfig(): { baseUrl: string; token: string } {
  configCounter += 1
  return {
    baseUrl: `https://test-${String(configCounter)}.youtrack.cloud`,
    token: 'test-token',
  }
}

// tests/providers/youtrack/index.test.ts
const createConfig = (): YouTrackConfig => createUniqueConfig()

beforeEach(() => {
  mockLogger()
  provider = new YouTrackProvider(createConfig())
  fetchMock = undefined
})

// tests/providers/youtrack/operations/statuses.test.ts
let config: YouTrackConfig

beforeEach(() => {
  mockLogger()
  config = createUniqueConfig()
})

// tests/providers/youtrack/bundle-cache.test.ts
const createConfig = (suffix: string) => ({
  baseUrl: `https://example-${suffix}.com`,
  token: 'test-token',
})
```

- [x] **Step 2: Run the affected YouTrack tests to verify they fail**

Run: `bun test tests/providers/youtrack/bundle-cache.test.ts tests/providers/youtrack/index.test.ts tests/providers/youtrack/operations/statuses.test.ts`

Expected: FAIL because the files still import `clearBundleCache` and `tests/providers/youtrack/test-helpers.ts` still exists.

- [x] **Step 3: Remove the production reset export and the test helper re-export**

Modify `src/providers/youtrack/bundle-cache.ts` and delete `tests/providers/youtrack/test-helpers.ts`:

```typescript
// src/providers/youtrack/bundle-cache.ts
export async function resolveStateBundle(config: YouTrackConfig, projectId: string): Promise<BundleInfo | null> {
  // existing implementation unchanged
}

// delete this export entirely
// export function clearBundleCache(): void {
//   bundleCache.clear()
//   failureCache.clear()
//   log.debug({}, 'bundle cache cleared')
// }
```

Also remove the dedicated `clearBundleCache` test block from `tests/providers/youtrack/bundle-cache.test.ts` and replace any suite-level reset import with unique-config setup.

- [x] **Step 4: Run the affected YouTrack tests to verify they pass**

Run: `bun test tests/providers/youtrack/bundle-cache.test.ts tests/providers/youtrack/index.test.ts tests/providers/youtrack/operations/statuses.test.ts`

Expected: PASS, with cache behavior still covered and no production reset export remaining.

- [x] **Step 5: Commit**

```bash
git add src/providers/youtrack/bundle-cache.ts tests/providers/youtrack/fetch-mock-utils.ts tests/providers/youtrack/bundle-cache.test.ts tests/providers/youtrack/index.test.ts tests/providers/youtrack/operations/statuses.test.ts
git rm tests/providers/youtrack/test-helpers.ts
git commit -m "refactor: remove test-only youtrack cache reset export"
```

---

### Task 3: Narrow The Remaining Behavior-Audit Exports

**Files:**

- Modify: `scripts/behavior-audit/consolidate-keywords-clustering.ts`
- Modify: `scripts/behavior-audit/consolidate-keywords-helpers.ts`
- Modify: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
- Modify: `scripts/behavior-audit/phase-stats.ts`
- Modify: `tests/scripts/behavior-audit/phase-stats.test.ts`

- [x] **Step 1: Rewrite the tests so they stop importing production-only internals**

Modify `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts` and `tests/scripts/behavior-audit/phase-stats.test.ts`:

```typescript
// tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
import {
  buildClusters,
  buildClustersAdvanced,
  buildClustersNormalized,
  buildConsolidatedVocabulary,
  buildMergeMap,
  electCanonical,
  remapKeywords,
  subdivideOversizedClusters,
  toNormalizedFloat64Arrays,
} from '../../../scripts/behavior-audit/consolidate-keywords-helpers.js'

const cosineSimilarityRef = (a: readonly number[], b: readonly number[]): number => {
  const dot = a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0)
  const magA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0))
  const magB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0))
  return magA === 0 || magB === 0 ? 0 : dot / (magA * magB)
}

test('buildClusters matches cosine-threshold expectations on a small fixture', () => {
  const a = [1, 0]
  const b = [0.9, 0.1]
  expect(cosineSimilarityRef(a, b)).toBeGreaterThan(0.99)
  expect(buildClusters([a, b], 0.99, 2)).toEqual([[0, 1]])
})

// tests/scripts/behavior-audit/phase-stats.test.ts
const zeroUsage: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
  toolNames: [],
}

test('zero usage fixture is valid for additive stats checks', () => {
  expect(addAgentUsage(zeroUsage, zeroUsage)).toEqual(zeroUsage)
})
```

- [x] **Step 2: Run the behavior-audit tests to verify they fail**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts tests/scripts/behavior-audit/phase-stats.test.ts`

Expected: FAIL because the production helper modules still export the old surfaces and the tests do not yet match the narrowed API.

- [x] **Step 3: Remove the test-only exports from production code**

Modify `scripts/behavior-audit/consolidate-keywords-clustering.ts`, `scripts/behavior-audit/consolidate-keywords-helpers.ts`, and `scripts/behavior-audit/phase-stats.ts`:

```typescript
// scripts/behavior-audit/consolidate-keywords-clustering.ts
type UnionFind = { parent: Int32Array; rank: Uint8Array }

const cosineSimilarity = (a: readonly number[], b: readonly number[]): number => {
  // existing implementation kept local
}

const buildUnionFind = (n: number): UnionFind => ({
  parent: Int32Array.from({ length: n }, (_, index) => index),
  rank: new Uint8Array(n),
})

const find = (uf: UnionFind, index: number): number => {
  // existing implementation kept local
}

const union = (uf: UnionFind, left: number, right: number): void => {
  // existing implementation kept local
}

export function buildClusters(/* existing signature */): readonly (readonly number[])[] {
  // existing implementation
}

export function toNormalizedFloat64Arrays(/* existing signature */): readonly Float64Array[] {
  // existing implementation
}

export function buildClustersNormalized(/* existing signature */): readonly (readonly number[])[] {
  // existing implementation
}

export function dotProduct(/* existing signature */): number {
  // existing implementation
}

export function findWeakestInternalSimilarity(/* existing signature */): number | undefined {
  // existing implementation
}

export function toIndexedSubEmbeddings(/* existing signature */): readonly {
  readonly index: number
  readonly embedding: Float64Array
}[] {
  // existing implementation
}

export function mapToGlobalClusters(/* existing signature */): readonly (readonly number[])[] {
  // existing implementation
}

// scripts/behavior-audit/consolidate-keywords-helpers.ts
export { buildClusters, buildClustersNormalized, toNormalizedFloat64Arrays } from './consolidate-keywords-clustering.js'
export type { LinkageMode } from './consolidate-keywords-clustering.js'
export { buildClustersAdvanced, subdivideOversizedClusters } from './consolidate-keywords-advanced-clustering.js'

// scripts/behavior-audit/phase-stats.ts
export function addAgentUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    toolCalls: a.toolCalls + b.toolCalls,
    toolNames: [...a.toolNames, ...b.toolNames],
  }
}

// delete:
// export const emptyAgentUsage: AgentUsage = { ... }
```

- [x] **Step 4: Run the behavior-audit tests to verify they pass**

Run: `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts tests/scripts/behavior-audit/phase-stats.test.ts`

Expected: PASS, with tests using either public helpers or local reference implementations instead of production-only internals.

- [x] **Step 5: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords-clustering.ts scripts/behavior-audit/consolidate-keywords-helpers.ts tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts scripts/behavior-audit/phase-stats.ts tests/scripts/behavior-audit/phase-stats.test.ts
git commit -m "refactor: remove test-only behavior-audit exports"
```

---

### Task 4: Tighten Knip To Production Scope And Remove The Remaining Ignores

**Files:**

- Modify: `knip.jsonc`

- [x] **Step 1: Write the failing `knip` expectation down in the config diff first**

Modify `knip.jsonc` so the root workspace no longer treats tests as production entrypoints:

```jsonc
{
  "workspaces": {
    ".": {
      "entry": [
        "src/scripts/*.ts!",
        "scripts/build-client.ts!",
        "scripts/behavior-audit/index.ts!",
        "scripts/behavior-audit/profile-clustering.ts!",
        "scripts/behavior-audit/tune-embedding.ts!",
        "client/debug/index.ts!",
        "scripts/behavior-audit/reset.ts!",
        "scripts/behavior-audit/migrate-trust.ts!",
      ],
      "project": ["src/**/*.ts!", "client/**/*.ts!", "scripts/behavior-audit/**/*.ts!"],
    },
  },
}
```

- [x] **Step 2: Run `knip` to verify it still reports the now-real issues before the ignore cleanup**

Run: `bun run knip`

Expected: FAIL or report findings until the old `ignoreIssues` entries are removed and all code changes from Tasks 1-3 are present.

- [x] **Step 3: Remove the obsolete `ignoreIssues` entries once the code is clean**

Modify `knip.jsonc`:

```jsonc
{
  "ignoreIssues": {},
}
```

If another unrelated false positive remains, keep only that specific entry. Do not re-add ignores for:

```jsonc
{
  "scripts/behavior-audit/consolidate-keywords-clustering.ts": ["exports"],
  "scripts/behavior-audit/phase-stats.ts": ["exports"],
  "src/providers/youtrack/bundle-cache.ts": ["exports"],
  "src/tools/tool-metadata.ts": ["exports"],
  "src/tools/tool-schema-format.ts": ["files"],
}
```

- [x] **Step 4: Run the full verification suite**

Run: `bun run knip`

Expected: PASS.

Run: `bun run check:full`

Expected: PASS with all checks green.

- [x] **Step 5: Commit**

```bash
git add knip.jsonc
git commit -m "chore: align knip with production tool surfaces"
```

---

## Final Verification Checklist

- [x] `bun test tests/commands/context-tool-catalog.test.ts tests/commands/context.test.ts`
- [x] `bun test tests/providers/youtrack/bundle-cache.test.ts tests/providers/youtrack/index.test.ts tests/providers/youtrack/operations/statuses.test.ts`
- [x] `bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts tests/scripts/behavior-audit/phase-stats.test.ts`
- [x] `bun run knip`
- [x] `bun run check:full`
- [x] Scan all modified files for forbidden suppression patterns: `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, `oxlint-disable`

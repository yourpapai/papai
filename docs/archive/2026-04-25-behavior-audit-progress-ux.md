# Behavior Audit Progress UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-item token/TPS/tool stats and phase summary blocks to the behavior-audit VERBOSE=0 output.

**Architecture:** Each agent function returns `AgentResult<T>` (result + usage) instead of bare `T`. A `PhaseStats` accumulator collects usage across items in each phase. Phase runners unwrap results, record stats, and render enhanced per-item lines plus a summary block after each phase.

**Tech Stack:** TypeScript, Bun, Vercel AI SDK (generateText return values), existing behavior-audit infrastructure.

**Spec:** `docs/superpowers/specs/2026-04-25-behavior-audit-progress-ux-design.md`

---

## File Structure

| File                                                        | Action | Responsibility                                                                           |
| ----------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `scripts/behavior-audit/phase-stats.ts`                     | Create | Types (`AgentUsage`, `AgentResult<T>`, `PhaseStats`), accumulation functions, formatting |
| `tests/scripts/behavior-audit-phase-stats.test.ts`          | Create | Tests for accumulation and formatting                                                    |
| `scripts/behavior-audit/extract-agent.ts`                   | Modify | Return `AgentResult<ExtractionResult> \| null`                                           |
| `scripts/behavior-audit/keyword-resolver-agent.ts`          | Modify | Return `AgentResult<ResolverResult> \| null`                                             |
| `scripts/behavior-audit/extract-phase1-helpers.ts`          | Modify | `resolveKeywords` returns `{ keywords, usage } \| null`                                  |
| `scripts/behavior-audit/extract.ts`                         | Modify | Unwrap results, accumulate stats, render enhanced output                                 |
| `scripts/behavior-audit/classify-agent.ts`                  | Modify | Return `AgentResult<ClassificationResult> \| null`                                       |
| `scripts/behavior-audit/classify.ts`                        | Modify | Unwrap results, accumulate stats, render enhanced output                                 |
| `scripts/behavior-audit/consolidate-agent.ts`               | Modify | Return `AgentResult<...> \| null`                                                        |
| `scripts/behavior-audit/consolidate-helpers.ts`             | Modify | `toConsolidations` accepts unwrapped array instead of `ReturnType<ConsolidateWithRetry>` |
| `scripts/behavior-audit/consolidate.ts`                     | Modify | Unwrap results, accumulate stats, render enhanced output                                 |
| `scripts/behavior-audit/evaluate-agent.ts`                  | Modify | Return `AgentResult<EvalResult> \| null`                                                 |
| `scripts/behavior-audit/evaluate.ts`                        | Modify | Unwrap results, accumulate stats, render enhanced output                                 |
| `scripts/behavior-audit.ts`                                 | Modify | Create `PhaseStats` per phase, pass through deps                                         |
| `tests/scripts/behavior-audit-classify-agent.test.ts`       | Modify | Update assertions for wrapped return type                                                |
| `tests/scripts/behavior-audit-phase1-keywords.test.ts`      | Modify | Update mock return values                                                                |
| `tests/scripts/behavior-audit-phase1-write-failure.test.ts` | Modify | Update mock return values                                                                |
| `tests/scripts/behavior-audit-phase2a.test.ts`              | Modify | Update mock return values                                                                |
| `tests/scripts/behavior-audit-phase2b.test.ts`              | Modify | Update mock return values                                                                |
| `tests/scripts/behavior-audit-phase3.test.ts`               | Modify | Update mock return values                                                                |
| `tests/scripts/behavior-audit-entrypoint.test.ts`           | Modify | Add stats to deps, update assertions                                                     |

---

### Task 1: Create `phase-stats.ts` with types, accumulation, and formatting

**Files:**

- Create: `scripts/behavior-audit/phase-stats.ts`
- Create: `tests/scripts/behavior-audit-phase-stats.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/scripts/behavior-audit-phase-stats.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import {
  addAgentUsage,
  createPhaseStats,
  emptyAgentUsage,
  formatPhaseSummary,
  formatPerItemSuffix,
  recordItemDone,
  recordItemFailed,
  recordItemSkipped,
  type AgentUsage,
} from '../../scripts/behavior-audit/phase-stats.js'

describe('phase-stats', () => {
  describe('createPhaseStats', () => {
    test('returns zeroed stats with wallStartMs set', () => {
      const stats = createPhaseStats()
      expect(stats.itemsDone).toBe(0)
      expect(stats.itemsFailed).toBe(0)
      expect(stats.itemsSkipped).toBe(0)
      expect(stats.totalInputTokens).toBe(0)
      expect(stats.totalOutputTokens).toBe(0)
      expect(stats.totalToolCalls).toBe(0)
      expect(Object.keys(stats.toolBreakdown).length).toBe(0)
      expect(stats.wallStartMs).toBeGreaterThan(0)
    })
  })

  describe('recordItemDone', () => {
    test('increments done count and accumulates usage', () => {
      const stats = createPhaseStats()
      const usage: AgentUsage = {
        inputTokens: 100,
        outputTokens: 50,
        toolCalls: 3,
        toolNames: ['readFile', 'grep', 'readFile'],
      }
      recordItemDone(stats, usage)
      expect(stats.itemsDone).toBe(1)
      expect(stats.totalInputTokens).toBe(100)
      expect(stats.totalOutputTokens).toBe(50)
      expect(stats.totalToolCalls).toBe(3)
      expect(stats.toolBreakdown).toEqual({ readFile: 2, grep: 1 })
    })

    test('accumulates across multiple items', () => {
      const stats = createPhaseStats()
      recordItemDone(stats, {
        inputTokens: 100,
        outputTokens: 50,
        toolCalls: 2,
        toolNames: ['readFile', 'grep'],
      })
      recordItemDone(stats, {
        inputTokens: 200,
        outputTokens: 80,
        toolCalls: 1,
        toolNames: ['readFile'],
      })
      expect(stats.itemsDone).toBe(2)
      expect(stats.totalInputTokens).toBe(300)
      expect(stats.totalOutputTokens).toBe(130)
      expect(stats.totalToolCalls).toBe(3)
      expect(stats.toolBreakdown).toEqual({ readFile: 2, grep: 1 })
    })
  })

  describe('recordItemFailed', () => {
    test('increments failed count without usage', () => {
      const stats = createPhaseStats()
      recordItemFailed(stats)
      expect(stats.itemsFailed).toBe(1)
      expect(stats.totalInputTokens).toBe(0)
    })

    test('increments failed count with partial usage', () => {
      const stats = createPhaseStats()
      recordItemFailed(stats, {
        inputTokens: 50,
        outputTokens: 10,
        toolCalls: 1,
        toolNames: ['readFile'],
      })
      expect(stats.itemsFailed).toBe(1)
      expect(stats.totalInputTokens).toBe(50)
      expect(stats.totalToolCalls).toBe(1)
    })
  })

  describe('recordItemSkipped', () => {
    test('increments skipped count', () => {
      const stats = createPhaseStats()
      recordItemSkipped(stats)
      expect(stats.itemsSkipped).toBe(1)
      expect(stats.totalInputTokens).toBe(0)
    })
  })

  describe('addAgentUsage', () => {
    test('sums all fields', () => {
      const a: AgentUsage = {
        inputTokens: 100,
        outputTokens: 50,
        toolCalls: 2,
        toolNames: ['readFile'],
      }
      const b: AgentUsage = {
        inputTokens: 200,
        outputTokens: 80,
        toolCalls: 1,
        toolNames: ['grep'],
      }
      const result = addAgentUsage(a, b)
      expect(result.inputTokens).toBe(300)
      expect(result.outputTokens).toBe(130)
      expect(result.toolCalls).toBe(3)
      expect(result.toolNames).toEqual(['readFile', 'grep'])
    })
  })

  describe('formatPerItemSuffix', () => {
    test('formats successful item with tools and tokens', () => {
      const usage: AgentUsage = {
        inputTokens: 1200,
        outputTokens: 647,
        toolCalls: 3,
        toolNames: ['readFile', 'grep', 'grep'],
      }
      const suffix = formatPerItemSuffix(usage, 4200)
      expect(suffix).toBe(' — 3 tools, 1,847 tok in 4.2s (154 tok/s) ✓')
    })

    test('formats item with zero tools', () => {
      const usage: AgentUsage = {
        inputTokens: 400,
        outputTokens: 200,
        toolCalls: 0,
        toolNames: [],
      }
      const suffix = formatPerItemSuffix(usage, 1100)
      expect(suffix).toBe(' — 0 tools, 600 tok in 1.1s (182 tok/s) ✓')
    })

    test('formats item with 1 tool (singular)', () => {
      const usage: AgentUsage = {
        inputTokens: 400,
        outputTokens: 200,
        toolCalls: 1,
        toolNames: ['readFile'],
      }
      const suffix = formatPerItemSuffix(usage, 1000)
      expect(suffix).toBe(' — 1 tool, 600 tok in 1.0s (200 tok/s) ✓')
    })
  })

  describe('formatPhaseSummary', () => {
    test('formats full summary with tools breakdown', () => {
      const stats = createPhaseStats()
      recordItemDone(stats, {
        inputTokens: 89421,
        outputTokens: 12847,
        toolCalls: 142,
        toolNames: Array(89).fill('readFile').concat(Array(53).fill('grep')),
      })
      recordItemFailed(stats)
      recordItemSkipped(stats)
      const ms = 272000
      const label = 'Phase 1 complete — 23 files, 1 behaviors extracted, 1 failed'
      const output = formatPhaseSummary(stats, ms, label)
      expect(output).toContain('Phase 1 complete — 23 files, 1 behaviors extracted, 1 failed')
      expect(output).toContain('Wall: 4m 32s')
      expect(output).toContain('Avg:')
      expect(output).toContain('tok/s')
      expect(output).toContain('Tokens: 89,421 in / 12,847 out')
      expect(output).toContain('Tools: 142 calls')
      expect(output).toContain('readFile: 89')
      expect(output).toContain('grep: 53')
    })

    test('formats wall time as seconds only when under a minute', () => {
      const stats = createPhaseStats()
      recordItemDone(stats, {
        inputTokens: 1000,
        outputTokens: 500,
        toolCalls: 2,
        toolNames: ['readFile', 'grep'],
      })
      const output = formatPhaseSummary(stats, 45000, 'Phase 2a complete — 5 done')
      expect(output).toContain('Wall: 45.0s')
    })

    test('omits tools line when no tool calls', () => {
      const stats = createPhaseStats()
      recordItemDone(stats, {
        inputTokens: 1000,
        outputTokens: 500,
        toolCalls: 0,
        toolNames: [],
      })
      const output = formatPhaseSummary(stats, 5000, 'Phase 2a complete — 1 done')
      expect(output).not.toContain('Tools:')
    })
  })

  describe('emptyAgentUsage', () => {
    test('is a zero-valued usage', () => {
      expect(emptyAgentUsage.inputTokens).toBe(0)
      expect(emptyAgentUsage.outputTokens).toBe(0)
      expect(emptyAgentUsage.toolCalls).toBe(0)
      expect(emptyAgentUsage.toolNames).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/behavior-audit-phase-stats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `scripts/behavior-audit/phase-stats.ts`:

```ts
export interface AgentUsage {
  inputTokens: number
  outputTokens: number
  toolCalls: number
  toolNames: string[]
}

export interface AgentResult<T> {
  result: T
  usage: AgentUsage
}

export interface PhaseStats {
  itemsDone: number
  itemsFailed: number
  itemsSkipped: number
  totalInputTokens: number
  totalOutputTokens: number
  totalToolCalls: number
  toolBreakdown: Record<string, number>
  wallStartMs: number
}

export const emptyAgentUsage: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
  toolNames: [],
}

export function addAgentUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    toolCalls: a.toolCalls + b.toolCalls,
    toolNames: [...a.toolNames, ...b.toolNames],
  }
}

export function createPhaseStats(): PhaseStats {
  return {
    itemsDone: 0,
    itemsFailed: 0,
    itemsSkipped: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalToolCalls: 0,
    toolBreakdown: {},
    wallStartMs: performance.now(),
  }
}

export function recordItemDone(stats: PhaseStats, usage: AgentUsage): void {
  stats.itemsDone += 1
  stats.totalInputTokens += usage.inputTokens
  stats.totalOutputTokens += usage.outputTokens
  stats.totalToolCalls += usage.toolCalls
  for (const name of usage.toolNames) {
    stats.toolBreakdown[name] = (stats.toolBreakdown[name] ?? 0) + 1
  }
}

export function recordItemFailed(stats: PhaseStats, usage?: AgentUsage): void {
  stats.itemsFailed += 1
  if (usage !== undefined) {
    stats.totalInputTokens += usage.inputTokens
    stats.totalOutputTokens += usage.outputTokens
    stats.totalToolCalls += usage.toolCalls
    for (const name of usage.toolNames) {
      stats.toolBreakdown[name] = (stats.toolBreakdown[name] ?? 0) + 1
    }
  }
}

export function recordItemSkipped(stats: PhaseStats): void {
  stats.itemsSkipped += 1
}

function formatTokenCount(n: number): string {
  return n.toLocaleString('en-US')
}

function formatWallTime(ms: number): string {
  const totalSeconds = ms / 1000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return `${minutes}m ${seconds}s`
}

function computeTps(outputTokens: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0
  return Math.round(outputTokens / (elapsedMs / 1000))
}

export function formatPerItemSuffix(usage: AgentUsage, elapsedMs: number): string {
  const totalTokens = usage.inputTokens + usage.outputTokens
  const tps = computeTps(usage.outputTokens, elapsedMs)
  const elapsed = elapsedMs < 1000 ? `${Math.round(elapsedMs)}ms` : `${(elapsedMs / 1000).toFixed(1)}s`
  const toolLabel = usage.toolCalls === 1 ? '1 tool' : `${usage.toolCalls} tools`
  return ` — ${toolLabel}, ${formatTokenCount(totalTokens)} tok in ${elapsed} (${tps} tok/s) ✓`
}

export function formatPhaseSummary(stats: PhaseStats, wallMs: number, label: string): string {
  const lines: string[] = [label]
  const avgTps = computeTps(stats.totalOutputTokens, wallMs)
  lines.push(`  Wall: ${formatWallTime(wallMs)} | Avg: ${avgTps} tok/s`)
  lines.push(
    `  Tokens: ${formatTokenCount(stats.totalInputTokens)} in / ${formatTokenCount(stats.totalOutputTokens)} out`,
  )
  if (stats.totalToolCalls > 0) {
    const sorted = Object.entries(stats.toolBreakdown).sort((a, b) => b[1] - a[1])
    const breakdown = sorted.map(([name, count]) => `${name}: ${count}`).join(', ')
    lines.push(`  Tools: ${stats.totalToolCalls} calls (${breakdown})`)
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/behavior-audit-phase-stats.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/phase-stats.ts tests/scripts/behavior-audit-phase-stats.test.ts
git commit -m "feat(behavior-audit): add phase-stats types, accumulation, and formatting"
```

---

### Task 2: Change `extract-agent.ts` return type

**Files:**

- Modify: `scripts/behavior-audit/extract-agent.ts`

- [ ] **Step 1: Update `extractSingle` to capture usage and `extractWithRetry` to return `AgentResult`**

In `scripts/behavior-audit/extract-agent.ts`, the `extractSingle` function currently returns `ExtractionResult | null`. Change it to return `{ data: ExtractionResult | null; usage: AgentUsage }` so `extractWithRetry` can accumulate usage across retries.

Add import at top:

```ts
import type { AgentUsage } from './phase-stats.js'
```

Replace `extractSingle`:

```ts
async function extractSingle(
  prompt: string,
  attempt: number,
): Promise<{ data: ExtractionResult | null; usage: AgentUsage }> {
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, toolNames: [] }
  const timeout = attempt > 0 ? PHASE1_TIMEOUT_MS * 2 : PHASE1_TIMEOUT_MS
  try {
    const result = await verboseGenerateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 8192,
      tools: makeAuditTools(),
      output: Output.object({ schema: ExtractionResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    usage.inputTokens = result.totalUsage.inputTokens
    usage.outputTokens = result.totalUsage.outputTokens
    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        usage.toolCalls += 1
        usage.toolNames.push(tc.toolName)
      }
    }
    const parsed = ExtractionResultSchema.safeParse(result.output)
    return { data: parsed.success ? parsed.data : null, usage }
  } catch (error) {
    console.log(`✗ extract: ${error instanceof Error ? error.message : String(error)}`)
    return { data: null, usage }
  }
}
```

Replace `extractWithRetry`:

```ts
export async function extractWithRetry(prompt: string, attempt: number): Promise<AgentResult<ExtractionResult> | null> {
  if (attempt > 0) {
    const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]!
    await sleep(backoff)
  }
  const { data, usage } = await extractSingle(prompt, attempt)
  if (data !== null) return { result: data, usage }
  if (attempt >= MAX_RETRIES - 1) return null
  const nextResult = await extractWithRetry(prompt, attempt + 1)
  if (nextResult === null) return null
  return { result: nextResult.result, usage: { ...addAgentUsage(usage, nextResult.usage) } }
}
```

Note: this requires importing `addAgentUsage` from `phase-stats.js` and `AgentResult` type. Add to imports:

```ts
import { addAgentUsage, type AgentResult } from './phase-stats.js'
```

- [ ] **Step 2: Run existing tests to see what breaks**

Run: `bun test tests/scripts/behavior-audit-phase1-keywords.test.ts tests/scripts/behavior-audit-phase1-write-failure.test.ts`
Expected: Tests that mock `extractWithRetry` may fail if the mock return shape is checked. These tests provide `extractWithRetry` via DI and return plain objects, so they will break because the phase runner now expects `AgentResult`. These will be fixed in Task 6 when we update `extract.ts` and its tests together.

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/extract-agent.ts
git commit -m "feat(behavior-audit): extract-agent returns AgentResult with usage"
```

---

### Task 3: Change `keyword-resolver-agent.ts` return type

**Files:**

- Modify: `scripts/behavior-audit/keyword-resolver-agent.ts`

- [ ] **Step 1: Update `resolveSingle` and `resolveKeywordsWithRetry`**

Same pattern as Task 2. Add imports:

```ts
import { addAgentUsage, type AgentResult } from './phase-stats.js'
```

Replace `resolveSingle`:

```ts
async function resolveSingle(
  prompt: string,
  attempt: number,
): Promise<{ data: ResolverResult | null; usage: AgentUsage }> {
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, toolNames: [] }
  const timeout = attempt > 0 ? PHASE1_TIMEOUT_MS * 2 : PHASE1_TIMEOUT_MS
  try {
    const result = await verboseGenerateText({
      model,
      prompt,
      maxOutputTokens: 4096,
      output: Output.object({ schema: ResolverResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    usage.inputTokens = result.totalUsage.inputTokens
    usage.outputTokens = result.totalUsage.outputTokens
    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        usage.toolCalls += 1
        usage.toolNames.push(tc.toolName)
      }
    }
    const parsed = ResolverResultSchema.safeParse(result.output)
    return { data: parsed.success ? parsed.data : null, usage }
  } catch (error) {
    console.log(`✗ resolve: ${error instanceof Error ? error.message : String(error)}`)
    return { data: null, usage }
  }
}
```

Replace `resolveKeywordsWithRetry`:

```ts
export async function resolveKeywordsWithRetry(
  prompt: string,
  attempt: number,
): Promise<AgentResult<ResolverResult> | null> {
  if (attempt > 0) {
    const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]!
    await sleep(backoff)
  }
  const { data, usage } = await resolveSingle(prompt, attempt)
  if (data !== null) return { result: data, usage }
  if (attempt >= MAX_RETRIES - 1) return null
  const nextResult = await resolveKeywordsWithRetry(prompt, attempt + 1)
  if (nextResult === null) return null
  return { result: nextResult.result, usage: addAgentUsage(usage, nextResult.usage) }
}
```

Note: `keyword-resolver-agent` does not use tools (no `tools` in the `verboseGenerateText` call), so `toolCalls` will always be 0 and `toolNames` will always be empty. The usage is still captured correctly.

- [ ] **Step 2: Commit**

```bash
git add scripts/behavior-audit/keyword-resolver-agent.ts
git commit -m "feat(behavior-audit): keyword-resolver-agent returns AgentResult with usage"
```

---

### Task 4: Change `extract-phase1-helpers.ts` — `resolveKeywords` returns usage

**Files:**

- Modify: `scripts/behavior-audit/extract-phase1-helpers.ts`

- [ ] **Step 1: Update `resolveKeywords` return type**

Currently `resolveKeywords` returns `readonly string[] | null`. Change it to return `{ keywords: readonly string[]; usage: AgentUsage } | null` so the Phase 1 runner can combine usage from extraction + keyword resolution.

Add import:

```ts
import type { AgentUsage } from './phase-stats.js'
```

Update the `resolveKeywords` function signature and body. Replace the entire function:

```ts
export async function resolveKeywords(
  candidateKeywords: readonly string[],
  testKey: string,
  progress: Progress,
  deps: ResolveKeywordsDeps,
): Promise<{ keywords: readonly string[]; usage: AgentUsage } | null> {
  const existingVocabulary = (await deps.loadKeywordVocabulary()) ?? []
  const vocabularyText = buildVocabularySlugListText(existingVocabulary)
  const resolved = await deps.resolveKeywordsWithRetry(buildResolverPrompt(candidateKeywords, vocabularyText), 0)
  if (resolved === null) {
    deps.markTestFailed(progress, testKey, 'keyword resolution failed')
    return null
  }
  const nextVocabulary = normalizeKeywordVocabularyEntries([
    ...existingVocabulary,
    ...resolved.result.appendedEntries.map((entry) => stampVocabularyEntry(entry)),
  ])
  await deps.saveKeywordVocabulary(nextVocabulary)
  const normalizedKeywords = [
    ...new Set(resolved.result.keywords.map((keyword) => normalizeKeywordSlug(keyword)).filter(Boolean)),
  ]
  if (normalizedKeywords.length === 0) {
    deps.markTestFailed(progress, testKey, 'keyword resolution produced no valid canonical keywords')
    return null
  }
  return { keywords: normalizedKeywords, usage: resolved.usage }
}
```

Key change: `resolved` is now `AgentResult<ResolverResult>` (not bare `ResolverResult`), so all accesses to `.keywords` and `.appendedEntries` become `.result.keywords` and `.result.appendedEntries`.

Also update the `ResolveKeywordsDeps` interface — the `resolveKeywordsWithRetry` type needs to match the new return type. Change:

```ts
export interface ResolveKeywordsDeps {
  readonly loadKeywordVocabulary: typeof loadKeywordVocabulary
  readonly saveKeywordVocabulary: typeof saveKeywordVocabulary
  readonly resolveKeywordsWithRetry: (prompt: string, attempt: number) => Promise<AgentResult<ResolverResult> | null>
  readonly markTestFailed: typeof markTestFailed
}
```

Add the import for `AgentResult`:

```ts
import type { AgentResult } from './phase-stats.js'
```

- [ ] **Step 2: Commit**

```bash
git add scripts/behavior-audit/extract-phase1-helpers.ts
git commit -m "feat(behavior-audit): resolveKeywords returns usage alongside keywords"
```

---

### Task 5: Change `extract.ts` — unwrap results, accumulate stats, render

**Files:**

- Modify: `scripts/behavior-audit/extract.ts`
- Modify: `tests/scripts/behavior-audit-phase1-keywords.test.ts`
- Modify: `tests/scripts/behavior-audit-phase1-write-failure.test.ts`

- [ ] **Step 1: Update `Phase1Deps` to include `stats`**

In `scripts/behavior-audit/extract.ts`, add imports:

```ts
import {
  addAgentUsage,
  createPhaseStats,
  type AgentResult,
  type AgentUsage,
  type PhaseStats,
  recordItemDone,
  recordItemFailed,
  recordItemSkipped,
  formatPerItemSuffix,
  formatPhaseSummary,
} from './phase-stats.js'
```

Add `stats` to `Phase1Deps`:

```ts
export interface Phase1Deps {
  readonly extractWithRetry: typeof extractWithRetry
  readonly resolveKeywordsWithRetry: typeof resolveKeywordsWithRetry
  readonly loadKeywordVocabulary: typeof loadKeywordVocabulary
  readonly saveKeywordVocabulary: typeof saveKeywordVocabulary
  readonly updateManifestForExtractedTest: typeof updateManifestForExtractedTest
  readonly saveManifest: typeof saveManifest
  readonly saveProgress: typeof saveProgress
  readonly getFailedTestAttempts: typeof getFailedTestAttempts
  readonly markTestDone: typeof markTestDone
  readonly markTestFailed: typeof markTestFailed
  readonly resetPhase2AndPhase3: typeof resetPhase2AndPhase3
  readonly getSelectedTests: typeof getSelectedTests
  readonly shouldSkipCompletedFile: typeof shouldSkipCompletedFile
  readonly writeValidBehaviorsForFile: typeof writeValidBehaviorsForFile
  readonly markFileDoneWhenSelectedTestsPersisted: typeof markFileDoneWhenSelectedTestsPersisted
  readonly log: Pick<typeof console, 'log'>
  readonly writeStdout: (text: string) => void
  readonly stats?: PhaseStats
}
```

Note: `stats` is optional so existing tests that don't provide it continue to work.

- [ ] **Step 2: Update `extractAndSave` to unwrap results, combine usage, and render**

Replace the `extractAndSave` function. The key changes:

- `extractWithRetry` now returns `AgentResult<ExtractionResult> | null` — unwrap via `.result` and `.usage`
- `resolveKeywords` now returns `{ keywords, usage } | null` — combine both usages
- Per-item line uses `formatPerItemSuffix`
- Stats are recorded via `recordItemDone`/`recordItemFailed`

```ts
async function extractAndSave(
  testCase: TestCase,
  testFile: ParsedTestFile,
  testFilePath: string,
  testKey: string,
  displayIndex: number,
  totalTests: number,
  progress: Progress,
  manifest: IncrementalManifest,
  deps: Phase1Deps,
): Promise<SingleTestResult> {
  deps.writeStdout(`  [${displayIndex}/${totalTests}] "${testCase.name}" `)
  const startMs = performance.now()
  let combinedUsage: AgentUsage | null = null
  const extracted = await deps.extractWithRetry(buildExtractionPrompt(testCase, testFilePath), 0)
  if (extracted === null) {
    deps.markTestFailed(progress, testKey, 'extraction failed')
    const elapsedMs = performance.now() - startMs
    deps.log.log(`(${formatElapsedMs(elapsedMs)}) ✗`)
    if (deps.stats !== undefined) recordItemFailed(deps.stats)
    return null
  }
  combinedUsage = extracted.usage
  const keywordsResult = await resolveKeywords(extracted.result.candidateKeywords, testKey, progress, deps)
  if (keywordsResult === null) {
    const elapsedMs = performance.now() - startMs
    deps.log.log(`(${formatElapsedMs(elapsedMs)}) ✗`)
    if (deps.stats !== undefined) recordItemFailed(deps.stats, combinedUsage)
    return null
  }
  combinedUsage = addAgentUsage(combinedUsage, keywordsResult.usage)
  const record: ExtractedBehaviorRecord = {
    behaviorId: testKey,
    testKey,
    testFile: testFilePath,
    domain: getDomain(testFilePath),
    testName: testCase.name,
    fullPath: testCase.fullPath,
    behavior: extracted.result.behavior,
    context: extracted.result.context,
    keywords: keywordsResult.keywords,
    extractedAt: new Date().toISOString(),
  }
  const { manifest: updatedManifest, phase1Changed } = await deps.updateManifestForExtractedTest({
    manifest,
    testFile,
    testCase,
    extractedBehavior: record,
  })
  const elapsedMs = performance.now() - startMs
  deps.log.log(formatPerItemSuffix(combinedUsage, elapsedMs))
  if (deps.stats !== undefined) recordItemDone(deps.stats, combinedUsage)
  return { record, manifest: updatedManifest, phase1Changed }
}
```

Update `processSingleTestCase` to handle skipped items with stats:

```ts
function processSingleTestCase(
  testCase: TestCase,
  testFile: ParsedTestFile,
  testFilePath: string,
  displayIndex: number,
  totalTests: number,
  progress: Progress,
  manifest: IncrementalManifest,
  deps: Phase1Deps,
): Promise<SingleTestResult> {
  const testKey = `${testFilePath}::${testCase.fullPath}`
  if (deps.getFailedTestAttempts(progress, testKey) >= MAX_RETRIES) {
    deps.log.log(`  [${displayIndex}/${totalTests}] "${testCase.name}" (skipped, max retries reached)`)
    if (deps.stats !== undefined) recordItemSkipped(deps.stats)
    return Promise.resolve(null)
  }
  return extractAndSave(testCase, testFile, testFilePath, testKey, displayIndex, totalTests, progress, manifest, deps)
}
```

Update `processTestFile` to record skipped files:

```ts
async function processTestFile(
  testFile: ParsedTestFile,
  progress: Progress,
  fileIndex: number,
  totalFiles: number,
  selectedTestKeys: ReadonlySet<string>,
  manifest: IncrementalManifest,
  deps: Phase1Deps,
): Promise<{ readonly manifest: IncrementalManifest; readonly anyPhase1Changed: boolean }> {
  const selectedTests = deps.getSelectedTests(testFile.filePath, testFile.tests, selectedTestKeys)
  if (selectedTests.length === 0) {
    deps.log.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath} (skipped, no selected tests)`)
    return { manifest, anyPhase1Changed: false }
  }
  if (deps.shouldSkipCompletedFile({ progress, testFilePath: testFile.filePath, selectedTests, selectedTestKeys })) {
    deps.log.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath} (skipped, already done)`)
    return { manifest, anyPhase1Changed: false }
  }
  deps.log.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath}`)
  const extractionResult = await runSelectedExtractions({
    selectedTests,
    testFile,
    progress,
    manifest,
    deps,
  })
  await deps.writeValidBehaviorsForFile(testFile.filePath, selectedTests, extractionResult.results)
  const persistedTestKeys = new Set(
    extractionResult.results.flatMap((result) => (result === null ? [] : [result.record.testKey])),
  )
  reconcileSelectedTestsAfterPersist(progress, testFile.filePath, selectedTests, persistedTestKeys)
  for (const testKey of persistedTestKeys) {
    deps.markTestDone(progress, testFile.filePath, testKey)
  }
  await deps.saveManifest(extractionResult.manifest)
  deps.markFileDoneWhenSelectedTestsPersisted(progress, testFile.filePath, selectedTests)
  await deps.saveProgress(progress)
  return { manifest: extractionResult.manifest, anyPhase1Changed: extractionResult.anyPhase1Changed }
}
```

(This is unchanged from current except we don't need to modify it for stats since `extractAndSave` and `processSingleTestCase` handle it.)

Update `runPhase1` to render the phase summary:

```ts
export async function runPhase1(
  { testFiles, progress, selectedTestKeys, manifest }: Phase1RunInput,
  deps: Partial<Phase1Deps> = {},
): Promise<void> {
  const resolvedDeps: Phase1Deps = { ...defaultPhase1Deps, ...deps }
  if (resolvedDeps.stats === undefined) {
    resolvedDeps.stats = createPhaseStats()
  }
  const hasSelectedPhase1Work = testFiles.some(
    (testFile) => resolvedDeps.getSelectedTests(testFile.filePath, testFile.tests, selectedTestKeys).length > 0,
  )
  if (hasSelectedPhase1Work) {
    resolvedDeps.resetPhase2AndPhase3(progress)
  }
  progress.phase1.status = 'in-progress'
  await resolvedDeps.saveProgress(progress)
  const limit = pLimit(1)
  let currentManifest = manifest
  let anyPhase1Changed = false
  await Promise.all(
    testFiles.map((f, i) =>
      limit(async () => {
        const result = await processTestFile(
          f,
          progress,
          i + 1,
          testFiles.length,
          selectedTestKeys,
          currentManifest,
          resolvedDeps,
        )
        currentManifest = result.manifest
        if (result.anyPhase1Changed) anyPhase1Changed = true
      }),
    ),
  )
  if (anyPhase1Changed && !hasSelectedPhase1Work) {
    resolvedDeps.resetPhase2AndPhase3(progress)
  }
  progress.phase1.status = 'done'
  await resolvedDeps.saveProgress(progress)
  const wallMs = performance.now() - resolvedDeps.stats.wallStartMs
  const label = `[Phase 1 complete] ${progress.phase1.stats.filesDone} files, ${progress.phase1.stats.testsExtracted} behaviors extracted, ${progress.phase1.stats.testsFailed} failed`
  resolvedDeps.log.log(`\n${formatPhaseSummary(resolvedDeps.stats, wallMs, label)}`)
}
```

- [ ] **Step 3: Update test mocks in `behavior-audit-phase1-keywords.test.ts`**

The mocks for `extractWithRetry` and `resolveKeywordsWithRetry` need to return `AgentResult` wrappers. Update the `createExtractResult` and `createResolvedKeywords` helpers and their call sites.

Add import:

```ts
import type { AgentResult } from '../../scripts/behavior-audit/phase-stats.js'
```

Wrap mock return values. Every place that does:

```ts
extractWithRetry: (_prompt, _attempt) =>
  Promise.resolve(createExtractResult({...})),
```

Becomes:

```ts
extractWithRetry: (_prompt, _attempt) =>
  Promise.resolve({ result: createExtractResult({...}), usage: { inputTokens: 100, outputTokens: 50, toolCalls: 2, toolNames: ['readFile', 'grep'] } }),
```

Every place that does:

```ts
resolveKeywordsWithRetry: (_prompt, _attempt) =>
  Promise.resolve(createResolvedKeywords({...})),
```

Becomes:

```ts
resolveKeywordsWithRetry: (_prompt, _attempt) =>
  Promise.resolve({ result: createResolvedKeywords({...}), usage: { inputTokens: 50, outputTokens: 20, toolCalls: 0, toolNames: [] } }),
```

Also update the type aliases at the top:

```ts
type ExtractResult = NonNullable<
  Awaited<ReturnType<(typeof import('../../scripts/behavior-audit/extract-agent.js'))['extractWithRetry']>>
>
type ResolveKeywordsResult = NonNullable<
  Awaited<
    ReturnType<(typeof import('../../scripts/behavior-audit/keyword-resolver-agent.js'))['resolveKeywordsWithRetry']>
  >
>
```

These types now resolve to `AgentResult<ExtractionResult>` and `AgentResult<ResolverResult>` respectively, so `createExtractResult` and `createResolvedKeywords` helpers still create the inner values correctly (the `.result` part).

Update `createExtractResult` — its return type now needs to match `ExtractResult['result']`:

```ts
function createExtractResult(input: {
  readonly behavior: string
  readonly context: string
  readonly candidateKeywords: readonly string[]
}): ExtractResult['result'] {
```

Update `createResolvedKeywords` — its return type now needs to match `ResolveKeywordsResult['result']`:

```ts
function createResolvedKeywords(input: {
  readonly keywords: readonly string[]
  readonly appendedEntries: readonly {
    readonly slug: string
    readonly description: string
  }[]
}): ResolveKeywordsResult['result'] {
```

- [ ] **Step 4: Update test mocks in `behavior-audit-phase1-write-failure.test.ts`**

Same wrapping pattern. Add import:

```ts
import type { AgentResult } from '../../scripts/behavior-audit/phase-stats.js'
```

Wrap `extractWithRetry` and `resolveKeywordsWithRetry` mock returns with `{ result: ..., usage: { inputTokens: 100, outputTokens: 50, toolCalls: 0, toolNames: [] } }`.

- [ ] **Step 5: Run updated tests**

Run: `bun test tests/scripts/behavior-audit-phase1-keywords.test.ts tests/scripts/behavior-audit-phase1-write-failure.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/extract.ts tests/scripts/behavior-audit-phase1-keywords.test.ts tests/scripts/behavior-audit-phase1-write-failure.test.ts
git commit -m "feat(behavior-audit): extract phase runner unwraps AgentResult, renders stats"
```

---

### Task 6: Change `classify-agent.ts` return type + update classify-agent tests

**Files:**

- Modify: `scripts/behavior-audit/classify-agent.ts`
- Modify: `tests/scripts/behavior-audit-classify-agent.test.ts`

- [ ] **Step 1: Update `classify-agent.ts`**

The classify agent uses DI deps. The `classifySingle` function needs to capture usage and return it. The `retryClassification` / `classifyAttempt` chain needs to accumulate usage.

Add import:

```ts
import { addAgentUsage, type AgentResult, type AgentUsage } from './phase-stats.js'
```

Change `classifySingle` to return `{ data: ClassificationResult | null; usage: AgentUsage }`:

```ts
async function classifySingle(
  prompt: string,
  attempt: number,
  deps: ClassifyAgentDeps,
): Promise<{ data: ClassificationResult | null; usage: AgentUsage }> {
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, toolNames: [] }
  const timeout = attempt > 0 ? deps.config.PHASE2_TIMEOUT_MS * 2 : deps.config.PHASE2_TIMEOUT_MS
  try {
    const result = await deps.generateText({
      model: deps.buildModel(deps.config.BASE_URL, deps.config.MODEL, getEnvOrFallback('OPENAI_API_KEY', 'no-key')),
      system: SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 8192,
      output: deps.outputObject({ schema: ClassificationResultSchema }),
      stopWhen: deps.stepCountIs(deps.config.MAX_STEPS + 1),
      abortSignal: deps.createAbortSignal(timeout),
    })
    usage.inputTokens = result.totalUsage.inputTokens
    usage.outputTokens = result.totalUsage.outputTokens
    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        usage.toolCalls += 1
        usage.toolNames.push(tc.toolName)
      }
    }
    return { data: result.output, usage }
  } catch (error) {
    console.log(`✗ classify: ${error instanceof Error ? error.message : String(error)}`)
    return { data: null, usage }
  }
}
```

Update `retryClassification` to return `AgentResult<ClassificationResult> | null` and accumulate usage:

```ts
function retryClassification(
  prompt: string,
  attempt: number,
  attemptOffset: number,
  deps: ClassifyAgentDeps,
  accumulatedUsage: AgentUsage,
): Promise<AgentResult<ClassificationResult> | null> {
  if (attempt >= deps.config.MAX_RETRIES) {
    return Promise.resolve(null)
  }

  return classifyAttempt(prompt, attempt, attemptOffset, deps).then(({ data, usage }) => {
    const combined = addAgentUsage(accumulatedUsage, usage)
    if (data !== null) {
      return { result: data, usage: combined }
    }
    return retryClassification(prompt, attempt + 1, attemptOffset, deps, combined)
  })
}
```

Update `classifyAttempt` to return `{ data, usage }`:

```ts
async function classifyAttempt(
  prompt: string,
  attempt: number,
  attemptOffset: number,
  deps: ClassifyAgentDeps,
): Promise<{ data: ClassificationResult | null; usage: AgentUsage }> {
  if (attempt > attemptOffset) {
    await deps.sleep(getRetryBackoff(attempt, deps))
  }
  return classifySingle(prompt, attempt, deps)
}
```

Update the overloads for `classifyBehaviorWithRetry`:

```ts
export function classifyBehaviorWithRetry(
  prompt: string,
  attemptOffset: number,
): Promise<AgentResult<ClassificationResult> | null>
export function classifyBehaviorWithRetry(
  prompt: string,
  attemptOffset: number,
  deps: ClassifyAgentDeps,
): Promise<AgentResult<ClassificationResult> | null>
export function classifyBehaviorWithRetry(
  ...args: readonly [string, number] | readonly [string, number, ClassifyAgentDeps]
): Promise<AgentResult<ClassificationResult> | null> {
  const [prompt, attemptOffset] = args
  const emptyUsage: AgentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, toolNames: [] }
  if (args.length === 2) {
    return retryClassification(prompt, attemptOffset, attemptOffset, createDefaultClassifyAgentDeps(), emptyUsage)
  }
  const [, , deps] = args
  return retryClassification(prompt, attemptOffset, attemptOffset, deps, emptyUsage)
}
```

- [ ] **Step 2: Update `tests/scripts/behavior-audit-classify-agent.test.ts`**

The test calls `classifyBehaviorWithRetry` with a custom `generateText` mock. The mock's `generateText` returns `{ output }` which becomes the `result.output` accessed inside `classifySingle`. But `classifySingle` now also reads `result.totalUsage` and `result.steps`.

Update the `generateText` mock to include `totalUsage` and `steps`:

In the first test (line 53), change:

```ts
const generateText: ClassifyAgentDeps['generateText'] = (_input) => {
  events.push('generate')
  return Promise.resolve({ output })
}
```

to:

```ts
const generateText: ClassifyAgentDeps['generateText'] = (_input) => {
  events.push('generate')
  return Promise.resolve({ output, totalUsage: { inputTokens: 100, outputTokens: 50 }, steps: [] })
}
```

Same change for the second test's `generateText` mock (line 95):

```ts
return Promise.resolve({ output, totalUsage: { inputTokens: 100, outputTokens: 50 }, steps: [] })
```

Update assertions from `result.featureKey` to `result.result.featureKey`:

```ts
expect(result === null ? null : result.result.featureKey).toBe('task-creation')
```

Apply this to all tests in the file that assert on `result.featureKey`.

- [ ] **Step 3: Run the classify-agent tests**

Run: `bun test tests/scripts/behavior-audit-classify-agent.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/behavior-audit/classify-agent.ts tests/scripts/behavior-audit-classify-agent.test.ts
git commit -m "feat(behavior-audit): classify-agent returns AgentResult with usage"
```

---

### Task 7: Change `classify.ts` — unwrap results, accumulate stats, render

**Files:**

- Modify: `scripts/behavior-audit/classify.ts`
- Modify: `tests/scripts/behavior-audit-phase2a.test.ts`

- [ ] **Step 1: Update `classify.ts`**

Add imports:

```ts
import {
  type AgentResult,
  type AgentUsage,
  type PhaseStats,
  createPhaseStats,
  formatPerItemSuffix,
  formatPhaseSummary,
  recordItemDone,
  recordItemFailed,
  recordItemSkipped,
} from './phase-stats.js'
```

Add optional `stats` to `Phase2aDeps`:

```ts
export interface Phase2aDeps {
  ...existing fields...
  readonly stats?: PhaseStats
}
```

Update `classifySelectedBehavior` to unwrap the agent result:

```ts
async function classifySelectedBehavior(
  progress: Progress,
  entry: SelectedBehaviorEntry,
  deps: Phase2aDeps,
): Promise<{ classified: ClassifiedBehavior; usage: AgentUsage } | null> {
  const behaviorId = buildBehaviorId(entry.testKey)
  const failedAttempts = deps.getFailedClassificationAttempts(progress, behaviorId)
  if (failedAttempts >= deps.maxRetries) {
    return null
  }

  const agentResult = await deps.classifyBehaviorWithRetry(buildPrompt(entry.testKey, entry.behavior), failedAttempts)
  if (agentResult === null) {
    deps.setClassificationFailedAttempts(progress, behaviorId, 'classification failed after retries', deps.maxRetries)
    return null
  }

  const classified = toClassifiedBehavior(entry.testKey, agentResult.result)
  deps.markClassificationDone(progress, behaviorId)
  return { classified, usage: agentResult.usage }
}
```

Update `processSelectedClassification` to propagate usage:

```ts
async function processSelectedClassification(input: {
  readonly progress: Progress
  readonly entry: SelectedBehaviorEntry
  readonly manifest: IncrementalManifest
  readonly dirtyFeatureKeys: Set<string>
  readonly deps: Phase2aDeps
}): Promise<ClassificationProcessResult & { readonly usage: AgentUsage | null }> {
  if (shouldReuseCompletedClassification(input.progress, input.manifest, input.entry)) {
    addDirtyFeatureKey(input.dirtyFeatureKeys, input.manifest.tests[input.entry.testKey]?.featureKey ?? null)
    return { kind: 'reused', manifest: input.manifest, usage: null }
  }

  const classifyResult = await classifySelectedBehavior(input.progress, input.entry, input.deps)
  if (classifyResult === null) {
    await input.deps.saveProgress(input.progress)
    return { kind: 'failed', manifest: input.manifest, usage: null }
  }

  addDirtyFeatureKey(input.dirtyFeatureKeys, classifyResult.classified.featureKey)
  const updatedManifest = await persistSuccessfulClassification({
    progress: input.progress,
    manifest: input.manifest,
    entry: input.entry,
    classified: classifyResult.classified,
    deps: input.deps,
  })
  return { kind: 'classified', manifest: updatedManifest, usage: classifyResult.usage }
}
```

Update `logClassificationResult` to use `formatPerItemSuffix`:

```ts
function logClassificationResult(
  deps: Phase2aDeps,
  result: ClassificationProcessResult & { readonly usage: AgentUsage | null },
  elapsedMs: number,
): void {
  switch (result.kind) {
    case 'reused':
      deps.log.log('(reused)')
      break
    case 'classified':
      if (result.usage !== null) {
        deps.log.log(formatPerItemSuffix(result.usage, elapsedMs))
      } else {
        deps.log.log(`(${formatElapsedMs(elapsedMs)}) ✓`)
      }
      break
    case 'failed':
      deps.log.log(`(${formatElapsedMs(elapsedMs)}) ✗`)
      break
  }
}
```

Update `processSelectedEntry` to record stats:

```ts
async function processSelectedEntry(
  entry: SelectedBehaviorEntry,
  displayIndex: number,
  displayTotal: number,
  progress: Progress,
  manifest: IncrementalManifest,
  dirtyFeatureKeys: Set<string>,
  deps: Phase2aDeps,
): Promise<ClassificationProcessResult> {
  deps.writeStdout(`  [${displayIndex}/${displayTotal}] "${entry.behavior.fullPath}" `)
  const startMs = performance.now()
  const result = await processSelectedClassification({
    progress,
    entry,
    manifest,
    dirtyFeatureKeys,
    deps,
  })
  const elapsedMs = performance.now() - startMs
  logClassificationResult(deps, result, elapsedMs)
  if (deps.stats !== undefined) {
    if (result.kind === 'classified' && result.usage !== null) {
      recordItemDone(deps.stats, result.usage)
    } else if (result.kind === 'failed') {
      recordItemFailed(deps.stats, result.usage ?? undefined)
    } else if (result.kind === 'reused') {
      recordItemSkipped(deps.stats)
    }
  }
  return result
}
```

Update `runPhase2a` to create stats and render summary:

```ts
export async function runPhase2a(input: Phase2aRunInput): Promise<ReadonlySet<string>>
export async function runPhase2a(input: Phase2aRunInput, deps: Partial<Phase2aDeps>): Promise<ReadonlySet<string>>
export async function runPhase2a(
  input: Phase2aRunInput,
  ...args: readonly [] | readonly [Partial<Phase2aDeps>]
): Promise<ReadonlySet<string>> {
  const { progress, selectedTestKeys, manifest } = input
  const defaultPhase2aDeps = createDefaultPhase2aDeps()
  const resolvedDeps: Phase2aDeps = args.length === 0 ? defaultPhase2aDeps : { ...defaultPhase2aDeps, ...args[0] }
  if (resolvedDeps.stats === undefined) {
    resolvedDeps.stats = createPhaseStats()
  }
  progress.phase2a.status = 'in-progress'
  const dirtyFeatureKeys = new Set<string>()
  const limit = pLimit(1)
  let currentManifest = manifest

  const selectedEntries = await loadSelectedBehaviors(manifest, selectedTestKeys, resolvedDeps.readExtractedFile)
  progress.phase2a.stats.behaviorsTotal = selectedEntries.length
  await resolvedDeps.saveProgress(progress)

  await Promise.all(
    selectedEntries.map((entry, index) =>
      limit(async () => {
        const result = await processSelectedEntry(
          entry,
          index + 1,
          selectedEntries.length,
          progress,
          currentManifest,
          dirtyFeatureKeys,
          resolvedDeps,
        )
        currentManifest = result.manifest
      }),
    ),
  )

  progress.phase2a.status = 'done'
  await resolvedDeps.saveProgress(progress)
  const wallMs = performance.now() - resolvedDeps.stats.wallStartMs
  const label = `[Phase 2a complete] ${progress.phase2a.stats.behaviorsDone} classified, ${progress.phase2a.stats.behaviorsFailed} failed`
  resolvedDeps.log.log(`\n${formatPhaseSummary(resolvedDeps.stats, wallMs, label)}`)
  return dirtyFeatureKeys
}
```

- [ ] **Step 2: Update `tests/scripts/behavior-audit-phase2a.test.ts`**

The `classifyBehaviorWithRetry` mock returns bare `MockClassificationResult`. Wrap it in `AgentResult`:

Add import:

```ts
import type { AgentResult } from '../../scripts/behavior-audit/phase-stats.js'
```

Update the mock in `createPhase2aDeps`:

```ts
function createPhase2aDeps(): Pick<Phase2aDeps, 'classifyBehaviorWithRetry'> {
  return {
    classifyBehaviorWithRetry: (
      prompt: string,
      attemptOffset: number,
    ): Promise<AgentResult<MockClassificationResult>> => {
      classifyBehaviorWithRetryCalls += 1
      return classifyBehaviorWithRetryImpl(prompt, attemptOffset).then((result) => ({
        result,
        usage: { inputTokens: 100, outputTokens: 50, toolCalls: 1, toolNames: ['readFile'] },
      }))
    },
  }
}
```

And the `classifyBehaviorWithRetryImpl` function still returns bare `MockClassificationResult` — the wrapper handles the wrapping.

Also check: `Phase2aDeps` type import — the type in the test file comes from the module import. The `classifyBehaviorWithRetry` field type in `Phase2aDeps` is `typeof classifyBehaviorWithRetry` which now returns `Promise<AgentResult<ClassificationResult> | null>`. The mock return type needs to match.

The mock currently declares return type as `Promise<MockClassificationResult>`. Change to `Promise<AgentResult<MockClassificationResult>>`:

```ts
classifyBehaviorWithRetryImpl: Phase2aDeps['classifyBehaviorWithRetry'] = (_prompt, _attempt) =>
  Promise.resolve({
    result: {
      visibility: 'user-facing',
      featureKey: 'task-creation',
      featureLabel: 'Task creation',
      supportingBehaviorRefs: [],
      relatedBehaviorHints: [],
      classificationNotes: 'Matches task creation flow.',
    },
    usage: { inputTokens: 100, outputTokens: 50, toolCalls: 1, toolNames: ['readFile'] },
  })
```

And the override in `createPhase2aDeps` becomes:

```ts
function createPhase2aDeps(): Pick<Phase2aDeps, 'classifyBehaviorWithRetry'> {
  return {
    classifyBehaviorWithRetry: (prompt: string, attemptOffset: number) => {
      classifyBehaviorWithRetryCalls += 1
      return classifyBehaviorWithRetryImpl(prompt, attemptOffset) as ReturnType<
        Phase2aDeps['classifyBehaviorWithRetry']
      >
    },
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `bun test tests/scripts/behavior-audit-phase2a.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/behavior-audit/classify.ts tests/scripts/behavior-audit-phase2a.test.ts
git commit -m "feat(behavior-audit): classify phase runner unwraps AgentResult, renders stats"
```

---

### Task 8: Change `consolidate-agent.ts` + `consolidate-helpers.ts` + `consolidate.ts` + update phase2b tests

**Files:**

- Modify: `scripts/behavior-audit/consolidate-agent.ts`
- Modify: `scripts/behavior-audit/consolidate-helpers.ts`
- Modify: `scripts/behavior-audit/consolidate.ts`
- Modify: `tests/scripts/behavior-audit-phase2b.test.ts`

- [ ] **Step 1: Update `consolidate-agent.ts`**

Add import:

```ts
import { addAgentUsage, type AgentResult, type AgentUsage } from './phase-stats.js'
```

Change `consolidateSingle` to return `{ data, usage }`:

```ts
async function consolidateSingle(
  prompt: string,
  attempt: number,
): Promise<{ data: ConsolidationResult | null; usage: AgentUsage }> {
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, toolNames: [] }
  const timeout = attempt > 0 ? PHASE2_TIMEOUT_MS * 2 : PHASE2_TIMEOUT_MS
  const tools = makeAuditTools()
  const start = Date.now()
  try {
    const result = await verboseGenerateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 16384,
      tools,
      output: Output.object({ schema: ConsolidationResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    usage.inputTokens = result.totalUsage.inputTokens
    usage.outputTokens = result.totalUsage.outputTokens
    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        usage.toolCalls += 1
        usage.toolNames.push(tc.toolName)
      }
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    if (result.output === null) {
      console.log(`✗ null output (${elapsed}s)`)
      return { data: null, usage }
    }
    const parsed = ConsolidationResultSchema.safeParse(result.output)
    if (!parsed.success) {
      console.log(`✗ parse error (${elapsed}s)`)
      return { data: null, usage }
    }
    return { data: parsed.data, usage }
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`✗ error: ${err instanceof Error ? err.message : String(err)} (${elapsed}s)`)
    return { data: null, usage }
  }
}
```

Change `attemptConsolidation` to accumulate usage:

```ts
async function attemptConsolidation(
  prompt: string,
  featureKey: string,
  attempt: number,
  remaining: number,
  accumulatedUsage: AgentUsage,
): Promise<{
  items: readonly { readonly id: string; readonly item: ConsolidationResult['consolidations'][number] }[] | null
  usage: AgentUsage
}> {
  if (remaining <= 0) return { items: null, usage: accumulatedUsage }

  if (attempt > 0) {
    const backoff = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]!
    console.log(`  retry ${attempt}/${MAX_RETRIES - 1}, waiting ${backoff / 1000}s...`)
    await sleep(backoff)
  }

  const { data, usage } = await consolidateSingle(prompt, attempt)
  const combined = addAgentUsage(accumulatedUsage, usage)
  if (data !== null) {
    return {
      items: data.consolidations.map((item) => ({
        id: `${featureKey}::${slugify(item.featureName)}`,
        item,
      })),
      usage: combined,
    }
  }

  return attemptConsolidation(prompt, featureKey, attempt + 1, remaining - 1, combined)
}
```

Change `consolidateWithRetry`:

```ts
export function consolidateWithRetry(
  featureKey: string,
  behaviors: readonly ConsolidateBehaviorInput[],
  attemptOffset: number,
): Promise<AgentResult<
  readonly { readonly id: string; readonly item: ConsolidationResult['consolidations'][number] }[]
> | null> {
  const prompt = buildPrompt(featureKey, behaviors)
  const remaining = MAX_RETRIES - attemptOffset
  const emptyUsage: AgentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, toolNames: [] }
  return attemptConsolidation(prompt, featureKey, attemptOffset, remaining, emptyUsage).then(({ items, usage }) => {
    if (items === null) return null
    return { result: items, usage }
  })
}
```

- [ ] **Step 2: Update `consolidate-helpers.ts` — `toConsolidations` parameter type**

The `toConsolidations` function currently takes `NonNullable<Awaited<ReturnType<ConsolidateWithRetry>>>` which will resolve to `AgentResult<...>` after the agent change. Since `consolidate.ts` now passes the unwrapped `agentResult.result`, update the parameter type to match directly:

```ts
type ConsolidationItem = {
  readonly id: string
  readonly item: ConsolidationResult['consolidations'][number]
}

export function toConsolidations(
  result: readonly ConsolidationItem[],
  inputs: readonly ConsolidateBehaviorInput[],
): readonly ConsolidatedBehavior[] {
```

Also remove the `ConsolidateWithRetry` type import from `toConsolidations` since it's no longer needed for the parameter type. Keep the `ConsolidateWithRetry` type export if it's still used elsewhere (it is — in `consolidate.ts`'s deps interface and `defaultConsolidateWithRetry`).

- [ ] **Step 3: Update `consolidate.ts`**

Add imports:

```ts
import {
  type PhaseStats,
  createPhaseStats,
  formatPerItemSuffix,
  formatPhaseSummary,
  recordItemDone,
  recordItemFailed,
  recordItemSkipped,
} from './phase-stats.js'
```

Add optional `stats` to `Phase2bDeps`:

```ts
interface Phase2bDeps {
  readonly consolidateWithRetry: ConsolidateWithRetry
  readonly writeConsolidatedFile: typeof writeConsolidatedFile
  readonly readExtractedFile: typeof readExtractedFile
  readonly readClassifiedFile: typeof readClassifiedFile
  readonly log: Pick<typeof console, 'log'>
  readonly writeStdout: (text: string) => void
  readonly stats?: PhaseStats
}
```

Update `consolidateFeatureKey` to unwrap the agent result:

```ts
async function consolidateFeatureKey(input: {
  readonly progress: Progress
  readonly consolidatedManifest: ConsolidatedManifest
  readonly phase2Version: string
  readonly featureKey: string
  readonly inputs: readonly ConsolidateBehaviorInput[]
  readonly deps: Phase2bDeps
}): Promise<ConsolidationProcessResult> {
  const failedAttempts = getFailedFeatureKeyAttempts(input.progress, input.featureKey)
  if (failedAttempts >= MAX_RETRIES) {
    return { kind: 'skipped', manifest: input.consolidatedManifest }
  }

  const agentResult = await input.deps.consolidateWithRetry(input.featureKey, input.inputs, failedAttempts)
  if (agentResult === null) {
    markFeatureKeyFailed(input.progress, input.featureKey, 'consolidation failed after retries', failedAttempts + 1)
    await saveProgress(input.progress)
    return { kind: 'failed', manifest: input.consolidatedManifest }
  }

  const consolidations = toConsolidations(agentResult.result, input.inputs)
  await input.deps.writeConsolidatedFile(input.featureKey, consolidations)
  markFeatureKeyDone(input.progress, input.featureKey, consolidations)
  await saveProgress(input.progress)

  return {
    kind: 'consolidated',
    manifest: {
      ...input.consolidatedManifest,
      entries: updateManifestEntries({
        currentEntries: input.consolidatedManifest.entries,
        featureKey: input.featureKey,
        inputs: input.inputs,
        consolidations,
        phase2Version: input.phase2Version,
      }),
    },
  }
}
```

Note: `toConsolidations` is called with `agentResult.result` instead of bare `result`.

Update `logConsolidationResult` — but this doesn't have usage available here. The usage needs to be threaded from `processFeatureKeyGroup`. Update `ConsolidationProcessResult` to carry usage:

```ts
type ConsolidationProcessResult =
  | { readonly kind: 'consolidated'; readonly manifest: ConsolidatedManifest; readonly usage: AgentUsage }
  | { readonly kind: 'failed'; readonly manifest: ConsolidatedManifest; readonly usage: AgentUsage }
  | { readonly kind: 'skipped'; readonly manifest: ConsolidatedManifest }
```

Then update `consolidateFeatureKey` to include usage:

- On `agentResult === null` (failed): `return { kind: 'failed', manifest: input.consolidatedManifest, usage: ??? }` — no usage available since agent returned null
- Actually, the agent now returns `{ items, usage }` even when items is null. Wait, `consolidateWithRetry` returns `null` when items is null. So we lose usage on failure.

Let me simplify: only carry usage on `consolidated`. For `failed`, no usage. For `skipped`, no usage.

```ts
type ConsolidationProcessResult =
  | { readonly kind: 'consolidated'; readonly manifest: ConsolidatedManifest; readonly usage: AgentUsage }
  | { readonly kind: 'failed'; readonly manifest: ConsolidatedManifest }
  | { readonly kind: 'skipped'; readonly manifest: ConsolidatedManifest }
```

In `consolidateFeatureKey`, on success:

```ts
return { kind: 'consolidated', manifest: {...}, usage: agentResult.usage }
```

Update `logConsolidationResult`:

```ts
function logConsolidationResult(deps: Phase2bDeps, result: ConsolidationProcessResult, elapsedMs: number): void {
  switch (result.kind) {
    case 'consolidated':
      deps.log.log(formatPerItemSuffix(result.usage, elapsedMs))
      break
    case 'failed':
      deps.log.log(`(${formatElapsedMs(elapsedMs)}) ✗`)
      break
    case 'skipped':
      deps.log.log('(skipped)')
      break
  }
}
```

Update `processFeatureKeyGroup` to record stats:

```ts
async function processFeatureKeyGroup(
  featureKey: string,
  inputs: readonly ConsolidateBehaviorInput[],
  displayIndex: number,
  displayTotal: number,
  progress: Progress,
  currentManifest: ConsolidatedManifest,
  phase2Version: string,
  deps: Phase2bDeps,
): Promise<ConsolidationProcessResult> {
  deps.writeStdout(`  [${displayIndex}/${displayTotal}] "${featureKey}" `)
  const startMs = performance.now()
  const result = await consolidateFeatureKey({
    progress,
    consolidatedManifest: currentManifest,
    phase2Version,
    featureKey,
    inputs,
    deps,
  })
  const elapsedMs = performance.now() - startMs
  logConsolidationResult(deps, result, elapsedMs)
  if (deps.stats !== undefined) {
    if (result.kind === 'consolidated') {
      recordItemDone(deps.stats, result.usage)
    } else if (result.kind === 'failed') {
      recordItemFailed(deps.stats)
    } else {
      recordItemSkipped(deps.stats)
    }
  }
  return result
}
```

Update `runPhase2b` to create stats and render summary:

```ts
export async function runPhase2b(
  progress: Progress,
  consolidatedManifest: ConsolidatedManifest,
  phase2Version: string,
  selectedFeatureKeys: ReadonlySet<string>,
  manifest: IncrementalManifest,
  deps: Partial<Phase2bDeps> = {},
): Promise<ConsolidatedManifest> {
  const resolvedDeps: Phase2bDeps = { ...defaultPhase2bDeps, ...deps }
  if (resolvedDeps.stats === undefined) {
    resolvedDeps.stats = createPhaseStats()
  }
  const groups = [...(await loadGroupedInputs(manifest, selectedFeatureKeys, resolvedDeps)).entries()]
  progress.phase2b.status = 'in-progress'
  progress.phase2b.stats.featureKeysTotal = groups.length
  resetPhase3(progress)
  await saveProgress(progress)

  const limit = pLimit(1)
  let currentManifest = consolidatedManifest
  await Promise.all(
    groups.map(([featureKey, inputs], index) =>
      limit(async () => {
        const result = await processFeatureKeyGroup(
          featureKey,
          inputs,
          index + 1,
          groups.length,
          progress,
          currentManifest,
          phase2Version,
          resolvedDeps,
        )
        currentManifest = result.manifest
      }),
    ),
  )

  progress.phase2b.status = 'done'
  await saveProgress(progress)
  const wallMs = performance.now() - resolvedDeps.stats.wallStartMs
  const label = `[Phase 2b complete] ${progress.phase2b.stats.featureKeysDone} feature keys consolidated, ${progress.phase2b.stats.featureKeysFailed} failed`
  resolvedDeps.log.log(`\n${formatPhaseSummary(resolvedDeps.stats, wallMs, label)}`)
  return currentManifest
}
```

Import `AgentUsage` for the type in `ConsolidationProcessResult`:

```ts
import type { AgentUsage } from './phase-stats.js'
```

- [ ] **Step 4: Update `tests/scripts/behavior-audit-phase2b.test.ts`**

Add import:

```ts
import type { AgentResult } from '../../scripts/behavior-audit/phase-stats.js'
```

The `consolidateWithRetry` mock returns bare consolidation results. Wrap them in `AgentResult`. Find all mock implementations and wrap:

```ts
consolidateWithRetry: async (...args) => {
  ...
  return { result: [...consolidationItems], usage: { inputTokens: 200, outputTokens: 100, toolCalls: 2, toolNames: ['readFile', 'grep'] } }
}
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/scripts/behavior-audit-phase2b.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/consolidate-agent.ts scripts/behavior-audit/consolidate-helpers.ts scripts/behavior-audit/consolidate.ts tests/scripts/behavior-audit-phase2b.test.ts
git commit -m "feat(behavior-audit): consolidate agent and phase runner use AgentResult, render stats"
```

---

### Task 9: Change `evaluate-agent.ts` + `evaluate.ts` + update phase3 tests

**Files:**

- Modify: `scripts/behavior-audit/evaluate-agent.ts`
- Modify: `scripts/behavior-audit/evaluate.ts`
- Modify: `tests/scripts/behavior-audit-phase3.test.ts`

- [ ] **Step 1: Update `evaluate-agent.ts`**

Add import:

```ts
import { addAgentUsage, type AgentResult, type AgentUsage } from './phase-stats.js'
```

Change `evaluateSingle` to return `{ data, usage }`:

```ts
async function evaluateSingle(
  prompt: string,
  attempt: number,
): Promise<{ data: EvalResult | null; usage: AgentUsage }> {
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, toolNames: [] }
  const timeout = attempt > 0 ? PHASE3_TIMEOUT_MS * 2 : PHASE3_TIMEOUT_MS
  const tools = makeAuditTools()
  const start = Date.now()
  try {
    const result = await verboseGenerateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 16384,
      tools,
      output: Output.object({ schema: EvalResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    usage.inputTokens = result.totalUsage.inputTokens
    usage.outputTokens = result.totalUsage.outputTokens
    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        usage.toolCalls += 1
        usage.toolNames.push(tc.toolName)
      }
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    if (result.output === null) {
      console.log(`✗ null output (${elapsed}s)`)
      return { data: null, usage }
    }
    const parsed = EvalResultSchema.safeParse(result.output)
    if (!parsed.success) {
      console.log(`✗ parse error (${elapsed}s)`)
      return { data: null, usage }
    }
    return { data: parsed.data, usage }
  } catch (error) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`✗ ${error instanceof Error ? error.message : String(error)} (${elapsed}s)`)
    return { data: null, usage }
  }
}
```

Change `retryWithBackoff` to accumulate usage:

```ts
function retryWithBackoff(
  prompt: string,
  attempt: number,
  maxAttempts: number,
  accumulatedUsage: AgentUsage,
): Promise<AgentResult<EvalResult> | null> {
  if (attempt >= maxAttempts) return Promise.resolve(null)
  return evaluateSingle(prompt, attempt).then(({ data, usage }) => {
    const combined = addAgentUsage(accumulatedUsage, usage)
    if (data !== null) return { result: data, usage: combined }
    const backoff = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]!
    return sleep(backoff).then(() => retryWithBackoff(prompt, attempt + 1, maxAttempts, combined))
  })
}
```

Change `evaluateWithRetry`:

```ts
export function evaluateWithRetry(prompt: string): Promise<AgentResult<EvalResult> | null> {
  const emptyUsage: AgentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, toolNames: [] }
  return retryWithBackoff(prompt, 0, MAX_RETRIES, emptyUsage)
}
```

- [ ] **Step 2: Update `evaluate.ts`**

Add imports:

```ts
import {
  type PhaseStats,
  createPhaseStats,
  formatPerItemSuffix,
  formatPhaseSummary,
  recordItemDone,
  recordItemFailed,
  recordItemSkipped,
} from './phase-stats.js'
```

Add optional `stats` to `Phase3Deps`:

```ts
export interface Phase3Deps {
  ...existing fields...
  readonly stats?: PhaseStats
}
```

Update `evaluateBehavior` to unwrap and render:

```ts
async function evaluateBehavior(input: {
  readonly behavior: ParsedBehavior
  readonly idx: number
  readonly total: number
  readonly progress: Progress
  readonly deps: Phase3Deps
}): Promise<EvaluatedFeatureRecord | null> {
  input.deps.writeStdout(`  [${input.idx}/${input.total}] ${input.behavior.domain} :: "${input.behavior.featureName}" `)
  const startMs = performance.now()
  const agentResult = await input.deps.evaluateWithRetry(buildPrompt(input.behavior))
  const elapsedMs = performance.now() - startMs
  if (agentResult === null) {
    input.deps.markBehaviorFailed(input.progress, input.behavior.consolidatedId, 'evaluation failed after retries', 1)
    input.deps.log.log(`(${formatElapsedMs(elapsedMs)}) ✗`)
    if (input.deps.stats !== undefined) recordItemFailed(input.deps.stats)
    return null
  }

  input.deps.markBehaviorDone(input.progress, input.behavior.consolidatedId)
  await input.deps.saveProgress(input.progress)
  input.deps.log.log(formatPerItemSuffix(agentResult.usage, elapsedMs))
  if (input.deps.stats !== undefined) recordItemDone(input.deps.stats, agentResult.usage)
  return {
    consolidatedId: input.behavior.consolidatedId,
    maria: agentResult.result.maria,
    dani: agentResult.result.dani,
    viktor: agentResult.result.viktor,
    flaws: agentResult.result.flaws,
    improvements: agentResult.result.improvements,
    evaluatedAt: new Date().toISOString(),
  }
}
```

Update `runPhase3` to create stats and render summary:

```ts
export async function runPhase3(
  { progress, selectedConsolidatedIds, selectedFeatureKeys = new Set(), consolidatedManifest }: Phase3RunInput,
  deps: Partial<Phase3Deps> = {},
): Promise<ConsolidatedManifest | null> {
  if (consolidatedManifest === null) return null
  const resolvedDeps: Phase3Deps = { ...defaultPhase3Deps, ...deps }
  if (resolvedDeps.stats === undefined) {
    resolvedDeps.stats = createPhaseStats()
  }
  let storedByFeatureKey = await loadStoredFeatureData(consolidatedManifest, resolvedDeps)
  const behaviors = parseBehaviors(consolidatedManifest, storedByFeatureKey)
  progress.phase3.status = 'in-progress'
  progress.phase3.stats.consolidatedIdsTotal = behaviors.length
  await resolvedDeps.saveProgress(progress)
  const collected = await collectNewEvaluations({
    behaviors,
    selection: resolveSelection(selectedConsolidatedIds, selectedFeatureKeys, behaviors),
    progress,
    deps: resolvedDeps,
  })
  await persistEvaluations(collected, storedByFeatureKey, resolvedDeps)
  storedByFeatureKey = await loadStoredFeatureData(consolidatedManifest, resolvedDeps)
  const updatedManifest = updateManifest(consolidatedManifest, storedByFeatureKey)
  await saveConsolidatedManifest(updatedManifest)
  await resolvedDeps.writeReports({
    ...toReportMaps(storedByFeatureKey),
    progress,
  })
  progress.phase3.status = 'done'
  await resolvedDeps.saveProgress(progress)
  const wallMs = performance.now() - resolvedDeps.stats.wallStartMs
  const label = `[Phase 3 complete] ${progress.phase3.stats.consolidatedIdsDone} evaluated, ${progress.phase3.stats.consolidatedIdsFailed} failed`
  resolvedDeps.log.log(`\n${formatPhaseSummary(resolvedDeps.stats, wallMs, label)}`)
  return updatedManifest
}
```

- [ ] **Step 3: Update `tests/scripts/behavior-audit-phase3.test.ts`**

Add import:

```ts
import type { AgentResult } from '../../scripts/behavior-audit/phase-stats.js'
```

Wrap mock `evaluateWithRetry` returns. Where the mock returns `MockEvaluationResult`, wrap it:

```ts
evaluateWithRetry: (_prompt: string) =>
  Promise.resolve({ result: mockEvalResult, usage: { inputTokens: 200, outputTokens: 100, toolCalls: 2, toolNames: ['readFile', 'grep'] } }),
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/scripts/behavior-audit-phase3.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/evaluate-agent.ts scripts/behavior-audit/evaluate.ts tests/scripts/behavior-audit-phase3.test.ts
git commit -m "feat(behavior-audit): evaluate agent and phase runner use AgentResult, render stats"
```

---

### Task 10: Update `scripts/behavior-audit.ts` orchestrator + entrypoint tests

**Files:**

- Modify: `scripts/behavior-audit.ts`
- Modify: `tests/scripts/behavior-audit-entrypoint.test.ts`

- [ ] **Step 1: The orchestrator doesn't need code changes for PhaseStats**

Looking at the orchestrator, it calls `runPhase1`, `runPhase2a`, `runPhase2b`, `runPhase3` via `*IfNeeded` wrappers. Each phase runner now internally creates its own `PhaseStats` if none is provided via deps (because of the `if (resolvedDeps.stats === undefined) resolvedDeps.stats = createPhaseStats()` logic).

The orchestrator doesn't need to create or pass `PhaseStats` — each phase runner handles it internally.

The orchestrator calls through the `BehaviorAuditDeps` which wraps the phase functions. The `runPhase1IfNeeded` etc. don't pass `deps` — they call the real phase functions directly. So each phase will create its own stats.

No changes needed to `scripts/behavior-audit.ts`.

- [ ] **Step 2: Run the entrypoint test**

Run: `bun test tests/scripts/behavior-audit-entrypoint.test.ts`
Expected: PASS (the entrypoint test mocks all phase functions, so it doesn't see the stats changes)

- [ ] **Step 3: Commit if any changes were needed**

```bash
git add scripts/behavior-audit.ts tests/scripts/behavior-audit-entrypoint.test.ts
git commit -m "chore(behavior-audit): verify orchestrator works with stats-enabled phases"
```

(Only if files were actually modified.)

---

### Task 11: Run full test suite and verify

- [ ] **Step 1: Run all behavior-audit tests**

Run: `bun test tests/scripts/behavior-audit-*.test.ts`
Expected: All PASS

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All PASS

- [ ] **Step 3: Run typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 4: Run lint**

Run: `bun lint`
Expected: PASS

- [ ] **Step 5: Run format check**

Run: `bun format:check`
Expected: PASS

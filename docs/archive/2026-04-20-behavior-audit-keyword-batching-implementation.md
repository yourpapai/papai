# Behavior Audit Keyword Batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace domain-grouped Phase 2 consolidation with a vocabulary-aware extraction pipeline and deterministic keyword-primary batching so Phase 3 scores high-quality feature-level user stories.

**Architecture:** Keep the 3-phase audit structure, but change Phase 1 from single-step extraction into extraction plus keyword vocabulary resolution. Phase 2 no longer treats one domain as one consolidation prompt; instead it assigns each extracted behavior one primary keyword, forms smaller keyword-owned candidate pools, allows multiple consolidated features per pool, and preserves provenance for Phase 3 scoring and incremental invalidation.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK (`generateText`, `Output.object`), Zod v4, p-limit, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-04-20-behavior-audit-keyword-batching-design.md`.

**Historical context only:** `docs/superpowers/plans/2026-04-20-behavior-audit-3-phase.md` is superseded and must not be executed as written.

---

## File Structure

### New files

- `scripts/behavior-audit/extract-agent.ts` — structured Phase 1 extraction call that returns `behavior`, `context`, and `candidateKeywords`.
- `scripts/behavior-audit/keyword-resolver-agent.ts` — semantic keyword reuse and new-entry generation against the persistent vocabulary.
- `scripts/behavior-audit/keyword-vocabulary.ts` — load/save/update helpers for `reports/keyword-vocabulary.json`, exact lookup, metadata updates, and narrowed candidate selection seam.

### Modified files

- `scripts/behavior-audit/config.ts` — add `KEYWORD_VOCABULARY_PATH`.
- `scripts/behavior-audit/report-writer.ts` — extend `ExtractedBehavior` with `keywords`, add behavior markdown rendering of keywords, and keep report rebuild helpers working with keyword-bearing extracted behaviors.
- `scripts/behavior-audit/progress.ts` — keep the 3-phase shape but store keyword-bearing extracted behaviors and rename Phase 2 progress internals away from domain-specific names.
- `scripts/behavior-audit/progress-migrate.ts` — treat old Phase 1 extracted data as stale and reset downstream phases for the new Phase 1 contract.
- `scripts/behavior-audit/incremental.ts` — include canonical keywords in Phase 1 fingerprints, add primary-keyword provenance to the consolidated manifest, and update incremental selection helpers for keyword-batch invalidation.
- `scripts/behavior-audit/extract-incremental.ts` — persist manifest entries using the new keyword-bearing extracted shape.
- `scripts/behavior-audit/extract.ts` — replace manual JSON parsing with extractor plus resolver orchestration and atomic per-test persistence.
- `scripts/behavior-audit/consolidate-agent.ts` — replace the domain-only prompt contract with keyword-batch candidate-pool semantics and explicit user-story quality rules.
- `scripts/behavior-audit/consolidate.ts` — replace domain grouping with primary-keyword grouping, add batch splitting, and preserve richer provenance in output entries.
- `scripts/behavior-audit/evaluate.ts` — stop deriving work from `completedDomains`; read all consolidated outputs by batch/domain-safe manifest traversal and keep Phase 3 scoring unchanged in purpose.
- `scripts/behavior-audit.ts` — wire the new vocabulary-aware Phase 1, keyword-aware Phase 2, and revised manifest/report rebuild flow.
- `scripts/behavior-audit-reset.ts` — create the reset helper so it can clear downstream audit artifacts while preserving `reports/keyword-vocabulary.json` for phase-scoped resets.

### Tests

- `tests/scripts/behavior-audit-incremental.test.ts` — update fingerprint and selection coverage for canonical keywords, batch provenance, and rebuild-only behavior.
- `tests/scripts/behavior-audit-integration.test.ts` — cover extractor plus resolver orchestration, cross-domain keyword batches, mixed-batch multi-feature outputs, and Phase 3 readiness.

---

## Decisions Locked Before Implementation

1. `reports/keyword-vocabulary.json` is the canonical persistent vocabulary file for the audit pipeline.
2. Phase 1 emits 8-16 canonical slug keywords per extracted behavior.
3. Keyword reuse versus new slug creation is model-driven in the resolver, but exact slug hits may short-circuit in code.
4. Each extracted behavior gets exactly one `primaryKeyword` for batching.
5. A keyword-owned batch is a candidate pool, not a single-feature guarantee.
6. Phase 2 may emit multiple consolidated features from one keyword-owned batch.
7. User stories are required only for user-facing consolidated outputs.
8. Old extracted Phase 1 data without keywords is stale and must not be reused as-if current.

---

### Task 1: Add keyword vocabulary path and extractor/resolver test scaffolding

**Files:**

- Modify: `scripts/behavior-audit/config.ts`
- Modify: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Add the failing integration test for keyword-bearing Phase 1 extraction**

Edit `tests/scripts/behavior-audit-integration.test.ts` and add a focused Phase 1 orchestration test in the `behavior-audit entrypoint incremental selection` area:

```typescript
test('runPhase1 stores canonical keywords after extraction and vocabulary resolution', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [
      'tests/e2e/',
      'tests/client/',
      'tests/helpers/',
      'tests/scripts/',
      'tests/review-loop/',
      'tests/types/',
    ] as const,
  }))

  void mock.module('../../scripts/behavior-audit/extract-agent.js', () => ({
    extractWithRetry: (): Promise<{
      readonly behavior: string
      readonly context: string
      readonly candidateKeywords: readonly string[]
    }> =>
      Promise.resolve({
        behavior: 'When a user targets a group, the bot routes the request correctly.',
        context: 'Resolves target context and forwards execution through the group routing path.',
        candidateKeywords: ['group-routing', 'group-targeting', 'request-routing'],
      }),
  }))

  void mock.module('../../scripts/behavior-audit/keyword-resolver-agent.js', () => ({
    resolveKeywordsWithRetry: (): Promise<{
      readonly keywords: readonly string[]
      readonly appendedEntries: readonly {
        readonly slug: string
        readonly description: string
        readonly createdAt: string
        readonly updatedAt: string
        readonly timesUsed: number
      }[]
    }> =>
      Promise.resolve({
        keywords: ['group-targeting', 'group-routing'],
        appendedEntries: [],
      }),
  }))

  const extract = await import('../../scripts/behavior-audit/extract.js?test=phase1-keywords')
  const progressModule = await import('../../scripts/behavior-audit/progress.js?test=phase1-keywords')
  const incremental = await import('../../scripts/behavior-audit/incremental.js?test=phase1-keywords')

  const progress = progressModule.createEmptyProgress(1)
  const manifest = incremental.createEmptyManifest()
  const parsed = parseTestFile('tests/tools/sample.test.ts', "describe('suite', () => { test('case', () => {}) })")

  await extract.runPhase1({
    testFiles: [parsed],
    progress,
    selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
    manifest,
  })

  const stored = progress.phase1.extractedBehaviors['tests/tools/sample.test.ts::suite > case']
  expect(stored?.keywords).toEqual(['group-targeting', 'group-routing'])
})
```

- [ ] **Step 2: Run the focused integration test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "runPhase1 stores canonical keywords after extraction and vocabulary resolution"
```

Expected: FAIL because `config.ts` does not expose `KEYWORD_VOCABULARY_PATH`, `ExtractedBehavior` has no `keywords`, and `extract.ts` does not use `extract-agent.js` or `keyword-resolver-agent.js`.

- [ ] **Step 3: Add `KEYWORD_VOCABULARY_PATH` to config**

Edit `scripts/behavior-audit/config.ts` and add the new constant after `CONSOLIDATED_MANIFEST_PATH`:

```typescript
export const KEYWORD_VOCABULARY_PATH = resolve(REPORTS_DIR, 'keyword-vocabulary.json')
```

- [ ] **Step 4: Run typecheck to verify config changes are valid**

Run:

```bash
bun typecheck
```

Expected: FAIL in downstream files still referencing the old Phase 1 extraction contract, but no syntax errors in `config.ts` itself.

- [ ] **Step 5: Commit the config and test scaffold change**

```bash
git add scripts/behavior-audit/config.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "test(audit): add keyword-aware phase1 extraction scaffold"
```

---

### Task 2: Add structured extraction and keyword resolver agents

**Files:**

- Create: `scripts/behavior-audit/extract-agent.ts`
- Create: `scripts/behavior-audit/keyword-resolver-agent.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Add failing tests for extractor and resolver module shapes**

Edit `tests/scripts/behavior-audit-integration.test.ts` and add:

```typescript
test('extract-agent returns behavior, context, and candidateKeywords', async () => {
  const mod: unknown = await import('../../scripts/behavior-audit/extract-agent.js?test=shape')
  expect(typeof mod).toBe('object')
  expect(mod).toHaveProperty('extractWithRetry')
})

test('keyword-resolver-agent returns canonical keywords and appended entries', async () => {
  const mod: unknown = await import('../../scripts/behavior-audit/keyword-resolver-agent.js?test=shape')
  expect(typeof mod).toBe('object')
  expect(mod).toHaveProperty('resolveKeywordsWithRetry')
})
```

- [ ] **Step 2: Run the focused integration test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "extract-agent returns|keyword-resolver-agent returns"
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Create `scripts/behavior-audit/extract-agent.ts`**

Create the file with this initial implementation:

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, Output, stepCountIs } from 'ai'
import { z } from 'zod'

import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE1_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import { makeAuditTools } from './tools.js'

const ExtractionResultSchema = z.object({
  behavior: z.string(),
  context: z.string(),
  candidateKeywords: z.array(z.string()).min(8).max(16),
})

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>

function getEnvOrFallback(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined ? fallback : value
}

const apiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
const provider = createOpenAICompatible({ name: 'behavior-audit-extract', apiKey, baseURL: BASE_URL })
const model = provider(MODEL)

const SYSTEM_PROMPT = `You are a senior software analyst examining a unit test from a Telegram/Discord/Mattermost chat bot called "papai" that manages tasks via LLM tool-calling.

Return structured output with:
- behavior: plain-language feature description beginning with "When..."
- context: technical implementation summary for developers
- candidateKeywords: 8-16 canonical lowercase slug keywords describing the behavior

Keywords must be short canonical slugs like group-targeting or identity-resolution.`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function extractSingle(prompt: string, attempt: number): Promise<ExtractionResult | null> {
  const timeout = attempt > 0 ? PHASE1_TIMEOUT_MS * 2 : PHASE1_TIMEOUT_MS
  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      tools: makeAuditTools(),
      output: Output.object({ schema: ExtractionResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    return result.output
  } catch {
    return null
  }
}

export async function extractWithRetry(prompt: string, attemptOffset: number): Promise<ExtractionResult | null> {
  for (let attempt = attemptOffset; attempt < MAX_RETRIES; attempt++) {
    if (attempt > attemptOffset) {
      const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]!
      await sleep(backoff)
    }
    const result = await extractSingle(prompt, attempt)
    if (result !== null) return result
  }
  return null
}
```

- [ ] **Step 4: Create `scripts/behavior-audit/keyword-resolver-agent.ts`**

Create the file with this initial implementation:

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, Output, stepCountIs } from 'ai'
import { z } from 'zod'

import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE1_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'

const VocabularyEntrySchema = z.object({
  slug: z.string(),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  timesUsed: z.number(),
})

const ResolverResultSchema = z.object({
  keywords: z.array(z.string()).min(1),
  appendedEntries: z.array(VocabularyEntrySchema),
})

export type ResolverResult = z.infer<typeof ResolverResultSchema>

function getEnvOrFallback(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined ? fallback : value
}

const apiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
const provider = createOpenAICompatible({ name: 'behavior-audit-keyword-resolver', apiKey, baseURL: BASE_URL })
const model = provider(MODEL)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function resolveSingle(prompt: string, attempt: number): Promise<ResolverResult | null> {
  const timeout = attempt > 0 ? PHASE1_TIMEOUT_MS * 2 : PHASE1_TIMEOUT_MS
  try {
    const result = await generateText({
      model,
      prompt,
      output: Output.object({ schema: ResolverResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    return result.output
  } catch {
    return null
  }
}

export async function resolveKeywordsWithRetry(prompt: string, attemptOffset: number): Promise<ResolverResult | null> {
  for (let attempt = attemptOffset; attempt < MAX_RETRIES; attempt++) {
    if (attempt > attemptOffset) {
      const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]!
      await sleep(backoff)
    }
    const result = await resolveSingle(prompt, attempt)
    if (result !== null) return result
  }
  return null
}
```

- [ ] **Step 5: Run the focused tests to verify they pass**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "extract-agent returns|keyword-resolver-agent returns"
```

Expected: PASS.

- [ ] **Step 6: Commit the new Phase 1 agents**

```bash
git add scripts/behavior-audit/extract-agent.ts scripts/behavior-audit/keyword-resolver-agent.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): add structured extractor and keyword resolver agents"
```

---

### Task 3: Add keyword vocabulary persistence helpers

**Files:**

- Create: `scripts/behavior-audit/keyword-vocabulary.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Add the failing test for vocabulary load/save/update helpers**

Edit `tests/scripts/behavior-audit-integration.test.ts` and add:

```typescript
test('keyword-vocabulary persists entries and updates usage counts', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: path.join(reportsDir, 'progress.json'),
    INCREMENTAL_MANIFEST_PATH: path.join(reportsDir, 'incremental-manifest.json'),
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

  const vocab = await import('../../scripts/behavior-audit/keyword-vocabulary.js?test=vocab')
  await vocab.saveKeywordVocabulary([
    {
      slug: 'group-targeting',
      description: 'Targeting work at a group context.',
      createdAt: '2026-04-20T12:00:00.000Z',
      updatedAt: '2026-04-20T12:00:00.000Z',
      timesUsed: 1,
    },
  ])

  await vocab.recordKeywordUsage(['group-targeting'])

  const saved = await vocab.loadKeywordVocabulary()
  expect(saved).not.toBeNull()
  expect(saved?.[0]?.timesUsed).toBe(2)
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "keyword-vocabulary persists entries and updates usage counts"
```

Expected: FAIL because `keyword-vocabulary.ts` does not exist.

- [ ] **Step 3: Create `scripts/behavior-audit/keyword-vocabulary.ts`**

Create the file:

```typescript
import { mkdir, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import { KEYWORD_VOCABULARY_PATH } from './config.js'

const KeywordVocabularyEntrySchema = z.object({
  slug: z.string(),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  timesUsed: z.number(),
})

const KeywordVocabularySchema = z.array(KeywordVocabularyEntrySchema)

export type KeywordVocabularyEntry = z.infer<typeof KeywordVocabularyEntrySchema>

export async function loadKeywordVocabulary(): Promise<readonly KeywordVocabularyEntry[] | null> {
  const file = Bun.file(KEYWORD_VOCABULARY_PATH)
  if (!(await file.exists())) return null
  const text = await file.text()
  return KeywordVocabularySchema.parse(JSON.parse(text))
}

export async function saveKeywordVocabulary(entries: readonly KeywordVocabularyEntry[]): Promise<void> {
  const parsed = KeywordVocabularySchema.parse(entries)
  const dir = dirname(KEYWORD_VOCABULARY_PATH)
  const tempPath = join(dir, `.${basename(KEYWORD_VOCABULARY_PATH)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  await mkdir(dir, { recursive: true })
  await Bun.write(tempPath, JSON.stringify(parsed, null, 2) + '\n')
  await rename(tempPath, KEYWORD_VOCABULARY_PATH)
}

export async function recordKeywordUsage(keywords: readonly string[]): Promise<void> {
  const existing = (await loadKeywordVocabulary()) ?? []
  const keywordSet = new Set(keywords)
  const now = new Date().toISOString()
  const updated = existing.map((entry) =>
    keywordSet.has(entry.slug) ? { ...entry, timesUsed: entry.timesUsed + 1, updatedAt: now } : entry,
  )
  await saveKeywordVocabulary(updated)
}

export function findExactKeyword(
  entries: readonly KeywordVocabularyEntry[],
  slug: string,
): KeywordVocabularyEntry | null {
  return entries.find((entry) => entry.slug === slug) ?? null
}
```

- [ ] **Step 4: Run the focused vocabulary test to verify it passes**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "keyword-vocabulary persists entries and updates usage counts"
```

Expected: PASS.

- [ ] **Step 5: Commit the vocabulary helper**

```bash
git add scripts/behavior-audit/keyword-vocabulary.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): add keyword vocabulary persistence helpers"
```

---

### Task 4: Extend extracted behavior, progress migration, and report output for keywords

**Files:**

- Modify: `scripts/behavior-audit/report-writer.ts`
- Modify: `scripts/behavior-audit/progress-migrate.ts`
- Modify: `scripts/behavior-audit/progress.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Add the failing test for keyword-bearing extracted behavior markdown**

Edit `tests/scripts/behavior-audit-integration.test.ts` and add:

```typescript
test('writeBehaviorFile renders canonical keywords for each extracted behavior', async () => {
  const writer = await import('../../scripts/behavior-audit/report-writer.js?test=keywords')
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: path.join(reportsDir, 'progress.json'),
    INCREMENTAL_MANIFEST_PATH: path.join(reportsDir, 'incremental-manifest.json'),
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: path.join(reportsDir, 'keyword-vocabulary.json'),
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

  await writer.writeBehaviorFile('tests/tools/sample.test.ts', [
    {
      testName: 'case',
      fullPath: 'suite > case',
      behavior: 'When a user targets a group, the bot routes the request correctly.',
      context: 'Routes through group context selection.',
      keywords: ['group-targeting', 'group-routing'],
    },
  ])

  const fileText = await Bun.file(path.join(reportsDir, 'behaviors', 'tools', 'sample.test.behaviors.md')).text()
  expect(fileText).toContain('**Keywords:** group-targeting, group-routing')
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "writeBehaviorFile renders canonical keywords for each extracted behavior"
```

Expected: FAIL because `ExtractedBehavior` has no `keywords` and `writeBehaviorFile` does not render them.

- [ ] **Step 3: Extend `ExtractedBehavior` and markdown rendering**

Edit `scripts/behavior-audit/report-writer.ts`:

```typescript
export interface ExtractedBehavior {
  readonly testName: string
  readonly fullPath: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
}
```

And update `writeBehaviorFile`:

```typescript
for (const b of behaviors) {
  lines.push(`## Test: "${b.fullPath}"\n`)
  lines.push(`**Behavior:** ${b.behavior}`)
  lines.push(`**Context:** ${b.context}`)
  lines.push(`**Keywords:** ${b.keywords.join(', ')}\n`)
}
```

- [ ] **Step 4: Reset stale Phase 1 extracted behavior during migration**

Edit `scripts/behavior-audit/progress-migrate.ts` so old extracted behaviors without `keywords` do not survive migration as valid current data:

```typescript
const ExtractedBehaviorSchema = z.object({
  testName: z.string(),
  fullPath: z.string(),
  behavior: z.string(),
  context: z.string(),
  keywords: z.array(z.string()).readonly(),
})
```

And in `migrateV1toV2`, reset Phase 1 extracted progress:

```typescript
return ProgressV2Schema.parse({
  version: 2,
  startedAt,
  phase1: emptyPhase1(),
  phase2: emptyPhase2(),
  phase3: emptyPhase3(),
})
```

- [ ] **Step 5: Run the focused test to verify it passes**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "writeBehaviorFile renders canonical keywords for each extracted behavior"
```

Expected: PASS.

- [ ] **Step 6: Commit the keyword-bearing extracted shape changes**

```bash
git add scripts/behavior-audit/report-writer.ts scripts/behavior-audit/progress-migrate.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): persist canonical keywords in extracted behaviors"
```

---

### Task 5: Replace `extract.ts` with extractor plus resolver orchestration

**Files:**

- Modify: `scripts/behavior-audit/extract.ts`
- Modify: `scripts/behavior-audit/keyword-vocabulary.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Expand the failing integration test to assert vocabulary persistence and atomic writes**

Add this test to `tests/scripts/behavior-audit-integration.test.ts`:

```typescript
test('runPhase1 persists vocabulary updates before marking a test done', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')
  const progressPath = path.join(reportsDir, 'progress.json')
  const manifestPath = path.join(reportsDir, 'incremental-manifest.json')
  const vocabularyPath = path.join(reportsDir, 'keyword-vocabulary.json')

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

  void mock.module('../../scripts/behavior-audit/extract-agent.js', () => ({
    extractWithRetry: (): Promise<{
      readonly behavior: string
      readonly context: string
      readonly candidateKeywords: readonly string[]
    }> =>
      Promise.resolve({
        behavior: 'When a user targets a group, the bot routes the request correctly.',
        context: 'Routes through group context selection.',
        candidateKeywords: ['group-targeting'],
      }),
  }))

  void mock.module('../../scripts/behavior-audit/keyword-resolver-agent.js', () => ({
    resolveKeywordsWithRetry: (): Promise<{
      readonly keywords: readonly string[]
      readonly appendedEntries: readonly {
        readonly slug: string
        readonly description: string
        readonly createdAt: string
        readonly updatedAt: string
        readonly timesUsed: number
      }[]
    }> =>
      Promise.resolve({
        keywords: ['group-targeting'],
        appendedEntries: [
          {
            slug: 'group-targeting',
            description: 'Targeting work at a group context.',
            createdAt: '2026-04-20T12:00:00.000Z',
            updatedAt: '2026-04-20T12:00:00.000Z',
            timesUsed: 1,
          },
        ],
      }),
  }))

  const extract = await import('../../scripts/behavior-audit/extract.js?test=phase1-atomic')
  const progressModule = await import('../../scripts/behavior-audit/progress.js?test=phase1-atomic')
  const incremental = await import('../../scripts/behavior-audit/incremental.js?test=phase1-atomic')

  const progress = progressModule.createEmptyProgress(1)
  const parsed = parseTestFile('tests/tools/sample.test.ts', "describe('suite', () => { test('case', () => {}) })")

  await extract.runPhase1({
    testFiles: [parsed],
    progress,
    selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
    manifest: incremental.createEmptyManifest(),
  })

  const savedVocabulary = JSON.parse(await Bun.file(vocabularyPath).text()) as readonly { readonly slug: string }[]
  expect(savedVocabulary[0]?.slug).toBe('group-targeting')
  expect(
    progress.phase1.completedTests['tests/tools/sample.test.ts']?.['tests/tools/sample.test.ts::suite > case'],
  ).toBe('done')
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "runPhase1 persists vocabulary updates before marking a test done"
```

Expected: FAIL because `extract.ts` still uses inline JSON extraction and has no vocabulary persistence.

- [ ] **Step 3: Replace inline extraction with extractor plus resolver orchestration**

Edit `scripts/behavior-audit/extract.ts` with these structural changes:

```typescript
import { extractWithRetry } from './extract-agent.js'
import { resolveKeywordsWithRetry } from './keyword-resolver-agent.js'
import { loadKeywordVocabulary, recordKeywordUsage, saveKeywordVocabulary } from './keyword-vocabulary.js'
```

Remove the old inline OpenAI client, manual JSON parsing helpers, and retry logic. Add:

```typescript
function buildExtractionPrompt(testCase: TestCase, testFilePath: string): string {
  const implPath = deriveImplPath(testFilePath)
  return `**Test file:** ${testFilePath}\n**Test name:** ${testCase.fullPath}\n**Likely implementation file:** ${implPath}\n\n\`\`\`typescript\n${testCase.source}\n\`\`\``
}

function buildResolverPrompt(candidateKeywords: readonly string[], vocabularyText: string): string {
  return [
    'Resolve the candidate keywords against the existing vocabulary.',
    'Reuse existing slugs when semantically appropriate.',
    'Append new entries only when no vocabulary slug adequately fits.',
    '',
    `Candidate keywords: ${candidateKeywords.join(', ')}`,
    '',
    'Existing vocabulary:',
    vocabularyText,
  ].join('\n')
}
```

And in `processSingleTestCase`, replace the extraction block with:

```typescript
const extracted = await extractWithRetry(buildExtractionPrompt(testCase, testFilePath), 0)
if (extracted === null) {
  markTestFailed(progress, testKey, 'extraction failed')
  return null
}

const existingVocabulary = (await loadKeywordVocabulary()) ?? []
const vocabularyText = existingVocabulary.length === 0 ? '(empty)' : JSON.stringify(existingVocabulary, null, 2)
const resolved = await resolveKeywordsWithRetry(buildResolverPrompt(extracted.candidateKeywords, vocabularyText), 0)
if (resolved === null) {
  markTestFailed(progress, testKey, 'keyword resolution failed')
  return null
}

const nextVocabulary = [...existingVocabulary, ...resolved.appendedEntries]
await saveKeywordVocabulary(nextVocabulary)
await recordKeywordUsage(resolved.keywords)

const behavior: ExtractedBehavior = {
  testName: testCase.name,
  fullPath: testCase.fullPath,
  behavior: extracted.behavior,
  context: extracted.context,
  keywords: resolved.keywords,
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "runPhase1 persists vocabulary updates before marking a test done"
```

Expected: PASS.

- [ ] **Step 5: Commit the new Phase 1 orchestration**

```bash
git add scripts/behavior-audit/extract.ts scripts/behavior-audit/keyword-vocabulary.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): resolve canonical keywords during phase1 extraction"
```

---

### Task 6: Add keyword-aware fingerprints and manifest provenance

**Files:**

- Modify: `scripts/behavior-audit/incremental.ts`
- Modify: `scripts/behavior-audit/extract-incremental.ts`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`

- [ ] **Step 1: Add the failing fingerprint regression test for keyword changes**

Edit `tests/scripts/behavior-audit-incremental.test.ts` and add:

```typescript
test('buildPhase2Fingerprint changes when canonical keywords change', async () => {
  const incremental = await loadIncrementalModule()

  const a = incremental.buildPhase2Fingerprint({
    testKey: 'tests/tools/a.test.ts::suite > case',
    behavior: 'When the user creates a task, the bot saves it.',
    context: 'Calls createTask and persists provider output.',
    keywords: ['task-create', 'task-save'],
    phaseVersion: 'v1',
  })
  const b = incremental.buildPhase2Fingerprint({
    testKey: 'tests/tools/a.test.ts::suite > case',
    behavior: 'When the user creates a task, the bot saves it.',
    context: 'Calls createTask and persists provider output.',
    keywords: ['task-create', 'task-persist'],
    phaseVersion: 'v1',
  })

  expect(a).not.toBe(b)
})
```

- [ ] **Step 2: Run the incremental test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-incremental.test.ts --test-name-pattern "buildPhase2Fingerprint changes when canonical keywords change"
```

Expected: FAIL because `buildPhase2Fingerprint` does not accept `keywords`.

- [ ] **Step 3: Extend the fingerprint input and consolidated manifest provenance**

Edit `scripts/behavior-audit/incremental.ts`:

```typescript
interface Phase2FingerprintInput {
  readonly testKey: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly phaseVersion: string
}
```

And extend `ConsolidatedManifestEntry`:

```typescript
export interface ConsolidatedManifestEntry {
  readonly consolidatedId: string
  readonly domain: string
  readonly featureName: string
  readonly sourceTestKeys: readonly string[]
  readonly isUserFacing: boolean
  readonly primaryKeyword: string | null
  readonly keywords: readonly string[]
  readonly sourceDomains: readonly string[]
  readonly phase2Fingerprint: string | null
  readonly lastConsolidatedAt: string | null
}
```

Update the Zod schema to match those new fields.

- [ ] **Step 4: Update `extract-incremental.ts` to pass canonical keywords into the fingerprint**

Edit the `buildPhase2Fingerprint` call in `scripts/behavior-audit/extract-incremental.ts`:

```typescript
const phase2Fingerprint = buildPhase2Fingerprint({
  testKey,
  behavior: extractedBehavior.behavior,
  context: extractedBehavior.context,
  keywords: extractedBehavior.keywords,
  phaseVersion: manifest.phaseVersions.phase2,
})
```

- [ ] **Step 5: Run the focused incremental test to verify it passes**

Run:

```bash
bun test ./tests/scripts/behavior-audit-incremental.test.ts --test-name-pattern "buildPhase2Fingerprint changes when canonical keywords change"
```

Expected: PASS.

- [ ] **Step 6: Commit the keyword-aware fingerprint changes**

```bash
git add scripts/behavior-audit/incremental.ts scripts/behavior-audit/extract-incremental.ts tests/scripts/behavior-audit-incremental.test.ts
git commit -m "feat(audit): include canonical keywords in audit fingerprints"
```

---

### Task 7: Redesign Phase 2 prompt contract for feature-level story quality

**Files:**

- Modify: `scripts/behavior-audit/consolidate-agent.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Add the failing integration test for mixed-batch multi-feature outputs**

Edit `tests/scripts/behavior-audit-integration.test.ts` and add:

```typescript
test('consolidate-agent prompt contract treats a keyword batch as a candidate pool rather than one feature', async () => {
  const source = await Bun.file(path.join(process.cwd(), 'scripts/behavior-audit/consolidate-agent.ts')).text()
  expect(source).toContain('candidate pool')
  expect(source).toContain('must not force one output per batch or one output per keyword')
})
```

- [ ] **Step 2: Run the focused integration test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "consolidate-agent prompt contract treats a keyword batch as a candidate pool rather than one feature"
```

Expected: FAIL because the current prompt is domain-based and does not include the new user-story quality rules.

- [ ] **Step 3: Update `ConsolidateBehaviorInput` and the system prompt**

Edit `scripts/behavior-audit/consolidate-agent.ts`:

```typescript
export interface ConsolidateBehaviorInput {
  readonly testKey: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly primaryKeyword: string
  readonly domain: string
}
```

Replace the `SYSTEM_PROMPT` with:

```typescript
const SYSTEM_PROMPT = `You are a senior software analyst reviewing extracted test behaviors from a Telegram/Discord/Mattermost chat bot called "papai".

The batch you receive is a candidate pool formed for context-size control and candidate similarity. It is not guaranteed to describe only one feature.

You must:
1. classify each consolidation as user-facing or internal
2. merge only behaviors that describe the same user-facing capability
3. never force one output per batch or one output per keyword
4. emit multiple consolidated outputs when the batch contains multiple distinct features
5. generate user stories only for user-facing consolidated features
6. keep internal-only consolidations separate and use userStory: null for them

Every user story must be feature-level, user-observable, complete in actor/action/benefit, and free of test names, function names, and implementation jargon.`
```

Update `buildPrompt`:

```typescript
function buildPrompt(primaryKeyword: string, behaviors: readonly ConsolidateBehaviorInput[]): string {
  const behaviorList = behaviors
    .map(
      (b, i) =>
        `${i + 1}. TestKey: "${b.testKey}"\n   Domain: ${b.domain}\n   Primary keyword: ${b.primaryKeyword}\n   Keywords: ${b.keywords.join(', ')}\n   Behavior: ${b.behavior}\n   Context: ${b.context}`,
    )
    .join('\n\n')
  return `Primary keyword: ${primaryKeyword}\n\nCandidate behavior pool:\n\n${behaviorList}`
}
```

- [ ] **Step 4: Run the focused prompt-contract test to verify it passes**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "consolidate-agent prompt contract treats a keyword batch as a candidate pool rather than one feature"
```

Expected: PASS.

- [ ] **Step 5: Commit the Phase 2 prompt redesign**

```bash
git add scripts/behavior-audit/consolidate-agent.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): enforce feature-level story quality in phase2 prompt"
```

---

### Task 8: Replace domain grouping in Phase 2 with primary-keyword batching

**Files:**

- Modify: `scripts/behavior-audit/consolidate.ts`
- Modify: `scripts/behavior-audit/progress.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Add the failing integration test for cross-domain keyword batching**

Edit `tests/scripts/behavior-audit-integration.test.ts` and add:

```typescript
test('runPhase2 groups cross-domain behaviors by primary keyword and preserves provenance', async () => {
  const consolidate = await import('../../scripts/behavior-audit/consolidate.js?test=keyword-batches')
  const progress = createEmptyProgress(2)

  progress.phase1.extractedBehaviors['tests/tools/a.test.ts::suite > case'] = {
    testName: 'case',
    fullPath: 'suite > case',
    behavior: 'When a user targets a group, the bot routes the request correctly.',
    context: 'Routes through group context selection.',
    keywords: ['group-targeting', 'group-routing'],
  }
  progress.phase1.extractedBehaviors['tests/commands/b.test.ts::suite > case'] = {
    testName: 'case',
    fullPath: 'suite > case',
    behavior: 'When a user configures a group action, the bot applies the group target.',
    context: 'Resolves group target before command execution.',
    keywords: ['group-targeting', 'command-routing'],
  }

  const manifest = { version: 1, entries: {} }
  const result = await consolidate.runPhase2(progress, manifest, 'phase2-v1')

  expect(Object.keys(result.entries).length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run the focused integration test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "runPhase2 groups cross-domain behaviors by primary keyword and preserves provenance"
```

Expected: FAIL because `consolidate.ts` still groups only by domain.

- [ ] **Step 3: Rename Phase 2 progress internals away from domain-only terminology**

Edit `scripts/behavior-audit/progress.ts`:

```typescript
export interface Phase2Progress {
  status: PhaseStatus
  completedBatches: Record<string, 'done'>
  consolidations: Record<string, readonly ConsolidatedBehavior[]>
  failedBatches: Record<string, FailedEntry>
  stats: { batchesTotal: number; batchesDone: number; batchesFailed: number; behaviorsConsolidated: number }
}
```

Update helper names accordingly:

```typescript
export function isBatchCompleted(progress: Progress, batchKey: string): boolean {
  return progress.phase2.completedBatches[batchKey] === 'done'
}
```

Rename `markDomainDone`, `markDomainFailed`, and `getFailedDomainAttempts` to `markBatchDone`, `markBatchFailed`, and `getFailedBatchAttempts`, and update them to read and write `completedBatches`, `failedBatches`, and batch-based stats.

- [ ] **Step 4: Replace domain grouping with primary-keyword grouping in `consolidate.ts`**

Edit `scripts/behavior-audit/consolidate.ts` with these structural changes:

```typescript
interface KeywordBatch {
  readonly batchKey: string
  readonly primaryKeyword: string
  readonly inputs: readonly ConsolidateBehaviorInput[]
}

function getPrimaryKeyword(keywords: readonly string[], cardinality: ReadonlyMap<string, number>): string {
  return [...keywords].toSorted((a, b) => {
    const countA = cardinality.get(a) ?? Number.MAX_SAFE_INTEGER
    const countB = cardinality.get(b) ?? Number.MAX_SAFE_INTEGER
    return countA === countB ? a.localeCompare(b) : countA - countB
  })[0]!
}

function groupByPrimaryKeyword(
  extractedBehaviors: Readonly<Record<string, ExtractedBehavior>>,
): readonly KeywordBatch[] {
  const keywordCounts = new Map<string, number>()
  for (const behavior of Object.values(extractedBehaviors)) {
    for (const keyword of behavior.keywords) {
      keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1)
    }
  }

  const grouped = new Map<string, ConsolidateBehaviorInput[]>()
  for (const [testKey, behavior] of Object.entries(extractedBehaviors)) {
    const primaryKeyword = getPrimaryKeyword(behavior.keywords, keywordCounts)
    const batchKey = primaryKeyword
    const existing = grouped.get(batchKey) ?? []
    grouped.set(batchKey, [
      ...existing,
      {
        testKey,
        behavior: behavior.behavior,
        context: behavior.context,
        keywords: behavior.keywords,
        primaryKeyword,
        domain: getDomain(behavior.fullPath),
      },
    ])
  }

  return [...grouped.entries()].map(([batchKey, inputs]) => ({ batchKey, primaryKeyword: batchKey, inputs }))
}
```

Then update `runPhase2` to call `groupByPrimaryKeyword(...)`, use `completedBatches`, and pass `primaryKeyword` into `consolidateWithRetry`.

- [ ] **Step 5: Run the focused cross-domain batching test to verify it passes**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "runPhase2 groups cross-domain behaviors by primary keyword and preserves provenance"
```

Expected: PASS.

- [ ] **Step 6: Commit the keyword-batching Phase 2 rewrite**

```bash
git add scripts/behavior-audit/consolidate.ts scripts/behavior-audit/progress.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): batch phase2 consolidation by primary keyword"
```

---

### Task 9: Preserve richer consolidated provenance and adapt Phase 3 input traversal

**Files:**

- Modify: `scripts/behavior-audit/consolidate.ts`
- Modify: `scripts/behavior-audit/evaluate.ts`
- Modify: `scripts/behavior-audit/report-writer.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Add the failing integration test for mixed keyword batches producing multiple stories**

Edit `tests/scripts/behavior-audit-integration.test.ts` and add:

```typescript
test('phase2 can emit multiple feature-level stories from one keyword-owned batch', async () => {
  const consolidate = await import('../../scripts/behavior-audit/consolidate.js?test=multi-story')
  const progress = createEmptyProgress(2)

  progress.phase1.extractedBehaviors['tests/tools/a.test.ts::suite > one'] = {
    testName: 'one',
    fullPath: 'suite > one',
    behavior: 'When a user targets a group, the bot routes the request correctly.',
    context: 'Routes through group context selection.',
    keywords: ['group-targeting', 'group-routing'],
  }
  progress.phase1.extractedBehaviors['tests/tools/a.test.ts::suite > two'] = {
    testName: 'two',
    fullPath: 'suite > two',
    behavior: 'When a user manages group access, the bot shows authorization state.',
    context: 'Reads group authorization records and formats output.',
    keywords: ['group-targeting', 'group-authorization'],
  }

  const manifest = { version: 1, entries: {} }
  const result = await consolidate.runPhase2(progress, manifest, 'phase2-v1')
  expect(Object.keys(result.entries).length).toBeGreaterThan(1)
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "phase2 can emit multiple feature-level stories from one keyword-owned batch"
```

Expected: FAIL because the current provenance storage and evaluation traversal still assume domain-centric files.

- [ ] **Step 3: Preserve richer provenance when saving consolidations**

Edit `scripts/behavior-audit/consolidate.ts` when building `updatedEntries`:

```typescript
updatedEntries[cb.id] = {
  consolidatedId: cb.id,
  domain: cb.domain,
  featureName: cb.featureName,
  sourceTestKeys: cb.sourceTestKeys,
  isUserFacing: cb.isUserFacing,
  primaryKeyword: group.primaryKeyword,
  keywords: [...new Set(group.inputs.flatMap((input) => input.keywords))].toSorted(),
  sourceDomains: [...new Set(group.inputs.map((input) => input.domain))].toSorted(),
  phase2Fingerprint: fingerprint,
  lastConsolidatedAt: new Date().toISOString(),
}
```

- [ ] **Step 4: Adapt `evaluate.ts` to traverse consolidated entries from the manifest rather than `completedDomains`**

Edit `scripts/behavior-audit/evaluate.ts` so `runPhase3` derives its readable consolidated inputs by walking the consolidated manifest entries grouped by `entry.domain`, not `Object.keys(progress.phase2.completedDomains)`.

Use this helper shape:

```typescript
function getDomainsFromManifestEntries(
  entries: Readonly<Record<string, import('./incremental.js').ConsolidatedManifestEntry>>,
): readonly string[] {
  return [...new Set(Object.values(entries).map((entry) => entry.domain))].toSorted()
}
```

Replace the existing Phase 3 input shape and domain lookup with:

```typescript
import type { ConsolidatedManifest } from './incremental.js'

interface Phase3RunInput {
  readonly progress: Progress
  readonly selectedConsolidatedIds: ReadonlySet<string>
  readonly consolidatedManifest: ConsolidatedManifest | null
}

function getDomainsFromManifestEntries(
  entries: Readonly<Record<string, import('./incremental.js').ConsolidatedManifestEntry>>,
): readonly string[] {
  return [...new Set(Object.values(entries).map((entry) => entry.domain))].toSorted()
}

export async function runPhase3({
  progress,
  selectedConsolidatedIds,
  consolidatedManifest,
}: Phase3RunInput): Promise<void> {
  console.log('\n[Phase 3] Reading consolidated behavior files...')
  const domains = consolidatedManifest === null ? [] : getDomainsFromManifestEntries(consolidatedManifest.entries)
  const allBehaviors = await parseConsolidatedFiles(domains)
  progress.phase3.status = 'in-progress'
  progress.phase3.stats.behaviorsTotal = allBehaviors.length
  await saveProgress(progress)
  console.log(`[Phase 3] Scoring ${allBehaviors.length} user-facing behaviors...\n`)
  // keep the existing evaluation loop unchanged below this point
}
```

- [ ] **Step 5: Run the focused mixed-batch test to verify it passes**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "phase2 can emit multiple feature-level stories from one keyword-owned batch"
```

Expected: PASS.

- [ ] **Step 6: Commit the richer provenance and Phase 3 traversal update**

```bash
git add scripts/behavior-audit/consolidate.ts scripts/behavior-audit/evaluate.ts scripts/behavior-audit/report-writer.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): preserve keyword batch provenance for phase3"
```

---

### Task 10: Update entrypoint handoff and add reset helper

**Files:**

- Modify: `scripts/behavior-audit.ts`
- Create: `scripts/behavior-audit-reset.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Add the failing tests for entrypoint handoff and reset compatibility**

Add to `tests/scripts/behavior-audit-integration.test.ts`:

```typescript
test('main passes the consolidated manifest through to phase3 after phase2 completes', async () => {
  await initializeGitRepo(root)

  const consolidatedManifest = {
    version: 1,
    entries: {
      'tools::selected-case': {
        consolidatedId: 'tools::selected-case',
        domain: 'tools',
        featureName: 'Selected case',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > first case'],
        isUserFacing: true,
        primaryKeyword: 'group-targeting',
        keywords: ['group-targeting'],
        sourceDomains: ['tools'],
        phase2Fingerprint: 'phase2-fp',
        lastConsolidatedAt: '2026-04-20T12:00:00.000Z',
      },
    },
  }

  let phase3ManifestArg: typeof consolidatedManifest | null = null

  void mock.module('../../scripts/behavior-audit/consolidate.js', () => ({
    runPhase2: async (): Promise<typeof consolidatedManifest> => consolidatedManifest,
  }))
  void mock.module('../../scripts/behavior-audit/evaluate.js', () => ({
    runPhase3: (input: {
      readonly progress: Progress
      readonly selectedConsolidatedIds: ReadonlySet<string>
      readonly consolidatedManifest: typeof consolidatedManifest
    }): Promise<void> => {
      phase3ManifestArg = input.consolidatedManifest
      return Promise.resolve()
    },
  }))

  await loadBehaviorAuditEntryPoint(crypto.randomUUID())

  expect(phase3ManifestArg).toEqual(consolidatedManifest)
})

test('behavior-audit-reset phase2 clears downstream state without deleting keyword vocabulary', async () => {
  const root = makeTempDir()
  const reportsDir = path.join(root, 'reports')

  await Bun.write(
    path.join(reportsDir, 'keyword-vocabulary.json'),
    JSON.stringify([
      {
        slug: 'group-targeting',
        description: 'Targeting work at a group context.',
        createdAt: '2026-04-20T12:00:00.000Z',
        updatedAt: '2026-04-20T12:00:00.000Z',
        timesUsed: 1,
      },
    ]),
  )
  await Bun.write(path.join(reportsDir, 'consolidated', 'tools.md'), '# consolidated')
  await Bun.write(path.join(reportsDir, 'stories', 'tools.md'), '# stories')

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: reportsDir,
    BEHAVIORS_DIR: path.join(reportsDir, 'behaviors'),
    CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
    STORIES_DIR: path.join(reportsDir, 'stories'),
    PROGRESS_PATH: path.join(reportsDir, 'progress.json'),
    INCREMENTAL_MANIFEST_PATH: path.join(reportsDir, 'incremental-manifest.json'),
    CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: path.join(reportsDir, 'keyword-vocabulary.json'),
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

  const reset = await import('../../scripts/behavior-audit-reset.js?test=phase2-reset')
  await reset.resetBehaviorAudit('phase2')

  expect(await Bun.file(path.join(reportsDir, 'keyword-vocabulary.json')).exists()).toBe(true)
  expect(await Bun.file(path.join(reportsDir, 'consolidated', 'tools.md')).exists()).toBe(false)
  expect(await Bun.file(path.join(reportsDir, 'stories', 'tools.md')).exists()).toBe(false)
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "main passes the consolidated manifest through to phase3 after phase2 completes|behavior-audit-reset phase2 clears downstream state without deleting keyword vocabulary"
```

Expected: FAIL because `scripts/behavior-audit.ts` does not pass the consolidated manifest into `runPhase3`, and `scripts/behavior-audit-reset.ts` does not exist yet.

- [ ] **Step 3: Update entrypoint handoff to Phase 3**

Edit `scripts/behavior-audit.ts` so the entrypoint forwards the manifest returned by Phase 2 into Phase 3:

```typescript
async function runPhase3IfNeeded(
  progress: Progress,
  selectedConsolidatedIds: ReadonlySet<string>,
  consolidatedManifest: import('./behavior-audit/incremental.js').ConsolidatedManifest | null,
): Promise<void> {
  if (progress.phase3.status === 'done') {
    console.log('[Phase 3] Already complete.\n')
    return
  }
  await runPhase3({ progress, selectedConsolidatedIds, consolidatedManifest })
}
```

And in `main()` replace the Phase 3 call site with:

```typescript
const phase2Version = updatedManifest.phaseVersions.phase2
const consolidatedManifest = await runPhase2IfNeeded(progress, phase2Version)
await saveConsolidatedManifest(consolidatedManifest)

await runPhase3IfNeeded(progress, new Set(selection.phase3SelectedConsolidatedIds), consolidatedManifest)
```

- [ ] **Step 4: Create `scripts/behavior-audit-reset.ts`**

Create the reset helper with this implementation:

```typescript
import { rm } from 'node:fs/promises'

import { CONSOLIDATED_DIR, CONSOLIDATED_MANIFEST_PATH, REPORTS_DIR, STORIES_DIR } from './behavior-audit/config.js'
import { loadProgress, resetPhase2AndPhase3, resetPhase3, saveProgress } from './behavior-audit/progress.js'

export type ResetTarget = 'phase2' | 'phase3' | 'all'

export async function resetBehaviorAudit(target: ResetTarget): Promise<void> {
  if (target === 'all') {
    await rm(REPORTS_DIR, { recursive: true, force: true })
    return
  }

  if (target === 'phase2') {
    await rm(CONSOLIDATED_DIR, { recursive: true, force: true })
    await rm(STORIES_DIR, { recursive: true, force: true })
    await rm(CONSOLIDATED_MANIFEST_PATH, { force: true })

    const progress = await loadProgress()
    if (progress !== null) {
      resetPhase2AndPhase3(progress)
      await saveProgress(progress)
    }
    return
  }

  await rm(STORIES_DIR, { recursive: true, force: true })

  const progress = await loadProgress()
  if (progress !== null) {
    resetPhase3(progress)
    await saveProgress(progress)
  }
}

const target = process.argv[2]

if (target === 'phase2' || target === 'phase3' || target === 'all') {
  await resetBehaviorAudit(target)
} else if (target !== undefined) {
  console.error('Usage: bun scripts/behavior-audit-reset.ts <phase2|phase3|all>')
  process.exit(1)
}
```

And `all` reset removes the whole `reports/` tree, including the vocabulary file.

- [ ] **Step 5: Run the focused reset and selection tests to verify they pass**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "main passes the consolidated manifest through to phase3 after phase2 completes|behavior-audit-reset phase2 clears downstream state without deleting keyword vocabulary"
```

Expected: PASS.

- [ ] **Step 6: Commit the entrypoint and reset changes**

```bash
git add scripts/behavior-audit.ts scripts/behavior-audit-reset.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): wire keyword batching through entrypoint and reset flow"
```

---

### Task 11: Run full audit verification and fix any remaining gaps

**Files:**

- Modify: any files above as required by final verification

- [ ] **Step 1: Run the focused audit script test suite**

Run:

```bash
bun test ./tests/scripts/behavior-audit-incremental.test.ts
bun test ./tests/scripts/behavior-audit-integration.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun typecheck
```

Expected: PASS.

- [ ] **Step 3: Run format and lint checks if available in this worktree**

Run:

```bash
bun format:check
bun lint
```

Expected: PASS. If `bun lint` cannot run because dependencies are missing in the current worktree, document the exact failure in the execution summary instead of claiming lint is clean.

- [ ] **Step 4: Run the keyword-batching smoke flow**

Run:

```bash
bun scripts/behavior-audit-reset.ts all
bun audit:behavior
```

Expected:

```text
[Phase 1] ...
[Phase 2] ... primary keyword ...
[Phase 2 complete] ...
[Phase 3] ...
[Phase 3 complete] ...
```

And verify:

- `reports/keyword-vocabulary.json` exists
- extracted behavior markdown includes keywords
- consolidated outputs contain user-facing entries with feature-level stories

- [ ] **Step 5: Commit final verification fixes**

```bash
git add scripts/behavior-audit.ts scripts/behavior-audit scripts/behavior-audit-reset.ts tests/scripts/behavior-audit-incremental.test.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): complete keyword-batched behavior audit pipeline"
```

---

## Spec Coverage Check

- Phase 1 two-step extraction plus vocabulary resolution: Tasks 1, 2, 3, 5.
- Persistent vocabulary artifact and append behavior: Tasks 1, 3, 5.
- Keyword-bearing extracted behavior shape: Tasks 4 and 5.
- Primary-keyword batching and cross-domain grouping: Task 8.
- Feature-level story quality constraints for Phase 3 readiness: Tasks 7, 8, 9.
- Incremental invalidation with keywords and batch provenance: Tasks 6 and 9.
- Migration/reset handling for stale old Phase 1 data: Tasks 4 and 10.
- Verification and smoke coverage: Task 11.

## Self-Review Notes

- This plan intentionally replaces the superseded domain-grouped Phase 2 tasks instead of modifying them in place.
- The plan keeps the already-landed 3-phase shape but rewrites the assumptions that no longer match the approved spec.
- The plan is staged so each commit leaves the audit pipeline in a testable intermediate state.

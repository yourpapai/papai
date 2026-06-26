<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Recall Cascade & Promotion Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the provisional memory captured in Plan 1 user-visible and self-improving: a `recall` tool with a server-side 3-layer cascade (current-thread → group long-term → sibling-thread), and a hybrid promotion engine that elevates a provisional fact to durable group memory once it appears in ≥3 threads and a SMALL_MODEL confirms it is general.

**Architecture:** Builds entirely on Plan 1 primitives (`listProvisionalRecords`, `rankRecordsBySimilarity`, `cosineSimilarity`, the `cross_thread_memory` flag, populated embeddings). The cascade composes FTS (`searchMemoryRecords`) and semantic ranking; promotion clusters provisional rows across threads by embedding similarity, counts distinct threads, asks a cheap SMALL_MODEL yes/no, then flips the kept row to `active` (in-place status transition) and archives duplicates. Promotion runs as a background side-effect of reaching cascade layer 3, plus a deterministic scheduler sweep backstop. All behind `cross_thread_memory` (default OFF ⇒ `recall` degrades to layer-2 keyword search, identical to today's `search_memory`).

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Drizzle ORM over `bun:sqlite`, Zod v4, Vercel AI SDK (`generateText`). Tests: `bun run test`, DI-first per `tests/CLAUDE.md`.

**Depends on:** Plan 1 (`docs/superpowers/plans/2026-06-16-memory-foundation.md`) — must be merged first.

**Reference spec:** `docs/superpowers/specs/2026-06-16-cross-thread-memory-and-context-scope-design.md` §4.4–§4.7.

---

## Constants

| Name                              | Value              | Where                                    |
| --------------------------------- | ------------------ | ---------------------------------------- |
| `MEMORY_PROMOTION_MIN_THREADS`    | 3                  | `src/long-term-memory/promotion.ts`      |
| `RECALL_SIMILARITY_THRESHOLD` (τ) | 0.65               | `src/long-term-memory/recall-ranking.ts` |
| `RECALL_DEFAULT_LIMIT`            | 8                  | `src/long-term-memory/recall-cascade.ts` |
| `PROMOTION_REJECT_COOLDOWN_MS`    | 604800000 (7 days) | `src/long-term-memory/promotion.ts`      |

---

## File Structure

| File                                              | Responsibility                                                 | Change |
| ------------------------------------------------- | -------------------------------------------------------------- | ------ |
| `src/long-term-memory/types.ts`                   | `evidence.promotionRejectedAt`                                 | Modify |
| `src/long-term-memory/store.ts`                   | `promoteProvisionalToActive`, `markPromotionRejected`          | Modify |
| `src/long-term-memory/recall-ranking.ts`          | Rank an in-memory record list by query (semantic/keyword)      | Create |
| `src/long-term-memory/recall-cascade.ts`          | `runRecallCascade` — layers 1→2→3 + provenance                 | Create |
| `src/long-term-memory/promotion.ts`               | `evaluatePromotion`, `confirmDurableFact`, cluster + threshold | Create |
| `src/long-term-memory/promotion-sweep.ts`         | `sweepPromotions` — deterministic backstop                     | Create |
| `src/tools/recall.ts`                             | `makeRecallMemoryTool`                                         | Create |
| `src/tools/provider-independent-tools-builder.ts` | Register `recall` (normal mode, flag-gated)                    | Modify |
| `src/system-prompt.ts`                            | `MEMORY_RECALL` fragment                                       | Modify |
| `src/scheduler-instance.ts`                       | Register promotion sweep                                       | Modify |

---

## Task 1: Store mutations for promotion

**Files:**

- Modify: `src/long-term-memory/types.ts` (add `promotionRejectedAt` to `MemoryEvidence`)
- Modify: `src/long-term-memory/store.ts`
- Test: `tests/long-term-memory/promotion-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/long-term-memory/promotion-store.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { setupTestDb } from '../utils/test-helpers.js'
import {
  saveMemoryRecord,
  listMemoryRecords,
  promoteProvisionalToActive,
  markPromotionRejected,
} from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'

const prov = (id: string, thread: string): MemoryRecordInput => ({
  id,
  scopeId: 'g',
  scopeType: 'group',
  kind: 'fact',
  content: 'Deploys on Fridays.',
  summary: null,
  tags: [],
  confidence: 0.5,
  status: 'provisional',
  source: 'background',
  evidence: { threads: [thread] },
  threadContextId: thread,
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
})

describe('promotion store mutations', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('promoteProvisionalToActive flips status, clears thread, merges threads', () => {
    saveMemoryRecord(prov('m1', 't-a'))
    const out = promoteProvisionalToActive(
      { scopeId: 'g', scopeType: 'group' },
      'm1',
      ['t-a', 't-b', 't-c'],
      '2026-06-16T00:00:00.000Z',
    )
    expect(out?.status).toBe('active')
    expect(out?.threadContextId).toBeNull()
    expect(out?.evidence.threads).toEqual(['t-a', 't-b', 't-c'])
    expect(listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'active' })).toHaveLength(1)
  })

  test('markPromotionRejected records a cooldown timestamp in evidence', () => {
    saveMemoryRecord(prov('m1', 't-a'))
    markPromotionRejected({ scopeId: 'g', scopeType: 'group' }, 'm1', '2026-06-16T00:00:00.000Z')
    const [row] = listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'provisional' })
    expect(row?.evidence.promotionRejectedAt).toBe('2026-06-16T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/promotion-store.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Extend the evidence type**

In `src/long-term-memory/types.ts`, add `promotionRejectedAt?: string` to `MemoryEvidence`:

```typescript
export type MemoryEvidence = Readonly<{
  messageIds?: readonly string[]
  actorIds?: readonly string[]
  timestamps?: readonly string[]
  contextId?: string
  threads?: readonly string[]
  promotionRejectedAt?: string
}>
```

- [ ] **Step 4: Add the store functions**

Append to `src/long-term-memory/store.ts` (`parseEvidence`, `rowToRecord`, `recordScopeCondition` are already in scope):

```typescript
export function promoteProvisionalToActive(
  scope: MemoryScope,
  recordId: string,
  threads: readonly string[],
  now: string,
): MemoryRecord | null {
  const existing = getDrizzleDb().select().from(memoryRecords).where(recordScopeCondition(scope, recordId)).get()
  if (existing === undefined) return null
  const prev = parseEvidence(existing.evidence)
  const evidence: MemoryEvidence = { ...prev, threads: [...new Set(threads)], promotionRejectedAt: undefined }
  const rows = getDrizzleDb()
    .update(memoryRecords)
    .set({
      status: 'active',
      threadContextId: null,
      evidence: JSON.stringify(evidence),
      updatedAt: now,
      lastSeenAt: now,
    })
    .where(recordScopeCondition(scope, recordId))
    .returning()
    .all()
  return rows[0] === undefined ? null : rowToRecord(rows[0])
}

export function markPromotionRejected(scope: MemoryScope, recordId: string, now: string): void {
  const existing = getDrizzleDb().select().from(memoryRecords).where(recordScopeCondition(scope, recordId)).get()
  if (existing === undefined) return
  const evidence: MemoryEvidence = { ...parseEvidence(existing.evidence), promotionRejectedAt: now }
  getDrizzleDb()
    .update(memoryRecords)
    .set({ evidence: JSON.stringify(evidence), updatedAt: now })
    .where(recordScopeCondition(scope, recordId))
    .run()
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/long-term-memory/promotion-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/long-term-memory/types.ts src/long-term-memory/store.ts tests/long-term-memory/promotion-store.test.ts
git commit -m "feat(memory): promotion store mutations (promote/reject)"
```

---

## Task 2: In-memory record ranking

**Files:**

- Create: `src/long-term-memory/recall-ranking.ts`
- Test: `tests/long-term-memory/recall-ranking.test.ts`

Ranks a provided record list against a query — semantic when a query embedding is available, keyword (term overlap) otherwise. Used for the provisional layers (1 and 3) where candidates are already loaded.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/long-term-memory/recall-ranking.test.ts
import { describe, expect, test } from 'bun:test'
import { rankCandidatesByQuery } from '../../src/long-term-memory/recall-ranking.js'
import type { MemoryRecord } from '../../src/long-term-memory/types.js'

const rec = (id: string, content: string, embedding: Float32Array | null): MemoryRecord => ({
  id,
  scopeId: 'g',
  scopeType: 'group',
  kind: 'fact',
  content,
  summary: null,
  tags: [],
  confidence: 0.5,
  status: 'provisional',
  source: 'background',
  evidence: {},
  threadContextId: 't',
  embedding,
  createdAt: '',
  updatedAt: '',
  lastSeenAt: '',
})

describe('rankCandidatesByQuery', () => {
  test('semantic mode ranks by cosine and drops below threshold', () => {
    const out = rankCandidatesByQuery(
      [rec('near', 'x', new Float32Array([1, 0, 0])), rec('far', 'y', new Float32Array([0, 1, 0]))],
      'anything',
      [1, 0, 0],
      { threshold: 0.65, limit: 5 },
    )
    expect(out.map((r) => r.id)).toEqual(['near'])
  })

  test('keyword fallback when no query embedding', () => {
    const out = rankCandidatesByQuery(
      [rec('a', 'deploys happen on fridays', null), rec('b', 'lunch is at noon', null)],
      'Friday deploys',
      null,
      { limit: 5 },
    )
    expect(out[0]?.id).toBe('a')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/recall-ranking.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/long-term-memory/recall-ranking.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { cosineSimilarity } from './semantic-search.js'
import type { MemoryRecord } from './types.js'

export const RECALL_SIMILARITY_THRESHOLD = 0.65

export type RankOptions = Readonly<{ threshold?: number; limit?: number }>

const tokenize = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/gu) ?? []

const keywordScore = (query: string, content: string): number => {
  const q = new Set(tokenize(query))
  if (q.size === 0) return 0
  const tokens = tokenize(content)
  let hits = 0
  for (const token of tokens) if (q.has(token)) hits += 1
  return hits / q.size
}

/** Rank an already-loaded record list against a query. Semantic when `queryEmbedding` is present, else keyword. */
export function rankCandidatesByQuery(
  records: readonly MemoryRecord[],
  query: string,
  queryEmbedding: readonly number[] | null,
  options: RankOptions,
): readonly MemoryRecord[] {
  const threshold = options.threshold ?? RECALL_SIMILARITY_THRESHOLD
  const limit = options.limit ?? 10

  const scored =
    queryEmbedding !== null
      ? records
          .map((record) => ({
            record,
            score: record.embedding ? cosineSimilarity(queryEmbedding, record.embedding) : 0,
          }))
          .filter((entry) => entry.score >= threshold)
      : records
          .map((record) => ({ record, score: keywordScore(query, record.content) }))
          .filter((entry) => entry.score > 0)

  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.record)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/recall-ranking.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/recall-ranking.ts tests/long-term-memory/recall-ranking.test.ts
git commit -m "feat(memory): in-memory record ranking for recall layers"
```

---

## Task 3: Promotion engine

**Files:**

- Create: `src/long-term-memory/promotion.ts`
- Test: `tests/long-term-memory/promotion.test.ts`

Clusters provisional records similar to a candidate, counts distinct threads, and — when ≥ `MEMORY_PROMOTION_MIN_THREADS` and not in cooldown — asks a SMALL_MODEL to confirm the fact is durable/general. On confirm it promotes the candidate and archives the duplicates; on reject it stamps a cooldown.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/long-term-memory/promotion.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { setupTestDb } from '../utils/test-helpers.js'
import { saveMemoryRecord, listMemoryRecords } from '../../src/long-term-memory/store.js'
import { evaluatePromotion } from '../../src/long-term-memory/promotion.js'
import type { MemoryRecord, MemoryRecordInput } from '../../src/long-term-memory/types.js'

const emb = new Float32Array([1, 0, 0])
const prov = (id: string, thread: string): MemoryRecordInput => ({
  id,
  scopeId: 'g',
  scopeType: 'group',
  kind: 'fact',
  content: 'Deploys on Fridays.',
  summary: null,
  tags: [],
  confidence: 0.5,
  status: 'provisional',
  source: 'background',
  evidence: { threads: [thread] },
  threadContextId: thread,
  embedding: emb,
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
})

const load = (id: string): MemoryRecord => {
  const found = listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'provisional', limit: 50 }).find(
    (r) => r.id === id,
  )
  if (found === undefined) throw new Error('missing')
  return found
}

describe('evaluatePromotion', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('promotes when 3 distinct threads agree and confirm passes', async () => {
    saveMemoryRecord(prov('m1', 't-a'))
    saveMemoryRecord(prov('m2', 't-b'))
    saveMemoryRecord(prov('m3', 't-c'))
    const promoted = await evaluatePromotion({ scopeId: 'g', scopeType: 'group' }, load('m1'), {
      confirmDurable: () => Promise.resolve(true),
      now: () => '2026-06-16T00:00:00.000Z',
    })
    expect(promoted).toBe(true)
    expect(listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'active' })).toHaveLength(1)
    expect(listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'provisional' })).toHaveLength(0)
  })

  test('does not promote below the thread threshold', async () => {
    saveMemoryRecord(prov('m1', 't-a'))
    saveMemoryRecord(prov('m2', 't-b'))
    const promoted = await evaluatePromotion({ scopeId: 'g', scopeType: 'group' }, load('m1'), {
      confirmDurable: () => Promise.resolve(true),
      now: () => '2026-06-16T00:00:00.000Z',
    })
    expect(promoted).toBe(false)
    expect(listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'active' })).toHaveLength(0)
  })

  test('records a cooldown when confirm rejects', async () => {
    saveMemoryRecord(prov('m1', 't-a'))
    saveMemoryRecord(prov('m2', 't-b'))
    saveMemoryRecord(prov('m3', 't-c'))
    const promoted = await evaluatePromotion({ scopeId: 'g', scopeType: 'group' }, load('m1'), {
      confirmDurable: () => Promise.resolve(false),
      now: () => '2026-06-16T00:00:00.000Z',
    })
    expect(promoted).toBe(false)
    expect(load('m1').evidence.promotionRejectedAt).toBe('2026-06-16T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/promotion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/long-term-memory/promotion.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText } from 'ai'

import { resolveEffectiveLlmConfig } from '../llm-config-resolver.js'
import { buildChatModel } from '../llm-model-builder.js'
import { logger } from '../logger.js'
import { cosineSimilarity } from './semantic-search.js'
import {
  archiveMemoryRecord,
  listProvisionalRecords,
  markPromotionRejected,
  promoteProvisionalToActive,
} from './store.js'
import type { MemoryRecord, MemoryScope } from './types.js'

const log = logger.child({ scope: 'memory:promotion' })

export const MEMORY_PROMOTION_MIN_THREADS = 3
export const PROMOTION_REJECT_COOLDOWN_MS = 604_800_000 // 7 days
const CLUSTER_SIMILARITY_THRESHOLD = 0.8

export type EvaluatePromotionDeps = Readonly<{
  confirmDurable: (content: string, configContextId: string) => Promise<boolean>
  now: () => string
}>

const isInCooldown = (record: MemoryRecord, now: string): boolean => {
  const rejected = record.evidence.promotionRejectedAt
  if (rejected === undefined) return false
  return new Date(now).getTime() - new Date(rejected).getTime() < PROMOTION_REJECT_COOLDOWN_MS
}

/** A provisional row is "the same fact" as the candidate when its embedding is highly similar, or (no embeddings) its content matches. */
const clusterMembers = (candidate: MemoryRecord, all: readonly MemoryRecord[]): readonly MemoryRecord[] => {
  const vec = candidate.embedding
  return all.filter((other) => {
    if (other.id === candidate.id) return true
    if (vec && other.embedding)
      return cosineSimilarity(Array.from(vec), other.embedding) >= CLUSTER_SIMILARITY_THRESHOLD
    return other.content.trim().toLowerCase() === candidate.content.trim().toLowerCase()
  })
}

/**
 * Evaluate a provisional candidate for promotion to durable group memory.
 * Returns true iff it was promoted. Pure side effects on the store; never throws.
 */
export async function evaluatePromotion(
  scope: MemoryScope,
  candidate: MemoryRecord,
  deps: EvaluatePromotionDeps = defaultDeps,
): Promise<boolean> {
  const now = deps.now()
  if (isInCooldown(candidate, now)) return false

  const provisional = listProvisionalRecords({ scopeId: scope.scopeId, scopeType: scope.scopeType, limit: 500 })
  const cluster = clusterMembers(candidate, provisional)
  const threads = new Set<string>()
  for (const member of cluster) {
    if (member.threadContextId !== null && member.threadContextId !== undefined) threads.add(member.threadContextId)
    for (const t of member.evidence.threads ?? []) threads.add(t)
  }
  if (threads.size < MEMORY_PROMOTION_MIN_THREADS) return false

  let confirmed: boolean
  try {
    confirmed = await deps.confirmDurable(candidate.content, candidate.scopeId)
  } catch (error) {
    log.warn(
      { recordId: candidate.id, error: error instanceof Error ? error.message : String(error) },
      'Promotion confirm failed',
    )
    return false
  }

  if (!confirmed) {
    markPromotionRejected(scope, candidate.id, now)
    return false
  }

  promoteProvisionalToActive(scope, candidate.id, [...threads], now)
  for (const member of cluster) {
    if (member.id !== candidate.id) archiveMemoryRecord(scope, member.id, now)
  }
  log.info({ recordId: candidate.id, threadCount: threads.size }, 'Promoted provisional record to active')
  return true
}

const CONFIRM_PROMPT = (content: string): string =>
  `A fact has been observed independently in several separate group conversations. Decide whether it is a DURABLE, GENERAL fact about this group worth remembering long-term, versus thread-specific or transient noise. Answer with exactly "yes" or "no".\n\nFact: ${content}`

const defaultConfirm = async (content: string, configContextId: string): Promise<boolean> => {
  const resolved = resolveEffectiveLlmConfig(configContextId)
  if (!resolved.ok) return false
  const model = buildChatModel(resolved.llmApiKey, resolved.llmBaseUrl, resolved.smallModel)
  const { text } = await generateText({ model, prompt: CONFIRM_PROMPT(content) })
  return text.trim().toLowerCase().startsWith('yes')
}

const defaultDeps: EvaluatePromotionDeps = {
  confirmDurable: defaultConfirm,
  now: () => new Date().toISOString(),
}
```

> **Note:** `candidate.scopeId` is the group context id, which is also the `configContextId` used for BYOK-aware model resolution in this scope (groups key config by the group id). Passing it to `confirmDurable` keeps the model resolution consistent with capture.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/promotion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/promotion.ts tests/long-term-memory/promotion.test.ts
git commit -m "feat(memory): hybrid promotion engine (threshold + LLM confirm)"
```

---

## Task 4: Recall cascade

**Files:**

- Create: `src/long-term-memory/recall-cascade.ts`
- Test: `tests/long-term-memory/recall-cascade.test.ts`

Runs the 3-layer cascade and returns records tagged with provenance. Layers 1+2 always run; layer 3 runs only when 1+2 return fewer than the requested limit (the "if the agent reaches this point" gate). Layer-3 hits fire promotion in the background.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/long-term-memory/recall-cascade.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { setupTestDb } from '../utils/test-helpers.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import { runRecallCascade } from '../../src/long-term-memory/recall-cascade.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'

const base = (over: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'x',
  scopeId: 'g',
  scopeType: 'group',
  kind: 'fact',
  content: 'deploys happen on fridays',
  summary: null,
  tags: [],
  confidence: 0.5,
  status: 'provisional',
  source: 'background',
  evidence: {},
  threadContextId: 'g:thread:a',
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
  ...over,
})

describe('runRecallCascade (keyword mode, no embeddings)', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('layer 2 active group record is found and tagged group', async () => {
    saveMemoryRecord(base({ id: 'a', status: 'active', threadContextId: null }))
    const out = await runRecallCascade(
      { storageContextId: 'g:thread:z', configContextId: 'g', contextType: 'group', query: 'friday deploys', limit: 8 },
      { getEmbedding: () => Promise.resolve(null), schedulePromotion: () => undefined },
    )
    expect(out.records.map((r) => ({ id: r.id, p: r.provenance }))).toContainEqual({ id: 'a', p: 'group' })
  })

  test('reaches layer 3 for sibling-thread provisional and schedules promotion', async () => {
    saveMemoryRecord(base({ id: 'b', status: 'provisional', threadContextId: 'g:thread:a' }))
    const scheduled: string[] = []
    const out = await runRecallCascade(
      { storageContextId: 'g:thread:z', configContextId: 'g', contextType: 'group', query: 'friday deploys', limit: 8 },
      { getEmbedding: () => Promise.resolve(null), schedulePromotion: (r) => scheduled.push(r.id) },
    )
    expect(out.records.some((r) => r.id === 'b' && r.provenance === 'other-thread')).toBe(true)
    expect(scheduled).toContain('b')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/recall-cascade.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/long-term-memory/recall-cascade.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ContextType } from '../chat/types.js'
import { getEmbeddingForContext } from '../embeddings.js'
import { evaluatePromotion } from './promotion.js'
import { rankCandidatesByQuery } from './recall-ranking.js'
import { resolveMemoryScope } from './scope.js'
import { rankRecordsBySimilarity } from './semantic-search.js'
import { listProvisionalRecords, searchMemoryRecords } from './store.js'
import type { MemoryRecord, MemoryScope } from './types.js'

export const RECALL_DEFAULT_LIMIT = 8

export type RecallProvenance = 'current' | 'group' | 'other-thread'
export type RecallHit = MemoryRecord & Readonly<{ provenance: RecallProvenance }>

export type RunRecallCascadeInput = Readonly<{
  storageContextId: string
  configContextId: string
  contextType: ContextType
  query: string
  limit?: number
}>

export type RunRecallCascadeDeps = Readonly<{
  getEmbedding: (query: string, configContextId: string) => Promise<readonly number[] | null>
  schedulePromotion: (record: MemoryRecord, scope: MemoryScope) => void
}>

const defaultDeps: RunRecallCascadeDeps = {
  getEmbedding: (query, configContextId) =>
    getEmbeddingForContext(query, configContextId, {
      storageContextId: configContextId,
      contextType: 'group',
      chatUserId: configContextId,
    }),
  schedulePromotion: (record, scope) => {
    void evaluatePromotion(scope, record)
  },
}

const dedupe = (hits: readonly RecallHit[], limit: number): readonly RecallHit[] => {
  const seen = new Set<string>()
  const out: RecallHit[] = []
  for (const hit of hits) {
    if (seen.has(hit.id)) continue
    seen.add(hit.id)
    out.push(hit)
    if (out.length >= limit) break
  }
  return out
}

const tag = (records: readonly MemoryRecord[], provenance: RecallProvenance): RecallHit[] =>
  records.map((record) => ({ ...record, provenance }))

const searchActiveHybrid = (
  scope: MemoryScope,
  query: string,
  queryEmbedding: readonly number[] | null,
  limit: number,
): readonly MemoryRecord[] => {
  const semantic =
    queryEmbedding === null ? [] : rankRecordsBySimilarity(scope, queryEmbedding, { statuses: ['active'], limit })
  const keyword = searchMemoryRecords({ ...scope, query, limit })
  const merged: MemoryRecord[] = [...semantic]
  const seen = new Set(semantic.map((r) => r.id))
  for (const record of keyword) if (!seen.has(record.id)) merged.push(record)
  return merged.slice(0, limit)
}

export async function runRecallCascade(
  input: RunRecallCascadeInput,
  deps: RunRecallCascadeDeps = defaultDeps,
): Promise<{ records: readonly RecallHit[] }> {
  const limit = input.limit ?? RECALL_DEFAULT_LIMIT
  const scope = resolveMemoryScope({ storageContextId: input.storageContextId, contextType: input.contextType })
  const queryEmbedding = await deps.getEmbedding(input.query, input.configContextId)

  // DMs have no threads: layer 2 only.
  if (input.contextType === 'dm') {
    return { records: dedupe(tag(searchActiveHybrid(scope, input.query, queryEmbedding, limit), 'group'), limit) }
  }

  // Layer 1 — current-thread provisional.
  const layer1 = rankCandidatesByQuery(
    listProvisionalRecords({ ...scope, threadContextId: input.storageContextId, limit: 100 }),
    input.query,
    queryEmbedding,
    { limit },
  )
  // Layer 2 — active group records.
  const layer2 = searchActiveHybrid(scope, input.query, queryEmbedding, limit)

  const combined: RecallHit[] = [...tag(layer1, 'current'), ...tag(layer2, 'group')]

  // Layer 3 — sibling-thread provisional, only when 1+2 are insufficient.
  if (dedupe(combined, limit).length < limit) {
    const siblings = rankCandidatesByQuery(
      listProvisionalRecords({ ...scope, excludeThreadContextId: input.storageContextId, limit: 200 }),
      input.query,
      queryEmbedding,
      { limit },
    )
    for (const record of siblings) deps.schedulePromotion(record, scope)
    combined.push(...tag(siblings, 'other-thread'))
  }

  return { records: dedupe(combined, limit) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/recall-cascade.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/recall-cascade.ts tests/long-term-memory/recall-cascade.test.ts
git commit -m "feat(memory): 3-layer recall cascade with provenance"
```

---

## Task 5: `recall` tool + registration

**Files:**

- Create: `src/tools/recall.ts`
- Modify: `src/tools/provider-independent-tools-builder.ts`
- Test: `tests/tools/recall.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tools/recall.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { setupTestDb, getToolExecutor } from '../utils/test-helpers.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import { makeRecallMemoryTool } from '../../src/tools/recall.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'

const active = (id: string): MemoryRecordInput => ({
  id,
  scopeId: 'g',
  scopeType: 'group',
  kind: 'fact',
  content: 'deploys happen on fridays',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'background',
  evidence: {},
  threadContextId: null,
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
})

const isRecallResult = (v: unknown): v is { mode: string; records: Array<{ id: string; provenance: string }> } =>
  typeof v === 'object' && v !== null && 'records' in v

describe('recall tool', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns records with provenance and public shape', async () => {
    saveMemoryRecord(active('a'))
    const tool = makeRecallMemoryTool({ storageContextId: 'g:thread:z', contextType: 'group' })
    const result = await getToolExecutor(tool)({ query: 'friday deploys' })
    expect(isRecallResult(result)).toBe(true)
    if (!isRecallResult(result)) throw new Error('shape')
    expect(result.mode).toBe('recall')
    expect(result.records[0]?.provenance).toBe('group')
    expect(result.records[0]).not.toHaveProperty('embedding')
    expect(result.records[0]).not.toHaveProperty('scopeId')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/recall.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

```typescript
// src/tools/recall.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import type { ContextType } from '../chat/types.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { logger } from '../logger.js'
import { runRecallCascade, type RecallHit } from '../long-term-memory/recall-cascade.js'

const log = logger.child({ scope: 'tool:recall' })

export type RecallToolContext = Readonly<{
  storageContextId: string
  contextType: Extract<ContextType, 'dm' | 'group'>
}>

type PublicRecallRecord = Readonly<{
  id: string
  provenance: RecallHit['provenance']
  kind: RecallHit['kind']
  content: string
  summary: string | null
  tags: readonly string[]
  confidence: number
  status: RecallHit['status']
  lastSeenAt: string
}>

const toPublic = (hit: RecallHit): PublicRecallRecord => ({
  id: hit.id,
  provenance: hit.provenance,
  kind: hit.kind,
  content: hit.content,
  summary: hit.summary,
  tags: hit.tags,
  confidence: hit.confidence,
  status: hit.status,
  lastSeenAt: hit.lastSeenAt,
})

export function makeRecallMemoryTool(input: RecallToolContext): ToolSet[string] {
  return tool({
    description:
      'Recall what is known across this conversation, the shared group memory, and other conversations, in priority order. Prefer this before re-asking the user or claiming no prior knowledge.',
    inputSchema: z.object({
      query: z.string().min(1).max(500).describe('What to recall'),
      limit: z.number().int().min(1).max(20).optional().describe('Maximum records to return'),
    }),
    execute: async ({ query, limit }) => {
      const configContextId = getConfigContextIdFromStorageContextId(input.storageContextId)
      const { records } = await runRecallCascade({
        storageContextId: input.storageContextId,
        configContextId,
        contextType: input.contextType,
        query,
        limit,
      })
      log.debug({ storageContextId: input.storageContextId, count: records.length }, 'recall via tool')
      return { mode: 'recall', records: records.map(toPublic) }
    },
  })
}
```

- [ ] **Step 4: Register the tool (normal mode, flag-gated)**

In `src/tools/provider-independent-tools-builder.ts`, add the imports:

```typescript
import { makeRecallMemoryTool } from './recall.js'
import { resolveCrossThreadMemoryFlag } from './feature-flags.js'
```

Replace the `addMemoryTools(tools, contextId, contextType)` call site context: keep `addMemoryTools` as-is, and **after** it, add a flag-gated recall registration inside `addProviderIndependentTools` (it needs `mode`):

```typescript
addMemoryTools(tools, contextId, contextType)
if (
  contextId !== undefined &&
  contextType !== undefined &&
  mode === 'normal' &&
  resolveCrossThreadMemoryFlag(contextId)
) {
  tools['recall'] = makeRecallMemoryTool({ storageContextId: contextId, contextType })
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `bun test tests/tools/recall.test.ts && bun typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/recall.ts src/tools/provider-independent-tools-builder.ts tests/tools/recall.test.ts
git commit -m "feat(memory): recall tool wired into the cascade (normal mode, flag-gated)"
```

---

## Task 6: System-prompt recall preamble

**Files:**

- Modify: `src/system-prompt.ts`
- Test: `tests/system-prompt-recall.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/system-prompt-recall.test.ts
import { describe, expect, test } from 'bun:test'
import { buildSystemPrompt } from '../src/system-prompt.js'

describe('recall preamble', () => {
  test('present only when the recall tool is enabled', () => {
    const withRecall = buildSystemPrompt('g:thread:a', new Set(['recall']), { contextType: 'group' })
    const without = buildSystemPrompt('g:thread:a', new Set(['create_task']), { contextType: 'group' })
    expect(withRecall.toLowerCase()).toContain('priority order')
    expect(without.toLowerCase()).not.toContain('priority order')
  })
})
```

> **Implementer note:** match the call to the real exported entry point in `src/system-prompt.ts` (the function that takes `contextId`, the enabled-tool-name set, and `AssembleOptions`). If the public function name/signature differs from `buildSystemPrompt`, adjust the test invocation accordingly — the assertion (fragment present iff `recall` enabled) is what matters.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/system-prompt-recall.test.ts`
Expected: FAIL — preamble text absent.

- [ ] **Step 3: Add the fragment**

In `src/system-prompt.ts`, add the constant near the other fragment strings:

```typescript
const MEMORY_RECALL = `MEMORY RECALL
You can recall prior knowledge with the recall tool, which searches in priority order: this conversation, then shared group memory, then other conversations. Use it before re-asking the user or assuming nothing is known.`
```

Add an entry to the `FRAGMENTS` array (after the `MEMOS` entry):

```typescript
  { text: MEMORY_RECALL, requiredTools: ['recall'] },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/system-prompt-recall.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/system-prompt.ts tests/system-prompt-recall.test.ts
git commit -m "feat(memory): recall priority preamble in the system prompt"
```

---

## Task 7: Promotion sweep + acceptance + flag-off parity

**Files:**

- Create: `src/long-term-memory/promotion-sweep.ts`
- Modify: `src/scheduler-instance.ts`
- Test: `tests/long-term-memory/promotion-sweep.test.ts`
- Test: `tests/long-term-memory/stop-rediscovering.acceptance.test.ts`

- [ ] **Step 1: Write the failing sweep test**

```typescript
// tests/long-term-memory/promotion-sweep.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { setupTestDb } from '../utils/test-helpers.js'
import { saveMemoryRecord, listMemoryRecords } from '../../src/long-term-memory/store.js'
import { sweepPromotions } from '../../src/long-term-memory/promotion-sweep.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'

const prov = (id: string, thread: string): MemoryRecordInput => ({
  id,
  scopeId: 'g',
  scopeType: 'group',
  kind: 'fact',
  content: 'deploys on fridays',
  summary: null,
  tags: [],
  confidence: 0.5,
  status: 'provisional',
  source: 'background',
  evidence: { threads: [thread] },
  threadContextId: thread,
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
})

describe('sweepPromotions', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('evaluates every provisional record in each scope', async () => {
    saveMemoryRecord(prov('m1', 't-a'))
    saveMemoryRecord(prov('m2', 't-b'))
    saveMemoryRecord(prov('m3', 't-c'))
    const seen: string[] = []
    await sweepPromotions({
      evaluate: (_scope, candidate) => {
        seen.push(candidate.id)
        return Promise.resolve(true)
      },
      listScopes: () => [{ scopeId: 'g', scopeType: 'group' }],
    })
    expect(seen).toEqual(['m1', 'm2', 'm3'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/promotion-sweep.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the sweep**

```typescript
// src/long-term-memory/promotion-sweep.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { logger } from '../logger.js'
import { evaluatePromotion } from './promotion.js'
import { listProvisionalRecords } from './store.js'
import type { MemoryScope } from './types.js'

const log = logger.child({ scope: 'memory:promotion-sweep' })

export type SweepPromotionsDeps = Readonly<{
  evaluate: (scope: MemoryScope, candidate: ReturnType<typeof listProvisionalRecords>[number]) => Promise<boolean>
  listScopes: () => readonly MemoryScope[]
}>

const defaultListScopes = (): readonly MemoryScope[] => {
  const rows = getDrizzleDb()
    .selectDistinct({ scopeId: memoryRecords.scopeId, scopeType: memoryRecords.scopeType })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.status, 'provisional'), eq(memoryRecords.scopeType, 'group')))
    .all()
  return rows.map((r) => ({ scopeId: r.scopeId, scopeType: r.scopeType }))
}

const defaultDeps: SweepPromotionsDeps = {
  evaluate: (scope, candidate) => evaluatePromotion(scope, candidate),
  listScopes: defaultListScopes,
}

/** Deterministic backstop: evaluate every provisional record for promotion, scope by scope. */
export async function sweepPromotions(deps: SweepPromotionsDeps = defaultDeps): Promise<void> {
  for (const scope of deps.listScopes()) {
    const provisional = listProvisionalRecords({ ...scope, limit: 500 })
    const evaluated = new Set<string>()
    for (const candidate of provisional) {
      if (evaluated.has(candidate.id)) continue
      evaluated.add(candidate.id)
      try {
        await deps.evaluate(scope, candidate)
      } catch (error) {
        log.warn(
          { recordId: candidate.id, error: error instanceof Error ? error.message : String(error) },
          'Sweep promotion failed',
        )
      }
    }
  }
}
```

- [ ] **Step 4: Register the sweep**

In `src/scheduler-instance.ts`, add the import and register next to the maintenance job:

```typescript
import { sweepPromotions } from './long-term-memory/promotion-sweep.js'
```

```typescript
scheduler.register('memory-promotion-sweep', {
  interval: 30 * 60 * 1000, // every 30 minutes
  handler: () => {
    void sweepPromotions()
  },
  options: { immediate: false },
})
```

- [ ] **Step 5: Write the acceptance test ("stop rediscovering")**

```typescript
// tests/long-term-memory/stop-rediscovering.acceptance.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { setupTestDb, getToolExecutor } from '../utils/test-helpers.js'
import { runMemoryCapture } from '../../src/long-term-memory/capture.js'
import { sweepPromotions } from '../../src/long-term-memory/promotion-sweep.js'
import { evaluatePromotion } from '../../src/long-term-memory/promotion.js'
import { makeRecallMemoryTool } from '../../src/tools/recall.js'
import { listMemoryRecords } from '../../src/long-term-memory/store.js'
import type { MemoryPatch } from '../../src/long-term-memory/extractor.js'

// Keyword recall is used (no embeddings), so the recall query must share tokens with the stored content.
const fact = 'we deploy every friday'
const patch: MemoryPatch = {
  profile: null,
  records: [
    { kind: 'fact', content: fact, summary: null, tags: [], confidence: 0.5, source: 'background', evidence: {} },
  ],
  updates: [],
}
let uid = 0
const captureDeps = {
  flagEnabled: () => true,
  extractMemoryPatch: () => Promise.resolve(patch),
  getEmbedding: () => Promise.resolve(null),
  now: () => '2026-06-16T00:00:00.000Z',
  randomUUID: () => `mem-${(uid += 1)}`,
}

describe('acceptance: stop rediscovering across threads', () => {
  beforeEach(async () => {
    await setupTestDb()
    uid = 0
  })

  test('a fact captured in 3 short threads is promoted and recalled from a fresh thread', async () => {
    for (const thread of ['g:thread:a', 'g:thread:b', 'g:thread:c']) {
      await runMemoryCapture(
        {
          storageContextId: thread,
          configContextId: 'g',
          contextType: 'group',
          history: [{ role: 'user', content: fact }],
        },
        captureDeps,
      )
    }
    await sweepPromotions({
      listScopes: () => [{ scopeId: 'g', scopeType: 'group' }],
      evaluate: (scope, candidate) =>
        evaluatePromotion(scope, candidate, {
          confirmDurable: () => Promise.resolve(true),
          now: () => '2026-06-16T01:00:00.000Z',
        }),
    })

    expect(
      listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'active' }).some((r) => r.content === fact),
    ).toBe(true)

    const tool = makeRecallMemoryTool({ storageContextId: 'g:thread:z', contextType: 'group' })
    const result = (await getToolExecutor(tool)({ query: 'friday deploy' })) as {
      records: Array<{ content: string; provenance: string }>
    }
    expect(result.records.some((r) => r.content === fact && r.provenance === 'group')).toBe(true)
  })
})
```

- [ ] **Step 6: Write the flag-off parity test**

```typescript
// tests/long-term-memory/flag-off-parity.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { setupTestDb } from '../utils/test-helpers.js'
import { runMemoryCapture } from '../../src/long-term-memory/capture.js'
import { listProvisionalRecords } from '../../src/long-term-memory/store.js'
import type { MemoryPatch } from '../../src/long-term-memory/extractor.js'

const patch: MemoryPatch = {
  profile: null,
  records: [
    { kind: 'fact', content: 'x', summary: null, tags: [], confidence: 0.5, source: 'background', evidence: {} },
  ],
  updates: [],
}

describe('flag-off parity', () => {
  beforeEach(async () => {
    await setupTestDb()
  })
  test('no provisional rows are written when the flag is off', async () => {
    await runMemoryCapture(
      {
        storageContextId: 'g:thread:a',
        configContextId: 'g',
        contextType: 'group',
        history: [{ role: 'user', content: 'x' }],
      },
      {
        flagEnabled: () => false,
        extractMemoryPatch: () => Promise.resolve(patch),
        getEmbedding: () => Promise.resolve(null),
        now: () => 'n',
        randomUUID: () => 'm',
      },
    )
    expect(listProvisionalRecords({ scopeId: 'g', scopeType: 'group' })).toHaveLength(0)
  })
})
```

- [ ] **Step 7: Run the whole memory suite + typecheck**

Run: `bun test tests/long-term-memory/ tests/tools/recall.test.ts tests/system-prompt-recall.test.ts && bun typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/long-term-memory/promotion-sweep.ts src/scheduler-instance.ts tests/long-term-memory/promotion-sweep.test.ts tests/long-term-memory/stop-rediscovering.acceptance.test.ts tests/long-term-memory/flag-off-parity.test.ts
git commit -m "feat(memory): promotion sweep + acceptance + flag-off parity"
```

---

## Final verification

- [ ] **Run the full server suite**

Run: `bun run test`
Expected: all suites pass.

- [ ] **Confirm flag-OFF behavior**: with `cross_thread_memory` unset, `recall` is not registered (Task 5 gate), no promotion runs from recall, and `search_memory` keyword behavior is unchanged. The promotion/capture sweeps no-op because `runMemoryCapture` self-gates and there are no provisional rows to promote.

- [ ] **Run staged checks**: `bun check` — lint + typecheck + format pass.

---

## Handoff to Plan 3

Plans 1+2 deliver the full memory bridge behind `cross_thread_memory`. **Plan 3 (Scope Corrections & Declarative Registry)** is independent of the memory work: attachments group-discoverable on read, `web_rate_limit` per-user, and the single `ENTITY_SCOPES` source of truth with a consistency test that retires the misleading `threadScoped` flag.
</content>

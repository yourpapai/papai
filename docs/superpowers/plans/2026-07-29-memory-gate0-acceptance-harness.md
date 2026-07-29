<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Gate 0 Acceptance Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a versioned, executable production-acceptance contract for the memory subsystem that implements the five criteria current code can satisfy and makes the six it cannot both visible and non-waivable.

**Architecture:** A plain-data registry names all eleven acceptance criteria and nine scenario shapes with their status, blocker, and pass predicate. A shared synthetic corpus seeds fixtures per shape. Five criterion test suites drive their cases from exported tables, and a consistency test cross-checks those tables against the registry in both directions. An operator script renders the whole contract but never adjudicates readiness.

**Tech Stack:** Bun, TypeScript (strict), Drizzle ORM over `bun:sqlite`, `bun:test`, Zod v4.

Spec: `docs/superpowers/specs/2026-07-29-memory-gate0-acceptance-harness-design.md`

## Global Constraints

- Runtime is **Bun**. Run tests with `bun test <path>`. Never `npm`, `jest`, or `vitest`.
- **Strict TypeScript**; every relative import path ends in `.js`.
- **Never** add a lint-disable or type-ignore comment — a hook blocks the commit. Fix the underlying issue.
- Every source file starts with the four-line BUSL SPDX header (copy it from any neighbouring file); a `license-headers` check runs on commit.
- **Nothing under `src/` changes.** This plan adds test files, test data, and one script.
- Corpus data is **synthetic only**. Never add real conversation content.
- `oxlint` forbids conditionals inside `test()` bodies — narrow optionals in helpers declared outside the test, as `durable-erasure.golden.test.ts` does.
- Scope types are exactly `'personal' | 'group'` (`MemoryScopeType`). There is no `thread` scope type; thread isolation is expressed through the `threadContextId` field.
- `MemoryEvidence` fields are exactly `messageIds`, `actorIds`, `timestamps`, `contextId`, `threads`, `promotionRejectedAt`. Do not invent evidence fields.
- `MemorySource` values are exactly `'background' | 'explicit' | 'tool_result' | 'admin_edit'`.
- **`saveMemoryRecord` only applies the write-boundary tombstone gate when `source !== 'explicit'`** (`src/long-term-memory/store.ts:179`). An explicit user statement is allowed to re-assert erased content. Any non-recapture assertion must therefore use a non-`explicit` source — `'background'` — or it will silently pass through the gate and fail.
- **`listMemoryRecords` applies `recordValidityCondition(now)`** (`src/long-term-memory/store.ts:204`), so a fixture carrying `validUntil` in the past is invisible to it at real wall-clock time. Corpus fixtures therefore express supersession through `status`, not through validity windows.

---

### Task 1: Registry contract and its invariants

The registry is the frozen contract. This task creates it and the invariants that make the promotion rule binding rather than advisory. The cell-versus-case cross-check comes later (Task 8), because the criterion tables it checks do not exist yet.

**Files:**

- Create: `tests/long-term-memory/acceptance/registry.ts`
- Test: `tests/long-term-memory/acceptance/registry.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `CriterionKey`, `ShapeKey`, `CRITERION_KEYS`, `SHAPE_KEYS`, `Criterion`, `Shape`, `CRITERIA`, `SHAPES`, `criterionByKey(key: CriterionKey): Criterion`, `implementedCriteria(): readonly Criterion[]`, `implementedShapes(): readonly Shape[]`.

- [ ] **Step 1: Write the failing invariant tests**

Create `tests/long-term-memory/acceptance/registry.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { CRITERIA, CRITERION_KEYS, SHAPE_KEYS, SHAPES } from './registry.js'

describe('acceptance registry contract', () => {
  test('criteria cover the frozen key list exactly', () => {
    expect(CRITERIA.map((c) => c.key).toSorted()).toEqual([...CRITERION_KEYS].toSorted())
  })

  test('shapes cover the frozen key list exactly', () => {
    expect(SHAPES.map((s) => s.key).toSorted()).toEqual([...SHAPE_KEYS].toSorted())
  })

  test('there are exactly 11 criteria and 9 shapes', () => {
    expect(CRITERION_KEYS).toHaveLength(11)
    expect(SHAPE_KEYS).toHaveLength(9)
  })

  test('an implemented criterion carries a pass predicate and no blocker', () => {
    for (const criterion of CRITERIA.filter((c) => c.status === 'implemented')) {
      expect(criterion.passPredicate ?? '').not.toBe('')
      expect(criterion.blocker).toBeNull()
      expect(criterion.predicateRule).toBeNull()
    }
  })

  test('a declared-unmet criterion carries a blocker and a predicate rule, never a predicate', () => {
    for (const criterion of CRITERIA.filter((c) => c.status === 'declared-unmet')) {
      expect(criterion.passPredicate).toBeNull()
      expect(criterion.blocker ?? '').not.toBe('')
      expect(criterion.predicateRule ?? '').not.toBe('')
    }
  })

  test('only implemented criteria declare scenario cells', () => {
    for (const criterion of CRITERIA) {
      const expectedNonEmpty = criterion.status === 'implemented'
      expect(criterion.shapes.length > 0).toBe(expectedNonEmpty)
    }
  })

  test('every implemented shape is exercised by at least one criterion', () => {
    const declared = new Set(CRITERIA.flatMap((c) => c.shapes))
    for (const shape of SHAPES.filter((s) => s.status === 'implemented')) {
      expect(declared.has(shape.key)).toBe(true)
    }
  })

  test('no unimplemented shape is claimed by any criterion', () => {
    const declared = new Set(CRITERIA.flatMap((c) => c.shapes))
    for (const shape of SHAPES.filter((s) => s.status === 'declared-unimplemented')) {
      expect(declared.has(shape.key)).toBe(false)
    }
  })

  test('an unimplemented shape names its blocker', () => {
    for (const shape of SHAPES.filter((s) => s.status === 'declared-unimplemented')) {
      expect(shape.blocker ?? '').not.toBe('')
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/long-term-memory/acceptance/registry.test.ts`
Expected: FAIL — `Cannot find module './registry.js'`.

- [ ] **Step 3: Write the registry**

Create `tests/long-term-memory/acceptance/registry.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The frozen Gate 0 production-acceptance contract
 * (`docs/superpowers/specs/2026-07-29-memory-gate0-acceptance-harness-design.md`).
 *
 * Criteria come from `docs/research/agent-memory/06-recommendation.md` ("Acceptance gates
 * before broad production use"); scenario shapes come from the Gate 0 paragraph of
 * `docs/superpowers/plans/2026-07-26-memory-production-roadmap.md`.
 *
 * Promotion rule: a criterion may only reach `implemented` by satisfying a pass predicate
 * written BEFORE its implementation began. Unmet criteria therefore carry a `predicateRule`
 * instead of a predicate — their predicate must be authored in their own follow-on spec.
 * Promotion also appends a drift-log entry naming the predicate satisfied, matching the
 * append-only pattern the executed memory plans already use.
 * Adding or removing a key here is a deliberate, reviewable edit to a frozen contract.
 */

export type CriterionKey =
  | 'scope-isolation'
  | 'erasure'
  | 'provenance'
  | 'capture-idempotency'
  | 'reproducibility'
  | 'races'
  | 'crash-recovery'
  | 'migration'
  | 'backup-restore'
  | 'load'
  | 'reader-quality'

export type ShapeKey =
  | 'multilingual'
  | 'multi-party'
  | 'tool-result'
  | 'contradiction'
  | 'missing-embedding'
  | 'duplicate-out-of-order'
  | 'adversarial-erasure'
  | 'long-horizon'
  | 'abstention'

export const CRITERION_KEYS: readonly CriterionKey[] = [
  'scope-isolation',
  'erasure',
  'provenance',
  'capture-idempotency',
  'reproducibility',
  'races',
  'crash-recovery',
  'migration',
  'backup-restore',
  'load',
  'reader-quality',
]

export const SHAPE_KEYS: readonly ShapeKey[] = [
  'multilingual',
  'multi-party',
  'tool-result',
  'contradiction',
  'missing-embedding',
  'duplicate-out-of-order',
  'adversarial-erasure',
  'long-horizon',
  'abstention',
]

export type Criterion = Readonly<{
  key: CriterionKey
  status: 'implemented' | 'declared-unmet'
  /** Required iff implemented. The standard this criterion is held to. */
  passPredicate: string | null
  /** Required iff declared-unmet. Why no test body exists yet. */
  blocker: string | null
  /** Required iff declared-unmet. When its predicate must be authored. */
  predicateRule: string | null
  /** Declared criterion x scenario cells. Empty iff declared-unmet. */
  shapes: readonly ShapeKey[]
}>

export type Shape = Readonly<{
  key: ShapeKey
  status: 'implemented' | 'declared-unimplemented'
  blocker: string | null
}>

const PREDICATE_RULE =
  'Predicate MUST be written and reviewed in this criterion’s own follow-on spec, before its implementation begins.'

export const CRITERIA: readonly Criterion[] = [
  {
    key: 'scope-isolation',
    status: 'implemented',
    passPredicate:
      'No record in scope A is reachable from scope B through any channel — personal, group, and thread-scoped reads alike.',
    blocker: null,
    predicateRule: null,
    shapes: ['multilingual', 'multi-party'],
  },
  {
    key: 'erasure',
    status: 'implemented',
    passPredicate:
      'A purged id is unreachable via lexical, dense, listMemoryRecords (every status), summary, and profile — each asserted independently — and is not recaptured afterwards.',
    blocker: null,
    predicateRule: null,
    shapes: ['multilingual', 'adversarial-erasure'],
  },
  {
    key: 'provenance',
    status: 'implemented',
    passPredicate:
      'Every recalled record resolves to its stored source and evidence; no derived text surfaces without a resolvable record.',
    blocker: null,
    predicateRule: null,
    shapes: ['tool-result', 'multilingual'],
  },
  {
    key: 'capture-idempotency',
    status: 'implemented',
    passPredicate:
      'Duplicate and out-of-order capture of identical content yields exactly one record with a deterministic content hash; a contradiction supersedes rather than duplicates.',
    blocker: null,
    predicateRule: null,
    shapes: ['duplicate-out-of-order', 'contradiction'],
  },
  {
    key: 'reproducibility',
    status: 'implemented',
    passPredicate:
      'Identical corpus and embedding identity yield identical ordered recall; absent or incompatible embeddings degrade to lexical without losing order determinism.',
    blocker: null,
    predicateRule: null,
    shapes: ['missing-embedding', 'multilingual'],
  },
  {
    key: 'races',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'Needs a concurrency harness; forget-versus-ingest interleavings were never executed (05 §Security).',
    predicateRule: PREDICATE_RULE,
    shapes: [],
  },
  {
    key: 'crash-recovery',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'Needs fault injection between canonical and derivative writes (05 §Crash).',
    predicateRule: PREDICATE_RULE,
    shapes: [],
  },
  {
    key: 'migration',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'Needs schema/embedding/tokenizer version fixtures and a rollback path (05 §Crash).',
    predicateRule: PREDICATE_RULE,
    shapes: [],
  },
  {
    key: 'backup-restore',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'The 06 §6 retention and later-erasure policy for WAL, backups, and replicas is undefined.',
    predicateRule: PREDICATE_RULE,
    shapes: [],
  },
  {
    key: 'load',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'Needs a production-shaped SQLite profile; the 100k evidence is a serial fresh-worker workload.',
    predicateRule: PREDICATE_RULE,
    shapes: [],
  },
  {
    key: 'reader-quality',
    status: 'declared-unmet',
    passPredicate: null,
    blocker: 'Gated on the P1 shadow-log screen; no live reader, extractor, or judge exists.',
    predicateRule: PREDICATE_RULE,
    shapes: [],
  },
]

export const SHAPES: readonly Shape[] = [
  { key: 'multilingual', status: 'implemented', blocker: null },
  { key: 'multi-party', status: 'implemented', blocker: null },
  { key: 'tool-result', status: 'implemented', blocker: null },
  { key: 'contradiction', status: 'implemented', blocker: null },
  { key: 'missing-embedding', status: 'implemented', blocker: null },
  { key: 'duplicate-out-of-order', status: 'implemented', blocker: null },
  { key: 'adversarial-erasure', status: 'implemented', blocker: null },
  {
    key: 'long-horizon',
    status: 'declared-unimplemented',
    blocker: 'Needs the canonical event log (Gate 1); a fixture-bounded version would overstate coverage.',
  },
  {
    key: 'abstention',
    status: 'declared-unimplemented',
    blocker: 'Needs a live reader (Gate 4); belongs to the reader-quality criterion.',
  },
]

export function criterionByKey(key: CriterionKey): Criterion {
  const found = CRITERIA.find((c) => c.key === key)
  if (found === undefined) throw new Error(`unknown criterion key: ${key}`)
  return found
}

export function implementedCriteria(): readonly Criterion[] {
  return CRITERIA.filter((c) => c.status === 'implemented')
}

export function implementedShapes(): readonly Shape[] {
  return SHAPES.filter((s) => s.status === 'implemented')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/long-term-memory/acceptance/registry.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/long-term-memory/acceptance/registry.ts tests/long-term-memory/acceptance/registry.test.ts
git commit -m "test(memory): freeze the Gate 0 acceptance contract registry"
```

---

### Task 2: Synthetic scenario corpus

One shared, versioned corpus. Every criterion suite seeds from here, so a fixture change is a single reviewable edit that bumps `CORPUS_VERSION`.

**Files:**

- Create: `tests/long-term-memory/acceptance/corpus.ts`
- Test: `tests/long-term-memory/acceptance/corpus.test.ts`

**Interfaces:**

- Consumes: `ShapeKey` from Task 1.
- Produces: `CORPUS_VERSION`, `PERSONAL`, `OTHER_PERSONAL`, `GROUP`, `MODEL`, `VEC`, `VERSION`, `ALL_STATUSES`, `BILINGUAL`, `acceptanceRecord(overrides)`, and the seed functions `seedMultilingual(scope)`, `seedMultiParty()`, `seedToolResult(scope)`, `seedContradiction(scope)`, `seedMissingEmbedding(scope)`, `seedDuplicateOutOfOrder(scope)`, `seedAdversarialErasure(scope)`. Every seed returns `readonly string[]` of the ids it wrote.

- [ ] **Step 1: Write the failing corpus test**

Create `tests/long-term-memory/acceptance/corpus.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { listMemoryRecords } from '../../../src/long-term-memory/store.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import {
  ALL_STATUSES,
  CORPUS_VERSION,
  GROUP,
  PERSONAL,
  seedAdversarialErasure,
  seedContradiction,
  seedDuplicateOutOfOrder,
  seedMissingEmbedding,
  seedMultiParty,
  seedMultilingual,
  seedToolResult,
} from './corpus.js'

const idsIn = (scope: typeof PERSONAL): readonly string[] =>
  ALL_STATUSES.flatMap((status) => listMemoryRecords({ ...scope, status }).map((r) => r.id))

describe('acceptance corpus', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('the corpus is versioned', () => {
    expect(CORPUS_VERSION).not.toBe('')
  })

  test('multilingual seeds one Latin and one Cyrillic record', () => {
    const ids = seedMultilingual(PERSONAL)
    expect(ids).toHaveLength(2)
    expect(idsIn(PERSONAL)).toEqual(expect.arrayContaining([...ids]))
  })

  test('multi-party seeds separate personal and group scopes', () => {
    const ids = seedMultiParty()
    expect(ids.length).toBeGreaterThanOrEqual(3)
    expect(idsIn(PERSONAL).length).toBeGreaterThan(0)
    expect(idsIn(GROUP).length).toBeGreaterThan(0)
  })

  test('tool-result seeds a record sourced from a tool result with evidence', () => {
    const ids = seedToolResult(PERSONAL)
    expect(ids).toHaveLength(1)
    const written = listMemoryRecords({ ...PERSONAL, status: 'active' }).find((r) => r.id === ids[0])
    expect(written?.source).toBe('tool_result')
    expect(written?.evidence.messageIds ?? []).not.toHaveLength(0)
  })

  test('contradiction seeds a superseded record and its replacement', () => {
    const ids = seedContradiction(PERSONAL)
    expect(ids).toHaveLength(2)
    expect(listMemoryRecords({ ...PERSONAL, status: 'contradicted' })).toHaveLength(1)
    expect(listMemoryRecords({ ...PERSONAL, status: 'active' })).toHaveLength(1)
  })

  test('missing-embedding seeds a record with no embedding identity', () => {
    const ids = seedMissingEmbedding(PERSONAL)
    expect(ids).toHaveLength(1)
    const written = listMemoryRecords({ ...PERSONAL, status: 'active' }).find((r) => r.id === ids[0])
    expect(written?.embeddingVersion ?? null).toBeNull()
  })

  test('duplicate-out-of-order seeds identical content twice with reversed timestamps', () => {
    const ids = seedDuplicateOutOfOrder(PERSONAL)
    expect(ids).toHaveLength(2)
  })

  test('adversarial-erasure seeds an active record and a provisional twin of the same content', () => {
    const ids = seedAdversarialErasure(PERSONAL)
    expect(ids).toHaveLength(2)
    expect(listMemoryRecords({ ...PERSONAL, status: 'provisional' })).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/acceptance/corpus.test.ts`
Expected: FAIL — `Cannot find module './corpus.js'`.

- [ ] **Step 3: Write the corpus**

Create `tests/long-term-memory/acceptance/corpus.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Shared synthetic fixtures for the Gate 0 acceptance harness.
 *
 * SYNTHETIC ONLY. Never add real conversation content here — the harness satisfies the
 * roadmap's privacy-review requirement by construction, not by process.
 *
 * Bump CORPUS_VERSION whenever a fixture changes, so a shifting corpus cannot silently
 * change what "passing" meant. The report renders this value.
 */

import { saveMemoryRecord } from '../../../src/long-term-memory/store.js'
import type { MemoryRecordInput, MemoryScope, MemoryStatus } from '../../../src/long-term-memory/types.js'

export const CORPUS_VERSION = '2026-07-29.1'

export const PERSONAL: MemoryScope = { scopeId: 'acc-personal-1', scopeType: 'personal' }
export const OTHER_PERSONAL: MemoryScope = { scopeId: 'acc-personal-2', scopeType: 'personal' }
export const GROUP: MemoryScope = { scopeId: 'acc-group-1', scopeType: 'group' }

export const MODEL = 'acc-model'
export const VEC = [1, 0, 0]
export const VERSION = `${MODEL}:${VEC.length}`

export const ALL_STATUSES: readonly MemoryStatus[] = ['active', 'stale', 'archived', 'contradicted', 'provisional']

const BASE_TIME = '2026-07-01T00:00:00.000Z'

/** Bilingual pair driving every `multilingual` cell. Terms are chosen to tokenize under unicode61. */
export const BILINGUAL = [
  { lang: 'EN', id: 'acc-en-1', content: 'User lives in Berlin', term: 'Berlin' },
  { lang: 'RU', id: 'acc-ru-1', content: 'Пользователь живёт в Берлине', term: 'Берлине' },
] as const

export const acceptanceRecord = (
  overrides: Partial<MemoryRecordInput> & Readonly<{ id: string; content: string }>,
): MemoryRecordInput => ({
  scopeId: PERSONAL.scopeId,
  scopeType: PERSONAL.scopeType,
  kind: 'fact',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: BASE_TIME,
  updatedAt: BASE_TIME,
  lastSeenAt: BASE_TIME,
  embedding: new Float32Array(VEC),
  embeddingModel: MODEL,
  embeddingDimension: VEC.length,
  embeddingVersion: VERSION,
  embeddedAt: BASE_TIME,
  ...overrides,
})

const write = (input: MemoryRecordInput): string => {
  const saved = saveMemoryRecord(input)
  if (saved === null) throw new Error(`corpus write suppressed for ${input.id}`)
  return saved.id
}

export function seedMultilingual(scope: MemoryScope): readonly string[] {
  return BILINGUAL.map((entry) =>
    write(acceptanceRecord({ ...scope, id: `${scope.scopeId}-${entry.id}`, content: entry.content })),
  )
}

export function seedMultiParty(): readonly string[] {
  return [
    write(acceptanceRecord({ ...PERSONAL, id: 'acc-mp-personal', content: 'Alice prefers dark mode' })),
    write(acceptanceRecord({ ...OTHER_PERSONAL, id: 'acc-mp-other', content: 'Bob prefers light mode' })),
    write(
      acceptanceRecord({
        ...GROUP,
        id: 'acc-mp-group',
        content: 'The team stands up at nine',
        evidence: { actorIds: ['alice', 'bob'] },
      }),
    ),
    write(
      acceptanceRecord({
        ...GROUP,
        id: 'acc-mp-group-thread',
        content: 'The release thread targets Friday',
        threadContextId: 'thread-a',
        evidence: { actorIds: ['alice'], threads: ['thread-a'] },
      }),
    ),
  ]
}

export function seedToolResult(scope: MemoryScope): readonly string[] {
  return [
    write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-tool-1`,
        content: 'Task PAP-42 was moved to In Progress',
        source: 'tool_result',
        evidence: { messageIds: ['msg-tool-1'], contextId: scope.scopeId, timestamps: [BASE_TIME] },
      }),
    ),
  ]
}

/**
 * Supersession is expressed through `status`, never through a past `validUntil`:
 * `listMemoryRecords` applies `recordValidityCondition(now)`, so a closed validity window
 * would make the superseded record invisible and the fixture untestable at wall-clock time.
 */
export function seedContradiction(scope: MemoryScope): readonly string[] {
  return [
    write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-old`,
        content: 'User lives in Berlin',
        status: 'contradicted',
        evidence: { timestamps: [BASE_TIME] },
      }),
    ),
    write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-new`,
        content: 'User lives in Hamburg',
        evidence: { timestamps: ['2026-07-02T00:00:00.000Z'] },
      }),
    ),
  ]
}

export function seedMissingEmbedding(scope: MemoryScope): readonly string[] {
  return [
    write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-noembed`,
        content: 'User speaks Portuguese',
        embedding: null,
        embeddingModel: null,
        embeddingDimension: null,
        embeddingVersion: null,
        embeddedAt: null,
      }),
    ),
  ]
}

export function seedDuplicateOutOfOrder(scope: MemoryScope): readonly string[] {
  const content = 'User drinks oat milk'
  return [
    write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-dup-late`,
        content,
        createdAt: '2026-07-05T00:00:00.000Z',
        updatedAt: '2026-07-05T00:00:00.000Z',
        lastSeenAt: '2026-07-05T00:00:00.000Z',
      }),
    ),
    write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-dup-early`,
        content,
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-03T00:00:00.000Z',
        lastSeenAt: '2026-07-03T00:00:00.000Z',
      }),
    ),
  ]
}

export function seedAdversarialErasure(scope: MemoryScope): readonly string[] {
  const content = 'User banks with Sparkasse'
  return [
    write(acceptanceRecord({ ...scope, id: `${scope.scopeId}-acc-adv-active`, content })),
    write(acceptanceRecord({ ...scope, id: `${scope.scopeId}-acc-adv-twin`, content, status: 'provisional' })),
  ]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/acceptance/corpus.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/long-term-memory/acceptance/corpus.ts tests/long-term-memory/acceptance/corpus.test.ts
git commit -m "test(memory): add the Gate 0 synthetic acceptance corpus"
```

---

### Task 3: `scope-isolation` criterion suite

**Files:**

- Create: `tests/long-term-memory/acceptance/scope-isolation.test.ts`

**Interfaces:**

- Consumes: `PERSONAL`, `OTHER_PERSONAL`, `GROUP`, `ALL_STATUSES`, `seedMultilingual`, `seedMultiParty` from Task 2.
- Produces: `export const CASES: Partial<Record<ShapeKey, string>>` — the shape cells this suite covers. Task 8 cross-checks it.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { searchLexical } from '../../../src/long-term-memory/lexical-search.js'
import { listMemoryRecords } from '../../../src/long-term-memory/store.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { ALL_STATUSES, GROUP, OTHER_PERSONAL, PERSONAL, seedMultiParty, seedMultilingual } from './corpus.js'
import type { ShapeKey } from './registry.js'

export const CASES: Partial<Record<ShapeKey, string>> = {
  multilingual: 'bilingual records in one personal scope never surface in another',
  'multi-party': 'personal, group, and thread-scoped records stay in their own scope',
}

const lexicalIds = (scope: typeof PERSONAL, query: string): readonly string[] =>
  searchLexical({ ...scope, query, statuses: ALL_STATUSES, limit: 8 }).map((r) => r.id)

const listedIds = (scope: typeof PERSONAL): readonly string[] =>
  ALL_STATUSES.flatMap((status) => listMemoryRecords({ ...scope, status }).map((r) => r.id))

describe('acceptance: scope-isolation', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test(`multilingual — ${CASES.multilingual}`, () => {
    const seeded = seedMultilingual(PERSONAL)
    seedMultilingual(OTHER_PERSONAL)

    for (const id of seeded) {
      expect(listedIds(PERSONAL)).toContain(id)
      expect(listedIds(OTHER_PERSONAL)).not.toContain(id)
    }
    expect(lexicalIds(OTHER_PERSONAL, 'Berlin')).not.toEqual(expect.arrayContaining([...seeded]))
  })

  test(`multi-party — ${CASES['multi-party']}`, () => {
    seedMultiParty()

    expect(listedIds(PERSONAL)).toContain('acc-mp-personal')
    expect(listedIds(PERSONAL)).not.toContain('acc-mp-other')
    expect(listedIds(PERSONAL)).not.toContain('acc-mp-group')
    expect(listedIds(GROUP)).toContain('acc-mp-group')
    expect(listedIds(GROUP)).not.toContain('acc-mp-personal')
    expect(lexicalIds(PERSONAL, 'stands')).not.toContain('acc-mp-group')
  })

  test('multi-party — a thread-scoped record is filtered by threadContextId', () => {
    seedMultiParty()

    const otherThread = searchLexical({
      ...GROUP,
      query: 'release',
      statuses: ALL_STATUSES,
      threadContextId: 'thread-b',
      limit: 8,
    }).map((r) => r.id)
    expect(otherThread).not.toContain('acc-mp-group-thread')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/acceptance/scope-isolation.test.ts`
Expected: FAIL initially only if the corpus is missing; if Task 2 is complete this suite should pass on first run. If it passes immediately, confirm by temporarily changing one `not.toContain` to `toContain`, observing the failure, then reverting.

- [ ] **Step 3: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/acceptance/scope-isolation.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 4: Commit**

```bash
git add tests/long-term-memory/acceptance/scope-isolation.test.ts
git commit -m "test(memory): assert the Gate 0 scope-isolation criterion"
```

---

### Task 4: `erasure` criterion suite

Restates the guarantee `durable-erasure.golden.test.ts` already proves, as a registered contract term so a later change cannot weaken it silently. The `adversarial-erasure` cell adds what the golden does not cover: a provisional twin sharing the purged content.

**Files:**

- Create: `tests/long-term-memory/acceptance/erasure.test.ts`

**Interfaces:**

- Consumes: `PERSONAL`, `ALL_STATUSES`, `VEC`, `VERSION`, `BILINGUAL`, `acceptanceRecord`, `seedAdversarialErasure` from Task 2.
- Produces: `CASES` covering `multilingual` and `adversarial-erasure`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { searchLexical } from '../../../src/long-term-memory/lexical-search.js'
import { purgeMemoryRecord } from '../../../src/long-term-memory/purge.js'
import { rankRecordsBySimilarity } from '../../../src/long-term-memory/semantic-search.js'
import { listMemoryRecords, saveMemoryRecord } from '../../../src/long-term-memory/store.js'
import { isContentTombstoned } from '../../../src/long-term-memory/tombstone.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { ALL_STATUSES, BILINGUAL, PERSONAL, VEC, VERSION, acceptanceRecord, seedAdversarialErasure } from './corpus.js'
import type { ShapeKey } from './registry.js'

export const CASES: Partial<Record<ShapeKey, string>> = {
  multilingual: 'a purged bilingual record is unreachable through every channel',
  'adversarial-erasure': 'purging sweeps a provisional twin and refuses recapture of the same content',
}

const PURGE_TIME = '2026-07-24T00:00:00.000Z'

/** Dense channel with every masking filter disarmed, so a miss means the row is gone. */
const semanticIds = (): readonly string[] =>
  rankRecordsBySimilarity(PERSONAL, VEC, {
    statuses: ALL_STATUSES,
    embeddingVersion: VERSION,
    threshold: 0,
    limit: 8,
  }).map((r) => r.id)

const lexicalIds = (query: string): readonly string[] =>
  searchLexical({ ...PERSONAL, query, statuses: ALL_STATUSES, limit: 8 }).map((r) => r.id)

const listedIds = (): readonly string[] =>
  ALL_STATUSES.flatMap((status) => listMemoryRecords({ ...PERSONAL, status }).map((r) => r.id))

describe('acceptance: erasure', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  for (const entry of BILINGUAL) {
    test(`multilingual/${entry.lang} — ${CASES.multilingual}`, () => {
      const id = `${PERSONAL.scopeId}-${entry.id}`
      saveMemoryRecord(acceptanceRecord({ ...PERSONAL, id, content: entry.content }))

      expect(lexicalIds(entry.term)).toContain(id)
      expect(semanticIds()).toContain(id)

      expect(purgeMemoryRecord(PERSONAL, id, PURGE_TIME)).toBe(true)

      expect(lexicalIds(entry.term)).not.toContain(id)
      expect(semanticIds()).not.toContain(id)
      expect(listedIds()).not.toContain(id)
    })
  }

  test(`adversarial-erasure — ${CASES['adversarial-erasure']}`, () => {
    const [activeId, twinId] = seedAdversarialErasure(PERSONAL)
    const content = 'User banks with Sparkasse'

    expect(listedIds()).toContain(twinId)

    expect(purgeMemoryRecord(PERSONAL, activeId ?? '', PURGE_TIME)).toBe(true)

    // the content-hash sweep takes the provisional twin with it
    expect(listedIds()).not.toContain(twinId)
    expect(semanticIds()).not.toContain(twinId)
    // and the write boundary refuses to re-materialize it.
    // Source MUST be non-explicit: saveMemoryRecord deliberately lets an explicit user
    // re-assertion through the gate (store.ts:179), so 'explicit' here would prove nothing.
    expect(isContentTombstoned(PERSONAL, content)).toBe(true)
    expect(
      saveMemoryRecord(acceptanceRecord({ ...PERSONAL, id: 'acc-adv-recapture', content, source: 'background' })),
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails, then passes**

Run: `bun test tests/long-term-memory/acceptance/erasure.test.ts`
Expected: PASS, 3 tests. If any assertion fails, that is a genuine erasure regression — stop and report it rather than weakening the assertion.

- [ ] **Step 3: Commit**

```bash
git add tests/long-term-memory/acceptance/erasure.test.ts
git commit -m "test(memory): assert the Gate 0 erasure criterion"
```

---

### Task 5: `provenance` criterion suite

**Files:**

- Create: `tests/long-term-memory/acceptance/provenance.test.ts`

**Interfaces:**

- Consumes: `PERSONAL`, `ALL_STATUSES`, `seedToolResult`, `seedMultilingual` from Task 2.
- Produces: `CASES` covering `tool-result` and `multilingual`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { searchLexical } from '../../../src/long-term-memory/lexical-search.js'
import { listMemoryRecords } from '../../../src/long-term-memory/store.js'
import type { MemoryRecord } from '../../../src/long-term-memory/types.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { ALL_STATUSES, PERSONAL, seedMultilingual, seedToolResult } from './corpus.js'
import type { ShapeKey } from './registry.js'

export const CASES: Partial<Record<ShapeKey, string>> = {
  'tool-result': 'a record captured from a tool result carries its source and resolvable evidence',
  multilingual: 'every recalled bilingual record resolves to a stored record with a source',
}

/** Narrows outside the test body — oxlint forbids conditionals inside `test()`. */
const requireRecord = (record: MemoryRecord | undefined, id: string): MemoryRecord => {
  if (record === undefined) throw new Error(`record ${id} not found`)
  return record
}

const activeById = (id: string): MemoryRecord =>
  requireRecord(
    listMemoryRecords({ ...PERSONAL, status: 'active' }).find((r) => r.id === id),
    id,
  )

describe('acceptance: provenance', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test(`tool-result — ${CASES['tool-result']}`, () => {
    const [id] = seedToolResult(PERSONAL)
    const record = activeById(id ?? '')

    expect(record.source).toBe('tool_result')
    expect(record.evidence.messageIds ?? []).not.toHaveLength(0)
    expect(record.evidence.contextId).toBe(PERSONAL.scopeId)
    expect(record.evidence.timestamps ?? []).not.toHaveLength(0)
  })

  test(`multilingual — ${CASES.multilingual}`, () => {
    const seeded = seedMultilingual(PERSONAL)

    const hits = searchLexical({ ...PERSONAL, query: 'Berlin', statuses: ALL_STATUSES, limit: 8 })
    expect(hits.length).toBeGreaterThan(0)

    for (const hit of hits) {
      // every retrieval hit resolves back to a stored canonical record with a declared source
      const stored = activeById(hit.id)
      expect(stored.content).toBe(hit.content)
      expect(stored.source).not.toBe('')
    }
    for (const id of seeded) {
      expect(activeById(id).id).toBe(id)
    }
  })
})
```

- [ ] **Step 2: Run the test**

Run: `bun test tests/long-term-memory/acceptance/provenance.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/long-term-memory/acceptance/provenance.test.ts
git commit -m "test(memory): assert the Gate 0 provenance criterion"
```

---

### Task 6: `capture-idempotency` criterion suite

**Files:**

- Create: `tests/long-term-memory/acceptance/capture-idempotency.test.ts`

**Interfaces:**

- Consumes: `PERSONAL`, `ALL_STATUSES`, `seedDuplicateOutOfOrder`, `seedContradiction` from Task 2; `contentHash`, `normalizeForHash` from `src/long-term-memory/tombstone.js`.
- Produces: `CASES` covering `duplicate-out-of-order` and `contradiction`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { listMemoryRecords } from '../../../src/long-term-memory/store.js'
import { contentHash, normalizeForHash } from '../../../src/long-term-memory/tombstone.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { PERSONAL, seedContradiction, seedDuplicateOutOfOrder } from './corpus.js'
import type { ShapeKey } from './registry.js'

export const CASES: Partial<Record<ShapeKey, string>> = {
  'duplicate-out-of-order': 'identical content hashes identically regardless of arrival order or spacing',
  contradiction: 'a superseded record is retained as contradicted while its replacement is active',
}

describe('acceptance: capture-idempotency', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test(`duplicate-out-of-order — ${CASES['duplicate-out-of-order']}`, () => {
    seedDuplicateOutOfOrder(PERSONAL)

    const active = listMemoryRecords({ ...PERSONAL, status: 'active' })
    const hashes = new Set(active.map((r) => contentHash(r.content)))

    // both arrivals carry the same content, so they collapse to a single content identity
    expect(hashes.size).toBe(1)
    // and the hash is order-independent and whitespace/case-normalized
    expect(contentHash('User drinks oat milk')).toBe(contentHash('  user   DRINKS oat milk '))
    expect(normalizeForHash('  User   Drinks Oat Milk ')).toBe('user drinks oat milk')
  })

  test(`contradiction — ${CASES.contradiction}`, () => {
    seedContradiction(PERSONAL)

    const contradicted = listMemoryRecords({ ...PERSONAL, status: 'contradicted' })
    const active = listMemoryRecords({ ...PERSONAL, status: 'active' })

    expect(contradicted).toHaveLength(1)
    expect(active).toHaveLength(1)
    expect(contradicted[0]?.content).toBe('User lives in Berlin')
    expect(active[0]?.content).toBe('User lives in Hamburg')
    // history is preserved rather than destructively replaced: two distinct rows, not one edited row
    expect(contradicted[0]?.id).not.toBe(active[0]?.id)
    expect(contradicted[0]?.evidence.timestamps ?? []).not.toHaveLength(0)
    // and the superseded content is no longer active
    expect(active.map((r) => r.content)).not.toContain('User lives in Berlin')
  })
})
```

- [ ] **Step 2: Run the test**

Run: `bun test tests/long-term-memory/acceptance/capture-idempotency.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/long-term-memory/acceptance/capture-idempotency.test.ts
git commit -m "test(memory): assert the Gate 0 capture-idempotency criterion"
```

---

### Task 7: `reproducibility` criterion suite

**Files:**

- Create: `tests/long-term-memory/acceptance/reproducibility.test.ts`

**Interfaces:**

- Consumes: `PERSONAL`, `ALL_STATUSES`, `VEC`, `VERSION`, `seedMultilingual`, `seedMissingEmbedding` from Task 2.
- Produces: `CASES` covering `missing-embedding` and `multilingual`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { searchLexical } from '../../../src/long-term-memory/lexical-search.js'
import { rankRecordsBySimilarity } from '../../../src/long-term-memory/semantic-search.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { ALL_STATUSES, PERSONAL, VEC, VERSION, seedMissingEmbedding, seedMultilingual } from './corpus.js'
import type { ShapeKey } from './registry.js'

export const CASES: Partial<Record<ShapeKey, string>> = {
  multilingual: 'repeated identical queries return identically ordered results',
  'missing-embedding': 'a record without embedding identity stays lexically recallable and out of the dense channel',
}

const lexicalIds = (query: string): readonly string[] =>
  searchLexical({ ...PERSONAL, query, statuses: ALL_STATUSES, limit: 8 }).map((r) => r.id)

const denseIds = (): readonly string[] =>
  rankRecordsBySimilarity(PERSONAL, VEC, {
    statuses: ALL_STATUSES,
    embeddingVersion: VERSION,
    threshold: 0,
    limit: 8,
  }).map((r) => r.id)

describe('acceptance: reproducibility', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test(`multilingual — ${CASES.multilingual}`, () => {
    seedMultilingual(PERSONAL)

    const first = lexicalIds('Berlin')
    const second = lexicalIds('Berlin')
    const third = lexicalIds('Berlin')

    expect(second).toEqual([...first])
    expect(third).toEqual([...first])
    expect(denseIds()).toEqual([...denseIds()])
  })

  test(`missing-embedding — ${CASES['missing-embedding']}`, () => {
    const [id] = seedMissingEmbedding(PERSONAL)

    // lexical recall is preserved when the embedding is absent
    expect(lexicalIds('Portuguese')).toContain(id)
    // the dense channel excludes it rather than comparing incompatible identities
    expect(denseIds()).not.toContain(id)
    // and the exclusion is deterministic across repeated calls
    expect(denseIds()).toEqual([...denseIds()])
  })
})
```

- [ ] **Step 2: Run the test**

Run: `bun test tests/long-term-memory/acceptance/reproducibility.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/long-term-memory/acceptance/reproducibility.test.ts
git commit -m "test(memory): assert the Gate 0 reproducibility criterion"
```

---

### Task 8: Coverage cross-check

Closes the loop: the registry's declared cells and the suites' exported tables must agree in both directions. Without this, the coverage matrix can drift from what the tests actually do — and the matrix is the artifact people will cite.

**Files:**

- Create: `tests/long-term-memory/acceptance/coverage.ts`
- Modify: `tests/long-term-memory/acceptance/registry.test.ts` (append the cross-check describe block)

**Interfaces:**

- Consumes: `CASES` from Tasks 3–7; `CRITERIA`, `CriterionKey`, `ShapeKey` from Task 1.
- Produces: `CASE_TABLES: Readonly<Record<CriterionKey, Partial<Record<ShapeKey, string>>>>` and `coveredShapes(key: CriterionKey): readonly ShapeKey[]`.

- [ ] **Step 1: Write the coverage aggregator**

Create `tests/long-term-memory/acceptance/coverage.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Aggregates each criterion suite's exported CASES table so the registry's declared
 * criterion x scenario cells can be cross-checked against what the suites actually run.
 * Importing the suites here is deliberate: the coupling is a real import that typechecks,
 * rather than a naming convention that rots.
 */

import { CASES as captureIdempotency } from './capture-idempotency.test.js'
import { CASES as erasure } from './erasure.test.js'
import { CASES as provenance } from './provenance.test.js'
import type { CriterionKey, ShapeKey } from './registry.js'
import { CASES as reproducibility } from './reproducibility.test.js'
import { CASES as scopeIsolation } from './scope-isolation.test.js'

export const CASE_TABLES: Readonly<Partial<Record<CriterionKey, Partial<Record<ShapeKey, string>>>>> = {
  'scope-isolation': scopeIsolation,
  erasure,
  provenance,
  'capture-idempotency': captureIdempotency,
  reproducibility,
}

export function coveredShapes(key: CriterionKey): readonly ShapeKey[] {
  const table = CASE_TABLES[key]
  if (table === undefined) return []
  return Object.keys(table) as readonly ShapeKey[]
}
```

- [ ] **Step 2: Append the cross-check to `registry.test.ts`**

Add this import alongside the existing ones:

```ts
import { CASE_TABLES, coveredShapes } from './coverage.js'
```

Append this describe block to the end of the file:

```ts
describe('acceptance registry coverage cross-check', () => {
  test('every implemented criterion exports a case table', () => {
    for (const criterion of CRITERIA.filter((c) => c.status === 'implemented')) {
      expect(CASE_TABLES[criterion.key]).toBeDefined()
    }
  })

  test('no declared-unmet criterion exports a case table', () => {
    for (const criterion of CRITERIA.filter((c) => c.status === 'declared-unmet')) {
      expect(CASE_TABLES[criterion.key]).toBeUndefined()
    }
  })

  test('every declared cell has a matching case', () => {
    for (const criterion of CRITERIA) {
      const covered = coveredShapes(criterion.key)
      for (const shape of criterion.shapes) {
        expect(covered).toContain(shape)
      }
    }
  })

  test('every exported case is declared in the registry', () => {
    for (const criterion of CRITERIA) {
      for (const shape of coveredShapes(criterion.key)) {
        expect(criterion.shapes).toContain(shape)
      }
    }
  })

  test('every case carries a non-empty description', () => {
    for (const table of Object.values(CASE_TABLES)) {
      for (const description of Object.values(table)) {
        expect(description).not.toBe('')
      }
    }
  })
})
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `bun test tests/long-term-memory/acceptance/registry.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 4: Verify the cross-check actually bites**

Temporarily add `'contradiction'` to the `scope-isolation` criterion's `shapes` array in `registry.ts`.

Run: `bun test tests/long-term-memory/acceptance/registry.test.ts`
Expected: FAIL on "every declared cell has a matching case".

Revert the change and re-run.
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/long-term-memory/acceptance/coverage.ts tests/long-term-memory/acceptance/registry.test.ts
git commit -m "test(memory): cross-check Gate 0 declared cells against executed cases"
```

---

### Task 9: Operator report

Renders the whole contract. Exit code is always 0 — enforcement lives in the tests, and the report never adjudicates readiness, mirroring `memory:shadow-funnel`'s refusal to print a verdict a human should make.

**Files:**

- Create: `scripts/memory-acceptance.ts`
- Create: `tests/long-term-memory/acceptance/report.ts`
- Test: `tests/long-term-memory/acceptance/report.test.ts`
- Modify: `package.json` (add the `memory:acceptance` script)

**Interfaces:**

- Consumes: `CRITERIA`, `SHAPES` from Task 1; `CORPUS_VERSION` from Task 2; `coveredShapes` from Task 8.
- Produces: `renderAcceptanceReport(): string`.

Rendering logic lives in `report.ts` (pure, testable); the script is a thin `console.log` wrapper, matching how `memory-shadow-funnel.ts` delegates to `shadow-funnel.ts`.

- [ ] **Step 1: Write the failing report test**

Create `tests/long-term-memory/acceptance/report.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { CORPUS_VERSION } from './corpus.js'
import { renderAcceptanceReport } from './report.js'

describe('acceptance report', () => {
  test('renders the corpus version', () => {
    expect(renderAcceptanceReport()).toContain(CORPUS_VERSION)
  })

  test('renders every criterion key', () => {
    const output = renderAcceptanceReport()
    for (const key of ['scope-isolation', 'erasure', 'races', 'crash-recovery', 'reader-quality']) {
      expect(output).toContain(key)
    }
  })

  test('renders blockers for unmet criteria', () => {
    expect(renderAcceptanceReport()).toContain('needs fault injection')
  })

  test('states that the contract is versioned and production readiness is not established', () => {
    const output = renderAcceptanceReport()
    expect(output).toContain('contract versioned = YES')
    expect(output).toContain('production ready = NO (6 unmet)')
  })

  test('renders the two unimplemented shapes with their blockers', () => {
    const output = renderAcceptanceReport()
    expect(output).toContain('long-horizon')
    expect(output).toContain('abstention')
  })

  test('never prints a readiness verdict beyond the counts', () => {
    expect(renderAcceptanceReport()).not.toContain('PASS')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/acceptance/report.test.ts`
Expected: FAIL — `Cannot find module './report.js'`.

- [ ] **Step 3: Write the renderer**

Create `tests/long-term-memory/acceptance/report.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Renders the Gate 0 acceptance contract. Informational only: it counts and displays,
 * and never declares readiness. Enforcement lives in the criterion suites.
 */

import { CORPUS_VERSION } from './corpus.js'
import { coveredShapes } from './coverage.js'
import { CRITERIA, SHAPES } from './registry.js'

const criterionLines = (): readonly string[] =>
  CRITERIA.map((criterion) => {
    const mark = criterion.status === 'implemented' ? 'x' : '!'
    const detail =
      criterion.status === 'implemented'
        ? `shapes: ${coveredShapes(criterion.key).join(', ')}`
        : `blocker: ${criterion.blocker ?? ''}`
    return `  [${mark}] ${criterion.key.padEnd(22)} ${detail}`
  })

const shapeLines = (): readonly string[] =>
  SHAPES.map((shape) => {
    const mark = shape.status === 'implemented' ? 'x' : '!'
    const detail = shape.status === 'implemented' ? '' : `blocker: ${shape.blocker ?? ''}`
    return `  [${mark}] ${shape.key.padEnd(22)} ${detail}`.trimEnd()
  })

export function renderAcceptanceReport(): string {
  const unmet = CRITERIA.filter((c) => c.status === 'declared-unmet').length
  return [
    'Memory Gate 0 — production acceptance contract',
    `corpus version: ${CORPUS_VERSION}`,
    '',
    `criteria (${CRITERIA.length}):`,
    ...criterionLines(),
    '',
    `scenario shapes (${SHAPES.length}):`,
    ...shapeLines(),
    '',
    'contract versioned = YES',
    `production ready = NO (${unmet} unmet)`,
    '',
    'This report is informational. Criterion enforcement lives in',
    'tests/long-term-memory/acceptance/. A criterion is promoted only by satisfying a pass',
    'predicate written before its implementation began — see the design doc.',
  ].join('\n')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/acceptance/report.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the operator script**

Create `scripts/memory-acceptance.ts`:

```ts
#!/usr/bin/env bun
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Operator script: prints the memory Gate 0 production-acceptance contract
 * (see `docs/superpowers/specs/2026-07-29-memory-gate0-acceptance-harness-design.md`).
 *
 * Always exits 0. The report displays status; it never adjudicates production readiness.
 * Enforcement lives in the criterion suites under tests/long-term-memory/acceptance/.
 *
 * Usage:
 *   bun run scripts/memory-acceptance.ts
 */

import { renderAcceptanceReport } from '../tests/long-term-memory/acceptance/report.js'

console.log(renderAcceptanceReport())
```

- [ ] **Step 6: Register the script**

In `package.json`, add alongside `"memory:shadow-funnel"`:

```json
"memory:acceptance": "bun scripts/memory-acceptance.ts",
```

- [ ] **Step 7: Run the script**

Run: `bun run memory:acceptance`
Expected: the contract renders, ending with `production ready = NO (6 unmet)`, exit code 0.

Verify the exit code: `bun run memory:acceptance > /dev/null; echo $status`
Expected: `0`.

- [ ] **Step 8: Run knip and the full acceptance suite**

Run: `bun knip`
Expected: no new unused-export or unlisted-entry findings. If knip reports `scripts/memory-acceptance.ts` as an unused entry, register it in the knip `entry` configuration next to the other `scripts/*.ts` entries — do not add an ignore comment.

Run: `bun test tests/long-term-memory/acceptance/`
Expected: PASS, all suites.

- [ ] **Step 9: Commit**

```bash
git add scripts/memory-acceptance.ts tests/long-term-memory/acceptance/report.ts tests/long-term-memory/acceptance/report.test.ts package.json
git commit -m "feat(memory): add the Gate 0 acceptance contract report"
```

---

### Task 10: Wire the harness into the roadmap

Gate 0's exit condition is met only when the contract is versioned *and* discoverable. This closes it.

**Files:**

- Modify: `docs/superpowers/plans/2026-07-26-memory-production-roadmap.md`
- Modify: `docs/research/agent-memory/implementation-status.md`

- [ ] **Step 1: Record Gate 0 completion in the roadmap**

Under the `### Gate 0` section, append:

```markdown
**Status (2026-07-29):** the contract is versioned and executable —
`docs/superpowers/specs/2026-07-29-memory-gate0-acceptance-harness-design.md`,
`tests/long-term-memory/acceptance/`, `bun run memory:acceptance`. Five criteria and seven
scenario shapes are implemented; six criteria and two shapes are declared with named blockers.
Each unmet criterion's pass predicate must be authored in its own follow-on spec before its
implementation begins. Gate 1 may begin.
```

- [ ] **Step 2: Record the harness in the implementation-status companion**

In the "Still open at HEAD" section, append a bullet:

```markdown
- **Gate 0 acceptance harness** — landed 2026-07-29. `bun run memory:acceptance` renders the
  frozen eleven-criterion contract; five criteria pass, six are declared-unmet with named
  blockers (races, crash recovery, migration, backup/restore, load, reader quality). The harness
  reporting `production ready = NO` is its intended output, not a defect.
```

- [ ] **Step 3: Verify the docs render and commit**

Run: `bun test tests/long-term-memory/acceptance/`
Expected: PASS (confirms nothing was broken by the doc edits).

```bash
git add docs/superpowers/plans/2026-07-26-memory-production-roadmap.md docs/research/agent-memory/implementation-status.md
git commit -m "docs(memory): record the Gate 0 acceptance harness in the roadmap"
```

---

## Deliberate deviations from the spec

Two, both narrowings recorded here so review can accept or reject them explicitly rather than
discover them in the diff:

1. **`scope-isolation` drops "guest" from its predicate.** The spec writes "personal, group,
   thread, guest". Guest mode is a chat-layer toolset restriction; it does not create a distinct
   memory read channel — a guest reads the same scope through the same functions. Asserting a
   fourth channel that does not exist in `src/long-term-memory/` would be theatre. The predicate
   covers personal, group, and thread.
2. **`seedContradiction` carries no validity window.** See the Global Constraints note on
   `recordValidityCondition`. Supersession is asserted through `status` instead, which is the
   mechanism the store actually implements.

## Verification

After all tasks:

- [ ] `bun test tests/long-term-memory/acceptance/` — all suites pass.
- [ ] `bun test` — full suite, no regressions.
- [ ] `bun run typecheck` — clean.
- [ ] `bun knip` — no new findings.
- [ ] `bun run memory:acceptance` — renders the contract, exits 0.

<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Message-Edit Analytics (Edit Windows + W2 Regen Funnel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register two analytics events (`edit_classified`, `edit_regen`) and emit them across the message-edit flow, producing the edit-window distribution and W2 regen funnel as standalone friction metrics.

**Architecture:** Two registry events flow through the established pipeline: fact builders (`src/analytics/edit-observer.ts`) → non-throwing observer → fail-closed normalizer (new derived-family cases) → C0 daily aggregate counters (10 new closed counter names) → curated snapshot props (`prop_window`, `prop_phase`) → one edit-funnel card in Metabase model 04. No turn/session/outcome semantics for regen turns (explicit non-goal).

**Tech Stack:** Bun, strict TypeScript, Zod v4, `bun:sqlite`, Drizzle ORM, pino, Bun tests.

**Spec:** [`docs/superpowers/specs/2026-07-29-message-edit-analytics-design.md`](../specs/2026-07-29-message-edit-analytics-design.md) (Appendix A = the catalog amendment text applied in Task 4)

## Global Constraints

- Work on branch `claude/analytics-metrics-research-plan-0q1fqk`; one commit per task, four commits total.
- TDD per repo rules: failing test first, then minimal implementation.
- All new imports use `.js` extensions. Strict TypeScript: no `any`, no lint-disable or type-ignore comments.
- Logging is pino metadata-first; never log secrets, endpoints, payloads, raw identifiers, or error bodies.
- **No edit content in any fact** — window, phase, durationMs, standard envelope only (C3-safe by construction).
- Facts mirror the path actually taken: `regen_started` only immediately before a real `processMessage` call; `regen_failed` observed before rethrow.
- Silent paths stay silent: auth-denied, group-ignored, missing `messageId`, command edit, empty text, same-text no-op.
- Error extraction convention: `error instanceof Error ? error.message : String(error)`.
- `max-lines`/`max-lines-per-function` failures are design signals: split or extract.
- After each task: run the task's named gates plus `bun run typecheck` and `bun run lint`.

---

### Task 1: Register the edit events (contracts, registry, normalizer, aggregates, snapshot props)

**Files:**
- Modify: `src/analytics/controlled-types.ts` (`EventNameV1Schema`, `AggregateCounterV1Schema`)
- Modify: `src/analytics/event-props-common.ts` (props schemas + `propsByEventName`)
- Modify: `src/analytics/source-facts-boundary.ts` (fact types), `src/analytics/source-facts.ts` (union + re-exports)
- Modify: `src/analytics/registry.ts` (`SourceFamilyV1Schema` += `'edit'`)
- Modify: `src/analytics/registry-events.ts` (two metadata entries)
- Modify: `src/analytics/normalizer-props-derived.ts` (two builder cases)
- Modify: `src/analytics/aggregate.ts` (`editIncrements`)
- Modify: `src/analytics/jobs/snapshot-props.ts` (`PROP_EXTRACTIONS` += `window`, `phase`)
- Test: `tests/analytics/normalizer-props-derived.test.ts`
- Test: `tests/analytics/aggregate.test.ts`

**Interfaces:**
- Consumes: existing registration machinery (`propsByEventName`, `parseEnum`/`nonNegativeInt` from `normalizer-shared.ts`, `parseWith`/`counter` in `aggregate.ts`).
- Produces (Task 2 relies on these names verbatim):
  - Event names: `'edit_classified'`, `'edit_regen'`
  - `EditClassifiedFact = FactBase & { type: 'edit_classified'; window: string }`
  - `EditRegenFact = FactBase & { type: 'edit_regen'; phase: string; durationMs?: number }`
  - Normalized props: `edit_classified → { window: 'w1'|'w2'|'w3' }`, `edit_regen → { phase: <7-enum>, duration_ms?: number }`
  - Counters: `edit_classified_w1|w2|w3`, `edit_prompt_shown`, `edit_prompt_adjust`, `edit_prompt_note`, `edit_regen_started`, `edit_regen_completed`, `edit_regen_failed`, `edit_history_only`
  - Snapshot columns: `prop_window`, `prop_phase`

- [ ] **Step 1: Write the failing normalizer tests**

Add to `tests/analytics/normalizer-props-derived.test.ts` (follow the file's existing pattern for building a `ValidatedFactRecord` and calling the family builder — read the `turn_steered` tests first and mirror them):

```ts
test('edit_classified normalizes a valid window', () => {
  const result = buildDerivedFamilyProps(factRecord({ type: 'edit_classified', window: 'w2' }), keys)
  expect(result).toEqual({ ok: true, props: { window: 'w2' } })
})

test('edit_classified rejects an unknown window', () => {
  const result = buildDerivedFamilyProps(factRecord({ type: 'edit_classified', window: 'w4' }), keys)
  expect(result).toEqual({ ok: false, reason: 'unknown_enum' })
})

test('edit_regen normalizes a phase without duration', () => {
  const result = buildDerivedFamilyProps(factRecord({ type: 'edit_regen', phase: 'prompt_shown' }), keys)
  expect(result).toEqual({ ok: true, props: { phase: 'prompt_shown' } })
})

test('edit_regen normalizes a completed phase with duration', () => {
  const result = buildDerivedFamilyProps(factRecord({ type: 'edit_regen', phase: 'regen_completed', durationMs: 4200 }), keys)
  expect(result).toEqual({ ok: true, props: { phase: 'regen_completed', duration_ms: 4200 } })
})

test('edit_regen rejects an unknown phase and a negative duration', () => {
  expect(buildDerivedFamilyProps(factRecord({ type: 'edit_regen', phase: 'regen_vibes' }), keys)).toEqual({
    ok: false,
    reason: 'unknown_enum',
  })
  expect(buildDerivedFamilyProps(factRecord({ type: 'edit_regen', phase: 'regen_failed', durationMs: -1 }), keys)).toEqual({
    ok: false,
    reason: 'invalid_value',
  })
})
```

Use the file's actual helper names for the fact-record fixture and key deriver (they exist for the `turn_steered` cases — mirror, don't invent). Match the file's `Result` assertion style (`propsOk`/`propsRejected` shapes may be wrapped; copy the neighboring assertions verbatim).

- [ ] **Step 2: Write the failing aggregate tests**

Add to `tests/analytics/aggregate.test.ts` (mirror an existing `incrementsForEvent` case such as `auth_checked`):

```ts
test('edit_classified increments the per-window counter', () => {
  expect(incrementsForEvent(aggregateEvent('edit_classified', { window: 'w1' }))).toEqual([{ kind: 'counter', metric: 'edit_classified_w1', count: 1 }])
  expect(incrementsForEvent(aggregateEvent('edit_classified', { window: 'w3' }))).toEqual([{ kind: 'counter', metric: 'edit_classified_w3', count: 1 }])
})

test('edit_regen increments the per-phase counter', () => {
  expect(incrementsForEvent(aggregateEvent('edit_regen', { phase: 'regen_completed', duration_ms: 100 }))).toEqual([
    { kind: 'counter', metric: 'edit_regen_completed', count: 1 },
  ])
  expect(incrementsForEvent(aggregateEvent('edit_regen', { phase: 'history_only' }))).toEqual([
    { kind: 'counter', metric: 'edit_history_only', count: 1 },
  ])
})

test('edit events with out-of-schema props increment nothing', () => {
  expect(incrementsForEvent(aggregateEvent('edit_regen', { phase: 'nope' }))).toEqual([])
})
```

Mirror the file's existing event-fixture helper and counter-shape assertion (`counter(...)` may carry a `count` field only when > 1 — copy the neighboring expected objects verbatim).

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/analytics/normalizer-props-derived.test.ts tests/analytics/aggregate.test.ts`
Expected: FAIL — `edit_classified`/`edit_regen` unknown to the switch/schema (falls to default or throws).

- [ ] **Step 4: Register everything**

a. `src/analytics/controlled-types.ts` — add to `EventNameV1Schema` enum: `'edit_classified'`, `'edit_regen'` (keep alphabetical or existing grouping). Add to `AggregateCounterV1Schema` enum: `'edit_classified_w1'`, `'edit_classified_w2'`, `'edit_classified_w3'`, `'edit_prompt_shown'`, `'edit_prompt_adjust'`, `'edit_prompt_note'`, `'edit_regen_started'`, `'edit_regen_completed'`, `'edit_regen_failed'`, `'edit_history_only'`.

b. `src/analytics/event-props-common.ts` — add next to `TurnSteeredPropsSchema`:

```ts
const EditClassifiedPropsSchema = z
  .object({
    window: z.enum(['w1', 'w2', 'w3']),
  })
  .strict()

const EditRegenPropsSchema = z
  .object({
    phase: z.enum([
      'prompt_shown',
      'prompt_adjust',
      'prompt_note',
      'regen_started',
      'regen_completed',
      'regen_failed',
      'history_only',
    ]),
    duration_ms: NonNegativeInt.optional(),
  })
  .strict()
```

and register both in the `propsByEventName` map: `edit_classified: EditClassifiedPropsSchema,` and `edit_regen: EditRegenPropsSchema,`.

c. `src/analytics/source-facts-boundary.ts` — add:

```ts
export type EditClassifiedFact = FactBase &
  Readonly<{
    type: 'edit_classified'
    window: string
  }>

export type EditRegenFact = FactBase &
  Readonly<{
    type: 'edit_regen'
    phase: string
    durationMs?: number
  }>
```

d. `src/analytics/source-facts.ts` — import both types from `./source-facts-boundary.js`, add them to the `AnalyticsSourceFact` union (line ~123), and re-export them alongside the other boundary fact re-exports (lines 15 and 72 pattern).

e. `src/analytics/registry.ts` — add `'edit'` to `SourceFamilyV1Schema` (after `'rephrase'`).

f. `src/analytics/registry-events.ts` — add after `rephrase_detected` (or nearest RQ4 entry):

```ts
  edit_classified: {
    privacyClass: 'C0',
    sourceFamily: 'edit',
    metricMapping: { counters: ['edit_classified_w1', 'edit_classified_w2', 'edit_classified_w3'] as const, histograms: [] as const },
    rqCoverage: ['RQ4'] as const,
  },
  edit_regen: {
    privacyClass: 'C0',
    sourceFamily: 'edit',
    metricMapping: {
      counters: [
        'edit_prompt_shown',
        'edit_prompt_adjust',
        'edit_prompt_note',
        'edit_regen_started',
        'edit_regen_completed',
        'edit_regen_failed',
        'edit_history_only',
      ] as const,
      histograms: [] as const,
    },
    rqCoverage: ['RQ4'] as const,
  },
```

g. `src/analytics/normalizer-props-derived.ts` — add builders and switch cases:

```ts
const buildEditClassified = (fact: ValidatedFactRecord): Result => {
  const window = parseEnum(propsByEventName.edit_classified.shape.window, fact['window'])
  if (window === null) return propsRejected('unknown_enum')
  return propsOk({ window })
}

const buildEditRegen = (fact: ValidatedFactRecord): Result => {
  const phase = parseEnum(propsByEventName.edit_regen.shape.phase, fact['phase'])
  if (phase === null) return propsRejected('unknown_enum')
  const rawDuration = fact['durationMs']
  if (rawDuration === undefined) return propsOk({ phase })
  const durationMs = nonNegativeInt(rawDuration)
  if (durationMs === null) return propsRejected('invalid_value')
  return propsOk({ phase, duration_ms: durationMs })
}
```

Switch cases inside `buildDerivedFamilyProps`:

```ts
    case 'edit_classified':
      return buildEditClassified(fact)
    case 'edit_regen':
      return buildEditRegen(fact)
```

h. `src/analytics/aggregate.ts` — add and wire `editIncrements`:

```ts
const editIncrements = (event: AnalyticsEventV1): readonly AggregateIncrement[] | null => {
  const name = event.event.name
  if (name === 'edit_classified') {
    const p = parseWith(propsByEventName.edit_classified, event.props)
    if (p === null) return []
    return [counter(p.window === 'w1' ? 'edit_classified_w1' : p.window === 'w2' ? 'edit_classified_w2' : 'edit_classified_w3')]
  }
  if (name === 'edit_regen') {
    const p = parseWith(propsByEventName.edit_regen, event.props)
    if (p === null) return []
    if (p.phase === 'prompt_shown') return [counter('edit_prompt_shown')]
    if (p.phase === 'prompt_adjust') return [counter('edit_prompt_adjust')]
    if (p.phase === 'prompt_note') return [counter('edit_prompt_note')]
    if (p.phase === 'regen_started') return [counter('edit_regen_started')]
    if (p.phase === 'regen_completed') return [counter('edit_regen_completed')]
    if (p.phase === 'regen_failed') return [counter('edit_regen_failed')]
    return [counter('edit_history_only')]
  }
  return null
}
```

Wire into `incrementsForEvent`:

```ts
export const incrementsForEvent = (event: AnalyticsEventV1): readonly AggregateIncrement[] =>
  messageIncrements(event) ??
  executionIncrements(event) ??
  boundaryIncrements(event) ??
  derivedIncrements(event) ??
  editIncrements(event) ??
  []
```

i. `src/analytics/jobs/snapshot-props.ts` — add to `PROP_EXTRACTIONS` (near the other `textProp` entries):

```ts
  textProp('window'),
  textProp('phase'),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/analytics/normalizer-props-derived.test.ts tests/analytics/aggregate.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the registry-driven sweeps**

Run: `bun test tests/analytics/contracts.test.ts tests/analytics/registry-closure.test.ts tests/analytics/privacy-contract.test.ts tests/analytics/eligibility-matrix.test.ts tests/analytics/jobs/snapshot-props.test.ts tests/analytics/jobs/snapshot-schema.test.ts && bun run typecheck && bun run lint`
Expected: PASS (new events flow through the closure/fuzz/canary/matrix suites automatically); clean; clean. If a snapshot test asserts the exact `PROP_EXTRACTIONS` list, update that expectation to include `window`/`phase`.

- [ ] **Step 7: Commit**

```bash
git add src/analytics/controlled-types.ts src/analytics/event-props-common.ts src/analytics/source-facts-boundary.ts src/analytics/source-facts.ts src/analytics/registry.ts src/analytics/registry-events.ts src/analytics/normalizer-props-derived.ts src/analytics/aggregate.ts src/analytics/jobs/snapshot-props.ts tests/analytics/normalizer-props-derived.test.ts tests/analytics/aggregate.test.ts
git commit -m "feat(analytics): register edit_classified and edit_regen events"
```

---

### Task 2: `edit-observer.ts` builders + `edit_classified`/`history_only` emission in handle.ts

**Files:**
- Create: `src/analytics/edit-observer.ts`
- Modify: `src/message-edit/handle.ts`
- Test: `tests/analytics/edit-observer.test.ts` (create)
- Test: `tests/message-edit/handle.test.ts`

**Interfaces:**
- Consumes: Task 1's `EditClassifiedFact`/`EditRegenFact` (types only — runtime validation happens in the normalizer); `buildAnalyticsSourceContext` + `createAuthorizedTurnSeed` + `AuthorizedTurnSeed` from `../analytics/bot-observer.js` (already imported in `handle.ts`); `AnalyticsObserver` from `../analytics/runtime.js`.
- Produces:
  - `buildEditSeed(msg: IncomingMessage, auth: AuthorizationResult): AuthorizedTurnSeed | undefined`
  - `observeEditClassified(observer: AnalyticsObserver, seed: AuthorizedTurnSeed, window: 'w1' | 'w2' | 'w3'): void`
  - `observeEditRegen(observer: AnalyticsObserver, seed: AuthorizedTurnSeed, phase: EditRegenPhase, durationMs?: number): void`
  - `EditRegenPhase = 'prompt_shown' | 'prompt_adjust' | 'prompt_note' | 'regen_started' | 'regen_completed' | 'regen_failed' | 'history_only'`
  - Task 3 consumes all four.

- [ ] **Step 1: Write the failing builder tests**

Create `tests/analytics/edit-observer.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildEditRegenFact, buildEditClassifiedFact } from '../../src/analytics/edit-observer.js'
import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'

const source = { actorRole: 'member', rawTurnId: 't-1' } as AnalyticsSourceContext

describe('buildEditClassifiedFact', () => {
  test('builds a w2 classification fact', () => {
    const fact = buildEditClassifiedFact(source, { sourceEventId: 'evt-1:edit_classified', window: 'w2' })
    expect(fact).toMatchObject({ version: 1, type: 'edit_classified', sourceEventId: 'evt-1:edit_classified', window: 'w2', source })
  })
})

describe('buildEditRegenFact', () => {
  test('omits durationMs when not provided', () => {
    const fact = buildEditRegenFact(source, { sourceEventId: 'evt-1:edit_regen_prompt_shown', phase: 'prompt_shown' })
    expect(fact).toMatchObject({ version: 1, type: 'edit_regen', phase: 'prompt_shown' })
    expect('durationMs' in fact).toBe(false)
  })

  test('carries durationMs when provided', () => {
    const fact = buildEditRegenFact(source, { sourceEventId: 'evt-1:edit_regen_regen_completed', phase: 'regen_completed', durationMs: 4200 })
    expect(fact).toMatchObject({ phase: 'regen_completed', durationMs: 4200 })
  })
})
```

- [ ] **Step 2: Write the failing handle.ts emission tests**

Add to `tests/message-edit/handle.test.ts`. First a shared recorder helper (place near the other helpers; the file already imports `AnalyticsSourceFact` — add `import type { AnalyticsObserver } from '../../src/analytics/runtime.js'` and `import { lastTurnRegistry } from '../../src/run-control/last-turn-registry.js'` if not already imported):

```ts
const recordFacts = (): { observer: AnalyticsObserver; facts: AnalyticsSourceFact[] } => {
  const facts: AnalyticsSourceFact[] = []
  return {
    facts,
    observer: {
      observe: (fact: AnalyticsSourceFact): void => {
        facts.push(fact)
      },
      flush: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    },
  }
}

const regenPhases = (facts: AnalyticsSourceFact[]): string[] =>
  facts.filter((fact) => fact.type === 'edit_regen').map((fact) => (fact as { phase: string }).phase)
```

Then the tests (seeding helpers `cacheObservedIncomingMessage`, `appendHistory`, `makeUserTurn`, `runRegistry.begin`, `authFor`, `scopedDm`, `addUser`, `createDmMessage`, `createMockReply` already exist in this file — the W1 test shows the W1 setup, the W3 test shows the W3 setup):

```ts
test('W1 emits edit_classified w1 alongside the steer fact', async () => {
  const ctxId = scopedDm('w1-classified-user')
  addUser({ userId: 'w1-classified-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
  const original: IncomingMessage = { ...createDmMessage('w1-classified-user'), text: 'hello', messageId: 'm1' }
  cacheObservedIncomingMessage(original, authFor(ctxId))
  await flushPendingWrites()
  appendHistory(ctxId, [makeUserTurn('m1', 'hello')])
  const { reply } = createMockReply()
  runRegistry.begin(ctxId, { turnId: 't-classified', reply, originatingMessageIds: ['m1'] })
  const { observer, facts } = recordFacts()
  const edited: IncomingMessage = { ...createDmMessage('w1-classified-user'), text: 'hi', messageId: 'm1', editedAt: 1 }
  await onIncomingEdit(chat, edited, reply, { analyticsObserver: observer })
  const classified = facts.filter((fact) => fact.type === 'edit_classified')
  expect(classified).toHaveLength(1)
  expect(classified[0]).toMatchObject({ window: 'w1' })
  runRegistry.end(ctxId)
})

test('W2 no-side-effects emits edit_classified w2 plus the regen funnel', async () => {
  const ctxId = scopedDm('w2-classified-user')
  addUser({ userId: 'w2-classified-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
  const original: IncomingMessage = { ...createDmMessage('w2-classified-user'), text: 'hello', messageId: 'm1' }
  cacheObservedIncomingMessage(original, authFor(ctxId))
  await flushPendingWrites()
  appendHistory(ctxId, [makeUserTurn('m1', 'hello')])
  lastTurnRegistry.record(ctxId, { originatingMessageIds: ['m1'], completedEffects: [], finishedAt: Date.now() })
  const { reply } = createMockReply()
  const { observer, facts } = recordFacts()
  const edited: IncomingMessage = { ...createDmMessage('w2-classified-user'), text: 'hi', messageId: 'm1', editedAt: 2 }
  await onIncomingEdit(chat, edited, reply, { processMessage: () => Promise.resolve(), analyticsObserver: observer })
  const classified = facts.filter((fact) => fact.type === 'edit_classified')
  expect(classified).toHaveLength(1)
  expect(classified[0]).toMatchObject({ window: 'w2' })
  expect(regenPhases(facts)).toEqual(['regen_started', 'regen_completed'])
})

test('W3 emits edit_classified w3 and no regen facts', async () => {
  const ctxId = scopedDm('w3-classified-user')
  addUser({ userId: 'w3-classified-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
  const original: IncomingMessage = { ...createDmMessage('w3-classified-user'), text: 'first', messageId: 'm1' }
  cacheObservedIncomingMessage(original, authFor(ctxId))
  await flushPendingWrites()
  appendHistory(ctxId, [makeUserTurn('m1', 'first')])
  const { reply } = createMockReply()
  const { observer, facts } = recordFacts()
  const edited: IncomingMessage = { ...createDmMessage('w3-classified-user'), text: 'second', messageId: 'm1', editedAt: 1 }
  await onIncomingEdit(chat, edited, reply, { analyticsObserver: observer })
  const classified = facts.filter((fact) => fact.type === 'edit_classified')
  expect(classified).toHaveLength(1)
  expect(classified[0]).toMatchObject({ window: 'w3' })
  expect(regenPhases(facts)).toEqual([])
})

test('a same-text no-op edit emits no facts', async () => {
  const ctxId = scopedDm('w-noop-user')
  addUser({ userId: 'w-noop-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
  const original: IncomingMessage = { ...createDmMessage('w-noop-user'), text: 'same', messageId: 'm1' }
  cacheObservedIncomingMessage(original, authFor(ctxId))
  await flushPendingWrites()
  const { reply } = createMockReply()
  const { observer, facts } = recordFacts()
  const edited: IncomingMessage = { ...createDmMessage('w-noop-user'), text: 'same', messageId: 'm1', editedAt: 2 }
  await onIncomingEdit(chat, edited, reply, { analyticsObserver: observer })
  expect(facts).toHaveLength(0)
})

test('W2 without processMessage emits edit_regen history_only and skips regen', async () => {
  const ctxId = scopedDm('w2-history-user')
  addUser({ userId: 'w2-history-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
  const original: IncomingMessage = { ...createDmMessage('w2-history-user'), text: 'hello', messageId: 'm1' }
  cacheObservedIncomingMessage(original, authFor(ctxId))
  await flushPendingWrites()
  appendHistory(ctxId, [makeUserTurn('m1', 'hello')])
  lastTurnRegistry.record(ctxId, { originatingMessageIds: ['m1'], completedEffects: [], finishedAt: Date.now() })
  const { reply } = createMockReply()
  const { observer, facts } = recordFacts()
  const edited: IncomingMessage = { ...createDmMessage('w2-history-user'), text: 'hi', messageId: 'm1', editedAt: 2 }
  await onIncomingEdit(chat, edited, reply, { analyticsObserver: observer })
  expect(regenPhases(facts)).toEqual(['history_only'])
})
```

Note: `lastTurnRegistry.record(ctxId, { originatingMessageIds, completedEffects, finishedAt })` — check the `LastTurn` type (`src/run-control/last-turn-registry.ts`) for whether `replyTarget` is optional; the existing side-effects tests pass one, the no-side-effects path never reads it (guarded by `!== undefined`). If the type requires it, add `replyTarget: undefined`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/analytics/edit-observer.test.ts tests/message-edit/handle.test.ts`
Expected: FAIL — `edit-observer.js` does not exist; no facts emitted.

- [ ] **Step 4: Implement `src/analytics/edit-observer.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { performance } from 'node:perf_hooks'

import type { AuthorizationResult, IncomingMessage } from '../chat/types.js'
import { buildAnalyticsSourceContext, createAuthorizedTurnSeed } from './bot-observer.js'
import type { AuthorizedTurnSeed } from './bot-observer.js'
import type { AnalyticsObserver } from './runtime.js'
import type { EditClassifiedFact, EditRegenFact } from './source-facts-boundary.js'

export type EditWindow = 'w1' | 'w2' | 'w3'

export type EditRegenPhase =
  | 'prompt_shown'
  | 'prompt_adjust'
  | 'prompt_note'
  | 'regen_started'
  | 'regen_completed'
  | 'regen_failed'
  | 'history_only'

export function buildEditSeed(msg: IncomingMessage, auth: AuthorizationResult): AuthorizedTurnSeed | undefined {
  const source = buildAnalyticsSourceContext(msg, auth, 'normal', null)
  if (source === null) return undefined
  return createAuthorizedTurnSeed(source, msg, 0, {
    nowMs: () => Date.now(),
    nowMonotonicMs: () => performance.now(),
  })
}

export function buildEditClassifiedFact(
  source: AuthorizedTurnSeed['source'],
  input: Readonly<{ sourceEventId: string; window: EditWindow }>,
): EditClassifiedFact {
  return {
    version: 1,
    type: 'edit_classified',
    sourceEventId: input.sourceEventId,
    occurredAtMs: Date.now(),
    source,
    window: input.window,
  }
}

export function buildEditRegenFact(
  source: AuthorizedTurnSeed['source'],
  input: Readonly<{ sourceEventId: string; phase: EditRegenPhase; durationMs?: number }>,
): EditRegenFact {
  return {
    version: 1,
    type: 'edit_regen',
    sourceEventId: input.sourceEventId,
    occurredAtMs: Date.now(),
    source,
    phase: input.phase,
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
  }
}

export function observeEditClassified(observer: AnalyticsObserver, seed: AuthorizedTurnSeed, window: EditWindow): void {
  observer.observe(buildEditClassifiedFact(seed.source, { sourceEventId: `${seed.sourceEventId}:edit_classified`, window }))
}

export function observeEditRegen(
  observer: AnalyticsObserver,
  seed: AuthorizedTurnSeed,
  phase: EditRegenPhase,
  durationMs?: number,
): void {
  observer.observe(
    buildEditRegenFact(seed.source, {
      sourceEventId: `${seed.sourceEventId}:edit_regen_${phase}`,
      phase,
      ...(durationMs === undefined ? {} : { durationMs }),
    }),
  )
}
```

- [ ] **Step 5: Emit from `handle.ts`**

In `src/message-edit/handle.ts`:

a. Import: `import { buildEditSeed, observeEditClassified, observeEditRegen } from '../analytics/edit-observer.js'`

b. In `onIncomingEdit`, immediately after `const window = classifyEdit({...})` (before the debug log), insert:

```ts
  const observer = deps.analyticsObserver
  const editSeed = observer === undefined ? undefined : buildEditSeed(msg, auth)
  if (observer !== undefined && editSeed !== undefined) {
    observeEditClassified(observer, editSeed, window)
  }
```

c. In `handleW2`'s missing-`processMessage` branch, emit `history_only`. `handleW2` does not currently receive the seed — change its signature to accept it and update the call site (`onIncomingEdit`):

```ts
// call site
  if (window === 'w2' && lastTurn !== undefined) {
    await handleW2(chat, msg, reply, auth, lastTurn, deps, editSeed)
  }

// signature + branch
async function handleW2(
  _chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  last: LastTurn,
  deps: EditHandlerDeps,
  editSeed: AuthorizedTurnSeed | undefined,
): Promise<void> {
  if (last.completedEffects.length > 0) {
    await handleW2WithSideEffects(msg, reply, auth, last, deps)
    return
  }
  if (deps.processMessage === undefined) {
    log.warn(
      { storageContextId: auth.storageContextId, messageId: msg.messageId },
      'W2 regeneration requested but processMessage is not wired into deps; skipping',
    )
    const observer = deps.analyticsObserver
    if (observer !== undefined && editSeed !== undefined) observeEditRegen(observer, editSeed, 'history_only')
    return
  }
  await regenerateFromEditedText(msg, reply, auth, last, deps)
}
```

Add the `AuthorizedTurnSeed` type import from `../analytics/bot-observer.js`.

Note: `regenerateFromEditedText`'s own `processMessage === undefined` guard (w2-regen.ts:37) is unreachable from `handleW2` (already guarded) — leave it untouched; Task 3 handles the w2-regen emissions.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/analytics/edit-observer.test.ts tests/message-edit/ && bun run typecheck && bun run lint`
Expected: PASS; clean; clean.

- [ ] **Step 7: Commit**

```bash
git add src/analytics/edit-observer.ts src/message-edit/handle.ts tests/analytics/edit-observer.test.ts tests/message-edit/handle.test.ts
git commit -m "feat(analytics): emit edit_classified across edit windows"
```

---

### Task 3: W2 regen funnel emission in w2-regen.ts

**Files:**
- Modify: `src/message-edit/w2-regen.ts`
- Test: `tests/message-edit/handle-w2-sideeffects.test.ts`

**Interfaces:**
- Consumes: Task 2's `buildEditSeed`, `observeEditRegen` from `../analytics/edit-observer.js`; `deps.analyticsObserver` (already on `EditHandlerDeps`).
- Produces: funnel facts `prompt_shown`, `prompt_adjust`, `prompt_note`, `regen_started`, `regen_completed` (+`durationMs`), `regen_failed` (+`durationMs`), `history_only` (no-buttons path). No new exports.

- [ ] **Step 1: Write the failing funnel tests**

Add to `tests/message-edit/handle-w2-sideeffects.test.ts`. The file already has every fixture needed: `buildCapturingReply()`, `buildProcessSpy(calls)`, `peekEditPrompt`, `lastTurnRegistry.record(ctxId, { originatingMessageIds, completedEffects: [{ toolName: 'create_task' }], replyTarget, finishedAt })`, and the `scopedDm`/`authFor`/`makeUserTurn`/`cacheObservedIncomingMessage` seeding pattern. Add the same `recordFacts`/`regenPhases` helpers as in `handle.test.ts` (import `AnalyticsSourceFact` from `../../src/analytics/source-facts.js` and `AnalyticsObserver` from `../../src/analytics/runtime.js`), then:

```ts
test('posts the ask-first prompt and emits prompt_shown', async () => {
  const ctxId = scopedDm('w2-shown-user')
  addUser({ userId: 'w2-shown-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
  const original: IncomingMessage = { ...createDmMessage('w2-shown-user'), text: 'create my task', messageId: 'm1' }
  cacheObservedIncomingMessage(original, authFor(ctxId))
  await flushPendingWrites()
  appendHistory(ctxId, [makeUserTurn('m1', 'create my task')])
  const replyTarget: ReplyTarget = { platform: 'telegram', ref: { messageId: 50, chatId: 1 } }
  lastTurnRegistry.record(ctxId, {
    originatingMessageIds: ['m1'],
    completedEffects: [{ toolName: 'create_task' }],
    replyTarget,
    finishedAt: Date.now(),
  })
  const processCalls: ProcessCall[] = []
  const { reply } = buildCapturingReply()
  const { observer, facts } = recordFacts()
  const edited: IncomingMessage = { ...createDmMessage('w2-shown-user'), text: 'create my other task', messageId: 'm1', editedAt: 2 }
  await onIncomingEdit(chat, edited, reply, { processMessage: buildProcessSpy(processCalls), analyticsObserver: observer })
  expect(processCalls.length).toBe(0)
  expect(regenPhases(facts)).toEqual(['prompt_shown'])
})

test('adjust emits prompt_adjust then the regen funnel with durationMs', async () => {
  const ctxId = scopedDm('w2-adj-facts-user')
  addUser({ userId: 'w2-adj-facts-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
  const original: IncomingMessage = { ...createDmMessage('w2-adj-facts-user'), text: 'do thing', messageId: 'm1' }
  cacheObservedIncomingMessage(original, authFor(ctxId))
  await flushPendingWrites()
  appendHistory(ctxId, [makeUserTurn('m1', 'do thing')])
  const replyTarget: ReplyTarget = { platform: 'telegram', ref: { messageId: 7 } }
  lastTurnRegistry.record(ctxId, {
    originatingMessageIds: ['m1'],
    completedEffects: [{ toolName: 'create_task' }],
    replyTarget,
    finishedAt: Date.now(),
  })
  const processCalls: ProcessCall[] = []
  const { reply, buttonCalls } = buildCapturingReply()
  const { observer, facts } = recordFacts()
  const edited: IncomingMessage = { ...createDmMessage('w2-adj-facts-user'), text: 'do better thing', messageId: 'm1', editedAt: 2 }
  await onIncomingEdit(chat, edited, reply, { processMessage: buildProcessSpy(processCalls), analyticsObserver: observer })
  const adjustButton = buttonCalls[0]!.options.buttons!.find((b) => b.callbackData.startsWith('edit:adjust:'))!
  const prompt = peekEditPrompt(adjustButton.callbackData.replace('edit:adjust:', ''))
  expect(prompt).toBeDefined()
  await prompt!.onAdjust()
  const regenFacts = facts.filter((fact) => fact.type === 'edit_regen')
  expect(regenPhases(facts)).toEqual(['prompt_shown', 'prompt_adjust', 'regen_started', 'regen_completed'])
  const completed = regenFacts[3] as { durationMs?: number }
  expect(completed.durationMs).toBeDefined()
  expect(Number.isInteger(completed.durationMs)).toBe(true)
  expect(completed.durationMs).toBeGreaterThanOrEqual(0)
})

test('note emits prompt_note and never regens', async () => {
  const ctxId = scopedDm('w2-note-facts-user')
  addUser({ userId: 'w2-note-facts-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
  const original: IncomingMessage = { ...createDmMessage('w2-note-facts-user'), text: 'do thing', messageId: 'm1' }
  cacheObservedIncomingMessage(original, authFor(ctxId))
  await flushPendingWrites()
  appendHistory(ctxId, [makeUserTurn('m1', 'do thing')])
  lastTurnRegistry.record(ctxId, {
    originatingMessageIds: ['m1'],
    completedEffects: [{ toolName: 'create_task' }],
    finishedAt: Date.now(),
  })
  const processCalls: ProcessCall[] = []
  const { reply, buttonCalls } = buildCapturingReply()
  const { observer, facts } = recordFacts()
  const edited: IncomingMessage = { ...createDmMessage('w2-note-facts-user'), text: 'do better thing', messageId: 'm1', editedAt: 2 }
  await onIncomingEdit(chat, edited, reply, { processMessage: buildProcessSpy(processCalls), analyticsObserver: observer })
  const noteButton = buttonCalls[0]!.options.buttons!.find((b) => b.callbackData.startsWith('edit:note:'))!
  const prompt = peekEditPrompt(noteButton.callbackData.replace('edit:note:', ''))
  expect(prompt).toBeDefined()
  await prompt!.onNote()
  expect(processCalls.length).toBe(0)
  expect(regenPhases(facts)).toEqual(['prompt_shown', 'prompt_note'])
})

test('a processMessage failure emits regen_failed with durationMs and rethrows', async () => {
  const ctxId = scopedDm('w2-fail-user')
  addUser({ userId: 'w2-fail-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
  const original: IncomingMessage = { ...createDmMessage('w2-fail-user'), text: 'hello', messageId: 'm1' }
  cacheObservedIncomingMessage(original, authFor(ctxId))
  await flushPendingWrites()
  appendHistory(ctxId, [makeUserTurn('m1', 'hello')])
  lastTurnRegistry.record(ctxId, { originatingMessageIds: ['m1'], completedEffects: [], finishedAt: Date.now() })
  const { reply } = buildCapturingReply()
  const { observer, facts } = recordFacts()
  const failing: ProcessMessageFn = () => Promise.reject(new Error('llm boom'))
  const edited: IncomingMessage = { ...createDmMessage('w2-fail-user'), text: 'hi', messageId: 'm1', editedAt: 2 }
  await expect(onIncomingEdit(chat, edited, reply, { processMessage: failing, analyticsObserver: observer })).rejects.toThrow(
    'llm boom',
  )
  const regenFacts = facts.filter((fact) => fact.type === 'edit_regen')
  expect(regenPhases(facts)).toEqual(['regen_started', 'regen_failed'])
  const failed = regenFacts[1] as { durationMs?: number }
  expect(failed.durationMs).toBeDefined()
  expect(Number.isInteger(failed.durationMs)).toBe(true)
})

test('no-buttons platform emits history_only and no prompt_shown', async () => {
  const ctxId = scopedDm('w2-nobtn-user')
  addUser({ userId: 'w2-nobtn-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
  const original: IncomingMessage = { ...createDmMessage('w2-nobtn-user'), text: 'do thing', messageId: 'm1' }
  cacheObservedIncomingMessage(original, authFor(ctxId))
  await flushPendingWrites()
  appendHistory(ctxId, [makeUserTurn('m1', 'do thing')])
  lastTurnRegistry.record(ctxId, {
    originatingMessageIds: ['m1'],
    completedEffects: [{ toolName: 'create_task' }],
    finishedAt: Date.now(),
  })
  const { reply } = buildCapturingReply()
  const noButtons: ReplyFn = {
    ...reply,
    buttons: (): Promise<undefined> => Promise.reject(new Error('platform has no buttons')),
  }
  const { observer, facts } = recordFacts()
  const edited: IncomingMessage = { ...createDmMessage('w2-nobtn-user'), text: 'do better thing', messageId: 'm1', editedAt: 2 }
  await onIncomingEdit(chat, edited, noButtons, { processMessage: buildProcessSpy([]), analyticsObserver: observer })
  expect(regenPhases(facts)).toEqual(['history_only'])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/message-edit/handle-w2-sideeffects.test.ts`
Expected: FAIL — no `edit_regen` facts observed.

- [ ] **Step 3: Implement the emissions in `src/message-edit/w2-regen.ts`**

a. Imports:

```ts
import { performance } from 'node:perf_hooks'

import { buildEditSeed, observeEditRegen } from '../analytics/edit-observer.js'
```

b. `regenerateFromEditedText` — wrap the regen with started/completed/failed (the existing `processMessage === undefined` guard stays untouched):

```ts
export async function regenerateFromEditedText(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  last: LastTurn,
  deps: EditHandlerDeps,
): Promise<void> {
  const processMessage = deps.processMessage
  if (processMessage === undefined) {
    log.warn(
      { storageContextId: auth.storageContextId, messageId: msg.messageId },
      'W2 regeneration requested but processMessage is not wired into deps; skipping',
    )
    return
  }
  const orchestratorDeps = {
    ...defaultDeps,
    ...(deps.stagedDownloadFn === undefined ? {} : { stagedDownloadFn: deps.stagedDownloadFn }),
    ...(deps.chatParticipantResolver === undefined ? {} : { chatParticipantResolver: deps.chatParticipantResolver }),
  }
  if (msg.messageId !== undefined) {
    trimTurnForRegeneration(auth.storageContextId, msg.messageId)
  }
  const observer = deps.analyticsObserver
  const editSeed = observer === undefined ? undefined : buildEditSeed(msg, auth)
  const startedMonotonicMs = performance.now()
  if (observer !== undefined && editSeed !== undefined) observeEditRegen(observer, editSeed, 'regen_started')
  try {
    await processMessage(
      reply,
      auth.storageContextId,
      msg.user.id,
      msg.user.username,
      msg.text,
      msg.contextType,
      auth.configContextId,
      orchestratorDeps,
      [],
      undefined,
      auth.isGuest === true ? 'guest' : 'member',
    )
  } catch (error) {
    if (observer !== undefined && editSeed !== undefined) {
      observeEditRegen(observer, editSeed, 'regen_failed', performance.now() - startedMonotonicMs)
    }
    throw error
  }
  if (reply.editReply !== undefined && last.replyTarget !== undefined) {
    await reply.editReply(last.replyTarget, '⟲ Superseded by your edit.').catch((): undefined => undefined)
  }
  if (observer !== undefined && editSeed !== undefined) {
    observeEditRegen(observer, editSeed, 'regen_completed', performance.now() - startedMonotonicMs)
  }
}
```

c. `handleW2WithSideEffects` — emit after the prompt-post outcome:

```ts
export async function handleW2WithSideEffects(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  last: LastTurn,
  deps: EditHandlerDeps,
): Promise<void> {
  const promptId = randomUUID()
  const promptText = buildSideEffectsPromptText(last.completedEffects, msg.text)
  registerEditPrompt(promptId, buildEditPromptHandlers(msg, reply, auth, last, deps))
  const handle = await postSideEffectsPrompt(reply, auth, msg, promptText, promptId)
  const observer = deps.analyticsObserver
  const editSeed = observer === undefined ? undefined : buildEditSeed(msg, auth)
  if (handle === undefined) {
    log.debug(
      { storageContextId: auth.storageContextId, messageId: msg.messageId },
      'Platform has no buttons for the W2 side-effects prompt; edit left as history-only',
    )
    if (observer !== undefined && editSeed !== undefined) observeEditRegen(observer, editSeed, 'history_only')
    return
  }
  if (observer !== undefined && editSeed !== undefined) observeEditRegen(observer, editSeed, 'prompt_shown')
}
```

d. `buildEditPromptHandlers` — emit the decision phases:

```ts
    onAdjust: async (): Promise<void> => {
      const observer = deps.analyticsObserver
      const editSeed = observer === undefined ? undefined : buildEditSeed(msg, auth)
      if (observer !== undefined && editSeed !== undefined) observeEditRegen(observer, editSeed, 'prompt_adjust')
      await sendEphemeralAck(reply, auth, '✏️ Adjusting…')
      await regenerateFromEditedText(msg, reply, auth, last, deps)
    },
    onNote: async (): Promise<void> => {
      const observer = deps.analyticsObserver
      const editSeed = observer === undefined ? undefined : buildEditSeed(msg, auth)
      if (observer !== undefined && editSeed !== undefined) observeEditRegen(observer, editSeed, 'prompt_note')
      await sendEphemeralAck(reply, auth, '✏️ Noted')
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/message-edit/ && bun run typecheck && bun run lint`
Expected: PASS; clean; clean.

- [ ] **Step 5: Commit**

```bash
git add src/message-edit/w2-regen.ts tests/message-edit/handle-w2-sideeffects.test.ts
git commit -m "feat(analytics): emit W2 regen funnel facts"
```

---

### Task 4: Metabase edit-funnel card + catalog amendment + evidence

**Files:**
- Modify: `analytics/metabase/sql/04-reliability-friction-performance.sql` (one UNION ALL card)
- Test: `tests/analytics/metabase-models.test.ts`
- Modify: `docs/research/analytics-metrics/02-metric-catalog.md` (new §14.1 + registry props table rows)
- Modify: `docs/research/analytics-metrics/09-stage-a-evidence.md` (W2 row + gate evidence)

**Interfaces:**
- Consumes: Task 1's counters (`edit_*` in `analytics_daily_counters`) and curated columns (`prop_window`, `prop_phase`, existing `prop_duration_ms`); the spec's Appendix A amendment text (verbatim).
- Produces: the edit-funnel card rows (`row_kind = 'edit_funnel'`), catalog §14.1, evidence entries.

- [ ] **Step 1: Write the failing model test**

In `tests/analytics/metabase-models.test.ts`, mirror an existing model-04 card test (read how the suite seeds snapshot tables and asserts card rows):

```ts
test('model 04 edit_funnel card reports window distribution and funnel counts', () => {
  // seed analytics_daily_counters with edit_classified_w1/w2/w3 and the seven
  // edit funnel counters across two utc days; run model 04; assert one
  // edit_funnel row per (utc_day, metric) with numerator = summed value,
  // availability 'available', suppressed 0, and the honesty columns present.
})
```

Use the suite's existing seeding helpers for `analytics_daily_counters` and its model-runner helper. Write the full body; no outline comments in the committed test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/analytics/metabase-models.test.ts`
Expected: FAIL — no `edit_funnel` rows.

- [ ] **Step 3: Add the edit-funnel card to model 04**

In `analytics/metabase/sql/04-reliability-friction-performance.sql`, add a CTE after `reply_metrics`:

```sql
edit_counters AS (
  SELECT
    utc_day,
    metric,
    SUM(value) AS numerator
  FROM analytics_daily_counters
  WHERE metric IN (
    'edit_classified_w1', 'edit_classified_w2', 'edit_classified_w3',
    'edit_prompt_shown', 'edit_prompt_adjust', 'edit_prompt_note',
    'edit_regen_started', 'edit_regen_completed', 'edit_regen_failed',
    'edit_history_only'
  )
  GROUP BY utc_day, metric
)
```

and append a UNION ALL card (column order must match the existing cards exactly — verify against the `tool_outcome` card):

```sql
UNION ALL

SELECT
  'edit_funnel' AS row_kind,
  edit_counters.metric,
  'available' AS availability,
  NULL AS friction_bit,
  NULL AS p50,
  NULL AS p75,
  NULL AS p90,
  NULL AS p95,
  NULL AS p99,
  NULL AS rate,
  1 AS metric_version,
  edit_counters.utc_day AS window_start_utc,
  edit_counters.utc_day AS window_end_utc,
  edit_counters.numerator,
  NULL AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM edit_counters
CROSS JOIN meta
```

Check against the model's final SELECT whether cards carry a trailing `WHERE meta.snapshot_mode = ...` — aggregate-counter cards must NOT be gated to pseudonymous (the counters exist in both modes); if every existing card is pseudonymous-gated, confirm the model's aggregate-only `unavailable` wrapper still applies and keep the card ungated only if the model's contract allows per-card availability (mirror what model 00 does for its aggregate cards; if model 04's wrapper forces `unavailable` in aggregate mode for all rows, leave the card ungated and let the wrapper mark it, noting the behavior in the test).

- [ ] **Step 4: Run the model tests**

Run: `bun test tests/analytics/metabase-models.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply the catalog amendment**

In `docs/research/analytics-metrics/02-metric-catalog.md`:

a. Insert a new section between §14 (Friction Signature v1) and §15 (Intent taxonomy), titled `## 14.1. Edit handling metrics (standalone friction companions)`, with the Appendix A body text from the spec (verbatim, minus the blockquote).

b. In the registry props table (around line 345, where `rephrase_detected` props are listed), add two rows:

```markdown
| `edit_classified`              | `window: w1\|w2\|w3`                                                                                                                                                                                                                                                                                                               |
| `edit_regen`                   | `phase: prompt_shown\|prompt_adjust\|prompt_note\|regen_started\|regen_completed\|regen_failed\|history_only`; `duration_ms` (optional, regen completed/failed only)                                                                                                                                                                  |
```

- [ ] **Step 6: Update the evidence doc**

In `docs/research/analytics-metrics/09-stage-a-evidence.md`:

a. In the "Message-edit analytics coverage" section's table, change the W2 row's Decision cell to: `**Covered via amendment** (catalog §14.1): edit_classified + edit_regen standalone friction companions; no turn/session/outcome semantics (reserved for a future RQ3 amendment)` and append the implementation commits.

b. Append a gate-evidence row to the "Stage B readiness evidence" table:

```markdown
| Message-edit analytics (edit_classified/edit_regen registration, emission, funnel card) | registry-driven sweeps green (contracts, closure, privacy-contract, eligibility, snapshot props/schema); tests/message-edit + tests/analytics/edit-observer + metabase-models green; typecheck/lint/knip clean | <commits> | 2026-07-29 |
```

(Fill `<commits>` with the four task hashes at execution time.)

- [ ] **Step 7: Full gate**

Run: `bun test tests/analytics tests/message-edit && bun run typecheck && bun run lint && bun security && bun run knip`
Expected: PASS; clean; clean; 0 findings; clean.

- [ ] **Step 8: Commit**

```bash
git add analytics/metabase/sql/04-reliability-friction-performance.sql tests/analytics/metabase-models.test.ts docs/research/analytics-metrics/02-metric-catalog.md docs/research/analytics-metrics/09-stage-a-evidence.md
git commit -m "feat(analytics): add edit funnel to metabase model 04 and catalog amendment"
```

---

## Self-Review Notes

- **Spec coverage:** §1 vocabulary → Task 1; §2 emission points → Tasks 2–3; §3 registration/eligibility/aggregation/metabase → Tasks 1+4; §4 privacy → registry-driven sweeps in Task 1 Step 6; §5 non-goals → catalog amendment in Task 4; §6 error handling → Task 3 (regen_failed before rethrow); §7 testing → per-task steps; §8 rollout/evidence → Task 4.
- **Type consistency:** `EditRegenPhase` (Task 2) matches the props enum (Task 1) exactly; counter names in `aggregate.ts`, `controlled-types.ts`, `registry-events.ts`, and the SQL `IN` list are identical; `prop_window`/`prop_phase` extraction keys match the normalized prop keys (`window`, `phase` — NOT `duration_ms`, which is already extracted as `realProp('duration_ms')`).
- **Fixture risks called out inline:** normalizer/aggregate test helper names (mirror neighboring cases), model-04 snapshot-mode gating nuance (Step 3 instructs verification against the model wrapper), metabase seeding helpers (mirror existing card tests).

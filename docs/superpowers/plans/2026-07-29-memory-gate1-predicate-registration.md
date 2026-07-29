<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Gate 1 Predicate Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the pass predicates for `capture-idempotency`, `races`, and `crash-recovery` in the Gate 0 acceptance registry before Gate 1's design session begins, in a form that a later promotion commit cannot silently soften.

**Architecture:** The Gate 0 registry (`tests/long-term-memory/acceptance/registry.ts`) is plain versioned data with self-enforcing invariants in `registry.test.ts`. This plan adds a third criterion status (`predicate-registered`), a `registeredShapes` field for cells a frozen predicate demands but which have no test case yet, and a new append-only `predicate-registrations.ts` log that the registry is checked against verbatim. The four criteria already `implemented` predate the registration mechanism and are exempted by a closed, frozen `GATE0_IMPLEMENTED` list.

**Tech Stack:** Bun test runner (`bun:test`), strict TypeScript, no runtime dependencies. Test-tree changes only.

**Spec:** [`docs/superpowers/specs/2026-07-29-memory-gate1-predicate-registration-design.md`](../specs/2026-07-29-memory-gate1-predicate-registration-design.md)

## Global Constraints

- **No `src/` changes.** This plan touches `tests/long-term-memory/acceptance/**` only. If a step seems to require a production change, stop and escalate — that is a spec violation, not a detail.
- **No criterion is promoted.** At the end of this plan the report still reads `production ready = NO`. Three criteria gain a standard; none gains evidence.
- **No criterion suite is added.** `capture-idempotency`, `races`, and `crash-recovery` must have no `CASES` table when this plan finishes, and Task 3 asserts that.
- Every new file starts with the four-line BUSL header, copied byte-for-byte from `tests/long-term-memory/acceptance/registry.ts` lines 1-4.
- All relative imports use the `.js` extension, including from `.ts` files.
- Never add a lint-disable or type-ignore comment. A hook policy blocks them; fix the underlying issue.
- Predicate strings are **verbatim contract text**. Where this plan gives a predicate string, copy it character for character — including the en-dash in `B1–B5`. Task 3 asserts exact equality between two files; a retyped hyphen fails the build.
- Run tests with `bun test <path>`. The acceptance suite lives under `tests/long-term-memory/acceptance/`.

---

### Task 1: Append-only predicate registration log

Creates the anchor artifact. Standalone: no registry change, so nothing else breaks.

**Files:**

- Create: `tests/long-term-memory/acceptance/predicate-registrations.ts`
- Test: `tests/long-term-memory/acceptance/predicate-registrations.test.ts`

**Interfaces:**

- Consumes: `CriterionKey` and `CRITERION_KEYS` from `./registry.js` (already exported).
- Produces: `PredicateRegistration` type and `PREDICATE_REGISTRATIONS: readonly PredicateRegistration[]`, plus `registrationFor(key: CriterionKey): PredicateRegistration | undefined`. Task 3 consumes all three.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/acceptance/predicate-registrations.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { PREDICATE_REGISTRATIONS, registrationFor } from './predicate-registrations.js'
import { CRITERION_KEYS } from './registry.js'

describe('predicate registration log', () => {
  test('registers exactly the three Gate 1 exit criteria', () => {
    expect(PREDICATE_REGISTRATIONS.map((entry) => entry.criterion).toSorted()).toEqual([
      'capture-idempotency',
      'crash-recovery',
      'races',
    ])
  })

  test('every entry names a known criterion', () => {
    for (const entry of PREDICATE_REGISTRATIONS) {
      expect(CRITERION_KEYS).toContain(entry.criterion)
    }
  })

  test('every entry carries an ISO date and a spec path', () => {
    for (const entry of PREDICATE_REGISTRATIONS) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.spec).toStartWith('docs/superpowers/specs/')
      expect(entry.spec).toEndWith('.md')
    }
  })

  test('every entry carries a non-empty predicate', () => {
    for (const entry of PREDICATE_REGISTRATIONS) {
      expect(entry.predicate.length).toBeGreaterThan(0)
      expect(entry.predicate.trim()).toBe(entry.predicate)
    }
  })

  test('a criterion is registered at most once', () => {
    const keys = PREDICATE_REGISTRATIONS.map((entry) => entry.criterion)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('registrationFor resolves a registered criterion', () => {
    expect(registrationFor('races')?.criterion).toBe('races')
  })

  test('registrationFor returns undefined for an unregistered criterion', () => {
    expect(registrationFor('load')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/acceptance/predicate-registrations.test.ts`

Expected: FAIL — the run errors before any test executes, because `./predicate-registrations.js` does not resolve.

- [ ] **Step 3: Write the registration log**

Create `tests/long-term-memory/acceptance/predicate-registrations.ts`. Copy the three predicate strings exactly:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Append-only log of pass predicates registered BEFORE the criterion's implementation began
 * (`docs/superpowers/specs/2026-07-29-memory-gate1-predicate-registration-design.md`).
 *
 * This file is the anchor that makes the Gate 0 promotion rule binding rather than advisory:
 * `registry.test.ts` asserts that every criterion holding a `passPredicate` matches its entry
 * here verbatim, so a promotion commit cannot soften the bar while flipping the status.
 *
 * NEVER edit an existing entry. A predicate that proves unimplementable as written is
 * superseded by APPENDING a new entry with a later date and a stated reason; the original
 * stays. An in-place edit is invisible in review, which is the failure this file prevents.
 *
 * The predicates below cite observables O1-O6 and fault/interleave boundaries B1-B5. Those are
 * defined in section 1 of the design doc named above, and are binding on Gate 1's design.
 */

import type { CriterionKey } from './registry.js'

export type PredicateRegistration = Readonly<{
  /** ISO date the predicate was frozen. */
  date: string
  criterion: CriterionKey
  /** Repo-relative path of the spec that authored and reviewed this predicate. */
  spec: string
  /** Verbatim contract text. `registry.ts` must carry this string exactly. */
  predicate: string
}>

const GATE1_SPEC = 'docs/superpowers/specs/2026-07-29-memory-gate1-predicate-registration-design.md'

export const PREDICATE_REGISTRATIONS: readonly PredicateRegistration[] = [
  {
    date: '2026-07-29',
    criterion: 'capture-idempotency',
    spec: GATE1_SPEC,
    predicate:
      'Replaying an identical capture input, repeatedly and with ingest order reversed relative to event time, yields exactly one canonical event per idempotency identity, and the projection snapshot after N replays is byte-identical to the snapshot after one. Supersession and validity resolve by event time, never by ingest order. Every suppressed replay is observable as a duplicate suppression, never as a silent success.',
  },
  {
    date: '2026-07-29',
    criterion: 'races',
    spec: GATE1_SPEC,
    predicate:
      'For every interleaving of an erasure request with an in-flight capture of the same subject or evidence, held at B1–B5, the terminal state is erased: no canonical event, outbox item, projection row, or index entry for the tombstoned identity survives, and the losing writer reports a tombstoned suppression or a failure, never success. Concurrent captures of one idempotency identity produce exactly one canonical event. No interleaving reaches a state that neither serial order can reach.',
  },
  {
    date: '2026-07-29',
    criterion: 'crash-recovery',
    spec: GATE1_SPEC,
    predicate:
      'B1 is unreachable: no fault can leave a canonical event without its outbox item, or the reverse. For faults at B2–B5, restart converges the projection snapshot to the fault-free snapshot for the same input; canonical evidence committed before the fault is still enumerable; every outbox item is either complete or pending with its retry visible, never silently dropped; tombstones registered before the fault still suppress recapture after restart; and at-least-once redelivery produces no duplicate canonical event.',
  },
]

/** The most recent registration for a criterion, or undefined when it has none. */
export function registrationFor(key: CriterionKey): PredicateRegistration | undefined {
  return PREDICATE_REGISTRATIONS.findLast((entry) => entry.criterion === key)
}
```

Note `findLast`, not `find`: when an amendment is appended, the latest entry is the live one.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/acceptance/predicate-registrations.test.ts`

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/long-term-memory/acceptance/predicate-registrations.ts tests/long-term-memory/acceptance/predicate-registrations.test.ts
git commit -m "test(memory): add the append-only predicate registration log"
```

---

### Task 2: Tri-state criterion status and registered cells

**Files:**

- Modify: `tests/long-term-memory/acceptance/registry.ts` (`Criterion` type; the `capture-idempotency`, `races`, `crash-recovery` entries; the `duplicate-out-of-order` and `long-horizon` shape blockers)
- Modify: `tests/long-term-memory/acceptance/registry.test.ts`

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: `Criterion.status` widened to `'implemented' | 'predicate-registered' | 'declared-unmet'`; new field `Criterion.registeredShapes: readonly ShapeKey[]`; new exported helper `registeredCriteria(): readonly Criterion[]`. Tasks 3 and 4 consume all of these.

- [ ] **Step 1: Write the failing tests**

In `tests/long-term-memory/acceptance/registry.test.ts`, add these tests inside the existing `describe('acceptance registry contract', ...)` block, after the `'a declared-unmet criterion carries a blocker and a predicate rule, never a predicate'` test:

```typescript
  test('the three Gate 1 exit criteria are predicate-registered', () => {
    for (const key of ['capture-idempotency', 'races', 'crash-recovery'] as const) {
      expect(criterionByKey(key).status).toBe('predicate-registered')
    }
  })

  test('a predicate-registered criterion carries a predicate and its blocker, and no predicate rule', () => {
    const registered = CRITERIA.filter((c) => c.status === 'predicate-registered')
    expect(registered.length).toBeGreaterThan(0)
    for (const criterion of registered) {
      expect(criterion.passPredicate).not.toBeNull()
      expect(criterion.passPredicate).not.toBe('')
      expect(criterion.blocker).not.toBeNull()
      expect(criterion.blocker).not.toBe('')
      expect(criterion.predicateRule).toBeNull()
    }
  })

  test('a predicate-registered criterion declares registered cells and no executed cells', () => {
    for (const criterion of CRITERIA.filter((c) => c.status === 'predicate-registered')) {
      expect(criterion.registeredShapes.length).toBeGreaterThan(0)
      expect(criterion.shapes).toEqual([])
    }
  })

  test('only a predicate-registered criterion declares registered cells', () => {
    for (const criterion of CRITERIA.filter((c) => c.status !== 'predicate-registered')) {
      expect(criterion.registeredShapes).toEqual([])
    }
  })

  test('registeredCriteria returns exactly the predicate-registered criteria', () => {
    expect(registeredCriteria().map((c) => c.key).toSorted()).toEqual([
      'capture-idempotency',
      'crash-recovery',
      'races',
    ])
  })
```

Then widen the existing `'only implemented criteria declare scenario cells'` test, which currently reads `criterion.status === 'implemented'` — it stays correct but says nothing about the new state, so replace its body to be explicit:

```typescript
  test('only implemented criteria declare executed scenario cells', () => {
    for (const criterion of CRITERIA) {
      const expectedNonEmpty = criterion.status === 'implemented'
      expect(criterion.shapes.length > 0).toBe(expectedNonEmpty)
    }
  })
```

Update the import on line 9 to add the two new symbols:

```typescript
import { CRITERIA, CRITERION_KEYS, criterionByKey, registeredCriteria, SHAPE_KEYS, SHAPES } from './registry.js'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/long-term-memory/acceptance/registry.test.ts`

Expected: FAIL. The run errors on the import — `registeredCriteria` is not exported from `./registry.js`. (Typecheck also fails on `criterion.registeredShapes`, which does not exist yet.)

- [ ] **Step 3: Widen the Criterion type**

In `tests/long-term-memory/acceptance/registry.ts`, replace the `Criterion` type (currently lines 72-83) with:

```typescript
export type Criterion = Readonly<{
  key: CriterionKey
  status: 'implemented' | 'predicate-registered' | 'declared-unmet'
  /** Required iff implemented or predicate-registered. The standard this criterion is held to. */
  passPredicate: string | null
  /** Required unless implemented. Why no test body exists yet. */
  blocker: string | null
  /** Required iff declared-unmet. When its predicate must be authored. */
  predicateRule: string | null
  /** Executed criterion x scenario cells. Non-empty iff implemented. */
  shapes: readonly ShapeKey[]
  /**
   * Cells a frozen predicate demands that have no case yet. Non-empty iff predicate-registered.
   * These MAY name shapes that are still `declared-unimplemented`: registering a cell is a
   * promise to build the fixture, not a claim that it exists. Promotion moves keys from here
   * into `shapes`.
   */
  registeredShapes: readonly ShapeKey[]
}>
```

Also update the promotion-rule comment in the module docblock (currently lines 14-18) to describe the three states:

```typescript
 * Promotion rule: a criterion may only reach `implemented` by satisfying a pass predicate
 * written BEFORE its implementation began. A `declared-unmet` criterion therefore carries a
 * `predicateRule` instead of a predicate. Once that predicate is authored in the criterion's
 * own follow-on spec it is appended to `predicate-registrations.ts` and the criterion becomes
 * `predicate-registered`: the bar is frozen, the evidence is still absent. Promotion to
 * `implemented` must satisfy that exact registered predicate — asserted verbatim in
 * `registry.test.ts`.
 * Adding or removing a key here is a deliberate, reviewable edit to a frozen contract.
```

- [ ] **Step 4: Add `registeredShapes: []` to the eight unchanged criteria**

Every entry in `CRITERIA` now needs the new field or the typecheck fails. Add `registeredShapes: [],` immediately after the `shapes:` line of each of these eight: `scope-isolation`, `erasure`, `provenance`, `reproducibility`, `migration`, `backup-restore`, `load`, `reader-quality`.

For example, `scope-isolation` becomes:

```typescript
  {
    key: 'scope-isolation',
    status: 'implemented',
    passPredicate:
      'No record in scope A is reachable from scope B through any channel — personal, group, and thread-scoped reads alike.',
    blocker: null,
    predicateRule: null,
    shapes: ['multilingual', 'multi-party'],
    registeredShapes: [],
  },
```

- [ ] **Step 5: Flip the three Gate 1 exit criteria**

Replace the `capture-idempotency`, `races`, and `crash-recovery` entries in `CRITERIA`. The `blocker` text is unchanged from the current file — registering a predicate does not remove the reason there is no evidence. Copy each predicate exactly as written in Task 1 Step 3:

```typescript
  {
    key: 'capture-idempotency',
    status: 'predicate-registered',
    passPredicate:
      'Replaying an identical capture input, repeatedly and with ingest order reversed relative to event time, yields exactly one canonical event per idempotency identity, and the projection snapshot after N replays is byte-identical to the snapshot after one. Supersession and validity resolve by event time, never by ingest order. Every suppressed replay is observable as a duplicate suppression, never as a silent success.',
    blocker:
      'no content-hash-keyed dedup at the write boundary; content collapse exists only in the LLM-gated group-promotion path',
    predicateRule: null,
    shapes: [],
    registeredShapes: ['duplicate-out-of-order', 'long-horizon'],
  },
```

```typescript
  {
    key: 'races',
    status: 'predicate-registered',
    passPredicate:
      'For every interleaving of an erasure request with an in-flight capture of the same subject or evidence, held at B1–B5, the terminal state is erased: no canonical event, outbox item, projection row, or index entry for the tombstoned identity survives, and the losing writer reports a tombstoned suppression or a failure, never success. Concurrent captures of one idempotency identity produce exactly one canonical event. No interleaving reaches a state that neither serial order can reach.',
    blocker: 'Needs a concurrency harness; forget-versus-ingest interleavings were never executed (05 §Security).',
    predicateRule: null,
    shapes: [],
    registeredShapes: ['adversarial-erasure', 'multi-party'],
  },
```

```typescript
  {
    key: 'crash-recovery',
    status: 'predicate-registered',
    passPredicate:
      'B1 is unreachable: no fault can leave a canonical event without its outbox item, or the reverse. For faults at B2–B5, restart converges the projection snapshot to the fault-free snapshot for the same input; canonical evidence committed before the fault is still enumerable; every outbox item is either complete or pending with its retry visible, never silently dropped; tombstones registered before the fault still suppress recapture after restart; and at-least-once redelivery produces no duplicate canonical event.',
    blocker: 'Needs fault injection between canonical and derivative writes (05 §Crash).',
    predicateRule: null,
    shapes: [],
    registeredShapes: ['long-horizon', 'duplicate-out-of-order'],
  },
```

- [ ] **Step 6: Update the two registered shapes' blockers**

In `SHAPES`, the `duplicate-out-of-order` and `long-horizon` entries still cite the superseded capture-idempotency demotion. Their status stays `declared-unimplemented` — no fixture builder exists for either — but the blocker text must name the registration. Replace both entries:

```typescript
  {
    key: 'duplicate-out-of-order',
    status: 'declared-unimplemented',
    blocker:
      'Registered as a Gate 1 cell for capture-idempotency and crash-recovery; unimplemented until Gate 1 exposes canonical events with idempotency identities and an at-least-once outbox.',
  },
```

```typescript
  {
    key: 'long-horizon',
    status: 'declared-unimplemented',
    blocker:
      'Registered as a Gate 1 cell for capture-idempotency and crash-recovery; unimplemented until Gate 1 exposes the canonical event log. A fixture-bounded version would overstate coverage.',
  },
```

- [ ] **Step 7: Add the `registeredCriteria` helper**

At the end of `tests/long-term-memory/acceptance/registry.ts`, after `implementedShapes()`:

```typescript
export function registeredCriteria(): readonly Criterion[] {
  return CRITERIA.filter((c) => c.status === 'predicate-registered')
}
```

- [ ] **Step 8: Run the full acceptance suite**

Run: `bun test tests/long-term-memory/acceptance/`

Expected: the new registry tests PASS. Two pre-existing tests FAIL, and both are expected at this point — they are fixed in Tasks 3 and 4 respectively:

- `no declared-unmet criterion exports a case table` — passes vacuously but no longer covers the three flipped criteria; broadened in Task 3.
- `states that the contract is versioned and production readiness is not established` in `report.test.ts` — FAILS on `production ready = NO (7 unmet)`, because only four criteria are still `declared-unmet`. Fixed in Task 4.

Confirm the `report.test.ts` failure names the count, and that `registry.test.ts` is fully green. Do not fix the report here.

- [ ] **Step 9: Commit**

```bash
git add tests/long-term-memory/acceptance/registry.ts tests/long-term-memory/acceptance/registry.test.ts
git commit -m "test(memory): add the predicate-registered criterion state"
```

The commit hook runs lint, typecheck, and format on staged files. If format rewrites the long predicate strings, re-stage and re-run — but verify the string contents are byte-identical to Task 1 afterwards.

---

### Task 3: Bind the registry to the registration log verbatim

**Files:**

- Modify: `tests/long-term-memory/acceptance/registry.ts` (add `GATE0_IMPLEMENTED`)
- Modify: `tests/long-term-memory/acceptance/registry.test.ts`

**Interfaces:**

- Consumes: `PREDICATE_REGISTRATIONS`, `registrationFor` from Task 1; `Criterion.registeredShapes` from Task 2.
- Produces: `GATE0_IMPLEMENTED: readonly CriterionKey[]` exported from `./registry.js`. Nothing later consumes it.

- [ ] **Step 1: Write the failing tests**

In `tests/long-term-memory/acceptance/registry.test.ts`, add a new `describe` block at the end of the file:

```typescript
describe('acceptance registry predicate binding', () => {
  test('every criterion holding a predicate matches its registration verbatim', () => {
    const exempt = new Set<CriterionKey>(GATE0_IMPLEMENTED)
    for (const criterion of CRITERIA.filter((c) => c.passPredicate !== null)) {
      if (exempt.has(criterion.key)) continue
      const registration = registrationFor(criterion.key)
      expect(registration).toBeDefined()
      expect(criterion.passPredicate).toBe(registration?.predicate ?? '')
    }
  })

  test('the grandfather exemption is exactly the four Gate 0 criteria', () => {
    expect([...GATE0_IMPLEMENTED].toSorted()).toEqual(['erasure', 'provenance', 'reproducibility', 'scope-isolation'])
  })

  test('every exempt criterion was implemented under the Gate 0 spec', () => {
    for (const key of GATE0_IMPLEMENTED) {
      expect(criterionByKey(key).status).toBe('implemented')
    }
  })

  test('no exempt criterion also carries a registration', () => {
    for (const key of GATE0_IMPLEMENTED) {
      expect(registrationFor(key)).toBeUndefined()
    }
  })

  test('every registration names a criterion that carries its predicate', () => {
    for (const entry of PREDICATE_REGISTRATIONS) {
      expect(criterionByKey(entry.criterion).passPredicate).toBe(entry.predicate)
    }
  })
})
```

Add to the existing `describe('acceptance registry coverage cross-check', ...)` block:

```typescript
  test('a registered cell has no matching case', () => {
    for (const criterion of CRITERIA) {
      const covered = coveredShapes(criterion.key)
      for (const shape of criterion.registeredShapes) {
        expect(covered).not.toContain(shape)
      }
    }
  })

  test('a registered cell may name a shape with no fixture builder yet', () => {
    const registered = new Set(CRITERIA.flatMap((c) => c.registeredShapes))
    expect(registered).toContain('long-horizon')
    expect(SHAPES.find((s) => s.key === 'long-horizon')?.status).toBe('declared-unimplemented')
  })
```

Replace the existing `'no declared-unmet criterion exports a case table'` test, which no longer covers the three flipped criteria:

```typescript
  test('only an implemented criterion exports a case table', () => {
    for (const criterion of CRITERIA.filter((c) => c.status !== 'implemented')) {
      expect(CASE_TABLES[criterion.key]).toBeUndefined()
    }
  })
```

Replace the existing `'no unimplemented shape is claimed by any criterion'` test to name what it is scoped to, since `registeredShapes` deliberately violates the unscoped reading:

```typescript
  test('no unimplemented shape is claimed as an executed cell', () => {
    const executed = new Set(CRITERIA.flatMap((c) => c.shapes))
    for (const shape of SHAPES.filter((s) => s.status === 'declared-unimplemented')) {
      expect(executed.has(shape.key)).toBe(false)
    }
  })
```

Extend the import on line 9 and add the registration import:

```typescript
import { PREDICATE_REGISTRATIONS, registrationFor } from './predicate-registrations.js'
import {
  CRITERIA,
  CRITERION_KEYS,
  type CriterionKey,
  criterionByKey,
  GATE0_IMPLEMENTED,
  registeredCriteria,
  SHAPE_KEYS,
  SHAPES,
} from './registry.js'
```

Use the inline `type` modifier rather than a second `import type` statement from the same module — `import/no-duplicates` rejects two imports of one specifier.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/long-term-memory/acceptance/registry.test.ts`

Expected: FAIL — the run errors on the import, because `GATE0_IMPLEMENTED` is not exported from `./registry.js`.

- [ ] **Step 3: Add the grandfather list**

In `tests/long-term-memory/acceptance/registry.ts`, add after the `SHAPE_KEYS` declaration:

```typescript
/**
 * The four criteria whose predicates were authored in the Gate 0 spec itself, where the promotion
 * rule permitted it because the outcome was already known and uncontested. They have no entry in
 * `predicate-registrations.ts` and are exempt from the verbatim check.
 *
 * Backdating registrations for them was rejected: it would fabricate a pre-registration that never
 * happened, in the one artifact whose entire value is that it does not lie. This list is itself a
 * frozen contract term — `registry.test.ts` asserts its exact contents, so growing it to smuggle a
 * criterion past the verbatim check fails CI.
 */
export const GATE0_IMPLEMENTED: readonly CriterionKey[] = [
  'scope-isolation',
  'erasure',
  'provenance',
  'reproducibility',
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/long-term-memory/acceptance/registry.test.ts tests/long-term-memory/acceptance/predicate-registrations.test.ts`

Expected: PASS.

If `'every criterion holding a predicate matches its registration verbatim'` fails, the two predicate strings differ. Do not edit `predicate-registrations.ts` to match the registry — that is backwards, and the log is append-only. Fix `registry.ts` to match the log.

- [ ] **Step 5: Verify the negative case actually bites**

This is the test that makes the whole mechanism binding, so confirm it can fail. Temporarily change one word in the `races` `passPredicate` in `registry.ts` — for example `never success` to `rarely success`.

Run: `bun test tests/long-term-memory/acceptance/registry.test.ts`

Expected: FAIL on `every criterion holding a predicate matches its registration verbatim` and on `every registration names a criterion that carries its predicate`.

Revert the word. Re-run and confirm PASS before committing.

- [ ] **Step 6: Commit**

```bash
git add tests/long-term-memory/acceptance/registry.ts tests/long-term-memory/acceptance/registry.test.ts
git commit -m "test(memory): bind registered predicates to the append-only log"
```

---

### Task 4: Report the third bucket

**Files:**

- Modify: `tests/long-term-memory/acceptance/report.ts`
- Modify: `tests/long-term-memory/acceptance/report.test.ts`

**Interfaces:**

- Consumes: `Criterion.status` and `Criterion.registeredShapes` from Task 2.
- Produces: nothing consumed downstream. `renderAcceptanceReport()` keeps its signature.

- [ ] **Step 1: Write the failing tests**

In `tests/long-term-memory/acceptance/report.test.ts`, replace the `'states that the contract is versioned and production readiness is not established'` test and add three more:

```typescript
  test('states that the contract is versioned and production readiness is not established', () => {
    const output = renderAcceptanceReport()
    expect(output).toContain('contract versioned = YES')
    expect(output).toContain('production ready = NO (4 implemented, 3 predicate-registered, 4 unmet)')
  })

  test('marks predicate-registered criteria with a distinct glyph', () => {
    const line = renderAcceptanceReport()
      .split('\n')
      .find((row) => row.includes('crash-recovery'))
    expect(line).toStartWith('  [~]')
  })

  test('renders registered cells distinctly from executed cells', () => {
    const output = renderAcceptanceReport()
    const registered = output.split('\n').find((row) => row.includes('capture-idempotency'))
    const executed = output.split('\n').find((row) => row.includes('scope-isolation'))
    expect(registered).toContain('registered cells: duplicate-out-of-order, long-horizon')
    expect(executed).toContain('shapes: multilingual, multi-party')
    expect(registered).not.toContain('shapes:')
  })

  test('still names the blocker of a predicate-registered criterion', () => {
    const line = renderAcceptanceReport()
      .split('\n')
      .find((row) => row.includes('crash-recovery'))
    expect(line).toContain('Needs fault injection')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/long-term-memory/acceptance/report.test.ts`

Expected: FAIL — four failures. The summary line still reads `production ready = NO (4 unmet)`; `crash-recovery` renders with `[!]`; `capture-idempotency` renders no registered cells.

- [ ] **Step 3: Rewrite the criterion renderer and summary**

Replace `criterionLines` and `renderAcceptanceReport` in `tests/long-term-memory/acceptance/report.ts`:

```typescript
const CRITERION_MARKS: Readonly<Record<Criterion['status'], string>> = {
  implemented: 'x',
  'predicate-registered': '~',
  'declared-unmet': '!',
}

const criterionDetail = (criterion: Criterion): string => {
  if (criterion.status === 'implemented') return `shapes: ${coveredShapes(criterion.key).join(', ')}`
  const blocker = `blocker: ${criterion.blocker ?? ''}`
  if (criterion.status === 'declared-unmet') return blocker
  return `registered cells: ${criterion.registeredShapes.join(', ')} — ${blocker}`
}

const criterionLines = (): readonly string[] =>
  CRITERIA.map(
    (criterion) => `  [${CRITERION_MARKS[criterion.status]}] ${criterion.key.padEnd(22)} ${criterionDetail(criterion)}`,
  )

export function renderAcceptanceReport(): string {
  const implemented = CRITERIA.filter((c) => c.status === 'implemented').length
  const registered = CRITERIA.filter((c) => c.status === 'predicate-registered').length
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
    `production ready = NO (${implemented} implemented, ${registered} predicate-registered, ${unmet} unmet)`,
    '',
    'This report is informational. Criterion enforcement lives in',
    'tests/long-term-memory/acceptance/. A criterion is promoted only by satisfying a pass',
    'predicate written before its implementation began — see the design doc.',
    'A [~] criterion has a frozen predicate and no evidence: the cells it lists are promised,',
    'not executed.',
  ].join('\n')
}
```

Update the import on line 13 to bring in the type:

```typescript
import { type Criterion, CRITERIA, SHAPES } from './registry.js'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/long-term-memory/acceptance/report.test.ts`

Expected: PASS, 9 tests.

- [ ] **Step 5: Run the whole acceptance suite and the report script**

Run: `bun test tests/long-term-memory/acceptance/`

Expected: PASS, all files green — no leftover failures from Task 2 Step 8.

Run: `bun run memory:acceptance`

Expected: exit 0. Read the output and confirm by eye that `capture-idempotency`, `races`, and `crash-recovery` render as `[~]` with their registered cells and blockers, that the summary reads `production ready = NO (4 implemented, 3 predicate-registered, 4 unmet)`, and that no line claims readiness.

- [ ] **Step 6: Commit**

```bash
git add tests/long-term-memory/acceptance/report.ts tests/long-term-memory/acceptance/report.test.ts
git commit -m "test(memory): report predicate-registered criteria as a third bucket"
```

---

### Task 5: Record the registration in the roadmap

The roadmap is the single active queue; it must state that Gate 1 now has a frozen bar and an observable contract binding on its design.

**Files:**

- Modify: `docs/superpowers/plans/2026-07-26-memory-production-roadmap.md` (the `### Gate 1: Canonical capture in dark mode` section)

- [ ] **Step 1: Append a status note to the Gate 1 section**

After the existing `**Exit:**` paragraph of the Gate 1 section, insert:

```markdown
**Status (2026-07-29):** the pass predicates for this gate's exit criteria — `capture-idempotency`,
`races`, and `crash-recovery` — are frozen before design, per
`docs/superpowers/specs/2026-07-29-memory-gate1-predicate-registration-design.md`. They are held in
the append-only `tests/long-term-memory/acceptance/predicate-registrations.ts` and asserted verbatim
against the registry, so a promotion commit cannot soften them. The predicates cite six required
observables and five fault/interleave boundaries; those are binding on this gate's design. A
predicate that proves unimplementable as written is superseded by an appended amendment with a
stated reason — never edited in place, and never amended merely to let this gate exit.
```

- [ ] **Step 2: Verify no other roadmap claim went stale**

Run: `grep -n "declared-unmet\|7 unmet\|seven criteria\|four criteria" docs/superpowers/plans/2026-07-26-memory-production-roadmap.md docs/research/agent-memory/implementation-status.md`

The Gate 0 status note says "seven criteria and four shapes are declared with named blockers". That count is still accurate as a statement about what Gate 0 delivered, and the sentence is in the past tense about Gate 0's own scope — leave it. If `implementation-status.md` states a live unmet count as current fact, update it to `4 implemented, 3 predicate-registered, 4 unmet`; if it only points at the roadmap, change nothing.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-26-memory-production-roadmap.md
git commit -m "docs(memory): record the Gate 1 predicate registration in the roadmap"
```

If Step 2 required an `implementation-status.md` edit, stage that file too.

---

## Done when

- `bun test tests/long-term-memory/acceptance/` is green.
- `bun run memory:acceptance` exits 0 and reads `production ready = NO (4 implemented, 3 predicate-registered, 4 unmet)`.
- `git diff --stat master...HEAD -- src/` is empty.
- No `CASES` table exists for `capture-idempotency`, `races`, or `crash-recovery`.

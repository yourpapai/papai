// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { CASE_TABLES, coveredShapes } from './coverage.js'
import { PREDICATE_REGISTRATIONS, type PredicateRegistration, registrationFor } from './predicate-registrations.js'
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
      expect(criterion.passPredicate).not.toBeNull()
      expect(criterion.passPredicate).not.toBe('')
      expect(criterion.blocker).toBeNull()
      expect(criterion.predicateRule).toBeNull()
    }
  })

  test('a declared-unmet criterion carries a blocker and a predicate rule, never a predicate', () => {
    for (const criterion of CRITERIA.filter((c) => c.status === 'declared-unmet')) {
      expect(criterion.passPredicate).toBeNull()
      expect(criterion.blocker).not.toBeNull()
      expect(criterion.blocker).not.toBe('')
      expect(criterion.predicateRule).not.toBeNull()
      expect(criterion.predicateRule).not.toBe('')
    }
  })

  test('the two remaining Gate 1 exit criteria are predicate-registered', () => {
    for (const key of ['races', 'crash-recovery'] as const) {
      expect(criterionByKey(key).status).toBe('predicate-registered')
    }
  })

  test('capture-idempotency was promoted by Gate 1b and now carries executed cells', () => {
    expect(criterionByKey('capture-idempotency').status).toBe('implemented')
    expect(criterionByKey('capture-idempotency').shapes).toEqual(['duplicate-out-of-order', 'long-horizon'])
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
    expect(
      registeredCriteria()
        .map((c) => c.key)
        .toSorted(),
    ).toEqual(['crash-recovery', 'races'])
  })

  test('only implemented criteria declare executed scenario cells', () => {
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

  test('no unimplemented shape is claimed as an executed cell', () => {
    const executed = new Set(CRITERIA.flatMap((c) => c.shapes))
    for (const shape of SHAPES.filter((s) => s.status === 'declared-unimplemented')) {
      expect(executed.has(shape.key)).toBe(false)
    }
  })

  test('an unimplemented shape names its blocker', () => {
    for (const shape of SHAPES.filter((s) => s.status === 'declared-unimplemented')) {
      expect(shape.blocker).not.toBeNull()
      expect(shape.blocker).not.toBe('')
    }
  })
})

describe('acceptance registry coverage cross-check', () => {
  test('every implemented criterion exports a case table', () => {
    for (const criterion of CRITERIA.filter((c) => c.status === 'implemented')) {
      expect(CASE_TABLES[criterion.key]).toBeDefined()
    }
  })

  test('only an implemented criterion exports a case table', () => {
    for (const criterion of CRITERIA.filter((c) => c.status !== 'implemented')) {
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

  test('a registered cell has no matching case', () => {
    for (const criterion of CRITERIA) {
      const covered = coveredShapes(criterion.key)
      for (const shape of criterion.registeredShapes) {
        expect(covered).not.toContain(shape)
      }
    }
  })

  test('a registered cell names a shape, whether or not that shape has a fixture yet', () => {
    const registered = new Set(CRITERIA.flatMap((c) => c.registeredShapes))
    expect(registered.size).toBeGreaterThan(0)
    for (const shape of registered) expect(SHAPE_KEYS).toContain(shape)
  })
})

const GATE0_IMPLEMENTED_SET = new Set<CriterionKey>(GATE0_IMPLEMENTED)

function isPredicateCheckable(criterion: { key: CriterionKey; passPredicate: string | null }): boolean {
  return criterion.passPredicate !== null && !GATE0_IMPLEMENTED_SET.has(criterion.key)
}

function predicateOf(registration: PredicateRegistration | undefined): string | null {
  return registration === undefined ? null : registration.predicate
}

describe('acceptance registry predicate binding', () => {
  test('every criterion holding a predicate matches its registration verbatim', () => {
    for (const criterion of CRITERIA.filter(isPredicateCheckable)) {
      const registration = registrationFor(criterion.key)
      expect(registration).toBeDefined()
      expect(criterion.passPredicate).toBe(predicateOf(registration))
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

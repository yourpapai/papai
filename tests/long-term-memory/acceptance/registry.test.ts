// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { CASE_TABLES, coveredShapes } from './coverage.js'
import { CRITERIA, CRITERION_KEYS, criterionByKey, registeredCriteria, SHAPE_KEYS, SHAPES } from './registry.js'

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
    expect(
      registeredCriteria()
        .map((c) => c.key)
        .toSorted(),
    ).toEqual(['capture-idempotency', 'crash-recovery', 'races'])
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

  test('no unimplemented shape is claimed by any criterion', () => {
    const declared = new Set(CRITERIA.flatMap((c) => c.shapes))
    for (const shape of SHAPES.filter((s) => s.status === 'declared-unimplemented')) {
      expect(declared.has(shape.key)).toBe(false)
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

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
      expect(shape.blocker).not.toBeNull()
      expect(shape.blocker).not.toBe('')
    }
  })
})

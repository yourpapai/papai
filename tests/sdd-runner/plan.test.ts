// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { PlanSchema, topoSortChildren, validatePlan } from '../../sdd-runner/src/plan.js'
import type { PlanChild } from '../../sdd-runner/src/plan.js'

interface ChildInput {
  readonly id: string
  readonly instruction: string
  readonly deps: string[]
}

function child(id: string, deps: string[] = []): ChildInput {
  return { id, instruction: `do ${id}`, deps }
}

function ids(children: readonly PlanChild[]): string[] {
  return children.map((entry) => entry.id)
}

function validationError(input: unknown): string {
  try {
    validatePlan(input)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected validatePlan to reject the plan')
}

describe('PlanSchema', () => {
  it('defaults an omitted deps array to empty and leaves capabilities optional', () => {
    const plan = PlanSchema.parse({
      children: [{ id: 'alpha', instruction: 'do alpha' }],
    })
    expect(plan).toEqual({
      children: [{ id: 'alpha', instruction: 'do alpha', deps: [] }],
    })
  })

  it('keeps capabilities when present', () => {
    const plan = PlanSchema.parse({
      children: [{ id: 'alpha', instruction: 'do alpha', capabilities: ['codeindex'] }],
    })
    expect(plan.children[0]?.capabilities).toEqual(['codeindex'])
  })

  it('rejects a child with an empty id', () => {
    expect(() => PlanSchema.parse({ children: [{ id: '', instruction: 'do x' }] })).toThrow()
  })

  it('rejects a child with an empty instruction', () => {
    expect(() => PlanSchema.parse({ children: [{ id: 'alpha', instruction: '' }] })).toThrow()
  })

  it('rejects a plan with no children', () => {
    expect(() => PlanSchema.parse({ children: [] })).toThrow()
  })

  it('accepts an eight-child plan — no upper bound', () => {
    const children = Array.from({ length: 8 }, (_, index) => child(`step-${index + 1}`))
    const plan = PlanSchema.parse({ children })
    expect(plan.children).toHaveLength(8)
  })
})

describe('validatePlan', () => {
  it('returns the normalized plan when the structure is sound', () => {
    const plan = validatePlan({
      children: [child('alpha'), child('beta', ['alpha'])],
    })
    expect(plan).toEqual({
      children: [
        { id: 'alpha', instruction: 'do alpha', deps: [] },
        { id: 'beta', instruction: 'do beta', deps: ['alpha'] },
      ],
    })
  })

  it('rejects duplicate ids in a single error naming every duplicate', () => {
    const message = validationError({
      children: [child('alpha'), child('beta'), child('alpha'), child('beta')],
    })
    expect(message).toMatch(/duplicate/u)
    expect(message).toContain('alpha')
    expect(message).toContain('beta')
  })

  it('rejects unknown deps in a single error naming every unknown dep', () => {
    const message = validationError({
      children: [child('alpha'), child('beta', ['ghost', 'phantom'])],
    })
    expect(message).toMatch(/unknown/u)
    expect(message).toContain('ghost')
    expect(message).toContain('phantom')
  })

  it('rejects self-dependencies in a single error naming every self-dependent id', () => {
    const message = validationError({
      children: [child('alpha', ['alpha']), child('beta', ['beta']), child('gamma')],
    })
    expect(message).toMatch(/self/u)
    expect(message).toContain('alpha')
    expect(message).toContain('beta')
    expect(message).not.toContain('gamma')
  })

  it('accumulates every violation class into one error', () => {
    const message = validationError({
      children: [child('alpha'), child('alpha'), child('beta', ['ghost'])],
    })
    expect(message).toMatch(/duplicate/u)
    expect(message).toMatch(/unknown/u)
    expect(message).toContain('alpha')
    expect(message).toContain('ghost')
  })
})

describe('topoSortChildren', () => {
  it('orders every dependency before its dependent regardless of declaration order', () => {
    const sorted = topoSortChildren({
      children: [child('beta', ['alpha']), child('alpha')],
    })
    expect(ids(sorted)).toEqual(['alpha', 'beta'])
  })

  it('returns declaration order when children are independent', () => {
    const sorted = topoSortChildren({
      children: [child('n2'), child('n1'), child('n0')],
    })
    expect(ids(sorted)).toEqual(['n2', 'n1', 'n0'])
  })

  it('breaks ready-set ties by declaration index', () => {
    const sorted = topoSortChildren({
      children: [
        child('delta', ['beta', 'gamma']),
        child('beta', ['alpha']),
        child('gamma', ['alpha']),
        child('alpha'),
      ],
    })
    expect(ids(sorted)).toEqual(['alpha', 'beta', 'gamma', 'delta'])
  })

  it('throws naming the leftover set — cycle members and their dependents — on a cycle', () => {
    const cyclic = {
      children: [child('alpha', ['beta']), child('beta', ['alpha']), child('gamma', ['alpha']), child('delta')],
    }
    expect(() => topoSortChildren(cyclic)).toThrow(/^dependency cycle among: alpha, beta, gamma$/u)
  })
})

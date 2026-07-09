// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createModuleEligibilityRegistry, moduleEligibilityRegistry } from '../../src/ports/module-eligibility.js'

describe('moduleEligibilityRegistry', () => {
  test('defaults to eligible for a module with no predicate', () => {
    const reg = createModuleEligibilityRegistry()
    expect(reg.isEligible('coding', 'ctx-1')).toBe(true)
  })

  test('consults the registered predicate', () => {
    const reg = createModuleEligibilityRegistry()
    reg.register('coding', (ctx) => ctx === 'ctx-ok')
    expect(reg.isEligible('coding', 'ctx-ok')).toBe(true)
    expect(reg.isEligible('coding', 'ctx-no')).toBe(false)
  })

  test('clear removes predicates (back to default-eligible)', () => {
    const reg = createModuleEligibilityRegistry()
    reg.register('coding', () => false)
    reg.clear()
    expect(reg.isEligible('coding', 'ctx-1')).toBe(true)
  })

  test('exposes a shared singleton', () => {
    expect(typeof moduleEligibilityRegistry.isEligible).toBe('function')
  })
})

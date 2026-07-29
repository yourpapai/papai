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
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
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

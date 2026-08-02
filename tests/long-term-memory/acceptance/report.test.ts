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
    expect(renderAcceptanceReport()).toContain('Needs fault injection')
  })

  test('states that the contract is versioned and production readiness is not established', () => {
    const output = renderAcceptanceReport()
    expect(output).toContain('contract versioned = YES')
    expect(output).toContain('production ready = NO (5 implemented, 2 predicate-registered, 4 unmet)')
  })

  test('marks predicate-registered criteria with a distinct glyph', () => {
    const line = renderAcceptanceReport()
      .split('\n')
      .find((row) => row.includes('crash-recovery'))
    expect(line).toStartWith('  [~]')
  })

  test('renders registered cells distinctly from executed cells', () => {
    const output = renderAcceptanceReport()
    const registered = output.split('\n').find((row) => row.includes('crash-recovery'))
    const executed = output.split('\n').find((row) => row.includes('capture-idempotency'))
    expect(registered).toContain('registered cells: long-horizon, duplicate-out-of-order')
    expect(executed).toContain('shapes: duplicate-out-of-order, long-horizon')
    expect(registered).not.toContain('shapes:')
  })

  test('still names the blocker of a predicate-registered criterion', () => {
    const line = renderAcceptanceReport()
      .split('\n')
      .find((row) => row.includes('crash-recovery'))
    expect(line).toContain('Needs fault injection')
  })

  test('renders the unimplemented shapes with their blockers', () => {
    const output = renderAcceptanceReport()
    for (const key of ['abstention', 'contradiction']) {
      expect(output).toContain(key)
    }
  })

  test('never prints a readiness verdict beyond the counts', () => {
    expect(renderAcceptanceReport()).not.toContain('PASS')
  })
})

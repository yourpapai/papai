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
    expect(output).toContain('production ready = NO (7 unmet)')
  })

  test('renders the unimplemented shapes with their blockers', () => {
    const output = renderAcceptanceReport()
    for (const key of ['long-horizon', 'abstention', 'duplicate-out-of-order', 'contradiction']) {
      expect(output).toContain(key)
    }
  })

  test('never prints a readiness verdict beyond the counts', () => {
    expect(renderAcceptanceReport()).not.toContain('PASS')
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  makeAdminLlmSnapshot,
  makeBillingDetail,
  makeBillingSubject,
  makeGlobalStats,
} from '../../../../client/stories/fixtures/index.js'

describe('fixture factories', () => {
  test('makeBillingSubject returns a valid subject with overrides applied', () => {
    const subject = makeBillingSubject({ displayName: 'alice' })
    expect(subject.displayName).toBe('alice')
    expect(subject.contextType).toBeDefined()
    expect(subject.totals.main.inputTokens).toBeGreaterThanOrEqual(0)
    expect(subject.totals.main.calls).toBeGreaterThanOrEqual(0)
  })

  test('makeBillingDetail composes a detail around a subject', () => {
    const detail = makeBillingDetail()
    expect(detail.subject.storageContextId).toBeDefined()
    expect(Array.isArray(detail.requests)).toBe(true)
    expect(detail.truncated).toBe(false)
  })

  test('makeGlobalStats produces a fully-populated snapshot', () => {
    const stats = makeGlobalStats()
    expect(stats.subjects.dmTotal).toBeGreaterThanOrEqual(0)
    expect(stats.active.activeIn1d).toBeGreaterThanOrEqual(0)
    expect(stats.llmUsage.totalCalls).toBeGreaterThanOrEqual(0)
  })

  test('makeAdminLlmSnapshot reports all 5 keys', () => {
    const snap = makeAdminLlmSnapshot()
    expect(snap.llm_apikey).toBeDefined()
    expect(snap.main_model).toBeDefined()
    expect(snap.embedding_model).toBeDefined()
  })
})

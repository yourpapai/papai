// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import assert from 'node:assert/strict'

import { evaluateForCompaction } from '../../../src/tools/compaction/size-gate.js'

describe('evaluateForCompaction', () => {
  it('does not compact small results', () => {
    expect(evaluateForCompaction({ ok: 1 }).compact).toBe(false)
  })

  it('compacts results over the byte threshold', () => {
    const big = { rows: Array.from({ length: 2000 }, (_, i) => ({ i, v: 'xxxxxxxxxx' })) }
    const out = evaluateForCompaction(big)
    expect(out.compact).toBe(true)
    assert.ok(out.compact)
    expect(out.totalBytes).toBeGreaterThan(8_000)
  })

  it('never compacts a tool-failure result', () => {
    const failure = {
      success: false,
      error: 'boom',
      toolName: 't',
      toolCallId: 'c',
      timestamp: 'now',
      errorType: 'tool-execution',
      errorCode: 'unknown',
      userMessage: 'u',
      agentMessage: 'a',
      retryable: false,
      padding: 'z'.repeat(20_000),
    }
    expect(evaluateForCompaction(failure).compact).toBe(false)
  })

  it('never re-compacts an already-compacted envelope', () => {
    const env = { _compacted: true, handle: 'res_x', summary: null, totalBytes: 99_999, preview: 'p', hint: 'h' }
    expect(evaluateForCompaction(env).compact).toBe(false)
  })

  it('skips non-serializable results', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(evaluateForCompaction(circular).compact).toBe(false)
  })

  it('skips null and undefined', () => {
    expect(evaluateForCompaction(null).compact).toBe(false)
    expect(evaluateForCompaction(undefined).compact).toBe(false)
  })
})

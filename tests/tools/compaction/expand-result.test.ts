// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { makeExpandResultTool } from '../../../src/tools/compaction/expand-result.js'
import {
  putResult,
  clearResultStoreForTesting,
  setResultStoreClockForTesting,
} from '../../../src/tools/compaction/result-store.js'
import { getToolExecutor } from '../../utils/test-helpers.js'

function isPageResult(v: unknown): v is { chunk: string; done: boolean } {
  return typeof v === 'object' && v !== null && 'chunk' in v && 'done' in v
}

function isFailureResult(v: unknown): v is { success: boolean; errorCode: string; retryable: boolean } {
  return typeof v === 'object' && v !== null && 'success' in v && 'errorCode' in v && 'retryable' in v
}

describe('expand_result tool', () => {
  beforeEach(() => {
    clearResultStoreForTesting()
    setResultStoreClockForTesting(() => 1_000)
  })

  it('pages a stored result', async () => {
    const handle = putResult('ctx-1', 'abcdefghij')
    const exec = getToolExecutor(makeExpandResultTool('ctx-1'))
    const out: unknown = await exec({ handle, offset: 0, limit: 4 })
    assert(isPageResult(out), 'Expected a page result')
    expect(out.chunk).toBe('abcd')
    expect(out.done).toBe(false)
  })

  it('returns a structured failure for an unknown handle', async () => {
    const exec = getToolExecutor(makeExpandResultTool('ctx-1'))
    const out: unknown = await exec({ handle: 'res_missing' })
    assert(isFailureResult(out), 'Expected a structured failure result')
    expect(out.success).toBe(false)
    expect(out.errorCode).toBe('expired')
    expect(out.retryable).toBe(true)
  })
})

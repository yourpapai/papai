// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, beforeEach, mock } from 'bun:test'
import assert from 'node:assert/strict'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import {
  clearResultStoreForTesting,
  setResultStoreClockForTesting,
} from '../../../src/tools/compaction/result-store.js'
import { isCompactedEnvelope } from '../../../src/tools/compaction/types.js'
import { applyResultCompaction } from '../../../src/tools/compaction/wrap-compaction.js'
import { getToolExecutor } from '../../utils/test-helpers.js'

function toolReturning(value: unknown): ToolSet[string] {
  return tool({ description: 'x', inputSchema: z.object({}), execute: () => Promise.resolve(value) })
}

const summarizerDeps = {
  summarize: mock((): Promise<{ summary: string | null }> => Promise.resolve({ summary: 'SUMMARY' })),
}

describe('applyResultCompaction', () => {
  beforeEach(() => {
    clearResultStoreForTesting()
    setResultStoreClockForTesting(() => 1_000)
    summarizerDeps.summarize.mockReset()
    summarizerDeps.summarize.mockImplementation(() => Promise.resolve({ summary: 'SUMMARY' }))
  })

  const ctx = { storageContextId: 'ctx-1', userIntent: 'find things', enabled: true }
  const big = { rows: Array.from({ length: 2000 }, (_, i) => ({ i, v: 'xxxxxxxxxx' })) }

  it('returns the same toolset reference when disabled (no wrapping)', () => {
    const tools = { t: toolReturning({ ok: 1 }) }
    const out = applyResultCompaction(tools, { storageContextId: 'c', userIntent: 'x', enabled: false }, summarizerDeps)
    expect(out).toBe(tools)
  })

  it('passes through unchanged when disabled', async () => {
    const wrapped = applyResultCompaction({ t: toolReturning(big) }, { ...ctx, enabled: false }, summarizerDeps)
    const out = await getToolExecutor(wrapped['t']!)({})
    expect(isCompactedEnvelope(out)).toBe(false)
  })

  it('does not compact small results', async () => {
    const wrapped = applyResultCompaction({ t: toolReturning({ ok: 1 }) }, ctx, summarizerDeps)
    const out = await getToolExecutor(wrapped['t']!)({})
    expect(out).toEqual({ ok: 1 })
  })

  it('compacts large results into an envelope with a summary and handle', async () => {
    const wrapped = applyResultCompaction({ t: toolReturning(big) }, ctx, summarizerDeps)
    const out = await getToolExecutor(wrapped['t']!)({})
    expect(isCompactedEnvelope(out)).toBe(true)
    assert.ok(isCompactedEnvelope(out))
    expect(out.summary).toBe('SUMMARY')
    expect(out.handle).toMatch(/^res_/u)
    expect(out.totalBytes).toBeGreaterThan(8_000)
  })

  it('falls back to truncation (summary null) when summarizer returns null', async () => {
    summarizerDeps.summarize.mockImplementation(() => Promise.resolve({ summary: null }))
    const wrapped = applyResultCompaction({ t: toolReturning(big) }, ctx, summarizerDeps)
    const out = await getToolExecutor(wrapped['t']!)({})
    expect(isCompactedEnvelope(out)).toBe(true)
    assert.ok(isCompactedEnvelope(out))
    expect(out.summary).toBeNull()
    expect(out.preview.length).toBeGreaterThan(0)
  })

  it('never wraps expand_result', async () => {
    const wrapped = applyResultCompaction({ expand_result: toolReturning(big) }, ctx, summarizerDeps)
    const out = await getToolExecutor(wrapped['expand_result']!)({})
    expect(isCompactedEnvelope(out)).toBe(false)
  })
})

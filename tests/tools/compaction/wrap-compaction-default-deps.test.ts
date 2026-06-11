// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// This suite exercises the `deps ?? buildTurnDeps(ctx.storageContextId)` lazy path
// in applyResultCompaction. All other suites supply explicit deps; this file
// intentionally omits them.
//
// A top-level mock.module is required to make buildSummarizerDeps return null
// (unconfigured), which exercises the truncation fallback path.  The mock must be
// installed before any import of the module under test, so it lives at the top level
// and this file has its own mock.module boundary (separate from wrap-compaction.test.ts).

import { describe, expect, it, mock } from 'bun:test'
import assert from 'node:assert/strict'

import type { LlmConfigMissing } from '../../../src/llm-config-resolver.js'

void mock.module('../../../src/llm-config-resolver.js', () => ({
  resolveEffectiveLlmConfig: (): LlmConfigMissing => ({
    ok: false,
    type: 'missing',
    source: 'global',
    missing: ['llm_apikey'],
  }),
}))

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

const big = { rows: Array.from({ length: 2000 }, (_, i) => ({ i, v: 'xxxxxxxxxx' })) }

describe('applyResultCompaction — default deps (no explicit summarizer)', () => {
  it('produces a compacted envelope with summary:null when deps are omitted and config is unconfigured', async () => {
    clearResultStoreForTesting()
    setResultStoreClockForTesting(() => 1_000)

    const ctx = { storageContextId: 'ctx-default', userIntent: 'find things', enabled: true }
    const wrapped = applyResultCompaction({ t: toolReturning(big) }, ctx)

    const out = await getToolExecutor(wrapped['t']!)({})

    expect(isCompactedEnvelope(out)).toBe(true)
    assert.ok(isCompactedEnvelope(out))
    // With null summarizer deps, summarizeResult returns { summary: null } → truncation fallback
    expect(out.summary).toBeNull()
    expect(out.preview.length).toBeGreaterThan(0)
    expect(out.handle).toMatch(/^res_/u)
    expect(out.totalBytes).toBeGreaterThan(8_000)
  })
})

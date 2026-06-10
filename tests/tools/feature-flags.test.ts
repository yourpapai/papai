// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/tools/feature-flags.test.ts
import { describe, expect, it, mock, beforeEach } from 'bun:test'

const getCachedConfig = mock((_c: string, _k: string): string | null => null)
void mock.module('../../src/cache.js', () => ({ getCachedConfig }))

const { resolveReductionFlags } = await import('../../src/tools/feature-flags.js')

describe('resolveReductionFlags', () => {
  beforeEach(() => {
    getCachedConfig.mockReset()
    getCachedConfig.mockImplementation(() => null)
    delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
  })

  it('defaults every flag to false when no config present', () => {
    const flags = resolveReductionFlags('ctx-1')
    expect(flags).toEqual({
      progressiveDisclosure: false,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
  })

  it('reads per-context overrides from the reserved key', () => {
    getCachedConfig.mockReturnValue(JSON.stringify({ result_compaction: true }))
    expect(resolveReductionFlags('ctx-1').resultCompaction).toBe(true)
  })

  it('kill switch forces every flag OFF regardless of config', () => {
    process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] = 'true'
    getCachedConfig.mockImplementation(() => JSON.stringify({ result_compaction: true, progressive_disclosure: true }))
    expect(resolveReductionFlags('ctx-1')).toEqual({
      progressiveDisclosure: false,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
  })

  it('ignores corrupt JSON and returns all-false', () => {
    getCachedConfig.mockImplementation(() => '{not json')
    expect(resolveReductionFlags('ctx-1').resultCompaction).toBe(false)
  })
})

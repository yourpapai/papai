// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, mock, beforeEach } from 'bun:test'

import { toScopedThreadContextId, getConfigContextIdFromStorageContextId } from '../../src/chat/scoped-context.js'

const getCachedConfig = mock((_c: string, _k: string): string | null => null)
void mock.module('../../src/cache.js', () => ({ getCachedConfig }))

const { resolveReductionFlags, REDUCTION_FLAGS_CONFIG_KEY } = await import('../../src/tools/feature-flags.js')

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
    expect(getCachedConfig).toHaveBeenCalledWith(expect.any(String), REDUCTION_FLAGS_CONFIG_KEY)
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
    expect(resolveReductionFlags('ctx-1')).toEqual({
      progressiveDisclosure: false,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
  })

  it('passes the derived config context id (not the thread-scoped id) to getCachedConfig', () => {
    const threadScopedId = toScopedThreadContextId({
      platformInstanceId: 'plat-1',
      nativeContextId: 'grp-42',
      threadId: 'thread-7',
    })
    const expectedConfigContextId = getConfigContextIdFromStorageContextId(threadScopedId)
    resolveReductionFlags(threadScopedId)
    expect(getCachedConfig).toHaveBeenCalledWith(expectedConfigContextId, REDUCTION_FLAGS_CONFIG_KEY)
  })
})

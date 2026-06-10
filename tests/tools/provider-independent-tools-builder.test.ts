// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, mock, beforeEach } from 'bun:test'

import type { ToolSet } from 'ai'

import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const resolveReductionFlags = mock(() => ({
  progressiveDisclosure: false,
  resultCompaction: false,
  semanticToolRetrieval: false,
}))
void mock.module('../../src/tools/feature-flags.js', () => ({
  resolveReductionFlags,
  REDUCTION_FLAGS_CONFIG_KEY: 'tool_context_flags',
}))

const { addProviderIndependentTools } = await import('../../src/tools/provider-independent-tools-builder.js')

const baseOpts = {
  chatUserId: 'u1',
  contextId: 'u1',
  mode: 'normal' as const,
  contextType: 'dm' as const,
  username: null,
  stagedDownloadFn: undefined,
}

describe('expand_result registration', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resolveReductionFlags.mockReset()
  })

  it('omits expand_result when compaction flag is OFF', () => {
    resolveReductionFlags.mockReturnValue({
      progressiveDisclosure: false,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, baseOpts)
    expect(tools['expand_result']).toBeUndefined()
  })

  it('adds expand_result when compaction flag is ON', () => {
    resolveReductionFlags.mockReturnValue({
      progressiveDisclosure: false,
      resultCompaction: true,
      semanticToolRetrieval: false,
    })
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, baseOpts)
    expect(tools['expand_result']).toBeDefined()
  })
})

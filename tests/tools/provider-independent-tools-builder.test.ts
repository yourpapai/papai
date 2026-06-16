// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import type { ToolSet } from 'ai'

import { setCachedConfig } from '../../src/cache.js'
import { REDUCTION_FLAGS_CONFIG_KEY } from '../../src/tools/feature-flags.js'
import { addProviderIndependentTools } from '../../src/tools/provider-independent-tools-builder.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const COMPACTION_ON = JSON.stringify({ result_compaction: true })
const CROSS_THREAD_ON = JSON.stringify({ cross_thread_memory: true })

// Unique context per test: the in-memory config cache outlives individual tests.
const optsFor = (
  contextId: string,
  mode: 'normal' | 'proactive' = 'normal',
  contextType: 'dm' | 'group' = 'dm',
): Parameters<typeof addProviderIndependentTools>[1] => ({
  chatUserId: contextId,
  contextId,
  mode,
  contextType,
  username: null,
  stagedDownloadFn: undefined,
})

describe('expand_result registration', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
  })

  it('omits expand_result when compaction flag is OFF', () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-off'))
    expect(tools['expand_result']).toBeUndefined()
  })

  it('adds expand_result when compaction flag is ON', () => {
    setCachedConfig('pitb-on', REDUCTION_FLAGS_CONFIG_KEY, COMPACTION_ON)
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-on'))
    expect(tools['expand_result']).toBeDefined()
  })

  it('omits expand_result in proactive mode even when compaction flag is ON', () => {
    setCachedConfig('pitb-proactive', REDUCTION_FLAGS_CONFIG_KEY, COMPACTION_ON)
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-proactive', 'proactive'))
    expect(tools['expand_result']).toBeUndefined()
  })
})

describe('recall registration', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
  })

  it('omits recall when cross_thread_memory flag is OFF (default)', () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-recall-off', 'normal', 'group'))
    expect(tools['recall']).toBeUndefined()
  })

  it('registers recall when flag is ON, mode is normal, and contextType is group', () => {
    setCachedConfig('pitb-recall-on', REDUCTION_FLAGS_CONFIG_KEY, CROSS_THREAD_ON)
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-recall-on', 'normal', 'group'))
    expect(tools['recall']).toBeDefined()
  })

  it('omits recall in proactive mode even when flag is ON', () => {
    setCachedConfig('pitb-recall-proactive', REDUCTION_FLAGS_CONFIG_KEY, CROSS_THREAD_ON)
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-recall-proactive', 'proactive', 'group'))
    expect(tools['recall']).toBeUndefined()
  })
})

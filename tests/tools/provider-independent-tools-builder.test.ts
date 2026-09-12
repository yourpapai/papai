// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import type { ToolSet } from 'ai'

import { ACTIVITY_NO_INSTANCE_ERROR, ACTIVITY_UNAVAILABLE_ERROR } from '../../src/deferred-prompts/activity-gating.js'
import { addProviderIndependentTools } from '../../src/tools/provider-independent-tools-builder.js'
import { getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'

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
  })

  it('adds expand_result in normal mode', () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-on'))
    expect(tools['expand_result']).toBeDefined()
  })

  it('omits expand_result in proactive mode', () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-proactive', 'proactive'))
    expect(tools['expand_result']).toBeUndefined()
  })
})

describe('search_memory registration', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('registers search_memory in normal mode for a group context', () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-mem-group', 'normal', 'group'))
    expect(tools['search_memory']).toBeDefined()
  })

  it('registers search_memory in normal mode for a dm context', () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-mem-dm', 'normal', 'dm'))
    expect(tools['search_memory']).toBeDefined()
  })

  it('registers search_memory in proactive mode (mode-independent)', () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-mem-proactive', 'proactive', 'group'))
    expect(tools['search_memory']).toBeDefined()
  })
})

describe('create_alert activity gating', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('refuses an activity condition when activityAlertsEnabled is omitted', async () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, optsFor('pitb-act-default'))
    const execute = getToolExecutor(tools['create_alert'])
    const result = await execute({ prompt: 'Notify me', condition: { kind: 'activity', taskId: 'task-1' } })
    expect(result).toEqual({ error: ACTIVITY_UNAVAILABLE_ERROR })
  })

  it('plumbs an explicit activityAlertsEnabled through to the tool', async () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, { ...optsFor('pitb-act-on'), activityAlertsEnabled: true })
    const execute = getToolExecutor(tools['create_alert'])
    const result = await execute({ prompt: 'Notify me', condition: { kind: 'activity', taskId: 'task-1' } })
    expect(result).toEqual({ error: ACTIVITY_NO_INSTANCE_ERROR })
  })
})

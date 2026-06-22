// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { buildPromptSurfaceModel } from '../../src/prompt-surface/model.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('buildPromptSurfaceModel', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('derives capability domains from enabled tool names', () => {
    const model = buildPromptSurfaceModel({
      mode: 'task-provider',
      contextType: 'dm',
      contextId: 'ctx-model-capabilities',
      enabledToolNames: new Set(['create_task', 'web_fetch', 'get_current_time']),
      askPermissionAvailable: true,
      providerAddendum: '',
      pluginGuidance: '',
    })

    expect(model.capabilities.availableDomains).toEqual(['task', 'time', 'web'])
    expect(model.capabilities.enabledToolNames).toEqual(['create_task', 'get_current_time', 'web_fetch'])
    expect(model.capabilities.providerless).toBe(false)
  })

  test('summarizes denied and ask-gated tools', () => {
    setToolPrefs('ctx-model-prefs', {
      domainDefaults: {},
      toolOverrides: { delete_task: 'ask', delete_project: 'deny' },
    })

    const model = buildPromptSurfaceModel({
      mode: 'task-provider',
      contextType: 'dm',
      contextId: 'ctx-model-prefs',
      enabledToolNames: new Set(['create_task', 'delete_task']),
      askPermissionAvailable: true,
      providerAddendum: '',
      pluginGuidance: '',
    })

    expect(model.capabilities.askGatedTools).toEqual(['delete_task'])
    expect(model.capabilities.deniedTools).toEqual(['delete_project'])
  })

  test('selects relevant examples from mode and tools', () => {
    const model = buildPromptSurfaceModel({
      mode: 'providerless',
      contextType: 'dm',
      contextId: 'ctx-model-examples',
      enabledToolNames: new Set(['get_current_time']),
      askPermissionAvailable: true,
      providerAddendum: '',
      pluginGuidance: '',
    })

    expect(model.examples.map((example) => example.id)).toContain('missing-provider-tools')
    expect(model.examples.map((example) => example.id)).not.toContain('ask-gated-tool-permission')
  })

  test('does not select group example for dm task history tools', () => {
    const model = buildPromptSurfaceModel({
      mode: 'task-provider',
      contextType: 'dm',
      contextId: 'ctx-model-dm-history',
      enabledToolNames: new Set(['get_task_history']),
      askPermissionAvailable: true,
      providerAddendum: '',
      pluginGuidance: '',
    })

    expect(model.examples.map((example) => example.id)).not.toContain('group-context-quiet')
  })

  test('selects group example for group context', () => {
    const model = buildPromptSurfaceModel({
      mode: 'task-provider',
      contextType: 'group',
      contextId: 'ctx-model-group',
      enabledToolNames: new Set(['get_current_time']),
      askPermissionAvailable: true,
      providerAddendum: '',
      pluginGuidance: '',
    })

    expect(model.examples.map((example) => example.id)).toContain('group-context-quiet')
  })

  test('uses parent context tool prefs for scoped thread contexts', () => {
    const parentContextId = toScopedContextId({
      platformInstanceId: 'telegram-main',
      nativeContextId: '-100123',
    })
    const threadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-main',
      nativeContextId: '-100123',
      threadId: 'topic-1',
    })
    setToolPrefs(parentContextId, {
      domainDefaults: {},
      toolOverrides: { delete_task: 'ask', delete_project: 'deny' },
    })

    const model = buildPromptSurfaceModel({
      mode: 'task-provider',
      contextType: 'group',
      contextId: threadContextId,
      enabledToolNames: new Set(['create_task', 'delete_task']),
      askPermissionAvailable: true,
      providerAddendum: '',
      pluginGuidance: '',
    })

    expect(model.capabilities.askGatedTools).toEqual(['delete_task'])
    expect(model.capabilities.deniedTools).toEqual(['delete_project'])
  })
})

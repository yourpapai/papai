// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ToolSet } from 'ai'

import { ACTIVITY_UNAVAILABLE_ERROR } from '../../src/deferred-prompts/activity-gating.js'
import { addDeferredPromptTools } from '../../src/tools/deferred-tools-builder.js'
import { getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const STORAGE_OWNER_ID = 'storage-owner-1'
const CHAT_USER_ID = 'chat-user-1'
const CONTEXT_ID = 'ctx-deferred-1'

const EXPECTED_KEYS = [
  'create_reminder',
  'create_alert',
  'list_reminders',
  'get_reminder',
  'update_reminder',
  'cancel_reminder',
] as const

const EXPECTED_KEYS_NO_ALERT = [
  'create_reminder',
  'list_reminders',
  'get_reminder',
  'update_reminder',
  'cancel_reminder',
] as const

describe('addDeferredPromptTools', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('does not add any tools when storageOwnerId is undefined', () => {
    const tools: ToolSet = {}
    addDeferredPromptTools(tools, undefined, CHAT_USER_ID, CONTEXT_ID, 'dm', 'alice')
    expect(Object.keys(tools)).toEqual([])
  })

  test('does not add any tools when chatUserId is undefined', () => {
    const tools: ToolSet = {}
    addDeferredPromptTools(tools, STORAGE_OWNER_ID, undefined, CONTEXT_ID, 'dm', 'alice')
    expect(Object.keys(tools)).toEqual([])
  })

  test('adds all six reminder/alert tools on the happy path', () => {
    const tools: ToolSet = {}
    addDeferredPromptTools(tools, STORAGE_OWNER_ID, CHAT_USER_ID, CONTEXT_ID, 'dm', 'alice')
    expect(Object.keys(tools).toSorted()).toEqual([...EXPECTED_KEYS].toSorted())
  })

  test('omits create_alert when allowTaskConditions is false', () => {
    const tools: ToolSet = {}
    addDeferredPromptTools(tools, STORAGE_OWNER_ID, CHAT_USER_ID, CONTEXT_ID, 'dm', 'alice', false)
    expect(Object.keys(tools).toSorted()).toEqual([...EXPECTED_KEYS_NO_ALERT].toSorted())
    expect(Object.keys(tools)).not.toContain('create_alert')
  })

  test('falls back to storageOwnerId when contextId is undefined', () => {
    const tools: ToolSet = {}
    addDeferredPromptTools(tools, STORAGE_OWNER_ID, CHAT_USER_ID, undefined, 'dm', 'alice')
    expect(Object.keys(tools).toSorted()).toEqual([...EXPECTED_KEYS].toSorted())
  })

  test('falls back to dm context type when contextType is undefined', () => {
    const tools: ToolSet = {}
    addDeferredPromptTools(tools, STORAGE_OWNER_ID, CHAT_USER_ID, CONTEXT_ID, undefined, 'alice')
    expect(Object.keys(tools).toSorted()).toEqual([...EXPECTED_KEYS].toSorted())
  })
})

describe('addDeferredPromptTools — activity alert gating', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('create_alert refuses activity conditions while the flag defaults off', async () => {
    const tools: ToolSet = {}
    addDeferredPromptTools(tools, STORAGE_OWNER_ID, CHAT_USER_ID, CONTEXT_ID, 'dm', 'alice')
    const execute = getToolExecutor(tools['create_alert'])
    const result = await execute({ prompt: 'Notify me', condition: { kind: 'activity', taskId: 'task-1' } })
    expect(result).toEqual({ error: ACTIVITY_UNAVAILABLE_ERROR })
  })
})

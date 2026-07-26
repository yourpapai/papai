// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ToolSet } from 'ai'

import { addDeferredPromptTools } from '../../src/tools/deferred-tools-builder.js'
import { mockLogger } from '../utils/test-helpers.js'

const STORAGE_OWNER_ID = 'storage-owner-1'
const CHAT_USER_ID = 'chat-user-1'
const CONTEXT_ID = 'ctx-deferred-1'

const EXPECTED_KEYS = [
  'create_deferred_prompt',
  'list_deferred_prompts',
  'get_deferred_prompt',
  'update_deferred_prompt',
  'cancel_deferred_prompt',
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

  test('adds all five deferred-prompt tools on the happy path', () => {
    const tools: ToolSet = {}
    addDeferredPromptTools(tools, STORAGE_OWNER_ID, CHAT_USER_ID, CONTEXT_ID, 'dm', 'alice')
    expect(Object.keys(tools).toSorted()).toEqual([...EXPECTED_KEYS].toSorted())
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

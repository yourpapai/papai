// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { ToolSet } from 'ai'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { addProviderIndependentTools } from '../../src/tools/provider-independent-tools-builder.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

const baseOptions = {
  mode: 'normal' as const,
  contextType: 'group' as const,
  username: null,
  stagedDownloadFn: undefined,
}

describe('fetch_chat_link gating', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({
      id: 'mm-1',
      type: 'mattermost',
      config: { baseUrl: 'https://mm.example.com', token: 't' },
    })
    seedTestPlatformInstance({ id: 'tg-1', type: 'telegram', config: {} })
  })
  afterEach(() => {})

  test('registered for a Mattermost instance with a requester id', () => {
    const tools: ToolSet = {}
    const contextId = toScopedContextId({ platformInstanceId: 'mm-1', nativeContextId: 'c1' })
    addProviderIndependentTools(tools, { ...baseOptions, chatUserId: 'user-1', contextId })
    expect(tools['fetch_chat_link']).toBeDefined()
  })

  test('absent for a non-Mattermost instance', () => {
    const tools: ToolSet = {}
    const contextId = toScopedContextId({ platformInstanceId: 'tg-1', nativeContextId: 'c1' })
    addProviderIndependentTools(tools, { ...baseOptions, chatUserId: 'user-1', contextId })
    expect(tools['fetch_chat_link']).toBeUndefined()
  })

  test('absent when there is no requester id', () => {
    const tools: ToolSet = {}
    const contextId = toScopedContextId({ platformInstanceId: 'mm-1', nativeContextId: 'c1' })
    addProviderIndependentTools(tools, { ...baseOptions, chatUserId: undefined, contextId })
    expect(tools['fetch_chat_link']).toBeUndefined()
  })

  test('absent for a non-scoped (legacy) contextId', () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, { ...baseOptions, chatUserId: 'user-1', contextId: 'legacy-raw-id' })
    expect(tools['fetch_chat_link']).toBeUndefined()
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { ContextType } from '../../src/chat/types.js'
import type { ToolMode, MakeToolsOptions } from '../../src/tools/types.js'

describe('types', () => {
  it('should export ToolMode type', () => {
    const normalMode: ToolMode = 'normal'
    const proactiveMode: ToolMode = 'proactive'

    expect(normalMode).toBe('normal')
    expect(proactiveMode).toBe('proactive')
  })

  it('should export MakeToolsOptions type', () => {
    const options: MakeToolsOptions = {
      storageContextId: 'user-123',
      chatUserId: 'user-123',
      mode: 'normal',
    }

    expect(options.storageContextId).toBe('user-123')
    expect(options.mode).toBe('normal')
  })

  it('should accept partial MakeToolsOptions with chatUserId', () => {
    const options: MakeToolsOptions = {
      chatUserId: 'user-123',
    }

    expect(options).toBeDefined()
    expect(options.chatUserId).toBe('user-123')
  })

  it('should accept chatUserId parameter', () => {
    const options: MakeToolsOptions = {
      storageContextId: 'group-123',
      chatUserId: 'user-456',
    }

    expect(options.storageContextId).toBe('group-123')
    expect(options.chatUserId).toBe('user-456')
  })

  it('should require chatUserId for complete options', () => {
    // chatUserId is now required - this test documents that behavior
    const options: MakeToolsOptions = {
      storageContextId: 'user-123',
      chatUserId: 'user-123',
    }

    expect(options.storageContextId).toBe('user-123')
    expect(options.chatUserId).toBe('user-123')
  })

  it('should export ContextType type', () => {
    const dm: ContextType = 'dm'
    const group: ContextType = 'group'

    expect(dm).toBe('dm')
    expect(group).toBe('group')
  })

  it('should accept contextType parameter', () => {
    const dmOptions: MakeToolsOptions = {
      storageContextId: 'user-123',
      chatUserId: 'user-123',
      contextType: 'dm',
    }

    const groupOptions: MakeToolsOptions = {
      storageContextId: 'group-123',
      chatUserId: 'user-456',
      contextType: 'group',
    }

    expect(dmOptions.contextType).toBe('dm')
    expect(groupOptions.contextType).toBe('group')
  })
})

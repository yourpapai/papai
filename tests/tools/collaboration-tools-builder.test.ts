// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ToolSet } from 'ai'

import type { TaskCapability, TaskProvider, UserIdentityResolver } from '../../src/providers/types.js'
import { maybeAddCollaborationTaskTools } from '../../src/tools/collaboration-tools-builder.js'
import { mockLogger } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const CHAT_USER_ID = 'chat-user-1'

const STUB_IDENTITY_RESOLVER: UserIdentityResolver = { searchUsers: () => Promise.resolve([]) }

const providerWith = (
  capabilities: ReadonlySet<TaskCapability>,
  overrides: Partial<TaskProvider> = {},
): TaskProvider => ({
  ...createMockProvider({ capabilities, ...overrides }),
})

const EMPTY_CAPS = new Set<TaskCapability>()
const WATCHERS = new Set<TaskCapability>(['tasks.watchers'])
const VOTES = new Set<TaskCapability>(['tasks.votes'])
const VISIBILITY = new Set<TaskCapability>(['tasks.visibility'])

describe('maybeAddCollaborationTaskTools', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('adds no tools when provider has no collaboration capabilities', () => {
    const tools: ToolSet = {}
    const provider = providerWith(EMPTY_CAPS, {
      listUsers: undefined,
      identityResolver: undefined,
      getCurrentUser: undefined,
    })
    maybeAddCollaborationTaskTools(tools, provider, CHAT_USER_ID)
    expect(Object.keys(tools)).toEqual([])
  })

  test('adds find_user when provider exposes listUsers', () => {
    const tools: ToolSet = {}
    const provider = providerWith(EMPTY_CAPS, { identityResolver: undefined, getCurrentUser: undefined })
    maybeAddCollaborationTaskTools(tools, provider, CHAT_USER_ID)
    expect(Object.keys(tools).toSorted()).toEqual(['find_user'])
  })

  test('adds get_current_user when identityResolver and getCurrentUser are both present', () => {
    const tools: ToolSet = {}
    const provider = providerWith(EMPTY_CAPS, { listUsers: undefined, identityResolver: STUB_IDENTITY_RESOLVER })
    maybeAddCollaborationTaskTools(tools, provider, CHAT_USER_ID)
    expect(Object.keys(tools).toSorted()).toEqual(['get_current_user'])
  })

  test('omits get_current_user when identityResolver is missing even if getCurrentUser is present', () => {
    const tools: ToolSet = {}
    const provider = providerWith(EMPTY_CAPS, { listUsers: undefined, identityResolver: undefined })
    maybeAddCollaborationTaskTools(tools, provider, CHAT_USER_ID)
    expect(Object.keys(tools)).toEqual([])
  })

  test('adds watcher tools when tasks.watchers capability is set', () => {
    const tools: ToolSet = {}
    const provider = providerWith(WATCHERS, {
      listUsers: undefined,
      identityResolver: undefined,
      getCurrentUser: undefined,
    })
    maybeAddCollaborationTaskTools(tools, provider, CHAT_USER_ID)
    expect(Object.keys(tools).toSorted()).toEqual(['add_watcher', 'list_watchers', 'remove_watcher'])
  })

  test('adds vote tools when tasks.votes capability is set', () => {
    const tools: ToolSet = {}
    const provider = providerWith(VOTES, {
      listUsers: undefined,
      identityResolver: undefined,
      getCurrentUser: undefined,
    })
    maybeAddCollaborationTaskTools(tools, provider, CHAT_USER_ID)
    expect(Object.keys(tools).toSorted()).toEqual(['add_vote', 'remove_vote'])
  })

  test('adds set_visibility when tasks.visibility capability is set', () => {
    const tools: ToolSet = {}
    const provider = providerWith(VISIBILITY, {
      listUsers: undefined,
      identityResolver: undefined,
      getCurrentUser: undefined,
    })
    maybeAddCollaborationTaskTools(tools, provider, CHAT_USER_ID)
    expect(Object.keys(tools).toSorted()).toEqual(['set_visibility'])
  })

  test('adds every collaboration tool when all capabilities are present', () => {
    const tools: ToolSet = {}
    const provider = providerWith(new Set<TaskCapability>(['tasks.watchers', 'tasks.votes', 'tasks.visibility']), {
      identityResolver: STUB_IDENTITY_RESOLVER,
    })
    maybeAddCollaborationTaskTools(tools, provider, CHAT_USER_ID)
    expect(Object.keys(tools).toSorted()).toEqual([
      'add_vote',
      'add_watcher',
      'find_user',
      'get_current_user',
      'list_watchers',
      'remove_vote',
      'remove_watcher',
      'set_visibility',
    ])
  })
})

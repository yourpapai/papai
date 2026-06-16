// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getScopeKey } from '../../src/chat/context-scope.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'

const platformInstanceId = 'pi-test'
const nativeContextId = 'grp'
const threadId = 'thread-1'

const storageContextId = toScopedThreadContextId({ platformInstanceId, nativeContextId, threadId })
const expectedGroupKey = toScopedContextId({ platformInstanceId, nativeContextId })

const ctx = { storageContextId, chatUserId: 'user-1', contextType: 'group' as const }

describe('getScopeKey', () => {
  test('thread scope returns the full storage id', () => {
    expect(getScopeKey('thread', ctx)).toBe(storageContextId)
  })
  test('group scope strips the thread suffix', () => {
    expect(getScopeKey('group', ctx)).toBe(expectedGroupKey)
    expect(getScopeKey('group+threadOverride', ctx)).toBe(expectedGroupKey)
  })
  test('user scope returns the chat user id', () => {
    expect(getScopeKey('user', ctx)).toBe('user-1')
  })
})

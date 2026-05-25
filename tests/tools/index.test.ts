// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { makeTools } from '../../src/tools/index.js'
import { createMockProvider } from './mock-provider.js'

describe('makeTools', () => {
  test('exposes lookup_group_history only for scoped thread context ids', () => {
    const provider = createMockProvider()
    const scopedMainContextId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-1' })
    const scopedThreadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: 'thread-1',
    })

    expect(
      makeTools(provider, { storageContextId: scopedThreadContextId, chatUserId: 'user-1' }),
    ).toHaveProperty('lookup_group_history')
    expect(makeTools(provider, { storageContextId: scopedMainContextId, chatUserId: 'user-1' })).not.toHaveProperty(
      'lookup_group_history',
    )
  })
})

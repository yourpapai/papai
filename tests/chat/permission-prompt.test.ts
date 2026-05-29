// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { askPermissionViaChat } from '../../src/chat/permission-prompt.js'
import { createMockReply } from '../utils/test-helpers.js'

describe('askPermissionViaChat (stub)', () => {
  test('always returns deny in the stub implementation', async () => {
    const { reply } = createMockReply()
    const result = await askPermissionViaChat(reply, 'ctx-1', { toolName: 'create_task', reason: 'test' })
    expect(result).toBe('deny')
  })
})

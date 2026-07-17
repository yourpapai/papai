// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { taskProviderMembers, type TaskProviderMember } from '../../src/db/membership-schema.js'

describe('membership-schema', () => {
  test('taskProviderMembers table has correct column definitions', () => {
    // Access column objects directly on the table (Drizzle table API)
    expect(taskProviderMembers.groupContextId).toBeDefined()
    expect(taskProviderMembers.chatUserId).toBeDefined()
    expect(taskProviderMembers.providerName).toBeDefined()
    expect(taskProviderMembers.providerUserId).toBeDefined()
    expect(taskProviderMembers.login).toBeDefined()
    expect(taskProviderMembers.status).toBeDefined()
    expect(taskProviderMembers.encryptedPassword).toBeDefined()
    expect(taskProviderMembers.createdAt).toBeDefined()
  })

  test('TaskProviderMember type is inferred from the table', () => {
    // Type-level check: ensure the type has encryptedPassword as string | null
    const row: TaskProviderMember = {
      groupContextId: 'g1',
      chatUserId: 'u1',
      providerName: 'kaneo',
      providerUserId: 'p1',
      login: 'u@pap.ai',
      status: 'active',
      encryptedPassword: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    expect(row.encryptedPassword).toBeNull()
  })
})

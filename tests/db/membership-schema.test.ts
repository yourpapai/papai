// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { kaneoWorkspaceMembers, type KaneoWorkspaceMember } from '../../src/db/membership-schema.js'

describe('membership-schema', () => {
  test('kaneoWorkspaceMembers table has correct column definitions', () => {
    // Access column objects directly on the table (Drizzle table API)
    expect(kaneoWorkspaceMembers.groupContextId).toBeDefined()
    expect(kaneoWorkspaceMembers.chatUserId).toBeDefined()
    expect(kaneoWorkspaceMembers.providerName).toBeDefined()
    expect(kaneoWorkspaceMembers.providerUserId).toBeDefined()
    expect(kaneoWorkspaceMembers.login).toBeDefined()
    expect(kaneoWorkspaceMembers.status).toBeDefined()
    expect(kaneoWorkspaceMembers.encryptedPassword).toBeDefined()
    expect(kaneoWorkspaceMembers.createdAt).toBeDefined()
  })

  test('KaneoWorkspaceMember type is inferred from the table', () => {
    // Type-level check: ensure the type has encryptedPassword as string | null
    const row: KaneoWorkspaceMember = {
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

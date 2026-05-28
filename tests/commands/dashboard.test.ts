// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
import { registerDashboardCommand } from '../../src/commands/dashboard.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { migration047DashboardSessions } from '../../src/db/migrations/047_dashboard_sessions.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
} from '../utils/test-helpers.js'

describe('/dashboard command', () => {
  let db: Database
  let lastHandler: CommandHandler | null = null
  const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    migration047DashboardSessions.up(db)
    setStoreDb(db)
    process.env['DEBUG_SERVER'] = 'true'
    lastHandler = null
    registerDashboardCommand(mockChat)
    lastHandler = commandHandlers.get('dashboard') ?? null
  })

  afterEach(() => {
    db.close()
    setStoreDb(null)
    delete process.env['DEBUG_SERVER']
  })

  test('rejects when auth.allowed is false', async () => {
    const { reply, textCalls } = createMockReply()
    const msg = createDmMessage('u1')
    const auth = createAuth('u1', { allowed: false })
    await lastHandler!(msg, reply, auth)
    expect(textCalls).toHaveLength(0)
  })

  test('rejects in groups', async () => {
    const { reply, textCalls } = createMockReply()
    const msg = createGroupMessage('u1', '/dashboard', true, 'g1')
    const auth = createAuth('u1', { allowed: true, isBotAdmin: true })
    await lastHandler!(msg, reply, auth)
    expect(textCalls.join('\n')).toContain('DM')
  })

  test('rejects non-admins', async () => {
    const { reply, textCalls } = createMockReply()
    const msg = createDmMessage('u1')
    const auth = createAuth('u1', { allowed: true, isBotAdmin: false })
    await lastHandler!(msg, reply, auth)
    expect(textCalls.join('\n')).toMatch(/admin/iu)
  })

  test('refuses when DEBUG_SERVER is not enabled', async () => {
    delete process.env['DEBUG_SERVER']
    const { reply, textCalls } = createMockReply()
    const msg = createDmMessage('u1')
    const auth = createAuth('u1', { allowed: true, isBotAdmin: true })
    await lastHandler!(msg, reply, auth)
    expect(textCalls.join('\n')).toMatch(/disabled|not enabled/iu)
  })

  test('replies with a claim URL for an admin in DM', async () => {
    const { reply, textCalls } = createMockReply()
    const msg = createDmMessage('u1')
    const auth = createAuth('u1', { allowed: true, isBotAdmin: true })
    await lastHandler!(msg, reply, auth)
    const body = textCalls.join('\n')
    expect(body).toMatch(/`http[^`]+\/auth\/claim\?n=[0-9a-f]{32}`/u)
    expect(body).toMatch(/5 min/iu)
  })

  test('replies with an identity error when user.id is empty', async () => {
    const { reply, textCalls } = createMockReply()
    const msg = { ...createDmMessage('u1'), user: { id: '', username: null, isAdmin: false } }
    const auth = createAuth('u1', { allowed: true, isBotAdmin: true })
    await lastHandler!(msg, reply, auth)
    expect(textCalls.join('\n')).toMatch(/identify|user/iu)
  })

  test('replies with a fallback message when issueClaim fails', async () => {
    db.close()
    setStoreDb(null)
    const { reply, textCalls } = createMockReply()
    const msg = createDmMessage('u1')
    const auth = createAuth('u1', { allowed: true, isBotAdmin: true })
    await lastHandler!(msg, reply, auth)
    expect(textCalls.join('\n')).toMatch(/could not issue|try again/iu)
  })
})

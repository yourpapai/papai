// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { ChatRouter } from '../../../src/chat/router.js'
import type { ResolveUserContext } from '../../../src/chat/types.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../../src/debug/chat-router-runtime.js'
import { resolveSettingsUserId } from '../../../src/debug/settings/resolve-user-id.js'
import { mockLogger } from '../../utils/test-helpers.js'

const PRINCIPAL = { platformUserId: 'admin-1', platformInstanceId: 'pi-1' }

const mockResolveUserId = mock((_username: string, _context: ResolveUserContext) =>
  Promise.resolve<string | null>(null),
)

class MockChatRouter extends ChatRouter {
  constructor() {
    super(() => {
      throw new Error('unused test factory')
    })
  }

  override resolveUserId(username: string, context: ResolveUserContext): Promise<string | null> {
    return mockResolveUserId(username, context)
  }
}

describe('resolveSettingsUserId', () => {
  beforeEach(() => {
    mockLogger()
    mockResolveUserId.mockClear()
    mockResolveUserId.mockImplementation(() => Promise.resolve(null))
    setRuntimeChatRouter(new MockChatRouter())
  })

  afterEach(() => {
    clearRuntimeChatRouter()
  })

  test('numeric input is an id without consulting the router', async () => {
    expect(await resolveSettingsUserId('123456789', PRINCIPAL)).toEqual({ kind: 'id', userId: '123456789' })
    expect(mockResolveUserId).not.toHaveBeenCalled()
  })

  test('numeric input with @ prefix is cleaned', async () => {
    expect(await resolveSettingsUserId('@123456789', PRINCIPAL)).toEqual({ kind: 'id', userId: '123456789' })
  })

  test('router resolution success returns resolved id and passes dm context', async () => {
    mockResolveUserId.mockImplementation(() => Promise.resolve('42'))
    expect(await resolveSettingsUserId('@f4dev', PRINCIPAL)).toEqual({ kind: 'resolved', userId: '42' })
    expect(mockResolveUserId).toHaveBeenCalledWith(
      '@f4dev',
      expect.objectContaining({ contextId: 'admin-1', contextType: 'dm', platformInstanceId: 'pi-1' }),
    )
  })

  test('router resolution failure returns unresolved with cleaned username', async () => {
    expect(await resolveSettingsUserId('@f4dev', PRINCIPAL)).toEqual({ kind: 'unresolved', username: 'f4dev' })
  })

  test('missing chat router returns unresolved', async () => {
    clearRuntimeChatRouter()
    expect(await resolveSettingsUserId('f4dev', PRINCIPAL)).toEqual({ kind: 'unresolved', username: 'f4dev' })
  })

  test('non-@ username is passed to router and resolved', async () => {
    mockResolveUserId.mockImplementation(() => Promise.resolve('99'))
    expect(await resolveSettingsUserId('f4dev', PRINCIPAL)).toEqual({ kind: 'resolved', userId: '99' })
    expect(mockResolveUserId).toHaveBeenCalledWith('f4dev', expect.objectContaining({ contextType: 'dm' }))
  })

  test('bare @ is unresolved without consulting the router', async () => {
    mockResolveUserId.mockImplementation(() => Promise.resolve('99'))
    expect(await resolveSettingsUserId('@', PRINCIPAL)).toEqual({ kind: 'unresolved', username: '' })
    expect(mockResolveUserId).not.toHaveBeenCalled()
  })
})

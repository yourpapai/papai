// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { AuthorizationResult } from '../../../src/chat/authorization-types.js'
import type { IncomingMessage, ReplyFn } from '../../../src/chat/types.js'
import { activate, jsonResponse } from './support.js'

type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

function stubMessage(): IncomingMessage {
  return {
    user: { id: 'u-1', username: 'tester', isAdmin: false },
    contextId: 'ctx-1',
    contextType: 'dm',
    isMentioned: false,
    text: '/acp',
    platformInstanceId: 'pi-1',
  }
}

function stubAuth(): AuthorizationResult {
  return { allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'ctx-1' }
}

function stubReply(replies: string[]): ReplyFn {
  const push = (s: string): Promise<void> => {
    replies.push(s)
    return Promise.resolve()
  }
  return {
    text: push,
    formatted: push,
    typing: (): void => {},
    buttons: (): Promise<undefined> => Promise.resolve(undefined),
  }
}

describe('acp /acp command', () => {
  test('replies with non-empty help text mentioning sessions', async () => {
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({}))
    const { command } = activate(httpFetch)
    expect(command).toBeDefined()
    const replies: string[] = []
    await command!.execute(stubMessage(), stubReply(replies), stubAuth())
    expect(replies).toHaveLength(1)
    expect(replies[0]!.length).toBeGreaterThan(0)
    expect(replies[0]!.toLowerCase()).toContain('session')
  })
})

describe('acp prompt fragment', () => {
  test('registers acp-hint fragment with non-empty content under 2000 chars', () => {
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({}))
    const { fragment } = activate(httpFetch)
    expect(fragment).toBeDefined()
    expect(fragment!.name).toBe('acp-hint')
    expect(typeof fragment!.content).toBe('string')
    expect(String(fragment!.content).length).toBeGreaterThan(0)
    expect(String(fragment!.content).length).toBeLessThan(2000)
  })
})

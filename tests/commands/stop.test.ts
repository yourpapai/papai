// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
import { registerStopCommand } from '../../src/commands/stop.js'
import { runRegistry } from '../../src/run-control/registry.js'
import {
  createAuth,
  createDmMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
} from '../utils/test-helpers.js'

describe('/stop command', () => {
  beforeEach(() => {
    mockLogger()
    runRegistry.clear()
  })
  afterEach(() => runRegistry.clear())

  function getHandler(): CommandHandler {
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    registerStopCommand(provider)
    const handler = commandHandlers.get('stop')
    if (handler === undefined) throw new Error('stop handler not registered')
    return handler
  }

  test('no active run: replies that nothing is running', async () => {
    const handler = getHandler()
    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage('user-1'), reply, createAuth('user-1'))
    expect(textCalls.some((t) => /nothing is running/iu.test(t))).toBe(true)
  })

  test('first /stop on an active run sets stopRequested and acks winding down', async () => {
    const handler = getHandler()
    const run = runRegistry.begin('user-1', { turnId: 't1', reply: createMockReply().reply })
    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage('user-1'), reply, createAuth('user-1'))
    expect(run.stopRequested).toBe(true)
    expect(run.abortController.signal.aborted).toBe(false)
    expect(textCalls.some((t) => /winding down/iu.test(t))).toBe(true)
  })

  test('second /stop while stopping force-aborts', async () => {
    const handler = getHandler()
    const run = runRegistry.begin('user-1', { turnId: 't1', reply: createMockReply().reply })
    run.stopRequested = true
    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage('user-1'), reply, createAuth('user-1'))
    expect(run.abortController.signal.aborted).toBe(true)
    expect(textCalls.some((t) => /immediately/iu.test(t))).toBe(true)
  })

  test('unauthorized user is rejected without touching the run', async () => {
    const handler = getHandler()
    const run = runRegistry.begin('user-1', { turnId: 't1', reply: createMockReply().reply })
    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage('user-1'), reply, createAuth('user-1', { allowed: false }))
    expect(run.stopRequested).toBe(false)
    expect(textCalls).toHaveLength(0)
  })
})

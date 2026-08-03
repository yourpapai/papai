// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { replayLeftoverSteerAsFreshTurn } from '../src/llm-orchestrator-leftover-replay.js'
import type { ProcessMessageFn } from '../src/llm-orchestrator-process-args.js'
import type { InvocationSource } from '../src/llm-orchestrator-tools.js'
import { defaultDeps } from '../src/llm-orchestrator.js'
import { createMockReply } from './utils/test-helpers.js'

const invocationSource: Omit<InvocationSource, 'history'> = {
  reply: createMockReply().reply,
  contextId: 'ctx-1',
  chatUserId: 'user-1',
  username: 'alice',
  userText: 'irrelevant — replay overrides this',
  contextType: 'dm',
  actorRole: 'member',
}

describe('replayLeftoverSteerAsFreshTurn', () => {
  test('no-op when there are no leftover messages', async () => {
    let calls = 0
    const processMessage: ProcessMessageFn = (() => {
      calls++
      return Promise.resolve()
    }) as ProcessMessageFn
    await replayLeftoverSteerAsFreshTurn([], {
      invocationSource,
      configContextId: undefined,
      deps: defaultDeps,
      processMessage,
    })
    expect(calls).toBe(0)
  })

  test('re-enqueues joined steer text as a fresh turn with no originating message ids', async () => {
    const captured: {
      userText?: string
      attachmentIds?: readonly string[]
      turnId?: string
      originatingMessageIds?: readonly string[]
    } = {}
    const processMessage: ProcessMessageFn = ((
      _reply,
      _contextId,
      _chatUserId,
      _username,
      userText,
      _contextType,
      _configContextId,
      _deps,
      attachmentIds,
      turnId,
      _actorRole,
      originatingMessageIds,
    ) => {
      captured.userText = userText
      captured.attachmentIds = attachmentIds
      captured.turnId = turnId
      captured.originatingMessageIds = originatingMessageIds
      return Promise.resolve()
    }) as ProcessMessageFn
    await replayLeftoverSteerAsFreshTurn([{ text: 'only project X' }, { text: 'and use tabs' }], {
      invocationSource,
      configContextId: undefined,
      deps: defaultDeps,
      processMessage,
    })
    expect(captured.userText).toBe('only project X\n\nand use tabs')
    expect(captured.attachmentIds).toEqual([])
    expect(captured.turnId).toBeUndefined()
    expect(captured.originatingMessageIds).toEqual([])
  })
})

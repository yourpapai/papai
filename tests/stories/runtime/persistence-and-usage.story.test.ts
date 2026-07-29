// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.

import { expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { llmUsageEvents, toolCallEvents } from '../../../src/db/schema.js'
import { emitGroup, emitUser, subscribe, unsubscribe, type DebugEvent } from '../../../src/debug/event-bus.js'
import { buildReplyChain, cacheMessage, getMessage, getMessageContext } from '../../../src/message-cache/index.js'
import { initUsageRecorder } from '../../../src/usage/index.js'
import { resetUsageRecorderForTesting } from '../../../src/usage/index.testing.js'
import { listSubjects } from '../../../src/usage/query.js'
import { waitFor } from '../../utils/test-helpers.js'
import { executeScenario } from '../harness/scenario.js'

const dayMs = 24 * 60 * 60 * 1000

const llmEndData = (responseId: string): Record<string, unknown> => ({
  model: 'main-model',
  steps: 2,
  totalDuration: 1500,
  tokenUsage: { inputTokens: 101, outputTokens: 202 },
  responseId,
  finishReason: 'stop',
  messageCount: 4,
  chatUserId: 'user-1',
  contextType: 'group',
  toolCount: 2,
})

const receivedEventWithTurn = (events: readonly DebugEvent[], turnId: string): boolean =>
  events.some((event) => event.type === 'llm:end' && event.turnId === turnId)

test('SCN-message-cache-persistence: persisted messages retain context and reply-chain boundaries', async () => {
  await executeScenario(
    'SCN-message-cache-persistence: persisted messages retain context and reply-chain boundaries',
    async () => {
      const groupScope = { kind: 'group' as const, groupContextId: 'group-A' }

      cacheMessage({
        messageId: 'm-1',
        contextId: 'thread-A',
        groupContextId: 'group-A',
        text: 'root',
        timestamp: 1,
      })
      cacheMessage({
        messageId: 'm-2',
        contextId: 'thread-A',
        groupContextId: 'group-A',
        text: 'reply',
        replyToMessageId: 'm-1',
        timestamp: 2,
      })
      cacheMessage({
        messageId: 'm-1',
        contextId: 'thread-B',
        groupContextId: 'group-B',
        text: 'other root',
        timestamp: 3,
      })
      cacheMessage({
        messageId: 'm-4',
        contextId: 'thread-A',
        groupContextId: 'group-A',
        text: 'broken reply',
        replyToMessageId: 'm-3',
        timestamp: 4,
      })

      await waitFor(() => getMessageContext(groupScope, 'm-2', 0, 0, 'reply_chain').target !== undefined)

      const chain = buildReplyChain('thread-A', 'm-2')
      expect(chain).toMatchObject({ chain: ['m-1', 'm-2'], isComplete: true })
      expect(getMessage({ kind: 'group', groupContextId: 'group-B' }, 'm-1')).toMatchObject({
        messageId: 'm-1',
        contextId: 'thread-B',
        groupContextId: 'group-B',
        text: 'other root',
        timestamp: 3,
      })
      expect(getMessage({ kind: 'group', groupContextId: 'group-B' }, 'm-2')).toBeUndefined()
      expect(getMessageContext({ kind: 'group', groupContextId: 'group-B' }, 'm-2', 1, 1, 'reply_chain')).toEqual({
        target: undefined,
        before: [],
        after: [],
      })
      expect(buildReplyChain('thread-A', 'm-4')).toMatchObject({
        chain: ['m-4'],
        isComplete: false,
        brokenAt: 'm-3',
      })
    },
  )
})

test('SCN-usage-accounting: idempotent request and tool events remain window-queryable', async () => {
  await executeScenario('SCN-usage-accounting: idempotent request and tool events remain window-queryable', () => {
    resetUsageRecorderForTesting()
    initUsageRecorder()

    try {
      const now = Date.now()
      const originalDateNow = Date.now
      Date.now = (): number => now
      try {
        emitUser('llm:end', 'recent-context', llmEndData('response-1'), 'turn-1')
        emitUser('llm:end', 'recent-context', llmEndData('response-1'), 'turn-1')
        emitUser(
          'tool:execute_end',
          'recent-context',
          {
            chatUserId: 'user-1',
            contextType: 'group',
            model: 'main-model',
            modelRole: 'main',
            toolName: 'create_task',
            toolCallId: 'tool-call-1',
            success: true,
            durationMs: 50,
            argsBytes: 12,
            resultBytes: 24,
            responseId: 'response-1',
          },
          'turn-1',
        )
        emitUser(
          'tool:execute_end',
          'recent-context',
          {
            chatUserId: 'user-1',
            contextType: 'group',
            model: 'main-model',
            modelRole: 'main',
            toolName: 'create_task',
            toolCallId: 'tool-call-1',
            success: true,
            durationMs: 50,
            argsBytes: 12,
            resultBytes: 24,
            responseId: 'response-1',
          },
          'turn-1',
        )

        Date.now = (): number => now - 10 * dayMs
        emitUser('llm:end', 'old-context', llmEndData('response-old'), 'turn-old')
      } finally {
        Date.now = originalDateNow
      }

      expect(getDrizzleDb().select().from(llmUsageEvents).all()).toHaveLength(2)
      expect(getDrizzleDb().select().from(toolCallEvents).all()).toHaveLength(1)
      expect(listSubjects({ windowMs: dayMs }).map(({ storageContextId }) => storageContextId)).toEqual([
        'recent-context',
      ])
      const allSubjectIds = listSubjects({ windowMs: null }).map(({ storageContextId }) => storageContextId)
      expect(allSubjectIds).toContain('recent-context')
      expect(allSubjectIds).toContain('old-context')

      const recent = listSubjects({ windowMs: dayMs })[0]
      expect(recent?.totals.main).toEqual({
        inputTokens: 101,
        outputTokens: 202,
        calls: 1,
      })
      expect(recent?.toolCalls).toBe(2)

      const received: DebugEvent[] = []
      const listener = (event: DebugEvent): void => {
        received.push(event)
      }
      subscribe(listener)
      try {
        emitUser('llm:end', 'malformed-context', { partial: 'payload' }, 'turn-malformed')
        emitGroup('llm:end', 'group-context', llmEndData('response-group'), 'turn-group')
        expect(receivedEventWithTurn(received, 'turn-malformed')).toBe(true)
      } finally {
        unsubscribe(listener)
      }

      expect(getDrizzleDb().select().from(llmUsageEvents).all()).toHaveLength(2)
    } finally {
      resetUsageRecorderForTesting()
    }
  })
})

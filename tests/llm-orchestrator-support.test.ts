// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { providerError } from '../src/errors.js'
import { handleOrchestratorMessageError, handleToolCallFinish } from '../src/llm-orchestrator-support.js'
import { buildToolFailureResult } from '../src/tool-failure.js'
import { createMockReply } from './utils/test-helpers.js'

describe('llm-orchestrator-support', () => {
  test('handleToolCallFinish emits structured failures and replies with the user message', () => {
    const { reply, getReplies } = createMockReply()
    const emitCalls: Array<{ event: string; payload: unknown }> = []
    const deps = {
      emit: (event: string, payload: unknown): void => {
        emitCalls.push({ event, payload })
      },
      log: {
        warn: mock(() => {}),
        error: mock(() => {}),
      },
    }
    const failure = buildToolFailureResult(providerError.taskNotFound('TASK-9'), 'get_task', 'call-1')

    handleToolCallFinish(
      'ctx-1',
      reply,
      {
        toolCall: { toolName: 'get_task', toolCallId: 'call-1' },
        success: true,
        output: failure,
        durationMs: 25,
      },
      deps,
    )

    expect(emitCalls).toHaveLength(1)
    expect(emitCalls[0]).toEqual({
      event: 'llm:tool_result',
      payload: {
        userId: 'ctx-1',
        toolName: 'get_task',
        toolCallId: 'call-1',
        durationMs: 25,
        success: false,
        result: failure,
        error: failure.error,
      },
    })
    expect(getReplies()).toEqual([
      '⚠️ Tool "get_task" failed: Task "TASK-9" was not found. Please check the task ID and try again.',
    ])
  })

  test('handleOrchestratorMessageError replies with the app error message', async () => {
    const { reply, getReplies } = createMockReply()
    const deps = {
      emit: (_event: string, _payload: unknown): void => {},
      log: {
        warn: mock(() => {}),
        error: mock(() => {}),
      },
    }

    await handleOrchestratorMessageError(reply, 'ctx-2', providerError.projectNotFound('PRJ-1'), deps)

    expect(getReplies()).toEqual(['Project "PRJ-1" was not found.'])
  })
})

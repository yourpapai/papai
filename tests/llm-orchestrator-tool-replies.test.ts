// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setConfigValue } from '../src/config.js'
import { providerError } from '../src/errors.js'
import { handleToolCallFinish } from '../src/llm-orchestrator-tool-replies.js'
import { buildToolFailureResult } from '../src/tool-failure.js'
import { createMockReply, mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('tool-failure reply per locale', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setConfigValue('ctx-tool-reply-ru', 'language', 'ru')
  })

  test('renders the ru tool-failure notice for a ru-configured context', () => {
    const { reply, getReplies } = createMockReply()
    const failure = buildToolFailureResult(providerError.taskNotFound('TASK-9'), 'get_task', 'c-ru', { locale: 'ru' })
    handleToolCallFinish('ctx-tool-reply-ru', reply, {
      toolCall: { toolName: 'get_task', toolCallId: 'c-ru' },
      success: true,
      output: failure,
      durationMs: 5,
    })
    expect(getReplies()).toEqual([
      '⚠️ Инструмент "get_task" завершился ошибкой: Задача «TASK-9» не найдена. Проверьте идентификатор задачи и попробуйте ещё раз.',
    ])
  })

  test('renders the en tool-failure notice otherwise', () => {
    const { reply, getReplies } = createMockReply()
    const failure = buildToolFailureResult(providerError.taskNotFound('TASK-9'), 'get_task', 'c-en')
    handleToolCallFinish('ctx-tool-reply-en', reply, {
      toolCall: { toolName: 'get_task', toolCallId: 'c-en' },
      success: true,
      output: failure,
      durationMs: 5,
    })
    expect(getReplies()).toEqual([
      '⚠️ Tool "get_task" failed: Task "TASK-9" was not found. Please check the task ID and try again.',
    ])
  })
})

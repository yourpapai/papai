// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeRemoveTaskLabelTool } from '../../src/tools/remove-task-label.js'
import { createMockKaneoProvider } from './mock-provider.js'

describe('makeRemoveTaskLabelTool direct', () => {
  test('returns already_absent for Kaneo when task does not currently have label by visible name', async () => {
    const removeTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'task-label-1' }))
    const provider = createMockKaneoProvider({
      listTaskLabels: mock(() => Promise.resolve([])),
      removeTaskLabel,
    })

    const tool = makeRemoveTaskLabelTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute(
      { taskId: 'task-1', labelName: 'Feature' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toMatchObject({
      status: 'already_absent',
      taskId: 'task-1',
      labelName: 'Feature',
    })
    expect(result).not.toHaveProperty('labelId')
    expect(removeTaskLabel).not.toHaveBeenCalled()
  })

  test('returns already_absent for Kaneo when task does not currently have label by id', async () => {
    const removeTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'task-label-1' }))
    const provider = createMockKaneoProvider({
      listTaskLabels: mock(() => Promise.resolve([])),
      removeTaskLabel,
    })

    const tool = makeRemoveTaskLabelTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute(
      { taskId: 'task-1', labelId: 'missing-label-id' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toMatchObject({
      status: 'already_absent',
      taskId: 'task-1',
      labelId: 'missing-label-id',
    })
    expect(result).not.toHaveProperty('labelName')
    expect(removeTaskLabel).not.toHaveBeenCalled()
  })
})

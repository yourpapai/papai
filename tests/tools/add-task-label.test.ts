// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeAddTaskLabelTool } from '../../src/tools/add-task-label.js'
import { createMockKaneoProvider } from './mock-provider.js'

describe('makeAddTaskLabelTool direct', () => {
  test('returns already_present for Kaneo when task already has label by visible name', async () => {
    const addTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'workspace-label-1' }))
    const provider = createMockKaneoProvider({
      listTaskLabels: mock(() => Promise.resolve([{ id: 'task-label-1', name: 'Feature', color: '#ff0000' }])),
      listLabels: mock(() => Promise.resolve([{ id: 'workspace-label-1', name: 'Feature', color: '#ff0000' }])),
      addTaskLabel,
    })

    const tool = makeAddTaskLabelTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute(
      { taskId: 'task-1', labelName: 'Feature' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toMatchObject({
      status: 'already_present',
      taskId: 'task-1',
      labelName: 'Feature',
      taskLabelIds: ['task-label-1'],
    })
    expect(addTaskLabel).not.toHaveBeenCalled()
  })
})

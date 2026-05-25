// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeAssignTaskToSprintTool } from '../../src/tools/assign-task-to-sprint.js'
import { makeCreateSprintTool } from '../../src/tools/create-sprint.js'
import { makeListAgilesTool } from '../../src/tools/list-agiles.js'
import { makeListSprintsTool } from '../../src/tools/list-sprints.js'
import { makeUpdateSprintTool } from '../../src/tools/update-sprint.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('Agile tools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('list_agiles returns provider agiles', async () => {
    const listAgiles = mock(() => Promise.resolve([{ id: 'agile-1', name: 'Team Board' }]))
    const result = await getToolExecutor(makeListAgilesTool(createMockProvider({ listAgiles })))({})
    expect(result).toEqual([{ id: 'agile-1', name: 'Team Board' }])
    expect(listAgiles).toHaveBeenCalledTimes(1)
  })

  test('list_sprints requires agileId', () => {
    expect(schemaValidates(makeListSprintsTool(createMockProvider()), {})).toBe(false)
    expect(schemaValidates(makeListSprintsTool(createMockProvider()), { agileId: 'agile-1' })).toBe(true)
  })

  test('create_sprint forwards the normalized payload', async () => {
    const createSprint = mock((agileId: string, params: { name: string }) =>
      Promise.resolve({ id: 'sprint-1', agileId, name: params.name, archived: false }),
    )
    const result = await getToolExecutor(makeCreateSprintTool(createMockProvider({ createSprint })))({
      agileId: 'agile-1',
      name: 'Sprint 24',
      goal: 'Ship commands',
      start: '2026-04-15T00:00:00.000Z',
      finish: '2026-04-22T00:00:00.000Z',
    })
    expect(result).toEqual({
      id: 'sprint-1',
      agileId: 'agile-1',
      name: 'Sprint 24',
      archived: false,
    })
    expect(createSprint).toHaveBeenCalledWith('agile-1', {
      name: 'Sprint 24',
      goal: 'Ship commands',
      start: '2026-04-15T00:00:00.000Z',
      finish: '2026-04-22T00:00:00.000Z',
      previousSprintId: undefined,
      isDefault: undefined,
    })
  })

  test('create_sprint rejects invalid datetime input', () => {
    const tool = makeCreateSprintTool(createMockProvider())

    expect(
      schemaValidates(tool, {
        agileId: 'agile-1',
        name: 'Sprint 24',
        start: 'not-a-date',
      }),
    ).toBe(false)
    expect(
      schemaValidates(tool, {
        agileId: 'agile-1',
        name: 'Sprint 24',
        finish: 'also-not-a-date',
      }),
    ).toBe(false)
  })

  test('update_sprint requires agileId and sprintId', () => {
    const tool = makeUpdateSprintTool(createMockProvider())
    expect(schemaValidates(tool, { agileId: 'agile-1' })).toBe(false)
    expect(schemaValidates(tool, { sprintId: 'sprint-1' })).toBe(false)
    expect(schemaValidates(tool, { agileId: 'agile-1', sprintId: 'sprint-1', archived: true })).toBe(true)
  })

  test('update_sprint rejects invalid datetime input', () => {
    const tool = makeUpdateSprintTool(createMockProvider())

    expect(
      schemaValidates(tool, {
        agileId: 'agile-1',
        sprintId: 'sprint-1',
        start: 'not-a-date',
      }),
    ).toBe(false)
    expect(
      schemaValidates(tool, {
        agileId: 'agile-1',
        sprintId: 'sprint-1',
        finish: 'also-not-a-date',
      }),
    ).toBe(false)
    expect(
      schemaValidates(tool, {
        agileId: 'agile-1',
        sprintId: 'sprint-1',
        start: null,
        finish: null,
      }),
    ).toBe(true)
  })

  test('assign_task_to_sprint forwards task and sprint IDs', async () => {
    const assignTaskToSprint = mock((taskId: string, sprintId: string) => Promise.resolve({ taskId, sprintId }))
    const result = await getToolExecutor(makeAssignTaskToSprintTool(createMockProvider({ assignTaskToSprint })))({
      taskId: 'TEST-1',
      sprintId: 'sprint-3',
    })
    expect(result).toEqual({ taskId: 'TEST-1', sprintId: 'sprint-3' })
    expect(assignTaskToSprint).toHaveBeenCalledWith('TEST-1', 'sprint-3')
  })
})

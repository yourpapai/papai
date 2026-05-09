import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeSetVisibilityTool } from '../../src/tools/set-visibility.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isVisibilityResult(value: unknown): value is {
  taskId: string
  visibility:
    | { kind: 'public' }
    | {
        kind: 'restricted'
        users?: Array<{ id: string }>
        groups?: Array<{ name: string }>
      }
} {
  if (value === null || typeof value !== 'object' || !('taskId' in value) || !('visibility' in value)) {
    return false
  }

  const visibility = value.visibility
  if (visibility === null || typeof visibility !== 'object' || !('kind' in visibility)) {
    return false
  }

  return visibility.kind === 'public' || visibility.kind === 'restricted'
}

describe('Set Visibility Tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeSetVisibilityTool(createMockProvider())
    expect(tool.description).toContain('Set task visibility')
  })

  test('sets public visibility', async () => {
    const setVisibility = mock((_taskId: string, _visibility: { kind: 'public' | 'restricted' }) =>
      Promise.resolve({ taskId: 'task-1', visibility: { kind: 'public' as const } }),
    )
    const tool = makeSetVisibilityTool(createMockProvider({ setVisibility }))

    const result: unknown = await getToolExecutor(tool)(
      { taskId: 'task-1', visibility: 'public' },
      { toolCallId: '1', messages: [] },
    )

    assert(isVisibilityResult(result))
    expect(result.visibility.kind).toBe('public')
    expect(setVisibility).toHaveBeenCalledWith('task-1', { kind: 'public' })
  })

  test('sets restricted visibility with users and groups', async () => {
    const setVisibility = mock(
      (taskId: string, visibility: { kind: 'public' | 'restricted'; userIds?: string[]; groupIds?: string[] }) =>
        Promise.resolve({
          taskId,
          visibility: {
            kind: 'restricted' as const,
            users: visibility.userIds?.map((id) => ({ id })),
            groups: visibility.groupIds?.map((id) => ({ name: id })),
          },
        }),
    )
    const tool = makeSetVisibilityTool(createMockProvider({ setVisibility }))

    const result: unknown = await getToolExecutor(tool)(
      {
        taskId: 'task-1',
        visibility: 'restricted',
        userIds: ['user-1'],
        groupIds: ['group-1'],
      },
      { toolCallId: '1', messages: [] },
    )

    assert(isVisibilityResult(result))
    assert.equal(result.visibility.kind, 'restricted')
    expect(result.visibility.users).toEqual([{ id: 'user-1' }])
    expect(result.visibility.groups).toEqual([{ name: 'group-1' }])
    expect(setVisibility).toHaveBeenCalledWith('task-1', {
      kind: 'restricted',
      userIds: ['user-1'],
      groupIds: ['group-1'],
    })
  })

  test('validates restricted visibility requires at least one audience target', () => {
    const tool = makeSetVisibilityTool(createMockProvider())
    expect(schemaValidates(tool, { taskId: 'task-1', visibility: 'restricted' })).toBe(false)
    expect(schemaValidates(tool, { taskId: 'task-1', visibility: 'restricted', userIds: ['user-1'] })).toBe(true)
  })

  test('validates taskId is required', () => {
    const tool = makeSetVisibilityTool(createMockProvider())
    expect(schemaValidates(tool, { visibility: 'public' })).toBe(false)
  })
})

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeRemoveProjectMemberTool } from '../../src/tools/remove-project-member.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isProjectUserResult(value: unknown): value is { projectId: string; userId: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'projectId' in value &&
    typeof value.projectId === 'string' &&
    'userId' in value &&
    typeof value.userId === 'string'
  )
}

describe('Remove Project Member Tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeRemoveProjectMemberTool(createMockProvider())
    expect(tool.description).toContain('Remove a user from a project team')
  })

  test('removes member from project team', async () => {
    const removeProjectMember = mock((projectId: string, userId: string) => Promise.resolve({ projectId, userId }))
    const tool = makeRemoveProjectMemberTool(createMockProvider({ removeProjectMember }))

    const result: unknown = await getToolExecutor(tool)(
      { projectId: 'project-1', userId: 'user-1' },
      { toolCallId: '1', messages: [] },
    )

    assert(isProjectUserResult(result), 'Invalid result')
    expect(result).toEqual({ projectId: 'project-1', userId: 'user-1' })
    expect(removeProjectMember).toHaveBeenCalledWith('project-1', 'user-1')
  })

  test('propagates provider errors', async () => {
    const tool = makeRemoveProjectMemberTool(
      createMockProvider({
        removeProjectMember: mock(() => Promise.reject(new Error('Remove member failed'))),
      }),
    )

    await expect(
      getToolExecutor(tool)({ projectId: 'project-1', userId: 'user-1' }, { toolCallId: '1', messages: [] }),
    ).rejects.toThrow('Remove member failed')
  })

  test('validates required inputs', () => {
    const tool = makeRemoveProjectMemberTool(createMockProvider())
    expect(schemaValidates(tool, { userId: 'user-1' })).toBe(false)
    expect(schemaValidates(tool, { projectId: 'project-1' })).toBe(false)
    expect(schemaValidates(tool, { projectId: 'project-1', userId: 'user-1' })).toBe(true)
  })
})

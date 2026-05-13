import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeAddProjectMemberTool } from '../../src/tools/add-project-member.js'
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

describe('Add Project Member Tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeAddProjectMemberTool(createMockProvider())
    expect(tool.description).toContain('Add a user to a project team')
  })

  test('adds member to project team', async () => {
    const addProjectMember = mock((projectId: string, userId: string) => Promise.resolve({ projectId, userId }))
    const tool = makeAddProjectMemberTool(createMockProvider({ addProjectMember }))

    const result: unknown = await getToolExecutor(tool)(
      { projectId: 'project-1', userId: 'user-1' },
      { toolCallId: '1', messages: [] },
    )

    assert(isProjectUserResult(result), 'Invalid result')
    expect(result).toEqual({ projectId: 'project-1', userId: 'user-1' })
    expect(addProjectMember).toHaveBeenCalledWith('project-1', 'user-1')
  })

  test('propagates provider errors', async () => {
    const tool = makeAddProjectMemberTool(
      createMockProvider({
        addProjectMember: mock(() => Promise.reject(new Error('Add member failed'))),
      }),
    )

    await expect(
      getToolExecutor(tool)({ projectId: 'project-1', userId: 'user-1' }, { toolCallId: '1', messages: [] }),
    ).rejects.toThrow('Add member failed')
  })

  test('validates required inputs', () => {
    const tool = makeAddProjectMemberTool(createMockProvider())
    expect(schemaValidates(tool, { userId: 'user-1' })).toBe(false)
    expect(schemaValidates(tool, { projectId: 'project-1' })).toBe(false)
    expect(schemaValidates(tool, { projectId: 'project-1', userId: 'user-1' })).toBe(true)
  })
})

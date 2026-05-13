import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeListProjectTeamTool } from '../../src/tools/list-project-team.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isUserArray(value: unknown): value is Array<{ id: string }> {
  return Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object' && 'id' in item)
}

describe('List Project Team Tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const tool = makeListProjectTeamTool(createMockProvider())
    expect(tool.description).toContain('List the team')
  })

  test('lists project team members', async () => {
    const listProjectTeam = mock(() =>
      Promise.resolve([
        { id: 'user-1', login: 'alice', name: 'Alice Smith' },
        { id: 'user-2', login: 'bob', name: 'Bob Jones' },
      ]),
    )
    const tool = makeListProjectTeamTool(createMockProvider({ listProjectTeam }))

    const result: unknown = await getToolExecutor(tool)({ projectId: 'project-1' }, { toolCallId: '1', messages: [] })

    assert(isUserArray(result))
    expect(result).toHaveLength(2)
    expect(listProjectTeam).toHaveBeenCalledWith('project-1')
  })

  test('propagates provider errors', async () => {
    const tool = makeListProjectTeamTool(
      createMockProvider({
        listProjectTeam: mock(() => Promise.reject(new Error('List team failed'))),
      }),
    )

    await expect(getToolExecutor(tool)({ projectId: 'project-1' }, { toolCallId: '1', messages: [] })).rejects.toThrow(
      'List team failed',
    )
  })

  test('validates required projectId', () => {
    const tool = makeListProjectTeamTool(createMockProvider())
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { projectId: 'project-1' })).toBe(true)
  })
})

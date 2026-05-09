import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ToolExecutionOptions } from 'ai'

import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import { YouTrackProvider } from '../../../src/providers/youtrack/index.js'
import { makeTools } from '../../../src/tools/index.js'
import { getToolExecutor } from '../../utils/test-helpers.js'

type ProxyTextContent = {
  readonly type: 'text'
  readonly text: string
}

type ProxyTextResult = {
  readonly content: readonly ProxyTextContent[]
  readonly details: Readonly<Record<string, unknown>>
}

const createConfig = (): YouTrackConfig => ({
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
})

function toolOptions(toolCallId: string): ToolExecutionOptions {
  return { toolCallId, messages: [] }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function isProxyTextContent(value: unknown): value is ProxyTextContent {
  return isRecord(value) && value['type'] === 'text' && typeof value['text'] === 'string'
}

function isProxyTextResult(value: unknown): value is ProxyTextResult {
  if (!isRecord(value)) return false
  if (!Array.isArray(value['content'])) return false
  return value['content'].every(isProxyTextContent) && isRecord(value['details'])
}

function expectProxyTextResult(value: unknown): ProxyTextResult {
  assert.ok(isProxyTextResult(value), 'Expected proxy text result')
  return value
}

async function expectToolAvailable(tools: ReturnType<typeof makeTools>, toolName: string): Promise<void> {
  const proxy = tools['papai_tool']
  assert.ok(proxy !== undefined, 'Expected papai_tool to be available')

  const result = expectProxyTextResult(
    await getToolExecutor(proxy)({ describe: toolName }, toolOptions(`describe-${toolName}`)),
  )

  expect(result.details['mode']).toBe('describe')
  expect(result.details['tool']).toBe(toolName)
  expect(result.details['error']).toBeUndefined()
}

describe('YouTrack provider tools integration', () => {
  test('makeTools exposes papai_tool and preserves the expected internal YouTrack tool surface', async () => {
    const provider = new YouTrackProvider(createConfig())
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })

    expect(Object.keys(tools)).toEqual(['papai_tool'])

    await Promise.all(
      [
        'create_task',
        'get_task',
        'update_task',
        'list_tasks',
        'search_tasks',
        'find_user',
        'get_current_user',
        'count_tasks',
        'get_project',
        'list_projects',
        'create_project',
        'update_project',
        'delete_project',
        'list_project_team',
        'add_project_member',
        'remove_project_member',
        'add_comment',
        'get_comments',
        'update_comment',
        'remove_comment',
        'add_comment_reaction',
        'remove_comment_reaction',
        'list_labels',
        'create_label',
        'update_label',
        'remove_label',
        'add_task_label',
        'remove_task_label',
        'add_task_relation',
        'update_task_relation',
        'remove_task_relation',
        'list_watchers',
        'add_watcher',
        'remove_watcher',
        'add_vote',
        'remove_vote',
        'set_visibility',
        'list_statuses',
        'create_status',
        'update_status',
        'delete_status',
        'reorder_statuses',
        'list_agiles',
        'list_sprints',
        'create_sprint',
        'update_sprint',
        'assign_task_to_sprint',
        'get_task_history',
        'list_saved_queries',
        'run_saved_query',
        'apply_youtrack_command',
      ].map((toolName) => expectToolAvailable(tools, toolName)),
    )
  })
})

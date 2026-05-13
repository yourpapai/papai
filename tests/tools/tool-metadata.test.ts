import { describe, expect, it, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { buildToolMetadata, findToolMetadata, getToolMetadata, TOOL_METADATA } from '../../src/tools/tool-metadata.js'

const getToolRisk = (toolName: string): string | undefined => {
  const metadata = getToolMetadata(toolName)
  if (metadata === undefined) return undefined
  return metadata.risk
}

describe('tool metadata', () => {
  test('tags core tools with domain, operation, and risk', () => {
    expect(getToolMetadata('create_task')).toEqual({
      domain: 'task',
      operation: 'create',
      risk: 'write',
    })
    expect(getToolMetadata('get_task')).toEqual({
      domain: 'task',
      operation: 'read',
      risk: 'read',
    })
  })

  test('tags destructive and open-world tools distinctly', () => {
    expect(getToolRisk('delete_task')).toBe('destructive')
    expect(getToolMetadata('web_fetch')).toEqual({
      domain: 'web',
      operation: 'read',
      risk: 'open-world',
    })
  })

  test('identifies read-only tools', () => {
    expect(getToolRisk('list_tasks')).toBe('read')
    expect(getToolRisk('create_task')).toBe('write')
    expect(getToolRisk('web_fetch')).toBe('open-world')
  })

  test('covers representative high-pollution tool clusters', () => {
    for (const name of [
      'create_deferred_prompt',
      'pause_recurring_task',
      'add_comment_reaction',
      'assign_task_to_sprint',
      'run_saved_query',
    ]) {
      expect(TOOL_METADATA[name]).toBeDefined()
    }
  })
})

describe('tool metadata catalog', () => {
  it('extracts name, description, schema, and executable flag', () => {
    const tools: ToolSet = {
      search_tasks: tool({
        description: 'Search tasks by text',
        inputSchema: z.object({ query: z.string().describe('Search text') }),
        execute: () => [],
      }),
    }

    const metadata = buildToolMetadata(tools)

    expect(metadata).toHaveLength(1)
    expect(metadata[0]).toMatchObject({
      name: 'search_tasks',
      description: 'Search tasks by text',
      executable: true,
    })
    expect(metadata[0]).toHaveProperty('inputSchema')
  })

  it('keeps non-executable tools visible for describe errors', () => {
    const tools: ToolSet = {
      queued_tool: {
        description: 'Queued tool without local executor',
        inputSchema: z.object({ id: z.string() }),
      },
    }

    expect(buildToolMetadata(tools)[0]).toMatchObject({
      name: 'queued_tool',
      description: 'Queued tool without local executor',
      executable: false,
    })
  })

  it('resolves exact and hyphen-normalized tool names', () => {
    const metadata = buildToolMetadata({
      add_task_relation: tool({
        description: 'Add relation',
        inputSchema: z.object({ taskId: z.string() }),
        execute: () => ({}),
      }),
    })

    expect(findToolMetadata(metadata, 'add_task_relation')).toMatchObject({ name: 'add_task_relation' })
    expect(findToolMetadata(metadata, 'add-task-relation')).toMatchObject({ name: 'add_task_relation' })
  })
})

import { describe, expect, it } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { buildToolMetadata, findToolMetadata } from '../../src/tools/tool-metadata.js'

describe('tool-metadata', () => {
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

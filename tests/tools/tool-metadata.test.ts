import { describe, expect, test } from 'bun:test'

import { getToolMetadata, TOOL_METADATA } from '../../src/tools/tool-metadata.js'

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

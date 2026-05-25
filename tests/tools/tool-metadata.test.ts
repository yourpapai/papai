// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

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

  test('includes delete_file with destructive attachment classification', () => {
    expect(getToolMetadata('delete_file')).toEqual({
      domain: 'attachment',
      operation: 'delete',
      risk: 'destructive',
    })
  })

  test('includes list_files, search_staged_files, resolve_staged_file as read attachment', () => {
    for (const name of ['list_files', 'search_staged_files', 'resolve_staged_file']) {
      expect(getToolMetadata(name)).toEqual({
        domain: 'attachment',
        operation: 'read',
        risk: 'read',
      })
    }
  })
})

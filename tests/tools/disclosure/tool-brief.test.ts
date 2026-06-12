// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { buildBriefs } from '../../../src/tools/disclosure/tool-brief.js'

const t = (description: string): ToolSet[string] =>
  tool({ description, inputSchema: z.object({}), execute: () => ({}) })

describe('buildBriefs', () => {
  it('uses the first sentence of the description as the summary', () => {
    const briefs = buildBriefs({ list_tasks: t('List tasks in a project. Supports filters and paging.') })
    expect(briefs[0]).toEqual({ name: 'list_tasks', summary: 'List tasks in a project.', domain: 'task' })
  })

  it('derives mcp domain for namespaced tools and tolerates empty descriptions', () => {
    const briefs = buildBriefs({ mcp_github__get_issue: t('') })
    expect(briefs[0]!.domain).toBe('mcp')
    expect(briefs[0]!.summary).toBe('')
  })

  it('caps very long single-sentence summaries', () => {
    const long = `${'word '.repeat(60)}done`
    const briefs = buildBriefs({ web_fetch: t(long) })
    expect(briefs[0]!.summary.length).toBeLessThanOrEqual(160)
    expect(briefs[0]!.summary.endsWith('…')).toBe(true)
  })

  it('does not truncate at inline abbreviations like e.g.', () => {
    const briefs = buildBriefs({
      create_task_relation: t(
        'Create a directed relation between two tasks (e.g. one blocks another, or marks a duplicate).',
      ),
    })
    expect(briefs[0]!.summary).toBe(
      'Create a directed relation between two tasks (e.g. one blocks another, or marks a duplicate).',
    )
  })

  it('returns empty summary for a tool without a description', () => {
    const noDesc = tool({ inputSchema: z.object({}), execute: () => ({}) })
    const briefs = buildBriefs({ some_tool: noDesc })
    expect(briefs[0]!.summary).toBe('')
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, mock } from 'bun:test'
import assert from 'node:assert/strict'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

const emitUser = mock(() => {})
void mock.module('../../../src/debug/event-bus.js', () => ({ emitUser }))

const { makeSearchToolsTool } = await import('../../../src/tools/disclosure/search-tools.js')
const { createDisclosureSession } = await import('../../../src/tools/disclosure/registry.js')
const { CORE_TOOL_NAMES } = await import('../../../src/tools/disclosure/core.js')
const { LexicalToolRetriever } = await import('../../../src/tools/disclosure/tool-retriever.js')
import type { ToolRetriever } from '../../../src/tools/disclosure/tool-retriever.js'
const { getToolExecutor } = await import('../../utils/test-helpers.js')
const { isToolFailureResult } = await import('../../../src/tool-failure.js')

const d = (desc: string): ToolSet[string] => tool({ description: desc, inputSchema: z.object({}), execute: () => ({}) })

interface SearchResult {
  name: string
  summary: string
  domain: string
  alreadyLoaded: boolean
}

interface SearchOut {
  results: SearchResult[]
}

function isSearchOut(val: unknown): val is SearchOut {
  return (
    val !== null && typeof val === 'object' && 'results' in val && Array.isArray((val as { results: unknown }).results)
  )
}

describe('search_tools', () => {
  it('returns ranked briefs without input schemas', async () => {
    const tools: ToolSet = {
      get_current_time: d('Get the time.'),
      search_tools: d('search'),
      load_tool: d('load'),
      list_tasks: d('List tasks in a project.'),
      web_fetch: d('Fetch a web page.'),
    }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const exec = getToolExecutor(makeSearchToolsTool(session, new LexicalToolRetriever(), 'ctx-1', tools))
    const out: unknown = await exec({ query: 'list tasks', limit: 5 })
    assert.ok(isSearchOut(out))
    expect(out.results[0]).toEqual({
      name: 'list_tasks',
      summary: 'List tasks in a project.',
      domain: 'task',
      alreadyLoaded: false,
    })
    expect(out.results.every((r) => !('inputSchema' in r))).toBe(true)
    expect(emitUser).toHaveBeenCalled()
  })

  it('does not surface always-on tools as discoverable', async () => {
    const tools: ToolSet = { get_current_time: d('Get the time now.'), search_tools: d('search'), load_tool: d('load') }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const exec = getToolExecutor(makeSearchToolsTool(session, new LexicalToolRetriever(), 'ctx-1', tools))
    const out: unknown = await exec({ query: 'time', limit: 5 })
    assert.ok(isSearchOut(out))
    expect(out.results).toEqual([])
  })

  it('returns a structured failure result when the retriever throws', async () => {
    const tools: ToolSet = { get_current_time: d('Get the time.'), list_tasks: d('List tasks.') }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const throwingRetriever: ToolRetriever = {
      rank: () => Promise.reject(new Error('retriever edge case')),
    }
    const exec = getToolExecutor(makeSearchToolsTool(session, throwingRetriever, 'ctx-1', tools))
    const out: unknown = await exec({ query: 'tasks', limit: 5 })
    assert.ok(isToolFailureResult(out), `expected ToolFailureResult, got: ${JSON.stringify(out)}`)
    expect(out.success).toBe(false)
    expect(out.error).toContain('retriever edge case')
    expect(out.toolName).toBe('search_tools')
  })
})

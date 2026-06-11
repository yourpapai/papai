// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import assert from 'node:assert/strict'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

const resolveReductionFlags = mock(() => ({
  progressiveDisclosure: false,
  resultCompaction: false,
  semanticToolRetrieval: false,
}))
void mock.module('../../../src/tools/feature-flags.js', () => ({
  resolveReductionFlags,
  REDUCTION_FLAGS_CONFIG_KEY: 'tool_context_flags',
}))

const { maybeApplyDisclosure } = await import('../../../src/tools/disclosure/wire.js')
const { LexicalToolRetriever } = await import('../../../src/tools/disclosure/tool-retriever.js')

const d = (): ToolSet[string] => tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) })

describe('maybeApplyDisclosure', () => {
  beforeEach(() => {
    resolveReductionFlags.mockReset()
  })

  it('is a pass-through when enabled is false', () => {
    const tools: ToolSet = { get_current_time: d(), list_tasks: d() }
    const out = maybeApplyDisclosure(tools, 'ctx-1', new LexicalToolRetriever(), { enabled: false })
    expect(out.tools).toBe(tools)
    expect(out.disclosure).toBeUndefined()
  })

  it('adds meta tools and a session when enabled is true', () => {
    const tools: ToolSet = { get_current_time: d(), list_tasks: d() }
    const out = maybeApplyDisclosure(tools, 'ctx-1', new LexicalToolRetriever(), { enabled: true })
    expect(out.tools['search_tools']).toBeDefined()
    expect(out.tools['load_tool']).toBeDefined()
    assert.ok(out.disclosure !== undefined)
    expect(out.disclosure.allNames.has('list_tasks')).toBe(true)
    expect(out.disclosure.allNames.has('search_tools')).toBe(true)
    expect(out.disclosure.allNames.has('load_tool')).toBe(true)
    expect(out.tools).not.toBe(tools)
  })

  it('never re-resolves reduction flags itself', () => {
    const tools: ToolSet = { get_current_time: d() }
    maybeApplyDisclosure(tools, 'ctx-1', new LexicalToolRetriever(), { enabled: true })
    maybeApplyDisclosure(tools, 'ctx-1', new LexicalToolRetriever(), { enabled: false })
    expect(resolveReductionFlags).not.toHaveBeenCalled()
  })
})

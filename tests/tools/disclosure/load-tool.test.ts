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

const { makeLoadToolTool } = await import('../../../src/tools/disclosure/load-tool.js')
const { createDisclosureSession } = await import('../../../src/tools/disclosure/registry.js')
const { CORE_TOOL_NAMES } = await import('../../../src/tools/disclosure/core.js')
const { getToolExecutor } = await import('../../utils/test-helpers.js')

const d = (): ToolSet[string] => tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) })

interface LoadOut {
  loaded: string[]
  unknown: string[]
  nowActive: number
}

function isLoadOut(val: unknown): val is LoadOut {
  return (
    val !== null &&
    typeof val === 'object' &&
    'loaded' in val &&
    'unknown' in val &&
    'nowActive' in val &&
    Array.isArray((val as { loaded: unknown }).loaded) &&
    Array.isArray((val as { unknown: unknown }).unknown) &&
    typeof (val as { nowActive: unknown }).nowActive === 'number'
  )
}

describe('load_tool', () => {
  it('loads known tools and reports unknown ones, returning the new active count', async () => {
    const tools: ToolSet = { get_current_time: d(), search_tools: d(), load_tool: d(), list_tasks: d(), get_task: d() }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const exec = getToolExecutor(makeLoadToolTool(session, 'ctx-1'))
    const out: unknown = await exec({ names: ['list_tasks', 'get_task', 'bogus'] })
    assert.ok(isLoadOut(out))
    expect(out.loaded.toSorted()).toEqual(['get_task', 'list_tasks'])
    expect(out.unknown).toEqual(['bogus'])
    expect(session.activeToolNames()).toContain('list_tasks')
    expect(out.nowActive).toBe(session.activeToolNames().length)
    expect(emitUser).toHaveBeenCalled()
  })
})

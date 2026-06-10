// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, mock } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

const emitUser = mock(() => {})
void mock.module('../../../src/debug/event-bus.js', () => ({ emitUser }))

const { createDisclosurePrepareStep } = await import('../../../src/tools/disclosure/prepare-step.js')
const { createDisclosureSession } = await import('../../../src/tools/disclosure/registry.js')
const { CORE_TOOL_NAMES } = await import('../../../src/tools/disclosure/core.js')

const d = (): ToolSet[string] => tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) })

function freshSession(): ReturnType<typeof createDisclosureSession> {
  const tools: ToolSet = { get_current_time: d(), search_tools: d(), load_tool: d(), list_tasks: d() }
  return createDisclosureSession(tools, CORE_TOOL_NAMES)
}

describe('createDisclosurePrepareStep', () => {
  it('returns the active tool subset on early steps', () => {
    const session = freshSession()
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    const out = prep({ stepNumber: 0 }) as { activeTools?: string[] }
    expect(out.activeTools).toBeDefined()
    expect(out.activeTools!.toSorted()).toEqual(['get_current_time', 'load_tool', 'search_tools'])
  })

  it('opens all tools (returns {}) once stalled with no loads, emitting fallback once', () => {
    const session = freshSession()
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    emitUser.mockReset()
    expect(prep({ stepNumber: 2 })).toEqual({})
    expect(prep({ stepNumber: 3 })).toEqual({})
    expect(emitUser).toHaveBeenCalledTimes(1)
  })

  it('does not fall back once a tool has been loaded', () => {
    const session = freshSession()
    session.markLoaded(['list_tasks'])
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    const out = prep({ stepNumber: 5 }) as { activeTools?: string[] }
    expect(out.activeTools).toContain('list_tasks')
  })
})

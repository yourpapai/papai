// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

const emitUser = mock(() => {})
void mock.module('../../../src/debug/event-bus.js', () => ({ emitUser }))

const { createDisclosurePrepareStep } = await import('../../../src/tools/disclosure/prepare-step.js')
const { createDisclosureSession } = await import('../../../src/tools/disclosure/registry.js')
const { CORE_TOOL_NAMES, DISCLOSURE_STALL_STEPS } = await import('../../../src/tools/disclosure/core.js')

const d = (): ToolSet[string] => tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) })

function freshSession(): ReturnType<typeof createDisclosureSession> {
  const tools: ToolSet = { get_current_time: d(), search_tools: d(), load_tool: d(), list_tasks: d() }
  return createDisclosureSession(tools, CORE_TOOL_NAMES)
}

describe('createDisclosurePrepareStep', () => {
  beforeEach(() => {
    emitUser.mockReset()
  })

  it('returns the active tool subset on early steps', () => {
    const session = freshSession()
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    const out = prep({ stepNumber: 0 })
    expect(out.activeTools).toBeDefined()
    expect(out.activeTools!.toSorted()).toEqual(['get_current_time', 'load_tool', 'search_tools'])
  })

  it('returns defined activeTools one step before the stall boundary', () => {
    const session = freshSession()
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    const out = prep({ stepNumber: DISCLOSURE_STALL_STEPS - 1 })
    expect(out.activeTools).toBeDefined()
  })

  it('opens all tools (returns {}) once stalled with no loads, emitting fallback once', () => {
    const session = freshSession()
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    expect(prep({ stepNumber: DISCLOSURE_STALL_STEPS })).toEqual({})
    expect(prep({ stepNumber: DISCLOSURE_STALL_STEPS + 1 })).toEqual({})
    expect(emitUser).toHaveBeenCalledTimes(1)
  })

  it('emitUser receives the exact stall stepNumber in the payload', () => {
    const session = freshSession()
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    prep({ stepNumber: DISCLOSURE_STALL_STEPS })
    // Third arg must be the payload object containing stepNumber = DISCLOSURE_STALL_STEPS.
    expect(emitUser).toHaveBeenCalledWith(
      'disclosure:fallback',
      'ctx-1',
      { stepNumber: DISCLOSURE_STALL_STEPS },
      undefined,
    )
  })

  it('passes turnId as 4th arg to emitUser on fallback when provided', () => {
    const session = freshSession()
    const prep = createDisclosurePrepareStep(session, 'ctx-1', 'turn-42')
    prep({ stepNumber: DISCLOSURE_STALL_STEPS })
    expect(emitUser).toHaveBeenCalledWith('disclosure:fallback', 'ctx-1', expect.anything(), 'turn-42')
  })

  it('does not fall back once a tool has been loaded', () => {
    const session = freshSession()
    session.markLoaded(['list_tasks'])
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    const out = prep({ stepNumber: 5 })
    expect(out.activeTools).toContain('list_tasks')
  })
})

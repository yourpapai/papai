// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { subscribe, unsubscribe, type DebugEvent } from '../../../src/debug/event-bus.js'
import { CORE_TOOL_NAMES, DISCLOSURE_STALL_STEPS } from '../../../src/tools/disclosure/core.js'
import { createDisclosurePrepareStep } from '../../../src/tools/disclosure/prepare-step.js'
import { createDisclosureSession } from '../../../src/tools/disclosure/registry.js'

let events: DebugEvent[] = []
const listener = (event: DebugEvent): void => {
  events.push(event)
}
const fallbackEvents = (): DebugEvent[] => events.filter((e) => e.type === 'disclosure:fallback')

const d = (): ToolSet[string] => tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) })

function freshSession(): ReturnType<typeof createDisclosureSession> {
  const tools: ToolSet = { get_current_time: d(), search_tools: d(), load_tool: d(), list_tasks: d() }
  return createDisclosureSession(tools, CORE_TOOL_NAMES)
}

describe('createDisclosurePrepareStep', () => {
  beforeEach(() => {
    events = []
    subscribe(listener)
  })

  afterEach(() => {
    unsubscribe(listener)
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
    expect(fallbackEvents()).toHaveLength(1)
  })

  it('the fallback event carries the exact stall stepNumber and user scope', () => {
    const session = freshSession()
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    prep({ stepNumber: DISCLOSURE_STALL_STEPS })
    const [event] = fallbackEvents()
    expect(event).toBeDefined()
    expect(event?.data).toEqual({ stepNumber: DISCLOSURE_STALL_STEPS })
    expect(event?.scope).toEqual({ kind: 'user', userId: 'ctx-1' })
    expect(event?.turnId).toBeUndefined()
  })

  it('the fallback event carries the turnId when provided', () => {
    const session = freshSession()
    const prep = createDisclosurePrepareStep(session, 'ctx-1', 'turn-42')
    prep({ stepNumber: DISCLOSURE_STALL_STEPS })
    expect(fallbackEvents()[0]?.turnId).toBe('turn-42')
  })

  it('does not fall back once a tool has been loaded', () => {
    const session = freshSession()
    session.markLoaded(['list_tasks'])
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    const out = prep({ stepNumber: 5 })
    expect(out.activeTools).toContain('list_tasks')
  })

  const metaStep = { toolCalls: [{ toolName: 'search_tools' }] }
  const realStep = { toolCalls: [{ toolName: 'list_tasks' }] }

  it('opens all tools when the last N completed steps are meta-only churn after a load', () => {
    const session = freshSession()
    session.markLoaded(['list_tasks'])
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    const out = prep({ stepNumber: 5, steps: [realStep, metaStep, metaStep] })
    expect(out).toEqual({})
    expect(fallbackEvents()).toHaveLength(1)
  })

  it('does not churn-fallback when a recent step called a real tool', () => {
    const session = freshSession()
    session.markLoaded(['list_tasks'])
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    const out = prep({ stepNumber: 5, steps: [metaStep, realStep] })
    expect(out.activeTools).toBeDefined()
    expect(fallbackEvents()).toHaveLength(0)
  })

  it('a step with zero tool calls does not count toward churn', () => {
    const session = freshSession()
    session.markLoaded(['list_tasks'])
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    const out = prep({ stepNumber: 5, steps: [{ toolCalls: [] }, metaStep] })
    expect(out.activeTools).toBeDefined()
  })

  it('stays open after a churn fallback even when a later step looks healthy', () => {
    const session = freshSession()
    session.markLoaded(['list_tasks'])
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    expect(prep({ stepNumber: 5, steps: [metaStep, metaStep] })).toEqual({})
    expect(prep({ stepNumber: 6, steps: [metaStep, metaStep, realStep] })).toEqual({})
    expect(fallbackEvents()).toHaveLength(1)
  })

  it('a step mixing meta and real tool calls does not count toward churn', () => {
    const session = freshSession()
    session.markLoaded(['list_tasks'])
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    const mixedStep = { toolCalls: [{ toolName: 'search_tools' }, { toolName: 'list_tasks' }] }
    const out = prep({ stepNumber: 5, steps: [mixedStep, mixedStep] })
    expect(out.activeTools).toBeDefined()
    expect(fallbackEvents()).toHaveLength(0)
  })

  it('an empty or too-short steps window never counts as churn after a load', () => {
    const session = freshSession()
    session.markLoaded(['list_tasks'])
    const prep = createDisclosurePrepareStep(session, 'ctx-1')
    expect(prep({ stepNumber: 5, steps: [] }).activeTools).toBeDefined()
    expect(prep({ stepNumber: 6, steps: [metaStep] }).activeTools).toBeDefined()
    expect(fallbackEvents()).toHaveLength(0)
  })
})

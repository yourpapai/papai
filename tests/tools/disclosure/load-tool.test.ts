// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import assert from 'node:assert/strict'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { subscribe, unsubscribe, type DebugEvent } from '../../../src/debug/event-bus.js'
import { CORE_TOOL_NAMES } from '../../../src/tools/disclosure/core.js'
import { makeLoadToolTool } from '../../../src/tools/disclosure/load-tool.js'
import { createDisclosureSession } from '../../../src/tools/disclosure/registry.js'
import { getToolExecutor } from '../../utils/test-helpers.js'

let events: DebugEvent[] = []
const listener = (event: DebugEvent): void => {
  events.push(event)
}

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
  beforeEach(() => {
    events = []
    subscribe(listener)
  })

  afterEach(() => {
    unsubscribe(listener)
  })

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
    expect(events.some((e) => e.type === 'disclosure:load')).toBe(true)
  })

  it('reports an all-unknown batch without activating anything', async () => {
    const tools: ToolSet = { get_current_time: d(), search_tools: d(), load_tool: d() }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const baseline = session.activeToolNames().length
    const exec = getToolExecutor(makeLoadToolTool(session, 'ctx-1'))
    const out: unknown = await exec({ names: ['nope1', 'nope2'] })
    assert.ok(isLoadOut(out))
    expect(out.loaded).toEqual([])
    expect(out.unknown).toEqual(['nope1', 'nope2'])
    expect(out.nowActive).toBe(baseline)
  })
})

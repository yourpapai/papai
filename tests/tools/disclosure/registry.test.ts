// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { CORE_TOOL_NAMES } from '../../../src/tools/disclosure/core.js'
import { createDisclosureSession, type DisclosureSession } from '../../../src/tools/disclosure/registry.js'

const stub = (): ToolSet[string] => tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) })

function forceAddToSet(set: ReadonlySet<string>, value: string): void {
  const mutable: unknown = set
  if (mutable instanceof Set) {
    mutable.add(value)
  }
}

function sessionWith(names: string[]): DisclosureSession {
  const tools: ToolSet = {}
  for (const n of names) tools[n] = stub()
  return createDisclosureSession(tools, CORE_TOOL_NAMES)
}

describe('DisclosureSession', () => {
  it('activeToolNames starts as core ∪ meta only', () => {
    const s = sessionWith(['get_current_time', 'search_tools', 'load_tool', 'list_tasks', 'web_fetch'])
    expect(s.activeToolNames().toSorted()).toEqual(['get_current_time', 'load_tool', 'search_tools'])
  })

  it('load adds known names and reports unknown ones', () => {
    const s = sessionWith(['get_current_time', 'search_tools', 'load_tool', 'list_tasks'])
    const res = s.markLoaded(['list_tasks', 'nope'])
    expect(res).toEqual({ loaded: ['list_tasks'], unknown: ['nope'] })
    expect(s.activeToolNames()).toContain('list_tasks')
    expect(s.hasLoaded()).toBe(true)
  })

  it('load is idempotent and never returns names outside allNames', () => {
    const s = sessionWith(['get_current_time', 'search_tools', 'load_tool', 'list_tasks'])
    s.markLoaded(['list_tasks'])
    s.markLoaded(['list_tasks'])
    const active = s.activeToolNames()
    expect(active.filter((n) => n === 'list_tasks').length).toBe(1)
    expect(active.every((n) => s.allNames.has(n))).toBe(true)
  })

  it('hasLoaded is false before any successful load', () => {
    const s = sessionWith(['get_current_time', 'search_tools', 'load_tool'])
    s.markLoaded(['unknown_only'])
    expect(s.hasLoaded()).toBe(false)
  })

  it('mutating the exposed allNames does not affect session behavior', () => {
    const s = sessionWith(['get_current_time', 'search_tools', 'load_tool'])
    forceAddToSet(s.allNames, 'sneaky_tool')
    expect(s.markLoaded(['sneaky_tool']).unknown).toEqual(['sneaky_tool'])
    expect(s.activeToolNames()).not.toContain('sneaky_tool')
  })
})

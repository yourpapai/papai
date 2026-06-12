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

  it('a core name absent from the tool set is NOT included in activeToolNames', () => {
    // coreNames contains 'ghost_tool' which was never registered in fullTools.
    // The allNames.has(n) guard on line 24 must exclude it.
    const tools: ToolSet = { get_current_time: stub(), search_tools: stub(), load_tool: stub() }
    const customCoreNames = new Set(['get_current_time', 'ghost_tool'])
    const s = createDisclosureSession(tools, customCoreNames)
    expect(s.activeToolNames()).not.toContain('ghost_tool')
    // get_current_time is in both coreNames and allNames → it IS active
    expect(s.activeToolNames()).toContain('get_current_time')
  })

  it('markLoaded does not add a name absent from allNames to activeToolNames', () => {
    // Directly test line 26: loaded set may contain names checked against allNames.
    // We force a name into the loaded set via markLoaded with a known name, then remove it
    // from the underlying tool set — but since allNames is frozen at construction time,
    // instead verify that markLoaded on a known name IS in activeToolNames (positive case),
    // and that the unknown set is excluded even if the session is told to load it.
    const s = sessionWith(['get_current_time', 'search_tools', 'load_tool', 'list_tasks'])
    // 'outsider_tool' is not in allNames → markLoaded returns it as unknown
    s.markLoaded(['outsider_tool'])
    // activeToolNames should never include a name not in allNames
    expect(s.activeToolNames().every((n) => s.allNames.has(n))).toBe(true)
    expect(s.activeToolNames()).not.toContain('outsider_tool')
  })

  it('markLoaded(["search_tools"]) returns search_tools in loaded array but hasLoaded stays false', () => {
    // Always-on name is "accepted" (returned in loaded[]) but does NOT count as a meaningful load.
    const s = sessionWith(['get_current_time', 'search_tools', 'load_tool', 'list_tasks'])
    const res = s.markLoaded(['search_tools'])
    expect(res.loaded).toContain('search_tools')
    expect(res.unknown).toEqual([])
    expect(s.hasLoaded()).toBe(false)
  })

  it('markLoaded with an always-on name plus a real tool counts as loaded', () => {
    // When a real (non-always-on) tool is included, hasLoaded must be true.
    const s = sessionWith(['get_current_time', 'search_tools', 'load_tool', 'list_tasks'])
    const res = s.markLoaded(['search_tools', 'list_tasks'])
    expect(res.loaded).toContain('search_tools')
    expect(res.loaded).toContain('list_tasks')
    expect(s.hasLoaded()).toBe(true)
  })
})

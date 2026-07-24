// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { createToolCapabilityCatalog } from '../../src/runtime/capability-catalog.js'
import { CORE_TOOL_CAPABILITIES, registerOfferedCoreToolCapabilities } from '../../src/tools/core-capabilities.js'

const stub = tool({
  description: 'stub',
  inputSchema: z.object({}),
  execute: () => Promise.resolve('ok'),
})

const SCHEDULING_WIRE_NAMES = [
  'create_recurring_task',
  'list_recurring_tasks',
  'update_recurring_task',
  'pause_recurring_task',
  'resume_recurring_task',
  'skip_recurring_task',
  'delete_recurring_task',
  'create_deferred_prompt',
  'list_deferred_prompts',
  'get_deferred_prompt',
  'update_deferred_prompt',
  'cancel_deferred_prompt',
] as const

describe('scheduling capability ids', () => {
  test('every scheduling tool resolves from its capability id when offered', () => {
    const tools: ToolSet = Object.fromEntries(SCHEDULING_WIRE_NAMES.map((name) => [name, stub]))
    const catalog = createToolCapabilityCatalog()
    registerOfferedCoreToolCapabilities(tools, catalog)

    expect(catalog.resolve('recurring.create')).toBe('create_recurring_task')
    expect(catalog.resolve('recurring.pause')).toBe('pause_recurring_task')
    expect(catalog.resolve('recurring.delete')).toBe('delete_recurring_task')
    expect(catalog.resolve('deferred.create')).toBe('create_deferred_prompt')
    expect(catalog.resolve('deferred.cancel')).toBe('cancel_deferred_prompt')
  })

  test('the 12 scheduling ids are all present in the capability map', () => {
    const wireNames = new Set(Object.values(CORE_TOOL_CAPABILITIES))
    for (const name of SCHEDULING_WIRE_NAMES) expect(wireNames.has(name)).toBe(true)
  })

  test('an unoffered scheduling tool is not registered', () => {
    const catalog = createToolCapabilityCatalog()
    registerOfferedCoreToolCapabilities({}, catalog)
    expect(() => catalog.resolve('recurring.create')).toThrow(/Unknown tool capability id/u)
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { createToolCapabilityCatalog } from '../../src/runtime/capability-catalog.js'
import { CORE_TOOL_CAPABILITIES, registerOfferedCoreToolCapabilities } from '../../src/tools/core-capabilities.js'
import { applyToolPreferences } from '../../src/tools/index.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const offered = (...names: readonly string[]): ToolSet =>
  Object.fromEntries(
    names.map((name) => [name, tool({ description: name, inputSchema: z.object({}), execute: () => undefined })]),
  )

describe('core tool capabilities', () => {
  test('publishes an immutable stable mapping', () => {
    expect(Object.isFrozen(CORE_TOOL_CAPABILITIES)).toBe(true)
  })

  test('registers the four stable task capabilities when their real wire tools are offered', () => {
    const catalog = createToolCapabilityCatalog()

    registerOfferedCoreToolCapabilities(offered(...Object.values(CORE_TOOL_CAPABILITIES)), catalog)

    expect(catalog.entries()).toEqual([
      ['tasks.create', 'create_task'],
      ['tasks.get', 'get_task'],
      ['tasks.list', 'list_tasks'],
      ['tasks.search', 'search_tasks'],
    ])
  })

  test('does not register a capability whose tool is absent from the offered turn surface', () => {
    const catalog = createToolCapabilityCatalog()

    registerOfferedCoreToolCapabilities(offered('get_task', 'list_tasks', 'search_tasks'), catalog)

    expect(() => catalog.resolve('tasks.create')).toThrow("Unknown tool capability id 'tasks.create'")
  })

  test('does not advertise a denied tool even when an earlier catalog knows its stable mapping', async () => {
    mockLogger()
    await setupTestDb()
    const catalog = createToolCapabilityCatalog()
    registerOfferedCoreToolCapabilities(offered('create_task'), catalog)
    setToolPrefs('ctx-denied-core', {
      riskDefaults: {},
      domainDefaults: {},
      toolOverrides: { create_task: 'deny' },
    })

    const nextTurnTools = applyToolPreferences(offered('create_task', 'get_task'), 'ctx-denied-core', undefined)

    expect(Object.hasOwn(nextTurnTools, catalog.resolve('tasks.create'))).toBe(false)
  })

  test('derives every turn independently without carrying stale wire names', () => {
    const first = createToolCapabilityCatalog()
    const second = createToolCapabilityCatalog()
    registerOfferedCoreToolCapabilities(offered('create_task'), first)
    registerOfferedCoreToolCapabilities(offered('get_task'), second)

    expect(first.resolve('tasks.create')).toBe('create_task')
    expect(() => second.resolve('tasks.create')).toThrow("Unknown tool capability id 'tasks.create'")
    expect(second.resolve('tasks.get')).toBe('get_task')
  })
})

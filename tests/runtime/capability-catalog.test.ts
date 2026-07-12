// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createToolCapabilityCatalog } from '../../src/runtime/capability-catalog.js'
import { activate } from '../plugins/acp/support.js'

describe('ToolCapabilityCatalog', () => {
  test('registers and resolves capability ids', () => {
    const catalog = createToolCapabilityCatalog()

    catalog.register('coding-session.start', 'plugin_acp__start_session')

    expect(catalog.resolve('coding-session.start')).toBe('plugin_acp__start_session')
    expect(catalog.entries()).toEqual([['coding-session.start', 'plugin_acp__start_session']])
  })

  test('accepts repeated registration of the same capability and wire name', () => {
    const catalog = createToolCapabilityCatalog()

    catalog.register('coding-session.start', 'plugin_acp__start_session')
    catalog.register('coding-session.start', 'plugin_acp__start_session')

    expect(catalog.entries()).toEqual([['coding-session.start', 'plugin_acp__start_session']])
  })

  test('rejects a capability id registered to a different wire name', () => {
    const catalog = createToolCapabilityCatalog()
    catalog.register('coding-session.start', 'plugin_acp__start_session')

    expect(() => catalog.register('coding-session.start', 'plugin_coding__start_session')).toThrow(
      "Duplicate tool capability id 'coding-session.start'",
    )
  })

  test('rejects resolution of an unknown capability id', () => {
    const catalog = createToolCapabilityCatalog()

    expect(() => catalog.resolve('coding-session.start')).toThrow("Unknown tool capability id 'coding-session.start'")
  })

  test('clears all registrations', () => {
    const catalog = createToolCapabilityCatalog()
    catalog.register('coding-session.start', 'plugin_acp__start_session')

    catalog.clear()

    expect(catalog.entries()).toEqual([])
  })
})

describe('ACP tool capability metadata', () => {
  test('assigns stable capabilities without changing tool wire names', () => {
    const { tools } = activate(() => Promise.resolve(new Response('{}')))

    expect(Array.from(tools.values()).map(({ name, capabilityId }) => [name, capabilityId])).toEqual([
      ['list_projects', 'coding-session.projects.list'],
      ['list_agents', 'coding-session.agents.list'],
      ['start_session', 'coding-session.start'],
      ['list_sessions', 'coding-session.list'],
      ['session_status', 'coding-session.status'],
      ['finish_session', 'coding-session.finish'],
      ['cancel_session', 'coding-session.cancel'],
      ['answer_permission', 'coding-session.permission.answer'],
      ['continue_session', 'coding-session.continue'],
    ])
  })
})

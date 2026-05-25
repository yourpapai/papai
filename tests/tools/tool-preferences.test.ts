// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  getDomainStatus,
  isToolEnabled,
  parseToolPrefs,
  partitionToolNames,
  serializeToolPrefs,
  toggleDomain,
  toggleTool,
  type ToolPrefs,
} from '../../src/tools/tool-preferences.js'

const empty: ToolPrefs = { disabledDomains: [], toolOverrides: {} }

describe('parseToolPrefs', () => {
  it('returns empty prefs for null', () => {
    expect(parseToolPrefs(null)).toEqual(empty)
  })

  it('returns empty prefs for corrupt JSON', () => {
    expect(parseToolPrefs('{not json')).toEqual(empty)
  })

  it('coerces missing fields and drops non-array/object shapes', () => {
    expect(parseToolPrefs('{"disabledDomains":"web"}')).toEqual(empty)
  })

  it('round-trips a valid blob', () => {
    const prefs: ToolPrefs = { disabledDomains: ['web'], toolOverrides: { delete_task: false } }
    expect(parseToolPrefs(serializeToolPrefs(prefs))).toEqual(prefs)
  })
})

describe('isToolEnabled', () => {
  it('defaults every tool to enabled with empty prefs', () => {
    expect(isToolEnabled(empty, 'web_fetch')).toBe(true)
    expect(isToolEnabled(empty, 'delete_task')).toBe(true)
  })

  it('disables every tool in a disabled domain', () => {
    const prefs: ToolPrefs = { disabledDomains: ['web'], toolOverrides: {} }
    expect(isToolEnabled(prefs, 'web_fetch')).toBe(false)
  })

  it('lets a per-tool override win over the domain default (off within on domain)', () => {
    const prefs: ToolPrefs = { disabledDomains: [], toolOverrides: { delete_task: false } }
    expect(isToolEnabled(prefs, 'delete_task')).toBe(false)
    expect(isToolEnabled(prefs, 'create_task')).toBe(true)
  })

  it('lets a per-tool override win over the domain default (on within off domain)', () => {
    const prefs: ToolPrefs = { disabledDomains: ['web'], toolOverrides: { web_fetch: true } }
    expect(isToolEnabled(prefs, 'web_fetch')).toBe(true)
  })

  it('treats unknown (un-classified) tools as always enabled', () => {
    const prefs: ToolPrefs = { disabledDomains: ['web'], toolOverrides: {} }
    expect(isToolEnabled(prefs, 'plugin_hello_world__greet')).toBe(true)
  })

  it('lets an override=false disable an unclassified (plugin) tool', () => {
    const prefs: ToolPrefs = { disabledDomains: [], toolOverrides: { plugin_hello_world__greet: false } }
    expect(isToolEnabled(prefs, 'plugin_hello_world__greet')).toBe(false)
  })
})

describe('partitionToolNames', () => {
  it('splits candidate names into enabled and disabled sets', () => {
    const prefs: ToolPrefs = { disabledDomains: [], toolOverrides: { delete_task: false } }
    const { enabled, disabled } = partitionToolNames(prefs, ['create_task', 'delete_task', 'web_fetch'])
    expect([...enabled].sort()).toEqual(['create_task', 'web_fetch'])
    expect([...disabled]).toEqual(['delete_task'])
  })
})

describe('getDomainStatus', () => {
  it('reports on when nothing in the domain is disabled', () => {
    expect(getDomainStatus(empty, 'task', ['create_task', 'delete_task'])).toBe('on')
  })

  it('reports off when the whole domain is disabled and no overrides re-enable', () => {
    const prefs: ToolPrefs = { disabledDomains: ['task'], toolOverrides: {} }
    expect(getDomainStatus(prefs, 'task', ['create_task', 'delete_task'])).toBe('off')
  })

  it('reports partial when some tools in the domain differ from the rest', () => {
    const prefs: ToolPrefs = { disabledDomains: [], toolOverrides: { delete_task: false } }
    expect(getDomainStatus(prefs, 'task', ['create_task', 'delete_task'])).toBe('partial')
  })

  it('uses the domain flag (ignoring overrides) when domainToolNames is empty', () => {
    const prefs: ToolPrefs = { disabledDomains: ['web'], toolOverrides: { web_fetch: true } }
    expect(getDomainStatus(prefs, 'web', [])).toBe('off')
  })
})

describe('toggleDomain', () => {
  it('flips an on domain to off and prunes redundant overrides', () => {
    const prefs: ToolPrefs = { disabledDomains: [], toolOverrides: { delete_task: false } }
    const next = toggleDomain(prefs, 'task', ['create_task', 'delete_task'])
    expect(next.disabledDomains).toContain('task')
    // delete_task override (false) now equals the domain default (off) -> pruned
    expect(next.toolOverrides['delete_task']).toBeUndefined()
  })

  it('flips an off domain back to on', () => {
    const prefs: ToolPrefs = { disabledDomains: ['task'], toolOverrides: {} }
    const next = toggleDomain(prefs, 'task', ['create_task'])
    expect(next.disabledDomains).not.toContain('task')
  })
})

describe('toggleTool', () => {
  it('disables a single tool inside an on domain via an override', () => {
    const next = toggleTool(empty, 'delete_task', ['create_task', 'delete_task'])
    expect(next.toolOverrides['delete_task']).toBe(false)
  })

  it('prunes the override when it returns to matching the domain default', () => {
    const prefs: ToolPrefs = { disabledDomains: [], toolOverrides: { delete_task: false } }
    const next = toggleTool(prefs, 'delete_task', ['create_task', 'delete_task'])
    expect(next.toolOverrides['delete_task']).toBeUndefined()
  })

  it('removes the force-on override when toggling a tool inside a disabled domain', () => {
    const prefs: ToolPrefs = { disabledDomains: ['web'], toolOverrides: { web_fetch: true } }
    const next = toggleTool(prefs, 'web_fetch', [])
    expect(next.toolOverrides['web_fetch']).toBeUndefined()
    expect(next.disabledDomains).toContain('web')
  })
})

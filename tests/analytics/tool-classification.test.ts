// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { classifyAnalyticsTool } from '../../src/analytics/tool-classification.js'

describe('classifyAnalyticsTool', () => {
  test('a core builtin resolves to its raw slug with metadata classification', () => {
    expect(classifyAnalyticsTool('create_task')).toEqual({
      toolSlug: 'create_task',
      toolOrigin: 'core',
      toolDomain: 'task',
      risk: 'write',
    })
  })

  test('open-world risk maps the hyphenated registry value to the fact enum', () => {
    expect(classifyAnalyticsTool('web_fetch')).toEqual({
      toolSlug: 'web_fetch',
      toolOrigin: 'core',
      toolDomain: 'web',
      risk: 'open_world',
    })
  })

  test('task-adjacent registry domains collapse into the bounded task domain', () => {
    expect(classifyAnalyticsTool('create_project').toolDomain).toBe('task')
    expect(classifyAnalyticsTool('add_comment').toolDomain).toBe('task')
    expect(classifyAnalyticsTool('log_work').toolDomain).toBe('task')
  })

  test('memo and schedule domains map from their registry domains', () => {
    expect(classifyAnalyticsTool('save_memo').toolDomain).toBe('memo')
    expect(classifyAnalyticsTool('remember_memory').toolDomain).toBe('memo')
    expect(classifyAnalyticsTool('create_recurring_task').toolDomain).toBe('schedule')
    expect(classifyAnalyticsTool('create_deferred_prompt').toolDomain).toBe('schedule')
  })

  test('identity domains cover identity and collaboration registry entries', () => {
    expect(classifyAnalyticsTool('set_my_identity').toolDomain).toBe('identity')
    expect(classifyAnalyticsTool('find_user').toolDomain).toBe('identity')
  })

  test('meta tools classify as core meta reads', () => {
    for (const name of ['search_tools', 'load_tool', 'expand_result']) {
      expect(classifyAnalyticsTool(name)).toEqual({
        toolSlug: name,
        toolOrigin: 'core',
        toolDomain: 'meta',
        risk: 'read',
      })
    }
  })

  test('a bundled first-party plugin tool keeps its namespaced slug', () => {
    expect(classifyAnalyticsTool('plugin_acp__start_session')).toEqual({
      toolSlug: 'plugin_acp__start_session',
      toolOrigin: 'first_party_plugin',
      toolDomain: 'coding',
      risk: 'open_world',
    })
    expect(classifyAnalyticsTool('plugin_synthetic_web_search__search').toolOrigin).toBe('first_party_plugin')
    expect(classifyAnalyticsTool('plugin_synthetic_web_search__search').toolDomain).toBe('other')
  })

  test('a user MCP tool collapses to external_other with user_mcp origin', () => {
    expect(classifyAnalyticsTool('mcp_github__create_issue')).toEqual({
      toolSlug: 'external_other',
      toolOrigin: 'user_mcp',
      toolDomain: 'other',
      risk: 'open_world',
    })
  })

  test('an unknown plugin or bare tool collapses to external_other', () => {
    expect(classifyAnalyticsTool('plugin_unknown__do_thing')).toEqual({
      toolSlug: 'external_other',
      toolOrigin: 'external_plugin',
      toolDomain: 'other',
      risk: 'open_world',
    })
    expect(classifyAnalyticsTool('totally_unknown')).toEqual({
      toolSlug: 'external_other',
      toolOrigin: 'external_plugin',
      toolDomain: 'other',
      risk: 'open_world',
    })
  })
})

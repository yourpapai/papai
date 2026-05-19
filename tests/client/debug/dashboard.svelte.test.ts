// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { LOG_CAP, dashboard as state } from '../../../client/debug/dashboard.svelte.js'

describe('dashboard.svelte', () => {
  test('exposes LOG_CAP constant', () => {
    expect(LOG_CAP).toBe(65535)
  })

  test('initial state has expected shape', () => {
    expect(state.connected).toBe(false)
    expect(state.sessions).toBeInstanceOf(Map)
    expect(state.wizards).toBeInstanceOf(Map)
    expect(state.identityMappings).toBeInstanceOf(Map)
    expect(state.activeConfigEditors).toBeInstanceOf(Set)
    expect(state.logScopes).toBeInstanceOf(Set)
    expect(state.logs).toEqual([])
    expect(state.llmTraces).toEqual([])
    expect(state.turns).toEqual([])
    expect(state.notifications).toEqual([])
    expect(state.toolFailures).toEqual([])
    expect(state.recurringTasks).toEqual([])
    expect(state.deferredPrompts).toEqual([])
    expect(state.memos).toEqual([])
    expect(state.authorizedGroups).toEqual([])
    expect(state.activeContext).toBe('all')
    expect(state.activeLogFilter).toEqual({})
    expect(state.stats.totalMessages).toBe(0)
    expect(state.stats.totalLlmCalls).toBe(0)
    expect(state.stats.totalToolCalls).toBe(0)
  })

  test('state mutations are observable on the same reference', () => {
    state.connected = true
    expect(state.connected).toBe(true)
    state.connected = false
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { dashboard as state } from '../../../client/debug/debug.svelte.js'

describe('debug.svelte', () => {
  test('initial state has expected shape', () => {
    expect(state.connected).toBe(false)
    expect(state.sessions).toBeInstanceOf(Map)
    expect(state.wizards).toBeInstanceOf(Map)
    expect(state.activeConfigEditors).toBeInstanceOf(Set)
    expect(state.logScopes).toBeInstanceOf(Set)
    expect(state.logs).toEqual([])
    expect(state.llmTraces).toEqual([])
    expect(state.turns).toEqual([])
    expect(state.notifications).toEqual([])
    expect(state.toolFailures).toEqual([])
    expect(state.scopeFilter).toBe('all')
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

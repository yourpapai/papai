// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createToolGateRegistry, toolGateRegistry } from '../../src/ports/tool-gate.js'

describe('ToolGateRegistry', () => {
  test('defaults to non-operator gate for unknown tools', () => {
    const reg = createToolGateRegistry()
    expect(reg.getGate('plugin_x__y')).toBe('default')
    expect(reg.isOperatorGated('plugin_x__y')).toBe(false)
  })

  test('records and reports an operator gate', () => {
    const reg = createToolGateRegistry()
    reg.setGate('plugin_acp__start_session', 'operator')
    expect(reg.getGate('plugin_acp__start_session')).toBe('operator')
    expect(reg.isOperatorGated('plugin_acp__start_session')).toBe(true)
  })

  test('exposes a shared singleton', () => {
    expect(typeof toolGateRegistry.isOperatorGated).toBe('function')
  })
})

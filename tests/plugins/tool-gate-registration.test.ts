// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { PluginTool } from '../../src/plugins/runtime-types.js'
import { registerToolGates } from '../../src/plugins/tool-gate-registration.js'
import { createToolGateRegistry } from '../../src/ports/tool-gate.js'

const tool = (name: string, gate?: 'operator'): PluginTool => ({
  name,
  description: name,
  ...(gate === undefined ? {} : { gate }),
  execute: (): Promise<null> => Promise.resolve(null),
})

describe('registerToolGates', () => {
  test('records operator gates under the namespaced tool name', () => {
    const reg = createToolGateRegistry()
    registerToolGates('acp', [tool('start_session', 'operator'), tool('list_agents')], reg)
    expect(reg.isOperatorGated('plugin_acp__start_session')).toBe(true)
    expect(reg.isOperatorGated('plugin_acp__list_agents')).toBe(false)
  })

  test('sanitizes dashes in the plugin id', () => {
    const reg = createToolGateRegistry()
    registerToolGates('task-provider-kaneo', [tool('do_thing', 'operator')], reg)
    expect(reg.isOperatorGated('plugin_task_provider_kaneo__do_thing')).toBe(true)
  })
})

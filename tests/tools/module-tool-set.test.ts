// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { moduleEligibilityRegistry } from '../../src/ports/module-eligibility.js'
import { moduleToolRegistry, type ModuleTool, type ModuleToolRuntimeContext } from '../../src/ports/module-tools.js'
import { toolGateRegistry } from '../../src/ports/tool-gate.js'
import { buildModuleToolSet, namespacedModuleToolName } from '../../src/tools/module-tool-set.js'
import { getToolExecutor } from '../utils/test-helpers.js'

const ctx: ModuleToolRuntimeContext = { storageContextId: 'ctx-1', chatUserId: 'u-1' }

const echoTool = (name: string, gate?: 'operator'): ModuleTool => ({
  name,
  description: name,
  inputSchema: z.object({}),
  ...(gate === undefined ? {} : { gate }),
  execute: (_input, runtimeContext): Promise<ModuleToolRuntimeContext> => Promise.resolve(runtimeContext),
})

afterEach(() => {
  moduleToolRegistry.clear()
  moduleEligibilityRegistry.clear()
})

describe('buildModuleToolSet', () => {
  test('namespaces module tools as module_<id>__<tool>', () => {
    expect(namespacedModuleToolName('task-provider-kaneo', 'do_thing')).toBe('module_task_provider_kaneo__do_thing')
  })

  test('assembles registered module tools into a ToolSet under the namespaced name', () => {
    moduleToolRegistry.register('coding', [echoTool('start_session')])
    const out = buildModuleToolSet(new Set<string>(), ctx)
    expect('module_coding__start_session' in out).toBe(true)
  })

  test('passes the runtime context to the tool execute', async () => {
    moduleToolRegistry.register('coding', [echoTool('start_session')])
    const out = buildModuleToolSet(new Set<string>(), ctx)
    const execute = getToolExecutor(out['module_coding__start_session'])
    const result = await execute({}, { toolCallId: 't1', messages: [] })
    expect(result).toEqual(ctx)
  })

  test('records an operator gate in the ToolGatePort', () => {
    moduleToolRegistry.register('coding', [echoTool('start_session', 'operator'), echoTool('list_sessions')])
    buildModuleToolSet(new Set<string>(), ctx)
    expect(toolGateRegistry.isOperatorGated('module_coding__start_session')).toBe(true)
    expect(toolGateRegistry.isOperatorGated('module_coding__list_sessions')).toBe(false)
  })

  test('skips a tool whose namespaced name collides with an existing tool', () => {
    moduleToolRegistry.register('coding', [echoTool('start_session')])
    const out = buildModuleToolSet(new Set<string>(['module_coding__start_session']), ctx)
    expect('module_coding__start_session' in out).toBe(false)
  })

  test('omits tools whose module is ineligible for the context', () => {
    moduleToolRegistry.register('coding', [echoTool('start_session')])
    moduleEligibilityRegistry.register('coding', (storageContextId) => storageContextId === 'ctx-ok')
    expect(
      'module_coding__start_session' in
        buildModuleToolSet(new Set<string>(), { storageContextId: 'ctx-no', chatUserId: 'u' }),
    ).toBe(false)
    expect(
      'module_coding__start_session' in
        buildModuleToolSet(new Set<string>(), { storageContextId: 'ctx-ok', chatUserId: 'u' }),
    ).toBe(true)
  })
})

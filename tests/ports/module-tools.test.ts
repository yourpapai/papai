// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { createModuleToolRegistry, moduleToolRegistry, type ModuleTool } from '../../src/ports/module-tools.js'

const fakeTool = (name: string): ModuleTool => ({
  name,
  description: name,
  inputSchema: z.object({}),
  execute: (): Promise<null> => Promise.resolve(null),
})

describe('ModuleToolRegistry', () => {
  test('registers and lists tools tagged with their module id', () => {
    const reg = createModuleToolRegistry()
    reg.register('coding', [fakeTool('start_session'), fakeTool('list_sessions')])
    expect(reg.list().map((e) => `${e.moduleId}:${e.tool.name}`)).toEqual([
      'coding:start_session',
      'coding:list_sessions',
    ])
  })

  test('clear empties the registry', () => {
    const reg = createModuleToolRegistry()
    reg.register('m', [fakeTool('t')])
    reg.clear()
    expect(reg.list()).toEqual([])
  })

  test('exposes a shared singleton', () => {
    expect(typeof moduleToolRegistry.list).toBe('function')
  })
})

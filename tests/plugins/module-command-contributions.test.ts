// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { namespacedModuleCommandName, registerModuleCommands } from '../../src/plugins/module-command-contributions.js'
import { moduleCommandRegistry } from '../../src/ports/module-contributions.js'
import {
  createAuth,
  createDmMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
} from '../utils/test-helpers.js'

afterEach(() => {
  moduleCommandRegistry.clear()
})

describe('registerModuleCommands', () => {
  test('namespaces commands as module_<id>_<command>', () => {
    expect(namespacedModuleCommandName('task-provider-kaneo', 'sync')).toBe('module_task_provider_kaneo_sync')
  })

  test('registers each module command under its namespaced name and invokes execute', async () => {
    let called = false
    moduleCommandRegistry.register('coding', [
      {
        name: 'acp',
        description: 'acp',
        execute: (): Promise<void> => {
          called = true
          return Promise.resolve()
        },
      },
    ])
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()

    registerModuleCommands(provider)
    const handler = commandHandlers.get('module_coding_acp')
    expect(handler).toBeDefined()
    const { reply } = createMockReply()
    await handler!(createDmMessage('user-1'), reply, createAuth('user-1'))

    expect(called).toBe(true)
  })
})

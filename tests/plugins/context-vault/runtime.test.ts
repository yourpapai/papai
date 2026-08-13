// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { registerContextVault } from '../../../plugins/context-vault/runtime.js'
import type { PluginContext, PluginRegistration } from '../../../src/plugins/context.js'
import type { PluginTool } from '../../../src/plugins/types.js'

describe('context-vault runtime registration', () => {
  test('registerContextVault registers both vault tools with capability ids', () => {
    const tools = new Map<string, PluginTool>()
    const registration: PluginRegistration = {
      registerTool: (tool: PluginTool) => {
        tools.set(tool.name, tool)
      },
      registerPromptFragment: () => {},
      registerCommand: () => {},
      registerScheduledJob: () => {},
      registerAttachmentTransformer: () => {},
      registerTaskProviderType: () => {},
    }
    const ctx: PluginContext = {
      pluginId: 'context-vault',
      contextId: '__system__',
      permissions: new Set(['contextVault.read']),
      kv: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      registration,
      adminConfig: { get: () => undefined },
    }

    registerContextVault(ctx)

    expect([...tools.keys()].toSorted()).toEqual(['get_agent_spec', 'list_agent_specs'])
    expect(tools.get('list_agent_specs')?.capabilityId).toBe('context-vault.specs.list')
    expect(tools.get('get_agent_spec')?.capabilityId).toBe('context-vault.specs.get')
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import factory from '../../../plugins/context-vault/index.js'
import type { PluginContext, PluginRegistration } from '../../../src/plugins/context.js'
import type { PluginTool } from '../../../src/plugins/types.js'

describe('context-vault plugin module', () => {
  test('activates and registers list_agent_specs and get_agent_spec', () => {
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

    void factory().activate(ctx)

    expect([...tools.keys()].toSorted()).toEqual(['get_agent_spec', 'list_agent_specs'])
    expect(tools.get('list_agent_specs')?.capabilityId).toBe('context-vault.specs.list')
    expect(tools.get('get_agent_spec')?.capabilityId).toBe('context-vault.specs.get')
  })
})

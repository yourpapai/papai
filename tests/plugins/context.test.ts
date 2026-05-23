// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildPluginContext } from '../../src/plugins/context.js'
import type { PluginManifest } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: ['allowed_tool'],
      promptFragments: ['allowed_fragment'],
      commands: ['allowed_command'],
      jobs: ['allowed_job'],
      configKeys: [],
    },
    permissions: ['storage'],
    defaultEnabled: false,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    ...overrides,
  }
}

describe('buildPluginContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('accepts declared tool and prompt fragment registrations', () => {
    const { ctx, collected } = buildPluginContext(makeManifest(), 'ctx-1')

    ctx.registration.registerTool({
      name: 'allowed_tool',
      description: 'Allowed tool',
      execute: () => Promise.resolve<unknown>('ok'),
    })
    ctx.registration.registerPromptFragment({
      name: 'allowed_fragment',
      content: 'Allowed fragment',
    })

    expect(collected.tools).toHaveLength(1)
    expect(collected.promptFragments).toHaveLength(1)
  })

  test('accepts declared command and scheduled job registrations', () => {
    const { ctx, collected } = buildPluginContext(makeManifest(), 'ctx-1')

    ctx.registration.registerCommand({
      name: 'allowed_command',
      description: 'Allowed command',
      execute: () => Promise.resolve(),
    })
    ctx.registration.registerScheduledJob({
      name: 'allowed_job',
      intervalMs: 60_000,
      execute: () => Promise.resolve(),
    })

    expect(collected.commands).toHaveLength(1)
    expect(collected.jobs).toHaveLength(1)
  })

  test('throws on undeclared tool registration', () => {
    const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')

    expect(() =>
      ctx.registration.registerTool({
        name: 'not_declared',
        description: 'Rejected tool',
        execute: () => Promise.resolve<unknown>('x'),
      }),
    ).toThrow("Tool 'not_declared' is not declared in plugin manifest contributes.tools")
  })

  test('throws on undeclared prompt fragment registration', () => {
    const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')

    expect(() =>
      ctx.registration.registerPromptFragment({
        name: 'not_declared',
        content: 'Rejected fragment',
      }),
    ).toThrow("Prompt fragment 'not_declared' is not declared in plugin manifest contributes.promptFragments")
  })

  test('throws on undeclared command registration', () => {
    const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')

    expect(() =>
      ctx.registration.registerCommand({
        name: 'not_declared',
        description: 'Rejected command',
        execute: () => Promise.resolve(),
      }),
    ).toThrow("Command 'not_declared' is not declared in plugin manifest contributes.commands")
  })

  test('throws on undeclared scheduled job registration', () => {
    const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')

    expect(() =>
      ctx.registration.registerScheduledJob({
        name: 'not_declared',
        intervalMs: 60_000,
        execute: () => Promise.resolve(),
      }),
    ).toThrow("Scheduled job 'not_declared' is not declared in plugin manifest contributes.jobs")
  })

  test('freezes context and nested service surfaces', () => {
    const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')

    expect(Object.isFrozen(ctx)).toBe(true)
    expect(Object.isFrozen(ctx.registration)).toBe(true)
    expect(Object.isFrozen(ctx.kv)).toBe(true)
    expect(Object.isFrozen(ctx.log)).toBe(true)
  })

  test('denies kv operations when storage permission is missing', () => {
    const { ctx } = buildPluginContext(makeManifest({ permissions: [] }), 'ctx-1')

    expect(() => ctx.kv.get('k')).toThrow("Plugin test-plugin does not have 'storage' permission")
    expect(() => ctx.kv.set('k', 'v')).toThrow("Plugin test-plugin does not have 'storage' permission")
    expect(() => ctx.kv.delete('k')).toThrow("Plugin test-plugin does not have 'storage' permission")
    expect(() => ctx.kv.list()).toThrow("Plugin test-plugin does not have 'storage' permission")
  })
})

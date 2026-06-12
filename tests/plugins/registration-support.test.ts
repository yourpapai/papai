// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildActivationGuard, buildNamedRegistrationHandlers } from '../../src/plugins/registration-support.js'
import type { PluginAttachmentTransformer } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import type { PluginManifest } from '../../src/plugins/types.js'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  const base: PluginManifest = {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
      attachmentTransformers: ['my-transformer'],
    },
    permissions: ['attachments.read'],
    defaultEnabled: false,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerTraits: [],
    providerConfigSchema: [],
    providerContextConfigSchema: [],
    providerAllowedHosts: [],
  }
  return {
    ...base,
    ...overrides,
    contributes: overrides.contributes ?? base.contributes,
  }
}

function makeNoop(): PluginAttachmentTransformer {
  return {
    name: 'my-transformer',
    mimePrefixes: ['audio/'],
    transform: () => Promise.resolve({ ok: true, text: 'hi' }),
  }
}

describe('buildNamedRegistrationHandlers — attachment transformer', () => {
  test('registerAttachmentTransformer accepts a declared transformer', () => {
    const guard = buildActivationGuard()
    const collected: PluginAttachmentTransformer[] = []
    const handlers = buildNamedRegistrationHandlers(makeManifest(), {
      activationGuard: guard,
      registerTool: () => {},
      registerPromptFragment: () => {},
      registerCommand: () => {},
      registerScheduledJob: () => {},
      registerAttachmentTransformer: (t) => {
        collected.push(t)
      },
    })

    handlers.registerAttachmentTransformer(makeNoop())

    expect(collected).toHaveLength(1)
  })

  test('registerAttachmentTransformer rejects an undeclared name', () => {
    const guard = buildActivationGuard()
    const handlers = buildNamedRegistrationHandlers(
      makeManifest({ contributes: { ...makeManifest().contributes, attachmentTransformers: [] } }),
      {
        activationGuard: guard,
        registerTool: () => {},
        registerPromptFragment: () => {},
        registerCommand: () => {},
        registerScheduledJob: () => {},
        registerAttachmentTransformer: () => {},
      },
    )

    expect(() => handlers.registerAttachmentTransformer(makeNoop())).toThrow(/not declared/u)
  })

  test('registerAttachmentTransformer rejects duplicate registration', () => {
    const guard = buildActivationGuard()
    const handlers = buildNamedRegistrationHandlers(makeManifest(), {
      activationGuard: guard,
      registerTool: () => {},
      registerPromptFragment: () => {},
      registerCommand: () => {},
      registerScheduledJob: () => {},
      registerAttachmentTransformer: () => {},
    })

    handlers.registerAttachmentTransformer(makeNoop())

    expect(() => handlers.registerAttachmentTransformer(makeNoop())).toThrow(/registered more than once/u)
  })
})

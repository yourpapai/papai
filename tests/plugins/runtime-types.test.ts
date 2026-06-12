// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { PluginContributions } from '../../src/plugins/runtime-types.js'
import type { TaskProviderProvision } from '../../src/providers/registry.js'
import type {
  TaskProviderAutoProvision,
  TaskProviderConfigValidator,
  TaskProviderFactory,
} from '../../src/providers/registry.js'
import type { ProviderConfigField, TaskCapability, TaskProviderTrait } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'

const stubFactory: TaskProviderFactory = () => createMockProvider()
const stubProvision: TaskProviderProvision = () => Promise.resolve({ status: 'failed', error: 'test' })
const stubCapabilities: ReadonlySet<TaskCapability> = new Set<TaskCapability>()
const stubTraits: ReadonlySet<TaskProviderTrait> = new Set<TaskProviderTrait>()
const stubInstanceSchema: readonly ProviderConfigField[] = []
const stubContextSchema: readonly ProviderConfigField[] = []

describe('PluginContributions.taskProviderRegistration', () => {
  test('accepts an optional provision field', () => {
    const contributions: PluginContributions = {
      tools: [],
      promptFragments: [],
      taskProviderRegistration: {
        type: 'test-type',
        factory: stubFactory,
        provision: stubProvision,
        capabilities: stubCapabilities,
        displayName: 'Test',
        instanceConfigSchema: stubInstanceSchema,
        contextConfigSchema: stubContextSchema,
        traits: stubTraits,
      },
    }
    expect(contributions.taskProviderRegistration?.provision).toBe(stubProvision)
  })

  test('treats provision as optional (additive field)', () => {
    const contributions: PluginContributions = {
      tools: [],
      promptFragments: [],
      taskProviderRegistration: {
        type: 'test-type',
        factory: stubFactory,
        capabilities: stubCapabilities,
        displayName: 'Test',
        instanceConfigSchema: stubInstanceSchema,
        contextConfigSchema: stubContextSchema,
        traits: stubTraits,
      },
    }
    expect(contributions.taskProviderRegistration?.provision).toBeUndefined()
  })

  test('accepts autoProvision and validateConfig alongside provision', () => {
    const autoProvision: TaskProviderAutoProvision = () => true
    const validateConfig: TaskProviderConfigValidator = () => Promise.resolve({ ok: true })
    const contributions: PluginContributions = {
      tools: [],
      promptFragments: [],
      taskProviderRegistration: {
        type: 'test-type',
        factory: stubFactory,
        autoProvision,
        provision: stubProvision,
        validateConfig,
        capabilities: stubCapabilities,
        displayName: 'Test',
        instanceConfigSchema: stubInstanceSchema,
        contextConfigSchema: stubContextSchema,
        traits: stubTraits,
      },
    }
    const reg = contributions.taskProviderRegistration
    expect(reg?.autoProvision).toBe(autoProvision)
    expect(reg?.provision).toBe(stubProvision)
    expect(reg?.validateConfig).toBe(validateConfig)
  })
})

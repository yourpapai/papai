// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import type { TaskInstance } from '../../src/instances/types.js'
import {
  createProvider,
  getCapabilitiesForTaskInstance,
  getTaskProviderDescriptor,
  getTaskProviderConfigValidator,
  listTaskProviderTypes,
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import type { ContributedTaskProviderEntry } from '../../src/providers/registry.js'
import type { TaskCapability } from '../../src/providers/task-capability.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger } from '../utils/test-helpers.js'

const taskInstance = (type: TaskInstance['type']): TaskInstance => ({
  id: `${type}-default`,
  type,
  config: { url: `https://${type}.invalid` },
  status: 'active',
  createdAt: 'now',
})

const fakeProvider: TaskProvider = createMockProvider()
const entry = {
  pluginId: 'task-provider-kaneo',
  factory: (): TaskProvider => fakeProvider,
  capabilities: new Set<TaskCapability>(),
  displayName: 'Kaneo (Plugin)',
  instanceConfigSchema: [] as const,
  contextConfigSchema: [] as const,
}

describe('provider registry capability lookup', () => {
  test('throws for unknown provider type (youtrack is no longer a built-in)', () => {
    expect(() => getCapabilitiesForTaskInstance(taskInstance('youtrack'))).toThrow(/Unknown provider/u)
  })
})

describe('contributed task provider registry', () => {
  afterEach(() => {
    unregisterContributedTaskProviderType('task-provider-kaneo')
    unregisterContributedTaskProviderType('other-plugin')
    unregisterContributedTaskProviderType('task-provider-demo')
  })

  test('registers and resolves a contributed type', () => {
    mockLogger()
    registerContributedTaskProviderType('custom-tracker', entry)

    const descriptor = getTaskProviderDescriptor('custom-tracker')
    const provider = createProvider('custom-tracker', {})

    expect(descriptor).toBeDefined()
    expect(descriptor?.source).toEqual({ plugin: 'task-provider-kaneo' })
    expect(provider).toBe(fakeProvider)
  })

  test('first-wins: duplicate type from another plugin is skipped', () => {
    mockLogger()
    const otherProvider = createMockProvider({ name: 'other-plugin-provider' })
    registerContributedTaskProviderType('custom-tracker', entry)
    expect(() =>
      registerContributedTaskProviderType('custom-tracker', {
        pluginId: 'other-plugin',
        factory: (): TaskProvider => otherProvider,
        capabilities: new Set<TaskCapability>(),
        displayName: 'Other',
        instanceConfigSchema: [] as const,
        contextConfigSchema: [] as const,
      }),
    ).not.toThrow()

    const descriptor = getTaskProviderDescriptor('custom-tracker')
    const provider = createProvider('custom-tracker', {})

    expect(descriptor?.source).toEqual({ plugin: 'task-provider-kaneo' })
    expect(provider).toBe(fakeProvider)
  })

  test('unregister by pluginId removes its types', () => {
    mockLogger()
    registerContributedTaskProviderType('custom-tracker', entry)
    unregisterContributedTaskProviderType('task-provider-kaneo')

    expect(getTaskProviderDescriptor('custom-tracker')).toBeUndefined()
    expect(() => createProvider('custom-tracker', {})).toThrow('Unknown provider: custom-tracker')
  })

  test('youtrack is no longer a built-in; registering it as contributed does not throw', () => {
    mockLogger()
    expect(() => registerContributedTaskProviderType('youtrack', entry)).not.toThrow()
  })

  test('kaneo is no longer a built-in; it must be plugin-contributed', () => {
    expect(() => createProvider('kaneo', { baseUrl: 'x' })).toThrow(/Unknown provider/u)
  })

  test('listTaskProviderTypes does not include kaneo when no plugin is registered', () => {
    const types = listTaskProviderTypes().map((descriptor) => descriptor.type)
    expect(types).not.toContain('kaneo')
  })

  test('listTaskProviderTypes includes contributed descriptors with displayName and instanceConfigSchema', () => {
    mockLogger()
    registerContributedTaskProviderType('demo-tracker', {
      pluginId: 'task-provider-demo',
      factory: () => createMockProvider(),
      capabilities: new Set<TaskCapability>(['comments.read']),
      displayName: 'Demo Tracker',
      instanceConfigSchema: [
        { key: 'baseUrl', label: 'Demo URL', required: true, sensitive: false, scope: 'instance' },
      ],
      contextConfigSchema: [],
    })

    const descriptor = listTaskProviderTypes().find((d) => d.type === 'demo-tracker')
    expect(descriptor).toBeDefined()
    expect(descriptor?.displayName).toBe('Demo Tracker')
    expect(descriptor?.source).toEqual({ plugin: 'task-provider-demo' })
    expect(descriptor?.instanceConfigSchema).toEqual([
      { key: 'baseUrl', label: 'Demo URL', required: true, sensitive: false, scope: 'instance' },
    ])
    expect(descriptor?.capabilities.has('comments.read')).toBe(true)
  })

  test('createProvider normalizes contributed runtime traits from descriptor traits', () => {
    mockLogger()
    const traits = new Set(['command-language:youtrack'] as const)
    registerContributedTaskProviderType('traited-tracker', {
      pluginId: 'task-provider-demo',
      factory: () => createMockProvider({ name: 'traited-tracker', traits: new Set() }),
      capabilities: new Set<TaskCapability>(['tasks.commands']),
      displayName: 'Traited Tracker',
      traits,
      instanceConfigSchema: [] as const,
      contextConfigSchema: [] as const,
    })

    const descriptor = getTaskProviderDescriptor('traited-tracker')
    const provider = createProvider('traited-tracker', {})

    expect(descriptor).toBeDefined()
    expect(provider.traits).toEqual(descriptor!.traits)
    expect(provider.traits).toEqual(traits)
  })
})

describe('listTaskProviderTypes (built-in catalog)', () => {
  test('built-in catalog is empty (both kaneo and youtrack are plugin-contributed)', () => {
    const types = listTaskProviderTypes()
    expect(types).toHaveLength(0)
    expect(types.map((d) => d.type)).not.toContain('youtrack')
    expect(types.map((d) => d.type)).not.toContain('kaneo')
  })

  test('youtrack is no longer in the built-in catalog', () => {
    expect(getTaskProviderDescriptor('youtrack')).toBeUndefined()
  })

  test('createProvider throws for youtrack when no plugin has registered it', () => {
    expect(() => createProvider('youtrack', { baseUrl: 'https://youtrack.invalid', token: 'perm-token' })).toThrow(
      /Unknown provider/u,
    )
  })
})

describe('listTaskProviderTypes built-in scopes', () => {
  test('no built-in scopes exist; youtrack is no longer a built-in', () => {
    const yt = listTaskProviderTypes().find((d) => d.type === 'youtrack')
    expect(yt).toBeUndefined()
  })
})

describe('getCapabilitiesForTaskInstance without credentials', () => {
  test('throws for youtrack when no plugin has registered it (not a builtin)', () => {
    expect(() =>
      getCapabilitiesForTaskInstance({
        id: 'yt',
        type: 'youtrack',
        config: { baseUrl: 'https://yt.invalid' },
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/Unknown provider/u)
  })
})

describe('registerContributedTaskProviderType duplicates', () => {
  test('first registration wins; the second is skipped without throwing', () => {
    mockLogger()
    const makeEntry = (pluginId: string): ContributedTaskProviderEntry => ({
      pluginId,
      factory: (): TaskProvider => createMockProvider({ name: 'dup' }),
      capabilities: new Set<never>(),
      displayName: pluginId,
      instanceConfigSchema: [],
      contextConfigSchema: [],
    })
    try {
      registerContributedTaskProviderType('dup', makeEntry('plugin-a'))
      expect(() => registerContributedTaskProviderType('dup', makeEntry('plugin-b'))).not.toThrow()
      expect(getTaskProviderDescriptor('dup')?.source).toEqual({ plugin: 'plugin-a' })
    } finally {
      unregisterContributedTaskProviderType('plugin-a')
      unregisterContributedTaskProviderType('plugin-b')
    }
  })

  test('youtrack can be registered as contributed now that it is not a built-in', () => {
    mockLogger()
    expect(() =>
      registerContributedTaskProviderType('youtrack', {
        pluginId: 'task-provider-youtrack',
        factory: () => createMockProvider({ name: 'youtrack' }),
        capabilities: new Set<never>(),
        displayName: 'YouTrack',
        instanceConfigSchema: [] as const,
        contextConfigSchema: [] as const,
      }),
    ).not.toThrow()
    unregisterContributedTaskProviderType('task-provider-youtrack')
  })
})

describe('getTaskProviderConfigValidator', () => {
  test('returns the validator function for a contributed type that declares one', async () => {
    mockLogger()
    const validator = (): Promise<{ ok: true }> => Promise.resolve({ ok: true })
    registerContributedTaskProviderType('validated-reg', {
      pluginId: 'validator-plugin',
      factory: () => createMockProvider({ name: 'validated-reg' }),
      validateConfig: validator,
      capabilities: new Set<never>(),
      displayName: 'Validated Reg',
      instanceConfigSchema: [],
      contextConfigSchema: [],
    })
    try {
      const resolved = getTaskProviderConfigValidator('validated-reg')
      expect(resolved).toBe(validator)
      const result = await resolved!({ baseUrl: 'https://ok.invalid' })
      expect(result).toEqual({ ok: true })
    } finally {
      unregisterContributedTaskProviderType('validator-plugin')
    }
  })

  test('returns undefined for an unregistered type', () => {
    const resolved = getTaskProviderConfigValidator('not-registered-anywhere')
    expect(resolved).toBeUndefined()
  })

  test('returns undefined for a contributed type with no validator', () => {
    mockLogger()
    registerContributedTaskProviderType('no-validator', {
      pluginId: 'no-validator-plugin',
      factory: () => createMockProvider({ name: 'no-validator' }),
      capabilities: new Set<never>(),
      displayName: 'No Validator',
      instanceConfigSchema: [],
      contextConfigSchema: [],
    })
    try {
      const resolved = getTaskProviderConfigValidator('no-validator')
      expect(resolved).toBeUndefined()
    } finally {
      unregisterContributedTaskProviderType('no-validator-plugin')
    }
  })
})

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
  configSchema: [] as const,
}

describe('provider registry capability lookup', () => {
  test('returns Kaneo task capabilities without requiring context credentials', () => {
    const capabilities = getCapabilitiesForTaskInstance(taskInstance('kaneo'))

    expect(capabilities.has('comments.read')).toBe(true)
    expect(capabilities.has('workItems.list')).toBe(false)
  })

  test('returns YouTrack task capabilities without requiring context credentials', () => {
    const capabilities = getCapabilitiesForTaskInstance(taskInstance('youtrack'))

    expect(capabilities.has('comments.read')).toBe(true)
    expect(capabilities.has('workItems.list')).toBe(true)
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
        configSchema: [] as const,
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

  test('rejects registering a type that shadows a built-in', () => {
    mockLogger()
    expect(() => registerContributedTaskProviderType('kaneo', entry)).toThrow()
    expect(() => registerContributedTaskProviderType('youtrack', entry)).toThrow()
  })

  test('listTaskProviderTypes includes contributed descriptors with displayName and configSchema', () => {
    mockLogger()
    registerContributedTaskProviderType('demo-tracker', {
      pluginId: 'task-provider-demo',
      factory: () => createMockProvider(),
      capabilities: new Set<TaskCapability>(['comments.read']),
      displayName: 'Demo Tracker',
      configSchema: [{ key: 'baseUrl', label: 'Demo URL', required: true, sensitive: false }],
    })

    const descriptor = listTaskProviderTypes().find((d) => d.type === 'demo-tracker')
    expect(descriptor).toBeDefined()
    expect(descriptor?.displayName).toBe('Demo Tracker')
    expect(descriptor?.source).toEqual({ plugin: 'task-provider-demo' })
    expect(descriptor?.configSchema).toEqual([
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
      configSchema: [] as const,
    })

    const descriptor = getTaskProviderDescriptor('traited-tracker')
    const provider = createProvider('traited-tracker', {})

    expect(descriptor).toBeDefined()
    expect(provider.traits).toEqual(descriptor!.traits)
    expect(provider.traits).toEqual(traits)
  })
})

describe('listTaskProviderTypes (built-in catalog)', () => {
  test('built-in descriptors expose split instance and context schemas plus traits', () => {
    const kaneo = listTaskProviderTypes().find((d) => d.type === 'kaneo')
    const youtrack = listTaskProviderTypes().find((d) => d.type === 'youtrack')

    expect(kaneo?.instanceConfigSchema.map((f) => f.key)).toEqual(['baseUrl', 'internalUrl'])
    expect(kaneo?.contextConfigSchema.find((f) => f.key === 'credential')?.storageKey).toBe('kaneo_apikey')
    expect(kaneo?.contextConfigSchema.find((f) => f.key === 'workspaceId')?.storageKey).toBe('kaneo_workspace_id')
    expect(kaneo?.traits.has('workspace-scoped')).toBe(true)

    expect(youtrack?.instanceConfigSchema.map((f) => f.key)).toEqual(['baseUrl'])
    expect(youtrack?.contextConfigSchema.find((f) => f.key === 'token')?.storageKey).toBe('youtrack_token')
    expect(youtrack?.traits.has('command-language:youtrack')).toBe(true)
  })

  test('includes kaneo and youtrack as built-in descriptors', () => {
    const types = listTaskProviderTypes()

    expect(types).toHaveLength(2)

    const kaneo = types.find((descriptor) => descriptor.type === 'kaneo')
    const youtrack = types.find((descriptor) => descriptor.type === 'youtrack')

    expect(kaneo).toBeDefined()
    expect(kaneo?.source).toBe('builtin')
    expect(kaneo?.displayName).toBe('Kaneo')
    expect(kaneo?.configSchema.find((f) => f.key === 'baseUrl')).toBeDefined()
    expect(kaneo?.capabilities.size).toBeGreaterThan(0)

    expect(youtrack).toBeDefined()
    expect(youtrack?.source).toBe('builtin')
    expect(youtrack?.displayName).toBe('YouTrack')
    expect(youtrack?.configSchema.find((f) => f.key === 'baseUrl')).toBeDefined()
  })

  test('built-in provider runtime traits equal descriptor traits', () => {
    const kaneoDescriptor = getTaskProviderDescriptor('kaneo')
    const youtrackDescriptor = getTaskProviderDescriptor('youtrack')

    const kaneoProvider = createProvider('kaneo', {
      baseUrl: 'https://kaneo.invalid',
      credential: 'kaneo-token',
      workspaceId: 'workspace-1',
    })
    const youtrackProvider = createProvider('youtrack', {
      baseUrl: 'https://youtrack.invalid',
      token: 'perm-token',
    })

    expect(kaneoDescriptor).toBeDefined()
    expect(youtrackDescriptor).toBeDefined()
    expect(kaneoProvider.traits).toEqual(kaneoDescriptor!.traits)
    expect(youtrackProvider.traits).toEqual(youtrackDescriptor!.traits)
  })
})

describe('listTaskProviderTypes built-in scopes', () => {
  test('kaneo declares instance baseUrl and context credential + workspaceId', () => {
    const kaneo = listTaskProviderTypes().find((d) => d.type === 'kaneo')
    expect(kaneo?.configSchema.find((f) => f.key === 'baseUrl')?.scope).toBe('instance')
    expect(kaneo?.contextConfigSchema.find((f) => f.key === 'credential')?.scope).toBe('context')
    expect(kaneo?.contextConfigSchema.find((f) => f.key === 'credential')?.sensitive).toBe(true)
    expect(kaneo?.contextConfigSchema.find((f) => f.key === 'workspaceId')?.scope).toBe('context')
  })

  test('youtrack declares instance baseUrl and context token', () => {
    const yt = listTaskProviderTypes().find((d) => d.type === 'youtrack')
    expect(yt?.configSchema.find((f) => f.key === 'baseUrl')?.scope).toBe('instance')
    expect(yt?.contextConfigSchema.find((f) => f.key === 'token')?.scope).toBe('context')
    expect(yt?.contextConfigSchema.find((f) => f.key === 'token')?.sensitive).toBe(true)
  })
})

describe('getCapabilitiesForTaskInstance without credentials', () => {
  test('returns kaneo capabilities for an instance with no credentials in config', () => {
    const caps = getCapabilitiesForTaskInstance({
      id: 'k',
      type: 'kaneo',
      config: { baseUrl: 'https://k.invalid' },
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(caps.has('comments.create')).toBe(true)
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
      configSchema: [],
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

  test('a contributed type that shadows a built-in still throws', () => {
    mockLogger()
    expect(() =>
      registerContributedTaskProviderType('kaneo', {
        pluginId: 'evil',
        factory: () => createMockProvider({ name: 'kaneo' }),
        capabilities: new Set<never>(),
        displayName: 'evil',
        configSchema: [] as const,
      }),
    ).toThrow()
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
      configSchema: [],
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

  test('returns undefined for a built-in type (kaneo)', () => {
    const resolved = getTaskProviderConfigValidator('kaneo')
    expect(resolved).toBeUndefined()
  })

  test('returns undefined for a contributed type with no validator', () => {
    mockLogger()
    registerContributedTaskProviderType('no-validator', {
      pluginId: 'no-validator-plugin',
      factory: () => createMockProvider({ name: 'no-validator' }),
      capabilities: new Set<never>(),
      displayName: 'No Validator',
      configSchema: [],
    })
    try {
      const resolved = getTaskProviderConfigValidator('no-validator')
      expect(resolved).toBeUndefined()
    } finally {
      unregisterContributedTaskProviderType('no-validator-plugin')
    }
  })
})

describe('createProvider kaneo credential branching', () => {
  test('treats a non-cookie credential as an API key', () => {
    const provider = createProvider('kaneo', { baseUrl: 'https://k.invalid', credential: 'kn-key', workspaceId: 'w' })
    expect(provider.name).toBe('kaneo')
  })

  test('treats a session-cookie credential as a cookie', () => {
    const provider = createProvider('kaneo', {
      baseUrl: 'https://k.invalid',
      credential: 'better-auth.session_token=abc',
      workspaceId: 'w',
    })
    expect(provider.name).toBe('kaneo')
  })
})

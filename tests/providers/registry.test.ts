// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import type { TaskInstance } from '../../src/instances/types.js'
import {
  createProvider,
  getCapabilitiesForTaskInstance,
  getContributedTaskProviderType,
  listTaskProviderTypes,
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
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
    const found = getContributedTaskProviderType('custom-tracker')
    expect(found).toBeDefined()
    expect(found!.pluginId).toBe('task-provider-kaneo')
  })

  test('first-wins: duplicate type from another plugin throws', () => {
    mockLogger()
    registerContributedTaskProviderType('custom-tracker', entry)
    expect(() =>
      registerContributedTaskProviderType('custom-tracker', {
        pluginId: 'other-plugin',
        factory: (): TaskProvider => fakeProvider,
        capabilities: new Set<TaskCapability>(),
        displayName: 'Other',
        configSchema: [] as const,
      }),
    ).toThrow()
  })

  test('unregister by pluginId removes its types', () => {
    mockLogger()
    registerContributedTaskProviderType('custom-tracker', entry)
    unregisterContributedTaskProviderType('task-provider-kaneo')
    expect(getContributedTaskProviderType('custom-tracker')).toBeUndefined()
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
    expect(descriptor?.configSchema).toEqual([{ key: 'baseUrl', label: 'Demo URL', required: true, sensitive: false }])
    expect(descriptor?.capabilities.has('comments.read')).toBe(true)
  })
})

describe('listTaskProviderTypes (built-in catalog)', () => {
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
})

describe('listTaskProviderTypes built-in scopes', () => {
  test('kaneo declares instance baseUrl and user credential + workspaceId', () => {
    const kaneo = listTaskProviderTypes().find((d) => d.type === 'kaneo')
    expect(kaneo?.configSchema.find((f) => f.key === 'baseUrl')?.scope).toBe('instance')
    expect(kaneo?.configSchema.find((f) => f.key === 'credential')?.scope).toBe('user')
    expect(kaneo?.configSchema.find((f) => f.key === 'credential')?.sensitive).toBe(true)
    expect(kaneo?.configSchema.find((f) => f.key === 'workspaceId')?.scope).toBe('user')
  })

  test('youtrack declares instance baseUrl and user token', () => {
    const yt = listTaskProviderTypes().find((d) => d.type === 'youtrack')
    expect(yt?.configSchema.find((f) => f.key === 'baseUrl')?.scope).toBe('instance')
    expect(yt?.configSchema.find((f) => f.key === 'token')?.scope).toBe('user')
    expect(yt?.configSchema.find((f) => f.key === 'token')?.sensitive).toBe(true)
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

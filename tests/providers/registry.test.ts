// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import type { TaskInstance } from '../../src/instances/types.js'
import {
  getCapabilitiesForTaskInstance,
  getContributedTaskProviderType,
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
  })

  test('registers and resolves a contributed type', () => {
    mockLogger()
    registerContributedTaskProviderType('kaneo', entry)
    const found = getContributedTaskProviderType('kaneo')
    expect(found).toBeDefined()
    expect(found!.pluginId).toBe('task-provider-kaneo')
  })

  test('first-wins: duplicate type from another plugin throws', () => {
    mockLogger()
    registerContributedTaskProviderType('kaneo', entry)
    expect(() =>
      registerContributedTaskProviderType('kaneo', {
        pluginId: 'other-plugin',
        factory: (): TaskProvider => fakeProvider,
        capabilities: new Set<TaskCapability>(),
      }),
    ).toThrow()
  })

  test('unregister by pluginId removes its types', () => {
    mockLogger()
    registerContributedTaskProviderType('kaneo', entry)
    unregisterContributedTaskProviderType('task-provider-kaneo')
    expect(getContributedTaskProviderType('kaneo')).toBeUndefined()
  })
})

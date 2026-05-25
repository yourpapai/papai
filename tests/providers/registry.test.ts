// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
  getContributedTaskProviderType,
} from '../../src/providers/registry.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger } from '../utils/test-helpers.js'

const fakeProvider: TaskProvider = createMockProvider()
const entry = {
  pluginId: 'task-provider-kaneo',
  factory: (): TaskProvider => fakeProvider,
  capabilities: new Set<never>(),
}

describe('contributed task provider registry', () => {
  afterEach(() => {
    unregisterContributedTaskProviderType('task-provider-kaneo')
    unregisterContributedTaskProviderType('other-plugin')
  })

  test('registers and resolves a contributed type', () => {
    mockLogger()
    registerContributedTaskProviderType('kaneo', entry)
    const found = getContributedTaskProviderType('kaneo')
    expect(found?.pluginId).toBe('task-provider-kaneo')
  })

  test('first-wins: duplicate type from another plugin throws', () => {
    mockLogger()
    registerContributedTaskProviderType('kaneo', entry)
    expect(() =>
      registerContributedTaskProviderType('kaneo', {
        pluginId: 'other-plugin',
        factory: (): TaskProvider => fakeProvider,
        capabilities: new Set<never>(),
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

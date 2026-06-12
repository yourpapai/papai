// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  getTaskProviderProvision,
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
  type TaskProviderProvision,
} from '../../src/providers/registry.js'
import { createMockProvider } from '../tools/mock-provider.js'

// `unregisterContributedTaskProviderType` removes all types owned by a given
// `pluginId` (despite the function name), so we use unique plugin IDs to
// keep these fixtures scoped to this suite and avoid cross-test pollution.
const KANEO_PLUGIN_ID = 'test-kaneo-plugin'
const YOUTRACK_PLUGIN_ID = 'test-youtrack-plugin'

const PROVISION: TaskProviderProvision = () => Promise.resolve({ status: 'failed', error: 'test' })

afterEach(() => {
  unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
  unregisterContributedTaskProviderType(YOUTRACK_PLUGIN_ID)
})

describe('getTaskProviderProvision', () => {
  test('returns the registered provision hook for a known type', () => {
    registerContributedTaskProviderType('test-kaneo', {
      pluginId: KANEO_PLUGIN_ID,
      factory: () => createMockProvider({ name: 'test-kaneo' }),
      provision: PROVISION,
      capabilities: new Set(),
      displayName: 'Test Kaneo',
    })

    const hook = getTaskProviderProvision('test-kaneo')
    expect(hook).toBe(PROVISION)
  })

  test('returns undefined for an unknown type', () => {
    expect(getTaskProviderProvision('does-not-exist')).toBeUndefined()
  })

  test('returns undefined when the descriptor has no provision hook', () => {
    registerContributedTaskProviderType('test-youtrack', {
      pluginId: YOUTRACK_PLUGIN_ID,
      factory: () => createMockProvider({ name: 'test-youtrack' }),
      capabilities: new Set(),
      displayName: 'Test YouTrack',
    })

    expect(getTaskProviderProvision('test-youtrack')).toBeUndefined()
  })
})

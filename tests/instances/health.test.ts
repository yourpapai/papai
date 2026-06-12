// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { warnUnresolvedTaskInstances } from '../../src/instances/health.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { createTrackedLoggerMock, setupTestDb } from '../utils/test-helpers.js'

describe('warnUnresolvedTaskInstances', () => {
  test('logs a WARN pointing at the settings web UI for unregistered types', async () => {
    await setupTestDb()
    insertTaskInstance({ id: 'k-1', type: 'kaneo', config: { baseUrl: 'x' }, status: 'active' })
    const tracked = createTrackedLoggerMock()
    void mock.module('../../src/logger.js', () => ({
      getLogLevel: tracked.getLogLevel,
      logger: tracked.logger,
    }))
    warnUnresolvedTaskInstances()
    const warns = tracked.getCallsByLevel('warn')
    const message = warns.map((entry) => String(entry.args[1])).join('\n')
    expect(message).toContain('task-provider-kaneo')
    expect(message).toContain('settings web UI')
  })

  test('emits nothing when every type has an active provider', async () => {
    await setupTestDb()
    insertTaskInstance({ id: 'k-1', type: 'kaneo', config: { baseUrl: 'x' }, status: 'active' })
    registerContributedTaskProviderType('kaneo', {
      pluginId: 'task-provider-kaneo',
      factory: () => createMockProvider(),
      capabilities: new Set(),
      displayName: 'Kaneo',
      instanceConfigSchema: [],
      contextConfigSchema: [],
      traits: new Set(),
    })
    const tracked = createTrackedLoggerMock()
    void mock.module('../../src/logger.js', () => ({
      getLogLevel: tracked.getLogLevel,
      logger: tracked.logger,
    }))
    try {
      warnUnresolvedTaskInstances()
      expect(tracked.getCallsByLevel('warn')).toHaveLength(0)
    } finally {
      unregisterContributedTaskProviderType('task-provider-kaneo')
    }
  })

  afterEach(() => {
    unregisterContributedTaskProviderType('task-provider-kaneo')
  })
})

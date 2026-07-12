// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { configureCodingSessionCapability } from '../../src/coding-sessions/configure.js'
import { deactivateAllPlugins } from '../../src/plugins/loader.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import { getPluginAdminConfig, isPluginEnabledForContext } from '../../src/plugins/store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('configureCodingSessionCapability', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    await deactivateAllPlugins()
    pluginRegistry.clearForTesting()
  })

  afterEach(async () => {
    await deactivateAllPlugins()
    pluginRegistry.clearForTesting()
  })

  test('configures the available coding-session implementation without exposing plugin details', () => {
    const result = configureCodingSessionCapability({
      pluginDirectory: 'plugins',
      contextId: 'platform:user',
      magiBaseUrl: 'https://magi.invalid',
      magiToken: 'secret-token',
      updatedBy: 'admin-user',
    })

    expect(result).toEqual({ capabilityId: 'coding-session.start' })
    expect(pluginRegistry.getEntry('acp')?.state).toBe('approved')
    expect(getPluginAdminConfig('acp', 'magi_base_url')).toBe('https://magi.invalid')
    expect(getPluginAdminConfig('acp', 'magi_token')).toBe('secret-token')
    expect(isPluginEnabledForContext('acp', 'platform:user')).toBe(true)
  })

  test('fails actionably when the current implementation is unavailable', () => {
    expect(() =>
      configureCodingSessionCapability({
        pluginDirectory: '/missing/coding-session-implementations',
        contextId: 'platform:user',
        magiBaseUrl: 'https://magi.invalid',
        magiToken: 'secret-token',
        updatedBy: 'admin-user',
      }),
    ).toThrow('Coding-session capability implementation is unavailable')
  })
})

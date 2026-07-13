// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { configureCodingSessionCapability } from '../../src/coding-sessions/configure.js'
import { activatePlugins, deactivateAllPlugins } from '../../src/plugins/loader.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import { getPluginAdminConfig, getPluginAdminState, isPluginEnabledForContext } from '../../src/plugins/store.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const configure = (updatedBy: string, magiBaseUrl = 'https://magi.invalid'): void => {
  configureCodingSessionCapability({
    pluginDirectory: 'plugins',
    contextId: 'platform:user',
    magiBaseUrl,
    magiToken: 'secret-token',
    updatedBy,
  })
}

const requireConfiguredImplementation = (): DiscoveredPlugin => {
  const implementation = pluginRegistry.getEntry('acp')?.discoveredPlugin
  if (implementation === undefined) throw new Error('Expected configured coding-session implementation')
  return implementation
}

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

  test('updates configuration for an approved implementation without rewriting approval identity', () => {
    configure('approving-admin')

    configure('configuration-editor', 'https://updated-magi.invalid')

    expect(pluginRegistry.getEntry('acp')?.state).toBe('approved')
    expect(getPluginAdminState('acp')?.approvedBy).toBe('approving-admin')
    expect(getPluginAdminConfig('acp', 'magi_base_url')).toBe('https://updated-magi.invalid')
  })

  test('preserves explicit rejection instead of silently reapproving the implementation', () => {
    configure('approving-admin')
    pluginRegistry.reject('acp')

    expect(() => configure('configuration-editor', 'https://updated-magi.invalid')).toThrow(
      'Coding-session capability implementation is unavailable: explicitly rejected',
    )

    expect(pluginRegistry.getEntry('acp')?.state).toBe('rejected')
    expect(getPluginAdminState('acp')?.state).toBe('rejected')
    expect(getPluginAdminConfig('acp', 'magi_base_url')).toBe('https://magi.invalid')
  })

  test('reconfigures a deactivated implementation without replacing its original approver', async () => {
    configure('approving-admin')
    await activatePlugins([requireConfiguredImplementation()])
    await deactivateAllPlugins()

    configure('configuration-editor', 'https://restarted-magi.invalid')

    expect(pluginRegistry.getEntry('acp')?.state).toBe('approved')
    expect(getPluginAdminState('acp')?.approvedBy).toBe('approving-admin')
    expect(getPluginAdminConfig('acp', 'magi_base_url')).toBe('https://restarted-magi.invalid')
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { configureCodingSessionCapability } from '../../src/coding-sessions/configure.js'
import { getPluginAdminConfig } from '../../src/plugins/store.js'
import { setupTestDb } from '../utils/test-helpers.js'

const configure = (
  magiBaseUrl = 'https://magi.invalid',
  magiToken = 'secret-token',
): ReturnType<typeof configureCodingSessionCapability> =>
  configureCodingSessionCapability({
    pluginDirectory: '/a/retired/plugin/directory',
    contextId: 'platform:user',
    magiBaseUrl,
    magiToken,
    updatedBy: 'admin-user',
  })

describe('configureCodingSessionCapability', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('configures the ACP module namespace without discovering a retired plugin', () => {
    expect(configure()).toEqual({ capabilityId: 'coding-session.start' })
    expect(getPluginAdminConfig('acp', 'magi_base_url')).toBe('https://magi.invalid')
    expect(getPluginAdminConfig('acp', 'magi_token')).toBe('secret-token')
  })

  test('updates ACP module configuration on later calls', () => {
    configure()

    configure('https://updated-magi.invalid', 'updated-token')

    expect(getPluginAdminConfig('acp', 'magi_base_url')).toBe('https://updated-magi.invalid')
    expect(getPluginAdminConfig('acp', 'magi_token')).toBe('updated-token')
  })
})

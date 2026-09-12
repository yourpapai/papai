// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getConfigFieldsForContext } from '../src/config-keys.js'
import { getConfigValue, setConfigValue, unsetConfigValue } from '../src/config.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { isConfigKey } from '../src/types/config.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from './utils/test-helpers.js'

describe('internal config keys', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
  })

  describe('language_prompted', () => {
    test('is guarded by isConfigKey', () => {
      expect(isConfigKey('language_prompted')).toBe(true)
    })

    test('is storable and unsettable via the config store', () => {
      setConfigValue('ctx-lang-prompted', 'language_prompted', '1')
      expect(getConfigValue('ctx-lang-prompted', 'language_prompted')).toBe('1')

      unsetConfigValue('ctx-lang-prompted', 'language_prompted')
      expect(getConfigValue('ctx-lang-prompted', 'language_prompted')).toBeNull()
    })

    test('is never exposed as a ConfigField, in any context shape', () => {
      setContextSettings({
        contextId: 'ctx-lang-prompted-null-task',
        taskInstanceId: null,
        platformInstanceId: 'telegram-default',
      })
      for (const contextId of ['ctx-empty', 'ctx-lang-prompted-null-task']) {
        const storageKeys = getConfigFieldsForContext(contextId).map((field) => field.storageKey)
        expect(storageKeys).not.toContain('language_prompted')
      }
    })
  })
})

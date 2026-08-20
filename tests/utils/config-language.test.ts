// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setConfigValue } from '../../src/config.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { getContextLanguage } from '../../src/utils/config-language.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

describe('getContextLanguage', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
  })

  test('returns the stored language for the config context', () => {
    setConfigValue('ctx-lang-stored', 'language', 'ru')
    expect(getContextLanguage('ctx-lang-stored')).toBe('ru')
  })

  test('returns en when no language is stored (empty context)', () => {
    expect(getContextLanguage('ctx-lang-unset')).toBe('en')
  })

  test('returns en when unset for a context whose task instance is null', () => {
    setContextSettings({
      contextId: 'ctx-lang-null-task',
      taskInstanceId: null,
      platformInstanceId: 'telegram-default',
    })
    expect(getContextLanguage('ctx-lang-null-task')).toBe('en')
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { validateConfigField } from '../../src/config-editor/validation.js'
import { getConfigFieldsForContext } from '../../src/config-keys.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import type { ConfigField } from '../../src/types/config.js'
import { isConfigKey } from '../../src/types/config.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

/** The language field as declared for a context; throws when it is missing. */
function languageFieldFor(contextId: string): ConfigField {
  const field = getConfigFieldsForContext(contextId).find((candidate) => candidate.storageKey === 'language')
  if (field === undefined) throw new Error(`language field missing for context ${contextId}`)
  return field
}

describe('language preference', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
  })

  test("isConfigKey('language') is true", () => {
    expect(isConfigKey('language')).toBe(true)
  })

  test('declares a language select field with the supported locales in any context', () => {
    const emptyContextField = languageFieldFor('ctx-lang-empty')
    expect(emptyContextField.kind).toBe('preference')
    expect(emptyContextField.required).toBe(false)
    expect(emptyContextField.control).toBe('select')
    expect(emptyContextField.options).toEqual([
      { value: 'en', label: 'English' },
      { value: 'ru', label: 'Русский' },
    ])
  })

  test('declares the language field for a context whose task instance is null', () => {
    setContextSettings({
      contextId: 'ctx-lang-null-task',
      taskInstanceId: null,
      platformInstanceId: 'telegram-default',
    })
    expect(languageFieldFor('ctx-lang-null-task').kind).toBe('preference')
  })

  test('config-editor validation accepts en and ru and rejects other values', () => {
    expect(validateConfigField(languageFieldFor('ctx-lang-validate'), 'en').valid).toBe(true)
    expect(validateConfigField(languageFieldFor('ctx-lang-validate'), 'ru').valid).toBe(true)

    const rejected = validateConfigField(languageFieldFor('ctx-lang-validate'), 'de')
    expect(rejected.valid).toBe(false)
    expect(rejected.error).toContain('must be one of')
    expect(rejected.error).toContain('en, ru')
  })
})

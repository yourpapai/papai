// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getConfigValue, setConfigValue } from '../../src/config.js'
import { isStructuredPromptSurfaceEnabled, STRUCTURED_PROMPT_SURFACE_KEY } from '../../src/prompt-surface/config.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('isStructuredPromptSurfaceEnabled', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('defaults to disabled when unset', () => {
    expect(isStructuredPromptSurfaceEnabled('ctx-structured-unset')).toBe(false)
  })

  test('is enabled only for the on value', () => {
    setConfigValue('ctx-structured-on', STRUCTURED_PROMPT_SURFACE_KEY, 'on')

    expect(isStructuredPromptSurfaceEnabled('ctx-structured-on')).toBe(true)
  })

  test('treats off and malformed values as disabled', () => {
    setConfigValue('ctx-structured-off', STRUCTURED_PROMPT_SURFACE_KEY, 'off')
    setConfigValue('ctx-structured-malformed', STRUCTURED_PROMPT_SURFACE_KEY, 'true')

    expect(isStructuredPromptSurfaceEnabled('ctx-structured-off')).toBe(false)
    expect(isStructuredPromptSurfaceEnabled('ctx-structured-malformed')).toBe(false)
  })

  test('uses the same storage key as dynamic config', () => {
    setConfigValue('ctx-structured-storage', STRUCTURED_PROMPT_SURFACE_KEY, 'on')

    expect(getConfigValue('ctx-structured-storage', STRUCTURED_PROMPT_SURFACE_KEY)).toBe('on')
  })
})

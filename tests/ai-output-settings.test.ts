// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  AI_LIVE_STATUS_KEY,
  AI_OUTPUT_DETAIL_LEVEL_KEY,
  AI_REASONING_VISIBILITY_KEY,
  AI_TOOL_VISIBILITY_KEY,
  getAiOutputSettings,
} from '../src/ai-output-settings.js'
import { setCachedConfig } from '../src/cache.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('ai-output-settings', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('uses safe defaults when no settings exist (live status defaults on)', () => {
    expect(getAiOutputSettings('ctx-default')).toEqual({
      toolVisibility: 'off',
      reasoningVisibility: 'off',
      detailLevel: 'sanitized',
      liveStatus: 'on',
    })
  })

  test('reads valid settings from context config', () => {
    setCachedConfig('ctx-valid', AI_TOOL_VISIBILITY_KEY, 'on')
    setCachedConfig('ctx-valid', AI_REASONING_VISIBILITY_KEY, 'on')
    setCachedConfig('ctx-valid', AI_OUTPUT_DETAIL_LEVEL_KEY, 'raw')
    setCachedConfig('ctx-valid', AI_LIVE_STATUS_KEY, 'on')

    expect(getAiOutputSettings('ctx-valid')).toEqual({
      toolVisibility: 'on',
      reasoningVisibility: 'on',
      detailLevel: 'raw',
      liveStatus: 'on',
    })
  })

  test('live status reads off when explicitly disabled', () => {
    setCachedConfig('ctx-off', AI_LIVE_STATUS_KEY, 'off')

    expect(getAiOutputSettings('ctx-off').liveStatus).toBe('off')
  })

  test('falls back safely for invalid stored values (live status stays on)', () => {
    setCachedConfig('ctx-invalid', AI_TOOL_VISIBILITY_KEY, 'yes')
    setCachedConfig('ctx-invalid', AI_REASONING_VISIBILITY_KEY, 'visible')
    setCachedConfig('ctx-invalid', AI_OUTPUT_DETAIL_LEVEL_KEY, 'full')
    setCachedConfig('ctx-invalid', AI_LIVE_STATUS_KEY, 'maybe')

    expect(getAiOutputSettings('ctx-invalid')).toEqual({
      toolVisibility: 'off',
      reasoningVisibility: 'off',
      detailLevel: 'sanitized',
      liveStatus: 'on',
    })
  })
})

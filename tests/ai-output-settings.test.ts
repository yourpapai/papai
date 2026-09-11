// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  AI_LIVE_STATUS_KEY,
  AI_OUTPUT_DETAIL_LEVEL_KEY,
  AI_REASONING_EFFORT_KEY,
  AI_REASONING_VISIBILITY_KEY,
  AI_TOOL_VISIBILITY_KEY,
  getAiOutputSettings,
  resolveEffectiveReasoningEffort,
} from '../src/ai-output-settings.js'
import { setCachedConfig } from '../src/cache.js'
import type { ModelMetadata } from '../src/models-dev/resolve.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

const metadataWith = (overrides: Partial<ModelMetadata>): ModelMetadata => ({
  providerId: null,
  modelId: null,
  contextWindow: null,
  maxOutputTokens: null,
  source: 'none',
  via: null,
  ...overrides,
})

const unionModel = metadataWith({})
const catalogueModel = metadataWith({
  providerId: 'openai',
  modelId: 'gpt-5',
  source: 'models-dev',
  via: 'inferred',
  effortLevels: ['low', 'high'],
})
const nonReasoningModel = metadataWith({
  providerId: 'openai',
  modelId: 'gpt-4o',
  source: 'models-dev',
  via: 'inferred',
  reasoning: false,
})

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

  test('unset, empty, and default stored values resolve to no reasoning effort', () => {
    expect(resolveEffectiveReasoningEffort('ctx-effort-unset', unionModel)).toBeNull()
    setCachedConfig('ctx-effort-empty', AI_REASONING_EFFORT_KEY, '')
    expect(resolveEffectiveReasoningEffort('ctx-effort-empty', unionModel)).toBeNull()
    setCachedConfig('ctx-effort-default', AI_REASONING_EFFORT_KEY, 'default')
    expect(resolveEffectiveReasoningEffort('ctx-effort-default', unionModel)).toBeNull()
  })

  test('a stored level within the derived set of the active model is sent', () => {
    setCachedConfig('ctx-effort-union', AI_REASONING_EFFORT_KEY, 'xhigh')
    expect(resolveEffectiveReasoningEffort('ctx-effort-union', unionModel)).toBe('xhigh')
    setCachedConfig('ctx-effort-catalogue', AI_REASONING_EFFORT_KEY, 'high')
    expect(resolveEffectiveReasoningEffort('ctx-effort-catalogue', catalogueModel)).toBe('high')
  })

  test('a stored level outside the derived set resolves to no level after a model switch', () => {
    setCachedConfig('ctx-effort-switched', AI_REASONING_EFFORT_KEY, 'medium')
    expect(resolveEffectiveReasoningEffort('ctx-effort-switched', catalogueModel)).toBeNull()
    setCachedConfig('ctx-effort-non-reasoning', AI_REASONING_EFFORT_KEY, 'high')
    expect(resolveEffectiveReasoningEffort('ctx-effort-non-reasoning', nonReasoningModel)).toBeNull()
  })

  test('an unrecognized stored value is never coerced to a level', () => {
    setCachedConfig('ctx-effort-bogus', AI_REASONING_EFFORT_KEY, 'bogus')
    expect(resolveEffectiveReasoningEffort('ctx-effort-bogus', unionModel)).toBeNull()
  })

  test('each config context resolves its own stored level', () => {
    setCachedConfig('ctx-effort-a', AI_REASONING_EFFORT_KEY, 'high')
    setCachedConfig('ctx-effort-b', AI_REASONING_EFFORT_KEY, 'low')
    expect(resolveEffectiveReasoningEffort('ctx-effort-a', catalogueModel)).toBe('high')
    expect(resolveEffectiveReasoningEffort('ctx-effort-b', catalogueModel)).toBe('low')
  })
})

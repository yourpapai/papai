// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getConfigValue } from '../../../src/config.js'
import { STRUCTURED_PROMPT_SURFACE_KEY } from '../../../src/prompt-surface/config.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import { buildPromptRegressionContext } from './context-builders.js'
import type { PromptRegressionSetup } from './fixture-types.js'

describe('buildPromptRegressionContext', () => {
  const setup: PromptRegressionSetup = { contextType: 'dm', provider: 'kaneo' }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('uses fixture id for deterministic default context isolation', () => {
    const ctx = buildPromptRegressionContext(setup, 'assembly-ask-gated-tool-preference')

    expect(ctx.contextId).toBe('ctx-assembly-ask-gated-tool-preference')
  })

  test('preserves explicit setup context id', () => {
    const ctx = buildPromptRegressionContext({ ...setup, contextId: 'ctx-explicit' }, 'assembly-providerless-dm')

    expect(ctx.contextId).toBe('ctx-explicit')
  })

  test('preserves explicit chat user id', () => {
    const ctx = buildPromptRegressionContext({ ...setup, chatUserId: 'chat-user-explicit' }, 'assembly-user')

    expect(ctx.chatUserId).toBe('chat-user-explicit')
  })

  test('translates tool preferences into the exposed tool set', () => {
    const ctx = buildPromptRegressionContext(
      {
        ...setup,
        enabledTools: ['create_task', 'delete_task', 'ask_permission'],
        deniedTools: ['delete_task'],
        askTools: ['ask_permission'],
      },
      'assembly-tool-prefs',
    )

    expect([...ctx.enabledToolNames].toSorted()).toEqual(['ask_permission', 'create_task'])
  })

  test('translates structured prompt fixture flag into context config', () => {
    const ctx = buildPromptRegressionContext(
      {
        ...setup,
        flags: { structured_prompt_surface: true },
      },
      'assembly-structured-flag',
    )

    expect(getConfigValue(ctx.contextId, STRUCTURED_PROMPT_SURFACE_KEY)).toBe('on')
  })

  test('does not yet translate memory or flags into built context', () => {
    const plain = buildPromptRegressionContext(
      { ...setup, enabledTools: ['create_task', 'search_tasks'] },
      'assembly-plain',
    )
    const withPendingDimensions = buildPromptRegressionContext(
      {
        ...setup,
        enabledTools: ['create_task', 'search_tasks'],
        memory: 'compacted-and-long-term',
        flags: { progressive_disclosure: true, result_compaction: true },
      },
      'assembly-pending-dimensions',
    )

    expect([...withPendingDimensions.enabledToolNames].toSorted()).toEqual([...plain.enabledToolNames].toSorted())
  })
})

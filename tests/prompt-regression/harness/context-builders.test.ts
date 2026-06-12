// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildPromptRegressionContext } from './context-builders.js'
import type { PromptRegressionSetup } from './fixture-types.js'

describe('buildPromptRegressionContext', () => {
  const setup: PromptRegressionSetup = { contextType: 'dm', provider: 'kaneo' }

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

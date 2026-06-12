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
})

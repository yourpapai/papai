// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildProviderlessSystemPrompt } from '../src/system-prompt.js'

describe('WORKFLOW confirmation instruction', () => {
  test('step 4 tells the model to name what it did', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-1', new Set<string>(), { askPermissionAvailable: false })
    expect(prompt).toContain('names what you did')
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { PromptHandle } from '../../src/chat/prompt-handle.js'

describe('PromptHandle', () => {
  test('is satisfied by an object with redact and remove', () => {
    const handle: PromptHandle = {
      redact: (_text: string) => Promise.resolve(),
      remove: () => Promise.resolve(),
    }
    expect(typeof handle.redact).toBe('function')
    expect(typeof handle.remove).toBe('function')
  })
})

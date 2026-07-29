// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { peekEditPrompt, registerEditPrompt, resolveEditPrompt } from '../../src/message-edit/edit-prompt-store.js'
import { resetEditPromptStoreForTesting } from '../../src/message-edit/edit-prompt-store.testing.js'

describe('edit-prompt-store', () => {
  beforeEach(() => resetEditPromptStoreForTesting())

  test('register then peek returns the prompt', () => {
    registerEditPrompt('id1', {
      contextId: 'ctx',
      editedText: 'hi',
      onAdjust: () => Promise.resolve(),
      onNote: () => Promise.resolve(),
    })

    const peeked = peekEditPrompt('id1')

    expect(peeked?.contextId).toBe('ctx')
    expect(peeked?.editedText).toBe('hi')
  })

  test('peek returns undefined for an unknown id', () => {
    expect(peekEditPrompt('nope')).toBeUndefined()
  })

  test('resolve returns and deletes the entry so a second click is a no-op', () => {
    registerEditPrompt('id2', {
      contextId: 'ctx',
      editedText: 'x',
      onAdjust: () => Promise.resolve(),
      onNote: () => Promise.resolve(),
    })

    expect(resolveEditPrompt('id2')).toBeDefined()
    expect(resolveEditPrompt('id2')).toBeUndefined()
    expect(peekEditPrompt('id2')).toBeUndefined()
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildTelegramMentionPrefix } from '../../../src/chat/telegram/mention-prefix.js'
import type { DeferredDeliveryTarget } from '../../../src/chat/types.js'

const makeTarget = (overrides: Partial<DeferredDeliveryTarget> = {}): DeferredDeliveryTarget => ({
  contextId: '99',
  contextType: 'group',
  threadId: null,
  audience: 'personal',
  mentionUserIds: ['42'],
  createdByUserId: '42',
  createdByUsername: 'alice',
  ...overrides,
})

describe('buildTelegramMentionPrefix', () => {
  test('returns an empty prefix outside a personal group delivery', () => {
    expect(buildTelegramMentionPrefix(makeTarget({ contextType: 'dm' }))).toEqual({ text: '', entities: [] })
    expect(buildTelegramMentionPrefix(makeTarget({ audience: 'shared' }))).toEqual({ text: '', entities: [] })
  })

  test('builds a username-labelled text mention for the prompt owner', () => {
    expect(buildTelegramMentionPrefix(makeTarget())).toEqual({
      text: '@alice ',
      entities: [{ offset: 0, length: 6, type: 'text_mention', user: { id: 42, is_bot: false, first_name: 'alice' } }],
    })
  })

  test('falls back to the generic you label without a username', () => {
    const prefix = buildTelegramMentionPrefix(makeTarget({ createdByUsername: null }))
    expect(prefix.text).toBe('you ')
    expect(prefix.entities).toEqual([
      { offset: 0, length: 3, type: 'text_mention', user: { id: 42, is_bot: false, first_name: 'you' } },
    ])
  })

  test('labels other mentioned users generically', () => {
    const prefix = buildTelegramMentionPrefix(makeTarget({ mentionUserIds: ['42', '7'] }))
    expect(prefix.text).toBe('@alice user ')
    expect(prefix.entities).toEqual([
      { offset: 0, length: 6, type: 'text_mention', user: { id: 42, is_bot: false, first_name: 'alice' } },
      { offset: 7, length: 4, type: 'text_mention', user: { id: 7, is_bot: false, first_name: 'user' } },
    ])
  })

  test('yields an empty prefix when no mention id parses', () => {
    expect(buildTelegramMentionPrefix(makeTarget({ mentionUserIds: ['not-a-number'] }))).toEqual({
      text: '',
      entities: [],
    })
  })
})

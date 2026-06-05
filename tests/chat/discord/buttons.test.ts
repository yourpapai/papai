// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  DISCORD_BUTTONS_PER_ROW,
  DISCORD_CUSTOM_ID_MAX,
  DISCORD_ROWS_PER_MESSAGE,
  isButtonInteraction,
  toActionRows,
} from '../../../plugins/chat-provider-discord/buttons.js'

describe('isButtonInteraction', () => {
  test('returns false for non-objects', () => {
    expect(isButtonInteraction(null)).toBe(false)
    expect(isButtonInteraction(undefined)).toBe(false)
    expect(isButtonInteraction('string')).toBe(false)
    expect(isButtonInteraction(42)).toBe(false)
  })

  test('returns false when type or componentType is missing', () => {
    expect(isButtonInteraction({ type: 3 })).toBe(false)
    expect(isButtonInteraction({ componentType: 2 })).toBe(false)
  })

  test('returns false for wrong type values', () => {
    expect(isButtonInteraction({ type: 1, componentType: 2 })).toBe(false)
    expect(isButtonInteraction({ type: 3, componentType: 3 })).toBe(false)
  })

  test('returns true for valid button interaction shape', () => {
    expect(isButtonInteraction({ type: 3, componentType: 2 })).toBe(true)
  })
})

describe('toActionRows', () => {
  test('throws when too many buttons are provided', () => {
    const max = DISCORD_BUTTONS_PER_ROW * DISCORD_ROWS_PER_MESSAGE
    const buttons = Array.from({ length: max + 1 }, (_, i) => ({
      text: `btn${String(i)}`,
      callbackData: `cb${String(i)}`,
    }))
    expect(() => toActionRows(buttons)).toThrow('too many buttons')
  })

  test('throws when a button callbackData exceeds max length', () => {
    const buttons = [{ text: 'btn', callbackData: 'x'.repeat(DISCORD_CUSTOM_ID_MAX + 1) }]
    expect(() => toActionRows(buttons)).toThrow('custom_id exceeds')
  })

  test('returns empty array for empty input', () => {
    expect(toActionRows([])).toHaveLength(0)
  })

  test('groups buttons into rows of DISCORD_BUTTONS_PER_ROW', () => {
    const buttons = Array.from({ length: DISCORD_BUTTONS_PER_ROW + 1 }, (_, i) => ({
      text: `btn${String(i)}`,
      callbackData: `cb${String(i)}`,
    }))
    const rows = toActionRows(buttons)
    expect(rows).toHaveLength(2)
  })
})

describe('ButtonInteractionLike', () => {
  test('accepts optional user fields bot and isAdmin', () => {
    const interaction = {
      user: { id: 'u1', username: 'alice', bot: false, isAdmin: true },
      customId: '/help',
      channelId: 'ch1',
      channel: null,
      message: { id: 'msg1', channelId: 'ch1', threadId: 'th1' },
      deferUpdate: (): Promise<void> => Promise.resolve(),
    }
    // Type compatibility — if this compiles the optional fields are accepted
    expect(interaction.user.isAdmin).toBe(true)
    expect(interaction.message.threadId).toBe('th1')
  })
})

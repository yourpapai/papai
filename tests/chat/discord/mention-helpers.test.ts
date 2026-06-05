// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { isBotMentioned, stripBotMention } from '../../../plugins/chat-provider-discord/mention-helpers.js'

describe('stripBotMention', () => {
  const botId = '1234567890123456'

  test('strips leading <@botId> mention and trim', () => {
    expect(stripBotMention(`<@${botId}> hello world`, botId)).toBe('hello world')
  })

  test('strips leading nickname-style <@!botId> mention', () => {
    expect(stripBotMention(`<@!${botId}> /help`, botId)).toBe('/help')
  })

  test('leaves other user mentions intact', () => {
    expect(stripBotMention(`<@${botId}> hello <@999>`, botId)).toBe('hello <@999>')
  })

  test('does not strip mid-string bot mentions', () => {
    expect(stripBotMention(`thanks <@${botId}> for help`, botId)).toBe(`thanks <@${botId}> for help`)
  })

  test('returns text unchanged when no bot mention present', () => {
    expect(stripBotMention('plain text', botId)).toBe('plain text')
  })

  test('handles empty string', () => {
    expect(stripBotMention('', botId)).toBe('')
  })

  test('handles mention followed by multiple whitespace', () => {
    expect(stripBotMention(`<@${botId}>    \t  hello`, botId)).toBe('hello')
  })
})

describe('isBotMentioned', () => {
  const botId = '1234567890123456'

  function createMockMentions(hasResult: boolean): { has: (id: string) => boolean } {
    return {
      has: (id: string): boolean => id === botId && hasResult,
    }
  }

  test('returns true in DMs unconditionally', () => {
    expect(isBotMentioned(createMockMentions(false), botId, 'dm')).toBe(true)
    expect(isBotMentioned(createMockMentions(false), botId, 'dm')).toBe(true)
  })

  test('returns true when bot is mentioned in group channel', () => {
    expect(isBotMentioned(createMockMentions(true), botId, 'group')).toBe(true)
  })

  test('returns false when bot is not mentioned in group channel', () => {
    expect(isBotMentioned(createMockMentions(false), botId, 'group')).toBe(false)
  })

  test('returns false when different user is mentioned in group channel', () => {
    const differentUserMentions = { has: (id: string): boolean => id !== botId }
    expect(isBotMentioned(differentUserMentions, botId, 'group')).toBe(false)
  })
})

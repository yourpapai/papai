// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  telegramCapabilities,
  telegramConfigRequirements,
  telegramTraits,
} from '../../../plugins/chat-provider-telegram/metadata.js'

describe('telegram metadata', () => {
  test('capabilities include the core Telegram features', () => {
    expect(telegramCapabilities.has('messages.buttons')).toBe(true)
    expect(telegramCapabilities.has('interactions.callbacks')).toBe(true)
    expect(telegramCapabilities.has('commands.menu')).toBe(true)
    expect(telegramCapabilities.has('messages.files')).toBe(true)
    expect(telegramCapabilities.has('files.receive')).toBe(true)
  })

  test('traits use all observed group messages (Telegram sees all group messages)', () => {
    expect(telegramTraits.observedGroupMessages).toBe('all')
  })

  test('traits include Telegram-specific limits', () => {
    expect(telegramTraits.maxMessageLength).toBe(4096)
    expect(telegramTraits.callbackDataMaxLength).toBe(64)
  })

  test('config requirements include token', () => {
    const token = telegramConfigRequirements.find((r) => r.key === 'token')
    expect(token).toBeDefined()
    expect(token?.required).toBe(true)
  })
})

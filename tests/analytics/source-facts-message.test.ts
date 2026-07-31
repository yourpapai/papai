// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ChatMessageAcceptedFact } from '../../src/analytics/source-facts-message.js'

describe('source-facts-message', () => {
  test('variant type is importable and discriminates', () => {
    const fact: Pick<ChatMessageAcceptedFact, 'type'> = { type: 'chat_message_accepted' }
    expect(fact.type).toBe('chat_message_accepted')
  })
})

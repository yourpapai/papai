// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { hoistSystemMessages } from '../src/llm-message-utils.js'

describe('hoistSystemMessages', () => {
  test('returns messages unchanged (copied) when there are no system messages', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    const result = hoistSystemMessages('BASE', messages)
    expect(result.system).toBe('BASE')
    expect(result.messages).toEqual(messages)
    expect(result.messages).not.toBe(messages)
  })

  test('hoists system messages out of the array and appends them to the system string in order', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'MEMORY A' },
      { role: 'user', content: 'do a thing' },
      { role: 'system', content: 'MEMORY B' },
    ]
    const result = hoistSystemMessages('BASE', messages)
    expect(result.system).toBe('BASE\n\nMEMORY A\n\nMEMORY B')
    expect(result.messages).toEqual([{ role: 'user', content: 'do a thing' }])
  })

  test('drops an empty base system so no leading separator is produced', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'ONLY SYSTEM' },
      { role: 'user', content: 'q' },
    ]
    const result = hoistSystemMessages('', messages)
    expect(result.system).toBe('ONLY SYSTEM')
    expect(result.messages).toEqual([{ role: 'user', content: 'q' }])
  })
})

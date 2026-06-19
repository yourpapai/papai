// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { trackReplyUsage } from '../src/bot-reply-tracking.js'
import type { ReplyFn } from '../src/chat/types.js'

function createBaseReply(): ReplyFn {
  return {
    text: () => Promise.resolve(),
    formatted: () => Promise.resolve(),
    typing: () => {},
    buttons: () => Promise.resolve(undefined),
  }
}

describe('trackReplyUsage', () => {
  test('didReply returns false before any reply is sent', () => {
    const { didReply } = trackReplyUsage(createBaseReply(), false)
    expect(didReply()).toBe(false)
  })

  test('didReply returns true after text reply', async () => {
    const { reply, didReply } = trackReplyUsage(createBaseReply(), false)
    await reply.text('hello')
    expect(didReply()).toBe(true)
  })

  test('didReply returns true after buttons reply', async () => {
    const { reply, didReply } = trackReplyUsage(createBaseReply(), false)
    await reply.buttons('choose', {})
    expect(didReply()).toBe(true)
  })

  test('buttons returns PromptHandle | undefined from wrapped fn', async () => {
    const base = createBaseReply()
    const { reply } = trackReplyUsage(base, false)
    const result = await reply.buttons('pick', {})
    expect(result).toBeUndefined()
  })
})

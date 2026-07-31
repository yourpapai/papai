// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { createReplyDeliveryTracker, trackReplyUsage } from '../src/bot-reply-tracking.js'
import type { ChatFile, ReplyFn } from '../src/chat/types.js'

function createBaseReply(): ReplyFn {
  return {
    text: () => Promise.resolve(),
    formatted: () => Promise.resolve(),
    typing: () => {},
    buttons: () => Promise.resolve(undefined),
  }
}

function createFile(name: string): ChatFile {
  return { filename: name, content: Buffer.from('x') }
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

describe('reply delivery tracking', () => {
  test('successful text reply records one successful part with its length', async () => {
    const tracker = createReplyDeliveryTracker(100, () => 160)
    const { reply, delivery } = trackReplyUsage(createBaseReply(), false, tracker)
    await reply.text('hello')
    expect(delivery?.stats()).toEqual({
      partCount: 1,
      succeededCount: 1,
      failedCount: 0,
      totalLengthChars: 5,
      firstLatencyMs: 60,
    })
  })

  test('failed text reply records one failed part and the error still propagates', async () => {
    const tracker = createReplyDeliveryTracker(0, () => 25)
    const failing: ReplyFn = {
      ...createBaseReply(),
      text: () => Promise.reject(new Error('send blew up')),
    }
    const { reply, delivery } = trackReplyUsage(failing, false, tracker)
    await expect(reply.text('boom')).rejects.toThrow('send blew up')
    expect(delivery?.stats()).toEqual({
      partCount: 1,
      succeededCount: 0,
      failedCount: 1,
      totalLengthChars: 4,
      firstLatencyMs: 25,
    })
  })

  test('mixed text/file delivery records a partial outcome shape', async () => {
    const tracker = createReplyDeliveryTracker(0, () => 10)
    const mixed: ReplyFn = {
      ...createBaseReply(),
      file: () => Promise.reject(new Error('file failed')),
    }
    const { reply, delivery } = trackReplyUsage(mixed, true, tracker)
    await reply.text('first part')
    const fileReply = reply.file
    assert.ok(fileReply !== undefined)
    await expect(fileReply(createFile('a.txt'))).rejects.toThrow('file failed')
    const stats = delivery?.stats()
    expect(stats?.partCount).toBe(2)
    expect(stats?.succeededCount).toBe(1)
    expect(stats?.failedCount).toBe(1)
    expect(stats?.totalLengthChars).toBe(10)
  })

  test('tracked length is bounded per part', async () => {
    const tracker = createReplyDeliveryTracker(0, () => 1)
    const { reply, delivery } = trackReplyUsage(createBaseReply(), false, tracker)
    await reply.text('x'.repeat(100_000))
    const stats = delivery?.stats()
    expect(stats?.partCount).toBe(1)
    expect(stats?.totalLengthChars).toBeLessThanOrEqual(65_536)
  })

  test('first-real-reply latency is captured once and never overwritten', async () => {
    let now = 100
    const tracker = createReplyDeliveryTracker(100, () => now)
    const { reply, delivery } = trackReplyUsage(createBaseReply(), false, tracker)
    now = 140
    await reply.text('first')
    now = 500
    await reply.text('second')
    const stats = delivery?.stats()
    expect(stats?.firstLatencyMs).toBe(40)
    expect(stats?.partCount).toBe(2)
  })

  test('didReply keeps its existing attempt semantics', async () => {
    const tracker = createReplyDeliveryTracker(0, () => 0)
    const { reply, didReply } = trackReplyUsage(createBaseReply(), false, tracker)
    expect(didReply()).toBe(false)
    await reply.text('hi')
    expect(didReply()).toBe(true)
  })

  test('without a tracker the delivery slot is null and behavior is unchanged', async () => {
    const { reply, delivery } = trackReplyUsage(createBaseReply(), false)
    await reply.text('hi')
    expect(delivery).toBeNull()
  })
})

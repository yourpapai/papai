// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  KonturTalkUpdateSchema,
  KonturTalkSendMessageResponseSchema,
  KonturTalkErrorResponseSchema,
} from '../../../src/chat/kontur-talk/schema.js'

describe('Kontur Talk schemas', () => {
  describe('KonturTalkUpdateSchema', () => {
    test('validates a text message update', () => {
      const data = {
        event_id: '$event123',
        user_id: '@alice:host',
        room_id: '!room:host',
        room_is_direct: false,
        type: 'm.room.message',
        timestamp: 1704067200000,
        message_type: 'm.text',
        body: 'Hello, bot!',
        formatted_body: null,
        thread_id: null,
        reply_id: null,
        forward_from: null,
        mentions: ['@bot:host'],
      }
      const result = KonturTalkUpdateSchema.safeParse(data)
      expect(result.success).toBe(true)
      expect(result.data?.user_id).toBe('@alice:host')
      expect(result.data?.message_type).toBe('m.text')
      expect(result.data?.body).toBe('Hello, bot!')
      expect(result.data?.mentions).toEqual(['@bot:host'])
    })

    test('validates a media message update', () => {
      const data = {
        event_id: '$event789',
        user_id: '@bob:host',
        room_id: '!room:host',
        room_is_direct: true,
        type: 'm.room.message',
        timestamp: 1704070800000,
        message_type: 'm.image',
        media_url: 'mxc://host/abcd1234',
        thread_id: null,
        reply_id: null,
        forward_from: null,
        mentions: null,
      }
      const result = KonturTalkUpdateSchema.safeParse(data)
      expect(result.success).toBe(true)
      expect(result.data?.user_id).toBe('@bob:host')
      expect(result.data?.message_type).toBe('m.image')
      expect(result.data?.media_url).toBe('mxc://host/abcd1234')
      expect(result.data?.room_is_direct).toBe(true)
    })

    test('validates a message with thread_id', () => {
      const data = {
        event_id: '$event456',
        user_id: '@alice:host',
        room_id: '!room:host',
        room_is_direct: false,
        type: 'm.room.message',
        timestamp: 1704067200000,
        message_type: 'm.text',
        body: 'In a thread',
        formatted_body: null,
        thread_id: '$thread123',
        reply_id: null,
        forward_from: null,
        mentions: null,
      }
      const result = KonturTalkUpdateSchema.safeParse(data)
      expect(result.success).toBe(true)
      expect(result.data?.thread_id).toBe('$thread123')
    })

    test('validates a message with mentions set to "all"', () => {
      const data = {
        event_id: '$eventAll',
        user_id: '@alice:host',
        room_id: '!room:host',
        room_is_direct: false,
        type: 'm.room.message',
        timestamp: 1704067200000,
        message_type: 'm.text',
        body: '@room hello',
        formatted_body: null,
        thread_id: null,
        reply_id: null,
        forward_from: null,
        mentions: 'all',
      }
      const result = KonturTalkUpdateSchema.safeParse(data)
      expect(result.success).toBe(true)
      expect(result.data?.mentions).toBe('all')
    })

    test('rejects missing required fields', () => {
      const data = { event_id: '$event123' }
      const result = KonturTalkUpdateSchema.safeParse(data)
      expect(result.success).toBe(false)
    })
  })

  describe('KonturTalkSendMessageResponseSchema', () => {
    test('validates success response', () => {
      const data = { event_id: '$newEvent789' }
      const result = KonturTalkSendMessageResponseSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    test('rejects missing event_id', () => {
      const result = KonturTalkSendMessageResponseSchema.safeParse({})
      expect(result.success).toBe(false)
    })
  })

  describe('KonturTalkErrorResponseSchema', () => {
    test('validates error with detail.errcode', () => {
      const data = { detail: { errcode: 'M_UNKNOWN_TOKEN', error: 'Access token has expired' } }
      const result = KonturTalkErrorResponseSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    test('validates error with detail array (validation error)', () => {
      const data = {
        detail: [
          {
            loc: ['body', 'message'],
            msg: 'ensure this value has at most 4096 characters',
            type: 'value_error.any_str.max_length',
          },
        ],
      }
      const result = KonturTalkErrorResponseSchema.safeParse(data)
      expect(result.success).toBe(true)
    })
    test('rejects detail that is neither errcode object nor validation array', () => {
      const data = { detail: 'unexpected string' }
      const result = KonturTalkErrorResponseSchema.safeParse(data)
      expect(result.success).toBe(false)
    })
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { MattermostPostListSchema, MattermostThreadPostSchema } from '../../../src/chat/mattermost/schema.js'

describe('Mattermost thread schemas', () => {
  test('MattermostThreadPostSchema parses a post with create_at', () => {
    const parsed = MattermostThreadPostSchema.parse({
      id: 'p1',
      user_id: 'u1',
      channel_id: 'c1',
      message: 'hello',
      create_at: 1700000000000,
    })
    expect(parsed.create_at).toBe(1700000000000)
    expect(parsed.id).toBe('p1')
  })

  test('MattermostPostListSchema parses order + posts map', () => {
    const parsed = MattermostPostListSchema.parse({
      order: ['p2', 'p1'],
      posts: {
        p1: { id: 'p1', user_id: 'u1', channel_id: 'c1', message: 'root', create_at: 1 },
        p2: { id: 'p2', user_id: 'u2', channel_id: 'c1', message: 'reply', create_at: 2, root_id: 'p1' },
      },
    })
    expect(parsed.order).toEqual(['p2', 'p1'])
    expect(parsed.posts['p2']?.root_id).toBe('p1')
  })
})

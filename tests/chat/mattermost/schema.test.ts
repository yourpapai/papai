import { describe, test, expect } from 'bun:test'
import assert from 'node:assert/strict'

import { MattermostPostSchema } from '../../../src/chat/mattermost/schema.js'
describe('MattermostPostSchema', () => {
  test('should parse basic post without reply fields', () => {
    const post = {
      id: 'post123',
      user_id: 'user456',
      channel_id: 'channel789',
      message: 'Hello world',
    }

    const result = MattermostPostSchema.safeParse(post)
    expect(result.success).toBe(true)
    assert(result.success)
    expect(result.data.root_id).toBeUndefined()
    expect(result.data.parent_id).toBeUndefined()
  })

  test('should parse reply post with root_id and parent_id', () => {
    const post = {
      id: 'reply789',
      user_id: 'user456',
      channel_id: 'channel789',
      message: 'This is a reply',
      user_name: 'testuser',
      root_id: 'root123',
      parent_id: 'parent456',
    }

    const result = MattermostPostSchema.safeParse(post)
    expect(result.success).toBe(true)
    assert(result.success)
    expect(result.data.root_id).toBe('root123')
    expect(result.data.parent_id).toBe('parent456')
  })

  test('should parse post with only root_id (thread reply)', () => {
    const post = {
      id: 'reply789',
      user_id: 'user456',
      channel_id: 'channel789',
      message: 'Thread reply',
      root_id: 'root123',
    }

    const result = MattermostPostSchema.safeParse(post)
    expect(result.success).toBe(true)
    assert(result.success)
    expect(result.data.root_id).toBe('root123')
    expect(result.data.parent_id).toBeUndefined()
  })
})

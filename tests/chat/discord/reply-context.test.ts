import { beforeEach, describe, expect, test } from 'bun:test'

import { buildDiscordReplyContext, type DiscordReplyMessageLike } from '../../../src/chat/discord/reply-context.js'
import { mockLogger, mockMessageCache } from '../../utils/test-helpers.js'

const fetchKnownParent = (
  id: unknown,
): Promise<{ id: string; author: { id: string; username: string }; content: string }> =>
  id === 'parent-1'
    ? Promise.resolve({ id: 'parent-1', author: { id: 'user-9', username: 'bob' }, content: 'the parent text' })
    : Promise.reject(new Error('404'))

describe('buildDiscordReplyContext', () => {
  beforeEach(() => {
    mockLogger()
    mockMessageCache()
  })

  test('returns undefined when message has no reference', async () => {
    const msg: DiscordReplyMessageLike = {
      reference: null,
      channel: { id: 'chan', messages: { fetch: () => Promise.reject(new Error('should not be called')) } },
    }
    const result = await buildDiscordReplyContext(msg, 'chan-1')
    expect(result).toBeUndefined()
  })

  test('returns a populated ReplyContext when REST fetch succeeds', async () => {
    const msg: DiscordReplyMessageLike = {
      reference: { messageId: 'parent-1' },
      channel: {
        id: 'chan-1',
        messages: { fetch: fetchKnownParent },
      },
    }
    const result = await buildDiscordReplyContext(msg, 'chan-1')
    expect(result).toBeDefined()
    expect(result!.messageId).toBe('parent-1')
    expect(result!.authorId).toBe('user-9')
    expect(result!.authorUsername).toBe('bob')
    expect(result!.text).toBe('the parent text')
  })

  test('returns a skeleton ReplyContext when REST fetch throws', async () => {
    const msg: DiscordReplyMessageLike = {
      reference: { messageId: 'parent-1' },
      channel: {
        id: 'chan-1',
        messages: { fetch: () => Promise.reject(new Error('404 Unknown Message')) },
      },
    }
    const result = await buildDiscordReplyContext(msg, 'chan-1')
    expect(result).toBeDefined()
    expect(result!.messageId).toBe('parent-1')
    expect(result!.authorId).toBeUndefined()
    expect(result!.text).toBeUndefined()
  })
})

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ChatLinkResult } from '../../src/chat/mattermost/link-resolver.js'
import { makeFetchChatLinkTool } from '../../src/tools/fetch-chat-link.js'
import { TOOL_METADATA } from '../../src/tools/tool-metadata.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'

const sampleResult: ChatLinkResult = {
  source: 'mattermost',
  channelId: 'c1',
  rootPostId: 'p1',
  linkedPostId: 'p1',
  scope: 'thread',
  messages: [
    {
      authorId: 'u1',
      author: 'Alice',
      timestamp: '2026-01-01T00:00:00.000Z',
      text: 'hi',
      isRoot: true,
      isLinked: true,
    },
  ],
}

describe('fetch_chat_link tool', () => {
  test('input schema accepts url with and without scope, rejects bad scope', () => {
    const tool = makeFetchChatLinkTool('mm-1', 'user-1', { resolveChatLink: () => Promise.resolve(sampleResult) })
    expect(schemaValidates(tool, { url: 'https://mm.example.com/eng/pl/p1', scope: 'post' })).toBe(true)
    expect(schemaValidates(tool, { url: 'https://mm.example.com/eng/pl/p1' })).toBe(true)
    expect(schemaValidates(tool, { url: 'x', scope: 'sideways' })).toBe(false)
    expect(schemaValidates(tool, {})).toBe(false)
  })

  test('execute passes bound ids + input to the resolver and returns its result', async () => {
    mockLogger()
    const calls: unknown[] = []
    const tool = makeFetchChatLinkTool('mm-1', 'user-1', {
      resolveChatLink: (a) => {
        calls.push(a)
        return Promise.resolve(sampleResult)
      },
    })
    const execute = getToolExecutor(tool)
    const result = await execute({ url: 'https://mm.example.com/eng/pl/p1', scope: 'thread' }, { toolCallId: 'c' })

    expect(result).toEqual(sampleResult)
    expect(calls[0]).toEqual({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: 'https://mm.example.com/eng/pl/p1',
      scope: 'thread',
    })
  })

  test('execute rethrows resolver errors', async () => {
    mockLogger()
    const tool = makeFetchChatLinkTool('mm-1', 'user-1', {
      resolveChatLink: () => Promise.reject(new Error('boom')),
    })
    const execute = getToolExecutor(tool)
    await expect(
      execute({ url: 'https://mm.example.com/eng/pl/p1', scope: 'post' }, { toolCallId: 'c' }),
    ).rejects.toThrow('boom')
  })

  test('fetch_chat_link is classified as open-world history-read', () => {
    expect(TOOL_METADATA['fetch_chat_link']).toEqual({ domain: 'history', operation: 'read', risk: 'open-world' })
  })
})

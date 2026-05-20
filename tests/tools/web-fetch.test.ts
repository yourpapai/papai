// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeWebFetchTool } from '../../src/tools/web-fetch.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'

describe('makeWebFetchTool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('forwards storage context, actor user, url, goal, and abortSignal', async () => {
    const abortController = new AbortController()
    const fetchAndExtract = mock(() =>
      Promise.resolve({
        url: 'https://example.com/article',
        title: 'Example',
        summary: 'Summary',
        excerpt: 'Excerpt',
        truncated: false,
        contentType: 'text/html',
        source: 'fetch' as const,
        fetchedAt: 1,
      }),
    )

    const tool = makeWebFetchTool('group-123', 'user-456', 'group', { fetchAndExtract })
    const result = await getToolExecutor(tool)(
      { url: 'https://example.com/article', goal: 'Summarize the release notes' },
      { toolCallId: '1', messages: [], abortSignal: abortController.signal },
    )

    expect(fetchAndExtract).toHaveBeenCalledWith({
      storageContextId: 'group-123',
      actorUserId: 'user-456',
      contextType: 'group',
      url: 'https://example.com/article',
      goal: 'Summarize the release notes',
      abortSignal: abortController.signal,
    })
    expect(result).toEqual({
      url: 'https://example.com/article',
      title: 'Example',
      summary: 'Summary',
      excerpt: 'Excerpt',
      truncated: false,
      contentType: 'text/html',
      source: 'fetch',
      fetchedAt: 1,
    })
  })

  test('validates required url and optional goal', () => {
    const tool = makeWebFetchTool('group-123')

    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { url: 'notaurl' })).toBe(false)
    expect(schemaValidates(tool, { url: 'ftp://example.com/file.txt' })).toBe(false)
    expect(schemaValidates(tool, { url: 'file:///tmp/local.txt' })).toBe(false)
    expect(schemaValidates(tool, { url: 'https://example.com' })).toBe(true)
    expect(schemaValidates(tool, { url: 'https://example.com', goal: 'Find the pricing details' })).toBe(true)
  })

  test('rethrows fetchAndExtract failures', async () => {
    const expectedError = new Error('fetch failed')
    const fetchAndExtract = mock(() => Promise.reject(expectedError))

    const tool = makeWebFetchTool('group-123', 'user-456', 'group', { fetchAndExtract })

    await expect(
      getToolExecutor(tool)(
        { url: 'https://example.com/article' },
        { toolCallId: '1', messages: [], abortSignal: undefined },
      ),
    ).rejects.toBe(expectedError)
  })
})

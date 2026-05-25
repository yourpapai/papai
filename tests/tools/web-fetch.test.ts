// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { webRateLimit } from '../../src/db/schema.js'
import { buildTools } from '../../src/tools/tools-builder.js'
import { makeWebFetchTool } from '../../src/tools/web-fetch.js'
import { putCachedWebFetch } from '../../src/web/cache.js'
import { getTestDb, getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

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

  test('uses scoped storage context as actor id when assembled with storage context', async () => {
    await setupTestDb()
    const storageContextId = 'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:c2hhcmVkLWdyb3Vw'
    putCachedWebFetch(
      'https://example.com/article',
      {
        url: 'https://example.com/article',
        title: 'Example',
        summary: 'Summary',
        excerpt: 'Excerpt',
        truncated: false,
        contentType: 'text/html',
        source: 'fetch',
        fetchedAt: 1,
      },
      Date.now() + 60_000,
    )
    const tools = buildTools(createMockProvider(), 'user-456', storageContextId, 'normal', 'group')

    await getToolExecutor(tools['web_fetch']!)({ url: 'https://example.com/article' }, { toolCallId: '1', messages: [] })

    const actors = getTestDb().select({ actorId: webRateLimit.actorId }).from(webRateLimit).all()
    expect(actors).toEqual([{ actorId: storageContextId }])
  })
})

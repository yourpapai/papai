// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('web cache', () => {
  let getCachedWebFetch: (
    normalizedUrl: string,
    nowMs?: number,
  ) => import('../../src/web/types.js').WebFetchResult | null
  let putCachedWebFetch: (
    normalizedUrl: string,
    result: import('../../src/web/types.js').WebFetchResult,
    expiresAt: number,
  ) => void

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    ;({ getCachedWebFetch, putCachedWebFetch } = await import('../../src/web/cache.js'))
  })

  test('returns a fresh cached entry with cache source', () => {
    const normalizedUrl = 'https://example.com/article'
    const fetchedAt = 1_700_000_000_000

    putCachedWebFetch(
      normalizedUrl,
      {
        url: normalizedUrl,
        title: 'Example title',
        summary: 'Example summary',
        excerpt: 'Example excerpt',
        truncated: true,
        contentType: 'text/html',
        source: 'fetch',
        fetchedAt,
      },
      fetchedAt + 60_000,
    )

    expect(getCachedWebFetch(normalizedUrl, fetchedAt + 1)).toEqual({
      url: normalizedUrl,
      title: 'Example title',
      summary: 'Example summary',
      excerpt: 'Example excerpt',
      truncated: true,
      contentType: 'text/html',
      source: 'cache',
      fetchedAt,
    })
  })

  test('returns null for an expired cached entry', () => {
    const normalizedUrl = 'https://example.com/expired'
    const fetchedAt = 1_700_000_000_000

    putCachedWebFetch(
      normalizedUrl,
      {
        url: normalizedUrl,
        title: 'Expired title',
        summary: 'Expired summary',
        excerpt: 'Expired excerpt',
        truncated: false,
        contentType: 'text/html',
        source: 'fetch',
        fetchedAt,
      },
      fetchedAt + 10,
    )

    expect(getCachedWebFetch(normalizedUrl, fetchedAt + 10)).toBeNull()
  })
})

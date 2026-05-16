// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { webCache } from '../db/schema.js'
import { logger } from '../logger.js'
import type { WebFetchResult } from './types.js'

const log = logger.child({ scope: 'web:cache' })

const hashUrl = (normalizedUrl: string): string => createHash('sha256').update(normalizedUrl).digest('hex')

export function getCachedWebFetch(normalizedUrl: string, nowMs: number = Date.now()): WebFetchResult | null {
  log.debug({ normalizedUrl, nowMs }, 'getCachedWebFetch called')

  const urlHash = hashUrl(normalizedUrl)
  const row = getDrizzleDb().select().from(webCache).where(eq(webCache.urlHash, urlHash)).get()

  if (row === undefined) {
    log.info({ normalizedUrl }, 'Web cache miss')
    return null
  }

  if (row.expiresAt <= nowMs) {
    log.info({ normalizedUrl, expiresAt: row.expiresAt, nowMs }, 'Web cache entry expired')
    return null
  }

  const result: WebFetchResult = {
    url: row.finalUrl,
    title: row.title,
    summary: row.summary,
    excerpt: row.excerpt,
    truncated: row.truncated,
    contentType: row.contentType,
    source: 'cache',
    fetchedAt: row.fetchedAt,
  }

  log.info({ normalizedUrl, fetchedAt: row.fetchedAt, expiresAt: row.expiresAt }, 'Web cache hit')
  return result
}

export function putCachedWebFetch(normalizedUrl: string, result: WebFetchResult, expiresAt: number): void {
  log.debug(
    { normalizedUrl, finalUrl: result.url, fetchedAt: result.fetchedAt, expiresAt, truncated: result.truncated },
    'putCachedWebFetch called',
  )

  const urlHash = hashUrl(normalizedUrl)

  getDrizzleDb()
    .insert(webCache)
    .values({
      urlHash,
      url: normalizedUrl,
      finalUrl: result.url,
      title: result.title,
      summary: result.summary,
      excerpt: result.excerpt,
      truncated: result.truncated,
      contentType: result.contentType,
      fetchedAt: result.fetchedAt,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: webCache.urlHash,
      set: {
        url: normalizedUrl,
        finalUrl: result.url,
        title: result.title,
        summary: result.summary,
        excerpt: result.excerpt,
        truncated: result.truncated,
        contentType: result.contentType,
        fetchedAt: result.fetchedAt,
        expiresAt,
      },
    })
    .run()

  log.info({ normalizedUrl, finalUrl: result.url, expiresAt }, 'Stored web cache entry')
}

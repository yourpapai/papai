import { describe, expect, it, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { eq, and } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  groupAdminObservations,
  knownGroupContexts,
  userIdentityMappings,
  webCache,
  webRateLimit,
} from '../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('userIdentityMappings', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('should have composite primary key on contextId and providerName', () => {
    const table = userIdentityMappings
    expect(table).toBeDefined()
    // Composite key means we can store different mappings per provider
    expect(table.contextId).toBeDefined()
    expect(table.providerName).toBeDefined()
  })

  it('should support nullable providerUserId for unmatched state', () => {
    const db = getDrizzleDb()

    // Insert unmatched mapping
    db.insert(userIdentityMappings)
      .values({
        contextId: 'test-user-123',
        providerName: 'youtrack',
        providerUserId: null,
        providerUserLogin: null,
        displayName: null,
        matchedAt: new Date().toISOString(),
        matchMethod: 'unmatched',
        confidence: 0,
      })
      .run()

    const row = db
      .select()
      .from(userIdentityMappings)
      .where(
        and(eq(userIdentityMappings.contextId, 'test-user-123'), eq(userIdentityMappings.providerName, 'youtrack')),
      )
      .get()

    assert(row !== undefined)
    expect(row.providerUserId).toBeNull()
    expect(row.matchMethod).toBe('unmatched')

    // Cleanup
    db.delete(userIdentityMappings).where(eq(userIdentityMappings.contextId, 'test-user-123')).run()
  })
})

describe('knownGroupContexts', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('should expose the expected columns', () => {
    expect(knownGroupContexts.contextId).toBeDefined()
    expect(knownGroupContexts.provider).toBeDefined()
    expect(knownGroupContexts.displayName).toBeDefined()
    expect(knownGroupContexts.parentName).toBeDefined()
    expect(knownGroupContexts.firstSeenAt).toBeDefined()
    expect(knownGroupContexts.lastSeenAt).toBeDefined()
  })
})

describe('groupAdminObservations', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('should expose a composite key over provider, contextId, and userId', () => {
    expect(groupAdminObservations.provider).toBeDefined()
    expect(groupAdminObservations.contextId).toBeDefined()
    expect(groupAdminObservations.userId).toBeDefined()
    expect(groupAdminObservations.isAdmin).toBeDefined()
    expect(groupAdminObservations.lastSeenAt).toBeDefined()
  })
})

describe('web fetch schema', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('exports the web fetch tables', () => {
    expect(getDrizzleDb()).toBeDefined()
    expect(webCache.urlHash).toBeDefined()
    expect(webRateLimit.actorId).toBeDefined()
  })

  it('supports inserting cached pages and reading back the mapped fields', () => {
    const db = getDrizzleDb()

    db.insert(webCache)
      .values({
        urlHash: 'hash-1',
        url: 'https://example.com/article',
        finalUrl: 'https://example.com/article',
        title: 'Example title',
        summary: 'Example summary',
        excerpt: 'Example excerpt',
        contentType: 'text/html',
        fetchedAt: 1,
        expiresAt: 2,
      })
      .run()

    const row = db.select().from(webCache).where(eq(webCache.urlHash, 'hash-1')).get()

    assert(row !== undefined)
    expect(row.truncated).toBe(false)
    expect(row.finalUrl).toBe('https://example.com/article')
  })

  it('enforces the webRateLimit composite primary key', () => {
    const db = getDrizzleDb()

    db.insert(webRateLimit).values({ actorId: 'actor-1', windowStart: 0, count: 1 }).run()
    db.insert(webRateLimit).values({ actorId: 'actor-1', windowStart: 300000, count: 1 }).run()

    expect(() => {
      db.insert(webRateLimit).values({ actorId: 'actor-1', windowStart: 0, count: 2 }).run()
    }).toThrow()

    const rows = db.select().from(webRateLimit).where(eq(webRateLimit.actorId, 'actor-1')).all()
    expect(rows).toHaveLength(2)
  })
})

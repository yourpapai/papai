import { describe, expect, it, beforeEach } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { stagedFiles } from '../../src/db/staged-schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('stagedFiles schema', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('exposes the stagedFiles table through Drizzle', () => {
    const db = getDrizzleDb()
    expect(db).toBeDefined()
    expect(stagedFiles.stagedId).toBeDefined()
    expect(stagedFiles.contextId).toBeDefined()
    expect(stagedFiles.messageId).toBeDefined()
    expect(stagedFiles.senderId).toBeDefined()
    expect(stagedFiles.platformFileId).toBeDefined()
    expect(stagedFiles.status).toBeDefined()
    expect(stagedFiles.expiresAt).toBeDefined()
  })

  it('round-trips a staged file row', () => {
    const db = getDrizzleDb()
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 86400000).toISOString()
    db.insert(stagedFiles)
      .values({
        stagedId: 'stg_test',
        contextId: 'ctx-test',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_file_123',
        sourceProvider: 'telegram',
        status: 'staged',
        createdAt: now,
        expiresAt: expires,
      })
      .run()

    const row = db.select().from(stagedFiles).where(eq(stagedFiles.stagedId, 'stg_test')).get()

    expect(row).toBeDefined()
    expect(row!.contextId).toBe('ctx-test')
    expect(row!.status).toBe('staged')
    expect(row!.filename).toBe('report.pdf')
    expect(row!.platformFileId).toBe('tg_file_123')
  })

  it('defaults status to staged', () => {
    const db = getDrizzleDb()
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 86400000).toISOString()
    db.insert(stagedFiles)
      .values({
        stagedId: 'stg_default',
        contextId: 'ctx-test',
        senderId: 'user-1',
        filename: 'doc.txt',
        platformFileId: 'tg_456',
        sourceProvider: 'telegram',
        createdAt: now,
        expiresAt: expires,
      })
      .run()

    const row = db.select().from(stagedFiles).where(eq(stagedFiles.stagedId, 'stg_default')).get()

    expect(row!.status).toBe('staged')
  })
})

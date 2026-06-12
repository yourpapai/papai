// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, beforeEach } from 'bun:test'

import { eq, sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/sqlite-core'

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

  it('declares the platform file and context unique index', () => {
    const indexNames = getTableConfig(stagedFiles).indexes.map((index) => index.config.name)

    expect(indexNames).toContain('idx_staged_platform_context')
  })

  it('rejects inserting NULL into NOT NULL columns', () => {
    const db = getDrizzleDb()
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 86400000).toISOString()
    expect(() =>
      db.run(sql`
        insert into staged_files (
          staged_id,
          context_id,
          sender_id,
          filename,
          platform_file_id,
          source_provider,
          created_at,
          expires_at
        ) values (
          ${'stg_n1'},
          null,
          ${'user-1'},
          ${'doc.txt'},
          ${'tg_1'},
          ${'telegram'},
          ${now},
          ${expires}
        )
      `),
    ).toThrow()
    expect(() =>
      db.run(sql`
        insert into staged_files (
          staged_id,
          context_id,
          sender_id,
          filename,
          platform_file_id,
          source_provider,
          created_at,
          expires_at
        ) values (
          ${'stg_n2'},
          ${'ctx-test'},
          null,
          ${'doc.txt'},
          ${'tg_1'},
          ${'telegram'},
          ${now},
          ${expires}
        )
      `),
    ).toThrow()
    expect(() =>
      db.run(sql`
        insert into staged_files (
          staged_id,
          context_id,
          sender_id,
          filename,
          platform_file_id,
          source_provider,
          created_at,
          expires_at
        ) values (
          ${'stg_n3'},
          ${'ctx-test'},
          ${'user-1'},
          null,
          ${'tg_1'},
          ${'telegram'},
          ${now},
          ${expires}
        )
      `),
    ).toThrow()
    expect(() =>
      db.run(sql`
        insert into staged_files (
          staged_id,
          context_id,
          sender_id,
          filename,
          platform_file_id,
          source_provider,
          created_at,
          expires_at
        ) values (
          ${'stg_n4'},
          ${'ctx-test'},
          ${'user-1'},
          ${'doc.txt'},
          null,
          ${'telegram'},
          ${now},
          ${expires}
        )
      `),
    ).toThrow()
    expect(() =>
      db.run(sql`
        insert into staged_files (
          staged_id,
          context_id,
          sender_id,
          filename,
          platform_file_id,
          source_provider,
          created_at,
          expires_at
        ) values (
          ${'stg_n5'},
          ${'ctx-test'},
          ${'user-1'},
          ${'doc.txt'},
          ${'tg_1'},
          null,
          ${now},
          ${expires}
        )
      `),
    ).toThrow()
  })

  it('rejects duplicate staged_id', () => {
    const db = getDrizzleDb()
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 86400000).toISOString()

    db.insert(stagedFiles)
      .values({
        stagedId: 'stg_dup',
        contextId: 'ctx-1',
        senderId: 'user-1',
        filename: 'a.pdf',
        platformFileId: 'tg_a',
        sourceProvider: 'telegram',
        createdAt: now,
        expiresAt: expires,
      })
      .run()

    expect(() =>
      db
        .insert(stagedFiles)
        .values({
          stagedId: 'stg_dup',
          contextId: 'ctx-2',
          senderId: 'user-2',
          filename: 'b.pdf',
          platformFileId: 'tg_b',
          sourceProvider: 'telegram',
          createdAt: now,
          expiresAt: expires,
        })
        .run(),
    ).toThrow()
  })

  it('upserts on duplicate platform_file_id + context_id pair', () => {
    const db = getDrizzleDb()
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 86400000).toISOString()

    db.insert(stagedFiles)
      .values({
        stagedId: 'stg_first',
        contextId: 'ctx-shared',
        senderId: 'user-1',
        filename: 'first.pdf',
        platformFileId: 'tg_shared',
        sourceProvider: 'telegram',
        createdAt: now,
        expiresAt: expires,
      })
      .run()

    // Inserting same platformFileId + contextId should fail without upsert
    expect(() =>
      db
        .insert(stagedFiles)
        .values({
          stagedId: 'stg_second',
          contextId: 'ctx-shared',
          senderId: 'user-2',
          filename: 'second.pdf',
          platformFileId: 'tg_shared',
          sourceProvider: 'telegram',
          createdAt: now,
          expiresAt: expires,
        })
        .run(),
    ).toThrow()
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

  it('staged_files accepts origin and forwarded_from', () => {
    const db = getDrizzleDb()
    db.insert(stagedFiles)
      .values({
        stagedId: 'stg_origin_test',
        contextId: 'ctx-origin',
        senderId: 'user-1',
        filename: 'voice.ogg',
        platformFileId: 'pf-origin-1',
        sourceProvider: 'telegram',
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00.000Z',
        origin: 'voice',
        forwardedFrom: 'Alice',
      })
      .run()
    const row = db.select().from(stagedFiles).where(eq(stagedFiles.stagedId, 'stg_origin_test')).get()
    expect(row?.origin).toBe('voice')
    expect(row?.forwardedFrom).toBe('Alice')
  })
})

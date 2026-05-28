// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId, toScopedThreadContextId } from '../../../src/chat/scoped-context.js'
import { migration046ParentSharedContextEntities } from '../../../src/db/migrations/046_parent_shared_context_entities.js'

const getRows = <T>(db: Database, sql: string): T[] => db.query<T, []>(sql).all()

const createTables = (db: Database): void => {
  db.run(`CREATE TABLE user_instructions (id TEXT PRIMARY KEY, context_id TEXT NOT NULL, text TEXT NOT NULL)`)
  db.run(`CREATE TABLE memos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL)`)
  db.run(`CREATE TABLE recurring_tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)`)
  db.run(
    `CREATE TABLE scheduled_prompts (id TEXT PRIMARY KEY, created_by_user_id TEXT NOT NULL, delivery_context_id TEXT, prompt TEXT NOT NULL)`,
  )
  db.run(
    `CREATE TABLE alert_prompts (id TEXT PRIMARY KEY, created_by_user_id TEXT NOT NULL, delivery_context_id TEXT, prompt TEXT NOT NULL)`,
  )
  db.run(
    `CREATE TABLE user_config (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key))`,
  )
  db.run(
    `CREATE TABLE plugin_context_state (plugin_id TEXT NOT NULL, context_id TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (plugin_id, context_id))`,
  )
  db.run(
    `CREATE TABLE plugin_kv (plugin_id TEXT NOT NULL, context_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (plugin_id, context_id, key))`,
  )
  db.run(
    `CREATE TABLE memory_facts (user_id TEXT NOT NULL, identifier TEXT NOT NULL, title TEXT NOT NULL, PRIMARY KEY (user_id, identifier))`,
  )
  db.run(`CREATE TABLE memory_summary (user_id TEXT PRIMARY KEY, summary TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  db.run(`CREATE TABLE conversation_history (user_id TEXT PRIMARY KEY, messages TEXT NOT NULL)`)
  db.run(`CREATE TABLE attachments (attachment_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, filename TEXT NOT NULL)`)
  db.run(`CREATE TABLE staged_files (staged_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, filename TEXT NOT NULL)`)
  db.run(
    `CREATE TABLE message_metadata (context_id TEXT NOT NULL, message_id TEXT NOT NULL, timestamp INTEGER NOT NULL, PRIMARY KEY (context_id, message_id))`,
  )
  db.run(
    `CREATE TABLE llm_usage_events (event_id TEXT PRIMARY KEY, storage_context_id TEXT NOT NULL, model TEXT NOT NULL)`,
  )
  db.run(
    `CREATE TABLE tool_call_events (event_id TEXT PRIMARY KEY, storage_context_id TEXT NOT NULL, tool_name TEXT NOT NULL)`,
  )
}

describe('migration046ParentSharedContextEntities', () => {
  let db: Database
  const parentContextId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-1' })
  const threadContextId = toScopedThreadContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: 'group-1',
    threadId: 'thread-1',
  })
  const secondThreadContextId = toScopedThreadContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: 'group-1',
    threadId: 'thread-2',
  })
  const thirdThreadContextId = toScopedThreadContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: 'group-1',
    threadId: 'thread-3',
  })

  beforeEach(() => {
    db = new Database(':memory:')
    createTables(db)
  })

  afterEach(() => {
    db.close()
  })

  test('promotes durable thread-owned rows to parent while preserving deferred delivery contexts', () => {
    db.run(`INSERT INTO user_instructions VALUES ('instruction-1', ?, 'be brief')`, [threadContextId])
    db.run(`INSERT INTO memos VALUES ('memo-1', ?, 'remember this')`, [threadContextId])
    db.run(`INSERT INTO recurring_tasks VALUES ('recurring-1', ?, 'standup')`, [threadContextId])
    db.run(`INSERT INTO scheduled_prompts VALUES ('scheduled-1', ?, ?, 'later')`, [threadContextId, threadContextId])
    db.run(`INSERT INTO alert_prompts VALUES ('alert-1', ?, ?, 'alert')`, [threadContextId, threadContextId])

    migration046ParentSharedContextEntities.up(db)

    expect(getRows<{ context_id: string }>(db, `SELECT context_id FROM user_instructions`)).toEqual([
      { context_id: parentContextId },
    ])
    expect(getRows<{ user_id: string }>(db, `SELECT user_id FROM memos`)).toEqual([{ user_id: parentContextId }])
    expect(getRows<{ user_id: string }>(db, `SELECT user_id FROM recurring_tasks`)).toEqual([
      { user_id: parentContextId },
    ])
    expect(
      getRows<{ created_by_user_id: string; delivery_context_id: string }>(
        db,
        `SELECT created_by_user_id, delivery_context_id FROM scheduled_prompts`,
      ),
    ).toEqual([{ created_by_user_id: parentContextId, delivery_context_id: threadContextId }])
    expect(
      getRows<{ created_by_user_id: string; delivery_context_id: string }>(
        db,
        `SELECT created_by_user_id, delivery_context_id FROM alert_prompts`,
      ),
    ).toEqual([{ created_by_user_id: parentContextId, delivery_context_id: threadContextId }])
  })

  test('promotes parent-shared user config rows and keeps parent on conflicts', () => {
    db.run(`INSERT INTO user_config VALUES (?, 'tool_prefs', 'parent-tools')`, [parentContextId])
    db.run(`INSERT INTO user_config VALUES (?, 'tool_prefs', 'thread-tools')`, [threadContextId])
    db.run(`INSERT INTO user_config VALUES (?, 'mcp_endpoints', 'thread-mcp')`, [threadContextId])
    db.run(`INSERT INTO user_config VALUES (?, 'ai_tool_visibility', 'thread-tool-visibility')`, [threadContextId])
    db.run(`INSERT INTO user_config VALUES (?, 'ai_reasoning_visibility', 'thread-reasoning')`, [threadContextId])
    db.run(`INSERT INTO user_config VALUES (?, 'ai_output_detail_level', 'thread-detail')`, [threadContextId])
    db.run(`INSERT INTO user_config VALUES (?, 'plugin:hello-world:token', 'thread-plugin-config')`, [threadContextId])
    db.run(`INSERT INTO user_config VALUES (?, 'timezone', 'thread-timezone')`, [threadContextId])

    migration046ParentSharedContextEntities.up(db)

    expect(
      getRows<{ user_id: string; key: string; value: string }>(
        db,
        `SELECT user_id, key, value FROM user_config ORDER BY key`,
      ),
    ).toEqual([
      { user_id: parentContextId, key: 'ai_output_detail_level', value: 'thread-detail' },
      { user_id: parentContextId, key: 'ai_reasoning_visibility', value: 'thread-reasoning' },
      { user_id: parentContextId, key: 'ai_tool_visibility', value: 'thread-tool-visibility' },
      { user_id: parentContextId, key: 'mcp_endpoints', value: 'thread-mcp' },
      { user_id: parentContextId, key: 'plugin:hello-world:token', value: 'thread-plugin-config' },
      { user_id: threadContextId, key: 'timezone', value: 'thread-timezone' },
      { user_id: parentContextId, key: 'tool_prefs', value: 'parent-tools' },
    ])
  })

  test('keeps parent plugin rows and deletes conflicting thread plugin rows', () => {
    db.run(`INSERT INTO plugin_context_state VALUES ('hello-world', ?, 1, '2026-05-02T00:00:00Z')`, [parentContextId])
    db.run(`INSERT INTO plugin_context_state VALUES ('hello-world', ?, 0, '2026-05-01T00:00:00Z')`, [threadContextId])
    db.run(`INSERT INTO plugin_context_state VALUES ('other-plugin', ?, 1, '2026-05-01T00:00:00Z')`, [threadContextId])
    db.run(
      `INSERT INTO plugin_kv VALUES ('hello-world', ?, 'token', 'parent-value', 'parent', '2026-05-02T00:00:00Z')`,
      [parentContextId],
    )
    db.run(
      `INSERT INTO plugin_kv VALUES ('hello-world', ?, 'token', 'thread-value', 'thread', '2026-05-01T00:00:00Z')`,
      [threadContextId],
    )
    db.run(
      `INSERT INTO plugin_kv VALUES ('hello-world', ?, 'other', 'thread-other', 'thread', '2026-05-01T00:00:00Z')`,
      [threadContextId],
    )

    migration046ParentSharedContextEntities.up(db)

    expect(
      getRows<{ plugin_id: string; context_id: string; enabled: number }>(
        db,
        `SELECT plugin_id, context_id, enabled FROM plugin_context_state ORDER BY plugin_id`,
      ),
    ).toEqual([
      { plugin_id: 'hello-world', context_id: parentContextId, enabled: 1 },
      { plugin_id: 'other-plugin', context_id: parentContextId, enabled: 1 },
    ])
    expect(
      getRows<{ plugin_id: string; context_id: string; key: string; value: string }>(
        db,
        `SELECT plugin_id, context_id, key, value FROM plugin_kv ORDER BY key`,
      ),
    ).toEqual([
      { plugin_id: 'hello-world', context_id: parentContextId, key: 'other', value: 'thread-other' },
      { plugin_id: 'hello-world', context_id: parentContextId, key: 'token', value: 'parent-value' },
    ])
  })

  test('promotes newer thread plugin context row over stale parent row', () => {
    db.run(`INSERT INTO plugin_context_state VALUES ('hello-world', ?, 1, '2026-05-01T00:00:00Z')`, [parentContextId])
    db.run(`INSERT INTO plugin_context_state VALUES ('hello-world', ?, 0, '2026-05-02T00:00:00Z')`, [threadContextId])
    db.run(`INSERT INTO plugin_context_state VALUES ('hello-world', ?, 1, '2026-05-01T12:00:00Z')`, [
      secondThreadContextId,
    ])

    migration046ParentSharedContextEntities.up(db)

    expect(
      getRows<{ context_id: string; enabled: number; updated_at: string }>(
        db,
        `SELECT context_id, enabled, updated_at FROM plugin_context_state`,
      ),
    ).toEqual([{ context_id: parentContextId, enabled: 0, updated_at: '2026-05-02T00:00:00Z' }])
  })

  test('keeps parent plugin context row when timestamps tie', () => {
    db.run(`INSERT INTO plugin_context_state VALUES ('hello-world', ?, 1, '2026-05-01T00:00:00Z')`, [parentContextId])
    db.run(`INSERT INTO plugin_context_state VALUES ('hello-world', ?, 0, '2026-05-01T00:00:00Z')`, [threadContextId])

    migration046ParentSharedContextEntities.up(db)

    expect(
      getRows<{ context_id: string; enabled: number; updated_at: string }>(
        db,
        `SELECT context_id, enabled, updated_at FROM plugin_context_state`,
      ),
    ).toEqual([{ context_id: parentContextId, enabled: 1, updated_at: '2026-05-01T00:00:00Z' }])
  })

  test('promotes newer thread plugin kv row over stale parent row', () => {
    db.run(
      `INSERT INTO plugin_kv VALUES ('hello-world', ?, 'token', 'parent-value', 'created-parent', '2026-05-01T00:00:00Z')`,
      [parentContextId],
    )
    db.run(
      `INSERT INTO plugin_kv VALUES ('hello-world', ?, 'token', 'thread-value', 'created-thread', '2026-05-02T00:00:00Z')`,
      [threadContextId],
    )

    migration046ParentSharedContextEntities.up(db)

    expect(
      getRows<{ context_id: string; key: string; value: string; updated_at: string }>(
        db,
        `SELECT context_id, key, value, updated_at FROM plugin_kv`,
      ),
    ).toEqual([
      { context_id: parentContextId, key: 'token', value: 'thread-value', updated_at: '2026-05-02T00:00:00Z' },
    ])
  })

  test('keeps parent plugin kv row when timestamps tie', () => {
    db.run(
      `INSERT INTO plugin_kv VALUES ('hello-world', ?, 'token', 'parent-value', 'created-parent', '2026-05-01T00:00:00Z')`,
      [parentContextId],
    )
    db.run(
      `INSERT INTO plugin_kv VALUES ('hello-world', ?, 'token', 'thread-value', 'created-thread', '2026-05-01T00:00:00Z')`,
      [threadContextId],
    )

    migration046ParentSharedContextEntities.up(db)

    expect(
      getRows<{ context_id: string; key: string; value: string; updated_at: string }>(
        db,
        `SELECT context_id, key, value, updated_at FROM plugin_kv`,
      ),
    ).toEqual([
      { context_id: parentContextId, key: 'token', value: 'parent-value', updated_at: '2026-05-01T00:00:00Z' },
    ])
  })

  test('promotes newest colliding plugin context row when no parent row exists', () => {
    db.run(`INSERT INTO plugin_context_state VALUES ('hello-world', ?, 0, '2026-05-01T00:00:00Z')`, [threadContextId])
    db.run(`INSERT INTO plugin_context_state VALUES ('hello-world', ?, 1, '2026-05-02T00:00:00Z')`, [
      secondThreadContextId,
    ])
    db.run(`INSERT INTO plugin_context_state VALUES ('hello-world', ?, 0, '2026-05-02T00:00:00Z')`, [
      thirdThreadContextId,
    ])

    migration046ParentSharedContextEntities.up(db)

    expect(
      getRows<{ context_id: string; enabled: number; updated_at: string }>(
        db,
        `SELECT context_id, enabled, updated_at FROM plugin_context_state`,
      ),
    ).toEqual([{ context_id: parentContextId, enabled: 1, updated_at: '2026-05-02T00:00:00Z' }])
  })

  test('promotes newest colliding plugin kv row when no parent row exists', () => {
    db.run(`INSERT INTO plugin_kv VALUES ('hello-world', ?, 'token', 'older', 'created-1', '2026-05-01T00:00:00Z')`, [
      threadContextId,
    ])
    db.run(
      `INSERT INTO plugin_kv VALUES ('hello-world', ?, 'token', 'newer-low-rowid', 'created-2', '2026-05-02T00:00:00Z')`,
      [secondThreadContextId],
    )
    db.run(
      `INSERT INTO plugin_kv VALUES ('hello-world', ?, 'token', 'newer-high-rowid', 'created-3', '2026-05-02T00:00:00Z')`,
      [thirdThreadContextId],
    )

    migration046ParentSharedContextEntities.up(db)

    expect(
      getRows<{ context_id: string; key: string; value: string; updated_at: string }>(
        db,
        `SELECT context_id, key, value, updated_at FROM plugin_kv`,
      ),
    ).toEqual([
      {
        context_id: parentContextId,
        key: 'token',
        value: 'newer-low-rowid',
        updated_at: '2026-05-02T00:00:00Z',
      },
    ])
  })

  test('leaves isolated tables unchanged', () => {
    db.run(`INSERT INTO memory_facts VALUES (?, 'fact-1', 'thread fact')`, [threadContextId])
    db.run(`INSERT INTO memory_summary VALUES (?, 'summary', 'now')`, [threadContextId])
    db.run(`INSERT INTO conversation_history VALUES (?, '[]')`, [threadContextId])
    db.run(`INSERT INTO attachments VALUES ('attachment-1', ?, 'a.txt')`, [threadContextId])
    db.run(`INSERT INTO staged_files VALUES ('staged-1', ?, 'b.txt')`, [threadContextId])
    db.run(`INSERT INTO message_metadata VALUES (?, 'message-1', 123)`, [threadContextId])
    db.run(`INSERT INTO llm_usage_events VALUES ('llm-1', ?, 'model')`, [threadContextId])
    db.run(`INSERT INTO tool_call_events VALUES ('tool-1', ?, 'create_task')`, [threadContextId])

    migration046ParentSharedContextEntities.up(db)

    expect(getRows<{ user_id: string; identifier: string; title: string }>(db, `SELECT * FROM memory_facts`)).toEqual([
      { user_id: threadContextId, identifier: 'fact-1', title: 'thread fact' },
    ])
    expect(getRows<{ user_id: string }>(db, `SELECT user_id FROM memory_summary`)).toEqual([
      { user_id: threadContextId },
    ])
    expect(getRows<{ user_id: string }>(db, `SELECT user_id FROM conversation_history`)).toEqual([
      { user_id: threadContextId },
    ])
    expect(getRows<{ context_id: string }>(db, `SELECT context_id FROM attachments`)).toEqual([
      { context_id: threadContextId },
    ])
    expect(getRows<{ context_id: string }>(db, `SELECT context_id FROM staged_files`)).toEqual([
      { context_id: threadContextId },
    ])
    expect(getRows<{ context_id: string }>(db, `SELECT context_id FROM message_metadata`)).toEqual([
      { context_id: threadContextId },
    ])
    expect(getRows<{ storage_context_id: string }>(db, `SELECT storage_context_id FROM llm_usage_events`)).toEqual([
      { storage_context_id: threadContextId },
    ])
    expect(getRows<{ storage_context_id: string }>(db, `SELECT storage_context_id FROM tool_call_events`)).toEqual([
      { storage_context_id: threadContextId },
    ])
  })

  test('skips absent optional tables and columns', () => {
    const partialDb = new Database(':memory:')
    partialDb.run(`CREATE TABLE memos (id TEXT PRIMARY KEY, content TEXT NOT NULL)`)

    expect(() => migration046ParentSharedContextEntities.up(partialDb)).not.toThrow()

    partialDb.close()
  })
})

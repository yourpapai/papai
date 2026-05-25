// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { migration043ScopedContextIds } from '../../../src/db/migrations/043_scoped_context_ids.js'

describe('migration043ScopedContextIds', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys=OFF')
    db.run(
      `CREATE TABLE platform_instances (id TEXT PRIMARY KEY, type TEXT NOT NULL, config TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)`,
    )
    db.run(
      `CREATE TABLE context_settings (context_id TEXT PRIMARY KEY, task_instance_id TEXT NOT NULL, platform_instance_id TEXT NOT NULL)`,
    )
    db.run(
      `CREATE TABLE user_config (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key))`,
    )
    db.run(`CREATE TABLE conversation_history (user_id TEXT PRIMARY KEY, messages TEXT NOT NULL)`)
    db.run(`CREATE TABLE memory_summary (user_id TEXT PRIMARY KEY, summary TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(
      `CREATE TABLE memory_facts (user_id TEXT NOT NULL, identifier TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', last_seen TEXT NOT NULL, PRIMARY KEY (user_id, identifier))`,
    )
    db.run(`CREATE TABLE authorized_groups (group_id TEXT PRIMARY KEY, added_by TEXT NOT NULL, added_at TEXT NOT NULL)`)
    db.run(
      `CREATE TABLE group_members (group_id TEXT NOT NULL, user_id TEXT NOT NULL, added_by TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (group_id, user_id))`,
    )
    db.run(
      `CREATE TABLE recurring_tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, title TEXT NOT NULL)`,
    )
    db.run(
      `CREATE TABLE scheduled_prompts (id TEXT PRIMARY KEY, created_by_user_id TEXT NOT NULL, delivery_context_id TEXT, prompt TEXT NOT NULL)`,
    )
    db.run(
      `CREATE TABLE alert_prompts (id TEXT PRIMARY KEY, created_by_user_id TEXT NOT NULL, delivery_context_id TEXT, prompt TEXT NOT NULL)`,
    )
    db.run(
      `CREATE TABLE task_snapshots (user_id TEXT NOT NULL, task_id TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, task_id, field))`,
    )
    db.run(
      `CREATE TABLE message_metadata (context_id TEXT NOT NULL, message_id TEXT NOT NULL, author_id TEXT, author_username TEXT, text TEXT, reply_to_message_id TEXT, timestamp INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (context_id, message_id))`,
    )
    db.run(
      `CREATE TABLE user_instructions (id TEXT PRIMARY KEY, context_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL)`,
    )
    db.run(
      `CREATE TABLE memos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL, summary TEXT, tags TEXT NOT NULL DEFAULT '[]', embedding BLOB, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    )
    db.run(
      `CREATE TABLE user_identity_mappings (context_id TEXT NOT NULL, provider_name TEXT NOT NULL, provider_user_id TEXT, provider_user_login TEXT, display_name TEXT, matched_at TEXT NOT NULL, match_method TEXT, confidence INTEGER, PRIMARY KEY (context_id, provider_name))`,
    )
    db.run(
      `CREATE TABLE known_group_contexts (provider TEXT NOT NULL, context_id TEXT NOT NULL, display_name TEXT NOT NULL, parent_name TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, PRIMARY KEY (provider, context_id))`,
    )
    db.run(
      `CREATE TABLE group_admin_observations (provider TEXT NOT NULL, context_id TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT, is_admin INTEGER NOT NULL, last_seen_at TEXT NOT NULL, PRIMARY KEY (provider, context_id, user_id))`,
    )
    db.run(
      `CREATE TABLE group_user_observations (provider TEXT NOT NULL, context_id TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT, display_label TEXT NOT NULL, last_seen_at TEXT NOT NULL, PRIMARY KEY (provider, context_id, user_id))`,
    )
    db.run(
      `CREATE TABLE attachments (attachment_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, source_provider TEXT NOT NULL, source_message_id TEXT, source_file_id TEXT, filename TEXT NOT NULL, mime_type TEXT, size INTEGER, checksum TEXT NOT NULL, blob_key TEXT NOT NULL, status TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, cleared_at TEXT, last_used_at TEXT)`,
    )
    db.run(
      `CREATE TABLE staged_files (staged_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, message_id TEXT, sender_id TEXT NOT NULL, sender_username TEXT, filename TEXT NOT NULL, mime_type TEXT, size INTEGER, platform_file_id TEXT NOT NULL, source_provider TEXT NOT NULL, status TEXT NOT NULL, attachment_id TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
    )
    db.run(
      `CREATE TABLE llm_usage_events (event_id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL, turn_id TEXT, storage_context_id TEXT NOT NULL, context_type TEXT NOT NULL, chat_user_id TEXT NOT NULL, model TEXT NOT NULL, model_role TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, step_count INTEGER NOT NULL DEFAULT 0, tool_call_count INTEGER NOT NULL DEFAULT 0, message_count INTEGER NOT NULL DEFAULT 0, finish_reason TEXT, duration_ms INTEGER NOT NULL, response_id TEXT, error TEXT, forwarded_at INTEGER, forward_attempts INTEGER NOT NULL DEFAULT 0, forward_error TEXT)`,
    )
    db.run(
      `CREATE TABLE tool_call_events (event_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL, occurred_at INTEGER NOT NULL, storage_context_id TEXT NOT NULL, context_type TEXT NOT NULL, chat_user_id TEXT NOT NULL, model TEXT NOT NULL, model_role TEXT NOT NULL, tool_name TEXT NOT NULL, tool_call_id TEXT NOT NULL, success INTEGER NOT NULL, duration_ms INTEGER, error_type TEXT, error_code TEXT, retryable INTEGER, recovered INTEGER, args_bytes INTEGER, result_bytes INTEGER, response_id TEXT, forwarded_at INTEGER, forward_attempts INTEGER NOT NULL DEFAULT 0, forward_error TEXT)`,
    )
    db.run(
      `CREATE TABLE users (platform_user_id TEXT NOT NULL, platform_instance_id TEXT NOT NULL, username TEXT, added_at TEXT NOT NULL, added_by TEXT NOT NULL, PRIMARY KEY (platform_instance_id, platform_user_id))`,
    )
  })

  afterEach(() => db.close())

  test('scopes legacy context rows when one platform instance exists', () => {
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
    db.run(`INSERT INTO context_settings VALUES ('user-1', 'task-1', 'telegram-default')`)
    db.run(`INSERT INTO user_config VALUES ('user-1', 'timezone', 'UTC')`)
    db.run(`INSERT INTO authorized_groups VALUES ('group-1', 'admin', 'now')`)
    db.run(`INSERT INTO group_members VALUES ('group-1', 'user-1', 'admin', 'now')`)

    migration043ScopedContextIds.up(db)

    const scopedUser = 'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:dXNlci0x'
    const scopedGroup = 'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:Z3JvdXAtMQ'
    expect(db.query('SELECT context_id FROM context_settings').get()).toEqual({ context_id: scopedUser })
    expect(db.query('SELECT user_id FROM user_config').get()).toEqual({ user_id: scopedUser })
    expect(db.query('SELECT group_id FROM authorized_groups').get()).toEqual({ group_id: scopedGroup })
    expect(db.query('SELECT group_id FROM group_members').get()).toEqual({ group_id: scopedGroup })
  })

  test('scopes legacy native ids that start with pi but are not scoped ids', () => {
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
    db.run(`INSERT INTO user_config VALUES ('pi:native-user', 'timezone', 'UTC')`)

    migration043ScopedContextIds.up(db)

    expect(db.query('SELECT user_id FROM user_config').get()).toEqual({
      user_id: toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'pi:native-user' }),
    })
  })

  test('handles raw and scoped duplicates in unique context-owned tables idempotently', () => {
    const scopedUser = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'user-1' })
    const scopedGroup = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-1' })
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
    db.run(`INSERT INTO context_settings VALUES ('user-1', 'task-raw', 'telegram-default')`)
    db.run(`INSERT INTO context_settings VALUES (?, 'task-scoped', 'telegram-default')`, [scopedUser])
    db.run(`INSERT INTO user_config VALUES ('user-1', 'timezone', 'UTC')`)
    db.run(`INSERT INTO user_config VALUES (?, 'timezone', 'Europe/Berlin')`, [scopedUser])
    db.run(`INSERT INTO memory_facts VALUES ('user-1', 'fact-1', 'raw', '', 'now')`)
    db.run(`INSERT INTO memory_facts VALUES (?, 'fact-1', 'scoped', '', 'now')`, [scopedUser])
    db.run(`INSERT INTO group_members VALUES ('group-1', 'user-1', 'admin', 'now')`)
    db.run(`INSERT INTO group_members VALUES (?, 'user-1', 'admin', 'now')`, [scopedGroup])
    db.run(`INSERT INTO task_snapshots VALUES ('user-1', 'task-1', 'title', 'raw')`)
    db.run(`INSERT INTO task_snapshots VALUES (?, 'task-1', 'title', 'scoped')`, [scopedUser])

    migration043ScopedContextIds.up(db)
    migration043ScopedContextIds.up(db)

    expect(db.query(`SELECT task_instance_id FROM context_settings WHERE context_id = ?`).get(scopedUser)).toEqual({
      task_instance_id: 'task-scoped',
    })
    expect(db.query(`SELECT COUNT(*) AS count FROM user_config WHERE user_id = 'user-1'`).get()).toEqual({ count: 0 })
    expect(
      db.query(`SELECT title FROM memory_facts WHERE user_id = ? AND identifier = 'fact-1'`).get(scopedUser),
    ).toEqual({
      title: 'scoped',
    })
    expect(db.query(`SELECT COUNT(*) AS count FROM group_members WHERE group_id = 'group-1'`).get()).toEqual({
      count: 0,
    })
    expect(
      db.query(`SELECT value FROM task_snapshots WHERE user_id = ? AND task_id = 'task-1'`).get(scopedUser),
    ).toEqual({
      value: 'scoped',
    })
  })

  test('scopes additional context-owned tables without touching plugin tables', () => {
    const scopedUser = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'user-1' })
    const scopedGroup = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-1' })
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
    db.run(`INSERT INTO user_instructions VALUES ('ins-1', 'user-1', 'be brief', 'now')`)
    db.run(`INSERT INTO memos VALUES ('memo-1', 'user-1', 'memo', NULL, '[]', NULL, 'active', 'now', 'now')`)
    db.run(`INSERT INTO user_identity_mappings VALUES ('user-1', 'kaneo', 'ku1', NULL, NULL, 'now', NULL, NULL)`)
    db.run(`INSERT INTO known_group_contexts VALUES ('telegram', 'group-1', 'Group 1', NULL, 'now', 'now')`)
    db.run(`INSERT INTO group_admin_observations VALUES ('telegram', 'group-1', 'user-1', 'alice', 1, 'now')`)
    db.run(`INSERT INTO group_user_observations VALUES ('telegram', 'group-1', 'user-1', 'alice', 'Alice', 'now')`)
    db.run(`INSERT INTO group_user_observations VALUES ('mattermost', 'group-1', 'user-2', 'bob', 'Bob', 'now')`)
    db.run(`INSERT INTO message_metadata VALUES ('group-1', 'msg-1', 'user-1', 'alice', 'hello', NULL, 1, 2)`)
    db.run(
      `INSERT INTO attachments VALUES ('att-1', 'user-1', 'telegram', 'msg-1', 'file-1', 'a.txt', NULL, NULL, 'sum', 'blob', 'active', 1, 'now', NULL, NULL)`,
    )
    db.run(
      `INSERT INTO staged_files VALUES ('stg-1', 'user-1', 'msg-1', 'user-1', 'alice', 'a.txt', NULL, NULL, 'file-1', 'telegram', 'staged', NULL, 'now', 'later')`,
    )
    db.run(
      `INSERT INTO llm_usage_events (event_id, occurred_at, storage_context_id, context_type, chat_user_id, model, model_role, duration_ms) VALUES ('llm-1', 1, 'user-1', 'dm', 'user-1', 'model', 'main', 100)`,
    )
    db.run(
      `INSERT INTO tool_call_events (event_id, turn_id, occurred_at, storage_context_id, context_type, chat_user_id, model, model_role, tool_name, tool_call_id, success) VALUES ('tool-1', 'turn-1', 1, 'user-1', 'dm', 'user-1', 'model', 'main', 'create_task', 'call-1', 1)`,
    )
    db.run(
      `CREATE TABLE plugin_context_state (plugin_id TEXT NOT NULL, context_id TEXT NOT NULL, enabled INTEGER NOT NULL)`,
    )
    db.run(`INSERT INTO plugin_context_state VALUES ('hello-world', 'user-1', 1)`)

    migration043ScopedContextIds.up(db)

    expect(db.query(`SELECT context_id FROM user_instructions`).get()).toEqual({ context_id: scopedUser })
    expect(db.query(`SELECT user_id FROM memos`).get()).toEqual({ user_id: scopedUser })
    expect(db.query(`SELECT context_id FROM user_identity_mappings`).get()).toEqual({ context_id: scopedUser })
    expect(db.query(`SELECT context_id FROM known_group_contexts`).get()).toEqual({ context_id: scopedGroup })
    expect(db.query(`SELECT context_id FROM group_admin_observations`).get()).toEqual({ context_id: scopedGroup })
    expect(db.query(`SELECT provider, context_id FROM group_user_observations ORDER BY provider`).all()).toEqual([
      { provider: 'mattermost', context_id: scopedGroup },
      { provider: 'telegram', context_id: scopedGroup },
    ])
    expect(db.query(`SELECT context_id FROM message_metadata`).get()).toEqual({ context_id: scopedGroup })
    expect(db.query(`SELECT context_id FROM attachments`).get()).toEqual({ context_id: scopedUser })
    expect(db.query(`SELECT context_id FROM staged_files`).get()).toEqual({ context_id: scopedUser })
    expect(db.query(`SELECT storage_context_id FROM llm_usage_events`).get()).toEqual({
      storage_context_id: scopedUser,
    })
    expect(db.query(`SELECT storage_context_id FROM tool_call_events`).get()).toEqual({
      storage_context_id: scopedUser,
    })
    expect(db.query(`SELECT context_id FROM plugin_context_state`).get()).toEqual({ context_id: 'user-1' })
  })

  test('preserves ambiguous legacy rows when multiple platform instances exist', () => {
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
    db.run(`INSERT INTO platform_instances VALUES ('discord-default', 'discord', '{}', 'active', 'now')`)
    db.run(`INSERT INTO user_config VALUES ('user-1', 'timezone', 'UTC')`)

    migration043ScopedContextIds.up(db)

    expect(db.query('SELECT user_id FROM user_config').get()).toEqual({ user_id: 'user-1' })
  })

  test('adds staged source platform column with empty fallback', () => {
    migration043ScopedContextIds.up(db)

    const columns = db
      .query<{ name: string }, []>('PRAGMA table_info(staged_files)')
      .all()
      .map((row) => row.name)
    expect(columns).toContain('source_platform_instance_id')
    expect(db.query(`SELECT source_platform_instance_id FROM staged_files`).all()).toEqual([])
  })

  test('deduplicates usernames before adding unique index', () => {
    db.run(`INSERT INTO users VALUES ('placeholder-old', 'telegram-default', 'alice', '2026-01-01', 'admin')`)
    db.run(`INSERT INTO users VALUES ('real-user', 'telegram-default', 'alice', '2026-02-01', 'admin')`)
    db.run(`INSERT INTO users VALUES ('other-instance', 'discord-default', 'alice', '2026-01-01', 'admin')`)

    migration043ScopedContextIds.up(db)

    expect(
      db
        .query(
          `SELECT platform_user_id FROM users WHERE platform_instance_id = 'telegram-default' AND username = 'alice'`,
        )
        .all(),
    ).toEqual([{ platform_user_id: 'real-user' }])
    expect(() =>
      db.run(`INSERT INTO users VALUES ('another-user', 'telegram-default', 'alice', '2026-03-01', 'admin')`),
    ).toThrow()
  })

  test('preserves duplicate real username rows by clearing username on deterministic non-keepers', () => {
    db.run(`INSERT INTO users VALUES ('real-a', 'telegram-default', 'alice', '2026-01-01', 'admin')`)
    db.run(`INSERT INTO users VALUES ('real-b', 'telegram-default', 'alice', '2026-02-01', 'admin')`)

    migration043ScopedContextIds.up(db)

    expect(db.query(`SELECT platform_user_id, username FROM users ORDER BY platform_user_id`).all()).toEqual([
      { platform_user_id: 'real-a', username: 'alice' },
      { platform_user_id: 'real-b', username: null },
    ])
  })

  test('deletes newer placeholder-only duplicate username rows', () => {
    db.run(`INSERT INTO users VALUES ('placeholder-b', 'telegram-default', 'alice', '2026-02-01', 'admin')`)
    db.run(`INSERT INTO users VALUES ('placeholder-a', 'telegram-default', 'alice', '2026-01-01', 'admin')`)

    migration043ScopedContextIds.up(db)

    expect(db.query(`SELECT platform_user_id, username FROM users`).all()).toEqual([
      { platform_user_id: 'placeholder-a', username: 'alice' },
    ])
  })

  test('does not mutate plugin tables', () => {
    db.run(
      `CREATE TABLE plugin_context_state (plugin_id TEXT NOT NULL, context_id TEXT NOT NULL, enabled INTEGER NOT NULL)`,
    )
    db.run(`INSERT INTO plugin_context_state VALUES ('hello-world', 'user-1', 1)`)
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)

    migration043ScopedContextIds.up(db)

    expect(db.query(`SELECT context_id FROM plugin_context_state`).get()).toEqual({ context_id: 'user-1' })
  })
})

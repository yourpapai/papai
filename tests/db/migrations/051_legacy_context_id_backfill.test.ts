// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { migration051LegacyContextIdBackfill } from '../../../src/db/migrations/051_legacy_context_id_backfill.js'
import { mockLogger } from '../../utils/test-helpers.js'

const tableExists = (db: Database, table: string): boolean =>
  db
    .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) !== null

const createAllContextOwnedTables = (db: Database): void => {
  db.run(
    `CREATE TABLE platform_instances (id TEXT PRIMARY KEY, type TEXT NOT NULL, config TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
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
    `CREATE TABLE plugin_context_state (plugin_id TEXT NOT NULL, context_id TEXT NOT NULL, enabled INTEGER NOT NULL, PRIMARY KEY (plugin_id, context_id))`,
  )
  db.run(
    `CREATE TABLE plugin_kv (plugin_id TEXT NOT NULL, context_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (plugin_id, context_id, key))`,
  )
  db.run(
    `CREATE TABLE web_rate_limit (actor_id TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (actor_id, window_start))`,
  )
}

describe('migration051LegacyContextIdBackfill', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys=OFF')
    createAllContextOwnedTables(db)
  })

  afterEach(() => {
    db.close()
  })

  test('migration id is 051_legacy_context_id_backfill', () => {
    expect(migration051LegacyContextIdBackfill.id).toBe('051_legacy_context_id_backfill')
  })

  test('scopes user_config rows that were left raw by migration 043', () => {
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
    db.run(`INSERT INTO user_config VALUES ('125996647', 'plugin:task-provider-kaneo:provider:credential', 'cred-1')`)
    db.run(`INSERT INTO user_config VALUES ('125996647', 'plugin:task-provider-kaneo:provider:workspaceId', 'ws-1')`)
    db.run(`INSERT INTO user_config VALUES ('125996647', 'timezone', 'Etc/GMT-5')`)

    migration051LegacyContextIdBackfill.up(db)

    const scopedUser = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: '125996647' })
    expect(db.query(`SELECT key, value FROM user_config WHERE user_id = ? ORDER BY key`).all(scopedUser)).toEqual([
      { key: 'plugin:task-provider-kaneo:provider:credential', value: 'cred-1' },
      { key: 'plugin:task-provider-kaneo:provider:workspaceId', value: 'ws-1' },
      { key: 'timezone', value: 'Etc/GMT-5' },
    ])
    expect(db.query(`SELECT COUNT(*) AS count FROM user_config WHERE user_id = '125996647'`).get()).toEqual({
      count: 0,
    })
  })

  test('scopes plugin_context_state rows left raw by migration 043', () => {
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
    db.run(`INSERT INTO plugin_context_state VALUES ('task-provider-kaneo', '125996647', 1)`)
    db.run(`INSERT INTO plugin_context_state VALUES ('task-provider-kaneo', '-1003555943365', 1)`)

    migration051LegacyContextIdBackfill.up(db)

    const scopedUser = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: '125996647' })
    const scopedGroup = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: '-1003555943365' })
    expect(
      db.query(`SELECT plugin_id, context_id, enabled FROM plugin_context_state ORDER BY context_id`).all(),
    ).toEqual([
      { plugin_id: 'task-provider-kaneo', context_id: scopedGroup, enabled: 1 },
      { plugin_id: 'task-provider-kaneo', context_id: scopedUser, enabled: 1 },
    ])
  })

  test('scopes plugin_kv rows left raw by migration 043', () => {
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
    db.run(`INSERT INTO plugin_kv VALUES ('task-provider-kaneo', '125996647', 'token', 'v', 'now', 'now')`)

    migration051LegacyContextIdBackfill.up(db)

    const scopedUser = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: '125996647' })
    expect(db.query(`SELECT context_id, value FROM plugin_kv`).get()).toEqual({
      context_id: scopedUser,
      value: 'v',
    })
  })

  test('scopes every other context-owned table on the production-shaped DB', () => {
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
    db.run(`INSERT INTO user_config VALUES ('125996647', 'timezone', 'UTC')`)
    db.run(`INSERT INTO conversation_history VALUES ('125996647', '[]')`)
    db.run(`INSERT INTO memory_summary VALUES ('125996647', 's', 'now')`)
    db.run(`INSERT INTO memory_facts VALUES ('125996647', 'fact-1', 't', '', 'now')`)
    db.run(`INSERT INTO authorized_groups VALUES ('-1003555943365', 'admin', 'now')`)
    db.run(`INSERT INTO group_members VALUES ('-1003555943365', '125996647', 'admin', 'now')`)
    db.run(`INSERT INTO recurring_tasks VALUES ('rec-1', '125996647', 'proj-1', 'title')`)
    db.run(`INSERT INTO scheduled_prompts VALUES ('sp-1', '125996647', '125996647', 'p')`)
    db.run(`INSERT INTO alert_prompts VALUES ('ap-1', '125996647', '125996647', 'p')`)
    db.run(`INSERT INTO task_snapshots VALUES ('125996647', 'task-1', 'title', 'v')`)
    db.run(`INSERT INTO message_metadata VALUES ('125996647', 'msg-1', NULL, NULL, NULL, NULL, 1, 2)`)
    db.run(`INSERT INTO user_instructions VALUES ('ins-1', '125996647', 'be brief', 'now')`)
    db.run(`INSERT INTO memos VALUES ('memo-1', '125996647', 'm', NULL, '[]', NULL, 'active', 'now', 'now')`)
    db.run(`INSERT INTO user_identity_mappings VALUES ('125996647', 'kaneo', 'ku1', NULL, NULL, 'now', NULL, NULL)`)
    db.run(`INSERT INTO known_group_contexts VALUES ('telegram', '-1003555943365', 'G', NULL, 'now', 'now')`)
    db.run(`INSERT INTO group_admin_observations VALUES ('telegram', '-1003555943365', '125996647', 'u', 1, 'now')`)
    db.run(`INSERT INTO group_user_observations VALUES ('telegram', '-1003555943365', '125996647', 'u', 'U', 'now')`)
    db.run(
      `INSERT INTO attachments VALUES ('att-1', '125996647', 'telegram', 'msg-1', 'file-1', 'a.txt', NULL, NULL, 's', 'b', 'active', 1, 'now', NULL, NULL)`,
    )
    db.run(
      `INSERT INTO staged_files VALUES ('stg-1', '125996647', 'msg-1', '125996647', 'u', 'a.txt', NULL, NULL, 'file-1', 'telegram', 'staged', NULL, 'now', 'later')`,
    )
    db.run(
      `INSERT INTO llm_usage_events (event_id, occurred_at, storage_context_id, context_type, chat_user_id, model, model_role, duration_ms) VALUES ('llm-1', 1, '125996647', 'dm', '125996647', 'm', 'main', 100)`,
    )
    db.run(
      `INSERT INTO tool_call_events (event_id, turn_id, occurred_at, storage_context_id, context_type, chat_user_id, model, model_role, tool_name, tool_call_id, success) VALUES ('tool-1', 'turn-1', 1, '125996647', 'dm', '125996647', 'm', 'main', 'create_task', 'call-1', 1)`,
    )
    db.run(`INSERT INTO web_rate_limit VALUES ('125996647', 123, 1)`)

    migration051LegacyContextIdBackfill.up(db)

    const scopedUser = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: '125996647' })
    const scopedGroup = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: '-1003555943365' })
    expect(db.query(`SELECT user_id FROM user_config`).get()).toEqual({ user_id: scopedUser })
    expect(db.query(`SELECT user_id FROM conversation_history`).get()).toEqual({ user_id: scopedUser })
    expect(db.query(`SELECT user_id FROM memory_summary`).get()).toEqual({ user_id: scopedUser })
    expect(db.query(`SELECT user_id FROM memory_facts`).get()).toEqual({ user_id: scopedUser })
    expect(db.query(`SELECT group_id FROM authorized_groups`).get()).toEqual({ group_id: scopedGroup })
    expect(db.query(`SELECT group_id FROM group_members`).get()).toEqual({ group_id: scopedGroup })
    expect(db.query(`SELECT user_id FROM recurring_tasks`).get()).toEqual({ user_id: scopedUser })
    expect(db.query(`SELECT created_by_user_id FROM scheduled_prompts`).get()).toEqual({
      created_by_user_id: scopedUser,
    })
    expect(db.query(`SELECT delivery_context_id FROM scheduled_prompts`).get()).toEqual({
      delivery_context_id: scopedUser,
    })
    expect(db.query(`SELECT created_by_user_id FROM alert_prompts`).get()).toEqual({
      created_by_user_id: scopedUser,
    })
    expect(db.query(`SELECT delivery_context_id FROM alert_prompts`).get()).toEqual({
      delivery_context_id: scopedUser,
    })
    expect(db.query(`SELECT user_id FROM task_snapshots`).get()).toEqual({ user_id: scopedUser })
    expect(db.query(`SELECT context_id FROM message_metadata`).get()).toEqual({ context_id: scopedUser })
    expect(db.query(`SELECT context_id FROM user_instructions`).get()).toEqual({ context_id: scopedUser })
    expect(db.query(`SELECT user_id FROM memos`).get()).toEqual({ user_id: scopedUser })
    expect(db.query(`SELECT context_id FROM user_identity_mappings`).get()).toEqual({ context_id: scopedUser })
    expect(db.query(`SELECT context_id FROM known_group_contexts`).get()).toEqual({ context_id: scopedGroup })
    expect(db.query(`SELECT context_id FROM group_admin_observations`).get()).toEqual({ context_id: scopedGroup })
    expect(db.query(`SELECT context_id FROM group_user_observations`).get()).toEqual({ context_id: scopedGroup })
    expect(db.query(`SELECT context_id FROM attachments`).get()).toEqual({ context_id: scopedUser })
    expect(db.query(`SELECT context_id FROM staged_files`).get()).toEqual({ context_id: scopedUser })
    expect(db.query(`SELECT storage_context_id FROM llm_usage_events`).get()).toEqual({
      storage_context_id: scopedUser,
    })
    expect(db.query(`SELECT storage_context_id FROM tool_call_events`).get()).toEqual({
      storage_context_id: scopedUser,
    })
    expect(db.query(`SELECT actor_id FROM web_rate_limit`).get()).toEqual({ actor_id: scopedUser })
  })

  test('is a no-op when platform_instances is empty', () => {
    db.run(`INSERT INTO user_config VALUES ('125996647', 'timezone', 'UTC')`)
    db.run(`INSERT INTO plugin_context_state VALUES ('task-provider-kaneo', '125996647', 1)`)

    migration051LegacyContextIdBackfill.up(db)

    expect(db.query(`SELECT user_id FROM user_config`).get()).toEqual({ user_id: '125996647' })
    expect(db.query(`SELECT context_id FROM plugin_context_state`).get()).toEqual({
      context_id: '125996647',
    })
  })

  test('is a no-op when there are multiple active platform instances (ambiguous ownership)', () => {
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
    db.run(`INSERT INTO platform_instances VALUES ('discord-default', 'discord', '{}', 'active', 'now')`)
    db.run(`INSERT INTO user_config VALUES ('125996647', 'timezone', 'UTC')`)

    migration051LegacyContextIdBackfill.up(db)

    expect(db.query(`SELECT user_id FROM user_config`).get()).toEqual({ user_id: '125996647' })
  })

  test('is idempotent: scoped rows are not double-scoped on a second run', () => {
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
    db.run(`INSERT INTO user_config VALUES ('125996647', 'timezone', 'UTC')`)

    migration051LegacyContextIdBackfill.up(db)
    migration051LegacyContextIdBackfill.up(db)

    const scopedUser = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: '125996647' })
    expect(db.query(`SELECT user_id FROM user_config`).get()).toEqual({ user_id: scopedUser })
    expect(db.query(`SELECT COUNT(*) AS count FROM user_config`).get()).toEqual({ count: 1 })
  })

  test('preserves already-scoped rows unchanged', () => {
    const scopedUser = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: '125996647' })
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
    db.run(`INSERT INTO user_config VALUES (?, 'plugin:task-provider-kaneo:provider:credential', 'cred-1')`, [
      scopedUser,
    ])

    migration051LegacyContextIdBackfill.up(db)

    expect(db.query(`SELECT user_id, key, value FROM user_config`).get()).toEqual({
      user_id: scopedUser,
      key: 'plugin:task-provider-kaneo:provider:credential',
      value: 'cred-1',
    })
  })

  test('leaves context_settings empty: the migration only scopes ids, it does not assign task instances', () => {
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)
    db.run(`INSERT INTO user_config VALUES ('125996647', 'plugin:task-provider-kaneo:provider:credential', 'c')`)
    db.run(`INSERT INTO user_config VALUES ('125996647', 'plugin:task-provider-kaneo:provider:workspaceId', 'w')`)

    migration051LegacyContextIdBackfill.up(db)

    expect(db.query(`SELECT COUNT(*) AS count FROM context_settings`).get()).toEqual({ count: 0 })
  })

  test('no-ops when context-owned tables do not exist yet', () => {
    db.run(`DROP TABLE user_config`)
    db.run(`DROP TABLE plugin_context_state`)
    db.run(`INSERT INTO platform_instances VALUES ('telegram-default', 'telegram', '{}', 'active', 'now')`)

    migration051LegacyContextIdBackfill.up(db)

    expect(tableExists(db, 'user_config')).toBe(false)
    expect(tableExists(db, 'plugin_context_state')).toBe(false)
  })
})

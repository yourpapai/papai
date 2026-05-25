// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

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
      `CREATE TABLE staged_files (staged_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, message_id TEXT, sender_id TEXT NOT NULL, sender_username TEXT, filename TEXT NOT NULL, mime_type TEXT, size INTEGER, platform_file_id TEXT NOT NULL, source_provider TEXT NOT NULL, status TEXT NOT NULL, attachment_id TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
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

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const migrateUsersTable = (db: Database): void => {
  db.run(`CREATE TABLE users_new (
    platform_user_id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    added_by TEXT NOT NULL,
    kaneo_workspace_id TEXT
  )`)
  db.run(`INSERT INTO users_new (platform_user_id, username, added_at, added_by, kaneo_workspace_id)
    SELECT CAST(telegram_id AS TEXT), username, added_at, CAST(added_by AS TEXT), kaneo_workspace_id
    FROM users`)
  db.run('DROP TABLE users')
  db.run('ALTER TABLE users_new RENAME TO users')
}

const migrateUserConfigTable = (db: Database): void => {
  db.run(`CREATE TABLE user_config_new (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  )`)
  db.run(`INSERT INTO user_config_new (user_id, key, value)
    SELECT CAST(user_id AS TEXT), key, value FROM user_config`)
  db.run('DROP TABLE user_config')
  db.run('ALTER TABLE user_config_new RENAME TO user_config')
  db.run('CREATE INDEX IF NOT EXISTS idx_user_config_user_id ON user_config(user_id)')
}

const migrateConversationHistoryTable = (db: Database): void => {
  db.run(`CREATE TABLE conversation_history_new (
    user_id TEXT PRIMARY KEY,
    messages TEXT NOT NULL
  )`)
  db.run(`INSERT INTO conversation_history_new (user_id, messages)
    SELECT CAST(user_id AS TEXT), messages FROM conversation_history`)
  db.run('DROP TABLE conversation_history')
  db.run('ALTER TABLE conversation_history_new RENAME TO conversation_history')
}

const migrateMemoryTables = (db: Database): void => {
  db.run(`CREATE TABLE memory_summary_new (
    user_id TEXT PRIMARY KEY,
    summary TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
  db.run(`INSERT INTO memory_summary_new (user_id, summary, updated_at)
    SELECT CAST(user_id AS TEXT), summary, updated_at FROM memory_summary`)
  db.run('DROP TABLE memory_summary')
  db.run('ALTER TABLE memory_summary_new RENAME TO memory_summary')

  db.run(`CREATE TABLE memory_facts_new (
    user_id TEXT NOT NULL,
    identifier TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    last_seen TEXT NOT NULL,
    PRIMARY KEY (user_id, identifier)
  )`)
  db.run(`INSERT INTO memory_facts_new (user_id, identifier, title, url, last_seen)
    SELECT CAST(user_id AS TEXT), identifier, title, url, last_seen FROM memory_facts`)
  db.run('DROP TABLE memory_facts')
  db.run('ALTER TABLE memory_facts_new RENAME TO memory_facts')
  db.run('CREATE INDEX IF NOT EXISTS idx_memory_facts_user_lastseen ON memory_facts(user_id, last_seen DESC)')
}

export const migration007PlatformUserId: Migration = {
  id: '007_platform_user_id',
  up(db: Database): void {
    migrateUsersTable(db)
    migrateUserConfigTable(db)
    migrateConversationHistoryTable(db)
    migrateMemoryTables(db)
  },
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../src/db/index.js'
import type { Migration } from '../../src/db/migrate.js'
import { migration041UsersPlatformInstanceIndex } from '../../src/db/migrations/041_users_platform_instance_index.js'
import { mockLogger } from '../utils/test-helpers.js'

const KANEO_WORKSPACE_CONFIG_KEY = 'kaneo_workspace_id'

const requireDefined = <T>(value: T | null | undefined): T => {
  if (value === undefined || value === null) throw new Error('expected value to be defined')
  return value
}

const createPre041UsersTable = (db: Database): void => {
  db.run(`
    CREATE TABLE users (
      platform_user_id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      added_by TEXT NOT NULL,
      kaneo_workspace_id TEXT,
      platform_instance_id TEXT
    )
  `)
}

const createPlatformInstancesTable = (db: Database): void => {
  db.run(`
    CREATE TABLE platform_instances (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

const createUserConfigTable = (db: Database): void => {
  db.run(`
    CREATE TABLE user_config (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    )
  `)
}

const getMigration = (id: string): Migration => requireDefined(MIGRATIONS.find((migration) => migration.id === id))

const getUsers = (
  db: Database,
): Array<{ platform_user_id: string; platform_instance_id: string; username: string | null }> =>
  db
    .query<{ platform_user_id: string; platform_instance_id: string; username: string | null }, []>(
      `SELECT platform_user_id, platform_instance_id, username FROM users ORDER BY platform_instance_id, platform_user_id`,
    )
    .all()

describe('migration 041 users platform scoping', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    createPre041UsersTable(db)
    createPlatformInstancesTable(db)
  })

  afterEach(() => {
    db.close()
  })

  test('backfills unscoped legacy users when exactly one active platform exists', () => {
    db.run(
      `INSERT INTO platform_instances (id, type, config, status) VALUES ('telegram-default', 'telegram', '{}', 'active')`,
    )
    db.run(`INSERT INTO users (platform_user_id, username, added_by) VALUES ('111', 'alice', 'admin')`)

    migration041UsersPlatformInstanceIndex.up(db)

    expect(getUsers(db)).toEqual([
      { platform_user_id: '111', platform_instance_id: 'telegram-default', username: 'alice' },
    ])
  })

  test('keeps unscoped legacy users inaccessible when active platform is ambiguous', () => {
    db.run(
      `INSERT INTO platform_instances (id, type, config, status) VALUES ('telegram-default', 'telegram', '{}', 'active')`,
    )
    db.run(
      `INSERT INTO platform_instances (id, type, config, status) VALUES ('discord-default', 'discord', '{}', 'active')`,
    )
    db.run(`INSERT INTO users (platform_user_id, username, added_by) VALUES ('111', 'alice', 'admin')`)

    migration041UsersPlatformInstanceIndex.up(db)

    expect(getUsers(db)).toEqual([
      { platform_user_id: '111', platform_instance_id: '__unscoped_legacy__', username: 'alice' },
    ])
  })

  test('allows duplicate platform user IDs and usernames after table recreation', () => {
    db.run(
      `INSERT INTO users (platform_user_id, platform_instance_id, username, added_by) VALUES ('111', 'telegram-default', 'alice', 'admin')`,
    )

    migration041UsersPlatformInstanceIndex.up(db)

    db.run(
      `INSERT INTO users (platform_user_id, platform_instance_id, username, added_by) VALUES ('111', 'discord-default', 'alice', 'admin')`,
    )

    expect(getUsers(db)).toEqual([
      { platform_user_id: '111', platform_instance_id: 'discord-default', username: 'alice' },
      { platform_user_id: '111', platform_instance_id: 'telegram-default', username: 'alice' },
    ])
  })

  test('backfills Kaneo workspace IDs into context config', () => {
    createUserConfigTable(db)
    db.run(
      `INSERT INTO platform_instances (id, type, config, status) VALUES ('telegram-default', 'telegram', '{}', 'active')`,
    )
    db.run(
      `INSERT INTO users (platform_user_id, username, added_by, kaneo_workspace_id) VALUES ('111', 'alice', 'admin', 'workspace-111')`,
    )
    migration041UsersPlatformInstanceIndex.up(db)

    getMigration('042_user_workspace_config_backfill').up(db)

    const row = db
      .query<{ value: string }, [string, string]>(`SELECT value FROM user_config WHERE user_id = ? AND key = ?`)
      .get('111', KANEO_WORKSPACE_CONFIG_KEY)
    expect(requireDefined(row).value).toBe('workspace-111')
  })

  test('does not overwrite an existing Kaneo workspace context config value', () => {
    createUserConfigTable(db)
    db.run(
      `INSERT INTO platform_instances (id, type, config, status) VALUES ('telegram-default', 'telegram', '{}', 'active')`,
    )
    db.run(
      `INSERT INTO users (platform_user_id, username, added_by, kaneo_workspace_id) VALUES ('111', 'alice', 'admin', 'legacy-workspace')`,
    )
    db.run(`INSERT INTO user_config (user_id, key, value) VALUES ('111', 'kaneo_workspace_id', 'configured-workspace')`)
    migration041UsersPlatformInstanceIndex.up(db)

    getMigration('042_user_workspace_config_backfill').up(db)

    const row = db
      .query<{ value: string }, [string, string]>(`SELECT value FROM user_config WHERE user_id = ? AND key = ?`)
      .get('111', KANEO_WORKSPACE_CONFIG_KEY)
    expect(requireDefined(row).value).toBe('configured-workspace')
  })

  test('skips Kaneo workspace backfill for duplicate platform user IDs', () => {
    createUserConfigTable(db)
    db.run(
      `INSERT INTO platform_instances (id, type, config, status) VALUES ('telegram-default', 'telegram', '{}', 'active')`,
    )
    db.run(
      `INSERT INTO users (platform_user_id, platform_instance_id, username, added_by, kaneo_workspace_id) VALUES ('111', 'telegram-default', 'alice', 'admin', 'telegram-workspace')`,
    )
    migration041UsersPlatformInstanceIndex.up(db)
    db.run(
      `INSERT INTO users (platform_user_id, platform_instance_id, username, added_by, kaneo_workspace_id) VALUES ('111', 'discord-default', 'alice', 'admin', 'discord-workspace')`,
    )

    getMigration('042_user_workspace_config_backfill').up(db)

    const row = db
      .query<{ value: string }, [string, string]>(`SELECT value FROM user_config WHERE user_id = ? AND key = ?`)
      .get('111', KANEO_WORKSPACE_CONFIG_KEY)
    expect(row).toBeNull()
  })
})

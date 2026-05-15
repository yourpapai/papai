// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { runMigrations } from '../../../src/db/migrate.js'
import { migration001Initial } from '../../../src/db/migrations/001_initial.js'
import { migration002ConversationHistory } from '../../../src/db/migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from '../../../src/db/migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from '../../../src/db/migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from '../../../src/db/migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from '../../../src/db/migrations/006_version_announcements.js'
import { migration007PlatformUserId } from '../../../src/db/migrations/007_platform_user_id.js'
import { migration008GroupMembers } from '../../../src/db/migrations/008_group_members.js'
import { migration009RecurringTasks } from '../../../src/db/migrations/009_recurring_tasks.js'
import { migration010RecurringTaskOccurrences } from '../../../src/db/migrations/010_recurring_task_occurrences.js'
import { migration011ProactiveAlerts } from '../../../src/db/migrations/011_proactive_alerts.js'
import { migration012UserInstructions } from '../../../src/db/migrations/012_user_instructions.js'
import { migration013DeferredPrompts } from '../../../src/db/migrations/013_deferred_prompts.js'
import { migration014BackgroundEvents } from '../../../src/db/migrations/014_background_events.js'
import { migration015DropBackgroundEvents } from '../../../src/db/migrations/015_drop_background_events.js'
import { migration016ExecutionMetadata } from '../../../src/db/migrations/016_execution_metadata.js'
import { migration017MessageMetadata } from '../../../src/db/migrations/017_message_metadata.js'
import { migration018Memos } from '../../../src/db/migrations/018_memos.js'
import { migration019UserIdentityMappings } from '../../../src/db/migrations/019_user_identity_mappings.js'
import { migration020GroupSettingsRegistry } from '../../../src/db/migrations/020_group_settings_registry.js'
import { migration021WebFetch } from '../../../src/db/migrations/021_web_fetch.js'
import { migration022DropUnusedLastSeenIndex } from '../../../src/db/migrations/022_drop_unused_last_seen_index.js'
import { migration023AddForeignKeys } from '../../../src/db/migrations/023_add_foreign_keys.js'
import { mockLogger } from '../../utils/test-helpers.js'

const ALL_MIGRATIONS = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
  migration008GroupMembers,
  migration009RecurringTasks,
  migration010RecurringTaskOccurrences,
  migration011ProactiveAlerts,
  migration012UserInstructions,
  migration013DeferredPrompts,
  migration014BackgroundEvents,
  migration015DropBackgroundEvents,
  migration016ExecutionMetadata,
  migration017MessageMetadata,
  migration018Memos,
  migration019UserIdentityMappings,
  migration020GroupSettingsRegistry,
  migration021WebFetch,
  migration022DropUnusedLastSeenIndex,
  migration023AddForeignKeys,
] as const

const getForeignKeys = (
  db: Database,
  tableName: string,
): Array<{ from: string; table: string; to: string; on_delete: string }> =>
  db
    .query<{ from: string; table: string; to: string; on_delete: string }, []>(`PRAGMA foreign_key_list(${tableName})`)
    .all()

const expectForeignKeys = (
  db: Database,
  tableName: string,
  expected: Array<{ from: string; table: string; to: string; on_delete: string }>,
): void => {
  expect(
    getForeignKeys(db, tableName).map((row) => ({
      from: row.from,
      table: row.table,
      to: row.to,
      on_delete: row.on_delete,
    })),
  ).toEqual(expected)
}

const countRows = (db: Database, table: string, whereSql: string, params: string[]): number => {
  const row = db
    .query<{ count: number }, string[]>(`SELECT count(*) AS count FROM ${table} WHERE ${whereSql}`)
    .get(...params)
  return row?.count ?? 0
}

describe('migration023AddForeignKeys', () => {
  let db: Database

  beforeAll(() => {
    mockLogger()
    db = new Database(':memory:')
    db.run('PRAGMA journal_mode=WAL')
    db.run('PRAGMA foreign_keys=ON')
    runMigrations(db, ALL_MIGRATIONS)
  })

  afterAll(() => {
    db.close()
  })

  test('adds cascade foreign keys for recurring tables', () => {
    expectForeignKeys(db, 'recurring_tasks', [
      { from: 'user_id', table: 'users', to: 'platform_user_id', on_delete: 'CASCADE' },
    ])
    expectForeignKeys(db, 'recurring_task_occurrences', [
      { from: 'template_id', table: 'recurring_tasks', to: 'id', on_delete: 'CASCADE' },
    ])
  })

  test('cascades user deletions through recurring data', () => {
    db.run("INSERT INTO users (platform_user_id, added_by) VALUES ('u-cascade', 'admin')")
    db.run(
      "INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type) VALUES ('rt-cascade', 'u-cascade', 'p-1', 'Task', 'cron')",
    )
    db.run(
      "INSERT INTO recurring_task_occurrences (id, template_id, task_id) VALUES ('occ-cascade', 'rt-cascade', 'task-1')",
    )

    db.run("DELETE FROM users WHERE platform_user_id = 'u-cascade'")

    expect(countRows(db, 'recurring_tasks', 'user_id = ?', ['u-cascade'])).toBe(0)
    expect(countRows(db, 'recurring_task_occurrences', 'template_id = ?', ['rt-cascade'])).toBe(0)
  })

  test('cascades recurring task deletions to occurrences', () => {
    db.run("INSERT INTO users (platform_user_id, added_by) VALUES ('u-template', 'admin')")
    db.run(
      "INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type) VALUES ('rt-template', 'u-template', 'p-1', 'Task', 'cron')",
    )
    db.run(
      "INSERT INTO recurring_task_occurrences (id, template_id, task_id) VALUES ('occ-template', 'rt-template', 'task-2')",
    )

    db.run("DELETE FROM recurring_tasks WHERE id = 'rt-template'")

    expect(countRows(db, 'recurring_task_occurrences', 'template_id = ?', ['rt-template'])).toBe(0)
  })

  test('rejects orphan inserts after the migration', () => {
    expect(() => {
      db.run(
        "INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type) VALUES ('rt-missing-user', 'missing-user', 'p-1', 'Task', 'cron')",
      )
    }).toThrow()

    expect(() => {
      db.run(
        "INSERT INTO recurring_task_occurrences (id, template_id, task_id) VALUES ('occ-missing', 'missing-template', 'task-3')",
      )
    }).toThrow()
  })

  test('removes orphaned rows while applying the migration', () => {
    const orphanDb = new Database(':memory:')
    orphanDb.run('PRAGMA journal_mode=WAL')
    orphanDb.run('PRAGMA foreign_keys=ON')

    runMigrations(orphanDb, ALL_MIGRATIONS.slice(0, -1))

    orphanDb.run("INSERT INTO users (platform_user_id, added_by) VALUES ('valid-user', 'admin')")
    orphanDb.run(
      "INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type) VALUES ('rt-valid', 'valid-user', 'p-1', 'Valid Task', 'cron')",
    )
    orphanDb.run(
      "INSERT INTO recurring_task_occurrences (id, template_id, task_id) VALUES ('occ-valid', 'rt-valid', 'task-valid')",
    )
    orphanDb.run(
      "INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type) VALUES ('rt-orphan-user', 'missing-user', 'p-2', 'Orphan Task', 'cron')",
    )
    orphanDb.run(
      "INSERT INTO recurring_task_occurrences (id, template_id, task_id) VALUES ('occ-missing-template', 'missing-template', 'task-4')",
    )
    orphanDb.run(
      "INSERT INTO recurring_task_occurrences (id, template_id, task_id) VALUES ('occ-orphan-user', 'rt-orphan-user', 'task-5')",
    )

    runMigrations(orphanDb, ALL_MIGRATIONS)

    expect(countRows(orphanDb, 'recurring_tasks', 'id = ?', ['rt-valid'])).toBe(1)
    expect(countRows(orphanDb, 'recurring_task_occurrences', 'id = ?', ['occ-valid'])).toBe(1)
    expect(countRows(orphanDb, 'recurring_tasks', 'id = ?', ['rt-orphan-user'])).toBe(0)
    expect(countRows(orphanDb, 'recurring_task_occurrences', 'id = ?', ['occ-missing-template'])).toBe(0)
    expect(countRows(orphanDb, 'recurring_task_occurrences', 'id = ?', ['occ-orphan-user'])).toBe(0)

    orphanDb.close()
  })
})

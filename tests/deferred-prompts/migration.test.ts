// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { runMigrations } from '../../src/db/migrate.js'
import { migration001Initial } from '../../src/db/migrations/001_initial.js'
import { migration002ConversationHistory } from '../../src/db/migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from '../../src/db/migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from '../../src/db/migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from '../../src/db/migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from '../../src/db/migrations/006_version_announcements.js'
import { migration007PlatformUserId } from '../../src/db/migrations/007_platform_user_id.js'
import { migration008GroupMembers } from '../../src/db/migrations/008_group_members.js'
import { migration009RecurringTasks } from '../../src/db/migrations/009_recurring_tasks.js'
import { migration010RecurringTaskOccurrences } from '../../src/db/migrations/010_recurring_task_occurrences.js'
import { migration011ProactiveAlerts } from '../../src/db/migrations/011_proactive_alerts.js'
import { migration012UserInstructions } from '../../src/db/migrations/012_user_instructions.js'
import { migration013DeferredPrompts } from '../../src/db/migrations/013_deferred_prompts.js'
import { migration014BackgroundEvents } from '../../src/db/migrations/014_background_events.js'
import { migration015DropBackgroundEvents } from '../../src/db/migrations/015_drop_background_events.js'
import { migration016ExecutionMetadata } from '../../src/db/migrations/016_execution_metadata.js'

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
]

const getColumnNames = (db: Database, tableName: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info('${tableName}')`)
    .all()
    .map((c) => c.name)

const getTableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => row.name)

describe('migration 013: deferred prompts', () => {
  let db: Database

  beforeEach(() => {
    if (db !== undefined) db.close()
    db = new Database(':memory:')
    runMigrations(db, [...ALL_MIGRATIONS])
  })

  afterAll(() => {
    db.close()
  })

  test('creates scheduled_prompts table', () => {
    const columns = getColumnNames(db, 'scheduled_prompts')
    expect(columns).toContain('id')
    expect(columns).toContain('user_id')
    expect(columns).toContain('prompt')
    expect(columns).toContain('fire_at')
    expect(columns).toContain('cron_expression')
    expect(columns).toContain('status')
    expect(columns).toContain('created_at')
    expect(columns).toContain('last_executed_at')
  })

  test('creates alert_prompts table', () => {
    const columns = getColumnNames(db, 'alert_prompts')
    expect(columns).toContain('id')
    expect(columns).toContain('user_id')
    expect(columns).toContain('prompt')
    expect(columns).toContain('condition')
    expect(columns).toContain('status')
    expect(columns).toContain('created_at')
    expect(columns).toContain('last_triggered_at')
    expect(columns).toContain('cooldown_minutes')
  })

  test('creates task_snapshots table', () => {
    const columns = getColumnNames(db, 'task_snapshots')
    expect(columns).toContain('user_id')
    expect(columns).toContain('task_id')
    expect(columns).toContain('field')
    expect(columns).toContain('value')
    expect(columns).toContain('captured_at')
  })

  test('drops old proactive tables', () => {
    const names = getTableNames(db)
    expect(names).not.toContain('reminders')
    expect(names).not.toContain('user_briefing_state')
    expect(names).not.toContain('alert_state')
  })
})

describe('migration 016: execution metadata', () => {
  let db: Database

  beforeEach(() => {
    if (db !== undefined) db.close()
    db = new Database(':memory:')
    runMigrations(db, [...ALL_MIGRATIONS])
  })

  afterAll(() => {
    db.close()
  })

  test('adds execution_metadata to scheduled_prompts', () => {
    const columns = getColumnNames(db, 'scheduled_prompts')
    expect(columns).toContain('execution_metadata')
  })

  test('adds execution_metadata to alert_prompts', () => {
    const columns = getColumnNames(db, 'alert_prompts')
    expect(columns).toContain('execution_metadata')
  })

  test('default value is empty JSON object', () => {
    db.run(
      "INSERT INTO scheduled_prompts (id, user_id, prompt, fire_at, status) VALUES ('t1', 'u1', 'test', '2026-01-01T00:00:00Z', 'active')",
    )
    const row = db
      .query<{ execution_metadata: string }, []>("SELECT execution_metadata FROM scheduled_prompts WHERE id = 't1'")
      .get()
    expect(row?.execution_metadata).toBe('{}')
  })
})

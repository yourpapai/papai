// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from '../src/db/schema.js'
import { recordFailedExecution } from '../src/recurring-run-state.js'
import { createRecurringTask, getDueRecurringTasks, getRecurringTask } from '../src/recurring.js'
import { resumeRecurringTask } from '../src/recurring.js'
import { mockLogger, setTestDrizzleDb } from './utils/test-helpers.js'

const USER_ID = 'test-user-1'
const PROJECT_ID = 'project-1'

describe('recordFailedExecution', () => {
  let testDb: ReturnType<typeof drizzle<typeof schema>>
  let testSqlite: Database

  beforeEach(() => {
    mockLogger()
    testSqlite = new Database(':memory:')
    testSqlite.run('PRAGMA journal_mode=WAL')
    testSqlite.run('PRAGMA foreign_keys=ON')
    testDb = drizzle(testSqlite, { schema })
    setTestDrizzleDb(testDb)

    testSqlite.run(`
      CREATE TABLE users (
        platform_user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        added_at TEXT DEFAULT (datetime('now')) NOT NULL,
        added_by TEXT NOT NULL,
        kaneo_workspace_id TEXT
      )
    `)
    testSqlite.run(`INSERT INTO users (platform_user_id, added_by) VALUES ('${USER_ID}', 'admin')`)

    testSqlite.run(`
    CREATE TABLE recurring_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(platform_user_id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      status TEXT,
      assignee TEXT,
      labels TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'cron',
      rrule TEXT,
      dtstart_utc TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      enabled TEXT NOT NULL DEFAULT '1',
      catch_up TEXT NOT NULL DEFAULT '0',
      last_run TEXT,
      next_run TEXT,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')) NOT NULL
    )
    `)
    testSqlite.run(`
      CREATE TABLE recurring_task_occurrences (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES recurring_tasks(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')) NOT NULL
      )
    `)
  })

  test('advances lastRun and nextRun, leaves the due set, and records no occurrence', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Stale project',
      triggerType: 'cron',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-04-20T09:00:00Z',
    })
    testSqlite.run(`UPDATE recurring_tasks SET next_run = datetime('now', '-1 minute') WHERE id = '${task.id}'`)
    expect(getDueRecurringTasks().some((due) => due.id === task.id)).toBe(true)

    recordFailedExecution(task.id)

    const updated = getRecurringTask(task.id)
    expect(updated).not.toBeNull()
    expect(updated!.lastRun).not.toBeNull()
    expect(updated!.nextRun).not.toBeNull()
    expect(new Date(updated!.nextRun!).getTime()).toBeGreaterThan(Date.now())
    expect(getDueRecurringTasks().some((due) => due.id === task.id)).toBe(false)
    const occurrences = testSqlite.query<{ id: string }, []>('SELECT id FROM recurring_task_occurrences').all()
    expect(occurrences).toHaveLength(0)
  })

  test('does not resurrect the failed attempt as a missed date on resume', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Catch-up stale',
      triggerType: 'cron',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    })
    testSqlite.run(`UPDATE recurring_tasks SET next_run = datetime('now', '-1 minute') WHERE id = '${task.id}'`)

    recordFailedExecution(task.id)

    const resumed = resumeRecurringTask(task.id, true)
    expect(resumed).not.toBeNull()
    expect(resumed!.missedDates).toEqual([])
  })

  test('keeps nextRun null for templates without an rrule', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'On-complete',
      triggerType: 'on_complete',
    })

    recordFailedExecution(task.id)

    const updated = getRecurringTask(task.id)
    expect(updated).not.toBeNull()
    expect(updated!.lastRun).not.toBeNull()
    expect(updated!.nextRun).toBeNull()
  })

  test('no-op for unknown id', () => {
    expect(() => recordFailedExecution('non-existent')).not.toThrow()
  })
})

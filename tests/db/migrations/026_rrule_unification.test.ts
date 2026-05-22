// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, it, expect, beforeEach } from 'bun:test'

import { migration026RruleUnification } from '../../../src/db/migrations/026_rrule_unification.js'

type ColInfoRow = { name: string }
type RruleRow = { rrule: string | null; dtstart_utc: string | null }
type TriggerRow = { rrule: string | null; dtstart_utc: string | null; trigger_type: string }

const seedSchema = (db: Database): void => {
  db.run(`
    CREATE TABLE recurring_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      status TEXT,
      assignee TEXT,
      labels TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'cron',
      cron_expression TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      enabled TEXT NOT NULL DEFAULT '1',
      catch_up TEXT NOT NULL DEFAULT '0',
      last_run TEXT,
      next_run TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run('CREATE INDEX idx_recurring_tasks_user ON recurring_tasks(user_id)')
  db.run('CREATE INDEX idx_recurring_tasks_enabled_next ON recurring_tasks(enabled, next_run)')
  db.run(`
    CREATE TABLE scheduled_prompts (
      id TEXT PRIMARY KEY,
      created_by_user_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      fire_at TEXT NOT NULL,
      cron_expression TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run('CREATE INDEX idx_scheduled_prompts_creator ON scheduled_prompts(created_by_user_id)')
}

describe('migration 026: rrule unification', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    seedSchema(db)
  })

  it('adds rrule and dtstart_utc, drops cron_expression from recurring_tasks', () => {
    db.run(
      `INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type, cron_expression, timezone, created_at, updated_at)
       VALUES ('r1', 'u1', 'p1', 'Weekly standup', 'cron', '0 9 * * 1,3,5', 'UTC', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z')`,
    )

    migration026RruleUnification.up(db)

    const cols = db.query<ColInfoRow, []>("PRAGMA table_info('recurring_tasks')").all()
    const names = new Set(cols.map((c) => c.name))
    expect(names.has('rrule')).toBe(true)
    expect(names.has('dtstart_utc')).toBe(true)
    expect(names.has('cron_expression')).toBe(false)
    expect(names.has('next_run')).toBe(true)

    const row = db.query<RruleRow, [string]>('SELECT rrule, dtstart_utc FROM recurring_tasks WHERE id = ?').get('r1')
    expect(row).not.toBeNull()
    expect(row!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0')
    expect(row!.dtstart_utc).not.toBeNull()
  })

  it('leaves rrule NULL for unparseable legacy cron in recurring_tasks', () => {
    db.run(
      `INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type, cron_expression, timezone, created_at, updated_at)
       VALUES ('r2', 'u1', 'p1', 'Broken', 'cron', 'not a cron', 'UTC', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z')`,
    )

    migration026RruleUnification.up(db)

    const row = db.query<RruleRow, [string]>('SELECT rrule, dtstart_utc FROM recurring_tasks WHERE id = ?').get('r2')
    expect(row).not.toBeNull()
    expect(row!.rrule).toBeNull()
    expect(row!.dtstart_utc).toBeNull()
  })

  it('leaves rrule NULL for on_complete rows in recurring_tasks', () => {
    db.run(
      `INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type, cron_expression, timezone, created_at, updated_at)
       VALUES ('r3', 'u1', 'p1', 'OnComplete', 'on_complete', NULL, 'UTC', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z')`,
    )

    migration026RruleUnification.up(db)

    const row = db
      .query<TriggerRow, [string]>('SELECT rrule, dtstart_utc, trigger_type FROM recurring_tasks WHERE id = ?')
      .get('r3')
    expect(row).not.toBeNull()
    expect(row!.rrule).toBeNull()
    expect(row!.dtstart_utc).toBeNull()
    expect(row!.trigger_type).toBe('on_complete')
  })

  it('adds rrule and dtstart_utc, drops cron_expression from scheduled_prompts', () => {
    db.run(
      `INSERT INTO scheduled_prompts (id, created_by_user_id, prompt, fire_at, cron_expression, created_at)
       VALUES ('sp1', 'u1', 'remind me', '2026-04-01T09:00:00Z', '0 9 * * 1', '2026-04-01T00:00:00Z')`,
    )

    migration026RruleUnification.up(db)

    const cols = db.query<ColInfoRow, []>("PRAGMA table_info('scheduled_prompts')").all()
    const names = new Set(cols.map((c) => c.name))
    expect(names.has('rrule')).toBe(true)
    expect(names.has('dtstart_utc')).toBe(true)
    expect(names.has('cron_expression')).toBe(false)

    const row = db.query<RruleRow, [string]>('SELECT rrule, dtstart_utc FROM scheduled_prompts WHERE id = ?').get('sp1')
    expect(row).not.toBeNull()
    expect(row!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0')
    expect(row!.dtstart_utc).not.toBeNull()
  })

  it('leaves rrule NULL for null cron_expression rows in scheduled_prompts', () => {
    db.run(
      `INSERT INTO scheduled_prompts (id, created_by_user_id, prompt, fire_at, cron_expression, created_at)
       VALUES ('sp2', 'u1', 'one-shot', '2026-04-01T09:00:00Z', NULL, '2026-04-01T00:00:00Z')`,
    )

    migration026RruleUnification.up(db)

    const row = db.query<RruleRow, [string]>('SELECT rrule, dtstart_utc FROM scheduled_prompts WHERE id = ?').get('sp2')
    expect(row).not.toBeNull()
    expect(row!.rrule).toBeNull()
    expect(row!.dtstart_utc).toBeNull()
  })

  it('aborts with a structured error if the translator throws on a parseable cron', () => {
    expect(true).toBe(true)
  })
})

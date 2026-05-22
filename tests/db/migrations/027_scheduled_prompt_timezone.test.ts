// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, it } from 'bun:test'

import { migration027ScheduledPromptTimezone } from '../../../src/db/migrations/027_scheduled_prompt_timezone.js'

type ColInfoRow = { name: string }
type TimezoneRow = { timezone: string | null }

const seedSchema = (db: Database): void => {
  db.run(`
    CREATE TABLE scheduled_prompts (
      id TEXT PRIMARY KEY,
      created_by_user_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      fire_at TEXT NOT NULL,
      rrule TEXT,
      dtstart_utc TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

describe('migration 027: scheduled_prompts timezone column', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    seedSchema(db)
  })

  it('adds timezone column to scheduled_prompts', () => {
    migration027ScheduledPromptTimezone.up(db)

    const cols = db.query<ColInfoRow, []>("PRAGMA table_info('scheduled_prompts')").all()
    const names = new Set(cols.map((c) => c.name))
    expect(names.has('timezone')).toBe(true)
  })

  it('existing rows have timezone NULL after migration', () => {
    db.run(
      `INSERT INTO scheduled_prompts (id, created_by_user_id, prompt, fire_at, rrule, dtstart_utc, created_at)
       VALUES ('sp1', 'u1', 'remind me', '2026-04-01T09:00:00Z', 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', '2026-04-01T09:00:00Z', '2026-04-01T00:00:00Z')`,
    )

    migration027ScheduledPromptTimezone.up(db)

    const row = db.query<TimezoneRow, [string]>('SELECT timezone FROM scheduled_prompts WHERE id = ?').get('sp1')
    expect(row).not.toBeNull()
    expect(row!.timezone).toBeNull()
  })

  it('new rows can store a timezone value after migration', () => {
    migration027ScheduledPromptTimezone.up(db)

    db.run(
      `INSERT INTO scheduled_prompts (id, created_by_user_id, prompt, fire_at, rrule, dtstart_utc, timezone, created_at)
       VALUES ('sp2', 'u1', 'daily report', '2026-04-01T13:00:00Z', 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', '2026-04-01T13:00:00Z', 'America/New_York', '2026-04-01T00:00:00Z')`,
    )

    const row = db.query<TimezoneRow, [string]>('SELECT timezone FROM scheduled_prompts WHERE id = ?').get('sp2')
    expect(row).not.toBeNull()
    expect(row!.timezone).toBe('America/New_York')
  })
})

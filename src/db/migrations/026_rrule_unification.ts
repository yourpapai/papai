// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import { cronToRrule } from '../../recurrence-translator.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:026' })

type BackfillResult = { migratedCount: number; skippedNullCount: number }

type RecurringRow = { id: string; cron_expression: string; timezone: string; created_at: string }

const backfillRecurringRrules = (db: Database): BackfillResult => {
  const rows = db
    .query<RecurringRow, []>(
      "SELECT id, cron_expression, timezone, created_at FROM recurring_tasks WHERE trigger_type = 'cron' AND cron_expression IS NOT NULL",
    )
    .all()

  let migratedCount = 0
  let skippedNullCount = 0

  for (const row of rows) {
    try {
      const translated = cronToRrule(row.cron_expression, row.timezone, new Date(row.created_at).toISOString())
      if (translated === null) {
        skippedNullCount++
        log.warn({ id: row.id, cron: row.cron_expression }, 'Unparseable legacy cron; leaving rrule NULL')
        continue
      }
      db.run('UPDATE recurring_tasks SET rrule = ?, dtstart_utc = ? WHERE id = ?', [
        translated.rrule,
        translated.dtstartUtc,
        row.id,
      ])
      migratedCount++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error({ id: row.id, cron: row.cron_expression, error: message }, 'Translator threw during migration')
      throw new Error(
        `migration 026 aborted: translator threw on recurring_tasks row ${row.id} (cron='${row.cron_expression}'): ${message}`,
        { cause: error },
      )
    }
  }

  return { migratedCount, skippedNullCount }
}

const migrateRecurringTasks = (db: Database): void => {
  db.run('ALTER TABLE recurring_tasks ADD COLUMN rrule TEXT')
  db.run('ALTER TABLE recurring_tasks ADD COLUMN dtstart_utc TEXT')

  const { migratedCount, skippedNullCount } = backfillRecurringRrules(db)

  db.run(`
    CREATE TABLE recurring_tasks_new (
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
  db.run(
    `INSERT INTO recurring_tasks_new
     (id, user_id, project_id, title, description, priority, status, assignee, labels, trigger_type, rrule, dtstart_utc, timezone, enabled, catch_up, last_run, next_run, created_at, updated_at)
     SELECT id, user_id, project_id, title, description, priority, status, assignee, labels, trigger_type, rrule, dtstart_utc, timezone, enabled, catch_up, last_run, next_run, created_at, updated_at
     FROM recurring_tasks`,
  )
  db.run('DROP TABLE recurring_tasks')
  db.run('ALTER TABLE recurring_tasks_new RENAME TO recurring_tasks')
  db.run('CREATE INDEX idx_recurring_tasks_user ON recurring_tasks(user_id)')
  db.run('CREATE INDEX idx_recurring_tasks_enabled_next ON recurring_tasks(enabled, next_run)')

  log.info({ migratedCount, skippedNullCount }, 'migration 026: recurring_tasks rrule columns applied')
}

type ScheduledRow = { id: string; cron_expression: string; created_at: string }

const backfillScheduledPromptRrules = (db: Database): BackfillResult => {
  const rows = db
    .query<ScheduledRow, []>(
      'SELECT id, cron_expression, created_at FROM scheduled_prompts WHERE cron_expression IS NOT NULL',
    )
    .all()

  let migratedCount = 0
  let skippedNullCount = 0

  for (const row of rows) {
    try {
      const translated = cronToRrule(row.cron_expression, 'UTC', new Date(row.created_at).toISOString())
      if (translated === null) {
        skippedNullCount++
        log.warn({ id: row.id, cron: row.cron_expression }, 'Unparseable legacy cron in scheduled_prompts')
        continue
      }
      db.run('UPDATE scheduled_prompts SET rrule = ?, dtstart_utc = ? WHERE id = ?', [
        translated.rrule,
        translated.dtstartUtc,
        row.id,
      ])
      migratedCount++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error({ id: row.id, cron: row.cron_expression, error: message }, 'Translator threw during migration')
      throw new Error(
        `migration 026 aborted: translator threw on scheduled_prompts row ${row.id} (cron='${row.cron_expression}'): ${message}`,
        { cause: error },
      )
    }
  }

  return { migratedCount, skippedNullCount }
}

type ColInfo = {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

const rebuildScheduledPromptsTable = (db: Database): void => {
  const colInfo = db.query<ColInfo, []>("PRAGMA table_info('scheduled_prompts')").all()

  const colDefs = colInfo
    .filter((c) => c.name !== 'cron_expression' && c.name !== 'rrule' && c.name !== 'dtstart_utc')
    .map((c) => {
      let def = `${c.name} ${c.type}`
      if (c.notnull) def += ' NOT NULL'
      if (c.dflt_value !== null) {
        const val = c.dflt_value.includes('(') ? `(${c.dflt_value})` : c.dflt_value
        def += ` DEFAULT ${val}`
      }
      if (c.pk) def += ' PRIMARY KEY'
      return def
    })

  colDefs.push('rrule TEXT')
  colDefs.push('dtstart_utc TEXT')

  const colNames = colInfo.filter((c) => c.name !== 'cron_expression').map((c) => c.name)
  const colList = colNames.join(', ')

  db.run(`CREATE TABLE scheduled_prompts_new (${colDefs.join(', ')})`)
  db.run(`INSERT INTO scheduled_prompts_new (${colList}) SELECT ${colList} FROM scheduled_prompts`)
  db.run('DROP TABLE scheduled_prompts')
  db.run('ALTER TABLE scheduled_prompts_new RENAME TO scheduled_prompts')
  db.run('CREATE INDEX idx_scheduled_prompts_creator ON scheduled_prompts(created_by_user_id)')
  db.run('CREATE INDEX idx_scheduled_prompts_status_fire ON scheduled_prompts(status, fire_at)')
}

const migrateScheduledPrompts = (db: Database): void => {
  db.run('ALTER TABLE scheduled_prompts ADD COLUMN rrule TEXT')
  db.run('ALTER TABLE scheduled_prompts ADD COLUMN dtstart_utc TEXT')

  const { migratedCount, skippedNullCount } = backfillScheduledPromptRrules(db)

  rebuildScheduledPromptsTable(db)

  log.info({ migratedCount, skippedNullCount }, 'migration 026: scheduled_prompts rrule columns applied')
}

const up = (db: Database): void => {
  migrateRecurringTasks(db)
  migrateScheduledPrompts(db)
  log.info('migration 026 complete')
}

export const migration026RruleUnification: Migration = {
  id: '026_rrule_unification',
  up,
}

export default migration026RruleUnification

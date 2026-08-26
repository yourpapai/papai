// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration081AlertTaskInstancePin } from '../../../src/db/migrations/081_alert_task_instance_pin.js'

const alertColumns = (db: Database): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(alert_prompts)`)
    .all()
    .map((row) => row.name)

const alertForeignKeys = (db: Database): Array<{ from: string; table: string; to: string; on_delete: string }> =>
  db
    .query<{ from: string; table: string; to: string; on_delete: string }, []>(`PRAGMA foreign_key_list(alert_prompts)`)
    .all()
    .map((row) => ({ from: row.from, table: row.table, to: row.to, on_delete: row.on_delete }))

const insertLegacyAlert = (db: Database): void => {
  db.run(
    `INSERT INTO alert_prompts (id, created_by_user_id, prompt, condition)
     VALUES ('ap-legacy', 'u1', 'notify when done', '{"field":"task.status","op":"eq","value":"done"}')`,
  )
}

describe('migration 081 alert task instance pin', () => {
  test('has correct id', () => {
    expect(migration081AlertTaskInstancePin.id).toBe('081_alert_task_instance_pin')
  })

  test('adds task_instance_id column to alert_prompts', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(alertColumns(db)).toContain('task_instance_id')
  })

  test('up is idempotent (safe to re-run)', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(() => migration081AlertTaskInstancePin.up(db)).not.toThrow()
    expect(alertColumns(db).filter((name) => name === 'task_instance_id')).toHaveLength(1)
  })

  test('declares the task_instances FK with ON DELETE CASCADE', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(alertForeignKeys(db)).toContainEqual({
      from: 'task_instance_id',
      table: 'task_instances',
      to: 'id',
      on_delete: 'CASCADE',
    })
  })

  test('legacy alert rows keep a NULL task_instance_id', () => {
    const db = new Database(':memory:')
    runMigrations(
      db,
      MIGRATIONS.filter((m) => m.id !== '081_alert_task_instance_pin'),
    )
    insertLegacyAlert(db)

    migration081AlertTaskInstancePin.up(db)

    const row = db
      .query<{ task_instance_id: string | null }, []>(
        `SELECT task_instance_id FROM alert_prompts WHERE id = 'ap-legacy'`,
      )
      .get()
    expect(row?.task_instance_id).toBeNull()
  })
})

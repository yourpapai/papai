// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration062NullableContextTaskInstance } from '../../../src/db/migrations/062_nullable_context_task_instance.js'

const taskInstanceNotNull = (db: Database): number => {
  const column = db
    .query<{ name: string; notnull: number }, []>(`PRAGMA table_info(context_settings)`)
    .all()
    .find((row) => row.name === 'task_instance_id')
  if (column === undefined) throw new Error('task_instance_id column missing')
  return column.notnull
}

const indexNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA index_list(context_settings)`)
    .all()
    .map((row) => row.name)

const seedParents = (db: Database): void => {
  db.run(`INSERT INTO task_instances (id, type, config, status) VALUES ('kaneo-default', 'kaneo', '{}', 'active')`)
  db.run(`INSERT INTO platform_instances (id, type, config, status) VALUES ('tg-default', 'telegram', '{}', 'active')`)
}

describe('migration 062', () => {
  test('has correct id', () => {
    expect(migration062NullableContextTaskInstance.id).toBe('062_nullable_context_task_instance')
  })

  test('makes context_settings.task_instance_id nullable', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(taskInstanceNotNull(db)).toBe(0)
  })

  test('preserves existing rows when applied over the prior schema', () => {
    const db = new Database(':memory:')
    const priorMigrations = MIGRATIONS.filter((m) => m.id !== '062_nullable_context_task_instance')
    runMigrations(db, priorMigrations)
    seedParents(db)
    db.run(
      `INSERT INTO context_settings (context_id, task_instance_id, platform_instance_id) VALUES ('u1', 'kaneo-default', 'tg-default')`,
    )
    expect(taskInstanceNotNull(db)).toBe(1)

    migration062NullableContextTaskInstance.up(db)

    expect(taskInstanceNotNull(db)).toBe(0)
    const row = db
      .query<{ context_id: string; task_instance_id: string | null; platform_instance_id: string }, []>(
        `SELECT * FROM context_settings WHERE context_id = 'u1'`,
      )
      .get()
    expect(row).toEqual({ context_id: 'u1', task_instance_id: 'kaneo-default', platform_instance_id: 'tg-default' })
  })

  test('allows inserting a row with a null task_instance_id', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    seedParents(db)

    db.run(
      `INSERT INTO context_settings (context_id, task_instance_id, platform_instance_id) VALUES ('u2', NULL, 'tg-default')`,
    )

    const row = db
      .query<{ task_instance_id: string | null }, []>(
        `SELECT task_instance_id FROM context_settings WHERE context_id = 'u2'`,
      )
      .get()
    expect(row?.task_instance_id).toBeNull()
  })

  test('preserves the supporting indexes', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    const indexes = indexNames(db)
    expect(indexes).toContain('idx_context_settings_task_instance')
    expect(indexes).toContain('idx_context_settings_platform_instance')
  })

  test('up is idempotent (safe to re-run)', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(() => migration062NullableContextTaskInstance.up(db)).not.toThrow()
    expect(taskInstanceNotNull(db)).toBe(0)
  })
})

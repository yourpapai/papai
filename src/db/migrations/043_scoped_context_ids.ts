// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { toScopedContextId } from '../../chat/scoped-context.js'
import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:043' })

type ContextOwnedColumn = Readonly<{
  table: string
  column: string
}>

type UsernameDuplicateGroup = Readonly<{
  platform_instance_id: string
  username: string
}>

type UserDuplicateCandidate = Readonly<{
  rowid: number
  platform_user_id: string
}>

const CONTEXT_OWNED_COLUMNS: readonly ContextOwnedColumn[] = [
  { table: 'context_settings', column: 'context_id' },
  { table: 'user_config', column: 'user_id' },
  { table: 'conversation_history', column: 'user_id' },
  { table: 'memory_summary', column: 'user_id' },
  { table: 'memory_facts', column: 'user_id' },
  { table: 'authorized_groups', column: 'group_id' },
  { table: 'group_members', column: 'group_id' },
  { table: 'recurring_tasks', column: 'user_id' },
  { table: 'scheduled_prompts', column: 'created_by_user_id' },
  { table: 'scheduled_prompts', column: 'delivery_context_id' },
  { table: 'alert_prompts', column: 'created_by_user_id' },
  { table: 'alert_prompts', column: 'delivery_context_id' },
  { table: 'task_snapshots', column: 'user_id' },
]

const tableExists = (db: Database, table: string): boolean =>
  db
    .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) !== null

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const getSinglePlatformInstanceId = (db: Database): string | null => {
  if (!tableExists(db, 'platform_instances')) return null
  const rows = db.query<{ id: string }, []>(`SELECT id FROM platform_instances ORDER BY id`).all()
  return rows.length === 1 ? rows[0]!.id : null
}

const scopeValue = (platformInstanceId: string, value: string | null): string | null => {
  if (value === null) return null
  if (value.startsWith('pi:')) return value
  return toScopedContextId({ platformInstanceId, nativeContextId: value })
}

const scopeContextOwnedColumn = (db: Database, platformInstanceId: string, input: ContextOwnedColumn): void => {
  if (!tableExists(db, input.table)) return
  if (!columnExists(db, input.table, input.column)) return

  const rows = db
    .query<{ value: string }, []>(
      `SELECT DISTINCT ${input.column} AS value FROM ${input.table} WHERE ${input.column} IS NOT NULL AND ${input.column} NOT LIKE 'pi:%'`,
    )
    .all()

  for (const row of rows) {
    db.run(`UPDATE ${input.table} SET ${input.column} = ? WHERE ${input.column} = ?`, [
      scopeValue(platformInstanceId, row.value),
      row.value,
    ])
  }
}

const scopeContextOwnedRows = (db: Database, platformInstanceId: string): void => {
  for (const contextOwnedColumn of CONTEXT_OWNED_COLUMNS) {
    scopeContextOwnedColumn(db, platformInstanceId, contextOwnedColumn)
  }
}

const addStagedSourcePlatformColumn = (db: Database): void => {
  if (!tableExists(db, 'staged_files')) return
  if (columnExists(db, 'staged_files', 'source_platform_instance_id')) return

  db.run(`ALTER TABLE staged_files ADD COLUMN source_platform_instance_id TEXT NOT NULL DEFAULT ''`)
}

const getUsernameDuplicateGroups = (db: Database): readonly UsernameDuplicateGroup[] => {
  if (!tableExists(db, 'users')) return []
  if (!columnExists(db, 'users', 'platform_instance_id')) return []
  if (!columnExists(db, 'users', 'username')) return []

  return db
    .query<UsernameDuplicateGroup, []>(
      `
        SELECT platform_instance_id, username
        FROM users
        WHERE username IS NOT NULL
        GROUP BY platform_instance_id, username
        HAVING COUNT(*) > 1
      `,
    )
    .all()
}

const getDuplicateCandidates = (db: Database, group: UsernameDuplicateGroup): readonly UserDuplicateCandidate[] =>
  db
    .query<UserDuplicateCandidate, [string, string]>(
      `
        SELECT rowid, platform_user_id
        FROM users
        WHERE platform_instance_id = ? AND username = ?
        ORDER BY
          CASE WHEN platform_user_id NOT LIKE 'placeholder-%' THEN 0 ELSE 1 END,
          added_at,
          platform_user_id
      `,
    )
    .all(group.platform_instance_id, group.username)

const deleteDuplicateCandidates = (db: Database, candidates: readonly UserDuplicateCandidate[]): void => {
  const rowsToDelete = candidates.slice(1)
  for (const row of rowsToDelete) {
    db.run(`DELETE FROM users WHERE rowid = ?`, [row.rowid])
  }
}

const deduplicateUsernames = (db: Database): void => {
  const duplicateGroups = getUsernameDuplicateGroups(db)
  for (const group of duplicateGroups) {
    deleteDuplicateCandidates(db, getDuplicateCandidates(db, group))
  }
}

const createUsernameUniqueIndex = (db: Database): void => {
  if (!tableExists(db, 'users')) return

  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_platform_username_unique ON users(platform_instance_id, username) WHERE username IS NOT NULL`,
  )
}

export const migration043ScopedContextIds: Migration = {
  id: '043_scoped_context_ids',
  up(db) {
    const platformInstanceId = getSinglePlatformInstanceId(db)
    if (platformInstanceId === null) {
      log.warn('migration 043: preserving legacy context ids because platform ownership is ambiguous')
    } else {
      scopeContextOwnedRows(db, platformInstanceId)
    }
    addStagedSourcePlatformColumn(db)
    deduplicateUsernames(db)
    createUsernameUniqueIndex(db)
  },
}

export default migration043ScopedContextIds

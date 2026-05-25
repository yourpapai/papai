// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { toScopedContextId, toScopedThreadContextId } from '../../chat/scoped-context.js'
import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'
import { CONTEXT_OWNED_COLUMNS, type ContextOwnedColumn } from './043_scoped_context_ids_columns.js'

const log = logger.child({ scope: 'migration:043' })

type UsernameDuplicateGroup = Readonly<{
  platform_instance_id: string
  username: string
}>

type UserDuplicateCandidate = Readonly<{
  rowid: number
  platform_user_id: string
  is_placeholder: number
}>

type LegacyUserRow = Readonly<{ rowid: number; platform_user_id: string }>

type ContextOwnedRow = Readonly<{
  rowid: number
  value: string
}> &
  Readonly<Record<string, string | number | null>>

const SCOPED_CONTEXT_ID_PATTERN = /^pi:[^:]+:ctx:[^:]+(?::thread:[^:]+)?$/u
const UNSCOPED_LEGACY_PLATFORM_INSTANCE_ID = '__unscoped_legacy__'

const tableExists = (db: Database, table: string): boolean =>
  db
    .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) !== null

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const parseBootstrapChatProvider = (value: string | undefined): string | null => {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === 'telegram' || trimmed === 'mattermost' || trimmed === 'discord') return trimmed
  return null
}

const getPlatformInstanceId = (db: Database): string | null => {
  if (!tableExists(db, 'platform_instances')) return null
  const rows = db.query<{ id: string }, []>(`SELECT id FROM platform_instances ORDER BY id`).all()
  if (rows.length === 1) return rows[0]!.id
  if (rows.length > 1) return null

  const chatProvider = parseBootstrapChatProvider(process.env['CHAT_PROVIDER'])
  if (chatProvider === null) return null
  return `${chatProvider}-default`
}

const parseLegacyThreadKey = (value: string): { nativeContextId: string; threadId: string } | null => {
  const separatorIndex = value.lastIndexOf(':')
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return null
  return {
    nativeContextId: value.slice(0, separatorIndex),
    threadId: value.slice(separatorIndex + 1),
  }
}

const scopeValue = (platformInstanceId: string, value: string | null, threadScoped: boolean): string | null => {
  if (value === null) return null
  if (SCOPED_CONTEXT_ID_PATTERN.test(value)) return value
  const legacyThreadKey = threadScoped ? parseLegacyThreadKey(value) : null
  if (legacyThreadKey !== null) {
    return toScopedThreadContextId({ platformInstanceId, ...legacyThreadKey })
  }
  return toScopedContextId({ platformInstanceId, nativeContextId: value })
}

const getRowValue = (row: ContextOwnedRow, column: string): string | number | null => {
  const value = row[column]
  if (value === undefined) return null
  return value
}

const existingScopedConflict = (
  db: Database,
  input: ContextOwnedColumn,
  row: ContextOwnedRow,
  scopedValue: string,
): boolean => {
  if (input.conflictColumns === null) return false
  const conflictPredicates = input.conflictColumns.map((column) => `${column} IS ?`).join(' AND ')
  const sql = [`SELECT 1 FROM ${input.table} WHERE ${input.column} = ? AND rowid <> ?`, conflictPredicates]
    .filter((part) => part !== '')
    .join(' AND ')
  const params = [scopedValue, row.rowid, ...input.conflictColumns.map((column) => getRowValue(row, column))]

  return db.query(sql).get(...params) !== null
}

const getConflictColumns = (input: ContextOwnedColumn): readonly string[] => {
  if (input.conflictColumns === null) return []
  return input.conflictColumns
}

const getContextOwnedRows = (db: Database, input: ContextOwnedColumn): readonly ContextOwnedRow[] => {
  const conflictColumns = getConflictColumns(input)
  const selectedConflictColumns = conflictColumns.map((column) => `, ${column}`)

  return db
    .query<ContextOwnedRow, []>(
      `SELECT rowid, ${input.column} AS value${selectedConflictColumns.join('')} FROM ${input.table} WHERE ${input.column} IS NOT NULL`,
    )
    .all()
    .filter((row) => !SCOPED_CONTEXT_ID_PATTERN.test(row.value))
}

const scopeContextOwnedColumn = (db: Database, platformInstanceId: string, input: ContextOwnedColumn): void => {
  if (!tableExists(db, input.table)) return
  if (!columnExists(db, input.table, input.column)) return

  const rows = getContextOwnedRows(db, input)

  for (const row of rows) {
    const scopedValue = scopeValue(platformInstanceId, row.value, input.threadScoped)
    if (scopedValue === null) continue
    if (existingScopedConflict(db, input, row, scopedValue)) {
      db.run(`DELETE FROM ${input.table} WHERE rowid = ?`, [row.rowid])
    } else {
      db.run(`UPDATE ${input.table} SET ${input.column} = ? WHERE rowid = ?`, [scopedValue, row.rowid])
    }
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

const targetUserExists = (db: Database, platformInstanceId: string, row: LegacyUserRow): boolean =>
  db
    .query<{ one: number }, [string, string, number]>(
      `SELECT 1 AS one FROM users WHERE platform_instance_id = ? AND platform_user_id = ? AND rowid <> ?`,
    )
    .get(platformInstanceId, row.platform_user_id, row.rowid) !== null

const migrateLegacyUsersToPlatform = (db: Database, platformInstanceId: string): void => {
  if (!tableExists(db, 'users')) return
  if (!columnExists(db, 'users', 'platform_instance_id')) return
  if (!columnExists(db, 'users', 'platform_user_id')) return

  const rows = db
    .query<LegacyUserRow, [string]>(
      `SELECT rowid, platform_user_id FROM users WHERE platform_instance_id = ? ORDER BY added_at, platform_user_id`,
    )
    .all(UNSCOPED_LEGACY_PLATFORM_INSTANCE_ID)

  for (const row of rows) {
    if (targetUserExists(db, platformInstanceId, row)) {
      db.run(`DELETE FROM users WHERE rowid = ?`, [row.rowid])
    } else {
      db.run(`UPDATE users SET platform_instance_id = ? WHERE rowid = ?`, [platformInstanceId, row.rowid])
    }
  }
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
          , CASE WHEN platform_user_id LIKE 'placeholder-%' THEN 1 ELSE 0 END AS is_placeholder
        FROM users
        WHERE platform_instance_id = ? AND username = ?
        ORDER BY
          CASE WHEN platform_user_id NOT LIKE 'placeholder-%' THEN 0 ELSE 1 END,
          added_at,
          platform_user_id
      `,
    )
    .all(group.platform_instance_id, group.username)

const deleteUsersByRowid = (db: Database, candidates: readonly UserDuplicateCandidate[]): void => {
  for (const row of candidates) {
    db.run(`DELETE FROM users WHERE rowid = ?`, [row.rowid])
  }
}

const clearUsernamesByRowid = (db: Database, candidates: readonly UserDuplicateCandidate[]): void => {
  for (const row of candidates) {
    db.run(`UPDATE users SET username = NULL WHERE rowid = ?`, [row.rowid])
  }
}

const deduplicateUsernameCandidates = (db: Database, candidates: readonly UserDuplicateCandidate[]): void => {
  const realUsers = candidates.filter((row) => row.is_placeholder === 0)
  if (realUsers.length === 0) {
    deleteUsersByRowid(db, candidates.slice(1))
    return
  }
  if (realUsers.length === 1) {
    deleteUsersByRowid(
      db,
      candidates.filter((row) => row.is_placeholder === 1),
    )
    return
  }

  const keeper = realUsers[0]
  if (keeper === undefined) return
  const rowsToClear = candidates.filter((row) => row.rowid !== keeper.rowid)
  clearUsernamesByRowid(db, rowsToClear)
}

const deduplicateUsernames = (db: Database): void => {
  const duplicateGroups = getUsernameDuplicateGroups(db)
  for (const group of duplicateGroups) {
    deduplicateUsernameCandidates(db, getDuplicateCandidates(db, group))
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
    const platformInstanceId = getPlatformInstanceId(db)
    if (platformInstanceId === null) {
      log.warn('migration 043: preserving legacy context ids because platform ownership is ambiguous')
    } else {
      migrateLegacyUsersToPlatform(db, platformInstanceId)
      scopeContextOwnedRows(db, platformInstanceId)
    }
    addStagedSourcePlatformColumn(db)
    deduplicateUsernames(db)
    createUsernameUniqueIndex(db)
  },
}

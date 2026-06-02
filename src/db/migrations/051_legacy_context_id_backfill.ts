// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { isScopedContextId, toScopedContextId, toScopedThreadContextId } from '../../chat/scoped-context.js'
import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'
import { CONTEXT_OWNED_COLUMNS, type ContextOwnedColumn } from './scoped-context-owned-columns.js'

const log = logger.child({ scope: 'migration:051' })

type ContextOwnedRow = Readonly<{
  rowid: number
  value: string
}> &
  Readonly<Record<string, string | number | null>>

const tableExists = (db: Database, table: string): boolean =>
  db
    .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) !== null

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const getActivePlatformInstanceId = (db: Database): string | null => {
  if (!tableExists(db, 'platform_instances')) return null
  const rows = db
    .query<{ id: string }, []>(`SELECT id FROM platform_instances WHERE status = 'active' ORDER BY id`)
    .all()
  if (rows.length === 1) return rows[0]!.id
  return null
}

const parseLegacyThreadKey = (value: string): { nativeContextId: string; threadId: string } | null => {
  const separatorIndex = value.lastIndexOf(':')
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return null
  return {
    nativeContextId: value.slice(0, separatorIndex),
    threadId: value.slice(separatorIndex + 1),
  }
}

const scopeValue = (platformInstanceId: string, value: string, threadScoped: boolean): string => {
  if (isScopedContextId(value)) return value
  const legacyThreadKey = threadScoped ? parseLegacyThreadKey(value) : null
  if (legacyThreadKey !== null) {
    return toScopedThreadContextId({ platformInstanceId, ...legacyThreadKey })
  }
  return toScopedContextId({ platformInstanceId, nativeContextId: value })
}

const getConflictColumns = (input: ContextOwnedColumn): readonly string[] => {
  if (input.conflictColumns === null) return []
  return input.conflictColumns
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

const getContextOwnedRows = (db: Database, input: ContextOwnedColumn): readonly ContextOwnedRow[] => {
  const conflictColumns = getConflictColumns(input)
  const selectedConflictColumns = conflictColumns.map((column) => `, ${column}`)

  return db
    .query<ContextOwnedRow, []>(
      `SELECT rowid, ${input.column} AS value${selectedConflictColumns.join('')} FROM ${input.table} WHERE ${input.column} IS NOT NULL`,
    )
    .all()
    .filter((row) => !isScopedContextId(row.value))
}

const scopeContextOwnedColumn = (db: Database, platformInstanceId: string, input: ContextOwnedColumn): number => {
  if (!tableExists(db, input.table)) return 0
  if (!columnExists(db, input.table, input.column)) return 0

  const rows = getContextOwnedRows(db, input)
  let scoped = 0

  for (const row of rows) {
    const scopedValue = scopeValue(platformInstanceId, row.value, input.threadScoped)
    if (existingScopedConflict(db, input, row, scopedValue)) {
      db.run(`DELETE FROM ${input.table} WHERE rowid = ?`, [row.rowid])
    } else {
      db.run(`UPDATE ${input.table} SET ${input.column} = ? WHERE rowid = ?`, [scopedValue, row.rowid])
      scoped += 1
    }
  }

  return scoped
}

const scopeAllContextOwnedColumns = (db: Database, platformInstanceId: string): number => {
  let total = 0
  for (const input of CONTEXT_OWNED_COLUMNS) {
    total += scopeContextOwnedColumn(db, platformInstanceId, input)
  }
  return total
}

export const migration051LegacyContextIdBackfill: Migration = {
  id: '051_legacy_context_id_backfill',
  up(db) {
    const platformInstanceId = getActivePlatformInstanceId(db)
    if (platformInstanceId === null) {
      log.warn(
        'migration 051: skipping because no unique active platform instance is available; ' +
          'context-owned rows will be scoped on the next deployment that exposes a single chat instance',
      )
      return
    }

    const scopedRows = scopeAllContextOwnedColumns(db, platformInstanceId)
    log.info(
      { platformInstanceId, scopedRows },
      'migration 051: legacy context-owned rows scoped to the active platform instance',
    )
  },
}

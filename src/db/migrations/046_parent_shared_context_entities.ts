// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { getConfigContextIdFromStorageContextId, isScopedThreadContextId } from '../../chat/scoped-context.js'
import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:046' })

type DurableContextColumn = Readonly<{
  table: string
  column: string
}>

type ContextRow = Readonly<{
  rowid: number
  context_id: string
}>

type PluginContextRow = ContextRow &
  Readonly<{
    plugin_id: string
    updated_at: string
  }>

type PluginKvRow = PluginContextRow & Readonly<{ key: string }>

type UserConfigRow = ContextRow &
  Readonly<{
    key: string
  }>

const DURABLE_CONTEXT_COLUMNS = [
  { table: 'user_instructions', column: 'context_id' },
  { table: 'memos', column: 'user_id' },
  { table: 'recurring_tasks', column: 'user_id' },
  { table: 'scheduled_prompts', column: 'created_by_user_id' },
  { table: 'alert_prompts', column: 'created_by_user_id' },
] as const satisfies readonly DurableContextColumn[]

const PARENT_SHARED_USER_CONFIG_KEYS = new Set([
  'tool_prefs',
  'mcp_endpoints',
  'ai_tool_visibility',
  'ai_reasoning_visibility',
  'ai_output_detail_level',
])

const tableExists = (db: Database, table: string): boolean =>
  db
    .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) !== null

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const promoteDurableColumn = (db: Database, input: DurableContextColumn): void => {
  if (!tableExists(db, input.table)) return
  if (!columnExists(db, input.table, input.column)) return

  const rows = db
    .query<ContextRow, []>(`SELECT rowid, ${input.column} AS context_id FROM ${input.table}`)
    .all()
    .filter((row) => isScopedThreadContextId(row.context_id))

  for (const row of rows) {
    db.run(`UPDATE ${input.table} SET ${input.column} = ? WHERE rowid = ?`, [
      getConfigContextIdFromStorageContextId(row.context_id),
      row.rowid,
    ])
  }
}

const isParentSharedUserConfigKey = (key: string): boolean => {
  if (PARENT_SHARED_USER_CONFIG_KEYS.has(key)) return true
  return key.startsWith('plugin:')
}

const userConfigParentExists = (db: Database, row: UserConfigRow, parentContextId: string): boolean =>
  db
    .query<{ one: number }, [string, string]>(`SELECT 1 AS one FROM user_config WHERE user_id = ? AND key = ?`)
    .get(parentContextId, row.key) !== null

const findUserConfigKeeper = (rows: readonly UserConfigRow[], row: UserConfigRow): UserConfigRow | undefined => {
  const parentContextId = getConfigContextIdFromStorageContextId(row.context_id)
  return [...rows]
    .filter(
      (candidate) =>
        candidate.key === row.key && getConfigContextIdFromStorageContextId(candidate.context_id) === parentContextId,
    )
    .toSorted((left, right) => left.rowid - right.rowid)[0]
}

const promoteUserConfig = (db: Database): void => {
  if (!tableExists(db, 'user_config')) return
  if (!columnExists(db, 'user_config', 'user_id')) return
  if (!columnExists(db, 'user_config', 'key')) return

  const rows = db
    .query<UserConfigRow, []>(`SELECT rowid, user_id AS context_id, key FROM user_config`)
    .all()
    .filter((row) => isScopedThreadContextId(row.context_id) && isParentSharedUserConfigKey(row.key))

  for (const row of rows) {
    const parentContextId = getConfigContextIdFromStorageContextId(row.context_id)
    const keeper = findUserConfigKeeper(rows, row)
    if (userConfigParentExists(db, row, parentContextId) || keeper === undefined || keeper.rowid !== row.rowid) {
      db.run(`DELETE FROM user_config WHERE rowid = ?`, [row.rowid])
    } else {
      db.run(`UPDATE user_config SET user_id = ? WHERE rowid = ?`, [parentContextId, row.rowid])
    }
  }
}

const comparePluginRows = (left: PluginContextRow, right: PluginContextRow, parentContextId: string): number => {
  const updatedOrder = right.updated_at.localeCompare(left.updated_at)
  if (updatedOrder !== 0) return updatedOrder
  const leftIsParent = left.context_id === parentContextId
  const rightIsParent = right.context_id === parentContextId
  if (leftIsParent !== rightIsParent) return leftIsParent ? -1 : 1
  return left.rowid - right.rowid
}

const promotePluginContextState = (db: Database): void => {
  if (!tableExists(db, 'plugin_context_state')) return
  if (!columnExists(db, 'plugin_context_state', 'context_id')) return
  if (!columnExists(db, 'plugin_context_state', 'plugin_id')) return

  const updatedAtColumn = columnExists(db, 'plugin_context_state', 'updated_at') ? 'updated_at' : `'' AS updated_at`

  const rows = db
    .query<PluginContextRow, []>(`SELECT rowid, plugin_id, context_id, ${updatedAtColumn} FROM plugin_context_state`)
    .all()
  const threadRows = rows.filter((row) => isScopedThreadContextId(row.context_id))

  for (const row of threadRows) {
    const parentContextId = getConfigContextIdFromStorageContextId(row.context_id)
    const group = rows.filter(
      (candidate) =>
        candidate.plugin_id === row.plugin_id &&
        getConfigContextIdFromStorageContextId(candidate.context_id) === parentContextId,
    )
    const keeper = [...group].toSorted((left, right) => comparePluginRows(left, right, parentContextId))[0]
    if (keeper === undefined) continue
    for (const candidate of group) {
      if (candidate.rowid !== keeper.rowid)
        db.run(`DELETE FROM plugin_context_state WHERE rowid = ?`, [candidate.rowid])
    }
    if (isScopedThreadContextId(keeper.context_id)) {
      db.run(`UPDATE plugin_context_state SET context_id = ? WHERE rowid = ?`, [parentContextId, keeper.rowid])
    }
  }
}

const promotePluginKv = (db: Database): void => {
  if (!tableExists(db, 'plugin_kv')) return
  if (!columnExists(db, 'plugin_kv', 'context_id')) return
  if (!columnExists(db, 'plugin_kv', 'plugin_id')) return
  if (!columnExists(db, 'plugin_kv', 'key')) return

  const updatedAtColumn = columnExists(db, 'plugin_kv', 'updated_at') ? 'updated_at' : `'' AS updated_at`

  const rows = db
    .query<PluginKvRow, []>(`SELECT rowid, plugin_id, context_id, key, ${updatedAtColumn} FROM plugin_kv`)
    .all()
  const threadRows = rows.filter((row) => isScopedThreadContextId(row.context_id))

  for (const row of threadRows) {
    const parentContextId = getConfigContextIdFromStorageContextId(row.context_id)
    const group = rows.filter(
      (candidate) =>
        candidate.plugin_id === row.plugin_id &&
        candidate.key === row.key &&
        getConfigContextIdFromStorageContextId(candidate.context_id) === parentContextId,
    )
    const keeper = [...group].toSorted((left, right) => comparePluginRows(left, right, parentContextId))[0]
    if (keeper === undefined) continue
    for (const candidate of group) {
      if (candidate.rowid !== keeper.rowid) db.run(`DELETE FROM plugin_kv WHERE rowid = ?`, [candidate.rowid])
    }
    if (isScopedThreadContextId(keeper.context_id)) {
      db.run(`UPDATE plugin_kv SET context_id = ? WHERE rowid = ?`, [parentContextId, keeper.rowid])
    }
  }
}

export const migration046ParentSharedContextEntities: Migration = {
  id: '046_parent_shared_context_entities',
  up(db) {
    for (const input of DURABLE_CONTEXT_COLUMNS) {
      promoteDurableColumn(db, input)
    }
    promoteUserConfig(db)
    promotePluginContextState(db)
    promotePluginKv(db)
    log.info('migration 046: parent shared context entities promoted')
  },
}

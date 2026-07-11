// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:069' })

const RENAME_FROM = 'apply_youtrack_command'
const RENAME_TO = 'plugin_task_provider_youtrack__apply_youtrack_command'

type ToolPrefsRow = Readonly<{ rowid: number; value: string }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function tableExists(db: Database, table: string): boolean {
  return (
    db
      .query<{ one: number }, [string]>(`SELECT 1 AS one FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table) !== null
  )
}

/** Rewrite the apply_youtrack_command override key to its namespaced plugin name. Returns the new
 * JSON string, or null if nothing changed / the value is not parseable tool_prefs. */
function rewriteToolOverrides(value: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const overrides = parsed['toolOverrides']
  if (!isRecord(overrides)) return null
  if (!(RENAME_FROM in overrides)) return null

  const next: Record<string, unknown> = {}
  for (const [key, perm] of Object.entries(overrides)) {
    if (key === RENAME_FROM) {
      next[RENAME_TO] = perm
    } else {
      next[key] = perm
    }
  }
  return JSON.stringify({ ...parsed, toolOverrides: next })
}

export const migration069YoutrackCommandToolPrefsRename: Migration = {
  id: '069_youtrack_command_tool_prefs_rename',
  up(db) {
    if (!tableExists(db, 'user_config')) return
    const rows = db.query<ToolPrefsRow, []>(`SELECT rowid, value FROM user_config WHERE key = 'tool_prefs'`).all()
    let updated = 0
    for (const row of rows) {
      const next = rewriteToolOverrides(row.value)
      if (next === null) continue
      db.run(`UPDATE user_config SET value = ? WHERE rowid = ?`, [next, row.rowid])
      updated += 1
    }
    log.info(
      { scanned: rows.length, updated },
      'migration 069: renamed apply_youtrack_command tool_prefs to plugin_task_provider_youtrack__apply_youtrack_command',
    )
  },
}

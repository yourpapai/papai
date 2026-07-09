// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:067' })

const RENAME_FROM = 'plugin_acp__'
const RENAME_TO = 'module_coding__'

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

/** Rewrite plugin_acp__ override keys to module_coding__. Returns the new JSON string, or null if
 * nothing changed / the value is not parseable tool_prefs. */
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

  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, perm] of Object.entries(overrides)) {
    if (key.startsWith(RENAME_FROM)) {
      next[`${RENAME_TO}${key.slice(RENAME_FROM.length)}`] = perm
      changed = true
    } else {
      next[key] = perm
    }
  }
  if (!changed) return null
  return JSON.stringify({ ...parsed, toolOverrides: next })
}

export const migration067AcpToolPrefsRename: Migration = {
  id: '067_acp_tool_prefs_rename',
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
    log.info({ scanned: rows.length, updated }, 'migration 067: renamed plugin_acp__ tool_prefs to module_coding__')
  },
}

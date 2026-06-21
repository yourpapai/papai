// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:060' })

const tableExists = (db: Database, table: string): boolean =>
  db.query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table) !==
  null

const up = (db: Database): void => {
  if (!tableExists(db, 'kaneo_workspace_members')) {
    db.run(`
      CREATE TABLE kaneo_workspace_members (
        group_context_id TEXT NOT NULL,
        chat_user_id     TEXT NOT NULL,
        provider_name    TEXT NOT NULL DEFAULT 'kaneo',
        provider_user_id TEXT NOT NULL,
        login            TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'active',
        encrypted_password  TEXT,
        created_at          TEXT NOT NULL,
        PRIMARY KEY (group_context_id, chat_user_id, provider_name)
      )
    `)
  }
  log.info('migration 060: kaneo_workspace_members created')
}

export const migration060KaneoWorkspaceMembers: Migration = { id: '060_kaneo_workspace_members', up }
export default migration060KaneoWorkspaceMembers

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:068' })

const tableExists = (db: Database, table: string): boolean =>
  db.query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table) !==
  null

/**
 * Expand-phase rename of the host-owned membership store: create the provider-agnostic
 * `task_provider_members` with the identical schema and copy existing `kaneo_workspace_members`
 * rows. The old table is intentionally KEPT (dropped in a later release) as a rollback escape
 * hatch; code switches to the new table in the same slice.
 */
const up = (db: Database): void => {
  if (!tableExists(db, 'task_provider_members')) {
    db.run(`
      CREATE TABLE task_provider_members (
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
  if (tableExists(db, 'kaneo_workspace_members')) {
    db.run(`
      INSERT INTO task_provider_members
        (group_context_id, chat_user_id, provider_name, provider_user_id, login, status, encrypted_password, created_at)
      SELECT group_context_id, chat_user_id, provider_name, provider_user_id, login, status, encrypted_password, created_at
      FROM kaneo_workspace_members
      WHERE true
      ON CONFLICT (group_context_id, chat_user_id, provider_name) DO NOTHING
    `)
  }
  log.info('migration 068: task_provider_members created + rows copied from kaneo_workspace_members')
}

export const migration068TaskProviderMembers: Migration = { id: '068_task_provider_members', up }
export default migration068TaskProviderMembers

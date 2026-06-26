// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:064' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS coding_session_repos (
      context_id TEXT NOT NULL,
      repo_id TEXT NOT NULL,
      name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      permission_preset TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (context_id, repo_id)
    )
  `)
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS uq_coding_session_repos_name ON coding_session_repos (context_id, name)`)
  log.info('migration 064: coding_session_repos table created')
}

export const migration064CodingSessionRepos: Migration = {
  id: '064_coding_session_repos',
  up,
}

export default migration064CodingSessionRepos

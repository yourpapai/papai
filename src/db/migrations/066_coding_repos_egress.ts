// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:066' })

const up = (db: Database): void => {
  db.run(`ALTER TABLE coding_session_repos ADD COLUMN additional_egress_domains TEXT NOT NULL DEFAULT '[]'`)
  log.info('migration 066: coding_session_repos.additional_egress_domains column added')
}

export const migration066CodingReposEgress: Migration = {
  id: '066_coding_repos_egress',
  up,
}

export default migration066CodingReposEgress

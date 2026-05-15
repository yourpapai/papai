// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:033' })

const up = (db: Database): void => {
  // Ensure unique constraint on (platform_file_id, context_id) for atomic upserts
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_staged_platform_context ON staged_files(platform_file_id, context_id)`)
  log.info('migration 033: added unique index idx_staged_platform_context on staged_files')
}

export const migration033StagedFilesUniquePlatformContext: Migration = {
  id: '033_staged_files_unique_platform_context',
  up,
}

export default migration033StagedFilesUniquePlatformContext

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:067' })

const up = (db: Database): void => {
  const result = db.run(`DELETE FROM user_identity_mappings WHERE context_id LIKE 'pi:%:ctx:%'`)
  log.info({ deleted: result.changes }, 'migration 067: orphaned scoped-key identity mappings removed')
}

export const migration067IdentityScopedKeyCleanup: Migration = {
  id: '067_identity_scoped_key_cleanup',
  up,
}

export default migration067IdentityScopedKeyCleanup

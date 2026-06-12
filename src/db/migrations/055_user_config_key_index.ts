// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:055' })

const up = (db: Database): void => {
  db.run(`CREATE INDEX IF NOT EXISTS idx_user_config_key ON user_config(key)`)
  log.info('migration 055: idx_user_config_key index created')
}

export const migration055UserConfigKeyIndex: Migration = {
  id: '055_user_config_key_index',
  up,
}

export default migration055UserConfigKeyIndex

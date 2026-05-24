// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const up = (db: Database): void => {
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_platform_user ON users (platform_instance_id, platform_user_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_platform_username ON users (platform_instance_id, username)`)
}

export const migration041UsersPlatformInstanceIndex: Migration = {
  id: '041_users_platform_instance_index',
  up,
}

export default migration041UsersPlatformInstanceIndex

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration022DropUnusedLastSeenIndex: Migration = {
  id: '022_drop_unused_last_seen_index',
  up(db: Database): void {
    db.run(`DROP INDEX IF EXISTS idx_known_group_contexts_last_seen`)
  },
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration001Initial: Migration = {
  id: '001_initial',
  up(db: Database): void {
    db.run('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  },
}

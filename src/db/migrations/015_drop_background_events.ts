// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration015DropBackgroundEvents: Migration = {
  id: '015_drop_background_events',
  up(db: Database): void {
    db.run('DROP TABLE IF EXISTS background_events')
  },
}

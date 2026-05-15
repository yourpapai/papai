// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

function createUserIdentityMappingsTable(db: Database): void {
  db.run(`
    CREATE TABLE user_identity_mappings (
      context_id          TEXT NOT NULL,
      provider_name       TEXT NOT NULL,
      provider_user_id    TEXT,
      provider_user_login TEXT,
      display_name        TEXT,
      matched_at          TEXT NOT NULL,
      match_method        TEXT,
      confidence          INTEGER,
      PRIMARY KEY (context_id, provider_name)
    )
  `)
  db.run(`CREATE INDEX idx_identity_mappings_provider_user ON user_identity_mappings(provider_name, provider_user_id)`)
}

export const migration019UserIdentityMappings: Migration = {
  id: '019_user_identity_mappings',
  up(db: Database): void {
    createUserIdentityMappingsTable(db)
  },
}
